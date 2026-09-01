import { useUiState } from "@threenative/ui";
import type { GameState } from "../state.js";

/**
 * The office readout. Plain Tailwind, plain DOM — and the same file on every target.
 *
 * `useUiState` reads the game's *published* state, which moves at about 10 Hz rather than at the
 * frame rate, and is undefined until the game publishes its first snapshot.
 */
export function Hud() {
  const state = useUiState<GameState>();
  // Nothing to draw until the game publishes its first snapshot, a few milliseconds in.
  if (state === undefined) return null;
  const occupancy = state.deskCount === 0 ? 0 : (state.workerCount / state.deskCount) * 100;

  return (
    <div className="pointer-events-none absolute left-6 top-6 w-56">
      <div className="text-[10px] uppercase tracking-[0.14em] text-dim">threenative hq</div>
      <div className="text-4xl leading-none tabular-nums text-lume">{state.workerCount}</div>
      <div className="text-[10px] uppercase tracking-[0.14em] text-dim">
        {state.workerCount === 1 ? "session on the floor" : "sessions on the floor"}
      </div>
      <div className="mt-3">
        <div className="flex justify-between gap-2 text-[10px] uppercase tracking-[0.14em] text-dim">
          <span>desks</span>
          <b className="font-normal tabular-nums text-text">
            {state.workerCount}/{state.deskCount}
          </b>
        </div>
        <div className="relative mt-1 h-1 overflow-hidden border border-line bg-panel">
          <i className="absolute inset-y-0 left-0 bg-lume" style={{ width: `${occupancy}%` }} />
        </div>
      </div>
      <div className="mt-3 text-[10px] uppercase tracking-[0.14em] text-dim">
        watching
        <div className="mt-1 text-sm uppercase tracking-[0.08em] text-text">{state.focusState}</div>
        <div className="text-[10px] normal-case tracking-normal text-dim">
          {state.focusProject || "—"}
        </div>
      </div>
      {state.bridgeOnline ? null : (
        <div className="mt-4 border border-line bg-panel p-2">
          <div className="text-[10px] uppercase tracking-[0.14em] text-lume">bridge offline</div>
          <div className="mt-1 text-[10px] normal-case tracking-normal text-dim">
            run <b className="font-normal text-text">pnpm office</b> to fill the floor
          </div>
        </div>
      )}
    </div>
  );
}
