import { useUiIntent, useUiState } from "@threenative/ui";
import { useState } from "react";
import type { GameState, SessionRow } from "../state.js";

/**
 * The floor's read-out: what is running, what needs you, and who is who.
 *
 * It reads only what the bridge published — repository, host, state, last tool — because that is
 * all the bridge carries. No prompt text crosses the wire, so none of it can end up on a wall.
 */
const STATE_KEYS = ["working", "thinking", "blocked", "idle"] as const;
type StateKey = (typeof STATE_KEYS)[number];

export function Panel() {
  const state = useUiState<GameState>();
  const send = useUiIntent();
  const [open, setOpen] = useState(true);
  if (state === undefined) return null;

  const sessions = state.sessions ?? [];
  const counts = tally(sessions);
  const blocked = sessions.filter((session) => session.state === "blocked");

  if (!open)
    return (
      <button
        className="pointer-events-auto absolute right-0 top-24 flex flex-col items-center gap-2 border border-line border-r-0 bg-panel px-2 py-4 text-[10px] uppercase tracking-[0.14em] text-dim"
        data-tn-interactive
        onClick={() => setOpen(true)}
        type="button"
      >
        <span className="text-lg leading-none text-lume">{sessions.length}</span>
        <span className="[writing-mode:vertical-rl]">sessions</span>
        {blocked.length > 0 ? (
          <span className="[writing-mode:vertical-rl] text-warn">{blocked.length} waiting</span>
        ) : null}
      </button>
    );

  return (
    <aside className="pointer-events-auto absolute bottom-4 right-4 top-4 flex w-80 flex-col border border-line bg-panel text-text">
      <header className="flex items-start justify-between border-b border-line px-4 py-3">
        <div>
          <div className="text-[10px] uppercase tracking-[0.16em] text-dim">threenative hq</div>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl leading-none text-lume">{sessions.length}</span>
            <span className="text-[10px] uppercase tracking-[0.14em] text-dim">
              {sessions.length === 1 ? "session" : "sessions"} · {state.deskCount} desks
            </span>
          </div>
          <div className="mt-1 flex items-center gap-1.5 text-[10px] uppercase tracking-[0.14em]">
            <i
              className={`h-1.5 w-1.5 rounded-full ${state.bridgeOnline ? "bg-lume" : "bg-warn"}`}
            />
            <span className={state.bridgeOnline ? "text-dim" : "text-warn"}>
              {state.bridgeOnline ? "bridge live" : "bridge offline — run pnpm office"}
            </span>
          </div>
        </div>
        <button
          className="border border-line px-2 py-1 text-[10px] uppercase tracking-[0.14em] text-dim"
          data-tn-interactive
          onClick={() => setOpen(false)}
          type="button"
        >
          hide
        </button>
      </header>

      <section className="grid grid-cols-4 border-b border-line">
        {STATE_KEYS.map((label) => (
          <div className="border-r border-line px-3 py-2 last:border-r-0" key={label}>
            <div
              className={`text-xl leading-none tabular-nums ${label === "blocked" && counts[label] > 0 ? "text-warn" : "text-text"}`}
            >
              {counts[label]}
            </div>
            <div className="text-[9px] uppercase tracking-[0.12em] text-dim">{label}</div>
          </div>
        ))}
      </section>

      <section className="border-b border-line px-4 py-3">
        <div className="text-[10px] uppercase tracking-[0.16em] text-dim">needs you</div>
        {blocked.length === 0 ? (
          <div className="mt-1 text-xs text-dim">nobody is waiting on you</div>
        ) : (
          <ul className="mt-1 space-y-1">
            {blocked.map((session) => (
              <li className="truncate text-sm text-warn" key={session.id}>
                {session.project} <span className="text-[10px] text-dim">{session.host}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="min-h-0 flex-1 overflow-y-auto">
        <div className="px-4 pb-1 pt-3 text-[10px] uppercase tracking-[0.16em] text-dim">
          on the floor
        </div>
        <ul>
          {sessions.map((session) => (
            <li key={session.id}>
              <button
                className={`flex w-full items-center gap-2 px-4 py-1.5 text-left text-xs ${
                  session.id === state.selectedId ? "bg-line text-lume" : "text-text"
                }`}
                data-tn-interactive
                onClick={() => send(`select:${session.id}`)}
                type="button"
              >
                <i
                  className={`h-1.5 w-1.5 shrink-0 rounded-full ${dot(session.state)}`}
                  title={session.state}
                />
                <span className="min-w-0 flex-1 truncate">{session.project}</span>
                <span className="shrink-0 text-[9px] uppercase tracking-[0.12em] text-dim">
                  {session.host}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </section>

      {state.selectedId === "" ? null : (
        <section className="border-t border-line px-4 py-3">
          <div className="text-[10px] uppercase tracking-[0.16em] text-dim">selected</div>
          <div className="truncate text-lg leading-tight text-lume">{state.selectedProject}</div>
          <dl className="mt-2 space-y-0.5">
            {(
              [
                ["state", state.selectedState],
                ["last tool", state.selectedTool || "—"],
                ["known from", state.selectedSource],
              ] as const
            ).map(([label, value]) => (
              <div className="flex justify-between gap-3 text-[10px] uppercase tracking-[0.12em]" key={label}>
                <dt className="text-dim">{label}</dt>
                <dd className="truncate">{value}</dd>
              </div>
            ))}
          </dl>
          <div className="mt-1 truncate text-[9px] text-dim">{state.selectedId}</div>
        </section>
      )}

      <footer className="border-t border-line px-4 py-2 text-[9px] uppercase leading-relaxed tracking-[0.12em] text-dim">
        click the room to take the mouse · wasd to walk · shift to hurry · click a worker to inspect
        · esc to release
      </footer>
    </aside>
  );
}

function tally(sessions: readonly SessionRow[]): Readonly<Record<StateKey, number>> {
  const counts: Record<StateKey, number> = { blocked: 0, idle: 0, thinking: 0, working: 0 };
  for (const session of sessions) {
    // Arriving and leaving are the room's business, not the machine's: a session walking to its
    // desk is still whatever the bridge says it is, so it counts under nothing here.
    const key = STATE_KEYS.find((candidate) => candidate === session.state);
    if (key !== undefined) counts[key] += 1;
  }
  return counts;
}

function dot(state: string): string {
  if (state === "blocked") return "bg-warn";
  if (state === "working") return "bg-lume";
  if (state === "thinking") return "bg-text";
  return "bg-dim";
}
