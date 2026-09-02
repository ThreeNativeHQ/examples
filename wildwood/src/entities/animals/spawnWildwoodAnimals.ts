import { Group, Vector3, type Object3D } from "three";
import { Animal, type AnimalGround, type IAnimalModel } from "./Animal.js";
import { ANIMAL_SPECS, type AnimalSpec } from "./animalSpecs.js";

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
    });
    for (const line of animal.audit()) log(`[animals] ${line}`);
    animals.push(animal);
    group.add(animal.object);
    // Cloning and auditing six skinned rigs in one browser task produced a 229 ms post-entry
    // stall. All unique sources have resolved above; yield only between placement clones.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }

  options.parent.add(group);

  return {
    group,
    animals,
    update(dt, threat) {
      for (const animal of animals) animal.update(dt, threat);
    },
    dispose() {
      for (const animal of animals) animal.dispose();
      group.removeFromParent();
    },
  };
}
