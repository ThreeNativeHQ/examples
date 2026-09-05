// Ordinary Three.js — ThreeNative does not read this file.
//
// One fixed three-quarter shot of the whole vault, because the reference is a room portrait: the
// warden, the pile, the phase crates and the seal are all supposed to be legible on the first
// screen, and a camera that trails the character loses two of the four every time it moves.
//
// It still breathes. `settle` eases the framing in over the opening drop, and `nudge` lets the
// shot drift a fraction of a metre toward the warden so the picture is not completely static.
import type { PerspectiveCamera, Vector3 } from "three";
import { Vector3 as Vec3 } from "three";

export const VAULT_SHOT = {
  fov: 32,
  /** Where the camera sits. Roughly 40 degrees above the floor, off the front-left corner. */
  position: new Vec3(-1.5, 12.6, 11.6),
  /** What it points at: the middle of the room, biased toward the seal corner. */
  target: new Vec3(0.05, 0.25, -0.55),
  /** How far the shot is allowed to drift toward the warden, in metres. */
  drift: 0.1,
} as const;

export interface IVaultCamera {
  readonly snap: () => void;
  readonly follow: (subject: Vector3, dt: number) => void;
}

export function createVaultCamera(camera: PerspectiveCamera): IVaultCamera {
  camera.fov = VAULT_SHOT.fov;
  camera.near = 0.5;
  camera.far = 90;
  camera.updateProjectionMatrix();

  const desired = new Vec3();
  const aim = new Vec3();
  const currentAim = VAULT_SHOT.target.clone();

  const snap = (): void => {
    camera.position.copy(VAULT_SHOT.position);
    currentAim.copy(VAULT_SHOT.target);
    camera.lookAt(currentAim);
  };

  const follow = (subject: Vector3, dt: number): void => {
    // Drift a fraction of a metre toward the warden and no further. The shot is the room; this
    // is only enough parallax that the picture is not a still.
    aim.copy(subject).sub(VAULT_SHOT.target);
    aim.y = 0;
    if (aim.lengthSq() > 1e-6) aim.normalize().multiplyScalar(VAULT_SHOT.drift);
    else aim.set(0, 0, 0);
    desired.copy(VAULT_SHOT.position).add(aim);
    // 1 - e^(-dt/tau) is the framerate-independent form of a lerp: the same second of drift at
    // 30 fps and at 120 fps ends in the same place.
    camera.position.lerp(desired, 1 - Math.exp(-dt / 0.9));
    camera.lookAt(currentAim);
  };

  return { follow, snap };
}
