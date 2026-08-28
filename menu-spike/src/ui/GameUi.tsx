import { UiLayer } from "@threenative/ui";
import { Hud } from "./Hud.js";
import { MainMenuUi } from "./MainMenuUi.js";
import { Menu } from "./Menu.js";

/**
 * Everything the player sees that is not the scene.
 *
 * Which chrome is up follows the game's published `screen` value, so the menu and the HUD
 * swap without either side owning the transition — the game does, when it switches scene.
 * Both entries mount this file: the web page beside the canvas, and the whole native web view.
 */
export function GameUi() {
  return (
    <UiLayer>
      <MainMenuUi />
      <Hud />
      <Menu />
    </UiLayer>
  );
}
