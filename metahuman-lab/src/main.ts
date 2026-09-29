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

/**
 * Which face each vantage wears: a preset, and any direct channels on top of it.
 *
 * Anything unlisted is the declared neutral. `brow-raise` is the reason the second half exists —
 * it is a brow shot, and none of the five recipes is brows alone.
 */
const POSE_FOR: Readonly<Record<string, readonly [string, Readonly<Record<string, number>>]>> = {
  expression: ["surprise", {}],
  "expression-3q": ["surprise", {}],
  smile: ["smile", {}],
  "brow-raise": [
    "neutral",
    { browRaiseInnerL: 0.7, browRaiseInnerR: 0.7, browRaiseOuterL: 0.5, browRaiseOuterR: 0.5 },
  ],
  /** The mouth interior only exists when there is an opening to see it through. */
  mouth: ["neutral", { jawOpen: 0.6 }],
  "mouth-front": ["neutral", { jawOpen: 0.6 }],
  /** A smile is the pose the cheek close-up is for; a neutral cheek has no fold to look at. */
  "smile-cheek": ["smile", {}],
  neck: ["neutral", {}],
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
  const [preset, channels] = POSE_FOR[vantage] ?? ["neutral", {}];
  // From the declared neutral, every time: a recipe is a partial overlay on the base vector, so a
  // capture that inherited the previous capture's base would photograph a face nobody posed.
  scene.resetControls();
  scene.setPreset(preset);
  for (const [alias, value] of Object.entries(channels)) scene.setControl(alias, value);
  scene.look(vantage as VantageName);
}

// `configurable`, because a hot update re-runs this module: a second non-configurable define throws
// "Cannot redefine property" and vite reports the whole update as failed.
Object.defineProperty(globalThis, "__LOOK_VANTAGES__", {
  configurable: true,
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
