import { UiLayer } from "@threenative/ui";
import { createRoot } from "react-dom/client";
import { NativeHud } from "./NativeHud.js";

/**
 * The UI entry the native web view loads.
 *
 * It mounts the HUD and nothing else — no scene, no simulation, no renderer. The game runs beside
 * it in the native runtime and reaches it only through published state, which is why this file
 * imports no game code but the state's type.
 *
 * `<UiLayer>` is not optional: `useUiState` reads its context and throws `TN_UI_LAYER_MISSING`
 * without it, so rendering the HUD bare left the attached web view completely blank.
 */
const root = document.getElementById("tn-ui");
if (root === null) throw new Error("Missing #tn-ui element.");
createRoot(root).render(
  <UiLayer>
    <NativeHud />
  </UiLayer>,
);
