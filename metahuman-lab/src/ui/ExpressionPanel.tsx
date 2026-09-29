import { useRef, useState } from "react";
import { useUiIntent, useUiState } from "@threenative/ui";
import type { GameState } from "../state.js";
import { PRESETS, type PresetName } from "../expression.js";
import { CONTROL_GROUPS, type IControlGroup } from "./groups.js";
import { PerformancePanel } from "./PerformancePanel.js";

/**
 * The keyboard's step on a pose channel, as a fraction of the declared 0..1 domain.
 *
 * Coarse enough that four presses reach a full pose — a faceboard channel is a pose, not a
 * measurement — and fine enough to stop halfway, which is where most of the interesting faces are.
 */
const STEP = 0.05;

/**
 * The expression panel: one row per faceboard row the specimen declares, in collapsible groups.
 *
 * Each row is a real `<input type="range">` plus a real number input, so the keyboard owns it —
 * arrows step, Home and End jump to the ends of the declared domain, and Tab reaches every control
 * in the order it is read. `data-tn-interactive` on both publishes the rectangle to the native input
 * host. Nothing here is a div that pretends to be a slider.
 *
 * The game owns the value. A slider is a view of `state.controls` and every change goes out as an
 * intent; the scene coalesces them into one `setControls` per rendered frame, so a drag across
 * twelve sliders is twelve intents and one rig write.
 *
 * Every group remembers whether it was open, so a pose that needs the mouth and not the gaze does not
 * cost the same scroll twice.
 */

function NumberField({
  alias,
  value,
  domain,
  onCommit,
}: {
  alias: string;
  value: number;
  domain: readonly [number, number];
  onCommit: (alias: string, value: number) => void;
}) {
  // Typed text is local until it is committed, so clearing the field to type `0.75` is possible;
  // `null` means "follow the game's published value".
  const [typed, setTyped] = useState<string | null>(null);
  return (
    <input
      aria-label={`${alias} numeric`}
      className="pointer-events-auto w-11 shrink-0 rounded-[3px] border border-line/50 bg-ink/70 px-1 text-right text-[10px] leading-4 tabular-nums text-text outline-none focus:border-lume"
      data-tn-interactive
      max={domain[1]}
      min={domain[0]}
      onBlur={() => setTyped(null)}
      onChange={(event) => {
        setTyped(event.target.value);
        const next = Number(event.target.value);
        if (Number.isFinite(next)) onCommit(alias, next);
      }}
      step="0.05"
      type="number"
      value={typed ?? value.toFixed(2)}
    />
  );
}

