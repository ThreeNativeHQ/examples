// Generated for you. This is ordinary Three.js — edit or delete it freely.
// ThreeNative does not read this file.
//
// The sky the valley has **from the first frame**, and the haze the ridge fades into.
//
// Why this file exists at all, given `sky-hdri.ts` loads a photograph: the photograph is a 5.4 MB
// download staged with the detail tier, and until it lands `scene.background` is null and the
// horizon meets pure black. Black is not a sky; it is the absence of one, and it was the first
// thing wrong with this scene. So an analytic sky is installed synchronously, in the same call
// that puts up the lights, and the photograph replaces it later from the same direction with the
// same brightness — a handover, not a change of weather.
//
// **It is built from the photograph, not from taste.** Every radiance in `SKY_RADIANCE` is a
// measured band of `kloofendal_48d_2k.hdr` (see `light/sun.ts`), and the scattering below is
// fitted to two more of them: the horizon toward the sun measures 2.7× the horizon away from it,
// which is what sets the forward-scatter lobe's weight. So the two skies agree on brightness,
// colour and where the sun is, and the swap does not read as one.
//
// The other half of the file is the aerial perspective, which is not atmosphere here but depth
// cueing doing real work: a wood is thousands of near-identical green objects at every distance,
// and without haze the far trees and the near trees are the same colour and the frame is flat.
// `FogExp2`, not `Fog`: linear fog has a far plane, and a far plane in an open valley draws a line
// on the ground where the haze stops that nothing in the world explains. Exponential-squared
// falloff is also what air actually does.
import {
  ClampToEdgeWrapping,
  Color,
  DataTexture,
  DataUtils,
  EquirectangularReflectionMapping,
  FogExp2,
  HalfFloatType,
  LinearFilter,
  LinearSRGBColorSpace,
  RGBAFormat,
  RepeatWrapping,
  type Scene,
  Vector3,
} from "three";
import { SKY_RADIANCE, sunDirection } from "./light/sun.js";
import { palette } from "./palette.js";

/**
 * Equirect resolution of the generated sky.
 *
 * 512×256 is one texel per 0.7°, which is finer than anything in a gradient needs and just fine
 * enough that the sun disc is a disc rather than a square. It is generated once, on the CPU, in
 * about a millisecond — there is no render target and no PMREM call here, because
 * `WebGPURenderer` prefilters an equirect environment itself the first frame it uses one, exactly
 * as it does for the `.hdr`.
 *
 * **Half float, not float.** WebGPU will not linearly filter an `rgba32float` texture without the
 * `float32-filterable` feature, and a sky that cannot be filtered is a sky in visible 0.7° blocks
 * — or no sky at all, depending on the backend. `rgba16float` is filterable everywhere and holds
 * 65504, which is eighty times the brightest value here. It is also what `HDRLoader` produces by
 * default, so the two skies are the same kind of texture as well as the same picture.
 */
const SKY_WIDTH = 512;
const SKY_HEIGHT = 256;

/**
 * Angular radius of the sun's disc, radians. The real one, 0.266°.
 *
 * The disc is worth having even though a `DirectionalLight` already carries the sun: a directional
 * light produces no *specular* sun, so without this the pond has no glint and wet stone has no
 * hot spot. What it must not do is carry the sun's energy twice, and it does not — a disc this
 * small subtends 6.8e-5 steradian, so even at the radiance below it adds under 0.05 to the
 * irradiance the key light supplies at 3.4.
 */
const SUN_ANGULAR_RADIUS = 0.00465;
const SUN_DISC_RADIANCE = 900;

/**
 * How the forward-scattered haze around the sun is shaped. Fitted, not guessed:
 *
 *   the horizon 48° from the sun measures 0.755, 0.855, 1.050
 *   the horizon opposite it measures     0.275, 0.289, 0.372
 *
 * so `horizon` below is the second of those, `excess` is what the first adds on top, and `weight`
 * is what makes the lobe reach the first from the second at that angle. `airMass` is why the
 * zenith does not get the same treatment: forward scatter needs air to scatter in, there is far
 * less of it looking up than looking along, and without this term the top of the sky came out
 * brighter than the measured band by half again.
 */
