import type { ICtx } from "@threenative/core";
import { isWeb } from "@threenative/core";
import { CharacterBody3D, CollisionShape3D, type IPhysicsContext } from "@threenative/physics";
import { Group, type PerspectiveCamera } from "three";
import { WATER_LEVEL, heightAt } from "../render/terrain.js";
import type { GameState } from "../state.js";

type GameCtx = ICtx<GameState, IPhysicsContext>;

/** Eye height above the soles, in metres. */
const EYE_HEIGHT = 1.66;
/** Half the capsule plus its cap: the distance from the body origin down to the feet. */
const BODY_DROP = 0.9;
const WALK_SPEED = 3.4;
const SPRINT_SPEED = 6.2;
/** Wading is slow, and the slowness is the point: the lake is a barrier, not a shortcut. */
const WADE_SPEED = 1.5;
const JUMP_SPEED = 5.2;
/**
 * Signed vertical acceleration, handed to the character body rather than integrated here.
 * `CharacterBody3D` adds it to `velocity.y` inside every `moveAndSlide`, so a second hand-rolled
 * integration in `update` would apply gravity twice and make the walker fall at double weight.
 * Twice earth, because a real-gravity first-person jump hangs long enough to feel like low orbit.
 */
const GRAVITY = -19.6;
/** Anything steeper than this is a cliff, and the controller refuses to climb it. */
const MAX_CLIMB = (50 * Math.PI) / 180;
/** Radians per unit of relative pointer motion. */
const LOOK_SENSITIVITY = 0.0017;
const PITCH_LIMIT = Math.PI / 2 - 0.04;
/** The most the view may swing in one frame. A whole turn from one event is never intended. */
const MAX_LOOK_STEP = 0.25;

function clamp(value: number, limit: number): number {
  return Math.max(-limit, Math.min(limit, value));
}

/**
 * Whether relative look should be believed.
 *
 * On the web that means the pointer is locked. Everywhere else the platform delivers relative
 * motion because a stick or a touch drag produced it, and there is nothing to capture. Without
 * this gate, moving the mouse across the page to reach a button swings the view, and one click
 * anywhere lands the camera facing the ground — the pointer's absolute jump arrives as a single
 * enormous relative delta.
 */
function lookIsCaptured(): boolean {
  if (!isWeb() || typeof document === "undefined") return true;
  return document.pointerLockElement !== null;
}

/**
 * You, on foot in the wood.
 *
 * A physics capsule with a camera at eye height on top of it, and no drawn body at all. The body
 * is physics-owned so the ground is genuinely solid — the character controller climbs what it can
 * climb and refuses what it cannot, which is what makes the ridge a climb rather than a texture.
 * The look angles are game-owned, because framing is a feel decision and no framework should pick
 * it.
 *
 * The head bob is the one piece of flourish here and it earns its place: with no visible body and
 * no footstep audio, a perfectly steady camera translating across a hillside reads as a drone, not
 * a person. Two sine waves — one vertical at twice the stride rate, one lateral at the stride rate
 * — are enough to put someone's weight back on the ground.
 */
export class Wanderer {
  readonly object: Group;
  readonly body: CharacterBody3D;
  #yaw: number;
  #pitch = -0.06;
  #bob = 0;
  #odometer = 0;
  /**
   * Where the body was at the end of the last frame.
   *
   * The odometer has to be measured **across** frames, not around the `moveAndSlide` call.
   * `moveAndSlide` only queues motion for the shared bulk physics step: the solver writes the
   * transform afterwards, so `position` read immediately after the call is still the position from
   * before it, and a before/after difference taken inside one frame is always exactly zero. That
   * reads as a walker who never moves while visibly walking — the odometer sat at 0 through a
   * twelve-second walk and the playtest is what caught it.
   */
  #lastX: number;
  #lastZ: number;

  constructor(ctx: GameCtx, x: number, z: number, yaw: number) {
    this.#yaw = yaw;
    this.object = new Group();
    this.object.name = "wanderer";
    // Spawn a little above the surface and let gravity settle it. Spawning exactly on the ground
    // can start the capsule interpenetrating the heightfield, which the solver resolves by
    // ejecting it upward — a launch on frame one that reads as a bug in the terrain.
    this.object.position.set(x, heightAt(x, z) + BODY_DROP + 0.4, z);
    this.#lastX = x;
    this.#lastZ = z;
    ctx.add(this.object);

    this.body = new CharacterBody3D({
      // Half a metre of autostep, which is more than a doorway needs and exactly what a root
      // buttress or a stone kerb needs. Without it the walk snags on scenery you can see over.
      autostep: { maxHeight: 0.5, minWidth: 0.2 },
      gravity: GRAVITY,
      // The valley was authored against this number: every landmark has a route from the trailhead
      // whose worst gradient is under it, and the cliffs on the ridge's north face are over it.
      maxSlopeClimbAngle: MAX_CLIMB,
      object: this.object,
      physics: ctx.physics,
      shape: CollisionShape3D.capsule(0.62, 0.3),
      // Keeps the feet on a hillside while walking downhill. Without it, every convex break in
      // the ground launches the body and the camera judders down the slope.
      snapToGround: 0.4,
    });
  }

  get yaw(): number {
    return this.#yaw;
  }

