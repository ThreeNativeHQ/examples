// Generated for you. This is ordinary Three.js — edit or delete it freely.
// ThreeNative does not read this file.
//
// Late morning in a wood under a clear sky, lit by a sun whose direction is measured rather than
// invented — see `light/sun.ts`, which is where it and the sky both read it from.
//
// **What this rig deliberately does not do is fill.** The version before it ran four lights plus
// an ambient, and the sum was an image with a metre of dynamic range: a hemisphere at 1.2, an
// ambient at 0.3, an overhead canopy light and a rim, on top of whatever the environment map
// contributed. Every one of them was defensible on its own and together they lit the shadows to
// within a stop of the highlights, which is what "flat" is. Outdoors on a clear day the sun
// delivers roughly six times the irradiance the whole sky does, and shadows are dark because
// nothing is filling them. This rig reproduces that ratio and lets the shadows fall:
//
//   key          3.4   the sun, and the only shadow caster
//   environment  0.35  the sky, as an image, from `sky.ts` — about a fifth of the key
//   canopy       0.28  green, from straight overhead
//   bounce       0.40  warm, from below only
//
// The third and fourth are the two things a photograph of a South African quarry cannot tell this
// scene. `canopy` is the leaf-filtered green that lands on the tops of ferns and the shoulders of
// rocks, and it is the colour a wood actually is under; `bounce` is the forest floor throwing warm
// light back up, and it is why the underside of a branch is not the colour of the sky. Both are
// small, and both are doing a job no amount of ambient can do because ambient has no direction.
//
// The warm/cool separation is the point of the whole file: the key is a 5300 K beam, the sky
// filling the shadows is nearer 12000 K, and every surface in the valley is therefore one of two
// colours depending only on whether it can see the sun.
import { DirectionalLight, HemisphereLight, PCFSoftShadowMap, type Scene } from "three";
import { SUN_COLOUR, SUN_DISTANCE, sunDirection } from "./light/sun.js";
import { palette } from "./palette.js";
import { setupSky } from "./sky.js";

type ShadowRenderer = { shadowMap: { enabled: boolean; type: number } };

/**
 * Puts up the sky and the lights, which are one decision and not two.
 *
 * `setupSky` is called from in here rather than from the scene on purpose: a caller able to do one
 * without the other is a caller able to ship a valley lit from the east under a sun in the west,
 * and that is exactly the bug this file was rewritten to fix. It also fixes the more visible half
 * of it — the sky is installed synchronously, so there is no window of frames where the horizon
 * meets black while a 5 MB photograph downloads.
 *
 * Returns the key light: `WorldEnvironment`'s godrays stage raymarches against a shadow map, so
 * the scene hands the sun to `setupPost` and a shadowless light is refused by name rather than
 * rendering a black pass. Godrays through a canopy are the reason this scene wants a sun at all.
 */
export function setupForestLighting(scene: Scene, renderer: ShadowRenderer): DirectionalLight {
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFSoftShadowMap;

  setupSky(scene);
  // The sky is an image of a sky, so it is already the right colour and comes from the right
  // directions; what it must not also be is bright enough to fill the shadows the sun casts.
  // A fifth of the key is the clear-day ratio. See the header.
  scene.environmentIntensity = 0.35;

  const key = new DirectionalLight(SUN_COLOUR, 3.4);
  key.name = "sun";
  key.position.copy(sunDirection()).multiplyScalar(SUN_DISTANCE);
  key.castShadow = true;
  // 4096², not the 2048² this had, and the reason is contact rather than crispness for its own
  // sake. The shadow camera has to cover a 190 m valley — half-extent 128 reaches its corners —
  // and at 2048 that is one texel per 12 cm, which is wider than the gap between a foot and the
  // ground it is standing on. The shadow that should sit an object down instead floats it. At
  // 4096 a texel is 6 cm and the contact reads.
  key.shadow.mapSize.set(4096, 4096);
  const extent = 128;
  key.shadow.camera.left = -extent;
  key.shadow.camera.right = extent;
  key.shadow.camera.top = extent;
  key.shadow.camera.bottom = -extent;
  // The light stands 220 m out along its own direction, so the depth range has to bracket the
  // valley either side of the origin rather than start at it.
  key.shadow.camera.near = 70;
  key.shadow.camera.far = 400;
  key.shadow.bias = -0.0004;
  // Foliage is thin and double-sided; without a normal bias every fern shadow-acnes itself into a
  // dark speckle, and raising `bias` far enough to stop it detaches the trunk shadows instead.
  // Halved along with the texel size — a normal bias is a distance, and at 6 cm texels the old
  // 0.06 was pushing the shadow off the contact it is there to draw.
  key.shadow.normalBias = 0.035;
  scene.add(key);

  // Leaf-filtered green from directly overhead, so upward-facing surfaces — the tops of ferns, the
  // shoulders of rocks — pick up the wood's own colour instead of only the sky's.
  const canopy = new DirectionalLight(palette.canopyLight, 0.28);
  canopy.position.set(0, 60, 0);
  scene.add(canopy);

  // Bounce off the floor, and *only* off the floor: the sky half of this hemisphere is black
  // because `scene.environment` is already the sky and doing it twice is how the previous rig
  // arrived at a uniform wash. A forest floor is brown and gold, not blue.
  scene.add(new HemisphereLight(0x000000, palette.bounce, 0.4));

  return key;
}
