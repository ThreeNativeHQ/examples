# PRD-midway-native-smooth-20260923 — Native Midway that plays smoothly

**Status:** IN PROGRESS
**Complexity:** 4 (MEDIUM)
**Owner:** Joao Paulo Furtado (play sign-off); agent (implementation)
**Depends on:** PRD-midway-render-cpu-20260922 (merged, `0ecd12b`)
POST-DEVICE-EVALUATION-REQUIRED: Joao plays the final native build on his desktop.

Complexity: files 6–10 (+2), crosses the engine runtime release boundary (+2) → 4 → MEDIUM; risk
override: none.

## Rule

**The look is fixed. Only cost and latency move.** The bans in PRD-midway-render-cpu-20260922 still
apply: no MSAA or resolution cut, no shadow cut, no decimation, and no reflection refresh cut.
Gameplay timing is also fixed: the simulation must produce the same battle.

## Context

The owner played the native desktop build (RTX 2080, KDE Wayland via Xwayland) on 2026-09-23 and
reported delays and hiccups. Three runtime logs are in `/tmp/claude-1000/render-cpu-work/`. The
host's load average was 8–22 because other agents were running.

| # | Symptom | Measured cause |
|---|---|---|
| 1 | The HUD lags behind the game | The game publishes the HUD at 10 Hz (`src/ui/bridge.ts:110`). Each web-view snapshot then takes a 40–98 ms round trip, one at a time, and about 90% of that is WebKit CPU raster forced by `queue_draw()`. The HUD repaints about 9 times per second. |
| 2 | No hover; a click on a stale frame misses | Only move/down/up are injected; enter/over events are never dispatched. The routing itself is correct: on Xvfb the published regions match the drawn buttons. |
| 3 | Freezes mid-flight (the worst was 615 ms) | 107 pipelines compile after "ready", 1.37 s in total, the slowest 239 ms. They are shadow-pass, reflection-pass and hull variants, which `compileAsync` cannot reach. |
| 4 | fps falls from about 50 to about 25 as the battle grows | Render CPU p99 goes from 25 to 80 ms while the GPU is 88–92% idle. Draws per pass: main 114–226, shadow 31–165, reflection 6–135. |
| 5 | Update spikes of 50–260 ms | A slow frame triggers up to 5 catch-up substeps. Fighter targeting is O(n²). Aircraft detail is re-cloned when an aircraft crosses the LOD thresholds. |
| 6 | A 1.9 s stall entering the game | `TN_SLOW_PHASE uiMessages`: the first flight HUD builds while the warm-up is also compiling. |

## Solution

1. **Measure without the owner.** Add `tools/bench-native.sh <artifact>`. It runs the native
   artifact on a private Xvfb under `tools/capture-lock.sh` with `xcompmgr`, clicks AIRBORNE START
   with `xdotool` at the published region, flies a fixed number of seconds, and summarises
   `TN_FRAME_BUDGET`, `TN_UI_*`, and pipeline events per window. Stock and candidate builds run
   interleaved.
2. **Land the work already built:**
   - Engine `perf/native-ui-snapshot-rate`:
     - `7e1e557ac`: no forced full redraw, one-pass read, split timing.
     - `7b2dceb9f`: hover events and the OS press verdict.
     - `8adc71e80`: move coalescing and a leave event.
   - Game `midway/native-perf-sim` `4ac349b`: O(n) targeting, proven hash-identical over 14,400
     steps.
   - Game `midway/native-perf`:
     - warm-up coverage of the shadow, reflection and hull passes;
     - aircraft clone pooling;
     - a per-frame HUD publish;
     - `.tn-hover` selectors;
     - the `VITE_MIDWAY_FPS` build flag.
3. **Then take the levers the bench ranks first,** one at a time, and keep only measured wins.
   Candidates:
   - per-pass draw submission (main, shadow and reflection);
   - the UI phase's per-frame texture upload;
   - substep catch-up policy, but only if the simulation stays identical;
   - the stall at game start.

