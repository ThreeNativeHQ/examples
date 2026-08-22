import { AnimationPlayer, type ICtx } from "@threenative/core";
import { CharacterBody3D, CollisionShape3D, type IPhysicsContext } from "@threenative/physics";
import { measureThreePose } from "@threenative/playtest/three";
import {
  type AnimationClip,
  AnimationMixer,
  Box3,
  BoxGeometry,
  Group,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  type Object3D,
  Quaternion,
  Vector3,
} from "three";
import type { TownCollider } from "../render/town.js";
import { normaliseHeight, normaliseLongestAxis, scale } from "../render/scale.js";
import type { GameState } from "../state.js";

type GameCtx = ICtx<GameState, IPhysicsContext>;

/** One solid box in the world: nav, grounding and hit tests all read these. */
export type BoxCollider = TownCollider;

export type EnemyPhase = "patrol" | "suspicious" | "engage" | "search" | "return" | "dead";

const MAX_HEALTH = 36;
const WALK_SPEED = 2.4;
const CHASE_SPEED = 3.6;
const HEAR_RANGE = 26;
const VIEW_RANGE = 30;
const VIEW_HALF_ANGLE = MathUtils.degToRad(46);
const ENGAGE_RANGE = 13;
const BURST_ROUNDS = 3;
const BURST_SPACING = 0.11;
const BURST_COOLDOWN = 3.2;
const ROUND_DAMAGE = 9;
const RESPAWN_SECONDS = 4.5;
const AGENT_RADIUS = 0.48;
const NAV_CELL = 0.7;
const NAV_MIN = -16;
const NAV_MAX = 16;
const NAV_REPLAN_SECONDS = 0.4;
/** Seconds between first sighting and the first round, so the player is not shot on sight. */
const REACTION_SECONDS = 0.45;
const SPAWN_GRACE_SECONDS = 2.5;
/**
 * Animation blending, tuned by eye rather than by what typechecks.
 *
 * `LOCOMOTION_FADE` at 0.05 s is three frames, which pops; a quarter second reads as weight
 * shifting between feet. `LOCOMOTION_HOLD` stops the rig re-deciding every frame when crouch
 * state sits on a threshold, and `STILL_BEFORE_IDLE` stops one blocked step reading as a stop.
 */
const LOCOMOTION_FADE = 0.26;
const LOCOMOTION_HOLD_SECONDS = 0.3;
const STILL_BEFORE_IDLE_SECONDS = 0.16;
/**
 * Locomotion playback rate, in clip-seconds per world-second.
 *
 * The walk clip carries the body 1.7 m per 1.30 s cycle; patrol speed is 2.4 m/s and a chase
 * is 3.6 m/s, so at rate 1 the feet travel at half or a third of the ground speed and skate.
 * The rate is therefore derived from the measured stride (`#measureClipGroundSpeed`) and the
 * speed the body is actually making. The clamp is the honest limit of a nine-clip rig with no
 * run cycle: above it a sprint would read as a cartoon, below it a crawl would freeze.
 */
const LOCOMOTION_RATE_MIN = 0.35;
const LOCOMOTION_RATE_MAX = 3;
/** Ground speed below which the rate is meaningless and the stride metric is not scored. */
const LOCOMOTION_RATE_FLOOR = 0.3;
/** Frames used to sample one clip cycle when measuring its stride. */
const STRIDE_SAMPLES = 96;
/**
 * Seconds between precise corpse ground measurements. The precise pass is the per-vertex
 * `Box3` the skin envelope exists to avoid, so a corpse pays it at 20 Hz rather than 60 —
 * invisible on a body that is settling, and a fifth of the cost.
 */
const CORPSE_GROUND_INTERVAL = 0.05;
/** Reactions and deaths are sharp events, but three frames is still a pop. */
const REACTION_FADE = 0.12;
const DEATH_FADE = 0.14;
const FIRE_FADE = 0.1;
const ROUTE: readonly Vector3[] = [
  new Vector3(-4.5, 0, -9.5),
  new Vector3(-11.5, 0, -13.0),
  new Vector3(-1.0, 0, -15.0),
  new Vector3(4.5, 0, -11.0),
  new Vector3(11.6, 0, -8.6),
  new Vector3(1.5, 0, -6.5),
  new Vector3(-6.0, 0, -4.5),
];
const ROUTE_START = ROUTE[0] ?? new Vector3();

type WeaponPose = {
  readonly position: readonly [number, number, number];
  readonly rotation: readonly [number, number, number];
  readonly scale: readonly [number, number, number];
};

type WeaponKeyframe = { readonly time: number; readonly transform: WeaponPose };
type WeaponTrack = {
  readonly attachment: "attached" | "detached";
  readonly keyframes: readonly WeaponKeyframe[];
};
type WeaponRecipe = {
  readonly animations: Record<string, WeaponKeyframe | WeaponTrack>;
  readonly version: 2 | 3;
};
const weaponPose = (
  position: readonly [number, number, number],
  rotation: readonly [number, number, number],
  attachment: "attached" | "detached" = "attached",
): WeaponTrack => ({
  attachment,
  keyframes: [{ time: 0, transform: { position, rotation, scale: [1, 1, 1] } }],
});
const ENEMY_AK47_RECIPE: WeaponRecipe = {
  version: 3,
  animations: {
    RifleIdle: weaponPose([188.2202, 439.6458, 144.7051], [-111.181, -29.47, -46.122]),
    RifleWalk: weaponPose([-11.9183, 294.5358, 104.4656], [-90, 0, -90]),
    RifleCrouchWalk: weaponPose([-23.3305, 274.7849, 53.6152], [-106.891, -21.763, -115.469]),
    RifleCrouchWalkToIdle: weaponPose(
      [-23.3305, 274.7849, 53.6152],
      [-106.673, -21.153, -114.665],
    ),
    HitReaction: weaponPose([-23.3305, 274.7849, 53.6152], [-91.054, -11.075, -93.276]),
    DeathFront: weaponPose(
      [-23.3305, 274.7849, 53.6152],
      [-91.054, -11.075, -93.276],
      "detached",
    ),
    DeathBack: weaponPose(
      [-23.3305, 274.7849, 53.6152],
      [-91.054, -11.075, -93.276],
      "detached",
    ),
    DeathHeadshot: weaponPose(
      [-23.3305, 274.7849, 53.6152],
      [-91.054, -11.075, -93.276],
      "detached",
    ),
    FiringRifle: weaponPose([-23.3305, 274.7849, 53.6152], [-95.123, -0.777, -94.787]),
  },
};

function weaponTrack(animation: string): WeaponTrack | undefined {
  const value = ENEMY_AK47_RECIPE.animations[animation];
  if (value === undefined) return undefined;
  if (ENEMY_AK47_RECIPE.version === 3 && "keyframes" in value) return value;
  if (!("transform" in value)) return undefined;
  return { attachment: "attached", keyframes: [value] };
}

function interpolateWeaponPose(track: WeaponTrack, time: number): WeaponPose | undefined {
  const frames = [...track.keyframes].sort((a, b) => a.time - b.time);
  const first = frames[0];
  if (first === undefined) return undefined;
  const last = frames.at(-1) ?? first;
  if (time <= first.time) return first.transform;
  if (time >= last.time) return last.transform;
  const right = frames.find((frame) => frame.time >= time) ?? last;
  const left = frames[Math.max(0, frames.indexOf(right) - 1)] ?? first;
  const alpha = (time - left.time) / Math.max(1e-6, right.time - left.time);
  const mix = (a: number, b: number): number => MathUtils.lerp(a, b, alpha);
  const angle = (a: number, b: number): number =>
    a + ((((b - a + 540) % 360) - 180) * alpha);
  return {
    position: left.transform.position.map((value, index) =>
      mix(value, right.transform.position[index] ?? value),
    ) as [number, number, number],
    rotation: left.transform.rotation.map((value, index) =>
      angle(value, right.transform.rotation[index] ?? value),
    ) as [number, number, number],
    scale: left.transform.scale.map((value, index) =>
      mix(value, right.transform.scale[index] ?? value),
    ) as [number, number, number],
  };
}

export type EnemyHooks = {
  /** True when nothing solid blocks the segment. */
  readonly lineOfSight: (from: Vector3, to: Vector3) => boolean;
  readonly damagePlayer: (amount: number) => void;
  readonly onMuzzleFlash: (at: Vector3, direction: Vector3, distance: number) => void;
};

/** Raised-deck footprints this soldier may be routed beneath. */
export type DeckFootprint = {
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
};

export type EnemyOptions = {
  /** Patrol loop to walk and return to; defaults to the single range route. */
  readonly route?: readonly Vector3[];
  /** Ground rectangle the navigation grid covers; defaults to the old yard. */
  readonly navBounds?: { readonly min: number; readonly max: number };
  /** Raised deck footprints, reported by `underDeck` so a scenario can see routing under them. */
  readonly decks?: readonly DeckFootprint[];
};

/**
 * Metres the body travels per second of a locomotion clip played at rate 1.
 *
 * Cached on the clip itself: every soldier shares one `AnimationClip[]` from the loader, so
 * the sampling pass below runs once for the whole squad rather than once per man.
 */
const CLIP_GROUND_SPEED = new WeakMap<AnimationClip, number>();

/** First bone whose name matches, for models that do not use the Mixamo naming. */
function findBone(root: Object3D, pattern: RegExp): Object3D | undefined {
  let found: Object3D | undefined;
  root.traverse((object) => {
    if (found === undefined && pattern.test(object.name)) found = object;
  });
  return found;
}

