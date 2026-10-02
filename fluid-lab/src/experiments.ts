import {
  FluidParticles3D,
  type ICtx,
  type IFluidCollider,
  type IFluidParticlesOptions,
  RippleField,
} from "@threenative/core";
import {
  Buoyancy3D,
  CollisionShape3D,
  type IPhysicsContext,
  RigidBody3D,
} from "@threenative/physics";
import {
  BoxGeometry,
  Mesh,
  MeshBasicMaterial,
  type Object3D,
  PlaneGeometry,
  SphereGeometry,
} from "three";
import { cross, dFdx, dFdy, dot, mix, normalize, positionWorld, pow, reflect, vec3 } from "three/tsl";
import { MeshBasicNodeMaterial } from "three/webgpu";
import { createSpray } from "./render/spray.js";
import { createStage } from "./render/stage.js";
import { createWaterVolume } from "./render/water-volume.js";
import type { GameState } from "./state.js";

export type GameCtx = ICtx<GameState, IPhysicsContext>;

export interface IQuality {
  readonly spacing: number;
  readonly capacity: number;
}

/** Particle spacing sets the count: the same tank holds ~1,000 / ~2,200 / ~4,900 particles. */
export const QUALITIES: readonly IQuality[] = [
  { spacing: 0.3, capacity: 1500 },
  { spacing: 0.22, capacity: 3400 },
  { spacing: 0.17, capacity: 6000 },
];

export interface IRun {
  readonly water?: FluidParticles3D;
  readonly ripple?: RippleField;
  /** The experiment's own action (key Space). */
  act(): void;
  /** Its mode switch (key V), where it has one. */
  toggle(): void;
  bodyCount(): number;
  dispose(): void;
}

export interface IEnv {
  readonly ctx: GameCtx;
  readonly quality: IQuality;
  readonly restart: () => void;
}

export interface IExperiment {
  readonly name: string;
  readonly action: string;
  readonly start: (env: IEnv) => IRun;
}

const TANK_TOP = 4.65;
const WATER_DENSITY = 1000;
const MAX_BODIES = 6;

type Vec3 = [number, number, number];

interface IBodySpec {
  readonly shape: "sphere" | "box";
  readonly density: number;
  readonly half: Vec3;
  readonly at: Vec3;
  readonly color: number;
}

interface ITankSpec {
  readonly statics?: IFluidCollider[];
  readonly water?: Partial<IFluidParticlesOptions>;
  /** Called once per fixed step with the step index. */
  readonly onStep?: (water: FluidParticles3D, step: number) => void;
  readonly camera?: readonly [Vec3, Vec3];
}

interface IBody {
  readonly spec: IBodySpec;
  readonly mesh: Mesh;
  readonly body: RigidBody3D;
  readonly buoyancy: Buoyancy3D;
}

function tankBounds(quality: IQuality) {
  const radius = quality.spacing * 0.44;
  return { min: [-2.9, radius, -1.6], max: [2.9, TANK_TOP, 1.6] } as const;
}

/**
 * The shared tank: a solver, the rigid bodies that float or sink in it, a fixed floor, and the
 * game's own look (raymarched volume, checker floor). Returns the pieces an experiment drives.
 */
