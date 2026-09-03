// Generated for you: ordinary Three.js; ThreeNative does not read this file. Delete or rewrite
// it freely — the tiers below are a starting point, not a framework look.
//
// This is the one place this game decides how expensive it looks. `postprocessing.ts` reads
// `qualityPreset(resolveQualityTier(...))` and nothing else, so "make it run on a phone" is one
// file to edit rather than a hunt through anonymous literals.
//
// **Where the numbers come from.** Every millisecond below is GPU time from the per-stage
// ablation recorded in the engine repository's `docs/verification/runtime-perf-state.md`: Chrome
// on an RTX 2080, 1600x900, static build, `gpuMs` read from three's `timestamp-query`. In that
// scene the whole five-stage chain costs **12.5 ms of a 14.7 ms GPU frame**, and the same frame
// with every stage off costs **2.2 ms**. The per-stage figures oversum — removing SSGI also
// removes the denoise passes the later stages sample — so read each as *what turning this one off
// gave back*, not as a share of a partition. A stage nobody has ablated on its own says
// `unmeasured` rather than guessing, and your scene is not that scene: read `TN_FRAME_BUDGET`
// back after you change a tier.
//
// One cost that is **not** a stage here and outweighs most of them: the prefiltered reflection
// probe on `scene.environment`, measured at **~6.3 ms of an 18-19 ms Pixel 8 frame**. It is set
// in `sky.ts`, not in this file.
//
import type { IWorldEnvironmentOptions } from "./worldEnvironment.js";

/**
 * The three names this game's look comes in.
 *
 * `low` is what a phone gets and `high` what a desktop gets — those two are this template's
 * shipped looks, unchanged. `medium` is the rung in between for a machine that is neither: a
 * laptop iGPU, a handheld, a desktop that is dropping frames. Nothing outside this file decides
 * what any of them mean.
 */
export type QualityTier = "low" | "medium" | "high";

const QUALITY_TIERS: readonly QualityTier[] = ["low", "medium", "high"];

/**
 * Narrows an arbitrary string — a URL parameter, a saved setting — to a tier name. Not exported:
 * `resolveQualityTier` is the one door in, so an unknown name cannot be waved past the throw.
 */
function isQualityTier(value: string): value is QualityTier {
  return (QUALITY_TIERS as readonly string[]).includes(value);
}

/**
 * Picks the tier: an explicit `tier` always wins, otherwise the platform decides.
 *
 * Fails closed. An unrecognised tier name throws with the value it was handed rather than
 * quietly rendering the default, because a silent fallback here looks exactly like a tier that
 * turned out to have no effect.
 */
export function resolveQualityTier(
  request: { readonly mobile?: boolean; readonly tier?: string } = {},
): QualityTier {
  const requested = request.tier;
  if (requested !== undefined) {
    if (!isQualityTier(requested)) {
      throw new Error(
        `Unknown quality tier ${JSON.stringify(requested)} — expected one of ${QUALITY_TIERS.join(", ")}.`,
      );
    }
    return requested;
  }
  return request.mobile === true ? "low" : "high";
}

/**
 * What a desktop gets: this template's shipped desktop look, unchanged.
 *
 * The whole chain measured 12.5 ms of a 14.7 ms GPU frame in the reference ablation, and SSGI
 * with its denoiser is ~9.2 ms of that.
 */
