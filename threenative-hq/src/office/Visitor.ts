import type { ICtx } from "@threenative/core";
import { isWeb } from "@threenative/core";
import { CharacterBody3D, CollisionShape3D, type IPhysicsContext } from "@threenative/physics";
import { Group, type PerspectiveCamera, Vector3 } from "three";
import type { GameState } from "../state.js";

type GameCtx = ICtx<GameState, IPhysicsContext>;

const EYE_HEIGHT = 1.62;
const WALK_SPEED = 3.1;
const SPRINT_SPEED = 5.4;
/** Radians per unit of relative pointer motion. */
const LOOK_SENSITIVITY = 0.0016;
const PITCH_LIMIT = Math.PI / 2 - 0.05;
/** The most the view may swing in one frame, in radians. */
const MAX_LOOK_STEP = 0.25;

function clamp(value: number, limit: number): number {
  return Math.max(-limit, Math.min(limit, value));
}

/**
 * Whether relative look should be believed.
 *
 * On the web that means the pointer is locked. Everywhere else the platform delivers relative
 * motion because a stick or a touch drag produced it, and there is nothing to capture.
 */
function lookIsCaptured(): boolean {
  if (!isWeb() || typeof document === "undefined") return true;
  return document.pointerLockElement !== null;
}

/**
 * You, walking around your own office.
 *
 * A capsule that collides with the room's static boxes, and a camera at eye height on top of it.
 * The body is physics-owned so the desks and columns are solid; the look angles are game-owned
 * because framing is a feel decision and nothing in the framework should choose it.
 */
export class Visitor {
  readonly object: Group;
  readonly body: CharacterBody3D;
  #yaw: number;
  #pitch = -0.05;

  constructor(ctx: GameCtx, spawn: Vector3, yaw: number) {
    this.#yaw = yaw;
    this.object = new Group();
    this.object.name = "visitor";
    this.object.position.copy(spawn);
    ctx.add(this.object);
    this.body = new CharacterBody3D({
      autostep: { maxHeight: 0.3, minWidth: 0.2 },
      object: this.object,
      physics: ctx.physics,
      shape: CollisionShape3D.capsule(0.6, 0.32),
      snapToGround: 0.3,
    });
  }

  get yaw(): number {
    return this.#yaw;
  }

  /** Advance the body from input and put the camera on its shoulders. */
  update(ctx: GameCtx, dt: number, camera: PerspectiveCamera): void {
    // Relative look is only meaningful while the pointer is captured. Without this, moving the
    // mouse across the page to reach a button swings the view, and one click anywhere lands the
    // camera facing a wall — the pointer's absolute jump arrives as a huge relative delta.
    if (lookIsCaptured()) {
      const look = ctx.input.vector("look");
      // A single frame may deliver a large jump; a whole turn from one event is never intended.
      const yawDelta = clamp(look.x * LOOK_SENSITIVITY, MAX_LOOK_STEP);
      const pitchDelta = clamp(look.y * LOOK_SENSITIVITY, MAX_LOOK_STEP);
      this.#yaw -= yawDelta;
      // Positive look.y is upward pointer motion on every platform the framework normalises, so
      // the sign here is the only place "inverted mouse" would live.
      this.#pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, this.#pitch + pitchDelta));
    }

    const move = ctx.input.vector("move");
    const speed = ctx.input.pressed("sprint") ? SPRINT_SPEED : WALK_SPEED;
    const forwardX = Math.sin(this.#yaw);
    const forwardZ = Math.cos(this.#yaw);
    // Forward is where the head is pointing; strafe is ninety degrees off it. Both are flattened,
    // so looking at the ceiling never walks you into the floor.
    this.body.velocity.x = (-forwardX * move.y + forwardZ * move.x) * speed;
    this.body.velocity.z = (-forwardZ * move.y - forwardX * move.x) * speed;
    this.body.velocity.y = -9.81 * 0.35;
    this.body.moveAndSlide(dt);

    camera.position.set(this.object.position.x, this.object.position.y + EYE_HEIGHT, this.object.position.z);
    camera.rotation.order = "YXZ";
    camera.rotation.set(this.#pitch, this.#yaw, 0);
  }
}

/**
 * Ask the browser for the mouse.
 *
 * Relative look needs pointer lock, and pointer lock is a browser API with no portable equivalent
 * — so it is guarded by `isWeb()` and does nothing anywhere else. On a native target the same
 * game reads the same relative axis without asking anyone for a lock.
 */
export function capturePointerOnClick(): () => void {
  if (!isWeb() || typeof document === "undefined") return () => undefined;
  const canvas = document.querySelector("canvas");
  if (canvas === null) return () => undefined;
  const request = (): void => {
    if (document.pointerLockElement === null) void canvas.requestPointerLock();
  };
  canvas.addEventListener("click", request);
  return () => canvas.removeEventListener("click", request);
}