function tank(env: IEnv, spec: ITankSpec = {}) {
  const { ctx, quality } = env;
  const bounds = tankBounds(quality);
  const water = new FluidParticles3D({
    bounds: { min: [...bounds.min], max: [...bounds.max] },
    capacity: quality.capacity,
    maxColliders: 8,
    readbackEvery: 1,
    spacing: quality.spacing,
    ...spec.water,
  });
  ctx.add(water);
  const objects: Object3D[] = [water];
  const stage = ctx.add(createStage(bounds));
  const volume = ctx.add(createWaterVolume(water));
  const spray = ctx.add(createSpray(water));
  objects.push(stage, volume, spray);
  const [eye, target] = spec.camera ?? [
    [0, 2.4, 8.2],
    [0, 1.9, 0],
  ];
  ctx.camera.position.set(...eye);
  ctx.camera.lookAt(...target);

  // Held for the experiment's life: a fixed body the script drops would be freed with it.
  const floor = new RigidBody3D({
    physics: ctx.physics,
    position: { x: 0, y: -1, z: 0 },
    shape: CollisionShape3D.box(8, 2, 5),
    type: "fixed",
  });
  const statics = spec.statics ?? [];
  const bodies: IBody[] = [];
  // Static colliders are drawn from the same list the solver reads, so what you see is what the
  // water flows around; the dam gate leaves the list and so leaves the screen.
  const staticMeshes = new Map<IFluidCollider, Mesh>();
  const syncStatics = (): void => {
    for (const [collider, mesh] of staticMeshes)
      if (!statics.includes(collider)) {
        ctx.scene.remove(mesh);
        staticMeshes.delete(collider);
      }
    for (const collider of statics) {
      if (staticMeshes.has(collider) || collider.kind !== "box") continue;
      const [hx, hy, hz] = collider.halfExtents;
      const mesh = new Mesh(
        new BoxGeometry(hx * 2, hy * 2, hz * 2),
        new MeshBasicMaterial({ color: 0x6b7a8c }),
      );
      mesh.position.set(...collider.center);
      if (collider.rotation !== undefined) mesh.quaternion.set(...collider.rotation);
      ctx.add(mesh);
      staticMeshes.set(collider, mesh);
    }
  };
  syncStatics();

  const addBody = (bodySpec: IBodySpec): IBody => {
    const [hx, hy, hz] = bodySpec.half;
    const isSphere = bodySpec.shape === "sphere";
    const mesh = new Mesh(
      isSphere ? new SphereGeometry(hx, 20, 14) : new BoxGeometry(hx * 2, hy * 2, hz * 2),
      new MeshBasicMaterial({ color: bodySpec.color }),
    );
    mesh.position.set(...bodySpec.at);
    ctx.add(mesh);
    const volumeOfBody = isSphere ? (4 / 3) * Math.PI * hx ** 3 : 8 * hx * hy * hz;
    const body = new RigidBody3D({
      mass: bodySpec.density * volumeOfBody,
      object: mesh,
      physics: ctx.physics,
      shape: isSphere ? CollisionShape3D.sphere(hx) : CollisionShape3D.box(hx * 2, hy * 2, hz * 2),
    });
    // One point at the centre: heave only. Off-centre points feed splash noise into torque, and
    // Rapier's angular damping is not on the body options.
    const buoyancy = new Buoyancy3D({
      body,
      density: WATER_DENSITY,
      drag: isSphere ? 800 : 2500,
      hullPoints: [{ position: [0, 0, 0] }],
      pointSpacing: hy * 2,
      surface: water,
      volume: volumeOfBody,
    });
    const entry = { body, buoyancy, mesh, spec: bodySpec };
    bodies.push(entry);
    while (bodies.length > MAX_BODIES) disposeBody(bodies.shift() as IBody);
    return entry;
  };
  const disposeBody = (entry: IBody): void => {
    entry.buoyancy.dispose();
    entry.body.dispose();
    ctx.scene.remove(entry.mesh);
  };

  const unsubscribe = ctx.afterPhysics(() => {
    spec.onStep?.(water, water.steps);
    syncStatics();
    water.setColliders([
      ...statics,
      ...bodies.map(({ mesh, spec: s }): IFluidCollider => {
        const center = mesh.position.toArray() as Vec3;
        return s.shape === "sphere"
          ? { kind: "sphere", center, radius: s.half[0] }
          : {
              kind: "box",
              center,
              halfExtents: s.half,
              rotation: mesh.quaternion.toArray() as [number, number, number, number],
            };
      }),
    ]);
  });

  const dispose = (): void => {
    unsubscribe();
    for (const entry of bodies) disposeBody(entry);
    bodies.length = 0;
    for (const object of objects) ctx.scene.remove(object);
    for (const mesh of staticMeshes.values()) ctx.scene.remove(mesh);
    void floor;
  };
  return { addBody, bodies, dispose, statics, water };
}

function run(
  parts: ReturnType<typeof tank>,
  act: () => void,
  toggle: () => void = () => undefined,
): IRun {
  return {
    act,
    bodyCount: () => parts.bodies.length,
    dispose: parts.dispose,
    toggle,
    water: parts.water,
  };
}

const POOL: [Vec3, Vec3] = [
  [-2.8, 0.1, -1.5],
  [2.8, 1.3, 1.5],
];

function sphereBody(at: Vec3): IBodySpec {
  return { at, color: 0xf2a65a, density: 1900, half: [0.3, 0.3, 0.3], shape: "sphere" };
}

function boxBody(at: Vec3, density: number): IBodySpec {
  const half = density < 400 ? 0.25 : 0.4;
  return { at, color: 0xe8e0c8, density, half: [half, half, half], shape: "box" };
}

const dam: IExperiment = {
  action: "Release again",
  name: "Dam break",
  start: (env) => {
    const gate: IFluidCollider = {
      kind: "box",
      center: [-0.9, 2.4, 0],
      halfExtents: [0.05, 2.4, 1.6],
    };
    const statics = [gate];
    const parts = tank(env, {
      // The gate comes out at 0.8 s.
      onStep: (_water, step) => {
        if (step === 48) statics.length = 0;
      },
      statics,
    });
    parts.water.fill([-2.8, 0.1, -1.5], [-1.0, 2.8, 1.5]);
    return run(parts, env.restart);
  },
};