const high: IWorldEnvironmentOptions = {
  // Bloom: ~4.6 ms — the second most expensive stage in the chain, and the one nobody expects
  // to be.
  //
  // **The threshold is the change that stopped this scene being milky.** `WorldEnvironment`
  // defaults it to 0.2, and no tier here used to set it, so every pixel brighter than a fifth of
  // scene white bloomed — which in a lit wood is most of the ground and all of the canopy. A
  // whole-frame lift added to a whole frame is not glow, it is fog on the lens, and it was
  // flattening the image before the tone curve ever saw it. At 1.05 only things that are
  // genuinely brighter than a lit diffuse surface bloom: the sky through the canopy, the sun's
  // glint off water, the hot edge of a leaf. That is what bloom is for.
  bloomEnabled: true,
  bloomStrength: 0.45,
  bloomThreshold: 1.05,
  exposure: 0.94,
  // The two full-resolution denoise passes over the AO and GI terms: ~1.9 ms. Only worth running
  // when SSGI is on — its noise is what they clean up.
  denoiseEnabled: true,
  // Shafts through the canopy, which is the lighting event this scene is actually about: a 48°
  // sun over a closed canopy is the condition that produces them, and a wood without them is a
  // wood in an overcast. Raymarched against the sun's shadow map, so `postprocessing.ts` holds
  // the chain back until that map exists — see the note there.
  godraysEnabled: true,
  // Density is how much air there is to light. `floor` is the number that makes this a shaft
  // renderer rather than a whole-frame brightener: the pass returns something for nearly every
  // pixel, that something is tiny in linear space and enormous after the tone curve, and
  // subtracting a floor discards the ambient lift while leaving the beams. `maxDensity` is the
  // single strongest control over how bright the *entire* frame is, for the same reason.
  //
  // **Raise the floor, not the ceiling — this was learned the expensive way.** Trying to make
  // faint shafts visible by lifting `maxDensity` 0.3 -> 0.6 did make them visible looking into
  // the canopy toward the sun, and simultaneously turned the open pond view into a white-out:
  // every pixel got the lift, and a view with a whole sky in it and no occlusion to break the
  // beam is where that shows. The shape that works is a *high* floor with a high intensity above
  // it: the ambient term is discarded before it is multiplied, so the beams get brighter and the
  // frame does not.
  godraysDensity: 0.6,
  godraysFloor: 0.09,
  godraysIntensity: 2.8,
  godraysMaxDensity: 0.35,
  // Every step is a shadow-map sample, so this multiplies straight into the cost of the pass.
  // `GodraysNode` defaults to 60; the jittered sampling means fewer trades a slightly noisier
  // shaft edge for proportionally less work, and the denoiser downstream absorbs most of that.
  // 32 rather than 60 because this frame is already at ~70 ms and the shafts are the last thing
  // that should be what pushes it over.
  godraysSteps: 32,
  gtaoEnabled: true,
  // Contact scale, in metres: the gap between a foot and the floor, a stem and the soil, a
  // boulder and the grass around it. Not room scale — SSGI's own occlusion term already gathers
  // over `ssgiRadius`, which is metres, and the two are deliberately different questions.
  //
  // **0.18 m, not the 0.5 m this was first set to, and the difference is a fern.** Half a metre
  // sounds like contact scale until you look at what is within half a metre of any pixel in a
  // wood: in a fern understory every frond is inside that radius of every other, so the gather
  // returns "heavily occluded" for most of the frame and the occlusion stops describing contact
  // and starts describing density. Measured on the spawn view, 0.5 m put 25% of the frame below
  // 5/255 — crushed, not moody, with the detail gone. 0.18 m is the scale of the things this is
  // supposed to be drawing: the dark line where a stem enters the soil.
  gtaoRadius: 0.18,
  // Exponent on the occlusion term, so it compounds with the radius above. Back to under 1 for
  // the same reason: two multipliers each set a little dark is how a scene ends up black.
  gtaoScale: 0.9,
  gtaoSamples: 16,
  // Half resolution. Occlusion at contact scale is low-frequency by construction and the sharpen
  // stage downstream puts the edge back; the ablation this file's numbers come from never
  // measured this stage, so treat its cost as unknown until `TN_FRAME_BUDGET` says otherwise.
  gtaoResolutionScale: 0.5,
  // SSGI, the screen-space indirect-light gather: ~7.3 ms alone, ~9.2 ms with the two denoise
  // passes it feeds. The largest stage in the chain by a factor of two, of a 14.7 ms frame.
  // Dropping this pair is what `medium` is.
  ssgiEnabled: true,
  ssgiQuality: "medium",
  // Screen-space reflections: ~4.1 ms.
  ssrEnabled: true,
  // A reflection carries almost no high-frequency detail, so half resolution costs a quarter of
  // the rays and is very hard to see in the result.
  ssrResolutionScale: 0.5,
  // RCAS sharpen: unmeasured — never ablated on its own here. It puts back the micro-detail the
  // denoiser and the half-resolution reflection take out, so it earns its cost only on a tier
  // that runs one of them.
  sharpenEnabled: true,
  // **0 is maximum sharpening and 2 is none** — it is a radius, not a gain.
  sharpenStrength: 0.28,
  // A sixth of a stop off the extreme corner. Not a mood: every real lens does this, and its
  // absence is one of the things that reads as "rendered" rather than "photographed".
  vignetteAmount: 0.18,
  tonemapMode: "aces",
};

/**
 * `high` minus the gather and its denoiser — the single change in this chain measured to give
 * back most of the frame: **14.7 ms -> 5.5 ms of GPU** in the reference ablation. Reflections,
 * bloom and the sharpener stay, so it is recognisably the same look.
 */
