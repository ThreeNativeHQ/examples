// Generated for you. This is ordinary Three.js — edit or delete it freely.
// ThreeNative does not read this file.
//
// Key, bounce, rim, ambient. The rim is the one people forget: without a cool
// back light, silhouettes read as flat cut-outs against the background.
import {
  AmbientLight,
  Color,
  DirectionalLight,
  HemisphereLight,
  PCFSoftShadowMap,
  type Scene,
  Vector3,
} from "three";
import { palette } from "./palette.js";

type ShadowRenderer = { shadowMap: { enabled: boolean; type: number } };
type AtmosphereLike = {
  getSunDirection(target?: Vector3): Vector3;
  sunTransmittance(direction: Vector3): unknown;
};

export function setupLighting(
  scene: Scene,
  renderer: ShadowRenderer,
  atmosphere?: AtmosphereLike,
): { key: DirectionalLight; updateSun(direction: Vector3): void } {
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFSoftShadowMap;

  scene.add(new HemisphereLight(palette.skyHigh, palette.shadow, 1.6));

  // The grove is 44 m across, so the shadow camera has to hold all of it or the far trunks stop
  // casting. 2048² over a 35-unit extent is about 3.4 cm per texel, which still resolves a trunk.
  const extent = 35;
  const key = new DirectionalLight(palette.accent, 3);
  const updateSun = (direction: Vector3): void => {
    // A directional light's position only aims its shadow camera, and that camera looks from here
    // at the origin. Sitting 7 m out — the old value — put half the grove behind its near plane,
    // where casters are clipped and stop casting at all.
    key.position.copy(direction).multiplyScalar(extent * 2);
    const transmittance = atmosphere?.sunTransmittance(direction);
    if (transmittance instanceof Vector3) {
      key.color.copy(new Color().setRGB(transmittance.x, transmittance.y, transmittance.z));
    }
  };
  updateSun(atmosphere?.getSunDirection() ?? new Vector3(4, 7, 3).normalize());
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.near = 0.5;
  key.shadow.camera.far = extent * 4;
  key.shadow.camera.left = -extent;
  key.shadow.camera.right = extent;
  key.shadow.camera.top = extent;
  key.shadow.camera.bottom = -extent;
  key.shadow.bias = -0.0008;
  key.shadow.normalBias = 0.03;
  scene.add(key);

  const rim = new DirectionalLight(0xffc28a, 0.35);
  rim.position.set(-5, 3, -6);
  scene.add(rim);

  scene.add(new AmbientLight(palette.shadow, 0.28));
  // The key light travels with the sun updater: `WorldEnvironment`'s godrays stage raymarches
  // against its shadow map, so `setupPost` needs the light itself and refuses a shadowless one
  // by name instead of rendering a black pass.
  return { key, updateSun };
}
