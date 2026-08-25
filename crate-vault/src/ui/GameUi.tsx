import { UiLayer } from "@threenative/ui";
import { Hud } from "./Hud.js";
import { Menu } from "./Menu.js";

/**
 * Everything the player sees that is not the rendered frame.
 *
 * `UiLayer` opens the bridge, mirrors published state and publishes the rectangles of every
 * `data-tn-interactive` element, so the host knows which presses belong to the UI and which fall
 * through to the game. Nothing below it holds a reference to the game: on native this tree runs in
 * the platform's web view and reaches the game only through state and intents.
 */
export function GameUi() {
  return (
    <UiLayer>
      <Hud />
      <Menu />
    </UiLayer>
  );
}
