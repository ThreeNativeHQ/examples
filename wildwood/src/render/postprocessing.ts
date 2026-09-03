// Generated for you: ordinary Three.js; ThreeNative does not read this file.
//
// This file wires two things together and decides nothing itself. `quality.ts`, in this folder,
// owns which stages run at which tier and records what each one measured. `WorldEnvironment`,
// also in this folder, builds them and prints `TN_WORLD_ENVIRONMENT` naming every stage as
// applied or refused **with a reason**, so a stage that silently no-op'd is never mistaken for
// one you turned off.
//
// To make the game cheaper or prettier everywhere, edit `quality.ts`. To force one tier for one
// run — a desktop that is dropping frames, a capture you want to compare — pass it:
// `setupPost(renderer, scene, camera, { tier: "low" })`. Overriding does not silence the report:
// `TN_QUALITY_TIER` names the tier that ran either way.
//
// The one thing this file does decide is *when* the chain is installed, and it is not
// immediately — see `waitForShadowMap` below.
import type { Camera, DirectionalLight, Scene } from "three";
import { type QualityTier, qualityPreset, resolveQualityTier } from "./quality.js";
import type { OutputRenderer } from "./worldEnvironment.js";
import { WorldEnvironment } from "./worldEnvironment.js";

/**
 * How many frames to wait for the sun's shadow map before installing the chain anyway.
 *
 * Two frames would do on a machine that is keeping up; 240 is a couple of seconds of a bad one,
 * and it is spent behind the loading curtain either way. Running out is not an error — the chain
 * goes in without godrays and `TN_WORLD_ENVIRONMENT` says why, which is the whole point of that
 * line.
 */
const SHADOW_MAP_FRAME_BUDGET = 240;

/** A frame tick that works in a browser and on the native host, which has no `requestAnimationFrame`. */
function nextFrame(callback: () => void): void {
  const raf = (globalThis as { requestAnimationFrame?: (cb: () => void) => unknown })
    .requestAnimationFrame;
  if (typeof raf === "function") raf(callback);
  else setTimeout(callback, 16);
}

/**
 * Installs the chain once the sun has a shadow map, or gives up waiting and installs it without.
 *
 * **Why this is deferred at all.** Godrays are raymarched against the sun's shadow map, and
 * `GodraysNode` reads `light.shadow.map.depthTexture` while the TSL graph is being *built*.
 * `castShadow = true` is a request, not a result: three allocates that map on the first render
 * that needs it. `setupPost` is called from `Valley.enter()`, before a single frame has been
 * drawn, so at that moment the map does not exist and `WorldEnvironment` — correctly, and by
 * name — refuses the stage with "has no shadow map yet". The scene then reports godrays as
 * unavailable forever, on a build where nothing is actually wrong.
 *
 * So: wait for the map, then build. The wait is frames, not milliseconds, because what has to
 * happen is a render and not a duration.
 */
function applyWhenReady(
  world: WorldEnvironment,
  renderer: OutputRenderer,
  scene: Scene,
  camera: Camera,
  sun: DirectionalLight,
): void {
  let frames = 0;
  const attempt = (): void => {
    frames += 1;
    const ready = sun.shadow.map != null;
    if (ready || frames >= SHADOW_MAP_FRAME_BUDGET) {
      console.info(`TN_POST_DEFERRED frames=${String(frames)} shadowMap=${String(ready)}`);
      world.apply(renderer, scene, camera, { godraysLight: sun });
      return;
    }
    nextFrame(attempt);
  };
  nextFrame(attempt);
}

export function setupPost(
  renderer: OutputRenderer,
  scene: Scene,
  camera: Camera,
  environment: {
    godraysLight?: DirectionalLight;
    mobile?: boolean;
    /** Forces a tier, ignoring `mobile`. An unknown name throws rather than falling back. */
    tier?: QualityTier;
  } = {},
): void {
  const tier = resolveQualityTier({ mobile: environment.mobile, tier: environment.tier });
  const source = environment.tier === undefined ? "platform" : "override";
  console.info(`TN_QUALITY_TIER ${tier} mobile=${environment.mobile === true} source=${source}`);
  const preset = qualityPreset(tier);
  const world = new WorldEnvironment(preset);

  const sun = environment.godraysLight;
  // Only godrays need the shadow map, so only godrays pay for the wait. Every other tier
  // installs its chain in this call, exactly as before.
  if (preset.godraysEnabled === true && sun !== undefined) {
    applyWhenReady(world, renderer, scene, camera, sun);
    return;
  }
  world.apply(renderer, scene, camera, { godraysLight: sun });
}
