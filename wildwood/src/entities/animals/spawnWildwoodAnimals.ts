import { Group, Vector3, type Object3D } from "three";
import { Animal, type AnimalGround, type IAnimalModel } from "./Animal.js";
import { ANIMAL_SPECS, type AnimalSpec } from "./animalSpecs.js";
import { waterFromGround, type WaterTest } from "./shore.js";

/** Where one animal starts. Omitted animals from the roster simply do not spawn. */
export interface IAnimalPlacement {
  readonly id: string;
  readonly x: number;
  readonly z: number;
}

export interface IWildwoodAnimals {
  /** Added to the scene graph once; the caller never adds individual animals. */
  readonly group: Group;
  readonly animals: readonly Animal[];
  /** Call once per frame with the threat's position (the player) or null for an empty wood. */
  update(dt: number, threat: Readonly<Vector3> | null): void;
  dispose(): void;
}

export interface ISpawnAnimalsOptions {
  /**
   * The game's own model loader — `ctx.assets.model` in the valley, a raw GLTFLoader in the
   * dev harness. The path is the GLB file name only (`"fox.glb"`), so each caller keeps its
   * own base path.
   */
  readonly load: (path: string) => Promise<IAnimalModel>;
  /** Ground height under a point, in metres. The valley passes `heightAt`. */
  readonly ground: AnimalGround;
  /**
   * Where the standing water is. Defaults to *ground below `waterLevel`*, which is the valley's
   * own definition and the one `createWater` builds its mesh from — so a scene that already
   * passes `heightAt` gets water-avoiding animals without being asked a second question.
   *
   * Pass it explicitly when the ground function is a fiction: the animals harness stands its
   * roster on a flat plane at y = 0 for the screenshot, and a flat plane has no lake in it.
   */
  readonly water?: WaterTest;
  /** Where the waterline sits, in metres. Only used to derive `water`. Defaults to 0. */
  readonly waterLevel?: number;
  /** What the animals are added to and updated under. */
  readonly parent: Object3D;
  /** One placement per animal. Defaults to a loose line of the full roster through the origin. */
  readonly placements?: readonly IAnimalPlacement[];
  /** Seeded source of decisions. Pass `ctx.random` for a replayable wood. */
  readonly rng?: () => number;
  /** Console-style sink for the per-clip audit lines; defaults to console.log. */
  readonly log?: (line: string) => void;
}

/**
 * Load the animal pack, spawn it, and return the one object the scene owns.
 *
 * Scenes get exactly two integration lines out of this: an `await` in `load()` and an
 * `update()` in the frame function. Every per-animal concern — scale normalisation, clip
 * binding audits, state machines, SkeletonUtils cloning — happens in here, because the next
 * game should never have to think about any of it.
 */
export async function spawnWildwoodAnimals(options: ISpawnAnimalsOptions): Promise<IWildwoodAnimals> {
  const log = options.log ?? ((line: string) => console.log(line));
  const placements: readonly IAnimalPlacement[] =
    options.placements ??
    ANIMAL_SPECS.map((spec, index) => ({
      id: spec.id,
      x: (index - (ANIMAL_SPECS.length - 1) / 2) * 3.2,
      z: 0,
    }));

  /**
   * `?noWaterAvoidance` — the negative control, in the game rather than only in the harness.
   *
   * A scenario that asserts "no animal entered the water" has to be able to fail, or it is a row
   * that says nothing. This switch hands the roster a world with no water in it while the audit
   * below keeps reading the real shoreline, which reproduces the original defect on any later
   * build without editing a line. It is a browser-query switch like the scene's own `?noanimals`
   * and `?lowtier`, and it exists for `playtests/animals-dry.playtest.json` to point at.
   */
  const disabled =
    typeof location !== "undefined" &&
    new URLSearchParams(location.search).has("noWaterAvoidance");
  if (disabled) log("[animals] TN_ANIMALS_WATER_AVOIDANCE:off (?noWaterAvoidance)");
  /** What the animals are told to avoid. The control above can empty it; the audit's cannot. */
  const water =
    options.water ??
    (disabled ? () => false : waterFromGround(options.ground, options.waterLevel ?? 0));
  /** What the audit measures against: always the real shoreline, whatever the animals were told. */
  const realWater = options.water ?? waterFromGround(options.ground, options.waterLevel ?? 0);

  const group = new Group();
  group.name = "animals";

  const models = new Map<string, IAnimalModel>();
  const animals: Animal[] = [];

  // Every distinct GLB in flight at once: six sequential awaits were six round trips on the
  // critical path, and nothing about one animal's bytes depends on another's.
  const specs = placements
    .map((placement) => ANIMAL_SPECS.find((candidate) => candidate.id === placement.id))
    .filter((spec): spec is AnimalSpec => spec !== undefined);
  const sources = await Promise.allSettled(
    [...new Set(specs)].map(async (spec) => {
      const model = await options.load(`${spec.glb}.glb`);
      models.set(spec.id, model);
      log(`[animals] loaded ${spec.glb}.glb with ${model.animations.length} clips`);
    }),
  );
  const rejected = sources.find(
    (source): source is PromiseRejectedResult => source.status === "rejected",
  );
  if (rejected !== undefined) throw rejected.reason;

  for (const placement of placements) {
    const spec = ANIMAL_SPECS.find((candidate) => candidate.id === placement.id);
    if (spec === undefined) {
      log(`[animals] no spec named '${placement.id}'; skipping`);
      continue;
    }
    const model = models.get(spec.id);
    if (model === undefined) throw new Error(`[animals] ${spec.glb}.glb did not load`);
    const animal = new Animal(spec, model, {
      ground: options.ground,
      spawn: new Vector3(placement.x, 0, placement.z),
      rng: options.rng,
      water,
    });
    for (const line of animal.audit()) log(`[animals] ${line}`);
    animals.push(animal);
    group.add(animal.object);
    // Cloning and auditing six skinned rigs in one browser task produced a 229 ms post-entry
    // stall. All unique sources have resolved above; yield only between placement clones.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }

  options.parent.add(group);

  /**
   * The invariant, checked in the running game rather than only in the harness.
   *
   * Six terrain samples a frame, and one console error the first time any animal's feet go under
   * the waterline. It is here because the harness proves the state machine on a flat plane with a
   * seeded clock, and the game runs it against the real heightfield with `Math.random` — the two
   * can disagree, and if they ever do, this is the line that says so instead of a player noticing
   * a deer standing in the lake. `noConsoleErrors` in `playtests/animals-dry.playtest.json` is
   * what turns it into a failure.
   */
  const reported = new Set<string>();
  const auditWater = (): void => {
    for (const animal of animals) {
      if (reported.has(animal.spec.id)) continue;
      const { x, z } = animal.object.position;
      if (!realWater(x, z)) continue;
      reported.add(animal.spec.id);
      console.error(
        `TN_ANIMAL_IN_WATER:${animal.spec.id} at=${x.toFixed(2)},${z.toFixed(2)} state=${animal.state}`,
      );
    }
  };

  return {
    group,
    animals,
    update(dt, threat) {
      for (const animal of animals) animal.update(dt, threat);
      auditWater();
    },
    dispose() {
      for (const animal of animals) animal.dispose();
      group.removeFromParent();
    },
  };
}
