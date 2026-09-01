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
/**
 * The lens sits on the body's own turning axis, not in front of it.
 *
 * Any forward offset puts the camera on an arm: the body pivots in place, the camera swings, and a
 * shoulder sweeps through the frame every time you turn or the run cycle rolls. On the axis, the
 * body rotates around the lens and only what is genuinely below it — chest, arms, legs — is ever
 * in shot.
 */
const EYE_FORWARD = 0;
const WALK_SPEED = 3.1;
const SPRINT_SPEED = 5.4;
/** Radians per unit of relative pointer motion. */
const LOOK_SENSITIVITY = 0.0016;
const PITCH_LIMIT = Math.PI / 2 - 0.05;
const HEAD_AT = new Vector3();
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

    // You have a body. Look down and it is there; the office is a place you are standing in
    // rather than a camera flying through it.
    const rig = cloneSkinned(options.source) as Group;
    normaliseToMetres(rig, { metres: 1.8, axis: "height" });
    tintMannequin(rig, 0xc9a227);
    rig.position.y = -BODY_DROP;
    // Your own head is behind the lens, and a head behind the lens is a head *through* the lens
    // the moment you look down or the walk cycle bobs. Shrink it away and keep the rest: arms,
    // legs and the shadow you cast are the point of having a body at all.
    // The head and the neck are where the lens is. Shrink them away rather than moving the camera
    // out of the body, which is what put a shoulder in the frame on every turn. The bones keep
    // their positions, and the camera rides the head one.
    this.#head = rig.getObjectByName("Head");
    for (const name of ["Head", "neck_01"]) rig.getObjectByName(name)?.scale.setScalar(0.001);
    this.object.add(rig);
    this.#rig = rig;
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

    // The body turns with the view; only the head pitches, because a mannequin bent backwards at
    // the waist is not what looking up looks like.
    this.#rig.rotation.y = Math.PI;
    this.object.rotation.y = this.#yaw;
    const moving = Math.hypot(this.body.velocity.x, this.body.velocity.z) > 0.2;
    const wanted = moving ? (speed > WALK_SPEED ? "Jog_Fwd_Loop" : "Walk_Loop") : "Idle_Loop";
    if (wanted !== this.#clip) {
      this.#clip = wanted;
      this.#player.play(wanted, { fade: 0.18 });
    }
    this.#player.update(dt);

    // Eyes just in front of the head, so the body is under you and never through the lens.
    // Eye height comes from the skeleton, not from a constant: the capsule's centre drifts with
    // the ground under it, and a lens placed a fixed distance above that ends up in the chest.
    // Measured before this changed: the lens sat 0.13 m below the head bone, which is exactly how
    // much of your own torso was in the frame.
    const head = this.#head;
    let eyeY = this.object.position.y - BODY_DROP + EYE_HEIGHT;
    if (head !== undefined) {
      head.updateWorldMatrix(true, false);
      eyeY = HEAD_AT.setFromMatrixPosition(head.matrixWorld).y;
    }
    camera.position.set(
      this.object.position.x - Math.sin(this.#yaw) * EYE_FORWARD,
      eyeY,
      this.object.position.z - Math.cos(this.#yaw) * EYE_FORWARD,
    );
    camera.rotation.order = "YXZ";
    camera.rotation.set(this.#pitch, this.#yaw, 0);
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
