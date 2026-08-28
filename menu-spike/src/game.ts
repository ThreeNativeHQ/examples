import { defineGame, replay } from "@threenative/core";
import { playtest } from "@threenative/core/playtest";
import type { IPhysicsContext } from "@threenative/physics";
import { rapier } from "@threenative/physics";
import config from "../threenative.config.js";
import { MainMenu } from "./scenes/MainMenu.js";
import { Play } from "./scenes/Play.js";
import type { GameState } from "./state.js";

// game.state is the single store: the fixed-step loop writes it, and React/playtests read it.
const game = defineGame<GameState, IPhysicsContext>({
  input: {
    move: {
      down: ["ArrowDown", "KeyS"],
      left: ["ArrowLeft", "KeyA"],
      right: ["ArrowRight", "KeyD"],
      up: ["ArrowUp", "KeyW"],
    },
    jump: { buttons: [0], keys: ["Space"] },
    restart: { keys: ["KeyR"] },
  },
  plugins: [rapier(), replay(), playtest()],
  render: config.renderer,
  scenes: { menu: MainMenu, play: Play },
  seed: 90210,
  start: "menu",
});

export default game;

/**
 * What the UI can ask the game to do.
 *
 * Intents are one-way and named by the game: the UI sends and the game decides what each
 * means. The payload is `unknown` on purpose — the game validates before it trusts it.
 */
game.ui.onIntent((intent, payload) => {
  if (intent === "start-game") {
    const name =
      typeof payload === "object" && payload !== null && typeof (payload as { name?: unknown }).name === "string"
        ? (payload as { name: string }).name.trim().slice(0, 24)
        : "";
    // A fresh run: the scene owns its initial numbers, the chosen name survives the switch.
    game.state.set({ ...MainMenu.initialState, screen: "playing", characterName: name });
    game.state.flush();
    void game.goto("play");
  }
  if (intent === "back-to-menu") void game.goto("menu");
  if (intent === "restart") void game.goto("play");
  if (intent === "pause") game.pause();
  if (intent === "resume") game.resume();
  game.state.set({
    uiReady: game.ui.connected,
    ...(intent === "pause" || intent === "resume" ? { paused: intent === "pause" } : {}),
  });
  game.state.flush();
});
