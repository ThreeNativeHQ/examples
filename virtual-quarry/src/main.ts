import { acceptHotUpdate } from "@threenative/core/hot";
import game from "./game.js";
import "./style.css";

import.meta.hot?.accept();
acceptHotUpdate(game, import.meta.hot);
void game.start();

// The scaffold's launch card sits above the canvas until the first frame is on screen.
function removeLaunchSurfaceAfterPaint(): void {
  const launch = document.querySelector<HTMLElement>("[data-threenative-launch]");
  if (launch === null) return;
  const waitForCanvas = () => {
    if (document.querySelector("canvas") === null) {
      requestAnimationFrame(waitForCanvas);
      return;
    }
    requestAnimationFrame(() => requestAnimationFrame(() => launch.remove()));
  };
  requestAnimationFrame(waitForCanvas);
}

removeLaunchSurfaceAfterPaint();