  /** Compass heading in degrees, north at zero, clockwise. */
  get heading(): number {
    return (((-this.#yaw * 180) / Math.PI) % 360 + 360) % 360;
  }

  /** Metres walked, for the HUD and for a proof that the walk actually happened. */
  get odometer(): number {
    return this.#odometer;
  }

  /** Where the soles are, which is what every ground measurement wants. */
  get feetY(): number {
    return this.object.position.y - BODY_DROP;
  }

  /**
   * How far the feet are above the analytic ground beneath them.
   *
   * This is the scene's cheapest guard against the collider and the drawn surface disagreeing.
   * Rapier stores a heightfield column-major with rows running along z; transpose that and the
   * collider becomes the terrain reflected about its diagonal — which looks perfectly fine from
   * above and drops the player through the floor everywhere else. A gap that stays near zero
   * while walking is proof the two agree, and the walk playtest asserts on exactly this.
   */
  get groundGap(): number {
    return this.feetY - heightAt(this.object.position.x, this.object.position.z);
  }

  /** True when the soles are below the waterline. */
  get wading(): boolean {
    return this.feetY < WATER_LEVEL + 0.35;
  }

  update(ctx: GameCtx, dt: number, camera: PerspectiveCamera): void {
    if (lookIsCaptured()) {
      const look = ctx.input.vector("look");
      this.#yaw -= clamp(look.x * LOOK_SENSITIVITY, MAX_LOOK_STEP);
      // Push the mouse forward and the view goes up. The framework reports upward pointer motion
      // as positive and this game subtracts it; the opposite convention reads as inverted.
      this.#pitch = Math.max(
        -PITCH_LIMIT,
        Math.min(PITCH_LIMIT, this.#pitch - clamp(look.y * LOOK_SENSITIVITY, MAX_LOOK_STEP)),
      );
    }

    const move = ctx.input.vector("move");
    const wading = this.wading;
    const speed = wading ? WADE_SPEED : ctx.input.pressed("sprint") ? SPRINT_SPEED : WALK_SPEED;
    const forwardX = Math.sin(this.#yaw);
    const forwardZ = Math.cos(this.#yaw);
    // Forward is where the head points; strafe is ninety degrees off it. Both flattened, so
    // looking at the canopy never walks you into the ground. `move.y` is +up, hence the negation.
    this.body.velocity.x = (-forwardX * move.y + forwardZ * move.x) * speed;
    this.body.velocity.z = (-forwardZ * move.y - forwardX * move.x) * speed;

    // Vertical motion is the body's, not this file's: `moveAndSlide` integrates `gravity` itself.
    // All that is decided here is what the vertical velocity should be *at* the moment the feet
    // are on something — a jump, or a small constant push into the slope. Letting gravity keep
    // accumulating while grounded builds a fall speed that makes walking downhill feel like
    // sliding, and leaves `velocity.y` at terminal the instant the ground runs out.
    const grounded = this.body.grounded;
    if (grounded) {
      this.body.velocity.y = !wading && ctx.input.justPressed("jump") ? JUMP_SPEED : -2;
    }

    // Measured from the last frame's end position, before this frame's step is queued — see the
    // note on `#lastX`. Everything downstream that asks "am I walking" reads this, not velocity:
    // the solver reports velocity while the body is pressed against a slope it cannot climb.
    const travelled = Math.hypot(
      this.object.position.x - this.#lastX,
      this.object.position.z - this.#lastZ,
    );
    this.#odometer += travelled;
    this.#lastX = this.object.position.x;
    this.#lastZ = this.object.position.z;
    this.body.moveAndSlide(dt);

    // Bob only while actually moving across the ground: the solver may report velocity while the
    // body is pressed against a slope it cannot climb, and bobbing there looks like walking on
    // the spot.
    const striding = travelled > 0.004 && grounded;
    this.#bob += striding ? dt * (speed > WALK_SPEED ? 11 : 7.4) : -this.#bob * Math.min(1, dt * 8);
    const amplitude = striding ? (speed > WALK_SPEED ? 0.055 : 0.032) : 0;
    const bobY = Math.sin(this.#bob * 2) * amplitude;
    const bobX = Math.sin(this.#bob) * amplitude * 0.75;

    this.object.rotation.y = this.#yaw;
    camera.position.set(
      this.object.position.x + Math.cos(this.#yaw) * bobX,
      this.object.position.y - BODY_DROP + EYE_HEIGHT + bobY,
      this.object.position.z - Math.sin(this.#yaw) * bobX,
    );
    camera.rotation.order = "YXZ";
    // The lateral bob leans the head as well as moving it. Two degrees at most — enough to feel,
    // not enough to notice.
    camera.rotation.set(this.#pitch, this.#yaw, bobX * 0.6);
  }

  /** Put the walker back at the trailhead, upright and facing north. */
  respawn(x: number, z: number): void {
    this.body.teleport({ x, y: heightAt(x, z) + BODY_DROP + 0.4, z });
    this.body.velocity.set(0, 0, 0);
    // Or the teleport's jump is counted as a stride and the odometer gains the whole valley.
    this.#lastX = x;
    this.#lastZ = z;
  }
}

/**
 * Ask the browser for the mouse.
 *
 * Relative look needs pointer lock, and pointer lock is a browser API with no portable equivalent
 * — so it is guarded by `isWeb()` and does nothing anywhere else. On a native target the same game
 * reads the same relative axis without asking anyone for a lock.
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
