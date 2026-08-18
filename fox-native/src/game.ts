import { defineGame } from "@threenative/core";
import { playtest } from "@threenative/core/playtest";
import { Play } from "./scenes/Play.js";
import type { GameState } from "./state.js";

const game = defineGame<GameState, undefined>({
  camera: { far: 900, fov: 52, near: 0.1, projection: "perspective" },
  input: {
    dash: { buttons: [6, 7], down: ["ShiftLeft", "ShiftRight"] },
    jump: { buttons: [0], down: ["Space"] },
    move: {
      down: ["KeyS", "ArrowDown"],
      left: ["KeyA", "ArrowLeft"],
      right: ["KeyD", "ArrowRight"],
      up: ["KeyW", "ArrowUp"],
    },
  },
  plugins: [playtest()],
  renderer: { resolutionScale: 1 },
  scenes: { play: Play },
  seed: 90210,
  start: "play",
});

export default game;
