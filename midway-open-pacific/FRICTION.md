# Engine friction

## 2026-09-14 — Preparation before presentation must preserve batching

The installed `Scene.render` callback runs after the ordinary draw, so it cannot prepare the current frame. Capability discovery found no matching before-presentation lifecycle hook.

The attempted particle mesh `onBeforeRender` optimization was rolled back: at the supported 68-aircraft roster it changes the engine's automatic scene projection from 144 batches to a `renderHook` decline. Putting packing on the source scene root is also unsafe because the projection mirror does not forward that hook. The engine owns this scheduling seam; the game must not bypass automatic projection to prepare buffers once per presented frame.

Midway's separate standard Three.js scene hook removes repeated world-transform walks when the authored scene is drawn. On projected frames the engine itself updates source transforms before projection. The hook restores the original flag and hook ownership on scene exit. A generic renderer-wide suppression was rejected because arbitrary transform-mutating callbacks in other games may depend on per-pass updates.

Evidence and acceptance: `docs/PRDs/PRD-midway-flak-hunt-20260914.md`; raw local probes: `/tmp/midway-flak-hunt/`.

## 2026-09-14 — Confirmed projection topology defect, and the seam that replaces the rollback

The reported long connected tracer lines were an engine defect, not the scheduling change:
`packages/core/src/projection-apply.ts` built every `isLine` proxy as a plain `Line`, so projected
`LineSegments`/`LineLoop` lost their primitive class and drew a continuous strip. The fix preserves
the specialized class before the generic branch; the projected tracer is now asserted `LineSegments`
in real browser frames. Upstream issue: https://github.com/ThreeNativeHQ/threenative/issues/248.

The correct once-per-draw boundary the game needed is now an engine seam, not a game workaround:
`ctx.beforeRender(callback)` registers scene-owned work that runs once per actual world render,
after the frame's last fixed update and before projection packs, and is cleared at scene change and
stop. Midway uses it to call `particles.prepare(camera)` instead of per-mesh `onBeforeRender` hooks,
so automatic projection stays engaged. Packing is now once per outer draw (prepare:writeBatch 1:2)
versus once per fixed update in the legacy path. No architecture rewrite: one registration site, the
existing step/emission code unchanged.


## 2026-09-19 — Two object spreads in the engine's flight step, 18x the step cost

`@threenative/core` built objects with spreads in the one path every aircraft runs every fixed
step, and a spread is not the same cost as a written-out literal: V8 cannot use the boilerplate it
gives a fixed literal, and goes through `CopyDataProperties` property by property.

1. `flightForces` returned `{ ...coeff, airspeed, alpha, … }` — built twice per aircraft per step.
2. `FlightModel.step`, `stepDeck` and `forces` each passed `{ ...this.environment, modifiers }` to
   the free functions, allocating a whole environment on every call.

Found by profiling the game rather than reading it. A V8 CPU profile of
`node scripts/check-ai-flight-cost.mjs` put **34% of all sampled CPU in `flightForces`** and, after
that was fixed, the **single hottest line of the entire fixed step was the spread inside
`FlightModel.stepDeck`** — above every line of the physics it feeds. GC was another 11% of the
first profile. Three cheaper explanations were measured and rejected: `Math.hypot` in the same hot
path is worth 1.09x here (unlike `ripple-field`, where the same substitution was 6.4x); an inlined
coefficient writer plus scratch vectors is worth 1.07x; and removing the remaining per-call
temporaries (the `coeff` record, the axis vectors) is worth 1.07x — none of them worth the public
surface or the duplication they would cost.

Engine harness, `scripts/check-flight-cost.ts`, 32 aircraft, 600 timed ticks, three runs a side:

| | mean step | p95 | `finalStateSha256` |
| --- | --- | --- | --- |
| as shipped | 0.805–0.824 ms | 1.95–2.15 ms | `bde0e51b5700123a…` |
| forces literal written out | 0.089–0.094 ms | 0.14–0.18 ms | `bde0e51b5700123a…` |
| + one step environment per model | 0.044–0.048 ms | 0.05–0.06 ms | `bde0e51b5700123a…` |

This game's own AC-23 CPU gate, `node scripts/check-ai-flight-cost.mjs`, 68 airborne:

| | mean at cap | p95 at 68 | verdict |
| --- | --- | --- | --- |
| before | 2.154 ms | 4.293 ms | FAIL, over the 4 ms ceiling |
| forces literal written out | 0.785–0.832 ms | 1.24–1.37 ms | PASS |
| + one step environment per model | 0.669–0.698 ms | 1.07–1.22 ms | PASS |

Red-green, both sides: the game's gate above fails before and passes after, and the engine's
`pnpm exec tsx scripts/check-flight-cost.ts --max-mean-ms 0.35` exits 1 (mean 0.8347 ms) before and
0 (mean 0.0848 ms, then 0.0448 ms) after. The `finalStateSha256` is identical at every step, so the
physics did not move — only the cost. `check-flight.mjs` still passes (six seeds, objective 987 s
recovered), and `pnpm exec vitest run packages/core/__tests__` is 1443 tests green.

