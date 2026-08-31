import { defineGame } from "@threenative/core";
import { playtest } from "@threenative/core/playtest";
import config from "../threenative.config.js";
import { Quarry } from "./scenes/Quarry.js";
import type { GameState } from "./state.js";

const game = defineGame<GameState>({
  plugins: [playtest()],
  display: config.display,
  render: config.renderer,
  scenes: { quarry: Quarry },
  seed: 1,
  start: "quarry",
});

export default game;
