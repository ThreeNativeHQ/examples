import { AnimationPlayer, type ICtx } from "@threenative/core";
import type { IPhysicsContext } from "@threenative/physics";
import {
  AdditiveBlending,
  Box3,
  type AnimationClip,
  ConeGeometry,
  Group,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  type Object3D,
  type PerspectiveCamera,
  PlaneGeometry,
  PointLight,
  Quaternion,
  type Scene as ThreeScene,
  Vector3,
} from "three";
import { softCircleTexture } from "../render/particles.js";
import { normaliseLongestAxis, scale } from "../render/scale.js";
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
const AIM_Z = -0.16;
const ZERO_DISTANCE = 25;
const MAX_CONVERGENCE_DEGREES = 8;
const UP = new Vector3(0, 1, 0);

export type AimRay = { origin: Vector3; direction: Vector3 };

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
  #muzzlePoint = new Vector3();
  #kick = 0;
  #blend = 0;
  #sway = 0;
  #lowered = 0;

  #animation: AnimationPlayer | undefined;
  #clips: ReadonlySet<string>;
  #shootFor = 0;
  #camera: PerspectiveCamera;
  #barrelTipLocal = new Vector3();
  #geometryTipLocal = new Vector3();
  #barrelAxisLocal = new Vector3(0, 0, -1);
  #opticLocal = new Vector3();
  #aimOrigin = new Vector3();
  #aimDirection = new Vector3(0, 0, -1);
  #hasAimRay = false;
  #viewmodelLength = 0;

  constructor(
    camera: PerspectiveCamera,
    viewmodel: Object3D,
    clips: readonly AnimationClip[] = [],
    scene: ThreeScene,
  ) {
    this.#camera = camera;
    // Asset scenes are cached between restarts. Reset the outer transform before measuring so a
    // previous normalisation cannot compound into a giant weapon on the second run.
    viewmodel.removeFromParent();
    viewmodel.position.set(0, 0, 0);
    viewmodel.rotation.set(0, 0, 0);
    viewmodel.scale.setScalar(1);
    normaliseLongestAxis(viewmodel, scale.rifleLength);
    viewmodel.traverse((object) => {
      object.castShadow = false;
      object.receiveShadow = false;
      object.frustumCulled = false;
      // The viewmodel is drawn over the world, so nothing in the yard can clip it.
      const mesh = object as Mesh;
      if (mesh.isMesh === true) mesh.renderOrder = 20;
    });
    // The fixed half-turn is the authored asset correction; the barrel axis and tip below are
    // measured after this transform, so no caller has to guess where the suppressor ends.
    const fit = new Group();
    fit.rotation.y = Math.PI;
    fit.add(viewmodel);
    this.group.add(fit);
    this.#measureBarrel(fit, viewmodel);
    this.#clips = new Set(clips.map((clip) => clip.name));
    if (clips.length > 0) {
      this.#animation = new AnimationPlayer({ clips, root: fit });
      this.#play("Idle", 0);
    }
    this.group.renderOrder = 20;
    // A suppressed muzzle makes a tight, forward-pointing flame. The old 60 cm
    // camera-facing card sat well to the right of the visible suppressor and could
    // briefly cover most of the frame as an obvious square.
    this.#flash = new Mesh(
      new ConeGeometry(0.055, 0.24, 6, 1, true),
      new MeshBasicMaterial({
        blending: AdditiveBlending,
        color: 0xffd9a0,
        depthWrite: false,
        opacity: 0,
        transparent: true,
      }),
    );
    this.#flash.position.copy(this.#barrelTipLocal);
    this.#flash.quaternion.setFromUnitVectors(UP, this.#barrelAxisLocal);
    // Keep the zero-opacity mesh in the render list so WebGPU compiles this
    // material during loading instead of stalling on the first trigger pull.
    this.#flash.visible = true;
    this.#flash.renderOrder = 30;
    this.group.add(this.#flash);
    // The flash has to light the hands and the barrel, not just draw over them.
    // The light stays in the scene for the whole run with its intensity driven to zero.
    // Toggling `visible` changes the lighting setup, which makes the renderer rebuild every
    // material pipeline that uses it — measured at up to a 1.2 s freeze on the first shot.
    this.#light = new PointLight(0xffc46a, 0, 6, 2);
    this.#light.position.copy(this.#barrelTipLocal);
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

  /** Measure the final-scale viewmodel in group space, including the visible suppressor tip. */
  #measureBarrel(fit: Group, viewmodel: Object3D): void {
    fit.updateWorldMatrix(true, true);
    const worldBounds = new Box3().setFromObject(viewmodel);
    const fitInverse = fit.matrixWorld.clone().invert();
    const fitBounds = new Box3();
    for (const x of [worldBounds.min.x, worldBounds.max.x]) {
      for (const y of [worldBounds.min.y, worldBounds.max.y]) {
        for (const z of [worldBounds.min.z, worldBounds.max.z]) {
          fitBounds.expandByPoint(new Vector3(x, y, z).applyMatrix4(fitInverse));
        }
      }
    }
    const tipInFit = new Vector3(
      (fitBounds.min.x + fitBounds.max.x) / 2,
      (fitBounds.min.y + fitBounds.max.y) / 2,
      fitBounds.max.z,
    );
    this.#geometryTipLocal.copy(tipInFit).applyMatrix4(fit.matrix);
    this.#barrelTipLocal.copy(this.#geometryTipLocal);
    // The asset's forward +z transformed through the fit's half-turn is the visible -z barrel
    // axis. Object3D's +z convention makes this less error-prone than a hand-typed direction.
    this.#barrelAxisLocal
      .set(0, 0, 1)
      .applyQuaternion(fit.quaternion)
      .normalize();
    const size = fitBounds.getSize(new Vector3());
    this.#viewmodelLength = Math.max(size.x, size.y, size.z);
    let namedOptic: Object3D | undefined;
    viewmodel.traverse((object) => {
      if (namedOptic === undefined && /sight|optic|rail|dot/i.test(object.name)) namedOptic = object;
    });
    if (namedOptic !== undefined) {
      this.#opticLocal.copy(fit.worldToLocal(namedOptic.getWorldPosition(new Vector3()))).applyMatrix4(fit.matrix);
      return;
    }

    // This viewmodel has no optic node. Select the compact mesh at the top of the receiver as a
    // geometric rail fallback; hands and the long receiver are deliberately excluded by size.
    const overall = fitBounds.getSize(new Vector3());
    const candidate = new Box3();
    let bestScore = Number.POSITIVE_INFINITY;
    viewmodel.traverse((object) => {
      const mesh = object as Mesh;
      if (mesh.isMesh !== true) return;
      const world = new Box3().setFromObject(mesh);
      const local = new Box3();
      for (const x of [world.min.x, world.max.x]) {
        for (const y of [world.min.y, world.max.y]) {
          for (const z of [world.min.z, world.max.z]) {
            local.expandByPoint(new Vector3(x, y, z).applyMatrix4(fitInverse));
          }
        }
      }
      const meshSize = local.getSize(new Vector3());
      const compact = meshSize.y < overall.y * 0.5 && meshSize.z < overall.z * 0.35;
      if (!compact || local.max.y < fitBounds.max.y - overall.y * 0.35) return;
      const score = Math.abs(local.getCenter(new Vector3()).z - this.#barrelTipLocal.z * 0.28);
      if (score < bestScore) {
        bestScore = score;
        candidate.copy(local);
      }
    });
    if (bestScore < Number.POSITIVE_INFINITY) {
      this.#opticLocal.copy(candidate.getCenter(new Vector3())).applyMatrix4(fit.matrix);
    } else {
      this.#opticLocal
        .set(
        (fitBounds.min.x + fitBounds.max.x) / 2,
        fitBounds.max.y - overall.y * 0.16,
        fitBounds.max.z - overall.z * 0.42,
        )
        .applyMatrix4(fit.matrix);
    }
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
    this.#flashLife = 0.045;
    (this.#flash.material as MeshBasicMaterial).opacity = 1;
    this.#flash.rotateOnAxis(this.#barrelAxisLocal, this.shots * 1.7);
    this.#flash.scale.setScalar(0.8 + ((this.shots * 37) % 10) / 25);
    this.#light.intensity = 3.5;
    this.#spawnSmoke();
    return true;
  }

  /** World-space muzzle ray from the measured barrel tip along the measured barrel axis. */
  barrelRay(): AimRay {
    this.group.updateWorldMatrix(true, false);
    return {
      origin: this.group.localToWorld(this.#barrelTipLocal.clone()),
      direction: this.#barrelAxisLocal
        .clone()
        .applyQuaternion(this.group.getWorldQuaternion(new Quaternion()))
        .normalize(),
    };
  }

  /** Two puffs at the muzzle, in world space so they hang in the air as the view turns. */
  #spawnSmoke(): void {
    this.#muzzlePoint.copy(this.barrelRay().origin);
    for (let index = 0; index < 2; index += 1) {
      const slot = this.#smoke[this.#smokeCursor % this.#smoke.length];
      this.#smokeCursor += 1;
      if (slot === undefined) continue;
      slot.mesh.position.copy(this.#muzzlePoint);
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

  converge(origin: Vector3, direction: Vector3): void {
    this.#aimOrigin.copy(origin);
    this.#aimDirection.copy(direction).normalize();
    this.#hasAimRay = true;
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
    (this.#flash.material as MeshBasicMaterial).opacity = Math.min(1, this.#flashLife / 0.025);
    this.#light.intensity = Math.max(0, this.#light.intensity - dt * 90);
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
    const hipMotion = 1 - t;
    const bob = Math.sin(this.#sway) * 0.008 * (0.35 + moving) * hipMotion;
    const bobY = Math.abs(Math.cos(this.#sway)) * 0.01 * (0.25 + moving) * hipMotion;
    const kick = this.#kick * this.#kick;
    this.group.position.set(
      HIP.x + (-this.#opticLocal.x - HIP.x) * t + bob,
      HIP.y + (-this.#opticLocal.y - HIP.y) * t + bobY - this.#lowered * 0.34,
      HIP.z + (AIM_Z - HIP.z) * t + kick * 0.045,
    );
    this.group.rotation.set(
      HIP.pitch - kick * 0.05 + this.#lowered * 0.5,
      HIP.yaw * (1 - t),
      HIP.roll * (1 - t) + this.#lowered * 0.18,
    );
    if (!this.#hasAimRay) return;

    const target = this.#aimOrigin.clone().addScaledVector(this.#aimDirection, ZERO_DISTANCE);
    const current = this.barrelRay();
    const desired = target.sub(current.origin).normalize();
    const parentQuaternion = this.group.parent?.getWorldQuaternion(new Quaternion()) ?? new Quaternion();
    const desiredParent = desired.applyQuaternion(parentQuaternion.clone().invert());
    const currentParent = this.#barrelAxisLocal.clone().applyQuaternion(this.group.quaternion);
    const correction = new Quaternion().setFromUnitVectors(currentParent, desiredParent);
    const maxAngle = MathUtils.degToRad(MAX_CONVERGENCE_DEGREES);
    const angle = 2 * Math.acos(MathUtils.clamp(correction.w, -1, 1));
    if (angle > maxAngle) correction.slerp(new Quaternion(), maxAngle / angle);
    this.group.quaternion.premultiply(correction);
  }

  debug(): {
    barrelAxisErrorDeg: number;
    muzzleLocal: number[];
    tipGapToGeometry: number;
    opticScreen: { x: number; y: number };
    viewmodelLength: number;
  } {
    const ray = this.barrelRay();
    const cameraDirection = this.#camera.getWorldDirection(new Vector3()).normalize();
    const optic = this.group.localToWorld(this.#opticLocal.clone()).project(this.#camera);
    return {
      barrelAxisErrorDeg: MathUtils.radToDeg(ray.direction.angleTo(cameraDirection)),
      muzzleLocal: this.#barrelTipLocal.toArray(),
      tipGapToGeometry: this.#flash.position.distanceTo(this.#geometryTipLocal),
      opticScreen: { x: (optic.x + 1) / 2, y: (1 - optic.y) / 2 },
      viewmodelLength: this.#viewmodelLength,
    };
  }

  dispose(): void {
    this.#animation?.dispose();
    this.group.removeFromParent();
  }
}
