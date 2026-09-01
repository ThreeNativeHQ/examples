// Generated for you. Keep the palette roles coherent when you change the look.
//
// A forest at mid-morning, after rain. Everything here is a look decision and nothing outside
// `src/render/` reads it.
//
// The ground roles are the seven layers this game borrows from its reference — Landscape Pro's
// auto-generated landscape material, where a layer is chosen per-pixel from slope and height
// rather than painted by hand. `terrain.ts` does the same choosing per-vertex.
export const palette = {
  // Sky and distance.
  skyHigh: 0x6ea8e6,
  skyLow: 0xf0f4ee,
  fog: 0xd8e4d8,

  // The seven ground layers, driest and lowest first.
  silt: 0x6d6547, // the wet margin around standing water
  grass: 0x4f6b34, // flat, low, the default floor of the wood
  moss: 0x35502c, // the same ground in shade, greener and darker
  dirt: 0x5b4a34, // the transition band where grass gives out
  rock: 0x6a6660, // anything too steep to hold soil — drawn automatically by slope
  scree: 0x7c7469, // broken rock high on the ridge
  pale: 0x9aa08f, // the bleached crown of the ridge

  /** The fill colour for shadowed surfaces: sky, but desaturated so it lifts without tinting. */
  skyFill: 0xa8c4d8,
  /** What the floor bounces back up. Warm, because a forest floor is brown and gold, not blue. */
  bounce: 0x8a7a4e,

  // Everything that stands on the ground.
  bark: 0x4a3a2c,
  canopy: 0x4a6b28,
  canopyLight: 0x87a63f,
  fern: 0x40632f,
  blade: 0x6d8a3d,
  water: 0x2b4a4a,
  stone: 0x6f6b64,
  accent: 0xfff0cc, // sunlight, and the one warm thing in the palette
  ember: 0xd98b4a,
} as const;
