// A Poly Haven HDRI standing in for the analytic sky in `sky.ts` — the same job (background + the
// light the wood is lit by) done with a photograph of the real thing.
//
// The asset is `public/hdri/kloofendal_48d_2k.hdr`: Poly Haven's "Kloofendal 48d", a clear
// cloudless sky with the sun 48° up. CC0, credited in `CREDITS-SKY.md`.
//
// **This replaces a sky that is already on screen, and that is the contract that matters.**
// `setupForestLighting` installs `sky.ts`'s analytic sky synchronously, so by the time this runs
// the valley already has a background, an environment and a haze. The photograph is an *upgrade*
// in detail, not the arrival of the sky, and the three values below exist to make the swap
// invisible: the same sun direction (`SKY_ROTATION` is 0 because the world sun was placed at the
// photograph's own measured azimuth — see `light/sun.ts`), the same irradiance, and the same haze.
// Anything else and the wood visibly changes weather a minute after the player starts walking.
//
// The sun does NOT come from here. The key light, its shadow map, and the godrays stage that
// raymarches against it stay where they were: `setupForestLighting` returns it, `setupPost` takes
// it. The HDRI carries the *ambient* sky and the view; the directional sun carries the one shadow
// caster.
//
// WebGPU needs no renderer calls for any of this: `THREE.WebGPURenderer` converts an equirect
// environment map to PMREM itself the first frame it is used, and the same texture on
// `scene.background` renders through the tone curve the post chain already installed (ACES at the
// game's exposure). The `renderer` argument exists so the caller can hand `ctx.renderer` over as
// it does to `setupPost`, and so the log line can name the backend that served the frame.
import { Color, EquirectangularReflectionMapping, FogExp2, type Scene } from "three";
import { HDRLoader } from "three/addons/loaders/HDRLoader.js";
import { SKY_ROTATION } from "./light/sun.js";
import { AERIAL_COLOUR, AERIAL_DENSITY, SKY_ENVIRONMENT_INTENSITY } from "./sky.js";

/**
 * Ambient strength of the HDRI as scene lighting, and the one number that has to be *derived*
 * rather than liked.
 *
 * It is derived from `SKY_ENVIRONMENT_INTENSITY`, not chosen next to it: the two skies have to
 * deliver the same irradiance or the wood visibly changes weather a minute after the player
 * starts walking, and a second hand-tuned constant is a second thing to forget.
 *
 * The conversion is 0.629, and it is not 1 because the two skies are differently shaped. The
 * photograph's mean radiance is higher, but **half of its total energy is the sun disc** — so its
 * *diffuse* sky is dimmer than its mean suggests, while the analytic sky's disc is deliberately
 * negligible against the key light. Matching what actually lands on a surface rather than what
 * the file averages to is what this factor is.
 */
const ANALYTIC_TO_PHOTOGRAPH = 0.629;
const DEFAULT_ENVIRONMENT_INTENSITY = SKY_ENVIRONMENT_INTENSITY * ANALYTIC_TO_PHOTOGRAPH;

/** The sky renders at full strength: what the photograph shows is what you see. */
const DEFAULT_BACKGROUND_INTENSITY = 1;

export type SkyHdriOptions = {
  /** Ambient strength of the HDRI as scene lighting. Defaults to match `sky.ts` — see above. */
  readonly environmentIntensity?: number;
  /** Brightness of the HDRI as the visible background. Default 1. */
  readonly backgroundIntensity?: number;
  /**
   * Azimuth offset for both background and lighting, radians — one dial, applied to
   * `scene.backgroundRotation.y` and `scene.environmentRotation.y` together so the sky you see and
   * the light you are lit by never disagree. Defaults to `SKY_ROTATION`, which is 0: the world's
   * sun was placed at the azimuth this photograph's sun was measured at, so there is nothing to
   * correct. Turning this alone will put the visible sun somewhere the ground is not lit from.
   */
  readonly rotation?: number;
  /** `scene.backgroundBlurriness`. 0 is the photograph as taken; ~0.1 takes the edge off the pines. */
  readonly backgroundBlur?: number;
  /**
   * `false` leaves the scene fogless; an object restates the aerial perspective with different
   * values. The default keeps it exactly as `sky.ts` set it, which is the point — the haze is a
   * property of the valley's air, not of which sky texture happens to be loaded, and it is the one
   * thing in the frame that would be caught changing at the handover.
   */
  readonly fog?: false | { readonly color: number; readonly density: number };
};

/** What `ctx.renderer` (a raw `WebGPURenderer` in the harness) satisfies without importing the engine. */
export type SkyRenderer = { readonly kind?: string; readonly raw?: unknown };

/**
 * Load an equirectangular `.hdr` and install it as `scene.environment` + `scene.background`,
 * replacing the analytic sky. Resolves once the environment is live; rejects with the loader's own
 * error if the file cannot be fetched or parsed.
 */
export async function setupSkyHdri(
  scene: Scene,
  renderer: SkyRenderer,
  hdriPath: string,
  options: SkyHdriOptions = {},
): Promise<void> {
  const environmentIntensity = options.environmentIntensity ?? DEFAULT_ENVIRONMENT_INTENSITY;
  const backgroundIntensity = options.backgroundIntensity ?? DEFAULT_BACKGROUND_INTENSITY;
  const rotation = options.rotation ?? SKY_ROTATION;

  const texture = await new HDRLoader().loadAsync(hdriPath);
  texture.mapping = EquirectangularReflectionMapping;

  scene.environment = texture;
  scene.background = texture;
  scene.environmentIntensity = environmentIntensity;
  scene.backgroundIntensity = backgroundIntensity;
  scene.backgroundRotation.y = rotation;
  scene.environmentRotation.y = rotation;
  if (options.backgroundBlur !== undefined) scene.backgroundBlurriness = options.backgroundBlur;

  // Fog belongs to the sky by the same argument `sky.ts` makes: it is the horizon. `false` is an
  // explicit opt-out, not an absence — a caller that wanted no fog would not pass the option at all.
  if (options.fog === false) {
    scene.fog = null;
  } else {
    const fog = options.fog ?? { color: AERIAL_COLOUR, density: AERIAL_DENSITY };
    scene.fog = new FogExp2(new Color(fog.color), fog.density);
  }

  const image = texture.image as { width: number; height: number };
  console.info(
    `TN_SKY_HDRI:${JSON.stringify({
      backend: renderer.kind ?? "unknown",
      backgroundIntensity,
      environmentIntensity,
      path: hdriPath,
      resolution: [image.width, image.height],
      rotation,
    })}`,
  );
}
