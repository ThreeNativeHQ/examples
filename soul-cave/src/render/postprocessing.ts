// Generated for you: ordinary Three.js; ThreeNative does not read this file.
//
// The cave's whole look is one shaft of light in a dark room, so the chain is built around
// godrays. Everything else is there to make that shaft believable: GI to carry a warm bounce off
// the lit rock onto the walls, contact AO to seat the pillars on the floor, reflections for the
// wet patches, and an ACES curve with the exposure pulled down so the unlit foreground stays a
// silhouette instead of lifting to grey.
//
// `WorldEnvironment` prints `TN_RENDER_CHAIN` naming every stage as applied or refused with a
// reason — read it rather than assuming a stage ran.
import type { Camera, DirectionalLight, Scene } from "three";
import { WorldEnvironment } from "./worldEnvironment.js";
import type { OutputRenderer } from "./worldEnvironment.js";

// These godray numbers are lumen-hall's, measured there across many captures rather than guessed
// here. The one that matters is `godraysFloor`: it subtracts the out-of-beam scatter before
// `godraysIntensity` multiplies, so raising intensity scales what is inside a beam instead of
// scaling the veil over the whole room. Density 1.1 with a floor near zero — what this file had —
// is the exact combination lumen-hall's notes record as "fogging the room", which is what it did.
const cavePreset = {
  // The shaft. Density and decay are what make it read as dusty air rather than a white cone.
  godraysEnabled: true,
  godraysDensity: 0.7,
  godraysIntensity: 3.0,
  godraysSteps: 56,
  godraysMaxDensity: 0.6,
  godraysFloor: 0.08,

  // The warm bounce off lit rock. Interior scale is exactly what SSGI is for.
  ssgiEnabled: true,
  ssgiQuality: "high",
  ssgiIntensity: 0.75,
  ssgiRadius: 8,
  denoiseEnabled: true,

  // Wet floor. Kept at half resolution — it is a highlight, not a mirror.
  ssrEnabled: true,
  ssrResolutionScale: 0.5,
  ssrMaxDistance: 40,

  // Seats the pillars where they meet the ground; without it they float.
  gtaoEnabled: true,
  gtaoRadius: 0.35,
  gtaoScale: 1,
  gtaoResolutionScale: 0.5,

  bloomEnabled: true,
  bloomStrength: 0.18,
  bloomThreshold: 0.85,
  bloomRadius: 0.6,

  sharpenEnabled: true,
  sharpenStrength: 0.85,
  vignetteAmount: 0.11,

  tonemapMode: "agx",
  // Below 1: the reference's foreground is nearly black and its shaft is the only bright thing.
  exposure: 0.98,
} as const;

/** Mobile has no budget for raymarched shafts plus GI; it keeps the curve and the bloom. */
const mobilePreset = {
  bloomEnabled: true,
  bloomStrength: 0.5,
  sharpenEnabled: true,
  sharpenStrength: 0.85,
  vignetteAmount: 0.11,
  tonemapMode: "agx",
  exposure: 0.9,
} as const;

export function setupCavePost(
  renderer: OutputRenderer,
  scene: Scene,
  camera: Camera,
  sun: DirectionalLight,
  options: { mobile?: boolean } = {},
): void {
  const world = new WorldEnvironment(options.mobile === true ? mobilePreset : cavePreset);
  world.apply(renderer, scene, camera, { godraysLight: sun });
}