export class Enemy {
  readonly group = new Group();
  readonly hitbox: Mesh;
  health = MAX_HEALTH;
  phase: EnemyPhase = "patrol";
  wounded = false;
  /**
   * Whether the body is snapped down so its lowest posed point rests on the deck.
   *
   * On is right for a soldier walking a range: the planted foot has to touch the floor and
   * the corpse has to lie on it. Turn it off for anything that is legitimately airborne —
   * a fall, a ragdoll driven by physics, a vault, a scripted drop — otherwise this pins the
   * body to the ground and eats the motion. `footClearance` keeps reporting the real height
   * either way, so a scenario can still see where the body actually is.
   */
  groundSnap = true;
  #animation: AnimationPlayer | undefined;
  #clips: ReadonlySet<string>;
  #clipDurations = new Map<string, number>();
  #weaponPoseElapsed = 0;
  #routeIndex = 0;
  #target = new Vector3();
  #lastSeen = new Vector3();
  #alertTimer = 0;
  #burstLeft = 0;
  #burstTimer = 0;
  #cooldown = 0;
  #strafe = 1;
  #strafeTimer = 0;
  #deadFor = 0;
  #deathSettleReady = false;
  /**
   * World Y the body stood at when it died. A corpse settles onto the deck it fell on; it
   * never climbs off it, so this is a hard ceiling on the grounding correction while dead.
   */
  #deathGroundCeiling: number | null = null;
  /** Precise corpse ground measurement, refreshed on a timer rather than every frame. */
  #corpseGroundTimer = 0;
  #fade = 1;
  #bodyClearance: number | null = null;
  #footClearance: number | null = null;
  #deathObserved = false;
  #deathAnkleDelta = 0;
  /**
   * Sticky record of the last death: which clip ran and how many frames it advanced. Sticky
   * because the corpse is gone 4.5 s later, so a scenario sampling after the respawn would
   * otherwise see a live soldier and be unable to tell a played death from a frozen one.
   */
  #deathClip: string | null = null;
  #deathClipFrames = 0;
  /** Travel direction of the round that last connected, for choosing which way the body falls. */
  #lastHitDirection: Vector3 | null = null;
  #hips: Object3D | undefined;
  /** Hip world position at the instant of death, so the fall direction can be measured. */
  #deathHipStart: Vector3 | null = null;
  /** Sticky fall measurement: the corpse is gone before a scenario can read a live value. */
  #deathFallMeasured: number | null = null;
  /** True while the last locomotion frame was a crouch, so standing up can play its transition. */
  #crouchMoving = false;
  /** Seconds left of the crouch-to-stand transition, during which no locomotion clip overrides it. */
  #standUp = 0;
  /** Seconds left of being under fire. Degrades aim and keeps the soldier low. */
  #suppressed = 0;
  #suppressedPeak = 0;
  /**
   * Frames each clip has actually advanced this session. The rig ships nine clips; without a
   * per-clip count nothing catches four of them quietly going unused again.
   */
  #clipFrames = new Map<string, number>();
  /** Locomotion clip currently committed to, and how long before another switch is allowed. */
  #locomotion = "";
  #locomotionHold = 0;
  /** Clips by name, so a locomotion action can be re-timed through the mixer that owns it. */
  #clipsByName = new Map<string, AnimationClip>();
  /** Metres per second each clip covers at rate 1, measured off this rig's own feet. */
  #clipGroundSpeed = new Map<string, number>();
  /** Where the body stood at the top of this frame, so ground speed is measured, not assumed. */
  #frameStart = new Vector3();
  #groundSpeed = 0;
  /** Playback rate the locomotion clip is running at, and how well it matches the ground. */
  #locomotionRate = 1;
  #locomotionRatePeak = 0;
  #strideErrorRatio = 1;
  #strideErrorPeak = 0;
  /** Seconds the body has been continuously still, so one blocked frame is not a stop. */
  #stillFor = 0;
  #lastHitMultiplier = 1;
  /**
   * Skin envelope: one bone per entry with the radius of the furthest skin vertex bound to
   * it, measured once in the bind pose. See `#calibrateSkinEnvelope`.
   */
  #envelopeBones: Object3D[] = [];
  #envelopeRadii: number[] = [];
  #envelopeBias = 0;
  /**
   * Largest sphere radius in the envelope. Published because a degenerate calibration is
   * invisible in every other number: it cancels itself in the bind pose and only shows up
   * once the body leaves it. No bone on a 1.78 m man owns skin half a metre away, so a
   * radius above that means the vertex walk measured the wrong thing.
   */
  #maxEnvelopeRadius = 0;
  #modelHeightMeasured: number = scale.humanHeight;
  #hitboxWidth: number = scale.shoulderWidth;
  #hitboxHeight: number = scale.humanHeight;
  #hitboxDepth: number = scale.bodyDepth;
  #crown: Object3D | undefined;
  #head: Object3D | undefined;
  #leftKnee: Object3D | undefined;
  #rightKnee: Object3D | undefined;
  #colliders: readonly BoxCollider[];
  #bodyMeshes: Object3D[] = [];
  #poseBones: Object3D[] = [];
  #bodyProxy: Object3D | undefined;
  #body: CharacterBody3D | undefined;
  #weapon: Object3D | undefined;
  #weaponModel: Object3D | undefined;
  #weaponDetached = false;
  #weaponSettled = false;
  #weaponVelocity = new Vector3();
  #rifleLocalMinZ = -scale.rifleLength * 0.35;
  #rifleLocalMaxZ = scale.rifleLength * 0.65;
  #rightHand: Object3D | undefined;
  #leftHand: Object3D | undefined;
  #grip: Object3D | undefined;
  #magazine: Object3D | undefined;
  #leftUpLeg: Object3D | undefined;
  #leftFoot: Object3D | undefined;
  #rightUpLeg: Object3D | undefined;
  #rightFoot: Object3D | undefined;
  #weaponNodes: string[] = [];
  #renderedRifleLength: number | null = null;
  /** Seconds left before it may fire after first seeing the player — it is not a turret. */
  #reaction = 0;
  /** Cached A* route. Dynamic combat goals are replanned without changing direction every frame. */
  #path: Vector3[] = [];
  #pathIndex = 0;
  #pathGoal = new Vector3();
  #replanIn = 0;
  #searchAtGoal = 0;
  #patrolPause = 0;
  #spawnGrace = SPAWN_GRACE_SECONDS;
  #route: readonly Vector3[] = ROUTE;
  #navMin = NAV_MIN;
  #navMax = NAV_MAX;
  #decks: readonly DeckFootprint[] = [];

