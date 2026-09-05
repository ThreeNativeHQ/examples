import type { IGame } from "@threenative/core";
import type { IPhysicsContext } from "@threenative/physics";
import { GameCanvas } from "@threenative/ui";
import type { GameState } from "../state.js";
import { GameUi } from "./GameUi.js";

export function App({ game }: { game: IGame<GameState, IPhysicsContext> }) {
  return <main><GameCanvas className="canvas" game={game} /><GameUi /></main>;
}
