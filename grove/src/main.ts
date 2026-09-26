import { acceptHotUpdate } from "@threenative/core/hot";
import game from "./game.js";
import "./style.css";

const app = document.querySelector<HTMLElement>("#app");
if (app === null) throw new Error("Missing #app element.");

// No DOM readout here, and no in-scene HUD either: this game is a grove to look at, and a score
// chip over it only ever covered a tree. The scene's own numbers are readable in the playtest
// bridge, which is where an automated check should read them from anyway.

import.meta.hot?.accept();
acceptHotUpdate(game, import.meta.hot);
void game
  .start()
  .then(() => {
    const canvas = game.ctx?.renderer.domElement;
    if (canvas !== undefined) app.prepend(canvas);
  })
  .catch((error: unknown) => {
    const failure = document.createElement("div");
    failure.id = "threenative-canvas-error";
    failure.dataset.threenativeCanvasError = "true";
    failure.setAttribute("role", "alert");
    failure.textContent = error instanceof Error ? error.message : String(error);
    app.replaceChildren(failure);
  });