const SCATTER = {
  horizon: [0.3, 0.32, 0.4],
  excess: [0.46, 0.53, 0.65],
  weight: 1.35,
  lobe: 0.8,
  airMass: 1.5,
  /** The tight circumsolar halo, on top of the broad lobe. */
  glowExponent: 140,
  glowWeight: 3,
} as const;

/** Where the ridge fades to: the measured all-azimuth horizon band of the photograph. */
export const AERIAL_COLOUR = palette.fog;

/**
 * How bright the sky is *as a light*, as opposed to as a picture.
 *
 * **0.35 was the clear-day ratio and it was wrong, and the capture is why.** The argument for it
 * was sound: outdoors under a cloudless sky the sun delivers about six times the irradiance the
 * sky does, so a fifth of the key light is the physical fill. What that argument leaves out is
 * that this scene is not outdoors — it is *under a closed canopy*, where the sun reaches almost
 * nothing the camera can see, and every visible leaf underside is lit by skylight and by light
 * transmitted through the leaves above it. Removing the fill removed the only one of those two
 * this renderer has. Measured on the spawn view: 8.5% of the frame crushed to black and the
 * ground's shadowed quartile fell to 0.004 — the wood went from flat to unlit.
 *
 * Doubled to 0.7, which is one stop and an empirical number rather than a derived one. The stop
 * of range the rig gained is kept (4.55 → 6.3 between the 5th and 95th percentiles) because what
 * is being lifted is the part of the frame the sun never reached; the sunlit floor is still
 * dominated by the key and does not move with it.
 *
 * Nothing calibrates three's light intensities against the `.hdr`'s radiances anyway — both
 * scales are arbitrary — so the ratio between them was only ever a starting guess, and a capture
 * outranks it.
 *
 * It lives here, and `lighting.ts` does not touch it, because two files writing one property is
 * how the value that is actually in effect stops being the value anyone reads.
 * `sky-hdri.ts` matches its own intensity to this one so the handover is not a change in weather.
 */
export const SKY_ENVIRONMENT_INTENSITY = 0.7;

/**
 * Haze density. `FogExp2` attenuates by `1 - exp(-(density·distance)²)`, so this puts the far
 * ridge at 120 m about 55% into the haze while the ground at the player's feet is under a tenth
 * of a percent — depth cueing that separates the wood without touching the thing being looked at.
 */
export const AERIAL_DENSITY = 0.0072;

/** Henyey-Greenstein, normalised so that looking straight at the sun returns 1. */
function forwardScatter(cosAngle: number): number {
  return Math.max(cosAngle, 0) ** SCATTER.lobe;
}

/**
 * Builds the sky as an equirectangular radiance map, in the renderer's linear working space.
 *
 * The texel layout is three's, and it is worth stating because getting it wrong flips the sky
 * upside down in a way that looks like a lighting bug: `equirectUV` samples with
 * `u = atan2(z, x)/2π + 0.5` and `v = asin(y)/π + 0.5`, and `DataTexture` sets `flipY = false`,
 * so **row 0 is v = 0 is straight down** and the last row is the zenith. That is the opposite of
 * an image file's row order, which is why `HDRLoader` sets `flipY = true` and this does not.
 */
