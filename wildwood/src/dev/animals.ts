/**
 * The animals harness: a flat lit ground, the full roster, and their real animations.
 *
 * This is a dev entry (`/dev-animals.html`), not the game — it exists so a screenshot can
 * prove the animals render, animate, and bind their clips, without booting the valley. The
 * GLB paths are the same ones the valley loads; the installed `createAssetLoader` resolves the
 * same compiled manifest and compressed-texture support as `ctx.assets.model`.
 */
import type { Animal, AnimalState } from "../entities/animals/Animal.js";
import { spawnWildwoodAnimals } from "../entities/animals/spawnWildwoodAnimals.js";
import { boneLengthDeviations, createAssetLoader, createRandom } from "@threenative/core";
import { assertJsonSafe } from "@threenative/playtest";
import { LAKE, POND, WATER_LEVEL, heightAt } from "../render/terrain.js";
import {
  Color,
  DirectionalLight,
  Fog,
  HemisphereLight,
  Mesh,
  MeshStandardMaterial,
  PCFSoftShadowMap,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  SphereGeometry,
  type Object3D,
  Vector3,
} from "three";
import { WebGPURenderer } from "three/webgpu";

const params = new URLSearchParams(location.search);
/**
 * `?only=<id>` spawns exactly one animal at the origin and frames the camera on it — the view a
 * pose verdict can be made against. Every animal in the full-roster view is a few dozen pixels
 * at the edge of frame, which is how two "looks correct" calls in the deformed-animals
 * investigation were wrong.
 */
const onlyId = params.get("only");
/** `?roam=0` pins the roster in place: the state machine keeps playing, the body never leaves. */
const roamPinned = params.get("roam") === "0";
const OBSERVATION_VERSION = 2;
const OBSERVATION_SEED = 90210;
const FIXED_STEP_SECONDS = 1 / 60;
const SIMULATION_SECONDS = 180;
const SIMULATION_STEPS = SIMULATION_SECONDS / FIXED_STEP_SECONDS;
/**
 * Seconds of the second phase, in which every animal is deliberately driven at the water.
 *
 * The wander phase measures where an animal chooses to go. This one measures where it goes when
 * it is not choosing: a bolt is the one state whose heading comes from the threat rather than
 * from any target, at up to twelve metres a second, and it is the state a player actually causes
 * — you walk toward a deer, it runs, and if the lake is behind it the lake is where it runs.
 * The threat below is placed on the far side of each animal from the water on purpose, so "away"
 * points straight in.
 */
const BOLT_SECONDS = 45;
const BOLT_STEPS = BOLT_SECONDS / FIXED_STEP_SECONDS;
/**
 * `?noWaterAvoidance` hands the animals a world with no water in it while the measurement keeps
 * reading the real shoreline — the negative control for every green below.
 *
 * A proof that only ever passes proves nothing about what it is measuring. This switch reproduces
 * the original defect on demand, on any later build, without editing a line: the animals get the
 * pre-fix behaviour, the observation reports `water-violation`, and the runner goes red.
 */
const waterAvoidance = !params.has("noWaterAvoidance");
const ANIMAL_LISTING = "2dd7964c-a601-4264-a53d-465dcae1644c";
// createPond() passes this exact radius to createWater(); POND.radius is only the terrain basin.
const POND_WATER_RADIUS = POND.radius * 1.7;

/**
 * Standing water, as the valley actually draws it: the ground under a point is below the
 * waterline.
 *
 * The disc footprints below are kept because the observation reports them, but they are not the
 * test and never were. `LAKE.radius` is the radius of the *basin term* in `heightAt`, and the
 * noise that basin is subtracted from moves the real waterline in and out by several metres —
 * inward around the lake, and outward past `POND.radius` at the pond, whose shore shelves for
 * twice its nominal radius. A disc is therefore wrong in both directions at once: it calls dry
 * bank wet, and it calls a wet inlet dry. `heightAt < WATER_LEVEL` is the same predicate
 * `createWater` uses to decide which grid cells get triangles, so it is the shoreline the player
 * sees.
 */
