import { useEffect, useRef, useState } from "react";
import { useUiIntent, useUiState } from "@threenative/ui";
import type { GameState } from "../state.js";
import { PRESETS } from "../expression.js";

/**
 * Everything that acts on the face rather than naming a channel: the recipe's intensity and how
 * long a change takes, the two procedural automations, the demonstration sequence and its scrub,
 * the LOD preview, and the pose file.
 *
 * Real controls throughout — range inputs, checkboxes, buttons, a textarea — each carrying
 * `data-tn-interactive`, because a native input host can only aim at a rectangle the game published.
 *
 * The pose text is local to this panel on purpose. It is typed into, and a controlled textarea the
 * game republishes every frame fights the caret; the game sends its own JSON down through `pose`
 * and this panel adopts it only when it changes.
 */

const ROW = "flex items-center gap-1.5";

function Slider({
  label,
  value,
  min,
  max,
  step,
  suffix,
  onCommit,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix: string;
  onCommit: (value: number) => void;
}) {
  return (
    <div className={ROW}>
      <span className="w-[4.75rem] shrink-0 text-[10px] text-dim">{label}</span>
      <input
        aria-label={label}
        className="pointer-events-auto h-1 min-w-0 flex-1 cursor-ew-resize appearance-none rounded-full bg-line/40 accent-[var(--color-lume)]"
        data-tn-interactive
        max={max}
        min={min}
        onChange={(event) => onCommit(Number(event.target.value))}
        step={step}
        type="range"
        value={value}
      />
      <span className="w-11 shrink-0 text-right text-[10px] tabular-nums text-text">
        {value.toFixed(2)}
        {suffix}
      </span>
    </div>
  );
}

function Toggle({ label, on, onChange }: { label: string; on: boolean; onChange: (on: boolean) => void }) {
  return (
    <label className="pointer-events-auto flex flex-1 cursor-pointer items-center gap-1 text-[10px] text-dim">
      <input
        checked={on}
        className="h-2.5 w-2.5 accent-[var(--color-lume)]"
        data-tn-interactive
        onChange={(event) => onChange(event.target.checked)}
        type="checkbox"
      />
      {label}
    </label>
  );
}

const BUTTON =
  "pointer-events-auto rounded-[4px] border border-line/50 bg-ink/50 px-1 py-1.5 text-[9px] uppercase tracking-[0.1em] text-dim transition-colors hover:border-lume hover:text-text focus:border-lume focus:text-text";
const BUTTON_ON = "border-lume/70 bg-lume/15 text-lume";

