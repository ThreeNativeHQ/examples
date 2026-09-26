// Generated for you. Camera framing is yours to edit.
import type { PerspectiveCamera } from "three";

// Static, at eye height inside the grove looking down its length: trunks fill the lower frame, the
// canopies cross the middle, and the sky strip above them is what the sun rakes through.
const NEAR = { eye: [7, 1.7, 26], target: [0, 5.5, -6] } as const;
// The end of the LOD proof sweep: far enough that the engine's baked chain reaches every bark
// level it baked. A proof path, not a place a player stands.
const FAR = { eye: [0, 150, 3000], target: [0, 4, -6] } as const;

export function setupCamera(camera: PerspectiveCamera): void {
  camera.fov = 54;
  camera.near = 0.1;
  camera.far = 20_000;
  frameGrove(camera, 0);
  camera.updateProjectionMatrix();
}

/**
 * The grove framing along the proof sweep: 0 is the near view, 1 the far end. Exponential in
 * distance, because a level's projected error falls as 1/distance: equal sweep time per distance
 * ratio gives every baked level the same dwell, on any drawing-buffer height.
 */
export function frameGrove(camera: PerspectiveCamera, sweep: number): void {
  const ratio = 3000 / 33;
  const k = (ratio ** sweep - 1) / (ratio - 1);
  const at = (i: 0 | 1 | 2, from: readonly number[], to: readonly number[]) =>
    (from[i] ?? 0) + ((to[i] ?? 0) - (from[i] ?? 0)) * k;
  camera.position.set(at(0, NEAR.eye, FAR.eye), at(1, NEAR.eye, FAR.eye), at(2, NEAR.eye, FAR.eye));
  camera.lookAt(
    at(0, NEAR.target, FAR.target),
    at(1, NEAR.target, FAR.target),
    at(2, NEAR.target, FAR.target),
  );
}
