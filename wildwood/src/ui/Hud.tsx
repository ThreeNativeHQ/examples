import { useUiState } from "@threenative/ui";
import type { GameState } from "../state.js";

/** The eight points, so the compass reads in words rather than in degrees. */
const POINTS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"] as const;

function compassPoint(heading: number): string {
  return POINTS[Math.round(heading / 45) % 8] ?? "N";
}

/**
 * The HUD: a compass, a journal, and a prompt. Plain Tailwind, plain SVG, plain DOM — and the same
 * file on every target.
 *
 * An exploration game's HUD has exactly one hard job: answer "where do I go now" without answering
 * it so completely that there is nothing left to explore. So the compass gives a **bearing and a
 * distance to the nearest thing not yet found** and nothing else — no map, no marker, no line on
 * the ground. Far enough to aim at, vague enough that you still have to look.
 *
 * `useUiState` reads the game's *published* state, which moves at about 10 Hz rather than at the
 * frame rate, and is undefined until the game publishes its first snapshot.
 */
export function Hud() {
  const state = useUiState<GameState>();
  // Nothing to draw until the game publishes its first snapshot, a few milliseconds in. Rendering
  // zeroes instead would put a wrong bearing on screen and then correct it.
  if (state === undefined) return null;

  const found = state.discovered;
  const total = state.landmarkTotal;

  return (
    <>
      {/* Top left: the compass and what it is pointing at. */}
      <div className="pointer-events-none absolute left-6 top-6 w-56">
        <div className="flex items-baseline gap-2">
          <div className="text-4xl leading-none tabular-nums text-lume">
            {compassPoint(state.heading)}
          </div>
          <div className="text-[11px] tabular-nums text-dim">
            {String(Math.round(state.heading)).padStart(3, "0")}°
          </div>
        </div>
        {state.objectiveComplete ? (
          <div className="mt-2 text-[11px] uppercase tracking-[0.14em] text-warn">
            the valley is walked
          </div>
        ) : (
          <div className="mt-2">
            <div className="text-[10px] uppercase tracking-[0.14em] text-dim">nearest unfound</div>
            <div className="text-sm text-text">{state.nearest}</div>
            <div className="text-[11px] tabular-nums text-dim">
              {state.nearestDistance.toFixed(0)} m away
            </div>
          </div>
        )}
        <div className="mt-3 flex items-center gap-2 text-[10px] uppercase tracking-[0.14em] text-dim">
          found
          {Array.from({ length: total }, (_, slot) => (
            <i
              className={`h-2 w-2 border border-line ${slot < found ? "bg-lume" : "bg-panel"}`}
              key={slot}
            />
          ))}
          <b className="font-normal tabular-nums text-text">
            {found}/{total}
          </b>
        </div>
      </div>

      {/* Top right: the journal, written as it fills. */}
      {found === 0 ? null : (
        <div className="pointer-events-none absolute right-6 top-6 w-64 border border-line bg-panel/70 px-4 py-3">
          <div className="text-[10px] uppercase tracking-[0.14em] text-dim">journal</div>
          <ol className="mt-2 space-y-1">
            {state.journal.map((entry, index) => (
              <li className="flex gap-2 text-[12px] text-text" key={entry}>
                <span className="tabular-nums text-dim">{index + 1}</span>
                <span>{entry}</span>
              </li>
            ))}
          </ol>
        </div>
      )}

      {/* Centre: the inspect prompt, and the reticle it hangs under. */}
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-3">
        <i
          className={`h-1 w-1 rounded-full ${state.canInspect ? "bg-warn" : "bg-text/40"}`}
        />
        {state.canInspect ? (
          <output className="border border-line bg-panel/80 px-3 py-1 text-[11px] uppercase tracking-[0.14em] text-warn">
            press e — {state.inspectTarget}
          </output>
        ) : null}
      </div>

      {/* Bottom right: the walk itself, and the one number that says the ground is real. */}
      <div className="pointer-events-none absolute bottom-6 right-6 text-right">
        <div className="text-[10px] uppercase tracking-[0.14em] text-dim">walked</div>
        <div className="text-2xl leading-none tabular-nums text-text">
          {state.odometer.toFixed(0)}
          <span className="ml-1 text-[11px] text-dim">m</span>
        </div>
        {state.wading ? (
          <div className="mt-2 text-[11px] uppercase tracking-[0.14em] text-lume">wading</div>
        ) : null}
      </div>

      {state.objectiveComplete ? (
        <div className="pointer-events-none absolute inset-x-0 top-1/4 flex flex-col items-center gap-2">
          <output className="text-4xl uppercase tracking-[0.2em] text-warn">
            all five found
          </output>
          <div className="text-[11px] uppercase tracking-[0.14em] text-dim">
            {state.odometer.toFixed(0)} metres walked · press r to start again
          </div>
        </div>
      ) : null}
    </>
  );
}
