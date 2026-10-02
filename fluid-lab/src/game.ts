import { defineGame } from "@threenative/core";
import { playtest } from "@threenative/core/playtest";
import type { IPhysicsContext } from "@threenative/physics";
import { rapier } from "@threenative/physics";
import config from "../threenative.config.js";
import { Lab } from "./scenes/Lab.js";
import type { GameState } from "./state.js";

const game = defineGame<GameState, IPhysicsContext>({
  input: {
    act: { keys: ["Space"] },
    exp1: { keys: ["Digit1"] },
    exp2: { keys: ["Digit2"] },
    exp3: { keys: ["Digit3"] },
    exp4: { keys: ["Digit4"] },
    exp5: { keys: ["Digit5"] },
    exp6: { keys: ["Digit6"] },
    exp7: { keys: ["Digit7"] },
    exp8: { keys: ["Digit8"] },
    quality: { keys: ["KeyQ"] },
    toggle: { keys: ["KeyV"] },
  },
  plugins: [rapier({ gravity: { x: 0, y: -9.81, z: 0 } }), playtest()],
  display: config.display,
  render: config.renderer,
  scenes: { lab: Lab },
  start: "lab",
});

export default game;