const isStandingWater = (x: number, z: number): boolean => heightAt(x, z) < WATER_LEVEL;
const PRODUCTION_PLACEMENTS = [
  { id: "fox", x: 28, z: 8 },
  { id: "stag", x: 28, z: 2 },
  { id: "doe", x: 54, z: 2 },
  { id: "wolf", x: -6, z: -30 },
  { id: "pig", x: 20, z: 36 },
  { id: "crow", x: 14, z: 26 },
] as const;
const STATE_NAMES: readonly AnimalState[] = ["idle", "graze", "wander", "flee"];
/** Force every animal into one state and keep re-asserting it every few seconds. */
const forcedState: AnimalState | null = STATE_NAMES.includes(
  params.get("state") as AnimalState,
)
  ? (params.get("state") as AnimalState)
  : null;
/** Radius a circling threat walks at; 0 disables the threat entirely. Single-animal view defaults to 0. */
const threatRadius =
  params.get("threat") !== null ? Number(params.get("threat")) : onlyId !== null ? 0 : 14;
/** A static threat pinned at "x,z" — the flee lane's way of promising a bolt on frame one. */
const staticThreat = params.get("threatAt");

const hud = document.getElementById("hud") ?? document.body;
const renderer = new WebGPURenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

const scene = new Scene();
scene.background = new Color(0xc7dcea);
scene.fog = new Fog(0xc7dcea, 26, 62);

const camera = new PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 200);
camera.position.set(0, 2.4, 11);
camera.lookAt(0, 0.8, 0);

/** The single animal the `?only` view frames, for the per-frame camera hold below. */
let framedAnimal: Animal | null = null;

const sun = new DirectionalLight(0xfff1d6, 2.6);
sun.position.set(9, 13, 7);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -16;
sun.shadow.camera.right = 16;
sun.shadow.camera.top = 16;
sun.shadow.camera.bottom = -16;
scene.add(sun);
scene.add(new HemisphereLight(0xbcd8ff, 0x4c6236, 1.1));

const ground = new Mesh(
  new PlaneGeometry(90, 90),
  new MeshStandardMaterial({ color: 0x6d8b53, roughness: 1 }),
);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

// A red marker where the threat is, so a still frame can prove the flee heading runs AWAY
// from it rather than toward it.
const threatMarker = new Mesh(
  new SphereGeometry(0.25, 16, 12),
  new MeshStandardMaterial({ color: 0xd23c2a, roughness: 0.6 }),
);
threatMarker.visible = threatRadius > 0;
scene.add(threatMarker);

await renderer.init();
const assets = createAssetLoader({ basePath: "/", renderer });
const rng = createRandom(OBSERVATION_SEED);
/** `?only` spawns one animal at the origin; the roster view keeps the production placements. */
const placements = onlyId !== null
  ? (() => {
      const match = PRODUCTION_PLACEMENTS.find((placement) => placement.id === onlyId);
      if (match === undefined) {
        throw new Error(
          `?only must name a production animal (${PRODUCTION_PLACEMENTS.map((p) => p.id).join(", ")}); got ${onlyId}`,
        );
      }
      return [{ id: match.id, x: 0, z: 0 }];
    })()
  : PRODUCTION_PLACEMENTS;
const animals = await spawnWildwoodAnimals({
  // The installed loader resolves the same logical manifest entries Valley passes to ctx.assets.
  load: (path) => assets.model(`fab/${ANIMAL_LISTING}/ue/Models/${path}`),
  // The harness's ground is a flat plane at y = 0, not the valley's terrain — placing on
  // `heightAt` floats the whole roster ~5 m above the plane they are supposed to stand on.
  ground: () => 0,
  // …but the water is the valley's, because the flat plane has no lake in it and the whole
  // point of this observation is where the animals walk in the world they actually live in.
  // Height decides how they stand; the shoreline decides where they go, and only the second
  // one is being measured here.
  water: waterAvoidance ? isStandingWater : () => false,
  parent: scene,
  placements,
  rng,
  log: (line) => console.log(line),
});
for (const animal of animals.animals) {
  animal.object.traverse((object) => {
    if ((object as Mesh).isMesh === true) object.castShadow = true;
  });
}

