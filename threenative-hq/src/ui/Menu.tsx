import { useUiIntent, useUiState } from "@threenative/ui";
import type { GameState } from "../state.js";

/**
 * The floor controls. Deliberately small: this is a window onto work that is happening
 * elsewhere, so the only things to control are whether the room is moving and where it looks.
 */
export function Menu() {
  const send = useUiIntent();
  const state = useUiState<GameState>();
  const paused = state?.paused === true;

  return (
    <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-4 p-6">
      <div className="pointer-events-none text-[10px] uppercase tracking-[0.14em] text-dim">
        every desk is a live agent session on this machine
      </div>
      <button
        className="pointer-events-auto border border-line bg-panel px-3 py-1 text-[11px] uppercase tracking-[0.14em] text-text"
        onClick={() => send(paused ? "resume" : "pause")}
        type="button"
      >
        {paused ? "resume" : "pause"}
      </button>
    </div>
  );
}
