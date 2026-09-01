import type { ICtx } from "@threenative/core";
import { AnimationPlayer, isWeb, normaliseToMetres } from "@threenative/core";
import { CharacterBody3D, CollisionShape3D, type IPhysicsContext } from "@threenative/physics";
import type { AnimationClip } from "three";
import { Group, type Object3D, type PerspectiveCamera, Vector3 } from "three";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import { tintMannequin } from "./mannequin.js";
import type { GameState } from "../state.js";

type GameCtx = ICtx<GameState, IPhysicsContext>;

const EYE_HEIGHT = 1.62;
/** Half the capsule, so the body's feet land on the floor its centre floats above. */
const BODY_DROP = 0.92;
const WALK_SPEED = 3.1;
const SPRINT_SPEED = 5.4;
/** Radians per unit of relative pointer motion. */
const LOOK_SENSITIVITY = 0.0016;
const PITCH_LIMIT = Math.PI / 2 - 0.05;
/** The most the view may swing in one frame, in radians. */
const MAX_LOOK_STEP = 0.25;
/** How close a worker may stand to you: your capsule radius plus a bit of its chest. */
const WORKER_CLEARANCE = 0.75;

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
 *
 * You have no drawn body. An earlier build gave you a mannequin you could look down at, and it
 * spent its days in the frame: a shoulder on every turn, a chest whenever the walk bobbed, and a
 * dark wedge whenever a worker crossed you — first-person bodies are a lens problem more than a
 * feature. The rig still exists and still animates, because the walk measurement and the playtest
 * clip report read from it; it simply never joins the scene graph, so nothing can draw it.
 */
export interface IVisitorOptions {
  readonly source: Group;
  readonly clips: readonly AnimationClip[];
}

export class Visitor {
  readonly object: Group;
  readonly body: CharacterBody3D;
  readonly #rig: Group;
  #head: Object3D | undefined;
  readonly #player: AnimationPlayer;
  #clip = "Idle_Loop";
  #yaw: number;
  #pitch = -0.05;

  constructor(ctx: GameCtx, spawn: Vector3, yaw: number, options: IVisitorOptions) {
    this.#yaw = yaw;
    this.object = new Group();
    this.object.name = "visitor";
    this.object.position.copy(spawn);
    ctx.add(this.object);

    const rig = cloneSkinned(options.source) as Group;
    normaliseToMetres(rig, { metres: 1.8, axis: "height" });
    tintMannequin(rig, 0xc9a227);
    rig.position.y = -BODY_DROP;
    // Deliberately not added to `this.object`: an invisible lens-width body is worse than none.
    this.#rig = rig;
    this.#head = rig.getObjectByName("Head");
    this.#player = new AnimationPlayer({
      clips: options.clips,
      root: rig,
      strideRoot: this.object,
    });
    this.#player.play(this.#clip);
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

  /** The animated but never drawn body, for measurements that want a bone. */
  get rigRoot(): Group {
    return this.#rig;
  }

  /**
   * Advance the body from input and put the camera on its shoulders.
   *
   * `obstacles` carries the positions of the room's workers. They are solid: without this a
   * worker — or a worker walking out through the door you spawned at — can end up with its chest
   * pressed against the lens, which fills the whole frame with a dark blur that reads as your own
   * body wedged into the camera. The push is horizontal and small, so it feels like shoulder-to-
   * shoulder contact, not a force field.
   */
  update(ctx: GameCtx, dt: number, camera: PerspectiveCamera, obstacles?: readonly Vector3[]): void {
    // Relative look is only meaningful while the pointer is captured. Without this, moving the
    // mouse across the page to reach a button swings the view, and one click anywhere lands the
    // camera facing a wall — the pointer's absolute jump arrives as a huge relative delta.
    if (lookIsCaptured()) {
      const look = ctx.input.vector("look");
      // A single frame may deliver a large jump; a whole turn from one event is never intended.
      const yawDelta = clamp(look.x * LOOK_SENSITIVITY, MAX_LOOK_STEP);
      const pitchDelta = clamp(look.y * LOOK_SENSITIVITY, MAX_LOOK_STEP);
      this.#yaw -= yawDelta;
      // Push the mouse forward and the view goes up. The framework reports upward pointer motion
      // as positive, and this game subtracts it — the opposite convention read as inverted.
      this.#pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, this.#pitch - pitchDelta));
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
    if (obstacles !== undefined) {
      for (const obstacle of obstacles) {
        const awayX = this.object.position.x - obstacle.x;
        const awayZ = this.object.position.z - obstacle.z;
        const distance = Math.hypot(awayX, awayZ);
        if (distance >= WORKER_CLEARANCE) continue;
        if (distance < 1e-3) {
          // Dead centre: there is no away vector, so pick one — the body's own right — and let
          // the next frames' normal push carry the separation the rest of the way.
          this.object.position.x += Math.cos(this.#yaw) * WORKER_CLEARANCE;
          this.object.position.z -= Math.sin(this.#yaw) * WORKER_CLEARANCE;
          continue;
        }
        const push = (WORKER_CLEARANCE - distance) / distance;
        this.object.position.x += awayX * push;
        this.object.position.z += awayZ * push;
      }
    }

    // The body turns with the view; the rig keeps time with it off screen.
    this.#rig.rotation.y = Math.PI;
    this.object.rotation.y = this.#yaw;
    const moving = Math.hypot(this.body.velocity.x, this.body.velocity.z) > 0.2;
    const wanted = moving ? (speed > WALK_SPEED ? "Jog_Fwd_Loop" : "Walk_Loop") : "Idle_Loop";
    if (wanted !== this.#clip) {
      this.#clip = wanted;
      this.#player.play(wanted, { fade: 0.18 });
    }
    this.#player.update(dt);

    // Eyes at a fixed height above the capsule centre. The skeleton used to measure this, which
    // mattered when the lens had to stay out of its own head; with no drawn body a constant is
    // the honest answer, and the capsule's ground drift is a centimetre at most.
    camera.position.set(this.object.position.x, this.object.position.y - BODY_DROP + EYE_HEIGHT, this.object.position.z);
    camera.rotation.order = "YXZ";
    camera.rotation.set(this.#pitch, this.#yaw, 0);
    void this.#head;
  }

  /** The clip the body is playing, so a proof can see you walk rather than glide. */
  get clip(): string | undefined {
    return this.#player.current;
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