const rigYawCorruptionRadians: Record<string, number> = {};
const corruptAnimalForward = params.get("corruptAnimalForward");
if (corruptAnimalForward !== null) {
  if (corruptAnimalForward !== "fox") {
    throw new Error(
      `animal forward corruption only supports fox; got ${corruptAnimalForward}`,
    );
  }
  const foxes = animals.animals.filter((animal) => animal.spec.id === "fox");
  if (foxes.length !== 1) {
    throw new Error(
      `fox rig-yaw corruption requires exactly one fox; got ${String(foxes.length)}`,
    );
  }
  requiredAnimalRig(foxes[0]!).rotateY(Math.PI);
  rigYawCorruptionRadians.fox = Math.PI;
}

if (onlyId !== null) {
  framedAnimal = animals.animals[0] ?? null;
  if (framedAnimal === null) throw new Error("?only spawned no animal");
  // Frame the one animal: a three-quarter view sized off its measured metre length.
  const span = framedAnimal.spec.length;
  camera.position.set(span * 1.35, span * 0.62, span * 1.85);
  camera.lookAt(0, span * 0.42, 0);
}

const observation = onlyId === null ? measureProductionSubjects(animals.animals) : null;
if (observation !== null) {
  assertJsonSafe(observation);
  if (!params.has("omitAnimalObservation")) {
    (
      globalThis as typeof globalThis & {
        __TN_ANIMALS_OBSERVATION__?: typeof observation;
      }
    ).__TN_ANIMALS_OBSERVATION__ = observation;
    console.log(
      `TN_ANIMALS_OBSERVATION_READY:${String(observation.subjects.length)}`,
    );
  }
}

// The observation uses production placements. Once frozen, restore the visual roster's close
// lineup so its headed WebGPU screenshot still shows the six measured subjects at useful scale.
// The single-animal view keeps its origin spawn and its framed camera.
if (onlyId === null) {
  for (const [index, animal] of animals.animals.entries()) {
    animal.object.position.set(
      (index - (animals.animals.length - 1) / 2) * 3.2,
      0,
      0,
    );
  }
}
// The per-clip binding audit exists on every Animal and nothing was calling it. That is why the
// doe and the wolf shipped bound to another animal's clip names, standing in bind pose, with no
// error anywhere: a track that binds nothing plays the bind pose and says so to no one.
for (const line of animals.animals.flatMap((animal) => animal.audit())) {
  console.info(`TN_ANIMALS_AUDIT ${line}`);
}
console.log("TN_ANIMALS_READY");

/**
 * The bone-length invariance report for one animal, as posed right now.
 *
 * A rigid skeleton preserves every parent→child distance under any pose; the report names any
 * bone whose distance to its parent changed since the bind-pose baseline. This is the number a
 * pose verdict is made from — no screenshot is graded.
 */
function boneReport(animal: Animal) {
  const rig = requiredAnimalRig(animal);
  const report = boneLengthDeviations(rig, animal.bindBoneLengths);
  const deviations = report.deviations.slice(0, 8).map((deviation) => ({
    bone: deviation.bone,
    bindLength: rounded(deviation.bindLength),
    posedLength: rounded(deviation.posedLength),
    delta: rounded(deviation.delta),
    // Zero-length bind bones cannot move by ratio; a -1 says "read delta instead".
    ratio: Number.isFinite(deviation.ratio) ? rounded(deviation.ratio) : -1,
  }));
  return {
    id: animal.spec.id,
    state: animal.state,
    clip: animal.clip ?? null,
    compared: report.compared,
    rigid: report.rigid,
    maxDeviation: rounded(report.maxDeviation),
    worst: deviations[0] ?? null,
    deviations,
  };
}

