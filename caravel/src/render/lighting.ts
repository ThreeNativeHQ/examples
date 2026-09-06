// Generated for you. This is ordinary Three.js; tune the key and rim for your sea.
import {
  AmbientLight,
  DirectionalLight,
  HemisphereLight,
  PCFSoftShadowMap,
  type Scene,
} from "three";
import { palette } from "./palette.js";

type ShadowRenderer = { shadowMap: { enabled: boolean; type: number } };

export function setupLighting(scene: Scene, renderer: ShadowRenderer): DirectionalLight {
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFSoftShadowMap;
  // The ground term is a muted sea blue, not the trough colour. Bounced at full saturation it
  // painted the ship's shadow side the same teal as the water and the hull stopped reading as
  // timber at all.
  scene.add(new HemisphereLight(palette.skyLow, 0x3d6274, 1.05));

  // Near-white, not the accent. A strongly tinted key contaminates the canvas, the timber and the
  // sea at once, and no per-material tweak can pull them back apart.
  const key = new DirectionalLight(0xfff4e0, 2.9);
  key.position.set(9, 13, 5);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.near = 0.5;
  key.shadow.camera.far = 80;
  // Tight, because this frustum now travels with the ship rather than covering the world. A
  // ±30 m box centred on the origin was fine for a course eight metres long; the passage runs out
  // past x = -34, where the ship simply sails out of its own shadow map and every shadow in the
  // frame switches off at once.
  key.shadow.camera.left = -22;
  key.shadow.camera.right = 22;
  key.shadow.camera.top = 22;
  key.shadow.camera.bottom = -22;
  key.shadow.normalBias = 0.04;
  scene.add(key);
  scene.add(key.target);

  const rim = new DirectionalLight(palette.skyLow, 0.7);
  rim.position.set(-8, 4, -10);
  scene.add(rim);
  scene.add(new AmbientLight(palette.shadow, 0.5));
  return key;
}

/** The sun's offset from whatever it is lighting. Its direction is the light; its place is not. */
const SUN_OFFSET = { x: 9, y: 13, z: 5 } as const;

/**
 * Carry the shadow frustum along with the ship.
 *
 * A directional light has no position in the physics of it — only a direction — but its shadow
 * camera does, and that camera is a box of finite size. Moving the light and its target together
 * keeps the sun's direction exactly constant while putting the box where the ship is.
 */
export function followSun(key: DirectionalLight, target: { x: number; y: number; z: number }): void {
  key.target.position.set(target.x, 0, target.z);
  key.position.set(target.x + SUN_OFFSET.x, SUN_OFFSET.y, target.z + SUN_OFFSET.z);
}
