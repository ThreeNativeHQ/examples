import { WAYPOINTS } from "../chase.js";
import type { GameState } from "../state.js";

/**
 * The Storm Chaser card: the next waypoint and how far it is, the clock, nerve, and whether a lamp
 * is sheltering you. When the round ends it says how, and offers the next run.
 */
export function ChaseHud({
  state,
  send,
}: {
  state: GameState;
  send: (intent: string, payload?: unknown) => void;
}) {
  const { chase } = state;
  if (state.uiHidden) return null;
  const target = WAYPOINTS[chase.next];
  const seconds = Math.ceil(chase.timeLeft);
  const clock = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  const outcome =
    chase.phase === "won"
      ? `Field station reached · ${seconds} s to spare`
      : chase.reason === "nerve"
        ? "Struck too close in the open · nerve gone"
        : "Out of time · the storm keeps the coast";
  return (
    <section aria-label="Storm Chaser" className="chase-card">
      <div className="chase-eyebrow">STORM CHASER</div>
      {chase.phase === "playing" ? (
        <>
          <div aria-live="polite" className="chase-objective">
            {target?.label ?? ""} <span>· {Math.round(chase.distance)} m</span>
          </div>
          <div className="chase-row">
            <span>
              <small>TIME</small> {clock}
            </span>
            <span aria-label={`Nerve ${chase.nerve} of 3`}>
              <small>NERVE</small> {"●".repeat(chase.nerve)}
              {"○".repeat(Math.max(0, 3 - chase.nerve))}
            </span>
            <span className={chase.sheltered ? "chase-safe" : "chase-open"}>
              {chase.sheltered ? "UNDER A LAMP" : "IN THE OPEN"}
            </span>
          </div>
        </>
      ) : (
        <>
          <div aria-live="polite" className="chase-objective">
            {outcome}
          </div>
          <button
            className="chase-restart"
            data-tn-interactive
            onClick={() => send("restartChase")}
            type="button"
          >
            Run it again
          </button>
        </>
      )}
    </section>
  );
}