/** Anatomical forward (head−pelvis, horizontal) dotted with the body's facing axis. */
function forwardProbe(animal: Animal) {
  const { head, pelvis } = requiredForwardLandmarks(animal);
  animal.object.updateWorldMatrix(true, true);
  const headWorld = head.getWorldPosition(new Vector3());
  const pelvisWorld = pelvis.getWorldPosition(new Vector3());
  const forward = headWorld.sub(pelvisWorld).setY(0);
  const length = forward.length();
  if (length <= 1e-9) return { id: animal.spec.id, forwardZ: 0, degenerate: true };
  const yaw = animal.object.rotation.y;
  const forwardZ = (forward.x * Math.sin(yaw) + forward.z * Math.cos(yaw)) / length;
  return { id: animal.spec.id, forwardZ: rounded(forwardZ), degenerate: false };
}

let boneReportPrinted = false;
let lastBoneSample = -1;

function measureProductionSubjects(subjects: readonly Animal[]) {
  if (subjects.length !== PRODUCTION_PLACEMENTS.length) {
    throw new Error(
      `animal observation requires six production subjects; got ${String(subjects.length)}`,
    );
  }
  const samples = new Map(
    subjects.map((animal) => {
      const landmarks = requiredForwardLandmarks(animal);
      return [
        animal.spec.id,
        {
          start: animal.object.position.clone(),
          previous: animal.object.position.clone(),
          distanceTravelled: 0,
          dots: [] as number[],
          lakeSamples: 0,
          pondSamples: 0,
          totalSamples: 0,
          /** Samples where the animal's own feet were under the drawn waterline. */
          wetSamples: 0,
          /** The deepest water it stood in, in metres. Zero when it never got wet. */
          deepestMetres: 0,
          /** Where it was standing when it was deepest, for a report that names a place. */
          deepestAt: [0, 0] as [number, number],
          ...landmarks,
        },
      ];
    }),
  );
  const movement = new Vector3();
  const renderedForward = new Vector3();
  const headWorld = new Vector3();
  const pelvisWorld = new Vector3();

  const recordWater = (animal: Animal) => {
    const sample = samples.get(animal.spec.id);
    if (sample === undefined)
      throw new Error(`animal observation sample missing: ${animal.spec.id}`);
    const { x, z } = animal.object.position;
    sample.totalSamples += 1;
    if (Math.hypot(x - LAKE.x, z - LAKE.z) <= LAKE.radius)
      sample.lakeSamples += 1;
    if (Math.hypot(x - POND.x, z - POND.z) <= POND_WATER_RADIUS)
      sample.pondSamples += 1;
    if (isStandingWater(x, z)) {
      sample.wetSamples += 1;
      const depth = WATER_LEVEL - heightAt(x, z);
      if (depth > sample.deepestMetres) {
        sample.deepestMetres = depth;
        sample.deepestAt = [x, z];
      }
    }
  };
  for (const animal of subjects) recordWater(animal);

  for (let step = 0; step < SIMULATION_STEPS; step += 1) {
    if (step % 360 === 0) {
      for (const animal of subjects) animal.forceState("wander", 6.1);
    }
    animals.update(FIXED_STEP_SECONDS, null);
    for (const animal of subjects) {
      const sample = samples.get(animal.spec.id);
      if (sample === undefined)
        throw new Error(`animal observation sample missing: ${animal.spec.id}`);
      movement.subVectors(animal.object.position, sample.previous).setY(0);
      if (!isFiniteVector(movement)) {
        throw new Error(
          `animal observation movement is non-finite: ${animal.spec.id}`,
        );
      }
      const distance = movement.length();
      if (distance > 1e-8) {
        sample.distanceTravelled += distance;
        animal.object.updateWorldMatrix(true, true);
        sample.head.getWorldPosition(headWorld);
        sample.pelvis.getWorldPosition(pelvisWorld);
        if (!isFiniteVector(headWorld) || !isFiniteVector(pelvisWorld)) {
          throw new Error(
            `animal observation anatomical landmark is non-finite: ${animal.spec.id}`,
          );
        }
        renderedForward.subVectors(headWorld, pelvisWorld).setY(0);
        if (!isFiniteVector(renderedForward)) {
          throw new Error(
            `animal observation model-forward is non-finite: ${animal.spec.id}`,
          );
        }
        if (renderedForward.lengthSq() <= 1e-12) {
          throw new Error(
            `animal observation head-minus-pelvis model-forward is zero: ${animal.spec.id}`,
          );
        }
        const dot = movement.normalize().dot(renderedForward.normalize());
        if (!Number.isFinite(dot)) {
          throw new Error(
            `animal observation model-forward dot is non-finite: ${animal.spec.id}`,
          );
        }
        sample.dots.push(dot);
      }
      sample.previous.copy(animal.object.position);
      recordWater(animal);
    }
  }

  // Phase two: drive every animal at the water.
  //
  // The threat is re-placed each step directly opposite the nearest water body, just inside the
  // animal's bolt radius, so the escape heading the flee state computes points at the middle of
  // the lake. This is the state that has no target to filter and no time to think — whatever
  // keeps a bolting stag out of the water has to do it at twelve metres a second.
  const bolt = new Vector3();
  const threat = new Vector3();
  for (let step = 0; step < BOLT_STEPS; step += 1) {
    for (const animal of subjects) {
      const sample = samples.get(animal.spec.id);
      if (sample === undefined)
        throw new Error(`animal observation sample missing: ${animal.spec.id}`);
      const { x, z } = animal.object.position;
      const centre =
        Math.hypot(x - LAKE.x, z - LAKE.z) < Math.hypot(x - POND.x, z - POND.z)
          ? { x: LAKE.x, z: LAKE.z }
          : { x: POND.x, z: POND.z };
      bolt.set(x - centre.x, 0, z - centre.z);
      if (bolt.lengthSq() <= 1e-9) bolt.set(1, 0, 0);
      bolt.normalize().multiplyScalar(animal.spec.fleeRadius * 0.55);
      threat.set(x + bolt.x, 0, z + bolt.z);
      if (step % 240 === 0) animal.forceState("flee", 4.2);
      animal.update(FIXED_STEP_SECONDS, threat);
      sample.previous.copy(animal.object.position);
      recordWater(animal);
    }
  }

  const rows = subjects.map((animal) => {
    const sample = samples.get(animal.spec.id);
    if (sample === undefined || sample.dots.length === 0) {
      throw new Error(
        `animal observation measured no movement: ${animal.spec.id}`,
      );
    }
    const displacement = animal.object.position
      .clone()
      .sub(sample.start)
      .setY(0)
      .length();
    const dotMean =
      sample.dots.reduce((sum, value) => sum + value, 0) / sample.dots.length;
    return {
      id: animal.spec.id,
      logicalPath: `fab/${ANIMAL_LISTING}/ue/Models/${animal.spec.glb}.glb`,
      start: vector(sample.start),
      end: vector(animal.object.position),
      displacementMeters: rounded(displacement),
      distanceTravelledMeters: rounded(sample.distanceTravelled),
      movingSamples: sample.dots.length,
      modelForwardReference: {
        kind: "head-minus-pelvis" as const,
        head: sample.head.name,
        pelvis: sample.pelvis.name,
      },
      modelForwardDot: {
        minimum: rounded(Math.min(...sample.dots)),
        mean: rounded(dotMean),
        maximum: rounded(Math.max(...sample.dots)),
        negativeSamples: sample.dots.filter((value) => value < 0).length,
      },
      waterOverlap: {
        lakeSamples: sample.lakeSamples,
        pondSamples: sample.pondSamples,
        totalSamples: sample.totalSamples,
        intersects: sample.lakeSamples + sample.pondSamples > 0,
        /** The verdict. Disc overlap is a neighbourhood; this is feet under the waterline. */
        wetSamples: sample.wetSamples,
        deepestMetres: rounded(sample.deepestMetres),
        deepestAt: [rounded(sample.deepestAt[0]), rounded(sample.deepestAt[1])],
      },
    };
  });
  if (rows.some((row) => row.displacementMeters <= 0)) {
    throw new Error(
      "animal observation requires measured displacement for every production subject",
    );
  }

  // Fail closed on the walked-into-water defect.
  //
  // The observation is still published in full — a run that reports nothing is a run nobody can
  // debug — but its `status` is no longer `ready`, and `ready` is what the runner requires. So a
  // wet animal turns `node tools/run-playtests.mjs --capture-animals` red without any assertion
  // living outside this file, and the line below names which animal, where, and how deep.
  const wet = rows.filter((row) => row.waterOverlap.wetSamples > 0);
  for (const row of wet) {
    console.error(
      `TN_ANIMALS_WATER_VIOLATION:${row.id} wetSamples=${String(row.waterOverlap.wetSamples)}/${String(row.waterOverlap.totalSamples)}` +
        ` deepest=${row.waterOverlap.deepestMetres.toFixed(2)}m at=${row.waterOverlap.deepestAt.join(",")}`,
    );
  }
  return {
    version: OBSERVATION_VERSION,
    status: wet.length === 0 ? ("ready" as const) : ("water-violation" as const),
    seed: OBSERVATION_SEED,
    fixedStepSeconds: FIXED_STEP_SECONDS,
    simulationSeconds: SIMULATION_SECONDS,
    simulationSteps: SIMULATION_STEPS,
    boltSeconds: BOLT_SECONDS,
    boltSteps: BOLT_STEPS,
    waterAvoidance,
    waterFootprints: {
      lake: { x: LAKE.x, z: LAKE.z, radius: LAKE.radius },
      pond: { x: POND.x, z: POND.z, radius: POND_WATER_RADIUS },
    },
    controls: { rigYawCorruptionRadians },
    subjects: rows,
    checks: {
      allSix: rows.length === 6,
      allMoved: rows.every((row) => row.displacementMeters > 0),
      backwardsMotion: rows
        .filter((row) => row.modelForwardDot.mean < -0.25)
        .map((row) => row.id),
      waterIntersections: rows
        .filter((row) => row.waterOverlap.intersects)
        .map((row) => row.id),
      /** Animals that stood in the water. Empty is the only acceptable value. */
      inWater: wet.map((row) => row.id),
    },
  };
}

