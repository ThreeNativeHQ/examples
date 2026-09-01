// A Poly Haven HDRI standing in for the procedural gradient dome in `sky.ts` — the same job
// (background + the light the wood is lit by) done with a photograph of the real thing.
//
// The asset is `assets/hdri/forest_slope_2k.hdr`: Poly Haven's "Forest Slope", a coniferous
// forest in soft morning summer light, low contrast, dappled sun through tall pines. CC0, credited
// in `CREDITS-SKY.md`.
//
// The contract with `Valley.enter` is the one `setupSky` had:
//   - call it once instead of `setupSky(ctx.scene)`. It returns a promise (the .hdr loads over the
//     network); in sync `enter()` call it fire-and-forget — the loading screen covers the frames
//     before the environment lands, but catch the rejection so a 404 names itself.
//   - the sun does NOT come from here. The key light, its shadow map, and the godrays stage that
//     raymarches against it stay where they were: `setupForestLighting` returns it, `setupPost`
//     takes it. The HDRI carries the *ambient* sky and the view; the directional sun carries the
//     one shadow caster. Aligning the HDRI's photographed sun with that light is the `rotation`
//     option, turned by hand until the sky's bright patch sits where `key.position` points.
//
// WebGPU needs no renderer calls for any of this: `THREE.WebGPURenderer` converts an equirect
// environment map to PMREM itself the first frame it is used, and the same texture on
// `scene.background` renders through the tone curve the post chain already installed (ACES at the
// game's exposure). The `renderer` argument exists so the caller can hand `ctx.renderer` over as
// it does to `setupPost`, and so the log line can name the backend that served the frame.
import { EquirectangularReflectionMapping, Fog, type Scene } from "three";
import { HDRLoader } from "three/addons/loaders/HDRLoader.js";
import { palette } from "./palette.js";

/**
 * An HDRI at full strength is a sun in a box: the photographed sky is thousands of times brighter
 * than the scene it lights, and under ACES at exposure ~1.24 it blows the frame out. 0.5 is a
 * conservative starting point — raise it until the ambient matches, watching the shadow floor.
 */
const DEFAULT_ENVIRONMENT_INTENSITY = 0.5;

/** The sky renders at full strength: what the photograph shows is what you see. */
const DEFAULT_BACKGROUND_INTENSITY = 1;

export type SkyHdriOptions = {
  /** Ambient strength of the HDRI as scene lighting. Default 0.5 — see the note above. */
  readonly environmentIntensity?: number;
  /** Brightness of the HDRI as the visible background. Default 1. */
  readonly backgroundIntensity?: number;
  /**
   * Azimuth offset for both background and lighting, radians — one dial, applied to
   * `scene.backgroundRotation.y` and `scene.environmentRotation.y` together so the sky you see and
   * the light you are lit by never disagree. Default 0 (the photograph's own orientation).
   */
  readonly rotation?: number;
  /** `scene.backgroundBlurriness`. 0 is the photograph as taken; ~0.1 takes the edge off the pines. */
  readonly backgroundBlur?: number;
  /**
   * `false` leaves the scene fogless; an object restates `setupSky`'s fog with different values.
   * The default keeps the fog exactly as the procedural sky had it — a wood is thousands of
   * near-identical green objects, and without depth cueing the far trees and the near trees are
   * the same colour. Note for whoever tunes the look: the fog colour is still `palette.fog`, the
   * haze the gradient dome was painted with; against a photographic horizon the ridge now fades to
   * a colour the sky behind it does not share, and `palette.fog` is the thing to retune first.
   */
  readonly fog?: false | { readonly color: number; readonly near: number; readonly far: number };
};

/** What `ctx.renderer` (a raw `WebGPURenderer` in the harness) satisfies without importing the engine. */
export type SkyRenderer = { readonly kind?: string; readonly raw?: unknown };

/**
 * Load an equirectangular `.hdr` and install it as `scene.environment` + `scene.background`,
 * replacing everything `setupSky` drew. Resolves once the environment is live; rejects with the
 * loader's own error if the file cannot be fetched or parsed.
 */
export async function setupSkyHdri(
  scene: Scene,
  renderer: SkyRenderer,
  hdriPath: string,
  options: SkyHdriOptions = {},
): Promise<void> {
  const environmentIntensity = options.environmentIntensity ?? DEFAULT_ENVIRONMENT_INTENSITY;
  const backgroundIntensity = options.backgroundIntensity ?? DEFAULT_BACKGROUND_INTENSITY;

  const texture = await new HDRLoader().loadAsync(hdriPath);
  texture.mapping = EquirectangularReflectionMapping;

  scene.environment = texture;
  scene.background = texture;
  scene.environmentIntensity = environmentIntensity;
  scene.backgroundIntensity = backgroundIntensity;
  if (options.rotation !== undefined) {
    scene.backgroundRotation.y = options.rotation;
    scene.environmentRotation.y = options.rotation;
  }
  if (options.backgroundBlur !== undefined) scene.backgroundBlurriness = options.backgroundBlur;

  // Fog belongs to the sky by the same argument `sky.ts` makes: it is the horizon. `false` is an
  // explicit opt-out, not an absence — a caller that wanted no fog would not pass the option at all.
  if (options.fog === false) {
    scene.fog = null;
  } else {
    const fog = options.fog ?? { color: palette.fog, near: 110, far: 400 };
    scene.fog = new Fog(fog.color, fog.near, fog.far);
  }

  const image = texture.image as { width: number; height: number };
  console.info(
    `TN_SKY_HDRI:${JSON.stringify({
      backend: renderer.kind ?? "unknown",
      backgroundIntensity,
      environmentIntensity,
      path: hdriPath,
      resolution: [image.width, image.height],
      rotation: options.rotation ?? 0,
    })}`,
  );
}
