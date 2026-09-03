import {
  AnimationPlayer,
  boneLengths,
  clipTrackBindings,
  normaliseToMetres,
  type IBoneLengthSnapshot,
} from "@threenative/core";
import { clone as cloneSkeleton } from "three/addons/utils/SkeletonUtils.js";
import {
  BufferGeometry,
  MathUtils,
  Mesh,
  Vector3,
  type AnimationClip,
  type Object3D,
  type Vector3 as IVector3,
  Group,
} from "three";
import type { AnimalClipMap, AnimalSpec } from "./animalSpecs.js";
import { Shore, type WaterTest } from "./shore.js";

export type AnimalState = "idle" | "graze" | "wander" | "flee";

/** Crossfade length in seconds; anything shorter reads as a snap, anything longer as a stumble. */
const FADE = 0.25;
/** How long one flee lasts even if the threat never quite leaves. */
const FLEE_MAX_SECONDS = 5;
/** A fleeing animal stops looking over its shoulder at 1.6x the bolt radius. */
const FLEE_CALM_FACTOR = 1.6;
/** Yaw change per second while steering; high enough to corner, low enough to arc. */
const TURN_RATE = 3.2;
/** Semantics the state machine loops; everything else plays through once at its authored rate. */
const LOOPED: ReadonlySet<string> = new Set(["idle", "idleAlt", "alert", "graze", "walk", "run"]);
/**
 * Seconds between shoreline steering decisions.
 *
 * The whiskers are the expensive part — up to thirteen probed paths, each five terrain samples —
 * and a walking animal covers two centimetres in this long, which the shore margin swallows
 * whole. The hard gate below still runs every frame at five samples, so the cadence loosens the
 * search, never the guarantee.
 */
const STEER_INTERVAL = 1 / 12;
/** Wander targets tried before an animal gives up and just walks somewhere dry. */
const TARGET_TRIES = 12;

/** The clips behind one loaded animal GLB, exactly as the loader handed them over. */
export interface IAnimalModel {
  readonly scene: Object3D;
  readonly animations: readonly AnimationClip[];
}

/** Where the animal meets the world: ground height under a point, in metres. */
export type AnimalGround = (x: number, z: number) => number;

/**
 * One animal of the wood.
 *
 * A plain class, gameplay all the way down: an AI state machine (idle, graze, wander, flee)
 * drives an engine `AnimationPlayer` playing the animal's real clips, over a `SkeletonUtils`
 * clone of the loaded GLB — a plain `.clone(true)` of a skinned model renders as a giant
 * broken copy, so the skeleton-aware clone is not optional. The clone is measured for scale
 * never; the source's bind-pose bounds before cloning are what normalise a six-unit authoring
 * scale down to a 0.7 m fox.
 *
 * The entity owns no terrain and no player: ground height and the threat's position arrive as
 * call arguments, so the same class runs on the valley's analytic heightfield or on a harness's
 * flat plane.
 */
export class Animal {
  readonly spec: AnimalSpec;
  /** The group the AI moves and scales. The skinned clone is its only child. */
  readonly object: Group;

  #player: AnimationPlayer;
  #ground: AnimalGround;
  #rng: () => number;
  #state: AnimalState = "idle";
  #timer: number;
  #heading: number;
  #home: Vector3;
  #target: Vector3 | null = null;
  #speed = 0;
  #homeRadius: number;
  #clips: AnimalLookup;
  /** The shoreline this animal will not cross. */
  #shore: Shore;
  /** Seconds until the next whisker sweep. Staggered per animal so six do not sweep on one frame. */
  #steerIn: number;

  /**
   * Parent→child bone distances at bind, captured after normalisation and before the first clip
   * plays. The baseline the bone-length invariance check (`boneLengthDeviations`) compares every
   * later pose against: a rigid skeleton preserves these distances under any pose, so a
   * deviation names the bone the pose broke.
   */
  readonly bindBoneLengths: IBoneLengthSnapshot;