function requiredAnimalRig(animal: Animal): Object3D {
  const rig = animal.object.children[0];
  if (rig === undefined) {
    throw new Error(`animal observation rig missing: ${animal.spec.id}`);
  }
  return rig;
}

function requiredForwardLandmarks(animal: Animal): {
  head: Object3D;
  pelvis: Object3D;
} {
  const heads: Object3D[] = [];
  const pelvises: Object3D[] = [];
  requiredAnimalRig(animal).traverse((object) => {
    if (object.name.endsWith("_-Head")) heads.push(object);
    if (object.name.endsWith("_-Pelvis")) pelvises.push(object);
  });
  if (heads.length !== 1 || pelvises.length !== 1) {
    throw new Error(
      `animal observation requires one _-Head and one _-Pelvis landmark for ${animal.spec.id}; got head=${String(heads.length)} pelvis=${String(pelvises.length)}`,
    );
  }
  return { head: heads[0]!, pelvis: pelvises[0]! };
}

function isFiniteVector(value: Vector3): boolean {
  return (
    Number.isFinite(value.x) &&
    Number.isFinite(value.y) &&
    Number.isFinite(value.z)
  );
}

function rounded(value: number): number {
  if (!Number.isFinite(value))
    throw new Error("animal observation contains a non-finite value");
  return Number(value.toFixed(6));
}