Engine commits `b04b9d3a1` and `302780021`; this checkout is pinned to
`threenative-core-0.3.2-midway-8799d277e548.tgz`.

The environment record copies the options' own fields once, at construction. `airframe` and `wind`
are references and stay live, but replacing a field on the options object afterwards is no longer
observed — Midway already rebuilds its model when the airframe or the deck changes, so nothing here
does that.

## 2026-09-19 — The published native host is older than the package that ships it

`pnpm build:desktop` embeds `node_modules/@threenative/runtime-native/prebuilt/linux-x64/threenative-runtime`,
which the tarball does not contain: the install hook downloads it from the release. That published
asset answers `Mystral Native Runtime v0.3.0` while its own `install-status.json` says 0.3.2, and the
engine's doctor read that metadata and reported `✓ native runtime: available (linux-x64)`.

The result is a desktop binary that boots, plays and cannot be clicked: `boot` passes with 660
frames, while `launch`, `cockpit`, `ui` (web target equivalents all pass) and `native-select` all die
at `waitForResource state.ui.screens.flight` with `frames 0` — the injected pointer reaches a UI that
never composited. Rebuilt against a host at the engine's version, the same game bundle passes
`launch` (2011 frames), `cockpit` (1895) and `ui` (931) with zero diagnostics.

Engine side: doctor now runs the installed host's own `--version` and fails when the reported runtime
is older than the newest of the installed engine and runtime packages, when the host names no
version, or when what it names cannot be compared (`6571c4ed5`, spec covers all four shapes). On this
project that flips `✓ available (linux-x64)`, exit 0, to `✗ … the linux-x64 host reports runtime
v0.3.0, older than the installed engine 0.3.2`, exit 1 — and a host at 0.3.2 stays green.

Reproduce a good artifact with `THREENATIVE_RUNTIME_BINARY=<engine>/packages/runtime-native/build/tn-linux/mystral pnpm build:desktop`;
the runbook entry is in `docs/native-debugging-lessons.md`.

## 2026-09-19 — `perf` printed a frame rate the run could not vouch for

`threenative-playtest perf --executable` spawned the desktop host in whatever `DISPLAY` it inherited —
here the capture lock's private Xvfb — and printed the fps column anyway. On this build that column
read **1123.60** and **20000.00** fps, `frame p50 0.0 ms`, and a `--min-fps 55` bound **passed,
exit 0**. The same package's `trace` refuses to print a frame rate from a private Xvfb for a reason
it measured: without vsync the present wait lands inside the update phase, so the number is wrong
rather than missing (13.3 fps there against 57.7 on the real display, one build).

Engine side (`5ea4b9c76`): `perf --executable` now decides its display like every other lane, prints
no frame rate when the operator did not ask for the host display, says why, and refuses `--min-fps`
with `TN_PERF_VIRTUAL_DISPLAY` (exit 1). `--allow-virtual-display` accepts it explicitly.
`--max-frame-p95` is untouched, and `--file` / `--logcat` sources are unchanged, so the phase and
host-gap baselines this project quotes keep their meaning.

This checkout is pinned to `threenative-playtest-0.3.2-midway-40eb05c5c726.tgz`; on the same binary
the same command now prints `fps suppressed: … private-xvfb …` and `FAIL TN_PERF_VIRTUAL_DISPLAY`,
exit 1.

Follow-up (`c798bd21f`): `TN_FRAME_HITCH` turned out to carry **two different payloads under one
name** — the native host's 300-frame window, and core's own `{gapMs,uptimeMs,wallClock}` line for a
single present gap. The reader assumed the first, so this project's native launch log printed
`hitch windows (post-launch, 3): worst NaN ms` and blamed an older host for fields that were never in
the line, while discarding three real gaps of 2.1–3.0 s. Both series are now read as what they
measured; the same log reads `present gaps (3): worst 3000.140 ms at uptime 10178 ms`.

**And that log cannot print a frame rate at all.** The host's own counter —
`TN_PRESENTS_TICK:{"frames":1740,"presents":133,"capHz":60}` — says 7.6% of loop frames reached the
display, because the presentation cap paces the present and never the loop. Core's budget counts loop
iterations, so its `fps` is the loop's cadence: `perf --file <this log> --min-fps 55` used to print
2272.73 / 2631.58 / 1960.78 / 6666.67 and PASS. The reader now refuses that, quoting the host's
counts (`a85959e71`), and this checkout is pinned to
`threenative-playtest-0.3.2-midway-b7784c158a85.tgz`, verified against that log.

That reader also joins the host's own stall report (`TN_SLOW_PHASE`), so the same command says
what the gaps *were* — `imageDecodeDrain 2965.129 ms, animationFrames 473.653 ms` for the first,
`animationFrames 2040.518 ms` for the second — while refusing to name the `pollEvents` watcher that
merely brackets the iteration. This is PRD-394's launch story on the native target, from one command
instead of two greps. Commit `bc4cf759d`; this checkout is pinned to
`threenative-playtest-0.3.2-midway-caf9f195d53f.tgz`, verified against that log.
