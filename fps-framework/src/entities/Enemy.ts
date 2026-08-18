import { AnimationPlayer, type ICtx } from "@threenative/core";
import type { IPhysicsContext } from "@threenative/physics";
import {
  type AnimationClip,
  Box3,
  BoxGeometry,
  Group,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  type Object3D,
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
/** Steering whiskers: straight on first, then progressively wider detours to either side. */
const DEVIATIONS: readonly number[] = [
  0,
  MathUtils.degToRad(25),
  MathUtils.degToRad(50),
  MathUtils.degToRad(75),
  MathUtils.degToRad(100),
  MathUtils.degToRad(130),
];
/** Seconds between first sighting and the first round, so the player is not shot on sight. */
const REACTION_SECONDS = 0.45;
/** A real AK is about this long; the shipped model is in centimetres and must be normalised. */
const RIFLE_LENGTH = 1.02;

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
  #frozen = false;
  #colliders: readonly BoxCollider[];
  #weapon: Object3D | undefined;
  /** Seconds left before it may fire after first seeing the player — it is not a turret. */
  #reaction = 0;
  /** Which way it prefers to round an obstacle, held for a moment so corners do not oscillate. */
  #detour: 1 | -1 = 1;
  #detourHold = 0;

  constructor(
    model: Object3D,
    clips: readonly AnimationClip[],
    colliders: readonly BoxCollider[],
    weapon?: Object3D,
  ) {
    this.#colliders = colliders;
    model.traverse((object) => {
      const mesh = object as Mesh;
      if (mesh.isMesh === true) {
        mesh.castShadow = true;
        mesh.receiveShadow = false;
      }
    });
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

    // The rifle is authored in centimetres — its raw bounds are 8 x 30 x 112 — so it has to be
    // normalised to a real weapon length before anything else, or attaching it to a hand makes
    // a 112 metre AK. Nothing in the asset pipeline states a unit, so it is measured here.
    const bounds = new Box3().setFromObject(weapon);
    const size = new Vector3();
    bounds.getSize(size);
    const longest = Math.max(size.x, size.y, size.z);
    const normalise = longest > 0 ? RIFLE_LENGTH / longest : 1;

    const hand =
      model.getObjectByName("mixamorigRightHand") ??
      model.getObjectByName("RightHand") ??
      findBone(model, /right.*hand|hand.*r$|hand_r/i);

    // A holder carries the grip offset so the rifle's own transform stays the measured one.
    const holder = new Group();
    weapon.position.set(0, 0, 0);
    weapon.rotation.set(0, 0, 0);
    weapon.scale.setScalar(1);
    holder.add(weapon);

    if (hand === undefined) {
      holder.scale.setScalar(normalise);
      holder.position.set(0.16, 1.24, 0.16);
      holder.rotation.set(0, Math.PI / 2, 0);
      this.group.add(holder);
      this.#weapon = holder;
      return;
    }
    // The hand bone carries the model's own scale; undo it so the normalised size survives.
    const handScale = new Vector3();
    hand.getWorldScale(handScale);
    const inverse = handScale.x === 0 ? 1 : 1 / handScale.x;
    holder.scale.setScalar(normalise * inverse);
    // Mixamo hands point +Y down the fingers with +Z out of the palm; the rifle's long axis is
    // its own +Z. Rotating -90 degrees about X lays the barrel along the fingers.
    holder.rotation.set(-Math.PI / 2, 0, 0);
    holder.position.set(0, 0, 0);
    hand.add(holder);
    this.#weapon = holder;
  }

  /** Muzzle point in world space: the weapon tip when equipped, the chest otherwise. */
  muzzle(): Vector3 {
    const weapon = this.#weapon;
    if (weapon === undefined) return this.chest;
    const tip = new Vector3(0, 0, RIFLE_LENGTH * 0.55);
    return weapon.localToWorld(tip);
  }

  #play(name: string, fade = 0.18): void {
    if (this.#animation === undefined || !this.#clips.has(name)) return;
    if (this.#animation.current === name) return;
    this.#animation.play(name, { fade });
  }

  #blocked(x: number, z: number): boolean {
    for (const box of this.#colliders) {
      if (
        x > box.min[0] - 0.45 &&
        x < box.max[0] + 0.45 &&
        z > box.min[2] - 0.45 &&
        z < box.max[2] + 0.45 &&
        box.max[1] > 0.5
      ) {
        return true;
      }
    }
    return Math.abs(x) > 16 || Math.abs(z) > 16;
  }

  /**
   * Walk toward a point, going *around* what is in the way.
   *
   * The previous version moved on each axis independently and simply refused a blocked axis, so
   * a soldier that met a barricade head-on stopped against it and vibrated for the rest of the
   * run. This casts a short whisker along the desired heading and, when it is blocked, tries
   * progressively wider deviations to each side and takes the first that is clear — the cheapest
   * steering that actually rounds a corner, and no navmesh to carry.
   */
  #step(dt: number, toX: number, toZ: number, speed: number): void {
    const dx = toX - this.group.position.x;
    const dz = toZ - this.group.position.z;
    const distance = Math.hypot(dx, dz);
    if (distance < 1e-3) return;

    const wanted = Math.atan2(dx, dz);
    const reach = Math.max(speed * dt, 0.35) + 0.55;
    let heading: number | undefined;
    for (const spread of DEVIATIONS) {
      for (const side of spread === 0 ? [0] : [this.#detour, -this.#detour as 1 | -1]) {
        const candidate = wanted + spread * side;
        const probeX = this.group.position.x + Math.sin(candidate) * reach;
        const probeZ = this.group.position.z + Math.cos(candidate) * reach;
        if (this.#blocked(probeX, probeZ)) continue;
        heading = candidate;
        break;
      }
      if (heading !== undefined) break;
    }
    if (heading === undefined) {
      // Boxed in: commit to one side for a while rather than flip-flopping every frame.
      this.#detour = this.#detour === 1 ? -1 : 1;
      return;
    }
    // Keep rounding the same way while a detour is active, so it does not oscillate at a corner.
    if (heading !== wanted) this.#detourHold = 0.6;

    const stepX = Math.sin(heading) * speed * dt;
    const stepZ = Math.cos(heading) * speed * dt;
    const nextX = this.group.position.x + stepX;
    const nextZ = this.group.position.z + stepZ;
    if (!this.#blocked(nextX, this.group.position.z)) this.group.position.x = nextX;
    if (!this.#blocked(this.group.position.x, nextZ)) this.group.position.z = nextZ;
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
      this.#frozen = false;
      this.#play("DeathFront", 0.06);
      // Nothing in `AnimationPlayer` clamps a one-shot clip at its last frame, so
      // the ragdoll is held by stopping the mixer updates once it has played out.
      ctx.after(1.1, () => {
        this.#frozen = true;
      });
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
    this.#frozen = false;
    this.#reaction = 0;
    this.#burstLeft = 0;
    this.#cooldown = 0;
    this.#detourHold = 0;
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
      if (!this.#frozen) this.#animation?.update(dt);
      return;
    }
    this.#detourHold = Math.max(0, this.#detourHold - dt);
    const sees = this.#canSee(playerEye, hooks);
    if (sees) {
      // Entering combat from anywhere else starts the reaction clock, so the player gets a
      // moment to react rather than taking a burst the instant they step into the open.
      if (this.phase !== "engage") this.#reaction = REACTION_SECONDS;
      this.#lastSeen.copy(playerEye);
      this.phase = "engage";
      this.#alertTimer = 0;
    }

    switch (this.phase) {
      case "patrol": {
        this.#step(dt, this.#target.x, this.#target.z, WALK_SPEED);
        this.#play("RifleWalk");
        if (this.group.position.distanceTo(this.#target) < 0.9) {
          this.#routeIndex = (this.#routeIndex + 1) % ROUTE.length;
          this.#target.copy(ROUTE[this.#routeIndex] as Vector3);
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
        this.#step(dt, this.#lastSeen.x, this.#lastSeen.z, CHASE_SPEED);
        this.#play("RifleWalk");
        this.#alertTimer += dt;
        if (
          this.group.position.distanceTo(this.#lastSeen) < 1.6 ||
          this.#alertTimer > 7 ||
          this.#blocked(this.#lastSeen.x, this.#lastSeen.z)
        ) {
          this.phase = "return";
          this.#alertTimer = 0;
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
  }

  #engage(ctx: GameCtx, dt: number, playerEye: Vector3, hooks: EnemyHooks, sees: boolean): void {
    const chest = this.chest;
    const wanted = Math.atan2(playerEye.x - chest.x, playerEye.z - chest.z);
    this.group.rotation.y = this.#turn(this.group.rotation.y, wanted, dt * 6);
    const flatDistance = Math.hypot(playerEye.x - chest.x, playerEye.z - chest.z);

    this.#strafeTimer -= dt;
    if (this.#strafeTimer <= 0) {
      this.#strafeTimer = 1.3;
      this.#strafe = -this.#strafe;
    }

    if (flatDistance > ENGAGE_RANGE) {
      // Close to engagement range.
      this.#step(dt, playerEye.x, playerEye.z, CHASE_SPEED);
      this.#play("RifleWalk");
    } else {
      // Strafe across the player's front.
      const right = new Vector3(Math.cos(this.group.rotation.y), 0, -Math.sin(this.group.rotation.y));
      const toX = this.group.position.x + right.x * this.#strafe * 3;
      const toZ = this.group.position.z + right.z * this.#strafe * 3;
      if (this.#blocked(toX, toZ)) this.#strafe = -this.#strafe;
      this.#step(dt, toX, toZ, WALK_SPEED);
      this.#play("RifleWalk");
    }

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
      this.#alertTimer += dt;
      if (this.#alertTimer > 1.4) {
        this.phase = "search";
        this.#alertTimer = 0;
        this.#burstLeft = 0;
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
  } {
    return {
      health: this.health,
      phase: this.phase,
      position: this.group.position.toArray(),
      deadFor: this.#deadFor,
      armed: this.#weapon !== undefined,
      reaction: this.#reaction,
    };
  }

  dispose(): void {
    this.#animation?.dispose();
    this.group.removeFromParent();
  }
}
