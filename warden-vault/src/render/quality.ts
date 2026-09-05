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
import type { IPainterlyOptions } from "./painterly.js";
import type { IWorldEnvironmentOptions } from "./worldEnvironment.js";

/**
 * A preset is the framework's chain options plus this kit's own painterly knobs. The two are
 * separate types because they belong to different layers: `worldEnvironment.ts` is shared with
 * every other kit and must not know what a watercolour is.
 */
type QualitySettings = IWorldEnvironmentOptions & IPainterlyOptions;

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
 * What a desktop gets.
 *
 * The starter's painterly chain — outline, Kuwahara, watercolour — is off in every tier here, by
 * name rather than by deletion, so `TN_WORLD_ENVIRONMENT` still reports each one as *not
 * requested* instead of silently vanishing. The reference this game is built to is a clean
 * stylised render, and a Kuwahara smear at this camera distance eats the plank braces on the
 * crates, which are the only surface detail in the room.
 *
 * What is on instead: contact occlusion, because a pile of forty crates is nothing but contacts,
 * and bloom over a high threshold, because exactly two things in the vault emit — the lanterns
 * and the seal — and they are supposed to be the only things that glow.
 */
const high: QualitySettings = {
  bloomEnabled: true,
  bloomRadius: 0.42,
  bloomStrength: 0.62,
  // High, on purpose: the lantern flames and the seal plate clear it and nothing lit does.
  bloomThreshold: 0.82,
  denoiseEnabled: false,
  exposure: 1.06,
  // Contact scale, in metres. A crate is 0.92 m, so half a metre gathers the crease where two
  // crates meet and the shadow where one meets the floor, and no further.
  gtaoEnabled: true,
  gtaoRadius: 0.5,
  gtaoResolutionScale: 0.5,
  gtaoSamples: 12,
  gtaoScale: 1.25,
  ssgiEnabled: false,
  ssrEnabled: false,
  sharpenEnabled: true,
  // RCAS is a radius: 0 is maximum sharpening and 2 is none.
  sharpenStrength: 0.95,
  vignetteAmount: 0.34,
  outlineEnabled: false,
  kuwaharaEnabled: false,
  watercolorEnabled: false,
  renderChainTier: "high",
  tonemapMode: "aces",
};

/** A machine between the two: the same look with a cheaper occlusion gather. */
const medium: QualitySettings = {
  bloomEnabled: true,
  bloomRadius: 0.38,
  bloomStrength: 0.56,
  bloomThreshold: 0.84,
  denoiseEnabled: false,
  exposure: 1.05,
  gtaoEnabled: true,
  gtaoRadius: 0.45,
  gtaoResolutionScale: 0.4,
  gtaoSamples: 8,
  gtaoScale: 1.2,
  ssgiEnabled: false,
  ssrEnabled: false,
  sharpenEnabled: false,
  vignetteAmount: 0.3,
  outlineEnabled: false,
  kuwaharaEnabled: false,
  watercolorEnabled: false,
  renderChainTier: "medium",
  tonemapMode: "aces",
};

/**
 * What a phone gets: bloom and a vignette, no screen-space gather at all. The occlusion is the
 * first thing to go — forty simulated bodies are already the frame's budget on a phone.
 */
const low: QualitySettings = {
  bloomEnabled: true,
  bloomRadius: 0.32,
  bloomStrength: 0.48,
  bloomThreshold: 0.86,
  exposure: 1.04,
  gtaoEnabled: false,
  sharpenEnabled: false,
  vignetteAmount: 0.28,
  outlineEnabled: false,
  kuwaharaEnabled: false,
  watercolorEnabled: false,
  renderChainTier: "low",
  tonemapMode: "aces",
};

const QUALITY_PRESETS: Record<QualityTier, QualitySettings> = { high, low, medium };

/** The stages and strengths a tier turns on. Throws on a name that is not a tier. */
export function qualityPreset(tier: string): QualitySettings {
  const preset = QUALITY_PRESETS[tier as QualityTier];
  if (preset === undefined) {
    throw new Error(
      `Unknown quality tier ${JSON.stringify(tier)} — expected one of ${QUALITY_TIERS.join(", ")}.`,
    );
  }
  return preset;
}
