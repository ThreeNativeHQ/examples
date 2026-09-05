import { defineGame } from "@threenative/core";
import { playtest } from "@threenative/core/playtest";
import { type IPhysicsContext, rapier } from "@threenative/physics";
import config from "../threenative.config.js";
import { Play } from "./scenes/Play.js";
import type { GameState } from "./state.js";

const game = defineGame<GameState, IPhysicsContext>({
  input: {
    move: { up: ["KeyW", "ArrowUp"], down: ["KeyS", "ArrowDown"], left: ["KeyA"], right: ["KeyD"] },
    turnLeft: { keys: ["ArrowLeft", "KeyQ"] },
    turnRight: { keys: ["ArrowRight", "KeyE"] },
    jump: { keys: ["Space"] },
    restart: { keys: ["KeyR"] },
  },
  plugins: [rapier(), playtest()],
  display: config.display,
  render: config.renderer,
  scenes: { play: Play },
  seed: 349,
  start: "play",
});

export default game;
