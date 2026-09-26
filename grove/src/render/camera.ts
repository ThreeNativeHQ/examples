// Generated for you. Camera framing is yours to edit.
import type { PerspectiveCamera } from "three";

// Static, at eye height inside the grove looking down its length: trunks fill the lower frame, the
// canopies cross the middle, and the sky strip above them is what the sun rakes through.
export function setupCamera(camera: PerspectiveCamera): void {
  camera.fov = 54;
  camera.near = 0.1;
  camera.far = 20_000;
  camera.position.set(7, 1.7, 26);
  camera.lookAt(0, 5.5, -6);
  camera.updateProjectionMatrix();
}
