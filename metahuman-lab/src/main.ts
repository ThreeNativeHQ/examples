import { acceptHotUpdate } from "@threenative/core/hot";
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import game from "./game.js";
import { Lab } from "./scenes/Lab.js";
import type { VantageName } from "./render/stage.js";
import { VANTAGES } from "./render/stage.js";
import { App } from "./ui/App.js";
import "./style.css";

import.meta.hot?.accept();
acceptHotUpdate(game, import.meta.hot);
const root = document.getElementById("root");
if (root === null) throw new Error("Missing #root element.");
const appRoot = root as typeof root & { __threenativeRoot?: ReturnType<typeof createRoot> };
const reactRoot = appRoot.__threenativeRoot ?? createRoot(appRoot);
appRoot.__threenativeRoot = reactRoot;
reactRoot.render(createElement(App, { game }));

/** Which face each vantage wears. Anything unlisted is the declared neutral. */
const RECIPE_FOR: Readonly<Record<string, string>> = {
  expression: "expression",
  "expression-3q": "expression",
  "brow-raise": "brow",
  smile: "smile",
};

/**
 * The capture hook `tools/look.mjs` looks for, by convention: a name it calls on the loaded page
 * before the shot, and which is also the file name it writes. So the vantage is the tail of the
 * name and the `round-<n>-` prefix is dropped here — which is what lets `round-3-front` and
 * `round-4-front` be the same three poses without either being registered by hand.
 *
 * A pose is the whole state of the shot, so `expression` also puts a face on: a capture of a
 * neutral named `expression` would be a lie in the file name.
 */
function pose(name: string): void {
  const scene = game.scene instanceof Lab ? game.scene : undefined;
  const vantage = name.replace(/^round-\d+-/, "");
  if (scene === undefined || !(vantage in VANTAGES)) return;
  // A pose is the whole state of the shot, face included: a capture named after a pose that shows a
  // neutral is a lie in the file name, and the brow shot is the only proof the brow strands ride the skin.
  scene.applyRecipe(RECIPE_FOR[vantage] ?? "neutral");
  scene.look(vantage as VantageName);
}

Object.defineProperty(globalThis, "__LOOK_VANTAGES__", {
  value: new Proxy(
    {},
    {
      get: (_target, name: string) => {
        // `strands-<n>` is the strand-count LOD, so a capture can A/B the groom's cost.
        const strands = /^strands-(\d+)$/.exec(name);
        if (strands !== null)
          return () => (game.scene instanceof Lab ? game.scene.setStrandCount(Number(strands[1])) : undefined);
        return name.replace(/^round-\d+-/, "") in VANTAGES ? () => pose(name) : undefined;
      },
    },
  ),
});
