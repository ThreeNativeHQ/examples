import { defineGame } from "@threenative/core";
import { playtest } from "@threenative/core/playtest";
import config from "../threenative.config.js";
import { ACTION_BINDINGS, Midway, type GameState } from "./scenes/Midway.js";

const game = defineGame<GameState>({
  camera: { projection: "perspective", fov: 57, near: 0.6, far: 95000 },
  display: config.display,
  plugins: [playtest()],
  render: config.renderer,
  input: { ...ACTION_BINDINGS, aim: { pointerRelative: true, captureOnClick: false } },
  scenes: { midway: Midway },
  start: "midway",
  step: 1 / 60,
});

/**
 * Prove the UI layer is really up, not merely that a state snapshot crossed the channel.
 *
 * On native the web view attaches, subscribes and stays blank until the page announces itself with
 * an intent; `ui.connected` is false until then. So the announcement is what sets `uiReady`, and a
 * scenario can assert it. Mirrors the starter template's handling, minus the game intents Midway's
 * HUD does not send yet.
 */
game.ui.onIntent(() => {
  game.state.set({ uiReady: game.ui.connected });
  game.state.flush();
});

export default game;