  constructor(
    ctx: GameCtx,
    model: Object3D,
    clips: readonly AnimationClip[],
    colliders: readonly BoxCollider[],
    weapon?: Object3D,
    options: EnemyOptions = {},
  ) {
    this.#colliders = colliders;
    this.#route = options.route ?? ROUTE;
    this.#navMin = options.navBounds?.min ?? NAV_MIN;
    this.#navMax = options.navBounds?.max ?? NAV_MAX;
    this.#decks = options.decks ?? [];
    this.#pathGoal.copy(this.#route[0] ?? ROUTE_START);
    this.#target.copy(this.#route[0] ?? ROUTE_START);
    model.removeFromParent();
    model.position.set(0, 0, 0);
    model.rotation.set(0, 0, 0);
    model.scale.setScalar(1);
    model.updateWorldMatrix(false, true);
    this.#crown =
      findBone(model, /headtop|head_end|head.*end/i) ?? findBone(model, /head/i);
    this.#head = findBone(model, /mixamorigHead$|^head$/i) ?? findBone(model, /head/i);
    this.#leftKnee = findBone(model, /left.*leg|left.*knee/i);
    this.#rightKnee = findBone(model, /right.*leg|right.*knee/i);
    normaliseHeight(model, scale.humanHeight, this.#crown);
    model.traverse((object) => {
      if (/hips|upleg|leg|foot|toe|head/i.test(object.name)) this.#poseBones.push(object);
      const mesh = object as Mesh;
      if (mesh.isMesh === true) {
        this.#bodyMeshes.push(mesh);
        mesh.castShadow = true;
        mesh.receiveShadow = false;
      }
    });
    this.#hips = findBone(model, /hips/i);
    this.#leftUpLeg = findBone(model, /leftupleg/i);
    this.#leftFoot = findBone(model, /leftfoot/i);
    this.#rightUpLeg = findBone(model, /rightupleg/i);
    this.#rightFoot = findBone(model, /rightfoot/i);
    this.group.add(model);
    if (weapon !== undefined) this.#equip(model, weapon);
    this.group.name = "enemy";
    this.group.position.copy(this.#route[0] ?? ROUTE_START);
    const firstWaypoint = this.#route[1];
    if (firstWaypoint !== undefined) {
      this.#target.copy(firstWaypoint);
      this.#routeIndex = 1;
      this.group.rotation.y = Math.atan2(
        this.#target.x - this.group.position.x,
        this.#target.z - this.group.position.z,
      );
    }
    this.group.rotation.y = Math.atan2(
      this.#target.x - this.group.position.x,
      this.#target.z - this.group.position.z,
    );

    // Skinned meshes are the slow path for picking, so the rifle traces a plain
    // box proxy that follows the body. Invisible, but still raycastable.
    this.#modelHeightMeasured = this.modelHeight || scale.humanHeight;
    this.#calibrateSkinEnvelope();
    // Width and depth are declared sizes, not measurements. A whole-body AABB is not a
    // hitbox: in the bind pose this rig measures 1.11 m across because the arms are out in a
    // T, and over a walk cycle it measures 1.13 m deep because the stride reaches fore and
    // aft. Both would make a man a barn door to shoot at. Height stays measured, because it
    // comes off the posed head-top bone rather than a box.
    this.#hitboxWidth = scale.shoulderWidth;
    this.#hitboxHeight = this.#modelHeightMeasured;
    this.#hitboxDepth = scale.bodyDepth;
    this.hitbox = new Mesh(
      new BoxGeometry(this.#hitboxWidth, this.#hitboxHeight, this.#hitboxDepth),
      new MeshBasicMaterial({ visible: false }),
    );
    this.hitbox.position.y = this.#hitboxHeight / 2;
    this.hitbox.userData.enemy = this;
    this.group.add(this.hitbox);

    const bodyProxy = new Group();
    bodyProxy.name = "enemy-body";
    ctx.add(bodyProxy);
    this.#bodyProxy = bodyProxy;
    this.#body = new CharacterBody3D({
      physics: ctx.physics,
      object: bodyProxy,
      entity: "enemy-body",
      shape: CollisionShape3D.box(this.#hitboxWidth, this.#hitboxHeight, this.#hitboxDepth),
      gravity: 0,
      collisionLayer: 2,
      collisionMask: 1,
    });
    this.#syncCollisionBody();

    this.#clips = new Set(clips.map((clip) => clip.name));
    this.#clipDurations = new Map(clips.map((clip) => [clip.name, clip.duration]));
    this.#clipsByName = new Map(clips.map((clip) => [clip.name, clip]));
    // Measure the stride before the player exists: the sampling pass poses the rig, and the
    // envelope and hitbox above were both measured in the bind pose that it would disturb.
    for (const clip of clips) {
      this.#clipGroundSpeed.set(clip.name, this.#measureClipGroundSpeed(clip));
    }
    if (clips.length > 0) {
      this.#animation = new AnimationPlayer({ clips, root: this.group });
      this.#play("RifleWalk");
    }
  }

  get alive(): boolean {
    return this.phase !== "dead";
  }

  /** Chest height, used as the eye and muzzle origin. */
  get chest(): Vector3 {
    return new Vector3(
      this.group.position.x,
      this.group.position.y + this.bodyHeight * 0.8,
      this.group.position.z,
    );
  }

  /**
   * Rendered height, boots to head-top, measured off the skeleton.
   *
   * A `Box3` over a skinned mesh reports the *bind pose* transformed by the world matrix,
   * not the posed body — which is precisely how a 2.68 m soldier stood beside a 1.66 m
   * player without any gate noticing. The head-top bone is posed, so it tells the truth.
   */
  get modelHeight(): number {
    const crown =
      this.#crown ??
      findBone(this.group, /headtop|head_end|head.*end/i) ??
      findBone(this.group, /head/i);
    this.#crown = crown;
    if (crown === undefined) return 0;
    this.#syncWorldMatrices();
    return crown.getWorldPosition(new Vector3()).y - this.group.position.y;
  }

  get bodyBase(): number {
    return this.group.position.y;
  }

  get bodyHeight(): number {
    return this.modelHeight || this.#modelHeightMeasured;
  }

  get headZoneMinY(): number {
    const head = this.#head?.getWorldPosition(new Vector3());
    return (head?.y ?? this.bodyBase + this.bodyHeight) - scale.headRadius;
  }

  get legZoneMaxY(): number {
    const left = this.#leftKnee?.getWorldPosition(new Vector3()).y;
    const right = this.#rightKnee?.getWorldPosition(new Vector3()).y;
    const knees = [left, right].filter((value): value is number => value !== undefined);
    return knees.length > 0
      ? Math.max(...knees)
      : this.bodyBase + this.bodyHeight * scale.legZoneFraction;
  }

  /**
   * Put the rifle in the enemy's right hand.
   *
   * The animation clips are retargeted Mixamo rifle clips, so the arms are already posed around
   * a weapon that was not in the file — without this the soldier walks and fires holding air.
   * The bone is found by name because nothing in the asset pipeline reports a socket, and the
   * offsets are the grip pose measured against the model's own scale.
   */
  #equip(model: Object3D, weapon: Object3D): void {
    weapon.traverse((object) => {
      const mesh = object as Mesh;
      if (mesh.isMesh === true) {
        mesh.castShadow = true;
        mesh.receiveShadow = false;
      }
    });

    // Assets are cached across scene restarts. Detach and restore authored transforms before
    // measuring, or the second run measures the first run's normalised attachment and scales it
    // again into a giant AK.
    weapon.removeFromParent();
    weapon.position.set(0, 0, 0);
    weapon.rotation.set(0, 0, 0);
    weapon.scale.setScalar(1);
    weapon.updateWorldMatrix(false, true);

    const bounds = new Box3().setFromObject(weapon);

    const hand =
      model.getObjectByName("mixamorigRightHand") ??
      model.getObjectByName("RightHand") ??
      findBone(model, /right.*hand|hand.*r$|hand_r/i);
    this.#rightHand = hand;
    this.#leftHand =
      model.getObjectByName("mixamorigLeftHand") ??
      model.getObjectByName("LeftHand") ??
      findBone(model, /left.*hand|hand.*l$|hand_l/i);

    // A holder carries the grip offset so the rifle's own transform stays the measured one.
    const holder = new Group();
    holder.add(weapon);

    // Line the rifle's own `Grip_Bone` up with the holder origin. Hanging it off the model
    // origin instead puts the fist around the barrel: this AK is authored with its origin
    // 22 cm behind the receiver, which `create-threenative inspect` reports along with the
    // bone. The asset declares where it is held, so read that rather than guessing an offset.
    const grip = weapon.getObjectByName("Grip_Bone");
    this.#grip = grip;
    this.#magazine = findBone(weapon, /magazine|mag[_ -]|clip[_ -]/i);
    this.#weaponModel = weapon;
    weapon.traverse((object) => {
      if (object.name !== "" && this.#weaponNodes.length < 40) {
        this.#weaponNodes.push(object.name);
      }
    });
    this.#rifleLocalMinZ = bounds.min.z;
    this.#rifleLocalMaxZ = bounds.max.z;

    if (hand === undefined) {
      holder.position.set(0.16, 1.24, 0.16);
      holder.rotation.set(0, Math.PI / 2, 0);
      this.group.add(holder);
      this.#weapon = holder;
      normaliseLongestAxis(holder, scale.rifleLength);
      this.#alignWeaponGrip();
      this.#renderedRifleLength = this.#measureRenderedWeapon(weapon);
      return;
    }
    hand.add(holder);
    this.#weapon = holder;
    this.#applyWeaponPose("RifleWalk");
    normaliseLongestAxis(holder, scale.rifleLength);
    this.#alignWeaponGrip();
    this.#renderedRifleLength = this.#measureRenderedWeapon(weapon);
  }

  #applyWeaponPose(animation: string): void {
    const holder = this.#weapon;
    const track = weaponTrack(animation);
    const duration = this.#clipDurations.get(animation) ?? 1;
    const normalized = MathUtils.clamp(this.#weaponPoseElapsed / Math.max(duration, 1e-6), 0, 1);
    const pose = track === undefined ? undefined : interpolateWeaponPose(track, normalized);
    if (holder === undefined || pose === undefined) return;
    holder.rotation.set(
      MathUtils.degToRad(pose.rotation[0]),
      MathUtils.degToRad(pose.rotation[1]),
      MathUtils.degToRad(pose.rotation[2]),
    );
    holder.scale.fromArray(pose.scale);
    holder.updateWorldMatrix(false, true);
  }

  #detachWeapon(ctx: GameCtx, animation: string): void {
    const holder = this.#weapon;
    if (holder === undefined || weaponTrack(animation)?.attachment !== "detached") return;
    ctx.scene.attach(holder);
    this.#weaponDetached = true;
    this.#weaponSettled = false;
    this.#weaponVelocity.set(0.45, 1.4, -0.25).applyAxisAngle(
      new Vector3(0, 1, 0),
      this.group.rotation.y,
    );
  }

  #updateDetachedWeapon(dt: number, deckY: number): void {
    const holder = this.#weapon;
    if (holder === undefined || !this.#weaponDetached || this.#weaponSettled) return;
    this.#weaponVelocity.y -= 9.81 * dt;
    holder.position.addScaledVector(this.#weaponVelocity, dt);
    holder.rotation.x += dt * 2.7;
    holder.rotation.z += dt * 1.9;
    holder.updateWorldMatrix(false, true);
    const minimum = new Box3().setFromObject(holder).min.y;
    if (minimum < deckY) {
      holder.position.y += deckY - minimum;
      this.#weaponVelocity.set(0, 0, 0);
      this.#weaponSettled = true;
    }
    holder.updateWorldMatrix(false, true);
  }

  #reattachWeapon(): void {
    const holder = this.#weapon;
    if (holder === undefined || this.#rightHand === undefined) return;
    this.#rightHand.add(holder);
    this.#weaponDetached = false;
    this.#weaponSettled = false;
    this.#weaponVelocity.set(0, 0, 0);
    this.#weaponPoseElapsed = 0;
    this.#applyWeaponPose("RifleWalk");
  }

  #measureRenderedWeapon(weapon: Object3D): number {
    weapon.updateWorldMatrix(true, true);
    const size = new Box3().setFromObject(weapon).getSize(new Vector3());
    return Math.max(size.x, size.y, size.z);
  }

  /** Re-anchor the measured grip after pose or parent-bone scale changes. */
  #alignWeaponGrip(): void {
    const holder = this.#weapon;
    const grip = this.#grip;
    const parent = holder?.parent;
    const hand = this.#rightHand;
    if (
      this.#weaponDetached ||
      holder === undefined ||
      grip === undefined ||
      parent === null ||
      parent === undefined ||
      hand === undefined
    ) {
      return;
    }
    holder.updateWorldMatrix(true, true);
    const gripWorld = grip.getWorldPosition(new Vector3());
    const desiredLocal = parent.worldToLocal(hand.getWorldPosition(new Vector3()));
    const gripLocal = holder.worldToLocal(gripWorld);
    const offset = gripLocal.multiply(holder.scale).applyQuaternion(holder.quaternion);
    holder.position.copy(desiredLocal.sub(offset));
    holder.updateWorldMatrix(false, true);
  }

  /**
   * Refresh this soldier's world matrices, including the skinned meshes' bind matrices.
   *
   * `Object3D.updateWorldMatrix` recurses through `updateWorldMatrix`, which is *not* the
   * method `SkinnedMesh` overrides. `SkinnedMesh.updateMatrixWorld` is, and in the default
   * `attached` bind mode that override is the only thing that keeps `bindMatrixInverse`
   * equal to `matrixWorld.invert()`.
   *
   * That matters here because `SkeletonUtils.clone` — how every soldier in this game is
   * made — ends by calling `bind(skeleton, bindMatrix)`, which sets
   * `bindMatrixInverse = bindMatrix⁻¹`. This asset's `bindMatrix` is the identity, so a
   * freshly cloned rig carries an identity `bindMatrixInverse` until something runs the
   * override. Until then `getVertexPosition` returns *world* coordinates rather than
   * geometry-local ones, and every caller that follows the documented contract and
   * multiplies by `matrixWorld` — three's own precise `Box3`, `computeBoundingBox`, and the
   * envelope calibration below — folds the body onto the model origin. The renderer runs
   * `scene.updateMatrixWorld` every frame, so this only ever bit measurements taken before
   * the first frame: the constructor's, which is where the envelope is calibrated.
   */
  #syncWorldMatrices(): void {
    this.group.updateWorldMatrix(true, false);
    this.group.updateMatrixWorld(true);
  }

  #measureBodyPose(): ReturnType<typeof measureThreePose> {
    this.#syncWorldMatrices();
    for (const object of this.#bodyMeshes) {
      const mesh = object as Mesh & { isSkinnedMesh?: boolean; skeleton?: { update(): void } };
      if (mesh.isSkinnedMesh === true) mesh.skeleton?.update();
    }
    return measureThreePose(this.group, { bounds: this.#bodyMeshes });
  }

  /**
   * Build the skin envelope: for every bone, the distance to the furthest skin vertex it
   * dominates, plus a bias that makes the envelope agree exactly with the true posed bounds
   * in the bind pose.
   *
   * This exists because `measureThreePose(..., { bounds })` is a *precise* `Box3` pass:
   * `Box3.expandByObject` calls `SkinnedMesh.applyBoneTransform` on every vertex, which is
   * four matrix multiplies each. Over this soldier that is the single most expensive thing
   * in the frame — a CPU profile put it at 4.2 s of every 5 s wall clock and held the game
   * at single-digit FPS. Grounding needs one number, the lowest posed point, so pay for the
   * vertex walk once here and approximate it per frame from bone transforms alone.
   *
   * A sphere per bone is conservative under rotation, which is what a falling corpse needs:
   * the estimate never suddenly loses the limb that is actually touching the deck.
   */
  #calibrateSkinEnvelope(): void {
    this.#syncWorldMatrices();
    const radii = new Map<Object3D, number>();
    const bonePositions = new Map<Object3D, Vector3>();
    const vertex = new Vector3();

    for (const object of this.#bodyMeshes) {
      const mesh = object as Mesh & {
        isSkinnedMesh?: boolean;
        skeleton?: { bones: Object3D[]; update(): void };
      };
      const position = mesh.geometry?.getAttribute("position");
      if (position === undefined) continue;

      if (mesh.isSkinnedMesh !== true || mesh.skeleton === undefined) {
        // A rigid prop welded to the body still has to be grounded. It never deforms, so a
        // single sphere around its own origin covers it for every pose the body reaches.
        mesh.geometry.computeBoundingSphere();
        const sphere = mesh.geometry.boundingSphere;
        if (sphere === null) continue;
        const centre = sphere.center.clone().applyMatrix4(mesh.matrixWorld);
        const scale = mesh.getWorldScale(new Vector3());
        const radius = sphere.radius * Math.max(scale.x, scale.y, scale.z);
        radii.set(mesh, radius + centre.distanceTo(mesh.getWorldPosition(new Vector3())));
        continue;
      }

      mesh.skeleton.update();
      const bones = mesh.skeleton.bones;
      const indexAttribute = mesh.geometry.getAttribute("skinIndex");
      const weightAttribute = mesh.geometry.getAttribute("skinWeight");
      for (let i = 0; i < position.count; i += 1) {
        mesh.getVertexPosition(i, vertex);
        vertex.applyMatrix4(mesh.matrixWorld);
        // Bind the vertex to the bone that actually drives it. A vertex on a blended seam
        // lands on the heavier of the two, which is the one whose motion it follows.
        // Read the components directly: these attributes may be interleaved, which rules
        // out `Vector4.fromBufferAttribute`.
        let dominant = indexAttribute.getX(i);
        let best = weightAttribute.getX(i);
        for (const [weight, index] of [
          [weightAttribute.getY(i), indexAttribute.getY(i)],
          [weightAttribute.getZ(i), indexAttribute.getZ(i)],
          [weightAttribute.getW(i), indexAttribute.getW(i)],
        ] as const) {
          if (weight > best) {
            best = weight;
            dominant = index;
          }
        }
        const bone = bones[dominant];
        if (bone === undefined) continue;
        let bonePosition = bonePositions.get(bone);
        if (bonePosition === undefined) {
          bonePosition = bone.getWorldPosition(new Vector3());
          bonePositions.set(bone, bonePosition);
        }
        const radius = vertex.distanceTo(bonePosition);
        if (radius > (radii.get(bone) ?? 0)) radii.set(bone, radius);
      }
    }

    this.#envelopeBones = [...radii.keys()];
    this.#envelopeRadii = this.#envelopeBones.map((bone) => radii.get(bone) ?? 0);
    this.#maxEnvelopeRadius = this.#envelopeRadii.reduce((a, b) => Math.max(a, b), 0);
    if (this.#envelopeBones.length === 0) return;
    // The spheres always reach below the real skin. Measure that gap once against the true
    // posed bounds so the estimate is exact here and stays within a centimetre elsewhere.
    this.#envelopeBias = 0;
    const truth = this.#measureBodyPose().bounds?.min[1];
    if (truth !== undefined) this.#envelopeBias = truth - this.#lowestSkinY();
  }

  /**
   * Signed error of the skin envelope against a real precise-bounds measurement, in metres.
   * Positive means the envelope reads high and the body is actually sunk into the deck.
   *
   * Returns null unless `globalThis.__FPS_GROUNDING_AUDIT__` is set, because computing it
   * is exactly the per-vertex walk that made this game run at 9 FPS.
   */
  #groundingAudit(): number | null {
    const host = globalThis as { __FPS_GROUNDING_AUDIT__?: boolean };
    if (host.__FPS_GROUNDING_AUDIT__ !== true) return null;
    if (this.#envelopeBones.length === 0) return null;
    this.#syncWorldMatrices();
    const truth = this.#measureBodyPose().bounds?.min[1];
    if (truth === undefined) return null;
    return this.#lowestSkinY() - truth;
  }

  /**
   * Lowest posed point of the body, in world Y. O(bones) with no allocation, against the
   * O(vertices × 4 matrix multiplies) of a precise `Box3`. Assumes world matrices are
   * current — `#groundToDeck` refreshes them before calling.
   */
  #lowestSkinY(): number {
    let lowest = Number.POSITIVE_INFINITY;
    for (let i = 0; i < this.#envelopeBones.length; i += 1) {
      // elements[13] is the world-matrix Y translation: the bone's world height, decomposed
      // by hand because `getWorldPosition` allocates and this runs on every bone every frame.
      const y = (this.#envelopeBones[i] as Object3D).matrixWorld.elements[13] as number;
      const candidate = y - (this.#envelopeRadii[i] as number);
      if (candidate < lowest) lowest = candidate;
    }
    return lowest + this.#envelopeBias;
  }

  #syncCollisionBody(): void {
    const proxy = this.#bodyProxy;
    const body = this.#body;
    if (proxy === undefined || body === undefined) return;
    proxy.position.set(
      this.group.position.x,
      this.group.position.y + this.#hitboxHeight / 2,
      this.group.position.z,
    );
    body.teleport(proxy.position);
  }


  #setOpacity(alpha: number): void {
    const objects = [...this.#bodyMeshes, ...(this.#weaponModel === undefined ? [] : [this.#weaponModel])];
    for (const object of objects) {
      object.traverse((child) => {
        const mesh = child as Mesh;
        if (mesh.isMesh !== true) return;
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const material of materials) {
          material.transparent = alpha < 0.999;
          material.opacity = alpha;
          material.depthWrite = alpha > 0.5;
          material.needsUpdate = true;
        }
      });
    }
    this.#fade = alpha;
  }

  /** Muzzle point in world space: the weapon tip when equipped, the chest otherwise. */
  muzzle(): Vector3 {
    const weapon = this.#weapon;
    if (weapon === undefined) return this.chest;
    const tip = new Vector3(0, 0, this.#rifleLocalMaxZ);
    return weapon.localToWorld(tip);
  }

  #play(name: string, fade = 0.18, mode: "loop" | "once" = "loop"): void {
    if (this.#animation === undefined || !this.#clips.has(name)) return;
    if (this.#animation.current === name) return;
    this.#weaponPoseElapsed = 0;
    this.#applyWeaponPose(name);
    this.#animation.play(name, { fade, mode });
  }

  /**
   * Metres per second a clip covers when played at rate 1, measured off this rig's feet.
   *
   * Every clip in this asset is authored in place — no hips translation track in any of the
   * nine, verified against the GLB — so the distance is not in the file and has to be read
   * out of the gait. Each foot's forward excursion over one cycle is its step length, and a
   * stride is one step from each foot; that agrees with integrating the planted foot's
   * backward slip to within 6% on the walk cycle, and unlike the naive
   * "lowest foot is the planted one" rule it does not fall apart on the crouch cycle where
   * both feet stay low.
   *
   * The result is cached on the `AnimationClip`, which the whole squad shares, so this runs
   * once per clip rather than once per soldier. The rig is left in the pose it started in.
   */
  #measureClipGroundSpeed(clip: AnimationClip): number {
    const cached = CLIP_GROUND_SPEED.get(clip);
    if (cached !== undefined) return cached;
    const left = this.#leftFoot;
    const right = this.#rightFoot;
    if (left === undefined || right === undefined || clip.duration <= 0) {
      CLIP_GROUND_SPEED.set(clip, 0);
      return 0;
    }

    // Snapshot every posed bone: this walks the clip, and the caller measured the bind pose.
    const restored: { bone: Object3D; position: Vector3; quaternion: Quaternion; scale: Vector3 }[] =
      [];
    this.group.traverse((object) => {
      restored.push({
        bone: object,
        position: object.position.clone(),
        quaternion: object.quaternion.clone(),
        scale: object.scale.clone(),
      });
    });

    const mixer = new AnimationMixer(this.group);
    mixer.clipAction(clip).reset().play();
    const forward = new Vector3();
    const root = new Vector3();
    let leftMin = Number.POSITIVE_INFINITY;
    let leftMax = Number.NEGATIVE_INFINITY;
    let rightMin = Number.POSITIVE_INFINITY;
    let rightMax = Number.NEGATIVE_INFINITY;
    for (let sample = 0; sample <= STRIDE_SAMPLES; sample += 1) {
      mixer.setTime((sample / STRIDE_SAMPLES) * clip.duration);
      this.#syncWorldMatrices();
      this.group.getWorldPosition(root);
      // The body's own forward axis, so a rig that is not authored along +Z still measures.
      forward.set(0, 0, 1).applyQuaternion(this.group.getWorldQuaternion(new Quaternion()));
      forward.y = 0;
      if (forward.lengthSq() < 1e-6) forward.set(0, 0, 1);
      forward.normalize();
      const leftAt = left.getWorldPosition(new Vector3()).sub(root).dot(forward);
      const rightAt = right.getWorldPosition(new Vector3()).sub(root).dot(forward);
      leftMin = Math.min(leftMin, leftAt);
      leftMax = Math.max(leftMax, leftAt);
      rightMin = Math.min(rightMin, rightAt);
      rightMax = Math.max(rightMax, rightAt);
    }
    mixer.stopAllAction();
    mixer.uncacheRoot(this.group);
    for (const entry of restored) {
      entry.bone.position.copy(entry.position);
      entry.bone.quaternion.copy(entry.quaternion);
      entry.bone.scale.copy(entry.scale);
    }
    this.#syncWorldMatrices();

    const stride = leftMax - leftMin + (rightMax - rightMin);
    const speed = Number.isFinite(stride) ? Math.max(0, stride) / clip.duration : 0;
    CLIP_GROUND_SPEED.set(clip, speed);
    return speed;
  }

  /**
   * Play the locomotion clip at the rate the body is actually travelling.
   *
   * `timeScale` lives on the mixer action, not on the player, so the clip is looked up by
   * name and re-timed directly. A clip with no measurable stride (idle, the crouch-to-stand
   * transition) keeps rate 1: scaling it by ground speed would make a standing man twitch.
   */
  #applyLocomotionRate(name: string): void {
    const player = this.#animation;
    const clip = this.#clipsByName.get(name);
    if (player === undefined || clip === undefined) return;
    const action = player.mixer.existingAction(clip);
    if (action === null || action === undefined) return;
    const clipSpeed = this.#clipGroundSpeed.get(name) ?? 0;
    if (clipSpeed <= 0.05) {
      this.#locomotionRate = 1;
      this.#strideErrorRatio = 1;
      action.setEffectiveTimeScale(1);
      return;
    }
    const rate = MathUtils.clamp(
      this.#groundSpeed / clipSpeed,
      LOCOMOTION_RATE_MIN,
      LOCOMOTION_RATE_MAX,
    );
    this.#locomotionRate = rate;
    action.setEffectiveTimeScale(rate);
    if (this.#groundSpeed >= LOCOMOTION_RATE_FLOOR) {
      this.#locomotionRatePeak = Math.max(this.#locomotionRatePeak, rate);
    }
    // How fast the feet believe the body is going, over how fast it is. 1 is no slip.
    if (this.#groundSpeed >= LOCOMOTION_RATE_FLOOR) {
      this.#strideErrorRatio = (clipSpeed * rate) / this.#groundSpeed;
      this.#strideErrorPeak = Math.max(
        this.#strideErrorPeak,
        Math.abs(this.#strideErrorRatio - 1),
      );
    } else {
      this.#strideErrorRatio = 1;
    }
  }

  /**
   * Pick the locomotion clip from what the body is actually doing.
   *
   * Two things this fixes beyond using more of the rig: the walk cycle no longer plays while
   * the soldier is standing still against a blocked path, and standing up out of a crouch runs
   * its authored transition instead of popping straight to idle.
   */
  #playLocomotion(moving: boolean, crouched: boolean, dt: number): void {
    // Ground speed is measured from where the body actually got to this frame, not from the
    // speed constant it was asked for: a blocked step, a corner, or a slow turn all cut it.
    this.#groundSpeed =
      dt > 0
        ? Math.hypot(
            this.group.position.x - this.#frameStart.x,
            this.group.position.z - this.#frameStart.z,
          ) / dt
        : 0;
    // One frame against a wall, or one frame of a replan, is not a stop. Without this the
    // walk clip strobes against idle whenever the path is briefly blocked.
    this.#stillFor = moving ? 0 : this.#stillFor + dt;
    const travelling = this.#stillFor < STILL_BEFORE_IDLE_SECONDS;

    let wanted: string;
    if (travelling) {
      wanted = crouched && this.#clips.has("RifleCrouchWalk") ? "RifleCrouchWalk" : "RifleWalk";
    } else if (this.#crouchMoving && this.#clips.has("RifleCrouchWalkToIdle")) {
      // Standing up runs its authored transition, and owns the pose until it finishes.
      this.#crouchMoving = false;
      this.#standUp = this.#clipDurations.get("RifleCrouchWalkToIdle") ?? 0.5;
      this.#locomotion = "RifleCrouchWalkToIdle";
      this.#locomotionHold = this.#standUp;
      this.#play("RifleCrouchWalkToIdle", LOCOMOTION_FADE, "once");
      this.#applyLocomotionRate("RifleCrouchWalkToIdle");
      return;
    } else {
      if (this.#standUp > 0) return;
      wanted = "RifleIdle";
    }

    // Commit to a locomotion clip for a beat. Crouch state can flicker as suppression decays
    // or a burst starts, and a rig that re-blends every frame reads as a twitch, not a soldier.
    if (wanted !== this.#locomotion && this.#locomotionHold > 0) return;
    if (wanted !== this.#locomotion) this.#locomotionHold = LOCOMOTION_HOLD_SECONDS;
    this.#locomotion = wanted;
    this.#crouchMoving = wanted === "RifleCrouchWalk";
    this.#standUp = travelling ? 0 : this.#standUp;
    this.#play(wanted, LOCOMOTION_FADE);
    this.#applyLocomotionRate(wanted);
  }

  /**
   * How far the corpse travelled along the killing round's direction, in metres, measured on
   * the hips and flattened to the deck. Positive means he fell away from the shooter, which is
   * true of both death clips when they are mapped the right way round.
   */
  #deathFallDot(): number | null {
    const start = this.#deathHipStart;
    const round = this.#lastHitDirection;
    if (start === null || round === null || this.#hips === undefined) return null;
    const now = this.#hips.getWorldPosition(new Vector3());
    const travel = new Vector3(now.x - start.x, 0, now.z - start.z);
    const heading = new Vector3(round.x, 0, round.z);
    if (heading.lengthSq() < 1e-6) return null;
    return travel.dot(heading.normalize());
  }

  #countClipFrame(): void {
    const current = this.#animation?.current;
    if (current === undefined) return;
    this.#clipFrames.set(current, (this.#clipFrames.get(current) ?? 0) + 1);
  }

  /** Which death animation reads as true for the round that killed him. */
  #deathClipFor(): string {
    const fallback = this.#clips.has("DeathFront") ? "DeathFront" : "DeathBack";
    // A head hit is unmistakable on screen and outranks direction.
    if (this.#lastHitMultiplier >= 4 && this.#clips.has("DeathHeadshot")) return "DeathHeadshot";
    const round = this.#lastHitDirection;
    if (round === null) return fallback;
    const forward = new Vector3(0, 0, 1).applyEuler(this.group.rotation);
    // A round travelling the way he faces reached him from behind, so the body pitches
    // forward, away from the shooter. Facing into the round drops him backward instead.
    const struckFromBehind = round.dot(forward) > 0;
    const wanted = struckFromBehind ? "DeathFront" : "DeathBack";
    return this.#clips.has(wanted) ? wanted : fallback;
  }

  #occupied(x: number, z: number, padding: number): boolean {
    for (const box of this.#colliders) {
      // The raised deck is overhead, not a wall. Keep its supports and the lower range solids
      // in the navigation map, but let a soldier route through the open space underneath it.
      if (box.min[1] > scale.humanHeight + scale.ankleHeight * 6) continue;
      if (
        x > box.min[0] - padding &&
        x < box.max[0] + padding &&
        z > box.min[2] - padding &&
        z < box.max[2] + padding &&
        box.max[1] > 0.5
      ) {
        return true;
      }
    }
    return x < this.#navMin || x > this.#navMax || z < this.#navMin || z > this.#navMax;
  }

  /** True when the soldier stands in any raised deck's footprint — routing beneath it. */
  #underDeck(): boolean {
    const x = this.group.position.x;
    const z = this.group.position.z;
    for (const deck of this.#decks) {
      if (
        x > deck.minX &&
        x < deck.maxX &&
        z > deck.minZ &&
        z < deck.maxZ
      ) {
        return true;
      }
    }
    return false;
  }

  #blocked(x: number, z: number): boolean {
    return this.#occupied(x, z, AGENT_RADIUS);
  }

  #navBlocked(x: number, z: number): boolean {
    // Grid nodes need slack: a mathematically tangent route clips a corner after interpolation.
    return this.#occupied(x, z, AGENT_RADIUS + 0.16);
  }

  /** True when the whole body-width corridor is clear, not merely its end point. */
  #segmentClear(from: Vector3, to: Vector3): boolean {
    const distance = from.distanceTo(to);
    const samples = Math.max(1, Math.ceil(distance / (NAV_CELL * 0.45)));
    for (let index = 1; index <= samples; index += 1) {
      const t = index / samples;
      if (this.#navBlocked(MathUtils.lerp(from.x, to.x, t), MathUtils.lerp(from.z, to.z, t))) {
        return false;
      }
    }
    return true;
  }

  /** Build a deterministic 8-way A* route and then remove grid points visible from each other. */
  #findPath(goalX: number, goalZ: number): Vector3[] {
    const navMin = this.#navMin;
    const navMax = this.#navMax;
    const width = Math.floor((navMax - navMin) / NAV_CELL) + 1;
    const toCell = (value: number): number =>
      MathUtils.clamp(Math.round((value - navMin) / NAV_CELL), 0, width - 1);
    const toWorld = (cell: number): number => navMin + cell * NAV_CELL;
    const key = (x: number, z: number): number => z * width + x;
    const sx = toCell(this.group.position.x);
    const sz = toCell(this.group.position.z);
    let gx = toCell(goalX);
    let gz = toCell(goalZ);
    const requestedGoalBlocked = this.#navBlocked(goalX, goalZ);

    // A requested point may sit within the body's clearance margin. Pick the nearest usable cell.
    if (this.#navBlocked(toWorld(gx), toWorld(gz))) {
      let replacement: [number, number] | undefined;
      for (let radius = 1; radius < width && replacement === undefined; radius += 1) {
        for (let dz = -radius; dz <= radius && replacement === undefined; dz += 1) {
          for (let dx = -radius; dx <= radius; dx += 1) {
            if (Math.max(Math.abs(dx), Math.abs(dz)) !== radius) continue;
            const x = gx + dx;
            const z = gz + dz;
            if (
              x >= 0 &&
              z >= 0 &&
              x < width &&
              z < width &&
              !this.#navBlocked(toWorld(x), toWorld(z))
            ) {
              replacement = [x, z];
              break;
            }
          }
        }
      }
      if (replacement === undefined) return [];
      [gx, gz] = replacement;
    }

    const start = key(sx, sz);
    const goal = key(gx, gz);
    const open = new Set<number>([start]);
    const cameFrom = new Map<number, number>();
    const gScore = new Map<number, number>([[start, 0]]);
    const fScore = new Map<number, number>([[start, Math.hypot(gx - sx, gz - sz)]]);
    const neighbours: readonly (readonly [number, number, number])[] = [
      [-1, 0, 1], [1, 0, 1], [0, -1, 1], [0, 1, 1],
      [-1, -1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [1, 1, Math.SQRT2],
    ];

    while (open.size > 0) {
      let current = -1;
      let best = Number.POSITIVE_INFINITY;
      for (const candidate of open) {
        const score = fScore.get(candidate) ?? Number.POSITIVE_INFINITY;
        if (score < best) {
          best = score;
          current = candidate;
        }
      }
      if (current === goal) break;
      open.delete(current);
      const cx = current % width;
      const cz = Math.floor(current / width);
      for (const [dx, dz, cost] of neighbours) {
        const nx = cx + dx;
        const nz = cz + dz;
        if (nx < 0 || nz < 0 || nx >= width || nz >= width) continue;
        if (this.#navBlocked(toWorld(nx), toWorld(nz))) continue;
        // Do not squeeze diagonally between two touching solids.
        if (
          dx !== 0 &&
          dz !== 0 &&
          (this.#navBlocked(toWorld(cx + dx), toWorld(cz)) ||
            this.#navBlocked(toWorld(cx), toWorld(cz + dz)))
        ) continue;
        const next = key(nx, nz);
        const tentative = (gScore.get(current) ?? Number.POSITIVE_INFINITY) + cost;
        if (tentative >= (gScore.get(next) ?? Number.POSITIVE_INFINITY)) continue;
        cameFrom.set(next, current);
        gScore.set(next, tentative);
        fScore.set(next, tentative + Math.hypot(gx - nx, gz - nz));
        open.add(next);
      }
    }
    if (start !== goal && !cameFrom.has(goal)) return [];

    const raw: Vector3[] = [];
    let cursor = goal;
    while (cursor !== start) {
      raw.push(new Vector3(toWorld(cursor % width), 0, toWorld(Math.floor(cursor / width))));
      const previous = cameFrom.get(cursor);
      if (previous === undefined) return [];
      cursor = previous;
    }
    raw.reverse();
    // Preserve clearance when the requested destination itself is inside an inflated obstacle.
    if (!requestedGoalBlocked) raw.push(new Vector3(goalX, 0, goalZ));

    const smooth: Vector3[] = [];
    let anchor = new Vector3(this.group.position.x, 0, this.group.position.z);
    for (let index = 0; index < raw.length;) {
      let furthest = index;
      while (furthest + 1 < raw.length && this.#segmentClear(anchor, raw[furthest + 1] as Vector3)) {
        furthest += 1;
      }
      const waypoint = (raw[furthest] as Vector3).clone();
      smooth.push(waypoint);
      anchor = waypoint;
      index = furthest + 1;
    }
    return smooth;
  }

  /** Detection is an event: commit a route now instead of waiting for a movement branch. */
  #beginPursuit(target: Vector3): void {
    this.#path = this.#findPath(target.x, target.z);
    this.#pathIndex = 0;
    this.#pathGoal.set(target.x, 0, target.z);
    this.#replanIn = NAV_REPLAN_SECONDS;
  }

  /** Follow a cached route, replanning when a moving goal changes or the corridor becomes blocked. */
  /** Returns true when the body actually travelled, so the walk clip cannot play on the spot. */
  #step(dt: number, toX: number, toZ: number, speed: number): boolean {
    this.#replanIn -= dt;
    const goalMoved = Math.hypot(toX - this.#pathGoal.x, toZ - this.#pathGoal.z) > 0.8;
    const currentWaypoint = this.#path[this.#pathIndex];
    const routeObstructed =
      this.#replanIn <= 0 &&
      currentWaypoint !== undefined &&
      !this.#segmentClear(this.group.position, currentWaypoint);
    if (this.#path.length === 0 || goalMoved || routeObstructed) {
      this.#beginPursuit(new Vector3(toX, 0, toZ));
    }
    let waypoint = this.#path[this.#pathIndex];
    while (waypoint !== undefined && this.group.position.distanceTo(waypoint) < 0.32) {
      this.#pathIndex += 1;
      waypoint = this.#path[this.#pathIndex];
    }
    if (waypoint === undefined) return false;
    const dx = waypoint.x - this.group.position.x;
    const dz = waypoint.z - this.group.position.z;
    const distance = Math.hypot(dx, dz);
    if (distance < 1e-3) return false;

    const heading = Math.atan2(dx, dz);
    const travel = Math.min(distance, speed * dt);
    const stepX = Math.sin(heading) * travel;
    const stepZ = Math.cos(heading) * travel;
    const nextX = this.group.position.x + stepX;
    const nextZ = this.group.position.z + stepZ;
    if (this.#blocked(nextX, nextZ)) {
      this.#path = [];
      this.#replanIn = 0;
      return false;
    }
    this.group.position.set(nextX, this.group.position.y, nextZ);
    this.group.rotation.y = this.#turn(this.group.rotation.y, heading, dt * 7);
    return travel > speed * dt * 0.05;
  }

  #turn(from: number, to: number, rate: number): number {
    let delta = ((to - from + Math.PI) % (Math.PI * 2)) - Math.PI;
    if (delta < -Math.PI) delta += Math.PI * 2;
    return from + MathUtils.clamp(delta, -rate, rate);
  }

  #canSee(eye: Vector3, hooks: EnemyHooks): boolean {
    const chest = this.chest;
    const to = new Vector3().subVectors(eye, chest);
    const distance = to.length();
    if (distance > VIEW_RANGE) return false;
    const facing = new Vector3(Math.sin(this.group.rotation.y), 0, Math.cos(this.group.rotation.y));
    const flat = new Vector3(to.x, 0, to.z).normalize();
    if (facing.dot(flat) < Math.cos(VIEW_HALF_ANGLE)) return false;
    return hooks.lineOfSight(chest, eye);
  }

  hearShot(shooter: Vector3): void {
    if (!this.alive) return;
    if (shooter.distanceTo(this.group.position) > HEAR_RANGE) return;
    this.#lastSeen.copy(shooter);
    this.#beginPursuit(shooter);
    if (this.phase === "patrol" || this.phase === "return") {
      this.phase = "suspicious";
      this.#alertTimer = 0;
    }
  }

  /** Returns the score the shot earned: 300 for the kill, 100 for the first wound. */
  hurt(ctx: GameCtx, amount: number): number {
    if (!this.alive) return 0;
    this.health -= amount;
    let earned = 0;
    if (!this.wounded) {
      this.wounded = true;
      earned = 100;
    }
    if (this.health <= 0) {
      this.health = 0;
      this.phase = "dead";
      this.#deadFor = 0;
      this.#deathObserved = true;
      this.#deathSettleReady = false;
      this.#bodyClearance = null;
      this.#footClearance = null;
      this.#deathAnkleDelta = 0;
      this.#deathClipFrames = 0;
      this.#deathFallMeasured = null;
      this.#deathGroundCeiling = this.group.position.y;
      this.#corpseGroundTimer = 0;
      this.#deathHipStart = this.#hips?.getWorldPosition(new Vector3()) ?? null;
      const clip = this.#deathClipFor();
      this.#deathClip = this.#clips.has(clip) ? clip : null;
      this.#play(clip, DEATH_FADE, "once");
      this.#detachWeapon(ctx, clip);
      ctx.after(RESPAWN_SECONDS, () => this.#respawn());
      return earned + 300;
    }
    // Surviving a round costs him his composure for a couple of seconds, not just health.
    this.#suppressed = Math.max(this.#suppressed, 2.4);
    this.#suppressedPeak = Math.max(this.#suppressedPeak, this.#suppressed);
    this.#play("HitReaction", REACTION_FADE);
    if (this.phase !== "engage") this.phase = "engage";
    return earned;
  }

  /** `shotDirection` is the round's travel direction, used to pick which way the body falls. */
  recordHit(multiplier: number, shotDirection?: Vector3): void {
    this.#lastHitMultiplier = multiplier;
    if (shotDirection !== undefined) {
      this.#lastHitDirection = shotDirection.clone().normalize();
    }
  }

  #respawn(): void {
    this.health = MAX_HEALTH;
    this.wounded = false;
    this.phase = "patrol";
    this.#suppressed = 0;
    this.#standUp = 0;
    this.#crouchMoving = false;
    this.#locomotion = "";
    this.#locomotionHold = 0;
    this.#stillFor = 0;
    this.#lastHitDirection = null;
    this.#deathSettleReady = false;
    this.#deathGroundCeiling = null;
    this.#corpseGroundTimer = 0;
    this.#reattachWeapon();
    this.#bodyClearance = null;
    this.#footClearance = null;
    this.#groundInitialised = false;
    this.#setOpacity(0);
    this.#reaction = 0;
    this.#burstLeft = 0;
    this.#cooldown = 0;
    this.#path = [];
    this.#pathIndex = 0;
    this.#pathGoal.copy(this.#route[0] ?? ROUTE_START);
    this.#replanIn = 0;
    this.#searchAtGoal = 0;
    this.#patrolPause = 0;
    this.#spawnGrace = SPAWN_GRACE_SECONDS;
    this.#routeIndex = 0;
    this.group.position.copy(this.#route[0] ?? ROUTE_START);
    const firstWaypoint = this.#route[1];
    if (firstWaypoint !== undefined) {
      this.#target.copy(firstWaypoint);
      this.#routeIndex = 1;
    }
    this.group.rotation.set(
      0,
      Math.atan2(this.#target.x - this.group.position.x, this.#target.z - this.group.position.z),
      0,
    );
    this.#play("RifleWalk", LOCOMOTION_FADE);
  }

  update(ctx: GameCtx, dt: number, playerEye: Vector3, deckY: number, hooks: EnemyHooks): void {
    this.#frameStart.copy(this.group.position);
    if (this.phase === "dead") {
      this.#deadFor += dt;
      // The authored fall plays out first; the leg damp below only takes over once it has
      // ended. Running both at once has the IK fighting the clip, and skipping the clip
      // entirely leaves the soldier standing upright as a corpse.
      this.#animation?.update(dt);
      this.#countClipFrame();
      this.#deathClipFrames = Math.max(this.#deathClipFrames, this.#animation?.advancedFrames ?? 0);
      const fall = this.#deathFallDot();
      if (fall !== null && (this.#deathFallMeasured === null || fall > this.#deathFallMeasured)) {
        this.#deathFallMeasured = fall;
      }
      if (this.#deathClipFinished) this.#settleDeath(dt, deckY);
      this.#weaponPoseElapsed += dt;
      if (!this.#weaponDetached) this.#applyWeaponPose(this.#animation?.current ?? "");
      this.#updateDetachedWeapon(dt, deckY);
      this.#groundToDeck(deckY, dt);
      this.#normaliseWeapon();
      this.#alignWeaponGrip();
      this.#syncCollisionBody();
      if (this.#deadFor > RESPAWN_SECONDS - 0.35) {
        this.#setOpacity(MathUtils.clamp((RESPAWN_SECONDS - this.#deadFor) / 0.35, 0, 1));
      }
      return;
    }
    this.#spawnGrace = Math.max(0, this.#spawnGrace - dt);
    const sees = this.#spawnGrace <= 0 && this.#canSee(playerEye, hooks);
    if (sees) {
      // Entering combat from anywhere else starts the reaction clock, so the player gets a
      // moment to react rather than taking a burst the instant they step into the open.
      if (this.phase !== "engage") {
        this.#reaction = REACTION_SECONDS;
        this.#beginPursuit(playerEye);
      }
      this.#lastSeen.copy(playerEye);
      this.phase = "engage";
      this.#alertTimer = 0;
    }

    switch (this.phase) {
      case "patrol": {
        if (this.#spawnGrace > 0) {
          this.#play("RifleIdle");
          break;
        }
        if (this.#patrolPause > 0) {
          this.#patrolPause -= dt;
          this.#playLocomotion(false, false, dt);
          break;
        }
        this.#playLocomotion(this.#step(dt, this.#target.x, this.#target.z, WALK_SPEED), false, dt);
        if (this.group.position.distanceTo(this.#target) < 0.9) {
          const routeLength = this.#route.length;
          if (routeLength === 0) break;
          this.#routeIndex = (this.#routeIndex + 1) % routeLength;
          const nextWaypoint = this.#route[this.#routeIndex];
          if (nextWaypoint !== undefined) this.#target.copy(nextWaypoint);
          // A patrol that pauses for exactly 0.45 s at every corner reads as a machine.
          this.#patrolPause = 0.35 + ctx.random() * 1.1;
        }
        break;
      }
      case "suspicious": {
        // Heard something: turn toward it, then go looking.
        this.#alertTimer += dt;
        const wanted = Math.atan2(
          this.#lastSeen.x - this.group.position.x,
          this.#lastSeen.z - this.group.position.z,
        );
        this.group.rotation.y = this.#turn(this.group.rotation.y, wanted, dt * 4);
        // Something is wrong and he does not know what: stay low while he works it out.
        this.#playLocomotion(false, true, dt);
        if (this.#alertTimer > 0.8) this.phase = "search";
        break;
      }
      case "engage": {
        this.#engage(ctx, dt, playerEye, hooks, sees);
        break;
      }
      case "search": {
        this.#alertTimer += dt;
        if (this.group.position.distanceTo(this.#lastSeen) >= 1.6 && this.#alertTimer <= 7) {
          // Closing on a position someone was just shooting from: move low and quick.
          this.#playLocomotion(
            this.#step(dt, this.#lastSeen.x, this.#lastSeen.z, CHASE_SPEED * 0.85),
            true,
            dt,
          );
        } else {
          // Search the last known area before giving up; do not instantly snap back to patrol.
          this.#searchAtGoal += dt;
          this.group.rotation.y += dt * (this.#strafe > 0 ? 1.2 : -1.2);
          this.#playLocomotion(false, true, dt);
        }
        if (this.#searchAtGoal > 2.4 || this.#alertTimer > 9.5) {
          this.phase = "return";
          this.#alertTimer = 0;
          this.#searchAtGoal = 0;
          this.#path = [];
        }
        break;
      }
      case "return": {
        const home = this.#route[this.#routeIndex] ?? this.#route[0] ?? this.group.position;
        this.#playLocomotion(this.#step(dt, home.x, home.z, WALK_SPEED), false, dt);
        if (this.group.position.distanceTo(home) < 1.0) this.phase = "patrol";
        break;
      }
    }
    this.#standUp = Math.max(0, this.#standUp - dt);
    this.#suppressed = Math.max(0, this.#suppressed - dt);
    this.#locomotionHold = Math.max(0, this.#locomotionHold - dt);
    this.#animation?.update(dt);
    this.#countClipFrame();
    this.#weaponPoseElapsed += dt;
    if (!this.#weaponDetached) this.#applyWeaponPose(this.#animation?.current ?? "");
    this.#groundToDeck(deckY, dt);
    this.#normaliseWeapon();
    this.#alignWeaponGrip();
    this.#syncCollisionBody();
    if (this.#fade < 1) this.#setOpacity(MathUtils.clamp(this.#fade + dt / 0.35, 0, 1));
  }

  #groundInitialised = false;

  /**
   * True once the one-shot death clip has played out and is holding its last frame. The
   * duration is the fallback for a mixer that has not reported yet, so nothing downstream
   * waits forever on a clip that finished.
   */
  get #deathClipFinished(): boolean {
    if (this.phase !== "dead") return false;
    if (this.#animation === undefined) return true;
    return this.#animation.finished || this.#deadFor >= (this.#clipDurations.get("DeathFront") ?? 0);
  }

  /** Keep the rendered rifle at its declared length after parent-bone animation updates. */
  #normaliseWeapon(): void {
    if (this.#weapon !== undefined) normaliseLongestAxis(this.#weapon, scale.rifleLength);
  }

  /**
   * Lowest posed body point for a corpse, measured precisely rather than estimated.
   *
   * The skin envelope is a sphere per bone whose radius is fixed at calibration and whose
   * error is cancelled by one scalar bias in the bind pose. A collapsing body rotates every
   * limb out of that pose, and the spheres then reach as much as 1.2 m below the real skin —
   * measured on this rig, with the head sphere the offender. `#groundToDeck` turns that
   * error into height one-for-one, which is exactly how the corpse ended up floating with
   * its hips 1.36 m in the air. Returns null on the frames between measurements, where the
   * caller leaves the body where it is.
   */
  #corpseLowestY(dt: number): number | null {
    this.#corpseGroundTimer -= dt;
    if (this.#corpseGroundTimer > 0) return null;
    this.#corpseGroundTimer = CORPSE_GROUND_INTERVAL;
    return this.#measureBodyPose().bounds?.min[1] ?? null;
  }

  /** Keep the lowest posed body point on the requested deck with a bounded correction. */
  #groundToDeck(deckY: number, dt: number): void {
    if (this.#envelopeBones.length === 0) return;
    this.#syncWorldMatrices();
    const dead = this.phase === "dead";
    const minimum = dead ? this.#corpseLowestY(dt) : this.#lowestSkinY();
    if (minimum === null || !Number.isFinite(minimum)) return;
    const correction = deckY - minimum;
    // While the death clip is still playing the body must track the fall exactly, or it
    // hovers above its own pose. Only the settle that follows is damped, so the corpse
    // cannot twitch once it has come to rest.
    //
    // That settle is also one-way. `#settleDeath` rotates the legs down until the ankles
    // reach the deck, which puts the soles a few centimetres through it; grounding then
    // reads a body below the floor and lifts it, and the two ratchet the corpse into the air
    // at the damping rate. Once the fall has played out the body may only sink.
    const damped =
      dead && this.#groundInitialised && this.#deathClipFinished
        ? MathUtils.clamp(correction, -1 * dt, 0)
        : correction;
    // Grounding off still measures and reports; it just does not move the body.
    const wanted = this.groundSnap ? damped : 0;
    // A corpse settles onto the deck it fell on. Whatever the clip does with an arm that
    // swings through the floor, the body may never end up higher than the man was standing.
    const ceiling = this.#deathGroundCeiling;
    const applied =
      dead && ceiling !== null && this.groundSnap
        ? Math.min(wanted, ceiling - this.group.position.y)
        : wanted;
    this.group.position.y += applied;
    this.#syncWorldMatrices();
    // The estimate moves one-for-one with the group, so the settled height follows from the
    // correction that was actually applied. No second measurement is needed to read it back.
    const settled = minimum + applied;
    this.#bodyClearance = Math.abs(settled - deckY);
    this.#footClearance = Math.max(0, settled - deckY);
    this.#groundInitialised = true;
  }

  /** Compute a target leg orientation every frame, then approach it instead of applying a snap. */
  #settleDeath(dt: number, deckY: number): void {
    // `deathAnkleDelta` is the gate on B6, "the leg suddenly snaps". It has to measure the
    // motion *this correction* causes, not every ankle movement while dead — a raw
    // frame-to-frame delta also counts the authored fall, so the only way to pass it is to
    // stop animating the death, which is how the corpse ended up standing upright.
    const beforeLeft = this.#leftFoot?.getWorldPosition(new Vector3()).y;
    const beforeRight = this.#rightFoot?.getWorldPosition(new Vector3()).y;
    const alpha = 1 - Math.exp(-dt * 2.4);
    for (const [upLeg, foot] of [
      [this.#leftUpLeg, this.#leftFoot],
      [this.#rightUpLeg, this.#rightFoot],
    ] as const) {
      if (upLeg === undefined || foot === undefined || upLeg.parent === null) continue;
      this.#syncWorldMatrices();
      const hip = upLeg.getWorldPosition(new Vector3());
      const ankle = foot.getWorldPosition(new Vector3());
      const current = ankle.sub(hip);
      const length = current.length();
      if (length < 1e-4) continue;
      const desiredY = MathUtils.clamp(deckY + scale.ankleHeight - hip.y, -length, length);
      const horizontal = new Vector3(current.x, 0, current.z);
      if (horizontal.lengthSq() < 1e-6) horizontal.set(0, 0, 1);
      horizontal.setLength(Math.sqrt(Math.max(0, length * length - desiredY * desiredY)));
      const desired = horizontal.setY(desiredY);
      const worldDelta = new Quaternion().setFromUnitVectors(current.normalize(), desired.normalize());
      const parentWorld = upLeg.parent.getWorldQuaternion(new Quaternion());
      const localDelta = parentWorld.clone().invert().multiply(worldDelta).multiply(parentWorld);
      const target = localDelta.multiply(upLeg.quaternion.clone());
      upLeg.quaternion.slerp(target, alpha);
      upLeg.updateWorldMatrix(false, true);
    }
    const afterLeft = this.#leftFoot?.getWorldPosition(new Vector3()).y;
    const afterRight = this.#rightFoot?.getWorldPosition(new Vector3()).y;
    if (beforeLeft !== undefined && afterLeft !== undefined) {
      this.#deathAnkleDelta = Math.max(this.#deathAnkleDelta, Math.abs(afterLeft - beforeLeft));
    }
    if (beforeRight !== undefined && afterRight !== undefined) {
      this.#deathAnkleDelta = Math.max(this.#deathAnkleDelta, Math.abs(afterRight - beforeRight));
    }
    this.#deathSettleReady = true;
  }

  #engage(ctx: GameCtx, dt: number, playerEye: Vector3, hooks: EnemyHooks, sees: boolean): void {
    const chest = this.chest;
    const knownTarget = sees ? playerEye : this.#lastSeen;
    const wanted = Math.atan2(knownTarget.x - chest.x, knownTarget.z - chest.z);
    this.group.rotation.y = this.#turn(this.group.rotation.y, wanted, dt * 6);
    const flatDistance = Math.hypot(playerEye.x - chest.x, playerEye.z - chest.z);

    this.#strafeTimer -= dt;
    if (this.#strafeTimer <= 0) {
      // A metronome flank is the loudest tell that this is a state machine. Vary it.
      this.#strafeTimer = 0.9 + ctx.random() * 1.4;
      this.#strafe = -this.#strafe;
    }

    // Stay low when hurt or when rounds are landing near him, and plant to shoot: nobody
    // sprints through their own burst. This is most of what separates a soldier from a turret
    // that happens to be walking.
    const firing = this.#burstLeft > 0;
    const crouched = this.wounded || this.#suppressed > 0;
    const settle = firing ? 0.18 : crouched ? 0.72 : 1;
    let moved = false;

    if (this.#reaction > 0) {
      // Detection means pursuit immediately; tactical spacing begins only after reacting.
      moved = this.#step(dt, knownTarget.x, knownTarget.z, CHASE_SPEED * settle);
    } else {
      // Every later combat route is still derived from the player: close distance when far,
      // back off when rushed, and flank rather than running straight into the muzzle.
      const away = new Vector3(
        this.group.position.x - knownTarget.x,
        0,
        this.group.position.z - knownTarget.z,
      );
      if (away.lengthSq() < 1e-4) away.set(0, 0, 1);
      away.normalize();
      const desiredRange = flatDistance > ENGAGE_RANGE ? 10.5 : 9;
      const lateral = new Vector3(away.z, 0, -away.x).multiplyScalar(this.#strafe * 2.6);
      const combatGoal = new Vector3(knownTarget.x, 0, knownTarget.z)
        .addScaledVector(away, desiredRange)
        .add(lateral);
      moved = this.#step(
        dt,
        combatGoal.x,
        combatGoal.z,
        (flatDistance > ENGAGE_RANGE ? CHASE_SPEED : WALK_SPEED) * settle,
      );
    }
    // The firing clip owns the pose for as long as the burst lasts; locomotion resumes after.
    if (!firing) this.#playLocomotion(moved, crouched, dt);

    this.#cooldown -= dt;
    this.#burstTimer -= dt;
    this.#reaction -= dt;
    if (this.#burstLeft > 0) {
      if (this.#burstTimer <= 0) {
        this.#burstLeft -= 1;
        this.#burstTimer = BURST_SPACING;
        // A round only reaches the player if the shot is actually clear. Firing through a
        // barricade was the loudest tell that this was a timer and not a soldier.
        const clear = hooks.lineOfSight(chest, playerEye);
        // A round that connects costs the full 9; the ones that go wide do not.
        // Seeded, so a replay of the same run takes the same damage.
        // Taking rounds spoils a shooter's aim. Without this he shoots exactly as well while
        // being hit as he does unopposed, which reads as a machine no matter how he moves.
        const composure = this.#suppressed > 0 ? 0.45 : 1;
        const accuracy = MathUtils.clamp((0.75 - flatDistance * 0.035) * composure, 0.05, 0.75);
        const muzzle = this.muzzle();
        const shotDirection = playerEye.clone().sub(muzzle).normalize();
        const missDirection = shotDirection.clone();
        if (ctx.random() >= accuracy) {
          missDirection.x += (ctx.random() - 0.5) * 0.16;
          missDirection.y += (ctx.random() - 0.5) * 0.1;
          missDirection.normalize();
        }
        if (clear && shotDirection.angleTo(missDirection) < 0.02) hooks.damagePlayer(ROUND_DAMAGE);
        hooks.onMuzzleFlash(muzzle, missDirection, playerEye.distanceTo(muzzle));
        this.#play("FiringRifle", FIRE_FADE);
        if (this.#burstLeft === 0) {
          // Break contact for an irregular beat, longer when he is rattled. A fixed 3.2 s
          // gap between bursts is learnable within two engagements.
          this.#cooldown =
            BURST_COOLDOWN * (0.7 + ctx.random() * 0.6) + (this.#suppressed > 0 ? 0.9 : 0);
        }
      }
    } else if (sees && this.#cooldown <= 0 && this.#reaction <= 0) {
      // Bursts of two to four, not always three.
      this.#burstLeft = BURST_ROUNDS + Math.round((ctx.random() - 0.5) * 2);
      this.#burstTimer = 0;
    }

    if (!sees) {
      this.#burstLeft = 0;
      this.#alertTimer += dt;
      if (this.#alertTimer > 0.9) {
        this.phase = "search";
        this.#alertTimer = 0;
        this.#searchAtGoal = 0;
        this.#beginPursuit(this.#lastSeen);
      }
    }
  }

  debug(): {
    health: number;
    phase: EnemyPhase;
    position: number[];
    deadFor: number;
    armed: boolean;
    reaction: number;
    bodyClearance: number | null;
    footClearance: number | null;
    modelHeight: number;
    hitboxHeight: number;
    headZoneMinY: number;
    legZoneMaxY: number;
    underWalkway: boolean;
    deathObserved: boolean;
    deathAnkleDelta: number;
    wounded: boolean;
    suppressedPeak: number;
    crouchClipFrames: number;
    clipsPlayed: string[];
    groundSnap: boolean;
    deathFallDot: number | null;
    crouching: boolean;
    suppressed: number;
    animation: string | null;
    groundSpeed: number;
    locomotionRate: number;
    locomotionRatePeak: number;
    clipGroundSpeed: number;
    strideErrorRatio: number;
    strideErrorPeak: number;
    deathRiseM: number;
    deathClip: string | null;
    deathClipFrames: number;
    clips: string[];
    envelopeErrorM: number | null;
    maxEnvelopeRadius: number;
    lastHitMultiplier: number;
    navigation: { goal: number[]; next: number[] | null; remaining: number };
    rifleForward: number[] | null;
    rifleForwardDot: number | null;
    clipMarkerDownDot: number | null;
    rifleLength: number | null;
    rightHandToGrip: number | null;
    leftHandToRifle: number | null;
    weaponNodes: string[];
    bodyJoints: Record<string, number[]>;
  } {
    this.#syncWorldMatrices();
    const weaponPose =
      this.#weapon === undefined || this.#weaponModel === undefined
        ? null
        : measureThreePose(this.#weapon, { bounds: false });
    const rifleForward =
      weaponPose === null ? null : new Vector3().fromArray(weaponPose.axes.z);
    const enemyForward = new Vector3(0, 0, 1)
      .applyQuaternion(this.group.getWorldQuaternion(this.group.quaternion.clone()))
      .normalize();
    const gripPosition = this.#grip?.getWorldPosition(new Vector3()) ?? null;
    const rightHandPosition = this.#rightHand?.getWorldPosition(new Vector3()) ?? null;
    const magazinePosition = this.#magazine?.getWorldPosition(new Vector3()) ?? null;
    const leftHandPosition = this.#leftHand?.getWorldPosition(new Vector3()) ?? null;
    const rifleStart = this.#weapon?.localToWorld(new Vector3(0, 0, this.#rifleLocalMinZ)) ?? null;
    const rifleEnd = this.#weapon?.localToWorld(new Vector3(0, 0, this.#rifleLocalMaxZ)) ?? null;
    const bodyJoints: Record<string, number[]> = {};
    for (const bone of this.#poseBones) {
      bodyJoints[bone.name] = [...measureThreePose(bone, { bounds: false }).position];
    }
    return {
      health: this.health,
      phase: this.phase,
      position: this.group.position.toArray(),
      deadFor: this.#deadFor,
      armed: this.#weapon !== undefined,
      reaction: this.#reaction,
      bodyClearance: this.#bodyClearance,
      footClearance: this.#footClearance,
      modelHeight: this.modelHeight,
      hitboxHeight: this.#hitboxHeight,
      headZoneMinY: this.headZoneMinY,
      legZoneMaxY: this.legZoneMaxY,
      underWalkway: this.#underDeck(),
      deathObserved: this.#deathObserved,
      deathAnkleDelta: this.#deathAnkleDelta,
      // A frozen corpse passes every settle gate trivially, so publish how far the death
      // clip actually advanced and let a scenario require that it played.
      wounded: this.wounded,
      suppressedPeak: this.#suppressedPeak,
      crouchClipFrames: this.#clipFrames.get("RifleCrouchWalk") ?? 0,
      // Every clip the rig has actually run, so an unused animation is visible to a scenario.
      clipsPlayed: [...this.#clipFrames.keys()].sort(),
      groundSnap: this.groundSnap,
      // Whichever death clip ran, the body must travel the way the round did — i.e. away from
      // the shooter. One number that catches DeathFront and DeathBack being swapped.
      deathFallDot: this.#deathFallMeasured,
      crouching: this.#crouchMoving,
      suppressed: this.#suppressed,
      animation: this.#animation?.current ?? null,
      // Locomotion honesty: how fast the body is going, how fast the clip is being played,
      // how far the clip carries the body at rate 1, and the ratio of the last two to the
      // first. `strideErrorPeak` is sticky because a scenario samples on step boundaries and
      // would otherwise miss the frames where the feet were skating hardest.
      groundSpeed: this.#groundSpeed,
      locomotionRate: this.#locomotionRate,
      // Sticky: a scenario samples on step boundaries and would otherwise land on an idle
      // frame and see rate 1, which is also what un-re-timed locomotion looks like.
      locomotionRatePeak: this.#locomotionRatePeak,
      clipGroundSpeed: this.#clipGroundSpeed.get(this.#locomotion) ?? 0,
      strideErrorRatio: this.#strideErrorRatio,
      strideErrorPeak: this.#strideErrorPeak,
      // Metres the corpse has climbed above the spot it was standing on when it died.
      // Negative means it settled, which is the only direction a body goes.
      deathRiseM:
        this.#deathGroundCeiling === null
          ? 0
          : this.group.position.y - this.#deathGroundCeiling,
      deathClip: this.#deathClip,
      deathClipFrames: this.#deathClipFrames,
      clips: [...this.#clips].sort(),
      // Ground truth for `footClearance`, which is otherwise reported from the cheap skin
      // envelope and would happily agree with itself. Off unless a probe asks: this is the
      // per-vertex `Box3` pass the envelope exists to avoid, and it costs a whole frame.
      envelopeErrorM: this.#groundingAudit(),
      maxEnvelopeRadius: this.#maxEnvelopeRadius,
      lastHitMultiplier: this.#lastHitMultiplier,
      navigation: {
        goal: this.#pathGoal.toArray(),
        next: this.#path[this.#pathIndex]?.toArray() ?? null,
        remaining: Math.max(0, this.#path.length - this.#pathIndex),
      },
      rifleForward: rifleForward?.toArray() ?? null,
      rifleForwardDot: rifleForward?.dot(enemyForward) ?? null,
      clipMarkerDownDot:
        magazinePosition === null || gripPosition === null
          ? null
          : magazinePosition.clone().sub(gripPosition).normalize().dot(new Vector3(0, -1, 0)),
      rifleLength: weaponPose === null ? null : this.#renderedRifleLength,
      rightHandToGrip:
        rightHandPosition === null || gripPosition === null
          ? null
          : rightHandPosition.distanceTo(gripPosition),
      leftHandToRifle:
        leftHandPosition === null || rifleStart === null || rifleEnd === null
          ? null
          : this.#distanceToSegment(leftHandPosition, rifleStart, rifleEnd),
      weaponNodes: this.#weaponNodes,
      bodyJoints,
    };
  }

  #distanceToSegment(point: Vector3, start: Vector3, end: Vector3): number {
    const segment = end.clone().sub(start);
    const lengthSquared = segment.lengthSq();
    if (lengthSquared === 0) return point.distanceTo(start);
    const t = MathUtils.clamp(point.clone().sub(start).dot(segment) / lengthSquared, 0, 1);
    return point.distanceTo(start.addScaledVector(segment, t));
  }

  dispose(): void {
    this.#animation?.dispose();
    this.#body?.dispose();
    this.#bodyProxy?.removeFromParent();
    this.group.removeFromParent();
  }
}