const splash: IExperiment = {
  action: "Drop sphere",
  name: "Splash tank",
  start: (env) => {
    const parts = tank(env);
    parts.water.fill(...POOL);
    let drops = 0;
    return run(parts, () => {
      parts.addBody(sphereBody([((drops % 5) - 2) * 0.7, 4.2, ((drops * 3) % 5) * 0.15 - 0.3]));
      drops += 1;
    });
  },
};

const BLOCK_DENSITIES = [550, 1200, 300, 800, 2500];

const buoyancy: IExperiment = {
  action: "Add floating block",
  name: "Buoyancy",
  start: (env) => {
    const parts = tank(env);
    parts.water.fill(...POOL);
    let added = 0;
    const addBlock = (): void => {
      const density = BLOCK_DENSITIES[added % BLOCK_DENSITIES.length] as number;
      parts.addBody(boxBody([(((added * 2) % 5) - 2) * 0.8, 4.2, ((added * 3) % 4) * 0.4 - 0.6], density));
      added += 1;
    };
    addBlock();
    addBlock();
    return run(parts, addBlock);
  },
};

const waterfall: IExperiment = {
  action: "Pulse the source",
  name: "Waterfall",
  start: (env) => {
    const ledge: IFluidCollider = {
      kind: "box",
      center: [-2.0, 1.9, 0],
      halfExtents: [0.85, 0.1, 1.6],
    };
    let burst = 0;
    const parts = tank(env, {
      onStep: (water, step) => {
        const rate = burst > 0 ? 10 : 6;
        for (let i = 0; i < rate; i += 1)
          water.emit(
            [-2.55, 2.25, (((step * 7 + i * 5) % 11) / 10 - 0.5) * 2.6],
            [2.0 + (i % 3) * 0.2, 0, 0],
          );
        if (burst > 0) burst -= 1;
      },
      statics: [ledge],
    });
    parts.water.fill([-0.9, 0.1, -1.5], [2.8, 0.8, 1.5]);
    return run(parts, () => {
      burst = 40;
    });
  },
};

const fountain: IExperiment = {
  action: "Boost jet",
  name: "Fountain",
  start: (env) => {
    let boost = 0;
    const parts = tank(env, {
      onStep: (water, step) => {
        const lift = boost > 0 ? 8.6 : 6.5;
        for (let i = 0; i < 3; i += 1)
          water.emit(
            [0, 0.9, 0],
            [(((step + i * 5) % 7) / 6 - 0.5) * 1.1, lift, (((step * 3 + i) % 7) / 6 - 0.5) * 1.1],
          );
        if (boost > 0) boost -= 1;
      },
    });
    parts.water.fill([-2.8, 0.1, -1.5], [2.8, 0.55, 1.5]);
    return run(parts, () => {
      boost = 90;
    });
  },
};

const whirlpool: IExperiment = {
  action: "Stir the vortex",
  name: "Whirlpool",
  start: (env) => {
    const parts = tank(env, {
      water: {
        // A tangential body force about the vertical axis, strongest near the centre: the
        // circulation a drain would feed on. Vorticity confinement keeps the rotation alive.
        force: (position) => {
          const radius = dot(vec3(position.x, 0, position.z), vec3(position.x, 0, position.z)).sqrt();
          const tangent = vec3(position.z.negate(), 0, position.x).div(radius.add(0.6));
          return tangent.mul(3.5);
        },
        vorticity: 0.01,
      },
    });
    parts.water.fill([-2.8, 0.1, -1.5], [2.8, 1.0, 1.5]);
    return run(parts, () => {
      parts.water.stir([0, 0.5, 0], 4, 1.1);
    });
  },
};

const viscosity: IExperiment = {
  action: "Pour again",
  name: "Viscosity",
  start: (env) => {
    const slope = (-22 * Math.PI) / 180;
    const ramp: IFluidCollider = {
      kind: "box",
      center: [-0.2, 1.4, 0],
      halfExtents: [2.2, 0.08, 1.6],
      rotation: [0, 0, Math.sin(slope / 2), Math.cos(slope / 2)],
    };
    let pour = 120;
    const parts = tank(env, {
      onStep: (water, step) => {
        if (pour <= 0) return;
        pour -= 1;
        for (let i = 0; i < 4; i += 1)
          water.emit([-2.6, 3.2, (((step + i * 3) % 9) / 8 - 0.5) * 1.6], [0.5, -1, 0]);
      },
      statics: [ramp],
    });
    parts.water.fill([-2.8, 2.6, -0.8], [-2.0, 3.4, 0.8]);
    const syrup = (on: boolean): void => {
      parts.water.viscosity = on ? 0.9 : 0.008;
      parts.water.cohesion = on ? 0.6 : 0.03;
    };
    let thick = false;
    return run(
      parts,
      () => {
        pour = 120;
      },
      () => {
        thick = !thick;
        syrup(thick);
      },
    );
  },
};

