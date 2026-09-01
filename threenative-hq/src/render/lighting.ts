// Generated for you. This is ordinary Three.js — edit or delete it freely.
// ThreeNative does not read this file.
//
// Four lights, and the fourth is the one people forget: a cool rim from behind
// so silhouettes separate from the background instead of reading as flat
// cut-outs. Key + bounce + ambient gets you a lit scene; the rim is what makes
// it look shaded.
import {
  AmbientLight,
  DirectionalLight,
  HemisphereLight,
  PCFSoftShadowMap,
  PointLight,
  type Scene,
} from "three";
import { palette } from "./palette.js";

type ShadowRenderer = { shadowMap: { enabled: boolean; type: number } };

// Returns the key light: `WorldEnvironment`'s godrays stage raymarches against a shadow
// map, so the scene hands the sun to `setupPost` and a shadowless light is refused by name
// instead of rendering a black pass.
export function setupLighting(scene: Scene, renderer: ShadowRenderer): DirectionalLight {
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFSoftShadowMap;

  // Sky above, ground bounce below. Tint the second colour toward whatever the
  // floor actually is — it is the cheapest realism in the whole rig.
  scene.add(new HemisphereLight(palette.skyHigh, palette.skyLow, 1.6));

  const key = new DirectionalLight(palette.accent, 3);
  key.position.set(4, 7, 3);
  key.castShadow = true;
  // 1024² is one quarter of a 2048² map's texel storage and fill work while
  // retaining enough resolution for this small authored route. Increase it
  // only when a larger level makes the 18-unit camera extent visibly soft.
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.near = 0.5;
  key.shadow.camera.far = 60;
  // A shadow camera tight enough to stay crisp cannot also cover a big level;
  // this extent matches the generated route. Widen it, or move the light with
  // the player, when the world grows.
  const extent = 18;
  key.shadow.camera.left = -extent;
  key.shadow.camera.right = extent;
  key.shadow.camera.top = extent;
  key.shadow.camera.bottom = -extent;
  key.shadow.bias = -0.0008;
  // Rounded geometry self-shadows at grazing angles without this, and the bias
  // alone would have to grow big enough to detach contact shadows.
  key.shadow.normalBias = 0.03;
  scene.add(key);

  const rim = new DirectionalLight(palette.player, 0.75);
  rim.position.set(-5, 3, -6);
  scene.add(rim);

  scene.add(new AmbientLight(palette.skyLow, 0.28));

  return key;
}

/**
 * The office's own rig, replacing the outdoor one above.
 *
 * An interior at dusk is lit from two places and they disagree: cold light falls through the
 * glass, warm light falls from the strips. Getting that disagreement on screen is most of why the
 * reference frames read as an office rather than as a lit box, so the cool key casts the shadows
 * and the warm fills sit under the fixtures without casting anything.
 */
export function setupOfficeLighting(scene: Scene, renderer: ShadowRenderer): DirectionalLight {
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFSoftShadowMap;

  // Warm ceiling bounce over cream carpet: the ambient term is doing the work of a hundred
  // recessed downlights this room does not model.
  scene.add(new HemisphereLight(0xfff0d8, 0xb3a488, 0.5));
  scene.add(new AmbientLight(0xfff1dc, 0.18));

  // Dusk through the glass, from outside the long window wall.
  const key = new DirectionalLight(0x9fc0e8, 0.9);
  key.position.set(2, 6, 16);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.near = 0.5;
  key.shadow.camera.far = 60;
  const extent = 16;
  key.shadow.camera.left = -extent;
  key.shadow.camera.right = extent;
  key.shadow.camera.top = extent;
  key.shadow.camera.bottom = -extent;
  key.shadow.bias = -0.0006;
  scene.add(key);

  for (const z of [-4.5, 0.5, 5]) {
    for (const x of [-8, 0, 8]) {
      const strip = new PointLight(0xffd9a8, 3.2, 9, 2);
      strip.position.set(x, 2.7, z);
      scene.add(strip);
    }
  }
  return key;
}
