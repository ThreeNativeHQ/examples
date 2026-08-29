// Generated for you. Camera framing is yours to edit.
//
// The zoom range and the follow damping are the game's. The framework supplies one axis that
// reads the same on a wheel and on a two-finger pinch.
import { type PerspectiveCamera, Vector3 } from "three";

const MIN_DISTANCE = 9;
const MAX_DISTANCE = 24;
const START_DISTANCE = 13;
const ZOOM_METRES_PER_UNIT = 1.8;

export function setupCamera(camera: PerspectiveCamera): void {
  camera.fov = 52;
  camera.near = 0.1;
  camera.far = 20_000;
  camera.position.set(0, 12, START_DISTANCE);
  camera.lookAt(0, 0, 0);
  camera.updateProjectionMatrix();
}

export interface ICameraRig {
  readonly distance: number;
  update(camera: PerspectiveCamera, focus: Vector3, zoomAxis: number, dt: number): void;
}

export function createCameraRig(): ICameraRig {
  let distance = START_DISTANCE;
  const desired = new Vector3();
  return {
    get distance() {
      return distance;
    },
    update(camera, focus, zoomAxis, dt) {
      distance = Math.min(
        MAX_DISTANCE,
        Math.max(MIN_DISTANCE, distance - zoomAxis * ZOOM_METRES_PER_UNIT),
      );
      desired.set(focus.x * 0.4, distance * 0.92, focus.z + distance * 0.72);
      camera.position.lerp(desired, Math.min(1, dt * 4));
      camera.lookAt(focus.x * 0.4, 0, focus.z - 3);
    },
  };
}