const ocean: IExperiment = {
  action: "Send a wave",
  name: "Ocean & rain",
  start: (env) => {
    const { ctx } = env;
    const ripple = new RippleField({ damping: 0.12, resolution: 128, size: 14, speed: 3 });
    const size = 14;
    const segments = 127;
    const surface = new Mesh(
      new PlaneGeometry(size, size, segments, segments).rotateX(-Math.PI / 2),
      oceanMaterial(),
    );
    surface.frustumCulled = false;
    ctx.add(surface);
    // Beyond the simulated patch the sea is flat, in the same material.
    const horizon = new Mesh(new PlaneGeometry(240, 240).rotateX(-Math.PI / 2), surface.material);
    horizon.position.y = -0.01;
    ctx.add(horizon);
    ctx.camera.position.set(0, 4.5, 9);
    ctx.camera.lookAt(0, 0, 0);

    const raft = new Mesh(
      new BoxGeometry(2, 0.3, 1.4),
      new MeshBasicMaterial({ color: 0xc89a5a }),
    );
    raft.position.set(1, 0.3, 0);
    ctx.add(raft);
    const raftBody = new RigidBody3D({
      mass: 480 * 2 * 0.3 * 1.4,
      object: raft,
      physics: ctx.physics,
      shape: CollisionShape3D.box(2, 0.3, 1.4),
    });
    const raftBuoyancy = new Buoyancy3D({
      body: raftBody,
      density: WATER_DENSITY,
      drag: 1500,
      hullPoints: [{ position: [0, 0, 0] }],
      pointSpacing: 0.3,
      surface: { sample: (x, z) => ({ height: ripple.heightAt(x, z) }) },
      volume: 2 * 0.3 * 1.4,
    });

    const position = surface.geometry.getAttribute("position");
    let seed = 7;
    const rand = (): number => {
      seed = (Math.imul(1_664_525, seed) + 1_013_904_223) >>> 0;
      return seed / 4_294_967_296;
    };
    const unsubscribe = ctx.afterPhysics((dt) => {
      // Rain: a few small impacts per step.
      for (let i = 0; i < 3; i += 1)
        ripple.impulse((rand() - 0.5) * 12, (rand() - 0.5) * 12, 0.3, 0.12);
      ripple.advance(dt);
      for (let i = 0; i < position.count; i += 1)
        position.setY(i, ripple.heightAt(position.getX(i), position.getZ(i)));
      position.needsUpdate = true;
    });
    return {
      act: () => {
        ripple.impulse(-5, 0, 1.0, 0.6);
      },
      bodyCount: () => 1,
      dispose: () => {
        unsubscribe();
        raftBuoyancy.dispose();
        raftBody.dispose();
        ctx.scene.remove(surface);
        ctx.scene.remove(horizon);
        ctx.scene.remove(raft);
      },
      ripple,
      toggle: () => undefined,
    };
  },
};

/** Water from the surface's screen-space derivative: no normals to rebuild per frame. */
function oceanMaterial(): MeshBasicNodeMaterial {
  const material = new MeshBasicNodeMaterial();
  const view = normalize(positionWorld.sub(vec3(0, 4.5, 9)));
  const normal = normalize(cross(dFdx(positionWorld), dFdy(positionWorld)));
  const mirror = reflect(view, normal);
  const facing = dot(normal, view.negate()).max(0);
  const fresnel = pow(facing.oneMinus(), 3).mul(0.9).add(0.04);
  const sky = mix(vec3(0.5, 0.68, 0.85), vec3(0.1, 0.2, 0.4), mirror.y.max(0));
  const deep = mix(vec3(0.01, 0.12, 0.22), vec3(0.06, 0.4, 0.5), facing);
  const sun = pow(dot(mirror, normalize(vec3(0.4, 0.5, -0.6))).max(0), 60).mul(1.5);
  material.colorNode = mix(deep, sky, fresnel).add(sun);
  material.toneMapped = false;
  return material;
}

export const EXPERIMENTS: readonly IExperiment[] = [
  dam,
  splash,
  buoyancy,
  waterfall,
  fountain,
  whirlpool,
  viscosity,
  ocean,
];

