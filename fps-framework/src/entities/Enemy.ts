import { AnimationPlayer, type ICtx } from "@threenative/core";
import type { IPhysicsContext } from "@threenative/physics";
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
import type { GameState } from "../state.js";

type GameCtx = ICtx<GameState, IPhysicsContext>;

export type EnemyPhase = "patrol" | "suspicious" | "engage" | "search" | "return" | "dead";

const MAX_HEALTH = 36;
const BODY_HEIGHT = 1.8;
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
/** Presentation length: large enough to read across the animated two-hand stance. */
const RIFLE_LENGTH = 1.25;
const DEATH_SETTLE_SECONDS = 3.3;
const DEAD_ANKLE_HEIGHT = 0.32;

const ROUTE: readonly Vector3[] = [
  new Vector3(-4.5, 0, -9.5),
  new Vector3(-11.5, 0, -13.0),
  new Vector3(-1.0, 0, -15.0),
  new Vector3(4.5, 0, -11.0),
  new Vector3(1.5, 0, -6.5),
  new Vector3(-6.0, 0, -4.5),
];

export type EnemyHooks = {
  /** True when nothing in the yard blocks the segment. */
  readonly lineOfSight: (from: Vector3, to: Vector3) => boolean;
  readonly damagePlayer: (amount: number) => void;
  readonly onMuzzleFlash: (at: Vector3) => void;
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
  #deathGrounded = false;
  #bodyClearance: number | null = null;
  #crown: Object3D | undefined;
  #colliders: readonly BoxCollider[];
  #bodyMeshes: Object3D[] = [];
  #poseBones: Object3D[] = [];
  #weapon: Object3D | undefined;
  #weaponModel: Object3D | undefined;
  #weaponBaseRotation = new Quaternion();
  #rifleLocalMinZ = -RIFLE_LENGTH * 0.35;
  #rifleLocalMaxZ = RIFLE_LENGTH * 0.65;
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
  #pathGoal = new Vector3(Number.POSITIVE_INFINITY, 0, Number.POSITIVE_INFINITY);
  #replanIn = 0;
  #searchAtGoal = 0;
  #patrolPause = 0;

  constructor(
    model: Object3D,
    clips: readonly AnimationClip[],
    colliders: readonly BoxCollider[],
    weapon?: Object3D,
  ) {
    this.#colliders = colliders;
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
    this.group.position.copy(ROUTE[0] as Vector3);
    this.#target.copy(ROUTE[1] as Vector3);
    this.#routeIndex = 1;
    this.group.rotation.y = Math.atan2(
      this.#target.x - this.group.position.x,
      this.#target.z - this.group.position.z,
    );

    // Skinned meshes are the slow path for picking, so the rifle traces a plain
    // box proxy that follows the body. Invisible, but still raycastable.
    this.hitbox = new Mesh(
      new BoxGeometry(0.62, BODY_HEIGHT, 0.44),
      new MeshBasicMaterial({ visible: false }),
    );
    this.hitbox.position.y = BODY_HEIGHT / 2;
    this.hitbox.userData.enemy = this;
    this.group.add(this.hitbox);

    this.#clips = new Set(clips.map((clip) => clip.name));
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
    return new Vector3(this.group.position.x, this.group.position.y + 1.42, this.group.position.z);
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
    return BODY_HEIGHT;
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

    // The rifle is authored in centimetres — its raw bounds are 8 x 30 x 112 — so it has to be
    // normalised to a readable weapon length before attaching it to the hand.
    const bounds = new Box3().setFromObject(weapon);
    const size = new Vector3();
    bounds.getSize(size);
    const longest = Math.max(size.x, size.y, size.z);
    const normalise = longest > 0 ? RIFLE_LENGTH / longest : 1;

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
    if (grip !== undefined) {
      weapon.updateWorldMatrix(false, true);
      const gripPosition = new Vector3().setFromMatrixPosition(grip.matrixWorld);
      this.#rifleLocalMinZ = bounds.min.z - gripPosition.z;
      this.#rifleLocalMaxZ = bounds.max.z - gripPosition.z;
      weapon.position.sub(gripPosition);
    }

    if (hand === undefined) {
      holder.scale.setScalar(normalise);
      holder.position.set(0.16, 1.24, 0.16);
      holder.rotation.set(0, Math.PI / 2, 0);
      this.group.add(holder);
      this.#weapon = holder;
      this.#renderedRifleLength = this.#measureRenderedWeapon(weapon);
      return;
    }
    // The hand bone carries the model's own scale; undo it so the normalised size survives.
    const handScale = new Vector3();
    hand.getWorldScale(handScale);
    const inverse = handScale.x === 0 ? 1 : 1 / handScale.x;
    holder.scale.setScalar(normalise * inverse);
    // This rig's hand axes are not documented. Roll the AK so its receiver sits above the
    // hands in the real rendered close-up; `Clip_Bone` points opposite the visible magazine,
    // so treating that marker as "down" produced the upside-down toy pose.
    holder.rotation.set(-Math.PI / 2, 0, -Math.PI / 2);
    this.#weaponBaseRotation.copy(holder.quaternion);
    holder.position.set(0, 0, 0);
    hand.add(holder);
    this.#weapon = holder;
    this.#renderedRifleLength = this.#measureRenderedWeapon(weapon);
  }

  /**
   * Keep the support hand on the fore-end while the right hand remains locked to Grip_Bone.
   * A single-bone attachment only constrains the grip position; the rifle may still rotate
   * around that point and miss the authored left-hand pose by nearly half a metre.
   */
  #alignWeaponToHands(): void {
    const holder = this.#weapon;
    const hand = this.#rightHand;
    const supportHand = this.#leftHand;
    if (holder === undefined || hand === undefined || supportHand === undefined) return;

    hand.updateWorldMatrix(true, false);
    supportHand.updateWorldMatrix(true, false);
    const supportInHand = hand.worldToLocal(supportHand.getWorldPosition(new Vector3()));
    if (supportInHand.lengthSq() < 1e-6) return;

    const baseForward = new Vector3(0, 0, 1).applyQuaternion(this.#weaponBaseRotation).normalize();
    const swing = new Quaternion().setFromUnitVectors(baseForward, supportInHand.normalize());
    holder.quaternion.copy(swing.multiply(this.#weaponBaseRotation));
    holder.updateWorldMatrix(false, true);
  }

  #measureRenderedWeapon(weapon: Object3D): number {
    weapon.updateWorldMatrix(true, true);
    const size = new Box3().setFromObject(weapon).getSize(new Vector3());
    return Math.max(size.x, size.y, size.z);
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
    this.#animation.play(name, { fade, mode });
  }

  #occupied(x: number, z: number, padding: number): boolean {
    for (const box of this.#colliders) {
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
      this.#deathGrounded = false;
      this.#bodyClearance = null;
      // `mode: "once"` clamps the clip on its last frame, so the body plays the fall
      // all the way down and stays there. The old hand-rolled version froze the mixer
      // on a hard-coded 1.1s timer, a third of the way through a 3.4s clip, which left
      // the corpse stopped mid-fall above the ground.
      this.#play("DeathFront", 0.06, "once");
      ctx.after(RESPAWN_SECONDS, () => this.#respawn());
      return earned + 300;
    }
    this.#play("HitReaction", 0.05);
    if (this.phase !== "engage") this.phase = "engage";
    return earned;
  }

  #respawn(): void {
    this.health = MAX_HEALTH;
    this.wounded = false;
    this.phase = "patrol";
    this.#deathGrounded = false;
    this.#bodyClearance = null;
    this.#reaction = 0;
    this.#burstLeft = 0;
    this.#cooldown = 0;
    this.#path = [];
    this.#pathIndex = 0;
    this.#pathGoal.set(Number.POSITIVE_INFINITY, 0, Number.POSITIVE_INFINITY);
    this.#replanIn = 0;
    this.#searchAtGoal = 0;
    this.#patrolPause = 0;
    this.#routeIndex = 0;
    this.group.position.copy(ROUTE[0] as Vector3);
    this.#target.copy(ROUTE[1] as Vector3);
    this.#routeIndex = 1;
    this.group.rotation.set(
      0,
      Math.atan2(this.#target.x - this.group.position.x, this.#target.z - this.group.position.z),
      0,
    );
    this.#play("RifleWalk", 0.05);
  }

  update(ctx: GameCtx, dt: number, playerEye: Vector3, hooks: EnemyHooks): void {
    if (this.phase === "dead") {
      this.#deadFor += dt;
      // The clip clamps itself; keep driving the mixer so it reaches its last frame.
      this.#animation?.update(dt);
      this.#alignWeaponToHands();
      this.#groundDeathPose();
      if (!this.#deathGrounded && this.#deadFor >= DEATH_SETTLE_SECONDS) {
        this.#lowerLegToGround(this.#leftUpLeg, this.#leftFoot);
        this.#lowerLegToGround(this.#rightUpLeg, this.#rightFoot);
        this.#groundDeathPose();
        this.#deathGrounded = true;
      }
      return;
    }
    const sees = this.#canSee(playerEye, hooks);
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
    this.#alignWeaponToHands();
  }

  /** Keep the lowest animated body vertex on the floor throughout the fall. */
  #groundDeathPose(): void {
    // Bone matrices normally refresh during render. Grounding runs first, so refresh skinned
    // meshes explicitly or the bounds lag one animation frame behind and visibly bob.
    for (const object of this.#bodyMeshes) {
      const mesh = object as Mesh & { isSkinnedMesh?: boolean; skeleton?: { update(): void } };
      if (mesh.isSkinnedMesh === true) mesh.skeleton?.update();
    }
    const bodyPose = measureThreePose(this.group, { bounds: this.#bodyMeshes });
    const clearance = bodyPose.bounds?.min[1];
    if (clearance === undefined) return;
    this.group.position.y -= clearance;
    this.group.updateWorldMatrix(true, true);
    this.#bodyClearance = 0;
  }

  /** Rotate a settled leg at the hip so the animation's bend survives but its ankle reaches down. */
  #lowerLegToGround(upLeg: Object3D | undefined, foot: Object3D | undefined): void {
    if (upLeg === undefined || foot === undefined || upLeg.parent === null) return;
    this.group.updateWorldMatrix(true, true);
    const hip = upLeg.getWorldPosition(new Vector3());
    const ankle = foot.getWorldPosition(new Vector3());
    const current = ankle.sub(hip);
    const length = current.length();
    const desiredY = DEAD_ANKLE_HEIGHT - hip.y;
    if (length < Math.abs(desiredY) || length < 1e-4) return;

    const horizontal = new Vector3(current.x, 0, current.z);
    if (horizontal.lengthSq() < 1e-6) horizontal.set(0, 0, 1);
    horizontal.setLength(Math.sqrt(length * length - desiredY * desiredY));
    const desired = horizontal.setY(desiredY);
    const worldDelta = new Quaternion().setFromUnitVectors(current.normalize(), desired.normalize());
    const parentWorld = upLeg.parent.getWorldQuaternion(new Quaternion());
    const localDelta = parentWorld.clone().invert().multiply(worldDelta).multiply(parentWorld);
    upLeg.quaternion.premultiply(localDelta);
    upLeg.updateWorldMatrix(false, true);
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
        if (clear && ctx.random() < accuracy) hooks.damagePlayer(ROUND_DAMAGE);
        hooks.onMuzzleFlash(this.muzzle());
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
    modelHeight: number;
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
      modelHeight: this.modelHeight,
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
    this.group.removeFromParent();
  }
}