export function PerformancePanel() {
  const send = useUiIntent();
  const state = useUiState<GameState>();
  const [text, setText] = useState("");
  const saved = useRef("");
  // The game writes a saved pose into `state.pose`; adopt it once, when it is a new one.
  useEffect(() => {
    if (state === undefined || state.pose === "" || state.pose === saved.current) return;
    saved.current = state.pose;
    setText(state.pose);
  }, [state]);
  if (state === undefined) return null;

  const active = Object.values(state.controls).filter((value) => value !== 0).length;

  return (
    <div className="flex flex-col gap-1.5">
      <p className="px-0.5 text-[9px] tracking-[0.1em] text-dim/80">
        {state.demoEngaged
          ? `demo at ${state.demoTime.toFixed(2)}s${state.playing ? "" : " · paused"}`
          : state.preset === ""
            ? "no recipe chosen"
            : `${state.preset} recipe`}{" "}
        · {active}/{Object.keys(state.controls).length} active
      </p>

      <section className="flex flex-col gap-1 rounded-md border border-line/40 bg-ink/25 p-2">
        <Slider
          label="intensity"
          max={1}
          min={0}
          onCommit={(value) => send("intensity", { value })}
          step={0.05}
          suffix=""
          value={state.intensity}
        />
        <Slider
          label="transition"
          max={1.5}
          min={0}
          onCommit={(value) => send("transition", { value })}
          step={0.05}
          suffix="s"
          value={state.transition}
        />
      </section>

      <section className="flex gap-1 rounded-md border border-line/40 bg-ink/25 p-2">
        <Toggle
          label="blink"
          on={state.blinkAuto}
          onChange={(on) => send("automation", { value: on ? 1 : 0, which: "blink" })}
        />
        <Toggle
          label="gaze"
          on={state.gazeAuto}
          onChange={(on) => send("automation", { value: on ? 1 : 0, which: "gaze" })}
        />
      </section>

      <section className="flex flex-col gap-1 rounded-md border border-line/40 bg-ink/25 p-2">
        <div className="flex items-center gap-1">
          <button
            className={`${BUTTON} ${state.playing ? BUTTON_ON : ""} flex-1`}
            data-tn-interactive
            onClick={() => send("demo", { action: "play" })}
            type="button"
          >
            play
          </button>
          <button
            className={`${BUTTON} flex-1`}
            data-tn-interactive
            onClick={() => send("demo", { action: "pause" })}
            type="button"
          >
            pause
          </button>
          <span className="w-16 text-right text-[10px] tabular-nums text-text">
            {state.demoTime.toFixed(2)}s
          </span>
        </div>
        {/* A quarter-second step, and that is a measured choice rather than a round number: a
            finer step does not survive contact with a pointer. Chromium maps a track of this width
            onto about twenty positions, so a 0.05s step is quantised to something near 0.5s and
            most of the declared resolution is unreachable by clicking. */}
        <Slider
          label="scrub"
          max={state.demoDuration}
          min={0}
          onCommit={(value) => send("demo", { value })}
          step={0.25}
          suffix="s"
          value={state.demoTime}
        />
      </section>

      <section className="flex items-center gap-1 rounded-md border border-line/40 bg-ink/25 p-2">
        <span className="w-[4.75rem] shrink-0 text-[10px] text-dim">mesh LOD</span>
        {[0, 1].map((lod) => (
          <button
            className={`${BUTTON} flex-1 ${state.lod === lod ? BUTTON_ON : ""}`}
            data-tn-interactive
            key={lod}
            onClick={() => send("lod", { value: lod })}
            type="button"
          >
            LOD{lod}
          </button>
        ))}
        <span className="text-[9px] tabular-nums text-text">{state.lodVertices.toLocaleString()}</span>
      </section>

      <section className="flex flex-col gap-1 rounded-md border border-line/40 bg-ink/25 p-2">
        <span className="text-[10px] text-dim">pose · versioned JSON, pinned to this specimen</span>
        <textarea
          aria-label="pose"
          className="pointer-events-auto h-24 w-full resize-none rounded-[4px] border border-line/50 bg-ink/70 p-1.5 text-[9px] leading-[1.35] text-text outline-none focus:border-lume"
          data-tn-interactive
          onChange={(event) => setText(event.target.value)}
          placeholder="save to write the current pose here, then load it back"
          spellCheck={false}
          value={text}
        />
        <div className="flex gap-1">
          <button className={`${BUTTON} flex-1`} data-tn-interactive onClick={() => send("pose", { action: "save" })} type="button">
            save
          </button>
          <button
            className={`${BUTTON} flex-1`}
            data-tn-interactive
            onClick={() => send("pose", { action: "load", text })}
            type="button"
          >
            load
          </button>
          <button className={`${BUTTON} flex-1`} data-tn-interactive onClick={() => send("pose", { action: "clear" })} type="button">
            clear
          </button>
        </div>
        <p className="min-h-3 text-[9px] leading-[1.35] text-dim/80">{state.poseStatus}</p>
      </section>

      <p className="px-0.5 text-[9px] leading-[1.35] text-dim/60">
        A manual edit stops the demo and switches off whichever automation owns that channel. Reset
        stops both and restores the declared neutral. {Object.keys(PRESETS).length} recipes, blended
        in control space before the rig evaluates.
      </p>
    </div>
  );
}
