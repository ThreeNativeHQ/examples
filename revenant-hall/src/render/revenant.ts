// Generated-project source. The revenant's look is entirely here: the atlas is drawn as data in
// this file, the frame timings are chosen here, and so is the plane it is mapped onto. The
// framework contributes two things — face this quad at the camera, and advance this atlas on the
// fixed step — and knows nothing about revenants.
import { Billboard3D, SpriteAnimator3D } from "@threenative/core";
import {
  type Camera,
  DoubleSide,
  DataTexture,
  Mesh,
  MeshBasicMaterial,
  NearestFilter,
  PlaneGeometry,
  RGBAFormat,
  SRGBColorSpace,
} from "three";

const CELL = 24;
const FRAMES = 6;

/**
 * A six-frame walking revenant, authored as bytes so the same atlas exists on web and native.
 *
 * Frames 0-3 are the walk cycle; 4 and 5 are the banish flash the one-shot plays on a hit.
 */
function createRevenantAtlas(): DataTexture {
  const width = CELL * FRAMES;
  const data = new Uint8Array(width * CELL * 4);
  const put = (frame: number, x: number, y: number, r: number, g: number, b: number, a: number) => {
    const offset = (y * width + frame * CELL + x) * 4;
    data[offset] = r;
    data[offset + 1] = g;
    data[offset + 2] = b;
    data[offset + 3] = a;
  };
  for (let frame = 0; frame < FRAMES; frame += 1) {
    const banish = frame >= 4;
    const sway = Math.round(Math.sin((frame / 4) * Math.PI * 2) * 2);
    const stride = frame % 2 === 0 ? 2 : -2;
    for (let y = 0; y < CELL; y += 1) {
      for (let x = 0; x < CELL; x += 1) {
        const cx = x - CELL / 2 + 0.5;
        let on = false;
        let tone = 0;
        if (y < 6) {
          // hood
          on = Math.abs(cx - sway * 0.4) < 3.4 - y * 0.12;
          tone = 0.62;
        } else if (y < 17) {
          // robe, flaring toward the hem
          on = Math.abs(cx - sway * 0.2) < 2.6 + (y - 6) * 0.36;
          tone = 0.5 + (y - 6) * 0.016;
        } else {
          // two legs, alternating
          const leg = cx < 0 ? -2.4 + stride * 0.5 : 2.4 - stride * 0.5;
          on = Math.abs(cx - leg) < 1.5;
          tone = 0.44;
        }
        if (y >= 8 && y <= 11 && Math.abs(Math.abs(cx) - 1.6) < 0.9) {
          // eyes
          put(frame, x, y, banish ? 255 : 236, banish ? 246 : 92, banish ? 214 : 64, 255);
          continue;
        }
        if (!on) continue;
        const glow = banish ? 1 : 0;
        // Cold and bloodless. The eyes are the only warm thing on the sprite, which is what
        // makes them the thing you aim at.
        put(
          frame,
          x,
          y,
          Math.round(255 * Math.min(1, tone * 0.5 + glow * 0.9)),
          Math.round(255 * Math.min(1, tone * 0.92 + glow * 0.95)),
          Math.round(255 * Math.min(1, tone * 0.98 + glow * 0.9)),
          banish ? 210 : 255,
        );
      }
    }
  }
  const texture = new DataTexture(data, width, CELL, RGBAFormat);
  texture.colorSpace = SRGBColorSpace;
  texture.magFilter = NearestFilter;
  texture.minFilter = NearestFilter;
  texture.needsUpdate = true;
  return texture;
}

const WALK = [0, 1, 2, 3].map((index) => ({
  x: index * CELL,
  y: 0,
  width: CELL,
  height: CELL,
  duration: index % 2 === 0 ? 0.16 : 0.12,
}));
const BANISH = [4, 5].map((index) => ({
  x: index * CELL,
  y: 0,
  width: CELL,
  height: CELL,
  duration: 0.09,
}));

export class Revenant {
  readonly mesh: Mesh;
  readonly #billboard: Billboard3D;
  #animator: SpriteAnimator3D;
  readonly #atlas: DataTexture;
  banished = false;
  #fade = 0;

  constructor(camera: Camera, x: number, z: number) {
    this.#atlas = createRevenantAtlas();
    this.#animator = new SpriteAnimator3D({
      texture: this.#atlas,
      frames: WALK,
      mode: "loop",
      origin: "top-left",
    });
    const material = new MeshBasicMaterial({
      alphaTest: 0.4,
      map: this.#atlas,
      side: DoubleSide,
      toneMapped: false,
      transparent: true,
    });
    this.mesh = new Mesh(new PlaneGeometry(2.0, 2.0), material);
    this.mesh.position.set(x, 1.02, z);
    this.#billboard = new Billboard3D(this.mesh, { camera, lockAxis: "y" });
  }

  get frameIndex(): number {
    return this.#animator.frameIndex;
  }

  /** Switch to the one-shot banish flash and start fading the quad out. */
  banish(): void {
    if (this.banished) return;
    this.banished = true;
    this.#animator = new SpriteAnimator3D({
      texture: this.#atlas,
      frames: BANISH,
      mode: "once",
      origin: "top-left",
    });
  }

  /** Walk toward the target, face the camera, advance the atlas. Returns false once gone. */
  update(camera: Camera, target: { x: number; z: number }, dt: number, speed: number): boolean {
    this.#animator.update(dt);
    this.#billboard.update(camera);
    if (this.banished) {
      this.#fade += dt;
      const material = this.mesh.material as MeshBasicMaterial;
      material.opacity = Math.max(0, 1 - this.#fade * 2.2);
      this.mesh.position.y += dt * 0.7;
      if (this.#fade > 0.46) {
        this.mesh.removeFromParent();
        return false;
      }
      return true;
    }
    const dx = target.x - this.mesh.position.x;
    const dz = target.z - this.mesh.position.z;
    const distance = Math.hypot(dx, dz) || 1;
    this.mesh.position.x += (dx / distance) * speed * dt;
    this.mesh.position.z += (dz / distance) * speed * dt;
    return true;
  }

  distanceTo(target: { x: number; z: number }): number {
    return Math.hypot(target.x - this.mesh.position.x, target.z - this.mesh.position.z);
  }
}
