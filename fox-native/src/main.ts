import { acceptHotUpdate } from "@threenative/core/hot";
import game from "./game.js";
import "./style.css";

// Web entry only. The HUD and the touch controls are Three.js objects built in
// src/render/hud.ts, so the same source draws them on desktop and Android, where `document`
// is only a compatibility stub and nothing appended to it would ever render.
const app = document.querySelector<HTMLElement>("#app");
if (app === null) throw new Error("Missing #app element.");

import.meta.hot?.accept();
acceptHotUpdate(game, import.meta.hot);
void game.start().then(() => {
  const canvas = game.ctx?.renderer.domElement;
  if (canvas !== undefined) app.prepend(canvas);
  (globalThis as { __FOX__?: unknown }).__FOX__ = game;
});
