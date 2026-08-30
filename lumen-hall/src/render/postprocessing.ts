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
    // Raised with the exposure. The aisles are lit by bounce alone and the darker albedo
    // gives that bounce less to work with, so the same number that held detail on flat
    // grey stone crushes the textured stone to black.
    // 0.75, measured against the reference's quantiles: its lower midtones sit at p25 ≈ 23
    // of 255 where ours sat at 10 — the reference fills the architecture with bounce while
    // keeping p5 ≈ 7. Direct-exposure dials lift the already-hot p95 with it; the bounce
    // term is the one that lifts only what is lit by the room.
    // 0.75 measured: from 0.55 the quantiles did not move (the gather finds only dark
    // stone from dark stone in a nave this size) and at 4 it produced a warm candle glow
    // with visible grain — attractive, but not the reference's daylight fill, which comes
    // from the air, not from short-range bounce.
    ssgiIntensity: 0.75,
    // The nave is 16 wide and 46 long. A radius shorter than the bay spacing gathers
    // nothing from the far column, which is the bounce that fills the aisle.
    // Short. A long gather radius pulls light across the whole nave and the result is a
    // uniform haze with no contact darkening — which reads as blurred shadows.
    // 14 measured indistinguishable from 8 by quantile — a screen-space gather cannot
    // bridge a nave whose lit surfaces are metres of dark stone away from its dark ones.
    // Kept at 8 for the tighter contact darkening.
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
    // Density and maxDensity interact: the pass clamps accumulated illumination at
    // maxDensity, so a density high enough to push most view rays past that clamp makes
    // every pixel land on the same value and the result is flat fog rather than beams.
    // Measured on this scene: 1.6 saturates everything, 0.4 is invisible, 0.7 keeps a
    // gradient between the lit air and the dark air.
    // 1.1 shipped by mistake against this own note: past ~0.8 the haze stops being
    // confined to the shafts and the whole nave fogs — the "blurred frame" a reviewer
    // flagged. 0.7 is the measured band.
    godraysDensity: 0.7,
    // 0.05: the fill lever the reference's ambience actually runs on. The floor discards
    // the pass's low-level scatter; at 0.09 the air between the beams was fully discarded
    // and the lower midtones sat 12 points under the reference (p25 11 vs 23) while SSGI
    // could not fill them at any intensity. The hemisphere light supplies the fill; the
    // floor stays at 0.05 so the long view rays down the nave keep their scatter.
    godraysFloor: 0.05,
    // 2.0: at 2.4 the beam-side band sat at p75 116 against the reference's 75 — the
    // shafts read, but the lit air between them glowed hotter than the stone.
    godraysIntensity: 2.0,
    // Back up from 24. That cut was made to buy frame time before MSAA was found to be
    // costing 55% of the GPU; with that recovered there is budget for a smooth march, and
    // 24 steps left visible slabs across the vault webs where each step boundary landed.
    godraysSteps: 56,
    // The blur GodraysNode's own docblock asks for, and the thing that actually removes the
    // stepping. Bilateral, so the hard edge where a mullion cuts a shaft survives it.
    godraysBlur: 2.5,
    // Low, because this number is what was washing the building out. The pass adds haze
    // to every pixel rather than only to the beams, so at 0.55 the darkest tenth of the
    // frame never went below 22% luminance and nothing in the nave read as shadow.
    godraysMaxDensity: 0.6,
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
    // Re-balanced once the stone carried real albedo maps. A photographed limestone
    // texture is far darker than the flat colour it replaced, so every exposure value
    // tuned against untextured stone reads two stops under once the maps land.
    exposure: 0.98,
  });
  environment.apply(renderer, scene, camera, sun);
}
