import type { IGame } from "@threenative/core";
import type { IPhysicsContext } from "@threenative/physics";
import { GameCanvas } from "@threenative/ui";
import type { GameState } from "../state.js";

/**
 * The page: the canvas and nothing else.
 *
 * This build exists to be looked at. A HUD, a debug overlay and a name-entry screen all sit
 * between the reference image and the frame being judged against it, and every one of them
 * changes the pixel statistics the comparison runs on. The starter's `GameUi` and
 * `DebugOverlay` are deliberately not mounted.
 */
export function App({ game }: { game: IGame<GameState, IPhysicsContext> }) {
  return (
    <main className="relative h-screen w-screen overflow-hidden bg-ink">
      <GameCanvas className="absolute inset-0" game={game} />
    </main>
  );
}
