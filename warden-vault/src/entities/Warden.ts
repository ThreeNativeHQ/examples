import type { ICtx } from "@threenative/core";
import { CharacterBody3D, CollisionShape3D, type IPhysicsContext } from "@threenative/physics";
import { Group, Vector3 } from "three";
import type { IVaultMaterials } from "../render/materials.js";
import { wardenFigure } from "../render/warden.js";
import type { GameState } from "../state.js";
import { WARDEN_MASK } from "./Crate.js";

type GameCtx = ICtx<GameState, IPhysicsContext>;

const MOVE_SPEED = 3.4;
/** Capsule: total height 2 * (halfHeight + radius) = 1.12 m, centred on the body origin. */
const CAPSULE_HALF_HEIGHT = 0.28;
const CAPSULE_RADIUS = 0.28;
/** How far the solver has to fall short of the asked-for step before it counts as blocked. */
const BLOCKED_FRACTION = 0.45;

export const WARDEN_SPAWN = { x: -4.2, y: 0.62, z: 2.3 } as const;

/**
 * The controlled character: a capsule that pushes, and a figure that leans the way it is pushing.
 *
 * `pushesDynamicBodies` is the whole point of this class. Its default is `false`, which matches
 * Rapier — a character walks into a crate and the crate does not move, which on screen reads as a
 * broken collider rather than as a default someone chose.
 */
export class Warden {
  readonly mesh: Group;
  readonly body: CharacterBody3D;
  #figure: Group;
  #odometer = 0;
  #blockedTicks = 0;
  #previous = new Vector3();
  #hasPrevious = false;
  #facing = 0;

  constructor(ctx: GameCtx, materials: IVaultMaterials) {
    this.mesh = new Group();
    this.mesh.name = "warden";
    this.#figure = wardenFigure(materials);
    // The capsule is centred on the body origin, so a figure modelled standing on y = 0 floats
    // exactly halfHeight + radius above every floor it lands on unless it is offset back down.
    this.#figure.position.y = -(CAPSULE_HALF_HEIGHT + CAPSULE_RADIUS);
    this.mesh.add(this.#figure);
    this.mesh.position.set(WARDEN_SPAWN.x, WARDEN_SPAWN.y, WARDEN_SPAWN.z);
    ctx.add(this.mesh);
    this.body = new CharacterBody3D({
      autostep: { includeDynamicBodies: false, maxHeight: 0.32, minWidth: 0.2 },
      collisionMask: WARDEN_MASK,
      object: this.mesh,
      physics: ctx.physics,
      pushesDynamicBodies: true,
      shape: CollisionShape3D.capsule(CAPSULE_HALF_HEIGHT, CAPSULE_RADIUS),
    });
  }

  /**
   * One fixed step. `move` is the intent in world XZ, already clamped to unit length; the replay
   * check hands the same scripted vector in that the keyboard would have produced.
   */
  update(dt: number, move: { readonly x: number; readonly z: number }): void {
    if (this.#hasPrevious) this.#odometer += this.mesh.position.distanceTo(this.#previous);
    this.#previous.copy(this.mesh.position);
    this.body.velocity.x = move.x * MOVE_SPEED;
    this.body.velocity.z = move.z * MOVE_SPEED;
    const asked = Math.hypot(this.body.velocity.x, this.body.velocity.z) * dt;
    this.body.moveAndSlide(dt);
    this.#hasPrevious = true;
    // `moveAndSlide` queues motion for the bulk step, so `position` still holds the previous
    // transform here; the comparison below is this tick's ask against LAST tick's delivery, which
    // is the honest one-frame-late reading and the only one available before the step runs.
    const delivered = Math.hypot(
      this.mesh.position.x - this.#previous.x,
      this.mesh.position.z - this.#previous.z,
    );
    if (asked > 0.004 && delivered < asked * BLOCKED_FRACTION) this.#blockedTicks += 1;
    if (move.x !== 0 || move.z !== 0) {
      const target = Math.atan2(move.x, move.z);
      // Shortest-arc turn, framerate independent, so the figure faces the shove rather than
      // snapping between the four arrow directions.
      const delta = Math.atan2(Math.sin(target - this.#facing), Math.cos(target - this.#facing));
      this.#facing += delta * (1 - Math.exp(-dt / 0.06));
      this.#figure.rotation.y = this.#facing;
    }
    // Lean into the push. Purely cosmetic, and it is most of what makes the shove read.
    const lean = Math.min(0.28, Math.hypot(move.x, move.z) * 0.28);
    this.#figure.rotation.x += (lean - this.#figure.rotation.x) * (1 - Math.exp(-dt / 0.09));
  }

  teleport(position: { readonly x: number; readonly y: number; readonly z: number }): void {
    this.body.teleport(position);
    this.mesh.position.set(position.x, position.y, position.z);
    this.#previous.copy(this.mesh.position);
    this.#hasPrevious = false;
  }

  get blockedTicks(): number {
    return this.#blockedTicks;
  }

  get odometer(): number {
    return this.#odometer;
  }

  dispose(): void {
    this.body.dispose();
    this.mesh.removeFromParent();
  }
}
