import { useUiState } from "@threenative/ui";
import type { GameState } from "../state.js";

/**
 * What one worker is doing, when you click it.
 *
 * Everything here came off the bridge's session summary. There is deliberately no prompt, no tool
 * argument and no transcript excerpt: the bridge never sends them, so this card cannot leak them
 * onto a screen someone else can see.
 */
export function WorkerCard() {
  const state = useUiState<GameState>();
  if (state === undefined || state.selectedId === "") return null;

  const rows: readonly (readonly [string, string])[] = [
    ["host", state.selectedHost],
    ["state", state.selectedState],
    ["last tool", state.selectedTool || "—"],
    ["known from", state.selectedSource],
  ];

  return (
    <div className="pointer-events-none absolute right-6 top-6 w-64 border border-line bg-panel p-3">
      <div className="text-[10px] uppercase tracking-[0.14em] text-dim">working in</div>
      <div className="truncate text-xl leading-tight text-lume">{state.selectedProject}</div>
      <dl className="mt-3 space-y-1">
        {rows.map(([label, value]) => (
          <div className="flex justify-between gap-3 text-[10px] uppercase tracking-[0.14em]" key={label}>
            <dt className="text-dim">{label}</dt>
            <dd className="truncate text-text">{value}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-3 truncate text-[10px] normal-case tracking-normal text-dim">
        {state.selectedId}
      </div>
    </div>
  );
}
