import type { ICtx } from "@threenative/core";
import type { IPhysicsContext } from "@threenative/physics";
import {
  AdditiveBlending,
  Box3,
  Group,
  Mesh,
  MeshBasicMaterial,
  type Object3D,
  type PerspectiveCamera,
  PlaneGeometry,
  Vector3,
} from "three";
import type { GameState } from "../state.js";

type GameCtx = ICtx<GameState, IPhysicsContext>;

export const MAGAZINE = 30;
export const RESERVE = 90;
const RELOAD_SECONDS = 0.7;

/** Hip and aimed rest poses for the viewmodel, in camera space. */
const HIP = { x: 0.29, y: -0.29, z: -0.5, pitch: 0.02, yaw: -0.06, roll: 0.0 };
const AIM = { x: 0.0, y: -0.145, z: -0.34, pitch: 0.0, yaw: 0.0, roll: 0.0 };

export class Rifle {
  ammo = MAGAZINE;
  reserve = RESERVE;
  shots = 0;
  reloads = 0;
  reloading = false;
  readonly group = new Group();
  #flash: Mesh;
  #flashLife = 0;
  #kick = 0;
  #blend = 0;
  #sway = 0;
  #lowered = 0;

  constructor(camera: PerspectiveCamera, viewmodel: Object3D) {
    viewmodel.traverse((object) => {
      object.castShadow = false;
      object.receiveShadow = false;
      object.frustumCulled = false;
      // The viewmodel is drawn over the world, so nothing in the yard can clip it.
      const mesh = object as Mesh;
      if (mesh.isMesh === true) mesh.renderOrder = 20;
    });
    // The shipped viewmodel arrives at an unknown scale and orientation, so it is
    // measured and normalised: longest axis 0.9 m, lying down -z, origin at the
    // rear of the receiver where a held rifle pivots.
    const bounds = new Box3().setFromObject(viewmodel);
    const size = bounds.getSize(new Vector3());
    const centre = bounds.getCenter(new Vector3());
    const longest = Math.max(size.x, size.y, size.z);
    const fit = new Group();
    viewmodel.position.sub(centre);
    fit.add(viewmodel);
    fit.scale.setScalar(0.9 / Math.max(longest, 1e-6));
    if (size.x === longest) fit.rotation.y = Math.PI / 2;
    else if (size.y === longest) fit.rotation.x = Math.PI / 2;
    this.group.add(fit);
    this.group.renderOrder = 20;
    this.#flash = new Mesh(
      new PlaneGeometry(0.34, 0.34),
      new MeshBasicMaterial({
        blending: AdditiveBlending,
        color: 0xffd9a0,
        depthWrite: false,
        transparent: true,
      }),
    );
    this.#flash.position.set(0.02, 0.02, -1.35);
    this.#flash.visible = false;
    this.#flash.renderOrder = 30;
    this.group.add(this.#flash);
    camera.add(this.group);
    this.#apply(0, 0);
  }

  get ready(): boolean {
    return !this.reloading && this.ammo > 0;
  }

  /** One round per press: the scene only calls this on `justPressed`. */
  fire(): boolean {
    if (!this.ready) return false;
    this.ammo -= 1;
    this.shots += 1;
    this.#kick = 1;
    this.#flashLife = 0.05;
    this.#flash.visible = true;
    this.#flash.rotation.z = this.shots * 1.7;
    return true;
  }

  reload(ctx: GameCtx): void {
    if (this.reloading || this.reserve <= 0 || this.ammo >= MAGAZINE) return;
    this.reloading = true;
    ctx.after(RELOAD_SECONDS, () => {
      const moved = Math.min(MAGAZINE - this.ammo, this.reserve);
      this.ammo += moved;
      this.reserve -= moved;
      this.reloads += 1;
      this.reloading = false;
    });
  }

  update(dt: number, aiming: boolean, moving: number): void {
    this.#flashLife = Math.max(0, this.#flashLife - dt);
    this.#flash.visible = this.#flashLife > 0;
    this.#kick = Math.max(0, this.#kick - dt * 7);
    // The sights drop while the magazine is out and come back up after.
    const wantLowered = this.reloading ? 1 : 0;
    this.#lowered += (wantLowered - this.#lowered) * Math.min(1, dt * 9);
    this.#blend += ((aiming && !this.reloading ? 1 : 0) - this.#blend) * Math.min(1, dt * 12);
    this.#sway += dt * (2.6 + moving * 4.4);
    this.#apply(moving, dt);
  }

  #apply(moving: number, _dt: number): void {
    const t = this.#blend;
    const bob = Math.sin(this.#sway) * 0.008 * (0.35 + moving);
    const bobY = Math.abs(Math.cos(this.#sway)) * 0.01 * (0.25 + moving);
    const kick = this.#kick * this.#kick;
    this.group.position.set(
      HIP.x + (AIM.x - HIP.x) * t + bob,
      HIP.y + (AIM.y - HIP.y) * t + bobY - this.#lowered * 0.34,
      HIP.z + (AIM.z - HIP.z) * t + kick * 0.045,
    );
    this.group.rotation.set(
      HIP.pitch + (AIM.pitch - HIP.pitch) * t - kick * 0.05 + this.#lowered * 0.5,
      HIP.yaw + (AIM.yaw - HIP.yaw) * t,
      HIP.roll + (AIM.roll - HIP.roll) * t + this.#lowered * 0.18,
    );
  }

  dispose(): void {
    this.group.removeFromParent();
  }
}