## Acceptance Criteria

- [ ] AC-1 [local; actor: agent]: `tools/bench-native.sh` runs a native artifact hands-off through
  AIRBORNE START and prints fps, presented p95/p99/max, hitches, update and render p99, UI
  uploads/s, and pipelines created after the start. Negative control: stock reports pipelines > 0
  and UI uploads ≈ 9/s. — Evidence: pending.
- [ ] AC-2 [local; actor: agent]: No render pipeline is created after the airborne start on the
  candidate (stock: 107). — Evidence: pending.
- [ ] AC-3 [local; actor: agent]: In flight the HUD repaints at ≥ 30/s (stock ≈ 9). A synthetic
  hover over TAKE THE DECK applies `tn-hover`, and a press on it logs `hit:true` and starts the
  game. — Evidence: pending.
- [ ] AC-4 [local; actor: agent]: Over a 120 s airborne bench, 3 interleaved pairs on a quiet host,
  the candidate's presented p99 is ≥ 30% lower than stock, and no frame after the first 10 s of
  flight exceeds 150 ms. The same battle is flown: the same seed, with `check-tactics-equivalence`
  passing. — Evidence: pending.
- [ ] AC-5 [local; actor: agent]: The look is unchanged: `compare-frames` PASSes on all views
  against stock. The regression gates pass as they do on stock: typecheck, vite build,
  check-fleet, check-catalog, capture-deck, capture-fleet and the WebGPU launch playtest. —
  Evidence: pending.
- [ ] AC-6 [owner; actor: Joao]: He plays the final native build (FPS panel on from launch) and
  confirms it plays smoothly and the HUD keeps up. — Evidence: pending.

## Integration Ledger

| Capability | Reachable consumer/trigger | Replaces / disposition | Evidence |
|---|---|---|---|
| Native UI snapshot and pointer | Player's mouse and HUD → the runtime overlay (`offscreen.rs`, `lib.rs`, `window.cpp`) | The forced redraw and the press-only injection are removed | AC-3 |
| Pass warm-up | Loading/briefing → `WorldView.warmUpViews` | Main-pass-only compile | AC-2 |
| HUD publish | `BridgeHud.update` every frame | The 10 Hz gate is removed | AC-3 |
| O(n) targeting and aircraft pooling | `Battle.step`, `WorldView.update` | The per-fighter scans and per-crossing clones are removed | AC-4 |

## Execution Phases

#### Phase 1: A bench that needs no human
**Status:** NOT STARTED
**ACs:** AC-1
**Files:** `tools/bench-native.sh` (new), `tools/bench-native-summary.mjs` (new; the
FPS/UI/pipeline window summariser)
**Verification:** E1: stock artifact × 2 runs; the numbers are stable enough to compare.
**Checkpoint:** pending

#### Phase 2: Land the built fixes
**Status:** IN PROGRESS
**ACs:** AC-2, AC-3
**Files:** `src/render/world.ts`, `src/scenes/Midway.ts`, `src/render/*aircraft*.ts`,
`src/sim/tactics.ts`, `src/ui/bridge.ts`, `src/ui/main.tsx`, `src/style.css`; engine runtime
branch → a runtime binary passed through `THREENATIVE_RUNTIME_BINARY`.
**Verification:** E2: bench candidate vs stock (pipelines after start, UI uploads/s, pointer trace).
**Checkpoint:** pending; `prd-work-reviewer`

#### Phase 3: The levers the bench ranks
**Status:** NOT STARTED
**ACs:** AC-4
**Verification:** E3: 3 interleaved 120 s pairs per kept lever.
**Checkpoint:** pending

#### Phase 4: Gates and play
**Status:** NOT STARTED
**ACs:** AC-5, AC-6
**Verification:** E4: the AC-5 gate list once, then one owner play.
**Checkpoint:** pending
