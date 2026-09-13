import { defineGame } from "@threenative/core";
import { playtest } from "@threenative/core/playtest";
import config from "../threenative.config.js";
import { ACTION_BINDINGS, Midway, type GameState } from "./scenes/Midway.js";

const game = defineGame<GameState>({
  camera: { projection: "perspective", fov: 57, near: 0.6, far: 95000 },
  display: config.display,
  input: ACTION_BINDINGS,
  plugins: [playtest()],
  render: config.renderer,
  scenes: { midway: Midway },
  start: "midway",
  step: 1 / 60,
});

export default game;
