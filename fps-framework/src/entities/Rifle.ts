import { AnimationPlayer, type ICtx } from "@threenative/core";
import type { IPhysicsContext } from "@threenative/physics";
import {
  AdditiveBlending,
  type AnimationClip,
  Group,
  Mesh,
  MeshBasicMaterial,
  type Object3D,
  type PerspectiveCamera,
  PlaneGeometry,
  PointLight,
  type Scene as ThreeScene,
  Vector3,
} from "three";
import { softCircleTexture } from "../render/particles.js";
import type { GameState } from "../state.js";

type GameCtx = ICtx<GameState, IPhysicsContext>;

export const MAGAZINE = 30;
export const RESERVE = 90;
const RELOAD_SECONDS = 0.7;

/**
 * Hip and aimed rest poses, in camera space. The shipped viewmodel is authored
 * at life scale pointing +z with its origin at the shoulder, so the only fixed
 * correction is a half turn; everything else is pose.
 */
const HIP = { x: 0.3, y: -0.36, z: -0.15, pitch: -0.03, yaw: 0.12, roll: 0.04 };
// Down the sights the optic has to sit on the camera axis. The optic centre
// measured off the asset is (-0.06, 0.21, 0.34) in model space, so the pose is
// that offset negated on x and y; z leaves it 0.34 m in front of the lens.
const AIM = { x: -0.053, y: -0.238, z: -0.16, pitch: 0.0, yaw: 0.0, roll: 0.0 };

export class Rifle {
  ammo = MAGAZINE;
  reserve = RESERVE;
  shots = 0;
  reloads = 0;
  reloading = false;
  readonly group = new Group();
  #flash: Mesh;
  #flashLife = 0;
  #light: PointLight;
  #smokeMaterial: MeshBasicMaterial;
  #smoke: { life: number; drift: Vector3; mesh: Mesh }[];
  #smokeCursor = 0;
  #muzzleWorld = new Vector3();
  #kick = 0;
  #blend = 0;
  #sway = 0;
  #lowered = 0;

  #animation: AnimationPlayer | undefined;
  #clips: ReadonlySet<string>;
  #shootFor = 0;

