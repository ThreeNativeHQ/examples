// Generated for you: ordinary Three.js; ThreeNative does not read this file.
//
// Every appearance decision in this game is in this file. `WorldEnvironment` decides which
// stages run, in what order, and reports what actually ran; it decides none of the numbers
// below.
import type { Camera, DirectionalLight, Scene } from "three";
import { WorldEnvironment } from "./WorldEnvironment.js";

type OutputRenderer = {
  kind: string;
  raw: unknown;
  setOutputNode(node: unknown): void;
};

/**
 * `?off=ssgi,ssr,godrays,bloom` disables named stages on the same build.
 *
 * Two uses, and the second is the one that pays for it. An A/B of the look needs the two
 * captures to differ by one stage and nothing else. An attribution of the frame cost needs
 * exactly the same thing: with the whole chain on, `render.p50` is one number and no part
 * of it is attributable to any stage. Rebuilding between measurements changes the build.
 */
function stageOff(name: string): boolean {
  if (typeof globalThis.location === "undefined") return false;
  const params = new URLSearchParams(globalThis.location.search);
  if (name === "ssgi" && params.get("gi") === "off") return true;
  const off = params.get("off");
  if (off === null) return false;
  return off.split(",").some((entry) => entry.trim() === name);
}

export function setupPost(
  renderer: OutputRenderer,
  scene: Scene,
  camera: Camera,
  sun: DirectionalLight,
): void {
  const environment = new WorldEnvironment({
    // The nave has exactly one light and it comes in sideways through the clerestory.
    // With indirect light off the aisles behind the columns receive nothing at all — the
    // shafts stay identical and everything they are not touching goes black.
    ssgiEnabled: !stageOff("ssgi"),
    // Measured by ablation on this scene at 1600x900: "high" (3 slices x 16 steps = 96
    // samples per pixel) costs more than every other stage in the chain put together —
    // 42.9 fps with it against 107 without. "medium" is 32 samples for the same shape of
    // result in a nave whose indirect light is broad and low-frequency.
    ssgiQuality: "medium",
    // Gathered indirect light is unbounded. 0.8 keeps the aisles readable without the
    // stone starting to glow.
    // Indirect light lifts every shadow it reaches, so it is also the fastest way to
    // destroy contrast. The reference holds near-black aisles against bright shafts; at
    // 0.75 ours had no dark end at all.
    // A beam is only a beam against dark air. Indirect light raises everything the beam
    // is meant to stand out from, so past about 0.4 the shafts stop reading as volumes and
    // the whole nave becomes one evenly lit interior.
    ssgiIntensity: 0.34,
    // The nave is 16 wide and 46 long. A radius shorter than the bay spacing gathers
    // nothing from the far column, which is the bounce that fills the aisle.
    // Short. A long gather radius pulls light across the whole nave and the result is a
    // uniform haze with no contact darkening — which reads as blurred shadows.
    ssgiRadius: 8,
    denoiseEnabled: !stageOff("denoise"),
    // The shafts. Density is the air in the building; too high and the nave is a fog box,
    // too low and the clerestory openings stop reading as separate windows.
    godraysEnabled: !stageOff("godrays"),
    // The reference is hazy enough that the shafts read as solid volumes, but the haze
    // never reaches the aisles. Density is the air; maxDensity is the ceiling that stops a
    // shaft becoming a white wall.
    // Lower than it looks like it should be. Density raises the whole frame, not just the
    // shafts: at 0.75 the aisles fogged over and the building lost its dark end, which is
    // the opposite of what a shaft of light is for.
    // Measured by eye across four captures: below ~0.4 the shafts vanish, above ~0.8 the
    // haze stops being confined to them and the whole nave fogs. 0.55 is the band where a
    // shaft is a volume and the air beside it is still air.
    godraysDensity: 0.55,
    godraysMaxDensity: 0.5,
    // The floor is polished stone, so the columns and the glass stand in it.
    ssrEnabled: !stageOff("ssr"),
    // The nave is 63 m long and the near piers stand about 8 m from the camera. The node's
    // own default of 1 traces one metre and returns nothing on every pixel.
    ssrMaxDistance: 40,
    // Measured: full-resolution reflections cost 56 fps -> 34.5 on this scene. The floor is
    // polished stone rather than a mirror, so half resolution is a quarter of the rays for
    // a difference that does not survive the roughness blur.
    ssrResolutionScale: 0.5,
    // The glass is authored past 1.0 on purpose; this is what makes it read as glass
    // rather than as a coloured hole in the wall.
    bloomEnabled: !stageOff("bloom"),
    // Bloom spreads the glass over everything near it. Enough to bloom the windows, not
    // enough to raise the floor of the whole frame.
    bloomStrength: 0.18,
    tonemapMode: "agx",
    // The single biggest lever on "too bright". A cathedral interior at a low sun is a
    // high-dynamic-range subject: the shafts are meant to clip and everything the shafts
    // miss is meant to fall away.
    exposure: 0.85,
  });
  environment.apply(renderer, scene, camera, sun);
}
