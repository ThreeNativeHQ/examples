import { defineGame, replay } from "@threenative/core";
import { playtest } from "@threenative/core/playtest";
import type { IPhysicsContext } from "@threenative/physics";
import { rapier } from "@threenative/physics";
import { WebGPURenderer } from "three/webgpu";
import config from "../threenative.config.js";
import { Valley } from "./scenes/Valley.js";
import type { GameState } from "./state.js";

// game.state is the single store: the fixed-step loop writes it, and React/playtests read it.
const game = defineGame<GameState, IPhysicsContext>({
  input: {
    // The four directions of `input.vector("move")`. Declared rather than inherited from the
    // default binding, so the axis every scene reads is visible where the game is defined.
    move: {
      down: ["ArrowDown", "KeyS"],
      left: ["ArrowLeft", "KeyA"],
      right: ["ArrowRight", "KeyD"],
      up: ["ArrowUp", "KeyW"],
    },
    /** Look is relative on every target: a locked pointer on web, a stick or a drag elsewhere. */
    look: { pointerRelative: true },
    inspect: { keys: ["KeyE"] },
    jump: { keys: ["Space"] },
    sprint: { keys: ["ShiftLeft", "ShiftRight"] },
    restart: { keys: ["KeyR"] },
  },
  plugins: [rapier(), replay(), playtest()],
  display: config.display,
  render: config.renderer,
  renderer: {
    /**
     * The fallback for a browser without WebGPU — and the reason this game renders at all there.
     *
     * Every material in `src/render/` is a TSL node material: the ground's four-layer blend, the
     * wind in the foliage, the lake's ripples. Node materials are built by `WebGPURenderer`, and
     * the engine's own fallback is the **classic** `WebGLRenderer`, which has no idea what a node
     * material is. It does not warn — it throws deep inside shader assembly:
     *
     *     TypeError: Cannot read properties of undefined (reading 'replace')
     *       at resolveIncludes -> new WebGLProgram -> WebGLRenderer.render
     *
     * and the page goes white. Chrome on Linux still keeps WebGPU behind a flag on many builds, so
     * this is the common case for anyone opening the game, not an exotic one.
     *
     * `WebGPURenderer({ forceWebGL: true })` is the same renderer over a WebGL2 backend: the node
     * graphs compile to GLSL instead of WGSL and everything draws. Slower, and some post stages
     * decline themselves — `TN_WORLD_ENVIRONMENT` reports which — but it is the game rather than a
     * blank page.
     */
    webgl2Factory: (canvas, options) =>
      new WebGPURenderer({ canvas, forceWebGL: true, ...options }),
  },
  scenes: { valley: Valley },
  seed: 90210,
  start: "valley",
});

export default game;

/**
 * What the UI can ask the game to do.
 *
 * Intents are one-way and named by the game: the UI sends `restart`, `pause` or `resume` and the
 * game decides what each means. Nothing comes back this way — the UI reads the game's published
 * state instead, which keeps one source of truth on the side that owns the simulation.
 */
game.ui.onIntent((intent) => {
  if (intent === "restart") void game.goto("valley");
  if (intent === "pause") game.pause();
  if (intent === "resume") game.resume();
  game.state.set({
    // `game.ui.connected` is true only once the UI announced itself, which is what tells an
    // overlay that never came up apart from a HUD that is simply empty.
    uiReady: game.ui.connected,
    ...(intent === "pause" || intent === "resume" ? { paused: intent === "pause" } : {}),
  });
  game.state.flush();
});