  constructor(
    camera: PerspectiveCamera,
    viewmodel: Object3D,
    clips: readonly AnimationClip[] = [],
    scene: ThreeScene,
  ) {
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
    const fit = new Group();
    fit.rotation.y = Math.PI;
    fit.add(viewmodel);
    this.group.add(fit);
    this.#clips = new Set(clips.map((clip) => clip.name));
    if (clips.length > 0) {
      this.#animation = new AnimationPlayer({ clips, root: fit });
      this.#play("Idle", 0);
    }
    this.group.renderOrder = 20;
    this.#flash = new Mesh(
      new PlaneGeometry(0.6, 0.6),
      new MeshBasicMaterial({
        blending: AdditiveBlending,
        color: 0xffd9a0,
        depthWrite: false,
        map: softCircleTexture(64, 0.45),
        transparent: true,
      }),
    );
    this.#flash.position.set(0.02, 0.02, -1.35);
    this.#flash.visible = false;
    this.#flash.renderOrder = 30;
    this.group.add(this.#flash);
    // The flash has to light the hands and the barrel, not just draw over them.
    // The light stays in the scene for the whole run with its intensity driven to zero.
    // Toggling `visible` changes the lighting setup, which makes the renderer rebuild every
    // material pipeline that uses it — measured at up to a 1.2 s freeze on the first shot.
    this.#light = new PointLight(0xffc46a, 0, 6, 2);
    this.#light.position.copy(this.#flash.position);
    this.group.add(this.#light);
    // Smoke lives in world space, not on the camera, so it stays where it was made when you
    // turn — smoke welded to the viewmodel slides with the view and reads as a bug.
    this.#smokeMaterial = new MeshBasicMaterial({
      color: 0xc3c8d0,
      depthWrite: false,
      map: softCircleTexture(64, 0.05),
      opacity: 0.42,
      transparent: true,
    });
    this.#smoke = Array.from({ length: 8 }, () => {
      const puff = new Mesh(new PlaneGeometry(0.22, 0.22), this.#smokeMaterial.clone());
      puff.visible = false;
      puff.renderOrder = 29;
      scene.add(puff);
      return { life: 0, drift: new Vector3(), mesh: puff };
    });
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
    this.#shootFor = 0.12;
    this.#play("Shoot", 0.02);
    this.#flashLife = 0.06;
    this.#flash.visible = true;
    this.#flash.rotation.z = this.shots * 1.7;
    this.#flash.scale.setScalar(0.8 + ((this.shots * 37) % 10) / 14);
    this.#light.intensity = 14;
    this.#spawnSmoke();
    return true;
  }

  /** Muzzle position in world space, for tracers and smoke. */
  muzzleWorld(): Vector3 {
    return this.#flash.getWorldPosition(new Vector3());
  }

  /** Two puffs at the muzzle, in world space so they hang in the air as the view turns. */
  #spawnSmoke(): void {
    this.#flash.getWorldPosition(this.#muzzleWorld);
    for (let index = 0; index < 2; index += 1) {
      const slot = this.#smoke[this.#smokeCursor % this.#smoke.length];
      this.#smokeCursor += 1;
      if (slot === undefined) continue;
      slot.mesh.position.copy(this.#muzzleWorld);
      const spin = this.shots * 2.399 + index;
      slot.drift.set(Math.sin(spin) * 0.24, 0.5 + ((index * 7) % 3) * 0.1, Math.cos(spin) * 0.24);
      slot.mesh.scale.setScalar(0.2);
      (slot.mesh.material as MeshBasicMaterial).opacity = 0.42;
      slot.mesh.visible = true;
      slot.life = 0.6;
    }
  }

  /** Drift, grow and fade the muzzle smoke. `eye` keeps the billboards facing the camera. */
  updateSmoke(dt: number, eye: Vector3): void {
    for (const puff of this.#smoke) {
      if (puff.life <= 0) continue;
      puff.life -= dt;
      puff.mesh.position.addScaledVector(puff.drift, dt);
      puff.mesh.scale.setScalar(0.2 + (0.6 - puff.life) * 1.1);
      (puff.mesh.material as MeshBasicMaterial).opacity = Math.max(0, puff.life * 0.6);
      puff.mesh.lookAt(eye);
      if (puff.life <= 0) puff.mesh.visible = false;
    }
  }

  reload(ctx: GameCtx): void {
    if (this.reloading || this.reserve <= 0 || this.ammo >= MAGAZINE) return;
    this.reloading = true;
    this.#play("Reload", 0.05);
    ctx.after(RELOAD_SECONDS, () => {
      const moved = Math.min(MAGAZINE - this.ammo, this.reserve);
      this.ammo += moved;
      this.reserve -= moved;
      this.reloads += 1;
      this.reloading = false;
    });
  }

  #play(name: string, fade = 0.14): void {
    if (this.#animation === undefined || !this.#clips.has(name)) return;
    if (this.#animation.current === name) return;
    this.#animation.play(name, { fade });
  }

  update(dt: number, aiming: boolean, moving: number): void {
    this.#shootFor = Math.max(0, this.#shootFor - dt);
    if (this.reloading) this.#play("Reload");
    else if (this.#shootFor > 0) this.#play("Shoot", 0.02);
    else if (moving > 0.6) this.#play("Run");
    else if (moving > 0.05) this.#play("Walk");
    else this.#play("Idle");
    this.#animation?.update(dt);
    this.#flashLife = Math.max(0, this.#flashLife - dt);
    this.#flash.visible = this.#flashLife > 0;
    this.#light.intensity = Math.max(0, this.#light.intensity - dt * 150);
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
    this.#animation?.dispose();
    this.group.removeFromParent();
  }
}
