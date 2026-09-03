// The one place the sun exists.
//
// Four things have to agree about where the light comes from, and two of them disagreeing is
// invisible in code review and unmistakable in a screenshot: the key light and its shadow
// (`lighting.ts`), the analytic sky that is on screen before the photograph finishes loading
// (`sky.ts`), the rotation that aligns that photograph once it does (`sky-hdri.ts`), and the
// aerial perspective the ridge fades into (`sky.ts` again). So there is one sun here and four
// readers, rather than four positions that were once typed to match.
//
// **The direction is measured, not chosen.** The valley is lit by Poly Haven's
// `kloofendal_48d_2k.hdr`, and where the sun is in that photograph is a fact about the file, not
// a preference. Decoding the Radiance scanlines and taking the luminance-weighted centroid of the
// brightest 0.02% of texels puts it at:
//
//     elevation      47.87°
//     azimuth        34.24°     in three's own equirect convention, azimuth = atan2(z, x)
//     peak radiance  71168, 73216, 70144   — a white sun carrying half the sky's total energy
//     sky average     0.643, 0.694, 0.812  — clear, blue, cloudless
//
// The `48d` in the file's own name is that elevation, which is the check that the decode is right.
//
// **So the time of day is late morning, and it is a commitment.** A 48° sun is not the golden
// hour, and nothing here pretends otherwise: shadows are short and hard rather than long and
// raking. What that buys instead is the light this particular scene is actually about — a sun
// steep enough to drive shafts *down through* a canopy, which is the forest lighting event worth
// having, and which a 15° sun grazing the tops cannot produce. Rotating the sky is free (one
// azimuth dial); tilting it is not — an equirect map tilted to lower the sun tilts the horizon
// with it by the same angle, and a slanted horizon is a bug in every frame. The elevation is the
// photograph's, therefore, and the honest move is to light the ground with it rather than to lie.
import { MathUtils, Vector3 } from "three";
import { palette } from "../palette.js";

/** Elevation of the photographed sun above the horizon, radians. Measured; see the header. */
export const SUN_ELEVATION = MathUtils.degToRad(47.87);

/**
 * Azimuth of the photographed sun, radians, as `atan2(z, x)` — the same convention three's
 * `equirectUV` samples an environment map with (`u = atan2(z, x) / 2π + 0.5`).
 */
export const SUN_AZIMUTH = MathUtils.degToRad(34.24);

/**
 * What `sky-hdri.ts` turns `scene.environmentRotation.y` and `backgroundRotation.y` to.
 *
 * Zero, deliberately. The world sun is placed at the photograph's own azimuth, so the sky needs
 * no rotation to agree with the ground and there is no sign convention to get backwards. Turning
 * this dial moves the photographed sun and the key light together — they both read `SUN_AZIMUTH`
 * — only if you turn `SUN_AZIMUTH` too, which is the point of them living in one file.
 */
export const SKY_ROTATION = 0;

/** How far up the sun is placed. Only the shadow camera's near/far care; the direction is what matters. */
export const SUN_DISTANCE = 220;

/**
 * Unit vector from the valley toward the sun — the direction a surface points to face it, and
 * (scaled by `SUN_DISTANCE`) where the key light stands.
 */
export function sunDirection(target = new Vector3()): Vector3 {
  const horizontal = Math.cos(SUN_ELEVATION);
  return target.set(
    horizontal * Math.cos(SUN_AZIMUTH),
    Math.sin(SUN_ELEVATION),
    horizontal * Math.sin(SUN_AZIMUTH),
  );
}

/**
 * Radiances the analytic sky is built from and the fog fades to, in the renderer's linear working
 * space — the same units the `.hdr` is in, so the two skies are the same brightness and the
 * handover from one to the other is not a visible step.
 *
 * Every number is the measured average of an elevation band of the photograph, except where noted:
 *
 *   band            measured                used as
 *   40°..20°        0.245, 0.324, 0.564     `zenith` — the cleanest blue in the file, far enough
 *                                           from the sun that the circumsolar haze is not in it.
 *                                           The literal 90°..60° band measures *brighter* than
 *                                           this one (0.466, 0.514, 0.676) because at a 48°
 *                                           elevation the sun sits inside it.
 *   5°..-5°         0.415, 0.447, 0.542     `horizon`
 *   0°..45° azim    0.755, 0.855, 1.050     `sunward`, the forward-scattered haze around the sun
 *   180°..225°      0.275, 0.289, 0.372     the horizon away from it — 2.7× darker, which is the
 *                                           ratio the Henyey-Greenstein lobe in `sky.ts` is fitted to
 *   -20°..-90°      0.145, 0.168, 0.244     `ground`, but overridden below
 */
export const SKY_RADIANCE = {
  /** Clear blue overhead. */
  zenith: [0.25, 0.33, 0.58],
  /** Hazy, desaturated, brighter than the zenith — where the ridge goes to meet the sky. */
  horizon: [0.44, 0.47, 0.55],
  /** The warm-white forward scatter around the sun, at its peak. */
  sunward: [0.78, 0.84, 0.96],
  /**
   * What the environment map sees looking *down*, which is what lights the underside of every
   * fern and the shaded face of every trunk.
   *
   * The one number here that is not the photograph's. Kloofendal is a quarry: its lower hemisphere
   * is pale dust, and borrowing that would light this wood's undersides with the wrong bounce.
   * A forest floor is dark, warm and green, so this is the palette's own bounce colour taken down
   * to the measured *brightness* of that band rather than its colour.
   */
  ground: [0.105, 0.108, 0.078],
} as const;

/**
 * The colour of the direct beam.
 *
 * The photograph's sun texels read very nearly neutral (71168, 73216, 70144) because a sun that
 * bright is at the top of the file's range whatever colour it was. Physically the beam at a 48°
 * elevation has lost its short wavelengths to the same scattering that made the sky blue, so it
 * arrives around 5300 K — warm against a ~12000 K sky. That difference is the whole of the
 * warm/cool separation between what the sun reaches and what it does not, and it is the reason
 * this is a look decision stated out loud rather than the measured white.
 */
export const SUN_COLOUR = palette.accent;