function vector(value: Vector3): readonly [number, number, number] {
  return [rounded(value.x), rounded(value.y), rounded(value.z)];
}

let clock = 0;
let forcedSlot = -1;
/** Where each animal stood before this frame when `?roam=0` pins the roster in place. */
const pinnedPositions = new Map<Animal, Vector3>();

renderer.setAnimationLoop(() => {
  clock += 1 / 60;

  if (roamPinned) {
    for (const animal of animals.animals) {
      pinnedPositions.set(animal, animal.object.position.clone());
      // Re-assert every frame: the state machine keeps its clip, the body never leaves home.
      animal.forceState(forcedState ?? "wander", 1);
    }
  }

  // A slow ghost circles the pen; anything inside its bolt radius reacts as it would to you.
  // threatAt pins it so the flee lane can shoot a guaranteed simultaneous bolt.
  const threat = (() => {
    if (staticThreat !== null) {
      const [x, z] = staticThreat.split(",").map(Number);
      return new Vector3(x, 0, z);
    }
    if (threatRadius > 0) {
      return new Vector3(
        Math.sin(clock * 0.45) * threatRadius,
        0,
        Math.cos(clock * 0.45) * threatRadius,
      );
    }
    return null;
  })();
  threatMarker.visible = threat !== null;
  threatMarker.position.set(threat?.x ?? 0, 0.25, threat?.z ?? 0);

  if (forcedState !== null && forcedState !== "flee") {
    const slot = Math.floor(clock / 6);
    if (slot !== forcedSlot) {
      forcedSlot = slot;
      for (const animal of animals.animals) animal.forceState(forcedState, 7);
    }
  }
  animals.update(1 / 60, threat);

  if (roamPinned) {
    for (const [animal, pinned] of pinnedPositions) {
      animal.object.position.copy(pinned);
    }
  }

  // The framed view holds its camera; only the roster view drifts.
  if (framedAnimal === null) {
    camera.position.x = Math.sin(clock * 0.12) * 1.6;
    camera.lookAt(0, 0.8, 0);
  }

  // Bone-length invariance and anatomical forward, sampled at 4 Hz. The first sample lands
  // once at ~0.75 s on the console as TN_BONE_REPORT; the live state sits on
  // window.__TN_BONE_LENGTHS__ for playtests to read.
  const slot = Math.floor(clock * 4);
  if (slot !== lastBoneSample && clock > 0.5) {
    lastBoneSample = slot;
    const reports = animals.animals.map((animal) => boneReport(animal));
    const forwards = animals.animals.map((animal) => forwardProbe(animal));
    (
      globalThis as typeof globalThis & {
        __TN_BONE_LENGTHS__?: { seconds: number; animals: typeof reports; forwards: typeof forwards };
      }
    ).__TN_BONE_LENGTHS__ = { seconds: rounded(clock), animals: reports, forwards };
    if (!boneReportPrinted) {
      boneReportPrinted = true;
      for (const report of reports) {
        console.log(`TN_BONE_REPORT ${JSON.stringify(report)}`);
      }
      for (const probe of forwards) {
        console.log(`TN_FORWARD_PROBE ${JSON.stringify(probe)}`);
      }
    }
  }

  if (Math.floor(clock * 5) !== Math.floor((clock - 1 / 60) * 5)) {
    hud.textContent =
      `wildwood animals — ${forcedState ?? "ai"}\n` +
      animals.animals
        .map(
          (a) =>
            `${a.spec.label.padEnd(6)} ${a.state.padEnd(7)} ${a.clip ?? "?"} roam ${a.roamed.toFixed(1)}m`,
        )
        .join("\n");
  }

  renderer.render(scene, camera);
});

addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