  constructor(
    spec: AnimalSpec,
    model: IAnimalModel,
    options: {
      readonly ground: AnimalGround;
      readonly spawn: Vector3;
      readonly rng?: () => number;
      /** Radius the animal roams around its spawn, in metres. */
      readonly homeRadius?: number;
      /**
       * Where the water is. Omit and the animal treats the whole world as walkable, which is what
       * it did before there was a lake in it.
       */
      readonly water?: WaterTest;
    },
  ) {
    this.spec = spec;
    this.#ground = options.ground;
    this.#rng = options.rng ?? Math.random;
    this.#homeRadius = options.homeRadius ?? 9;
    this.#clips = new AnimalLookup(model.animations);
    // Half the body length of clearance, and whiskers that reach a second and a half ahead at the
    // gallop — long enough that a stag at twelve metres a second turns while the shore is still
    // several body lengths off. A crow gets the floor, not a hand's breadth.
    this.#shore = new Shore(options.water ?? (() => false), {
      handedness: this.#rng() < 0.5 ? -1 : 1,
      lookahead: Math.max(2.2, spec.runSpeed * 0.45),
      margin: Math.min(1.6, Math.max(0.6, spec.length * 0.5)),
    });
    this.#steerIn = this.#rng() * STEER_INTERVAL;

    const clone = cloneSkeleton(model.scene);
    clone.name = `${spec.id}-rig`;

    // The junk vertices render: skinned triangles outside the animal's real bounds draw as
    // colossal translucent slabs across the valley, because nothing in the skin weights pulls
    // them onto the body. Strip them once, at load — and before measuring, so the measurement
    // sees the animal.
    stripJunkTriangles(clone);

    // A placement is two numbers typed into a scene file; the waterline is where the terrain
    // noise happened to cross zero. When those two disagree the animal starts in the lake, and an
    // animal that starts in the lake has nothing to steer away from — every whisker is wet and it
    // stands there for the rest of the game. Move it to the bank first, and say so.
    const stand = this.#shore.nearestDry(options.spawn.x, options.spawn.z);
    if (stand.x !== options.spawn.x || stand.z !== options.spawn.z) {
      console.info(
        `TN_ANIMALS_SPAWN_MOVED:${spec.id} from=${options.spawn.x.toFixed(1)},${options.spawn.z.toFixed(1)}` +
          ` to=${stand.x.toFixed(1)},${stand.z.toFixed(1)} reason=water`,
      );
    }

    this.object = new Group();
    this.object.name = `animal-${spec.id}`;
    this.object.add(clone);
    this.object.position.set(stand.x, options.ground(stand.x, stand.z), stand.z);

    // Normalise to the spec's real-world length with the engine's own measurement.
    //
    // This used to be a hand-rolled walker that computed `matrixWorld * POSITION`. That is the
    // right formula for a rigid mesh and the WRONG one for a skinned rig: a skinned vertex
    // renders at `sum(w * bone.matrixWorld * boneInverse) * position`, a different space
    // entirely once the rig carries scale — which every quantized import does, because the
    // dequantisation lands in the inverse bind matrices. The walker read every animal as ~1.96
    // units (the width of the quantisation cube) while the fox's skeleton spans 0.33, so the
    // fox was normalised to a third of its size and rendered as an ant.
    //
    // `normaliseToMetres` measures through `Box3.setFromObject`, which asks each mesh where its
    // vertices actually land — skin included. It was installed the whole time.
    const scale = normaliseToMetres(this.object, { axis: "longest", metres: spec.length });
    console.info(`TN_ANIMALS_SCALE:${spec.id} scale=${scale.toFixed(4)}`);

    // Capture the invariance baseline under the same ancestor transform every later comparison
    // reads, and before any clip can write a pose onto the rig.
    this.bindBoneLengths = boneLengths(clone);

    this.#home = this.object.position.clone().setY(0);
    this.#heading = this.#rng() * Math.PI * 2;
    this.#timer = this.#rng() * 3;

    // `strideRoot` is the group the AI actually moves: the mixer writes the clone, so measuring
    // the clone would read the clip's own motion back as if the body had walked.
    this.#player = new AnimationPlayer({
      clips: model.animations,
      root: clone,
      strideRoot: this.object,
    });
    this.#enter("idle");
  }

  get state(): AnimalState {
    return this.#state;
  }

  /** Current clip name, for debug surfaces and playtests. */
  get clip(): string | undefined {
    return this.#player.current;
  }

  /** Metres from the home centre, for the debug HUD. */
  get roamed(): number {
    return Math.hypot(this.object.position.x - this.#home.x, this.object.position.z - this.#home.z);
  }

  /**
   * Drop the animal into a state and hold it there roughly `seconds`, whatever the AI would
   * otherwise decide. The harness and the playtests drive this; gameplay never does.
   */
  forceState(state: AnimalState, seconds = 8): void {
    this.#enter(state);
    this.#timer = seconds;
  }

  /**
   * Advance the AI, the body, and the animation by `dt` seconds.
   *
   * `threat` is the position the animal fears (the player, usually) or null when it should feel
   * safe. Inside `fleeRadius` every state bolts; between the radius and 1.6x it grazes with its
   * head low instead of down.
   */
  update(dt: number, threat: Readonly<IVector3> | null): void {
    const position = this.object.position;
    const threatRange =
      threat === null ? Infinity : Math.hypot(position.x - threat.x, position.z - threat.z);

    if (threat !== null && threatRange < this.spec.fleeRadius && this.#state !== "flee") {
      this.#enter("flee");
    }
    if (this.#state === "flee") {
      // A fleeing animal always runs, threat or not — the bolt outlives whoever startled it.
      this.#speed = this.spec.runSpeed;
      if (threat !== null) {
        // Flee heading is live: a threat that circles is answered by an arc, not a stale vector.
        const away = Math.atan2(position.x - threat.x, position.z - threat.z);
        this.#heading = this.#steer(this.#heading, away, dt, 6);
      }
    }

    this.#timer -= dt;
    switch (this.#state) {
      case "flee":
        if (this.#timer <= 0 || (threat !== null && threatRange > this.spec.fleeRadius * FLEE_CALM_FACTOR)) {
          this.#enter("wander");
        }
        break;
      case "idle":
        if (this.#timer <= 0) this.#enter(this.#rng() < 0.55 ? "graze" : "wander");
        break;
      case "graze":
        if (this.#timer <= 0) this.#enter(this.#rng() < 0.5 ? "idle" : "wander");
        break;
      case "wander": {
        this.#speed = this.spec.walkSpeed;
        if (this.#target !== null) {
          const toTarget = Math.atan2(this.#target.x - position.x, this.#target.z - position.z);
          this.#heading = this.#steer(this.#heading, toTarget, dt);
        }
        const arrived =
          this.#target === null ||
          Math.hypot(this.#target.x - position.x, this.#target.z - position.z) < 0.4;
        if (this.#timer <= 0 || arrived) this.#enter(this.#rng() < 0.5 ? "idle" : "graze");
        break;
      }
    }

    // Layer 2: steer around the water. Runs on its own cadence rather than every frame — the
    // whiskers are the expensive part and the shore margin is metres wide — and it overrides
    // whatever the state machine just decided, because a target on the far bank is still a target
    // and a bolt away from the player is still a bolt.
    const step = this.#speed * dt;
    this.#steerIn -= dt;
    if (step > 0 && this.#steerIn <= 0) {
      this.#steerIn = STEER_INTERVAL;
      this.#heading = this.#shore.steer(
        position.x,
        position.z,
        this.#heading,
        Math.max(this.#shore.lookahead, this.#speed * 0.9),
      );
    }

    // Ground, then move along the heading. Heading lives on the group; the model's own +Z (or
    // its spec's yawOffset correction) is where the nose points.
    //
    // Layer 3: the destination is tested before the body is moved there. With the two layers above
    // working this never fires; it is here so that the frame where they do not still cannot put a
    // hoof in the lake. The animal keeps its animation and turns on the spot — a step refused is
    // not a step frozen.
    if (step > 0) {
      const nextX = position.x + Math.sin(this.#heading) * step;
      const nextZ = position.z + Math.cos(this.#heading) * step;
      if (this.#shore.blocked(nextX, nextZ)) {
        this.#heading += TURN_RATE * dt * this.#shore.handedness;
      } else {
        position.x = nextX;
        position.z = nextZ;
      }
    }
    position.y = this.#ground(position.x, position.z);
    this.object.rotation.y = this.#heading + this.spec.yawOffset;

    this.#player.update(dt);
  }

  /** The clip named by a semantic, played once and forgotten. Death and flinches come here. */
  playOnce(semantic: "attack" | "die" | "hitReact" | "jump"): void {
    const clip = this.#clips.find(this.spec.clips[semantic]);
    if (clip === undefined) return;
    this.#player.play(clip, { mode: "once" });
  }

  /**
   * Per-clip binding audit, one line per semantic the state machine actually plays: a track
   * that binds nothing (`<bone>.undefined`) loads without error and plays the bind pose
   * instead of the animation, which is exactly the failure no console error ever mentions.
   */
  audit(): readonly string[] {
    const lines: string[] = [];
    for (const semantic of ["idle", "alert", "graze", "walk", "run"] as const) {
      const name = this.#clips.find(this.spec.clips[semantic]);
      if (name === undefined) {
        lines.push(`${this.spec.id} ${semantic}: MISSING (${this.spec.clips[semantic]})`);
        continue;
      }
      const report = clipTrackBindings(this.#player.mixer.getRoot() as Object3D, this.#player.clip(name));
      lines.push(
        `${this.spec.id} ${semantic}=${name} bound ${report.bound}/${report.tracks}` +
          (report.unbound.length > 0 ? ` UNBOUND: ${report.unbound.map((t) => t.track).join(", ")}` : ""),
      );
    }
    return lines;
  }

  dispose(): void {
    this.#player.dispose();
  }

  #enter(state: AnimalState): void {
    this.#state = state;
    this.#target = null;
    this.#speed = 0;
    const seconds = (low: number, high: number): number => low + this.#rng() * (high - low);

    switch (state) {
      case "idle":
        this.#timer = seconds(2, 6);
        this.#play(this.#rng() < 0.3 ? "idleAlt" : "idle");
        break;
      case "graze":
        this.#timer = seconds(4, 10);
        this.#play("graze");
        break;
      case "wander": {
        this.#timer = seconds(4, 9);
        this.#target = this.#walkableTarget();
        this.#play("walk");
        break;
      }
      case "flee":
        this.#timer = FLEE_MAX_SECONDS;
        this.#play("run");
        break;
    }
  }

  /**
   * Somewhere inside the home range worth walking to — dry, and reachable over dry ground.
   *
   * Layer 1 of the shoreline rules. Rejecting only the *destination* is not enough: an animal
   * whose home straddles the pond would keep choosing the far bank, and then spend the entire
   * walk pressed against the water with the whiskers turning it aside every frame. The straight
   * line has to be walkable too, which for a wander this short is the same thing as a path.
   *
   * When nothing is found — an animal boxed onto a spit — it wanders with no target at all, which
   * the update loop already handles: it keeps its heading and the whiskers keep it dry.
   */
  #walkableTarget(): Vector3 | null {
    const position = this.object.position;
    for (let attempt = 0; attempt < TARGET_TRIES; attempt += 1) {
      const angle = this.#rng() * Math.PI * 2;
      const radius = Math.sqrt(this.#rng()) * this.#homeRadius;
      // Reel the target back inside the home square so a flee that left home is followed by a
      // stroll home rather than an animal that never comes back.
      const x = MathUtils.clamp(
        this.#home.x + Math.sin(angle) * radius,
        this.#home.x - this.#homeRadius,
        this.#home.x + this.#homeRadius,
      );
      const z = MathUtils.clamp(
        this.#home.z + Math.cos(angle) * radius,
        this.#home.z - this.#homeRadius,
        this.#home.z + this.#homeRadius,
      );
      if (this.#shore.clearBetween(position.x, position.z, x, z)) return new Vector3(x, 0, z);
    }
    return null;
  }

  #play(semantic: keyof AnimalClipMap): void {
    const clip = this.#clips.find(this.spec.clips[semantic]);
    if (clip === undefined) return;
    this.#player.play(clip, { fade: FADE, mode: LOOPED.has(semantic) ? "loop" : "once" });
  }

  /** Turn `from` toward `to` the short way round, capped at the turn rate. */
  #steer(from: number, to: number, dt: number, rate: number = TURN_RATE): number {
    let delta = to - from;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    const max = rate * dt;
    return from + MathUtils.clamp(delta, -max, max);
  }
}

/** Resolves a spec's clip name against a GLB's clip list, tolerating `Armature|` prefixes. */
class AnimalLookup {
  readonly #byName: Map<string, AnimationClip>;

  constructor(clips: readonly AnimationClip[]) {
    this.#byName = new Map(clips.map((clip) => [clip.name, clip]));
  }

  /** The exact name, else the same name under any `Something|` armature prefix. */
  find(name: string): string | undefined {
    if (this.#byName.has(name)) return name;
    for (const [candidate] of this.#byName) {
      if (candidate.endsWith(`|${name}`)) return candidate;
    }
    return undefined;
  }
}

/**
 * Remove every triangle with fewer than two vertices inside the 1st-99th-percentile box,
 * measured **in bind space**, which is the space this filter is self-consistent in: the box
 * and the vertices tested against it are built the same way, so outliers fall out regardless of
 * where the skin ultimately renders. Sizing is `normaliseToMetres`'s job, not this one's.
 *
 * The Quaternius GLBs carry a handful of junk triangles far outside the body (the fox reaches
 * ±100 units on Z while the animal occupies the middle fifth). Skinned, their weights point at
 * bones that never influence them, so they render as enormous translucent slabs hanging over
 * whichever clearing the animal spawns in — the geometry equivalent of the outlier that also
 * once broke the sizing too. A triangle with even one vertex inside the box survives: junk that
 * close to the body is body.
 */
function stripJunkTriangles(root: Object3D): void {
  root.updateMatrixWorld(true);
  const boxLow = [Infinity, Infinity, Infinity];
  const boxHigh = [-Infinity, -Infinity, -Infinity];
  const axisSamples: number[][] = [[], [], []];
  root.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    const position = object.geometry.getAttribute("position");
    const matrix = object.matrixWorld.elements;
    for (let index = 0; index < position.count; index += 1) {
      const x = position.getX(index);
      const y = position.getY(index);
      const z = position.getZ(index);
      const vertex = [
        matrix[0]! * x + matrix[4]! * y + matrix[8]! * z + matrix[12]!,
        matrix[1]! * x + matrix[5]! * y + matrix[9]! * z + matrix[13]!,
        matrix[2]! * x + matrix[6]! * y + matrix[10]! * z + matrix[14]!,
      ];
      for (let axis = 0; axis < 3; axis += 1) (axisSamples[axis] ?? []).push(vertex[axis] ?? 0);
    }
  });
  for (let axis = 0; axis < 3; axis += 1) {
    const values = [...(axisSamples[axis] ?? [])].sort((a, b) => a - b);
    boxLow[axis] = values[Math.floor(values.length * 0.01)] ?? -Infinity;
    boxHigh[axis] = values[Math.floor(values.length * 0.99)] ?? Infinity;
  }
  const [lowX = -Infinity, lowY = -Infinity, lowZ = -Infinity] = boxLow;
  const [highX = Infinity, highY = Infinity, highZ = Infinity] = boxHigh;
  const inside = (x: number, y: number, z: number): boolean =>
    x >= lowX && x <= highX && y >= lowY && y <= highY && z >= lowZ && z <= highZ;
  root.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    const geometry = object.geometry;
    const position = geometry.getAttribute("position");
    const index = geometry.getIndex();
    if (index === null) return;
    const matrix = object.matrixWorld.elements;
    const world = (vertex: number): [number, number, number] => {
      const x = position.getX(vertex);
      const y = position.getY(vertex);
      const z = position.getZ(vertex);
      return [
        matrix[0]! * x + matrix[4]! * y + matrix[8]! * z + matrix[12]!,
        matrix[1]! * x + matrix[5]! * y + matrix[9]! * z + matrix[13]!,
        matrix[2]! * x + matrix[6]! * y + matrix[10]! * z + matrix[14]!,
      ];
    };
    // Group-aware: a multi-primitive mesh (one per material) carries `groups` as (start, count)
    // slices of ONE index. Filtering the whole index in one pass and keeping the old groups
    // would hand the surviving triangles the wrong material — so filter per group and rebuild
    // the group list against the new index lengths.
    const groups = geometry.groups.length > 0 ? geometry.groups : [{ start: 0, count: index.count, materialIndex: 0 }];
    const keep: number[] = [];
    const newGroups: typeof geometry.groups = [];
    for (const group of groups) {
      const start = keep.length;
      for (let triangle = group.start; triangle < group.start + group.count; triangle += 3) {
        const a = index.getX(triangle);
        const b = index.getX(triangle + 1);
        const c = index.getX(triangle + 2);
        // Majority vote, not any-vertex: a triangle with one vertex on the body and two out at
        // ±100 units still spans the whole sky. Fewer than two inside reads as junk.
        const votes =
          (inside(...world(a)) ? 1 : 0) +
          (inside(...world(b)) ? 1 : 0) +
          (inside(...world(c)) ? 1 : 0);
        if (votes >= 2) keep.push(a, b, c);
      }
      const count = keep.length - start;
      if (count > 0) newGroups.push({ start, count, materialIndex: group.materialIndex });
    }
    if (keep.length === index.count) return;
    if (newGroups.length === 0) return;
    geometry.setIndex(keep);
    geometry.groups = newGroups;
  });
}