import { acceptHotUpdate } from "@threenative/core/hot";
import { EXPERIMENTS } from "./experiments.js";
import game from "./game.js";
import "./style.css";

const app = document.querySelector<HTMLElement>("#app");
const hudElement = document.querySelector<HTMLElement>("#hud");
if (app === null || hudElement === null) throw new Error("Missing #app or #hud element.");
const hud: HTMLElement = hudElement;

const QUALITY_NAMES = ["light", "balanced", "high"];
const row = (label: string, value: string): string =>
  `<div><span>${label}</span><b>${value}</b></div>`;

// The HUD is a plain DOM readout of the published state: four solver metrics and the keys,
// repainted ten times a second so the DOM never competes with the frame.
function paint(): void {
  const state = game.state.getPublishedState();
  const experiment = EXPERIMENTS[state.experiment - 1];
  hud.innerHTML = [
    `<h1>${state.experiment}. ${experiment?.name ?? ""}</h1>`,
    row("particles", state.particles > 0 ? String(state.particles) : state.waveEnergy > 0 ? "waves" : "-"),
    row("compression", state.particles > 0 ? state.compression.toFixed(3) : "-"),
    row("max speed", state.particles > 0 ? `${state.maxSpeed.toFixed(1)} m/s` : "-"),
    row("fps", String(state.fps)),
    `<p>1-8 experiment · Space ${experiment?.action.toLowerCase() ?? ""} · V mode · Q quality (${QUALITY_NAMES[state.quality]})</p>`,
  ].join("");
}

import.meta.hot?.accept();
acceptHotUpdate(game, import.meta.hot);
void game
  .start()
  .then(() => {
    const canvas = game.ctx?.renderer.domElement;
    if (canvas !== undefined) app.prepend(canvas);
    paint();
    setInterval(paint, 100);
  })
  .catch((error: unknown) => {
    const failure = document.createElement("div");
    failure.id = "threenative-canvas-error";
    failure.dataset.threenativeCanvasError = "true";
    failure.setAttribute("role", "alert");
    failure.textContent = error instanceof Error ? error.message : String(error);
    app.replaceChildren(failure);
  });
