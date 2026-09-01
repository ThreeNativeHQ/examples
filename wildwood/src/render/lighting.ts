// Generated for you. This is ordinary Three.js — edit or delete it freely.
// ThreeNative does not read this file.
//
// Mid-morning in a wood, which is a specific and unusual lighting problem: the sun is strong, but
// almost none of it reaches the floor directly. Nearly everything you see down there is bounced
// light from a canopy that is itself lit from above — so the fill is *green*, and getting that one
// colour right does more for the scene than any number of extra lights.
//
// Four sources, and the third is the one people skip:
//   key    — the sun, low and warm, and the only shadow caster.
//   sky    — hemisphere, blue above and leaf-green below, standing in for the bounce.
//   canopy — a dim green light from directly overhead, so upward-facing surfaces (the tops of
//            ferns, the shoulders of rocks) pick up the wood's colour instead of the sky's.
//   rim    — cool, from behind, so trunks separate from the trunks behind them. In a forest the
//            whole background is the same green as the foreground, and without this the wood
//            reads as one flat wall of colour rather than as depth.
import {
  AmbientLight,
  DirectionalLight,
  HemisphereLight,
  PCFSoftShadowMap,
  type Scene,
} from "three";
import { palette } from "./palette.js";

type ShadowRenderer = { shadowMap: { enabled: boolean; type: number } };

/**
 * Returns the key light: `WorldEnvironment`'s godrays stage raymarches against a shadow map, so
 * the scene hands the sun to `setupPost` and a shadowless light is refused by name rather than
 * rendering a black pass. Godrays through a canopy are the reason this scene wants a sun at all.
 */
export function setupForestLighting(scene: Scene, renderer: ShadowRenderer): DirectionalLight {
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFSoftShadowMap;

  // 0.85, not the 2.6 this had. A hemisphere light bright enough to lift the shadows also paints
  // every surface with its sky colour, and a blue sky colour turns an entire wood teal — which
  // reads as underwater, not as shade. Let the sun do the lifting and keep the fill quiet.
  scene.add(new HemisphereLight(palette.skyFill, palette.bounce, 1.65));

  const key = new DirectionalLight(palette.accent, 7.4);
  // Low and from the east, so the ridge throws a long shadow across the valley and the trunks
  // have length. A sun overhead flattens a wood into a green carpet.
  key.position.set(-52, 46, -68);
  key.castShadow = true;
  // 2048² rather than the starter's 1024²: this shadow camera has to cover a 190 m valley, and at
  // 1024 a tree's shadow is four texels wide and reads as a smudge.
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.near = 1;
  key.shadow.camera.far = 340;
  // Wide enough for the whole valley. A tighter extent would be crisper, but a shadow that stops
  // partway across the ground draws a straight line on the floor that nothing explains.
  const extent = 110;
  key.shadow.camera.left = -extent;
  key.shadow.camera.right = extent;
  key.shadow.camera.top = extent;
  key.shadow.camera.bottom = -extent;
  key.shadow.bias = -0.0006;
  // Foliage is thin and doubled-sided; without a normal bias every fern shadow-acnes itself into
  // a dark speckle, and raising `bias` far enough to stop it detaches the trunk shadows.
  key.shadow.normalBias = 0.06;
  scene.add(key);

  const canopy = new DirectionalLight(palette.canopyLight, 0.45);
  canopy.position.set(0, 40, 0);
  scene.add(canopy);

  const rim = new DirectionalLight(palette.skyHigh, 0.7);
  rim.position.set(48, 14, 58);
  scene.add(rim);

  scene.add(new AmbientLight(palette.bounce, 0.42));

  return key;
}