const medium: IWorldEnvironmentOptions = {
  // Bloom: ~4.6 ms — the second most expensive stage in the chain, and the one nobody expects
  // to be.
  //
  // **The threshold is the change that stopped this scene being milky.** `WorldEnvironment`
  // defaults it to 0.2, and no tier here used to set it, so every pixel brighter than a fifth of
  // scene white bloomed — which in a lit wood is most of the ground and all of the canopy. A
  // whole-frame lift added to a whole frame is not glow, it is fog on the lens, and it was
  // flattening the image before the tone curve ever saw it. At 1.05 only things that are
  // genuinely brighter than a lit diffuse surface bloom: the sky through the canopy, the sun's
  // glint off water, the hot edge of a leaf. That is what bloom is for.
  bloomEnabled: true,
  bloomStrength: 0.45,
  bloomThreshold: 1.05,
  exposure: 0.94,
  // Shafts through the canopy, which is the lighting event this scene is actually about: a 48°
  // sun over a closed canopy is the condition that produces them, and a wood without them is a
  // wood in an overcast. Raymarched against the sun's shadow map, so `postprocessing.ts` holds
  // the chain back until that map exists — see the note there.
  godraysEnabled: true,
  // Density is how much air there is to light. `floor` is the number that makes this a shaft
  // renderer rather than a whole-frame brightener: the pass returns something for nearly every
  // pixel, that something is tiny in linear space and enormous after the tone curve, and
  // subtracting a floor discards the ambient lift while leaving the beams. `maxDensity` is the
  // single strongest control over how bright the *entire* frame is, for the same reason.
  //
  // **Raise the floor, not the ceiling — this was learned the expensive way.** Trying to make
  // faint shafts visible by lifting `maxDensity` 0.3 -> 0.6 did make them visible looking into
  // the canopy toward the sun, and simultaneously turned the open pond view into a white-out:
  // every pixel got the lift, and a view with a whole sky in it and no occlusion to break the
  // beam is where that shows. The shape that works is a *high* floor with a high intensity above
  // it: the ambient term is discarded before it is multiplied, so the beams get brighter and the
  // frame does not.
  godraysDensity: 0.6,
  godraysFloor: 0.09,
  godraysIntensity: 2.8,
  godraysMaxDensity: 0.35,
  // Every step is a shadow-map sample, so this multiplies straight into the cost of the pass.
  // `GodraysNode` defaults to 60; the jittered sampling means fewer trades a slightly noisier
  // shaft edge for proportionally less work, and the denoiser downstream absorbs most of that.
  // 32 rather than 60 because this frame is already at ~70 ms and the shafts are the last thing
  // that should be what pushes it over.
  godraysSteps: 24,
  gtaoEnabled: true,
  gtaoRadius: 0.18,
  gtaoScale: 0.9,
  gtaoSamples: 8,
  gtaoResolutionScale: 0.5,
  // Screen-space reflections: ~4.1 ms.
  ssrEnabled: true,
  // A reflection carries almost no high-frequency detail, so half resolution costs a quarter of
  // the rays and is very hard to see in the result.
  ssrResolutionScale: 0.5,
  // RCAS sharpen: unmeasured — never ablated on its own here. It puts back the micro-detail the
  // denoiser and the half-resolution reflection take out, so it earns its cost only on a tier
  // that runs one of them.
  sharpenEnabled: true,
  // **0 is maximum sharpening and 2 is none** — it is a radius, not a gain.
  sharpenStrength: 0.28,
  // A sixth of a stop off the extreme corner. Not a mood: every real lens does this, and its
  // absence is one of the things that reads as "rendered" rather than "photographed".
  vignetteAmount: 0.18,
  tonemapMode: "aces",
};

/**
 * What a phone gets: this template's shipped mobile look, unchanged. The sharpener stays on
 * because it shipped on — nothing upstream of it blurs at this tier, so it is doing very little,
 * and its cost here is unmeasured.
 */
const low: IWorldEnvironmentOptions = {
  // Bloom: ~4.6 ms — the second most expensive stage in the chain, and the one nobody expects
  // to be.
  //
  // **The threshold is the change that stopped this scene being milky.** `WorldEnvironment`
  // defaults it to 0.2, and no tier here used to set it, so every pixel brighter than a fifth of
  // scene white bloomed — which in a lit wood is most of the ground and all of the canopy. A
  // whole-frame lift added to a whole frame is not glow, it is fog on the lens, and it was
  // flattening the image before the tone curve ever saw it. At 1.05 only things that are
  // genuinely brighter than a lit diffuse surface bloom: the sky through the canopy, the sun's
  // glint off water, the hot edge of a leaf. That is what bloom is for.
  bloomEnabled: true,
  bloomStrength: 0.45,
  bloomThreshold: 1.05,
  exposure: 0.94,
  gtaoEnabled: true,
  gtaoRadius: 0.18,
  gtaoScale: 0.9,
  gtaoSamples: 8,
  gtaoResolutionScale: 0.5,
  // RCAS sharpen: unmeasured — never ablated on its own here. It puts back the micro-detail the
  // denoiser and the half-resolution reflection take out, so it earns its cost only on a tier
  // that runs one of them.
  sharpenEnabled: true,
  // **0 is maximum sharpening and 2 is none** — it is a radius, not a gain.
  sharpenStrength: 0.28,
  // A sixth of a stop off the extreme corner. Not a mood: every real lens does this, and its
  // absence is one of the things that reads as "rendered" rather than "photographed".
  vignetteAmount: 0.18,
  tonemapMode: "aces",
};

const QUALITY_PRESETS: Record<QualityTier, IWorldEnvironmentOptions> = { high, low, medium };

/** The stages and strengths a tier turns on. Throws on a name that is not a tier. */
export function qualityPreset(tier: string): IWorldEnvironmentOptions {
  const preset = QUALITY_PRESETS[tier as QualityTier];
  if (preset === undefined) {
    throw new Error(
      `Unknown quality tier ${JSON.stringify(tier)} — expected one of ${QUALITY_TIERS.join(", ")}.`,
    );
  }
  return preset;
}
