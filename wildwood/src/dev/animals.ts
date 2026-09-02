/**
 * The animals harness: a flat lit ground, the full roster, and their real animations.
 *
 * This is a dev entry (`/dev-animals.html`), not the game — it exists so a screenshot can
 * prove the animals render, animate, and bind their clips, without booting the valley. The
 * GLB paths are the same ones the valley loads; the loader here is a plain GLTFLoader with
 * the meshopt decoder wired, standing in for `ctx.assets.model`.
 */
import type { Animal, AnimalState } from "../entities/animals/Animal.js";
import { spawnWildwoodAnimals } from "../entities/animals/spawnWildwoodAnimals.js";
import { createAssetLoader, createRandom } from "@threenative/core";
import { assertJsonSafe } from "@threenative/playtest";
import { LAKE, POND, heightAt } from "../render/terrain.js";
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
  Vector3,
} from "three";
import { WebGPURenderer } from "three/webgpu";

const params = new URLSearchParams(location.search);
const OBSERVATION_VERSION = 1;
const OBSERVATION_SEED = 90210;
const FIXED_STEP_SECONDS = 1 / 60;
const SIMULATION_SECONDS = 180;
const SIMULATION_STEPS = SIMULATION_SECONDS / FIXED_STEP_SECONDS;
const ANIMAL_LISTING = "2dd7964c-a601-4264-a53d-465dcae1644c";
// createPond() passes this exact radius to createWater(); POND.radius is only the terrain basin.
const POND_WATER_RADIUS = POND.radius * 1.7;
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
/** Radius a circling threat walks at; 0 disables the threat entirely. */
const threatRadius = Number(params.get("threat") ?? 14);
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
const animals = await spawnWildwoodAnimals({
  // The installed loader resolves the same logical manifest entries Valley passes to ctx.assets.
  load: (path) => assets.model(`fab/${ANIMAL_LISTING}/ue/Models/${path}`),
  ground: heightAt,
  parent: scene,
  placements: PRODUCTION_PLACEMENTS,
  rng,
  log: (line) => console.log(line),
});
for (const animal of animals.animals) {
  animal.object.traverse((object) => {
    if ((object as Mesh).isMesh === true) object.castShadow = true;
  });
}

const observation = measureProductionSubjects(animals.animals);
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

// The observation uses production placements. Once frozen, restore the visual roster's close
// lineup so its headed WebGPU screenshot still shows the six measured subjects at useful scale.
for (const [index, animal] of animals.animals.entries()) {
  animal.object.position.set(
    (index - (animals.animals.length - 1) / 2) * 3.2,
    0,
    0,
  );
}
console.log("TN_ANIMALS_READY");

function measureProductionSubjects(subjects: readonly Animal[]) {
  if (subjects.length !== PRODUCTION_PLACEMENTS.length) {
    throw new Error(
      `animal observation requires six production subjects; got ${String(subjects.length)}`,
    );
  }
  const samples = new Map(
    subjects.map((animal) => [
      animal.spec.id,
      {
        start: animal.object.position.clone(),
        previous: animal.object.position.clone(),
        distanceTravelled: 0,
        dots: [] as number[],
        lakeSamples: 0,
        pondSamples: 0,
        totalSamples: 0,
      },
    ]),
  );
  const movement = new Vector3();
  const renderedForward = new Vector3();

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
      const distance = movement.length();
      if (distance > 1e-8) {
        sample.distanceTravelled += distance;
        const rig = animal.object.children[0];
        if (rig === undefined)
          throw new Error(`animal observation rig missing: ${animal.spec.id}`);
        animal.object.updateWorldMatrix(true, true);
        rig.getWorldDirection(renderedForward).setY(0);
        if (renderedForward.lengthSq() <= 1e-12) {
          throw new Error(
            `animal observation model-forward is zero: ${animal.spec.id}`,
          );
        }
        sample.dots.push(movement.normalize().dot(renderedForward.normalize()));
      }
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
      },
    };
  });
  if (rows.some((row) => row.displacementMeters <= 0)) {
    throw new Error(
      "animal observation requires measured displacement for every production subject",
    );
  }
  return {
    version: OBSERVATION_VERSION,
    status: "ready" as const,
    seed: OBSERVATION_SEED,
    fixedStepSeconds: FIXED_STEP_SECONDS,
    simulationSeconds: SIMULATION_SECONDS,
    simulationSteps: SIMULATION_STEPS,
    waterFootprints: {
      lake: { x: LAKE.x, z: LAKE.z, radius: LAKE.radius },
      pond: { x: POND.x, z: POND.z, radius: POND_WATER_RADIUS },
    },
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
    },
  };
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

renderer.setAnimationLoop(() => {
  clock += 1 / 60;

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

  camera.position.x = Math.sin(clock * 0.12) * 1.6;
  camera.lookAt(0, 0.8, 0);

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
