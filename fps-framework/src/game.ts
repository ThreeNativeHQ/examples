import { defineGame, replay } from "@threenative/core";
import { playtest } from "@threenative/core/playtest";
import type { IPhysicsContext } from "@threenative/physics";
import { rapier } from "@threenative/physics";
import config from "../threenative.config.js";
import { Play } from "./scenes/Play.js";
import type { GameState } from "./state.js";

// game.state is the single store: the fixed-step loop writes it, and React/playtests read it.
const game = defineGame<GameState, IPhysicsContext>({
  input: {
    // The four directions of `input.vector("move")`.
    move: {
      down: ["ArrowDown", "KeyS"],
      left: ["ArrowLeft", "KeyA"],
      right: ["ArrowRight", "KeyD"],
      up: ["ArrowUp", "KeyW"],
    },
    // The sealed proof drives the keyboard only: Space fires, KeyR reloads, Enter retries.
    fire: { keys: ["Space"], mouseButtons: [0] },
    reload: { keys: ["KeyR"] },
    sprint: { keys: ["ShiftLeft", "ShiftRight"] },
    aim: { keys: ["KeyF", "ControlLeft"], mouseButtons: [2] },
    restart: { keys: ["Enter", "NumpadEnter"] },
  },
  plugins: [rapier(), replay(), playtest()],
  render: config.renderer,
  scenes: { play: Play },
  seed: 90210,
  start: "play",
});

export default game;
