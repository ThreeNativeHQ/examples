import type { ICtx } from "@threenative/core";
import { CharacterBody3D, CollisionShape3D, type IPhysicsContext } from "@threenative/physics";
import { BoxGeometry, MathUtils, Mesh, MeshBasicMaterial, type PerspectiveCamera, Vector3 } from "three";
import { FIRING_LINE_Z } from "../render/range.js";
import { scale } from "../render/scale.js";
import type { GameState } from "../state.js";

type GameCtx = ICtx<GameState, IPhysicsContext>;

export const EYE_HEIGHT = scale.eyeHeight;
const WALK_SPEED = 5.6;
const SPRINT_SPEED = 8.2;
const FOV_HIP = 70;
const FOV_AIM = 22;
const PITCH_MIN = MathUtils.degToRad(-66);
const PITCH_MAX = MathUtils.degToRad(72);
const LOOK_SENSITIVITY = 0.0022;
const CAPSULE_RADIUS = scale.shoulderWidth / 2;
const CAPSULE_HALF = (scale.humanHeight - CAPSULE_RADIUS * 2) / 2;
const BODY_Y = scale.humanHeight / 2;
const SPAWN = { x: 0.2, y: BODY_Y, z: FIRING_LINE_Z } as const;

/**
 * Yaw and pitch, integrated from the `look` action. The action is bound
 * `pointerRelative`, so `ctx.input.vector("look")` is the mouse delta for the tick
 * in canvas pixels — the framework owns the pointer lock and the native equivalent,
 * and nothing here touches the DOM.
 */
class Look {
  yaw = 0;
  pitch = 0;

  consume(ctx: GameCtx, scale: number): void {
    if (!ctx.input.raw.pointer.captured) return;
    const delta = ctx.input.vector("look");
    this.yaw -= delta.x * LOOK_SENSITIVITY * scale;
    this.pitch = MathUtils.clamp(
      this.pitch - delta.y * LOOK_SENSITIVITY * scale,
      PITCH_MIN,
      PITCH_MAX,
    );
  }
}

export class FpsPlayer {
  readonly mesh: Mesh;
  readonly body: CharacterBody3D;
  readonly look = new Look();
  health = 100;
  distanceMoved = 0;
  aiming = false;
  #camera: PerspectiveCamera;
  #fov = FOV_HIP;
  #lastX: number = SPAWN.x;
  #lastZ: number = SPAWN.z;
  #shake = 0;
  #shakePhase = 0;

  constructor(ctx: GameCtx, camera: PerspectiveCamera) {
    this.#camera = camera;
    this.mesh = new Mesh(
      new BoxGeometry(CAPSULE_RADIUS * 2, BODY_Y * 2, CAPSULE_RADIUS * 2),
      new MeshBasicMaterial({ visible: false }),
    );
    this.mesh.name = "player";
    this.mesh.position.set(SPAWN.x, SPAWN.y, SPAWN.z);
    ctx.add(this.mesh);
    this.body = new CharacterBody3D({
      autostep: { maxHeight: 0.45, minWidth: 0.2 },
      object: this.mesh,
      physics: ctx.physics,
      shape: CollisionShape3D.capsule(CAPSULE_RADIUS, CAPSULE_HALF),
    });
    // Face down range with the nearest centre-lane plate on the crosshair.
    this.look.yaw = 0;
    this.look.pitch = 0;
    camera.fov = FOV_HIP;
    camera.near = 0.02;
    camera.far = 240;
    camera.updateProjectionMatrix();
    this.syncCamera();
  }

  get eye(): { x: number; y: number; z: number } {
    return {
      x: this.mesh.position.x,
      y: this.mesh.position.y + scale.eyeHeight - BODY_Y,
      z: this.mesh.position.z,
    };
  }

  /** The camera basis is the single source of aim truth, including hit shake. */
  aimRay(): { origin: Vector3; direction: Vector3 } {
    this.#camera.updateMatrixWorld(true);
    return {
      origin: this.#camera.getWorldPosition(new Vector3()),
      direction: this.#camera.getWorldDirection(new Vector3()).normalize(),
    };
  }

  syncCamera(): void {
    const eye = this.eye;
    // A hit shoves the view; it decays back to the aim within about a third of
    // a second, so the shake never fights the player for control.
    const kick = this.#shake * this.#shake;
    this.#camera.position.set(eye.x, eye.y, eye.z);
    this.#camera.rotation.set(
      this.look.pitch + Math.sin(this.#shakePhase * 37) * 0.05 * kick,
      this.look.yaw + Math.sin(this.#shakePhase * 23) * 0.05 * kick,
      Math.sin(this.#shakePhase * 17) * 0.04 * kick,
      "YXZ",
    );
  }

  update(ctx: GameCtx, dt: number, canAim: boolean): void {
    this.aiming = canAim && ctx.input.pressed("aim");
    // Mouse look is half as sensitive down the sights.
    this.look.consume(ctx, this.aiming ? 0.5 : 1);

    const move = ctx.input.vector("move");
    const sprinting = ctx.input.pressed("sprint") && !this.aiming;
    const speed = sprinting ? SPRINT_SPEED : WALK_SPEED;
    // `vector().y` is +up; forward on this ground plane is -z.
    const forwardX = -Math.sin(this.look.yaw);
    const forwardZ = -Math.cos(this.look.yaw);
    const rightX = Math.cos(this.look.yaw);
    const rightZ = -Math.sin(this.look.yaw);
    let vx = forwardX * move.y + rightX * move.x;
    let vz = forwardZ * move.y + rightZ * move.x;
    const length = Math.hypot(vx, vz);
    if (length > 1e-4) {
      vx = (vx / length) * speed;
      vz = (vz / length) * speed;
    } else {
      vx = 0;
      vz = 0;
    }
    // The backend writes the solved transform after the step, so measuring the
    // mesh either side of `moveAndSlide` in one frame always reads zero. Compare
    // against the previous frame's written position instead.
    this.distanceMoved += Math.hypot(
      this.mesh.position.x - this.#lastX,
      this.mesh.position.z - this.#lastZ,
    );
    this.#lastX = this.mesh.position.x;
    this.#lastZ = this.mesh.position.z;
    this.body.velocity.x = vx;
    this.body.velocity.z = vz;
    this.body.moveAndSlide(dt);

    this.#shake = Math.max(0, this.#shake - dt * 3.2);
    this.#shakePhase += dt;

    const wanted = this.aiming ? FOV_AIM : FOV_HIP;
    this.#fov = MathUtils.damp(this.#fov, wanted, 14, dt);
    if (Math.abs(this.#camera.fov - this.#fov) > 0.01) {
      this.#camera.fov = this.#fov;
      this.#camera.updateProjectionMatrix();
    }
    this.syncCamera();
  }

  hurt(amount: number): void {
    this.health = Math.max(0, this.health - amount);
    this.#shake = Math.min(1, this.#shake + 0.55);
  }

  debug(): { health: number; position: number[]; positionY: number; yaw: number; aimDivergenceDeg: number } {
    const aim = this.aimRay();
    const cameraDirection = this.#camera.getWorldDirection(new Vector3()).normalize();
    return {
      health: this.health,
      position: this.mesh.position.toArray(),
      positionY: this.mesh.position.y,
      yaw: this.look.yaw,
      aimDivergenceDeg: MathUtils.radToDeg(aim.direction.angleTo(cameraDirection)),
    };
  }

  dispose(): void {
    this.body.dispose();
    this.mesh.removeFromParent();
  }
}
