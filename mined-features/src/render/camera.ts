// Generated for you. Camera framing is yours to edit.
//
// The rig below is game source: the offsets, the damping, the zoom range and the shake waveform
// are all chosen here. The framework supplies the portable zoom axis (one number from wheel on
// desktop and pinch on touch) and CameraShake, which returns an offset and never touches a camera.
import { CameraShake } from "@threenative/core";
import { type PerspectiveCamera, Vector3 } from "three";

const MIN_DISTANCE = 5;
const MAX_DISTANCE = 18;
const START_DISTANCE = 11;
/** Metres of dolly per unit of the portable zoom axis. Ours to pick; nothing defaults it. */
const ZOOM_METRES_PER_UNIT = 1.6;

export function setupCamera(camera: PerspectiveCamera): void {
  camera.fov = 54;
  camera.near = 0.1;
  camera.far = 20_000;
  camera.position.set(0, 3, START_DISTANCE);
  camera.lookAt(0, 1, 0);
  camera.updateProjectionMatrix();
}

export interface ICameraRig {
  readonly distance: number;
  readonly shake: CameraShake;
  /** Peak offset magnitude seen since the rig was created, in metres. */
  readonly shakePeak: number;
  update(camera: PerspectiveCamera, focus: Vector3, zoomAxis: number, dt: number): void;
}

export function createCameraRig(): ICameraRig {
  const shake = new CameraShake({
    amplitude: new Vector3(0.16, 0.22, 0.1),
    rotationAmplitude: new Vector3(0.012, 0.018, 0.008),
    frequency: 15,
    decay: 3.4,
    // A decaying square-ish waveform: sharper than a sine, which suits a beacon igniting.
    curve: (phase) => Math.sign(Math.sin(phase)) * Math.abs(Math.sin(phase)) ** 0.6,
  });
  let distance = START_DISTANCE;
  let shakePeak = 0;
  const desired = new Vector3();

  return {
    get distance() {
      return distance;
    },
    shake,
    get shakePeak() {
      return shakePeak;
    },
    update(camera, focus, zoomAxis, dt) {
      distance = Math.min(
        MAX_DISTANCE,
        Math.max(MIN_DISTANCE, distance - zoomAxis * ZOOM_METRES_PER_UNIT),
      );
      desired.set(focus.x * 0.35, focus.y + distance * 0.32, focus.z + distance);
      camera.position.lerp(desired, Math.min(1, dt * 6));
      camera.lookAt(focus.x * 0.35, focus.y + 0.6, focus.z);
      // The shake is composed after the rig's own damping, so damping never eats it.
      const offset = shake.update(dt);
      camera.position.add(offset.position);
      camera.rotation.x += offset.rotation.x;
      camera.rotation.y += offset.rotation.y;
      camera.rotation.z += offset.rotation.z;
      shakePeak = Math.max(shakePeak, offset.position.length());
    },
  };
}