export function createSkyTexture(): DataTexture {
  const radiance = new Float32Array(SKY_WIDTH * SKY_HEIGHT * 4);
  const sun = sunDirection();
  const direction = new Vector3();

  for (let row = 0; row < SKY_HEIGHT; row += 1) {
    const v = (row + 0.5) / SKY_HEIGHT;
    const y = Math.sin((v - 0.5) * Math.PI);
    const horizontal = Math.sqrt(Math.max(0, 1 - y * y));
    for (let column = 0; column < SKY_WIDTH; column += 1) {
      const u = (column + 0.5) / SKY_WIDTH;
      const phi = (u - 0.5) * Math.PI * 2;
      direction.set(horizontal * Math.cos(phi), y, horizontal * Math.sin(phi));
      const cosAngle = direction.dot(sun);
      const index = (row * SKY_WIDTH + column) * 4;

      if (y <= 0) {
        // Looking down. This is what lights the underside of every fern, so it is the scene's
        // own floor colour rather than the quarry's pale dust — see `SKY_RADIANCE.ground`. It
        // lifts toward the horizon haze in the last few degrees so the join is not a hard line.
        const lift = Math.min(1, Math.max(0, (y + 0.14) / 0.14)) ** 2;
        for (let channel = 0; channel < 3; channel += 1) {
          const ground = SKY_RADIANCE.ground[channel] as number;
          const edge = (SCATTER.horizon[channel] as number) * 0.72;
          radiance[index + channel] = ground + (edge - ground) * lift;
        }
        radiance[index + 3] = 1;
        continue;
      }

      // Looking up: a height gradient, plus the haze the sun scatters forward through it.
      const height = y ** 0.42;
      const air = (1 - y) ** SCATTER.airMass;
      const broad = SCATTER.weight * forwardScatter(cosAngle) * air;
      const glow = SCATTER.glowWeight * Math.max(cosAngle, 0) ** SCATTER.glowExponent;
      // The disc itself, softened over about a third of a degree so it survives the 0.7° texel
      // grid as a round bright thing rather than as one square pixel.
      const angle = Math.acos(Math.min(1, cosAngle));
      const disc =
        angle > SUN_ANGULAR_RADIUS * 2.2
          ? 0
          : 1 - Math.min(1, Math.max(0, (angle - SUN_ANGULAR_RADIUS) / (SUN_ANGULAR_RADIUS * 1.2)));

      for (let channel = 0; channel < 3; channel += 1) {
        const base =
          (SCATTER.horizon[channel] as number) +
          ((SKY_RADIANCE.zenith[channel] as number) - (SCATTER.horizon[channel] as number)) * height;
        const scattered = (SCATTER.excess[channel] as number) * (broad + glow);
        radiance[index + channel] = base + scattered + disc * SUN_DISC_RADIANCE;
      }
      radiance[index + 3] = 1;
    }
  }

  const data = new Uint16Array(radiance.length);
  for (let index = 0; index < radiance.length; index += 1) {
    data[index] = DataUtils.toHalfFloat(radiance[index] as number);
  }

  const texture = new DataTexture(data, SKY_WIDTH, SKY_HEIGHT, RGBAFormat, HalfFloatType);
  texture.mapping = EquirectangularReflectionMapping;
  texture.colorSpace = LinearSRGBColorSpace;
  // Repeat across the seam at u = 0, clamp at the poles: a wrapping T would sample the nadir
  // when it asked for the zenith and put a bright ring at the top of the sky.
  texture.wrapS = RepeatWrapping;
  texture.wrapT = ClampToEdgeWrapping;
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  texture.flipY = false;
  texture.needsUpdate = true;
  texture.name = "analytic-sky";
  return texture;
}

/**
 * Installs that sky as both the visible background and the light the scene is lit by, and sets
 * the aerial perspective.
 *
 * Called from `setupForestLighting`, not from the scene: the sky and the key light are one
 * decision, and a caller that could do one without the other is a caller that can ship a valley
 * lit from the east under a sun in the west. `sky-hdri.ts` replaces all four of these values when
 * the photograph arrives.
 */
export function setupSky(scene: Scene): DataTexture {
  const texture = createSkyTexture();
  scene.background = texture;
  scene.environment = texture;
  scene.environmentIntensity = SKY_ENVIRONMENT_INTENSITY;
  scene.backgroundIntensity = 1;
  // Explicitly square, not left alone. This texture is generated already facing the right way,
  // so any rotation at all is wrong for it — and a rotation is exactly the kind of state that
  // survives a scene re-enter after `sky-hdri.ts` has set one.
  scene.backgroundRotation.set(0, 0, 0);
  scene.environmentRotation.set(0, 0, 0);
  scene.fog = new FogExp2(new Color(AERIAL_COLOUR), AERIAL_DENSITY);
  console.info(
    `TN_SKY_ANALYTIC:${JSON.stringify({
      aerialColour: `#${AERIAL_COLOUR.toString(16)}`,
      aerialDensity: AERIAL_DENSITY,
      environmentIntensity: SKY_ENVIRONMENT_INTENSITY,
      resolution: [SKY_WIDTH, SKY_HEIGHT],
    })}`,
  );
  return texture;
}
