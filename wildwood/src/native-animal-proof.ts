import {
  boneLengthDeviations,
  defineGame,
  type ICtx,
  Scene,
  type SceneFrame,
} from "@threenative/core";
import { playtest } from "@threenative/core/playtest";
import {
  AmbientLight,
  DirectionalLight,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  SkinnedMesh,
} from "three";
import { spawnWildwoodAnimals, type IWildwoodAnimals } from "./entities/animals/spawnWildwoodAnimals.js";
import type { Animal } from "./entities/animals/Animal.js";

interface IAnimalObservation {
  readonly advancedFrames: number;
  readonly clip: string;
  readonly maxDeviation: number;
  readonly rigid: boolean;
}

interface INativeAnimalState extends Record<string, unknown> {
  readonly animalA: IAnimalObservation;
  readonly animalB: IAnimalObservation;
  readonly ready: boolean;
  readonly skeletonsIndependent: boolean;
}

const initialObservation: IAnimalObservation = {
  advancedFrames: 0,
  clip: "",
  maxDeviation: -1,
  rigid: false,
};

function skeletonOf(animal: Animal): object | undefined {
  let skeleton: object | undefined;
  animal.object.traverse((object) => {
    if (skeleton === undefined && object instanceof SkinnedMesh) skeleton = object.skeleton;
  });
  return skeleton;
}

function observationOf(animal: Animal): IAnimalObservation {
  const deviation = boneLengthDeviations(animal.object, animal.bindBoneLengths);
  return {
    advancedFrames: animal.animation.advancedFrames,
    clip: animal.animation.current ?? "",
    maxDeviation: deviation.maxDeviation,
    rigid: deviation.rigid,
  };
}

class NativeAnimalProof extends Scene<INativeAnimalState> {
  static override readonly initialState: INativeAnimalState = {
    animalA: initialObservation,
    animalB: initialObservation,
    ready: false,
    skeletonsIndependent: false,
  };

  #animals: IWildwoodAnimals | undefined;

  override async load(ctx: ICtx<INativeAnimalState>): Promise<void> {
    this.#animals = await spawnWildwoodAnimals({
      ground: () => 0,
      load: (path) =>
        ctx.assets.model(`fab/2dd7964c-a601-4264-a53d-465dcae1644c/ue/Models/${path}`),
      parent: ctx.scene,
      placements: [
        { id: "fox", x: -2, z: 0 },
        { id: "fox", x: 2, z: 0 },
      ],
      rng: ctx.random,
      water: () => false,
    });
  }

  override enter(ctx: ICtx<INativeAnimalState>): SceneFrame<INativeAnimalState> {
    const animals = this.#animals;
    if (animals === undefined || animals.animals.length !== 2)
      throw new Error("TN_NATIVE_ANIMAL_PROOF_NOT_READY: expected two foxes.");
    const [animalA, animalB] = animals.animals;
    if (animalA === undefined || animalB === undefined)
      throw new Error("TN_NATIVE_ANIMAL_PROOF_NOT_READY: fox instances are missing.");

    ctx.camera.position.set(0, 3, 9);
    ctx.camera.lookAt(0, 0.5, 0);
    ctx.add(new AmbientLight(0xffffff, 1.4));
    const sun = new DirectionalLight(0xffffff, 2.2);
    sun.position.set(3, 6, 4);
    ctx.add(sun);

    const floor = new Mesh(
      new PlaneGeometry(30, 30),
      new MeshStandardMaterial({ color: 0x59744b, roughness: 1 }),
    );
    floor.rotation.x = -Math.PI / 2;
    ctx.add(floor);

    // A starts idle so the native scenario observes a real transition into the migrated clip path
    // rather than accepting a run that was already active at startup.
    // B stays idle, giving the same frame a second independent skeleton and a rigid-pose control.
    animalA.forceState("idle", 30);
    animalB.forceState("idle", 30);
    ctx.entities.add("animal-a", animalA);
    ctx.entities.add("animal-b", animalB);

    const skeletonsIndependent = skeletonOf(animalA) !== skeletonOf(animalB);
    ctx.state.set({
      animalA: observationOf(animalA),
      animalB: observationOf(animalB),
      ready: true,
      skeletonsIndependent,
    });
    ctx.state.flush();

    let ticks = 0;
    return (frameCtx, dt) => {
      ticks += 1;
      if (ticks === 30) {
        animalA.forceState("flee", 30);
      }
      animals.update(dt, null);
      frameCtx.state.set({
        animalA: observationOf(animalA),
        animalB: observationOf(animalB),
        ready: true,
        skeletonsIndependent,
      });
    };
  }
}

const game = defineGame<INativeAnimalState>({
  plugins: [playtest()],
  render: { preferWebGPU: true },
  scenes: { animalProof: NativeAnimalProof },
  start: "animalProof",
});

export default game;
