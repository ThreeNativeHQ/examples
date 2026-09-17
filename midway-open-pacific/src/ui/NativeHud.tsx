import { useUiState } from "@threenative/ui";
import type { GameState } from "../scenes/Midway.js";

/**
 * The flight HUD the native web view draws over the game surface.
 *
 * It reads only the game's *published* state (`Midway.publish`), which moves at about 10 Hz and
 * crosses a process boundary — so everything here is a plain value, never a live `Battle`. The
 * web build still uses the richer DOM HUD in `src/hud.ts`; this is the same information a pilot
 * needs, in the one form a native target can render.
 */
const PANEL: React.CSSProperties = {
  background: "linear-gradient(90deg, rgba(9,27,36,.72), rgba(9,27,36,.28))",
  border: "1px solid rgba(214,232,231,.16)",
  color: "#d6e0d8",
  font: "11px/1.7 ui-monospace, monospace",
  letterSpacing: ".08em",
  padding: "10px 14px",
};

function Readout({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", gap: 10, justifyContent: "space-between" }}>
      <span style={{ color: "#8fa8a4" }}>{label}</span>
      <b style={{ color: "#eee0b9", fontWeight: 400 }}>{value}</b>
    </div>
  );
}

export function NativeHud() {
  const state = useUiState<GameState>();
  // Before the first snapshot, say so rather than rendering nothing. A HUD that draws no pixels is
  // indistinguishable from an overlay that failed to attach, which is exactly the confusion that
  // hid a missing `state.flush()` on the game side.
  if (state === undefined) {
    return (
      <div style={{ ...PANEL, left: 22, position: "absolute", top: 22 }}>
        SCOUT TWO · AWAITING TELEMETRY
      </div>
    );
  }
  const feet = Math.round(state.altitude * 3.28084);
  const knots = Math.round(state.ias * 1.94384);
  return (
    <div
      style={{
        inset: 0,
        pointerEvents: "none",
        position: "absolute",
        // The overlay is the whole surface; only the islands below are opaque.
        userSelect: "none",
      }}
    >
      <div style={{ ...PANEL, left: 22, position: "absolute", top: 22, width: 190 }}>
        <div style={{ color: "#d0b67f", marginBottom: 6 }}>SCOUT TWO / SBD</div>
        <Readout label="ALT" value={`${feet} FT`} />
        <Readout label="IAS" value={`${knots} KT`} />
        <Readout label="THR" value={`${Math.round(state.throttle * 100)}%`} />
        <Readout label="STATE" value={state.airborne ? "AIRBORNE" : state.mode.toUpperCase()} />
      </div>
      <div style={{ ...PANEL, bottom: 22, left: 22, position: "absolute" }}>
        W / S THROTTLE &nbsp;·&nbsp; ↑ ↓ PITCH &nbsp;·&nbsp; A D BANK &nbsp;·&nbsp; SPACE GUNS &nbsp;·&nbsp; B DROP
      </div>
    </div>
  );
}
