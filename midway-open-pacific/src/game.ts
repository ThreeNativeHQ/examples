import { defineGame } from "@threenative/core";
import { playtest } from "@threenative/core/playtest";
import config from "../threenative.config.js";
import { Midway, type GameState } from "./scenes/Midway.js";

const container = typeof document !== "undefined" && typeof document.getElementById === "function" ? document.getElementById("world") ?? undefined : undefined;

const game = defineGame<GameState>({
  camera: { projection: "perspective", fov: 57, near: 0.6, far: 95000 },
  container,
  display: config.display,
  plugins: [playtest()],
  render: config.renderer,
  scenes: { midway: Midway },
  start: "midway",
  step: 1 / 60,
});

export default game;
