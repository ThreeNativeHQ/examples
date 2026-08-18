import { AnimationPlayer, type ICtx } from "@threenative/core";
import { CharacterBody3D, CollisionShape3D, type IPhysicsContext } from "@threenative/physics";
import { measureThreePose } from "@threenative/playtest/three";
import {
  type AnimationClip,
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
import type { BoxCollider } from "../render/range.js";
import { normaliseHeight, normaliseLongestAxis, scale } from "../render/scale.js";
import type { GameState } from "../state.js";

type GameCtx = ICtx<GameState, IPhysicsContext>;

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
  /** True when nothing in the yard blocks the segment. */
  readonly lineOfSight: (from: Vector3, to: Vector3) => boolean;
  readonly damagePlayer: (amount: number) => void;
  readonly onMuzzleFlash: (at: Vector3, direction: Vector3, distance: number) => void;
};

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
  #fade = 1;
  #bodyClearance: number | null = null;
  #footClearance: number | null = null;
  #deathObserved = false;
  #deathAnkleDelta = 0;
  #lastAnkles: [number, number] | null = null;
  #lastHitMultiplier = 1;
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
  #pathGoal = ROUTE_START.clone();
  #replanIn = 0;
  #searchAtGoal = 0;
  #patrolPause = 0;
  #spawnGrace = SPAWN_GRACE_SECONDS;

  constructor(
    ctx: GameCtx,
    model: Object3D,
    clips: readonly AnimationClip[],
    colliders: readonly BoxCollider[],
    weapon?: Object3D,
  ) {
    this.#colliders = colliders;
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
    this.#leftUpLeg = findBone(model, /leftupleg/i);
    this.#leftFoot = findBone(model, /leftfoot/i);
    this.#rightUpLeg = findBone(model, /rightupleg/i);
    this.#rightFoot = findBone(model, /rightfoot/i);
    this.group.add(model);
    if (weapon !== undefined) this.#equip(model, weapon);
    this.group.name = "enemy";
    this.group.position.copy(ROUTE_START);
    this.#target.copy(ROUTE[1] as Vector3);
    this.#routeIndex = 1;
    this.group.rotation.y = Math.atan2(
      this.#target.x - this.group.position.x,
      this.#target.z - this.group.position.z,
    );

    // Skinned meshes are the slow path for picking, so the rifle traces a plain
    // box proxy that follows the body. Invisible, but still raycastable.
    this.#modelHeightMeasured = this.modelHeight || scale.humanHeight;
    const bodyPose = measureThreePose(this.group, { bounds: this.#bodyMeshes });
    const bodySize = bodyPose.bounds?.size ?? [scale.shoulderWidth, scale.humanHeight, scale.bodyDepth];
    this.#hitboxWidth = Math.max(scale.shoulderWidth, bodySize[0] * 1.08);
    this.#hitboxHeight = this.#modelHeightMeasured;
    this.#hitboxDepth = Math.max(scale.bodyDepth, bodySize[2] * 1.08);
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
    this.group.updateWorldMatrix(true, true);
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

  #measureBodyPose(): ReturnType<typeof measureThreePose> {
    for (const object of this.#bodyMeshes) {
      const mesh = object as Mesh & { isSkinnedMesh?: boolean; skeleton?: { update(): void } };
      if (mesh.isSkinnedMesh === true) mesh.skeleton?.update();
    }
    return measureThreePose(this.group, { bounds: this.#bodyMeshes });
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

  #recordAnkleMotion(): void {
    const left = this.#leftFoot?.getWorldPosition(new Vector3()).y;
    const right = this.#rightFoot?.getWorldPosition(new Vector3()).y;
    if (left === undefined || right === undefined) return;
    if (this.#lastAnkles !== null) {
      this.#deathAnkleDelta = Math.max(
        this.#deathAnkleDelta,
        Math.abs(left - this.#lastAnkles[0]),
        Math.abs(right - this.#lastAnkles[1]),
      );
    }
    this.#lastAnkles = [left, right];
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
    return x < NAV_MIN || x > NAV_MAX || z < NAV_MIN || z > NAV_MAX;
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
    const width = Math.floor((NAV_MAX - NAV_MIN) / NAV_CELL) + 1;
    const toCell = (value: number): number =>
      MathUtils.clamp(Math.round((value - NAV_MIN) / NAV_CELL), 0, width - 1);
    const toWorld = (cell: number): number => NAV_MIN + cell * NAV_CELL;
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
  #step(dt: number, toX: number, toZ: number, speed: number): void {
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
    if (waypoint === undefined) return;
    const dx = waypoint.x - this.group.position.x;
    const dz = waypoint.z - this.group.position.z;
    const distance = Math.hypot(dx, dz);
    if (distance < 1e-3) return;

    const heading = Math.atan2(dx, dz);
    const travel = Math.min(distance, speed * dt);
    const stepX = Math.sin(heading) * travel;
    const stepZ = Math.cos(heading) * travel;
    const nextX = this.group.position.x + stepX;
    const nextZ = this.group.position.z + stepZ;
    if (this.#blocked(nextX, nextZ)) {
      this.#path = [];
      this.#replanIn = 0;
      return;
    }
    this.group.position.set(nextX, this.group.position.y, nextZ);
    this.group.rotation.y = this.#turn(this.group.rotation.y, heading, dt * 7);
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
      this.#play("DeathFront", 0.06, "once");
      this.#detachWeapon(ctx, "DeathFront");
      ctx.after(RESPAWN_SECONDS, () => this.#respawn());
      return earned + 300;
    }
    this.#play("HitReaction", 0.05);
    if (this.phase !== "engage") this.phase = "engage";
    return earned;
  }

  recordHit(multiplier: number): void {
    this.#lastHitMultiplier = multiplier;
  }

  #respawn(): void {
    this.health = MAX_HEALTH;
    this.wounded = false;
    this.phase = "patrol";
    this.#deathSettleReady = false;
    this.#reattachWeapon();
    this.#bodyClearance = null;
    this.#footClearance = null;
    this.#lastAnkles = null;
    this.#groundInitialised = false;
    this.#setOpacity(0);
    this.#reaction = 0;
    this.#burstLeft = 0;
    this.#cooldown = 0;
    this.#path = [];
    this.#pathIndex = 0;
    this.#pathGoal.copy(ROUTE_START);
    this.#replanIn = 0;
    this.#searchAtGoal = 0;
    this.#patrolPause = 0;
    this.#spawnGrace = SPAWN_GRACE_SECONDS;
    this.#routeIndex = 0;
    this.group.position.copy(ROUTE_START);
    this.#target.copy(ROUTE[1] as Vector3);
    this.#routeIndex = 1;
    this.group.rotation.set(
      0,
      Math.atan2(this.#target.x - this.group.position.x, this.#target.z - this.group.position.z),
      0,
    );
    this.#play("RifleWalk", 0.05);
  }

  update(ctx: GameCtx, dt: number, playerEye: Vector3, deckY: number, hooks: EnemyHooks): void {
    if (this.phase === "dead") {
      this.#deadFor += dt;
      // The death pose is intentionally settled from the pose at impact. Advancing a long
      // authored fall clip here moves an ankle by tens of centimetres in one browser frame;
      // the damped bone target below gives the corpse a readable settle without a snap.
      this.#settleDeath(dt, deckY);
      this.#weaponPoseElapsed += dt;
      if (!this.#weaponDetached) this.#applyWeaponPose(this.#animation?.current ?? "");
      this.#updateDetachedWeapon(dt, deckY);
      this.#groundToDeck(deckY, dt);
      this.#normaliseWeapon();
      this.#alignWeaponGrip();
      this.#recordAnkleMotion();
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
          this.#play("RifleIdle");
          break;
        }
        this.#step(dt, this.#target.x, this.#target.z, WALK_SPEED);
        this.#play("RifleWalk");
        if (this.group.position.distanceTo(this.#target) < 0.9) {
          this.#routeIndex = (this.#routeIndex + 1) % ROUTE.length;
          this.#target.copy(ROUTE[this.#routeIndex] as Vector3);
          this.#patrolPause = 0.45;
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
        this.#play("RifleIdle");
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
          this.#step(dt, this.#lastSeen.x, this.#lastSeen.z, CHASE_SPEED);
          this.#play("RifleWalk");
        } else {
          // Search the last known area before giving up; do not instantly snap back to patrol.
          this.#searchAtGoal += dt;
          this.group.rotation.y += dt * (this.#strafe > 0 ? 1.2 : -1.2);
          this.#play("RifleIdle");
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
        const home = ROUTE[this.#routeIndex] as Vector3;
        this.#step(dt, home.x, home.z, WALK_SPEED);
        this.#play("RifleWalk");
        if (this.group.position.distanceTo(home) < 1.0) this.phase = "patrol";
        break;
      }
    }
    this.#animation?.update(dt);
    this.#weaponPoseElapsed += dt;
    if (!this.#weaponDetached) this.#applyWeaponPose(this.#animation?.current ?? "");
    this.#groundToDeck(deckY, dt);
    this.#normaliseWeapon();
    this.#alignWeaponGrip();
    if (!this.#deathObserved) this.#recordAnkleMotion();
    this.#syncCollisionBody();
    if (this.#fade < 1) this.#setOpacity(MathUtils.clamp(this.#fade + dt / 0.35, 0, 1));
  }

  #groundInitialised = false;

  /** Keep the rendered rifle at its declared length after parent-bone animation updates. */
  #normaliseWeapon(): void {
    if (this.#weapon !== undefined) normaliseLongestAxis(this.#weapon, scale.rifleLength);
  }

  /** Keep the lowest posed body vertex on the requested deck with a bounded correction. */
  #groundToDeck(deckY: number, dt: number): void {
    const bodyPose = this.#measureBodyPose();
    const minimum = bodyPose.bounds?.min[1];
    if (minimum === undefined) return;
    const correction = deckY - minimum;
    const applied = this.phase === "dead" && this.#groundInitialised
      ? MathUtils.clamp(correction, -1 * dt, 1 * dt)
      : correction;
    this.group.position.y += applied;
    this.group.updateWorldMatrix(true, true);
    // Skinned bounds can settle one pose sample behind the group transform. Re-read once and
    // close that residual so a walking frame cannot report a false airborne clearance.
    const firstSettled = this.#measureBodyPose().bounds?.min[1];
    if (firstSettled !== undefined) {
      const residual = deckY - firstSettled;
      const refined = this.phase === "dead"
        ? MathUtils.clamp(residual, -1 * dt, 1 * dt)
        : residual;
      this.group.position.y += refined;
      this.group.updateWorldMatrix(true, true);
    }
    const settled = this.#measureBodyPose().bounds?.min[1];
    this.#bodyClearance = settled === undefined ? null : Math.abs(settled - deckY);
    this.#footClearance = settled === undefined ? null : Math.max(0, settled - deckY);
    this.#groundInitialised = true;
  }

  /** Compute a target leg orientation every frame, then approach it instead of applying a snap. */
  #settleDeath(dt: number, deckY: number): void {
    const alpha = 1 - Math.exp(-dt * 2.4);
    for (const [upLeg, foot] of [
      [this.#leftUpLeg, this.#leftFoot],
      [this.#rightUpLeg, this.#rightFoot],
    ] as const) {
      if (upLeg === undefined || foot === undefined || upLeg.parent === null) continue;
      this.group.updateWorldMatrix(true, true);
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
      this.#strafeTimer = 1.3;
      this.#strafe = -this.#strafe;
    }

    if (this.#reaction > 0) {
      // Detection means pursuit immediately; tactical spacing begins only after reacting.
      this.#step(dt, knownTarget.x, knownTarget.z, CHASE_SPEED);
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
      this.#step(
        dt,
        combatGoal.x,
        combatGoal.z,
        flatDistance > ENGAGE_RANGE ? CHASE_SPEED : WALK_SPEED,
      );
    }
    this.#play("RifleWalk");

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
        const accuracy = MathUtils.clamp(0.75 - flatDistance * 0.035, 0.12, 0.75);
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
        this.#play("FiringRifle", 0.04);
        if (this.#burstLeft === 0) this.#cooldown = BURST_COOLDOWN;
      }
    } else if (sees && this.#cooldown <= 0 && this.#reaction <= 0) {
      this.#burstLeft = BURST_ROUNDS;
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
    this.group.updateWorldMatrix(true, true);
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
      underWalkway:
        this.group.position.x > 9.8 &&
        this.group.position.x < 13.4 &&
        this.group.position.z > -11.4 &&
        this.group.position.z < -5.8,
      deathObserved: this.#deathObserved,
      deathAnkleDelta: this.#deathAnkleDelta,
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