function Group({ group, state, set, link }: {
  group: IControlGroup;
  state: GameState;
  set: (alias: string, value: number) => void;
  link: (group: string, value: boolean) => void;
}) {
  const [open, setOpen] = useState(true);
  const paired = group.rows.some((row) => row.right !== undefined);
  /**
   * What a row last asked for, per alias, and the published value it asked from.
   *
   * A range input is controlled by `state.controls`, which is the value the *rig* was given, and
   * the scene applies a queued intent on the next drawn frame — so a key press lands in a gap. The
   * browser has already stepped the input and fired `onChange`, but any render inside that gap
   * writes the older published value straight back over it, and this panel re-renders on every
   * frame because the state it reads carries the frame counters. Measured, a playtest mashing
   * ArrowRight lost 10 of its 18 presses to exactly that, and a person mashing the arrow key loses
   * the same steps.
   *
   * So a row shows what it asked for until the game answers. The entry is dropped on the first
   * publish that differs from the value the edit was made *from* — which covers both answers, the
   * rig agreeing with the edit and the game moving the channel on its own (a recipe, a reset, the
   * linked twin) — so the row is a plain view of the rig again one frame later either way.
   */
  const inflight = useRef(new Map<string, { readonly was: number; readonly want: number }>());
  const shown = (alias: string, published: number): number => {
    const entry = inflight.current.get(alias);
    if (entry === undefined) return published;
    if (published === entry.was) return entry.want;
    inflight.current.delete(alias);
    return published;
  };
  const ask = (alias: string, published: number, value: number): void => {
    inflight.current.set(alias, { was: published, want: value });
    set(alias, value);
  };
  return (
    <section className="rounded-md border border-line/40 bg-ink/25">
      <div className="flex items-center gap-1.5 px-2 py-1.5">
        {/* A real button, so the group is operable from the keyboard and announced as a control. */}
        <button
          aria-expanded={open}
          className="pointer-events-auto flex flex-1 items-center gap-1.5 text-left text-[10px] font-semibold uppercase tracking-[0.16em] text-text"
          data-tn-interactive
          onClick={() => setOpen(!open)}
          type="button"
        >
          <span aria-hidden className={`text-[8px] text-lume transition-transform ${open ? "rotate-90" : ""}`}>
            ▶
          </span>
          {group.label}
          <span className="text-[9px] font-normal tracking-normal text-dim/70">{group.rows.length}</span>
        </button>
        {paired ? (
          <label className="pointer-events-auto flex cursor-pointer items-center gap-1 text-[9px] uppercase tracking-[0.1em] text-dim">
            <input
              checked={state.linked[group.id] === true}
              className="h-2.5 w-2.5 accent-[var(--color-lume)]"
              data-tn-interactive
              onChange={(event) => link(group.id, event.target.checked)}
              type="checkbox"
            />
            link
          </label>
        ) : null}
      </div>
      {open ? (
        <div className="flex flex-col gap-1 border-t border-line/25 px-2 py-1.5">
          {group.rows.map((row) => {
            const left = state.controls[row.left] ?? 0;
            const leftDomain = state.domains[row.left] ?? [0, 1];
            const right = row.right;
            const rightDomain = right === undefined ? leftDomain : (state.domains[right] ?? leftDomain);
            return (
              <div className="flex items-center gap-1.5" key={row.left}>
                <span className="w-[4.75rem] shrink-0 truncate text-[10px] tracking-[0.02em] text-dim">
                  {row.label}
                </span>
                <input
                  aria-label={`${row.label} left`}
                  className="pointer-events-auto h-1 min-w-0 flex-1 cursor-ew-resize appearance-none rounded-full bg-line/40 accent-[var(--color-lume)]"
                  data-tn-interactive
                  max={leftDomain[1]}
                  min={leftDomain[0]}
                  onChange={(event) => ask(row.left, left, Number(event.target.value))}
                  step={STEP}
                  type="range"
                  value={shown(row.left, left)}
                />
                {right === undefined ? null : (
                  <input
                    aria-label={`${row.label} right`}
                    className="pointer-events-auto h-1 min-w-0 flex-1 cursor-ew-resize appearance-none rounded-full bg-line/40 accent-[var(--color-lume)]"
                    data-tn-interactive
                    max={rightDomain[1]}
                    min={rightDomain[0]}
                    onChange={(event) => ask(right, state.controls[right] ?? 0, Number(event.target.value))}
                    step={STEP}
                    type="range"
                    value={shown(right, state.controls[right] ?? 0)}
                  />
                )}
                <NumberField
                  alias={row.left}
                  domain={leftDomain}
                  onCommit={(alias, next) => {
                    set(alias, next);
                    if (row.right !== undefined) set(row.right, next);
                  }}
                  value={left}
                />
              </div>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}

export function ExpressionPanel() {
  const send = useUiIntent();
  const state = useUiState<GameState>();
  const [panel, setPanel] = useState<"controls" | "performance">("controls");
  if (state === undefined || state.phase !== "ready") return null;
  const set = (alias: string, value: number) => send("control", { alias, value });

  return (
    <div className="pointer-events-none absolute right-0 top-0 flex h-full w-[22rem] flex-col gap-2 overflow-y-auto overflow-x-hidden border-l border-line/40 bg-gradient-to-b from-ink/85 via-ink/80 to-ink/90 p-2.5 backdrop-blur-md">
      <header className="flex flex-col gap-1.5 px-0.5">
        <div className="flex items-baseline justify-between">
          <h2 className="text-[10px] font-semibold uppercase tracking-[0.22em] text-text">expression</h2>
          {/* Two panels, one header row: `controls` is the sliders and `performance` is everything
              that acts on the face as a whole. They share this row rather than adding one, so the
              rows below keep the positions a playtest and a reader already know. */}
          <div className="flex gap-1">
            {(["controls", "performance"] as const).map((tab) => (
              <button
                aria-pressed={tab === panel}
                className={`pointer-events-auto rounded-[4px] border px-1.5 py-0 text-[9px] uppercase leading-[1.1] tracking-[0.1em] transition-colors focus:border-lume ${
                  tab === panel
                    ? "border-lume/70 bg-lume/15 text-lume"
                    : "border-line/50 text-dim hover:border-lume hover:text-text"
                }`}
                data-tn-interactive
                key={tab}
                onClick={() => setPanel(tab)}
                type="button"
              >
                {tab}
              </button>
            ))}
          </div>
        </div>
        {panel === "performance" ? <PerformancePanel /> : null}
        {panel === "controls" ? (
        <>
        <div className="grid grid-cols-5 gap-1">
          {(Object.keys(PRESETS) as PresetName[]).map((preset) => (
            <button
              aria-pressed={preset === state.preset}
              className={`pointer-events-auto rounded-[4px] border px-0.5 py-1.5 text-[9px] uppercase tracking-[0.06em] transition-colors focus:border-lume focus:text-text ${
                preset === state.preset
                  ? "border-lume/70 bg-lume/15 text-lume"
                  : "border-line/50 bg-ink/50 text-dim hover:border-lume hover:text-text"
              }`}
              data-tn-interactive
              key={preset}
              onClick={() => send("preset", { name: preset })}
              type="button"
            >
              {preset}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-1">
          <button
            className="pointer-events-auto rounded-[4px] border border-line/50 bg-ink/50 px-1 py-1.5 text-[9px] uppercase tracking-[0.1em] text-dim transition-colors hover:border-lume hover:text-text focus:border-lume focus:text-text"
            data-tn-interactive
            onClick={() => send("frame")}
            type="button"
          >
            frame face
          </button>
          <button
            className="pointer-events-auto rounded-[4px] border border-lume/60 bg-lume/10 px-1 py-1.5 text-[9px] uppercase tracking-[0.1em] text-lume transition-colors hover:bg-lume/20 focus:bg-lume/20"
            data-tn-interactive
            onClick={() => send("reset")}
            type="button"
          >
            reset
          </button>
        </div>
        <p className="text-[9px] leading-[1.35] tracking-[0.02em] text-dim/60">
          drag the face to orbit · wheel to zoom · right-drag or shift-drag to pan · F to reframe
        </p>
        </>
        ) : null}
      </header>

      {panel === "controls"
        ? CONTROL_GROUPS.map((group) => (
            <Group
              group={group}
              key={group.id}
              link={(id, value) => send("link", { group: id, value: value ? 1 : 0 })}
              set={set}
              state={state}
            />
          ))
        : null}
    </div>
  );
}
