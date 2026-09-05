// Ordinary Three.js — ThreeNative does not read this file.
//
// A dark room with two warm lamps in it. The reference's whole read is that the *ambient* is
// almost nothing and every bright surface is bright because a named source is pointing at it, so
// the temptation to raise the fill until the crates are comfortably visible has to be resisted:
// the moment the floor stops being near-black the picture stops being a vault.
//
// The lantern and seal point lights are authored with the props themselves, in `vault.ts`. What
// is here is the three lights the whole room shares.
import { AmbientLight, DirectionalLight, HemisphereLight, PCFSoftShadowMap, type Scene } from "three";
import { palette } from "./palette.js";

type ShadowRenderer = { shadowMap: { enabled: boolean; type: number } };

/** Returns the key light: the godrays stage raymarches a shadow map and refuses a shadowless one. */
export function setupLighting(scene: Scene, renderer: ShadowRenderer): DirectionalLight {
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFSoftShadowMap;

  // Sky above, floor bounce below, both cold and both very quiet.
  scene.add(new HemisphereLight(0x33456a, palette.floorSeam, 0.9));

  // The key. Warm, high, and from the lantern side, so crate tops catch a little of the same
  // colour the plaster does and the shadows all fall the same way as in the reference.
  const key = new DirectionalLight(0xffd0a0, 1.35);
  key.position.set(-7, 15, 5);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.near = 1;
  key.shadow.camera.far = 46;
  // The extent covers the whole room and nothing else: the vault is 16 x 11 metres and a shadow
  // camera any wider spends its texels outside the walls.
  const extent = 10;
  key.shadow.camera.left = -extent;
  key.shadow.camera.right = extent;
  key.shadow.camera.top = extent;
  key.shadow.camera.bottom = -extent;
  key.shadow.bias = -0.0006;
  // Rounded geometry self-shadows at grazing angles without this, and the bias alone would have
  // to grow big enough to detach the contact shadow under every crate.
  key.shadow.normalBias = 0.035;
  scene.add(key);

  // Just enough ambient that a crate face turned away from every source is still a colour rather
  // than a silhouette.
  scene.add(new AmbientLight(0x2e3d58, 0.65));

  return key;
}
