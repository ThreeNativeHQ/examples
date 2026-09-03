// Generated for you. Keep the palette roles coherent when you change the look.
//
// A forest at mid-morning, after rain. Everything here is a look decision and nothing outside
// `src/render/` reads it.
//
// The ground roles are the seven layers this game borrows from its reference — Landscape Pro's
// auto-generated landscape material, where a layer is chosen per-pixel from slope and height
// rather than painted by hand. `terrain.ts` does the same choosing per-vertex.
export const palette = {
  // Sky and distance. All three are decoded out of `kloofendal_48d_2k.hdr` rather than picked:
  // the scene is lit by that photograph, so the colours the sky and the haze are painted with have
  // to be the ones the file actually contains or the two disagree. `light/sun.ts` records the
  // measurement and the bands each of these came from.
  /** The clean blue overhead — the 40°..20° band, far enough from the sun to be free of its haze. */
  skyHigh: 0x889bc6,
  /** The pale, desaturated band at eye level, where the ridge goes to meet the sky. */
  skyLow: 0xafb5c2,
  /** What distance costs: the measured all-azimuth horizon, which `sky.ts` fades every ridge into. */
  fog: 0xacb2c2,

  // The seven ground layers, driest and lowest first.
  silt: 0x6d6547, // the wet margin around standing water
  grass: 0x4f6b34, // flat, low, the default floor of the wood
  moss: 0x35502c, // the same ground in shade, greener and darker
  dirt: 0x5b4a34, // the transition band where grass gives out
  rock: 0x6a6660, // anything too steep to hold soil — drawn automatically by slope
  scree: 0x7c7469, // broken rock high on the ridge
  pale: 0x9aa08f, // the bleached crown of the ridge

  /**
   * The fill colour for shadowed surfaces.
   *
   * No longer wired to a light: `scene.environment` is an actual image of the sky now, so the
   * shadows are filled by the thing that is really up there, from the directions it is really in.
   * Kept as the palette's name for that colour, and as the value to reach for if this scene ever
   * needs a hemisphere light again.
   */
  skyFill: 0x9fb8d8,
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
  // Sunlight, and the one warm thing in the palette. ~5300 K: the direct beam at a 48° elevation
  // has lost its short wavelengths to the same scattering that turned the sky blue, so it is warm
  // against a ~12000 K sky. That difference *is* the warm/cool separation in every frame — what
  // the sun reaches is this colour, what it does not is `skyHigh`. `light/sun.ts` reads it.
  accent: 0xffe9c8,
  ember: 0xd98b4a,
} as const;
