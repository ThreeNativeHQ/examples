import { defineGame, replay } from "@threenative/core";
import { playtest } from "@threenative/core/playtest";
import config from "../threenative.config.js";
import { Lab } from "./scenes/Lab.js";
import type { GameState } from "./state.js";

/**
 * The lab itself: one scene, no locomotion, no physics.
 *
 * `src/game.ts` is portable — it names the scene, the plugins and the intents, and nothing about
 * a face. React mounts from `src/main.ts` and the UI lives in `src/ui/`.
 */
const game = defineGame<GameState>({
  input: {
    // A keyboard route onto the panel, so the sliders are operable without a pointer.
    reset: { keys: ["KeyR"] },
    // The camera. Both relative bindings share the same mouse motion and are told apart by their
    // button, so a left drag turns the face and a right drag — or shift and a left drag — slides it.
    // `captureOnClick: false` is the important half: the default grabs pointer capture on the first
    // click, which would swallow every click on the expression panel and lock the cursor to the
    // window centre. Without capture the relative motion is still reported, and a drag that starts
    // over the panel never reaches the canvas at all.
    orbit: { pointerRelative: true, captureOnClick: false, mouseButtons: [0] },
    pan: { pointerRelative: true, captureOnClick: false, mouseButtons: [2] },
    zoom: { scroll: true, pinch: true },
    frame: { keys: ["KeyF"] },
  },
  plugins: [replay(), playtest()],
  display: config.display,
  // No `webgpuFactory` here: the engine requests the adapter's own `maxTextureArrayLayers`
  // itself, which is what a head carrying 821 morph targets needs to be drawn at all.
  renderer: {
    preferWebGPU: config.renderer?.preferWebGPU,
    resolutionScale: config.renderer?.resolutionScale as number | undefined,
    antialias: config.renderer?.antialias,
    alphaAntialiasing: config.renderer?.alphaAntialiasing,
  },
  scenes: { lab: Lab },
  seed: 1,
  start: "lab",
});

export default game;

/**
 * What the UI can ask the lab to do.
 *
 * Intents are one-way and named by the game; the UI reads published state instead of getting an
 * answer back, which keeps one source of truth on the side that owns the rig. Control traffic is
 * the one exception to "coalesce": each event lands on the scene's pending map and reaches the
 * rig as a single `setControls` on the next rendered frame.
 */
game.ui.onIntent((intent, payload) => {
  const lab = game.scene instanceof Lab ? game.scene : undefined;
  if (lab === undefined) return;
  const value = payload as { alias?: string; value?: number; group?: string; recipe?: string } | null;
  try {
    if (intent === "control" && value?.alias !== undefined) lab.setControl(value.alias, value.value ?? 0);
    if (intent === "link" && value?.group !== undefined) lab.setLinked(value.group, value.value === 1);
    if (intent === "reset") lab.resetControls();
    if (intent === "recipe" && value?.recipe !== undefined) lab.applyRecipe(value.recipe);
    if (intent === "frame") lab.frameFace();
  } catch (error) {
    // A control the specimen does not declare is the UI's bug, not a crash: say so in the state
    // the diagnostics panel already renders.
    game.state.set({ message: String(error instanceof Error ? error.message : error) });
  }
  game.state.flush();
});
