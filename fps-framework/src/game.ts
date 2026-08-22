import { defineGame, replay, type ICtx, type IGamePluginRuntime } from "@threenative/core";
import { playtest } from "@threenative/core/playtest";
import type { IPhysicsContext } from "@threenative/physics";
import { rapier } from "@threenative/physics";
import { Object3D } from "three";
import config from "../threenative.config.js";
import { Play } from "./scenes/Play.js";
import type { GameState } from "./state.js";

type GameCtx = ICtx<GameState, IPhysicsContext>;

// Entity-derived component keys do not exist until Play.enter() finishes. Advertising the
// already-provided runtime observation here keeps the runner from rejecting a component scenario
// during the asset-loading window; the actual values still come from ctx.entities.snapshot().
const componentObservationCapability = {
  setup(_ctx: GameCtx, runtime?: IGamePluginRuntime) {
    return runtime?.observations.contribute({
      capabilities: ["runtime.components"],
      sample: () => ({}),
    });
  },
};

const scenarioSetupPlaceholders = {
  setup(ctx: GameCtx) {
    // Scenario setup is delivered before the async scene load finishes. These non-rendered
    // objects give the bridge a stable transform target; Play.enter() transfers the values to
    // the real entities and removes the placeholders before the first sample.
    // "enemy-frozen" is optional per scenario: placing it turns soldier 0 into a sentry at
    // that spot instead of a patroller (see Play.enter). It parks off-map so "the scenario
    // never placed him" stays distinguishable from "the scenario placed him at the origin".
    for (const id of ["player", "enemy", "enemy-frozen"] as const) {
      if (ctx.entities.get(id) !== undefined) continue;
      const placeholder = new Object3D();
      if (id === "enemy-frozen") placeholder.position.set(0, -1000, 0);
      ctx.entities.add(id, placeholder);
    }
    return undefined;
  },
};

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
    // Mouse look, as a relative axis. The framework owns the pointer lock and the
    // per-tick delta, so nothing in this game reads `movementX` or the DOM.
    look: { pointerRelative: true },
    // Playtests drive the keyboard: Space fires, KeyR reloads, Enter retries.
    fire: { keys: ["Space"], mouseButtons: [0] },
    reload: { keys: ["KeyR"] },
    sprint: { keys: ["ShiftLeft", "ShiftRight"] },
    aim: { keys: ["KeyF", "ControlLeft"], mouseButtons: [2] },
    restart: { keys: ["Enter", "NumpadEnter"] },
  },
  plugins: [rapier(), replay(), scenarioSetupPlaceholders, componentObservationCapability, playtest()],
  render: config.renderer,
  renderer: { antialias: false },
  scenes: { play: Play },
  seed: 90210,
  start: "play",
});

export default game;
