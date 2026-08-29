// Generated for you. Camera framing is yours to edit.
//
// The rig is game source. CameraShake returns an offset and never touches a camera; the amplitude,
// waveform, frequency and decay below are this game's idea of what a banishing feels like.
import { CameraShake } from "@threenative/core";
import { type PerspectiveCamera, Vector3 } from "three";

export function setupCamera(camera: PerspectiveCamera): void {
  camera.fov = 58;
  camera.near = 0.1;
  camera.far = 400;
  camera.position.set(0, 7.4, 11.2);
  camera.lookAt(0, 1, 0);
  camera.updateProjectionMatrix();
}

export interface ICameraRig {
  readonly shake: CameraShake;
  readonly shakePeak: number;
  update(camera: PerspectiveCamera, focus: Vector3, dt: number): void;
}

export function createCameraRig(): ICameraRig {
  const shake = new CameraShake({
    amplitude: new Vector3(0.26, 0.3, 0.16),
    rotationAmplitude: new Vector3(0.02, 0.026, 0.014),
    frequency: 17,
    decay: 4.2,
    // A hard first kick that settles fast, rather than a sine that wobbles politely.
    curve: (phase) => Math.sign(Math.sin(phase)) * Math.abs(Math.sin(phase)) ** 0.5,
  });
  let shakePeak = 0;
  const desired = new Vector3();

  return {
    shake,
    get shakePeak() {
      return shakePeak;
    },
    update(camera, focus, dt) {
      desired.set(focus.x * 0.4, 7.4, focus.z + 9.6);
      camera.position.lerp(desired, Math.min(1, dt * 5));
      camera.lookAt(focus.x * 0.4, 1.5, focus.z - 3.2);
      const offset = shake.update(dt);
      camera.position.add(offset.position);
      camera.rotation.x += offset.rotation.x;
      camera.rotation.y += offset.rotation.y;
      camera.rotation.z += offset.rotation.z;
      shakePeak = Math.max(shakePeak, offset.position.length());
    },
  };
}
