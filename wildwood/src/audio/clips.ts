/**
 * What the wood sounds like, and what it costs.
 *
 * ## The budget
 *
 * 512 KiB shipped, everything included. That is the number this catalogue was cut to, and the
 * delivered total is 497.9 KiB. For scale, the foliage pack alone is tens of megabytes: audio that
 * cost more than a single tree model would have been the wrong trade however good it sounded.
 *
 * Two decisions follow from it.
 *
 * **Ogg Vorbis, not mp3 and not Opus.** It is the one codec both targets decode. The native host
 * sniffs the container in `decodeAudioFile` and runs stb_vorbis on `OggS`; an Ogg carrying Opus is
 * explicitly rejected there, and every current browser reads Vorbis. Vorbis also carries an exact
 * sample count, so a loop survives encoding at the sample — mp3's encoder padding is the usual
 * reason a "seamless" loop clicks once a bar.
 *
 * **Short loops, cross-faded offline.** Nothing in the engine streams: `ctx.assets.audio` and
 * `AudioBus` both deal in a fully decoded `AudioBuffer`, so a four-minute bed would be about 92 MB
 * of resident float PCM. These four loops together decode to 13.7 MB, which is the price of not
 * having a streaming path (filed in the engine's `AUDIO-REQUESTS.md`). The wrap is made
 * inaudible by cross-fading the tail onto the head before encoding, because trimming it at runtime
 * would need `loopStart`, which the native host does not bind.
 *
 * The two beds are deliberately different lengths — 21.4 s and 14.1 s — so the pair does not
 * return to the same alignment for nearly five minutes. One 21 s loop on its own announces itself.
 */

/** Everything positional is mono: a panner collapses it anyway, and stereo would pay twice. */
export interface IClip {
  readonly path: string;
  readonly bytes: number;
}

const clip = (name: string, bytes: number): IClip => ({ path: `audio/${name}.ogg`, bytes });

/** Wind in high conifer branches. Stereo, 21.4 s, the layer that is always there. */
export const FOREST_BED = clip("forest-bed", 220_693);
/** Sparse birds and trunk creak. Mono, 14.1 s, quieter, and the reason the bed does not loop
 * audibly. */
export const FOREST_BIRDS = clip("forest-birds", 93_469);
/** Ripples on a stony shore. Mono, 11.6 s, positional, one voice per body of water. */
export const LAKE_SHORE = clip("lake-shore", 76_719);
/** The discovery acknowledgement. Stereo, 3 s, the only cue in the game a player waits for. */
export const LANDMARK_FOUND = clip("landmark-found", 20_788);

/** Underfoot. Three takes of each so a walk does not machine-gun one sample. */
export const SURFACES = ["grass", "leaf", "rock", "dirt", "water"] as const;
export type Surface = (typeof SURFACES)[number];

/**
 * Index order matches the terrain's own `layerWeight` attribute — grass, litter, rock, dirt — so
 * the surface underfoot is read off the mesh that was drawn rather than recomputed from a copy of
 * `layerWeights`. A formula duplicated into this lane would drift the first time the ground did.
 */
export const LAYER_SURFACES: readonly Surface[] = ["grass", "leaf", "rock", "dirt"];

export const STEP_VARIANTS = 3;

export function stepClip(surface: Surface, variant: number): string {
  return `audio/step-${surface}-${String(variant + 1)}.ogg`;
}

export const ALL_STEP_CLIPS: readonly string[] = SURFACES.flatMap((surface) =>
  Array.from({ length: STEP_VARIANTS }, (_, variant) => stepClip(surface, variant)),
);

/**
 * 497.9 KiB against a 512 KiB budget, measured on `public/audio/`.
 *
 * `src/audio/tools/` holds the three scripts that produced it — the prompts, the loop
 * cross-fade, and the measurement that proves the seams — so a re-generation is a re-run rather
 * than a re-invention.
 */
export const SHIPPED_BYTES = 509_854;
export const BUDGET_BYTES = 512 * 1024;
