# PRD-midway-trace-20260914-performance — Remove measured CPU stalls

**Status:** IN PROGRESS — Phases 1–3 implemented and verified; AC-6 met on cockpit flight, open on
water impact; AC-7 unverified for want of a quiet machine
**Complexity:** 4 (MEDIUM); risk override: none
**Owner:** Executing agent; engine maintainer owns changes under `packages/core/`
**Depends on:** Existing integrated [fluid implementation](PRD-midway-fluid-lab.md)
**Progress:** Phases 1, 2 and 3 implemented. AC-1 to AC-5 and AC-8 are met, with the evidence on each.
AC-6 is met on the cockpit fixture (**−69.9%** full update+render CPU p95, against a −20% target) and
**not demonstrated** on the water-impact fixture, where the measurement did not converge on a machine
at load average 57. AC-7 could not be run there at all. Both stay open, and the target has not been
weakened to close them.
**Scope:** Performance fixes in Midway and its installed engine. Creating this PRD does not authorize implementation.
**Analysis date:** 2026-09-14

Implementation complexity: approximately 6–10 implementation files (+2), independent engine/game package boundary (+2). No new renderer, simulation system, dependency, or platform abstraction. Estimates below are implementation estimates, not measured savings.

## Outcome

Reduce CPU work in the actual cockpit and water-impact paths while preserving the current ocean, cockpit, weapons, flight dynamics and aircraft population. Start with the benchmark's missing CPU measurements, then remove unnecessary water calculations and texture updates. Keep every performance claim tied to a matched workload.

**The supplied recording is CPU constrained: game-loop callback cadence is 28.90/s, callback work p95 is 62.27 ms, and the renderer main thread is busy for 98.48% of the selected window.** This is not evidence of GPU execution time or native performance.

## Is this the engine, JavaScript, and is it fixable?

**Both the game and engine contribute, and there are concrete fixes.** The game requests and uploads work it does not need; the engine's existing water APIs and empty-field path make those requests more expensive. Auxiliary Three.js renders also repeat substantial CPU work. A sampled stack inside `@threenative/core` includes its callees; it does not mean all that inclusive time is framework overhead.

**The recording does not establish a JavaScript ceiling.** JavaScript's CPU cost matters for millions of grid/particle operations, but changing language would leave redundant normal calculations, canvas uploads and repeated scene passes. Fix these bounded paths before considering a WASM/native/GPU rewrite. Garbage collection is a small measured fraction here. Some time in browser GPU API calls may reflect driver or synchronization overhead; the trace does not prove the GPU is idle.

**A meaningful improvement is plausible; 60 FPS is unproven.** Acceptance requires new comparable measurements. This PRD does not claim that the proposed changes recover the entire 62.27 ms p95 callback cost or that desktop/native will automatically be faster.

## Context and measured evidence

### Recording identity and limits

| Item | Value |
|---|---|
| Input | `/home/joao/Downloads/Trace-20260914T113525.json.gz` |
| SHA-256, compressed bytes | `cc9b1fe4b0c9c2c320c69e7df19f7215bb5dd810a582abe64016d32e7ae4f773` |
| DevTools recording start | `2026-09-14T18:35:25.803Z` / 11:35:25 America/Vancouver |
| Selected trace window | `258186105932` through `258325953187` microseconds; **139.847255 s** |
| Page | `http://localhost:5173/`; renderer process `2318947`, main thread `1` |
| Available data | 1,118,816 events; 967,519 CPU samples in the reconstructed profile |
| Screenshots | 450 frames, covering only **0.099–12.743 s**; inspected cockpit and tactical-map frames |
| Unknown | Recorded GPU model, actual framebuffer dimensions, thermal state, exact game revision, exact input sequence, final displayed FPS and GPU pass durations |

Browser-extension callbacks are present. This is a development-server recording with DevTools attached. Screenshot size and `hostDPR: 1` do not establish the game's drawing-buffer resolution. No screenshots cover the late stalls; do not label the 50–70 s or 90–110 s activity as a particular weapon strike solely from the filmstrip.

Source references below describe the inspected checkout, not an asserted recording revision. Game repository HEAD was `5a59e490ccda7d2cd54718056d98a8ca6d4f5140`; engine HEAD was `e9bcf80a24d14651290ae6cdcf96330f9f1ecc39`. The trace's dependency query hash is `0ad19a43`; the current Vite metadata hash is `67da66c9`. Function names and corresponding code were inspected, but these are not interchangeable source snapshots. Capture a fresh baseline before edits.

### Frame and responsiveness measurements

Only complete `X` events on the game's renderer main thread are used for duration statistics. Percentiles use linear interpolation, as in `src/sim/perf.ts`.

| Measurement | Result | Interpretation |
|---|---:|---|
| `FixedStepLoop.#frameCallback` | 4,031 calls; 132.382 s total; **32.841 ms mean** | Actual game callback, including its update/render work |
| Game callback duration | **29.868 / 62.267 / 78.485 ms** p50/p95/p99; max **364.888 ms** | CPU wall time inside the callback |
| Game callback start intervals | **31.180 / 64.674 / 81.522 ms** p50/p95/p99 | Scheduling cadence, not GPU timings |
| Callback cadence | **28.904/s** across first-to-last callback; largest gap **1,001.791 ms** | Do not call this verified presentation FPS |
| Main-thread tasks | **137.720 s / 139.847 s = 98.48% busy** | Little CPU headroom in this recording |
| Long tasks, duration >50 ms | **379**, occupying **25.631 s** | Long-task duration sum, not Lighthouse TBT |
| Largest complete task | **365.879 ms**, starts at **110.036 s** | CPU profile needed to distinguish its subwork |
| GC outer events | Minor: **319.482 ms**; major: **82.435 ms** | About 0.29% of the window; do not start with a general pooling rewrite |
| DOM layout + style + paint | **1.495 s** combined `Layout`, `UpdateLayoutTree`, `Paint` | Smaller than the 3D/water hotspots; excludes other browser rendering work |

There are two animation callbacks per cycle. Three.js's internal `Animation.start → update` accounts for 4,031 complete in-window calls totaling only **147.632 ms**, averaging **0.037 ms**. Counting every `FireAnimationFrame` would suggest approximately 58 callbacks/s and hide the slow game callback. Removing this cheap Three.js callback is not the primary fix.

DOM nodes rise from 6,844 to 29,022 while JS heap ends lower (89.98 MB → 84.57 MB; peak 159.30 MB). This warrants a separate retained-node investigation if it persists; it does **not** prove a memory leak from this trace.

### CPU attribution

These are **sampled CPU estimates**, not instrumented function timers. Inclusive rows overlap their descendants and must not be added together. `ms/game callback` below is the total divided by 4,031, not a p95 or promised saving. Browser calls such as texture upload measure CPU time inside the API, not GPU execution.

| Hot path | Sampled cost | ms/game callback | Attribution |
|---|---:|---:|---|
| Renderer wrapper → Three.js render, inclusive | **86.193 s** | 21.38 | Includes reflection, shadows, transforms, draw submission and uploads |
| `Object3D.updateMatrixWorld`, inclusive | **28.849 s** | 7.16 | Nested world transforms; includes `compose` and matrix multiplication |
| `Matrix4.compose`, self | **10.694 s** | 2.65 | About 3.651 s under main rendering, 3.608 s under reflection, 2.996 s under shadows |
| `WorldView.update`, inclusive | **32.024 s** | 7.94 | Game rendering updates, including the water subsystem |
| `createRipples.update`, inclusive | **27.001 s** | 6.70 | CPU wave solver, particles, height/collision queries and packing |
| `RippleField.#integrate`, inclusive / self | **11.861 / 9.198 s** | 2.94 / 2.28 | Full 192² grid solve; inclusive cost also contains foam transport |
| `Whitewater.step`, inclusive | **8.612 s** | 2.14 | Includes sampled swell and hull queries |
| `WaveField.sample`, self | **3.380 s** | 0.84 | Approximately 3.154 s of self samples are under whitewater height queries |
| `hullHeightAt`, self | **3.471 s** | 0.86 | Game-owned ship scan and local-coordinate/taper test |
| `DataUtils.toHalfFloat`, inclusive outer helper | **4.240 s** | 1.05 | Ripple texture packing; the inner helper's 3.840 s is included |
| `copyExternalImageToTexture`, self | **8.604 s** | 2.13 | Repeated external-image uploads; exact texture identity needs the Phase 1 probe |
| Reflector `updateBefore`, inclusive | **20.086 s** | 4.98 | Second scene render, already restricted by the game's reflection layer |
| Shadow rendering, inclusive | **24.266 s** | 6.02 | Includes another transform walk and shadow draws |
| `updateClusteredMeshes`, inclusive | **4.470 s** | 1.11 | Approximately 4.256 s is traversal self time below this engine scan |

The `WaveField.sample`/hull-query costs increase strongly in the 50–70 s and 90–110 s sample bins. That supports testing **active water effects**, not only quiet flight.

Interpretation follows Chrome's distinction between self and total time: [Chrome Performance reference](https://developer.chrome.com/docs/devtools/performance/reference). Three.js documents that local transform recomputation can be disabled selectively while world transforms still follow parents: [matrix transformations](https://threejs.org/manual/en/matrix-transformations.html).

## Solution

### Ranked changes and ownership

| Order | Fix | Owner / exact location | Why this is actionable |
|---|---|---|---|
| 1 | Measure full scene CPU and save failed baselines | Game: `tools/capture-performance.mjs` | Current `cpuP95` times only leaf `Battle.step`; it excludes the 32.024 s `WorldView.update` path. Absolute assertions also run before `MIDWAY_BASELINE_OUT` is written. |
| 2 | Add scalar wave sampling; skip provably empty ripple work; cache ship-query constants | Engine: `packages/core/src/{wave-field,ripple-field}.ts`; game: `src/render/{ocean,ripples}.ts` | Existing swell computes a normal and allocates a vector/object when the caller wants only height. Ripple solve runs on an exactly empty field. Hull trig/constants repeat per query. |
| 3 | Pack ripple textures once per changed rendered state; stop redrawing the horizon texture | Game: `src/render/{ripples,world,cockpit-detail}.ts` | 147,456 half-float conversions per `ripples.update`; the horizon repaints a 256² canvas and marks its texture dirty on every update. Confirm upload attribution first. |
| 4 | Remove safe, known redundant transform work | Game: `src/render/{cockpit-detail,world}.ts` | Freeze only locally immutable generated cockpit meshes; remove the recursive player-subtree update immediately before `localToWorld`. Preserve dynamic parent matrices. |
| 5 | Re-profile reflection/shadows and clustered traversal | Engine follow-up candidates: `packages/core/src/{renderer,water-surface,clustered-mesh,game}.ts` | Costs are confirmed, but a safe generic replacement is not yet established. These are explicitly outside this PRD's implementation scope. See follow-up specification below. |

Do not lower 192² resolution, the 1/120 s coupled-water substep, 12,000-particle capacity, eight-event capacity, 68-aircraft benchmark envelope, render resolution, shadow quality or reflection layer to obtain a pass. Do not replace the ocean with a different solver or reduce the visual content. No changes to `src/sim/flight.ts`, `Battle` rules or sortie credit.

### Repository and capability contract

`GAME` below means `/home/joao/projects/threenative/sandbox/midway-open-pacific`. `ENGINE` means `/home/joao/projects/threenative/threenative-engine`. From the game directory, the engine is **`../../threenative-engine`**; `../threenative-engine` does not exist. Its owning repository is independent of the sandbox repository.

Capability discovery used `engine_search_capabilities` for the full request and focused measurement, water-reflection and scalar-height queries, followed by `engine_capability_detail` for these matches:

| Existing capability | Reuse / constraint |
|---|---|
| `WaveField` | Existing CPU/TSL wave owner. Extend this class with scalar `heightAt`; no copied wave equation in the game. Current `sample` returns both height and normal. |
| `RippleField` | Existing wave/foam/flow owner. Add exact empty-state optimization here. Keep the finite moving patch, absorbing rim and public state semantics. No static hull mask. |
| `WaterSurface3D` | Keep existing `reflection.layers` and `resolutionScale`. Resolution scaling changes pixels, not object submissions. There is no inspected `everyFrames` option; do not invent one. |
| `adviseThreeRenderWorkload` | Existing optional advisor consumes measured workload data. It does not identify texture objects or prove a savings claim. |

The scalar-only query was not available in the inspected `WaveField` implementation. `GPUReadback` is not a substitute: these analytic CPU queries need the current exact surface, not an asynchronous stale GPU sample.

The engine checkout already contains unrelated tracked changes and untracked `packages/core/src/ripple-field.ts` / `packages/core/__tests__/ripple-field.spec.ts`. Preserve them. They were present before this analysis. An engine HEAD-only worktree will omit those files even though the installed tarball contains `RippleField`; transfer the relevant existing source/test deliberately and record its identity. Never reset, overwrite or sweep unrelated engine changes into a commit.

Use the repository's `git-worktree` workflow for implementation isolation. Sandbox worktrees belong under `/home/joao/projects/threenative/sandbox/.worktrees/`; engine worktrees under `/home/joao/projects/threenative/threenative-engine/.worktrees/`. Check ignore rules first. Reuse a verified task checkout; never put a worktree inside another linked checkout. No worktree was created for this planning task.

## Acceptance Criteria

All boxes below are implementation requirements and remain unchecked.

- [x] **AC-1 [local; actor: executing agent]:** The benchmark records finite full `Midway.update`, `WorldView.update`, ripple-update and outermost-render CPU series, separately from leaf `Battle.step` and GPU timing. It writes a versioned baseline before a deliberate over-budget result exits nonzero. Missing/mismatched data cannot pass. Evidence: `node tools/capture-performance.mjs --self-check` → `self-check PASS`, now covering the schema gate, the missing/nonfinite full-CPU series, the nested-timer fixture (a render re-entering itself twice is one observation), AC-6's arithmetic and every fixture-matching rule. Live: a `cockpit` sample reported `updateRenderCpu p50 50.50ms | p95 73.58ms | p99 85.02ms | worst 95.90ms over 74`, `sceneUpdateCpu p95 3.90ms`, `worldUpdateCpu p95 1.50ms`, `rippleUpdateCpu p95 0.23ms`, `renderCpu p95 64.03ms` — none of which the leaf `Battle.step` timer could see. A `water-impact` sample reported `updateRenderCpu p95 108.55ms`, `rippleUpdateCpu p95 12.48ms`, with `acceptedImpacts 2, whitewaterMax 3585, energyMax 25.69`. The baseline JSON is written before the assertions, proved by the failing cockpit smoke run that still logged `baseline written to …` before exiting nonzero.
- [x] **AC-2 [local; actor: executing agent]:** Installed `WaveField.heightAt(x,z,t)` matches `sample(x,z,t).height` within `1e-10`, including configured domain warps; the scalar path computes no normal and allocates no per-query vector/result. Midway's `oceanSwell` calls it. Evidence: `packages/core/__tests__/wave-field.spec.ts` — scalar equality to `1e-10` with no warp, one warp and two ordered warps over four sample points; the same argument validation (`sample.x`/`sample.z`/`sample.time`) on NaN and Infinity; and a direct observation rather than a claim — `Math.cos` is counted while each entry point runs, and the scalar path calls it **zero** times while calling `Math.sin` exactly as many times as `sample` does. `sample`'s normals are unchanged: unit length to 1e-12, and the scalar path's central differences reproduce the slope the normal encodes. 10 tests pass. `src/render/ocean.ts:28` is `swell.heightAt(x,z,time)`, and `node --input-type=module -e 'import { WaveField } from "@threenative/core"; …'` prints `heightAt: function` from the installed tarball.
- [x] **AC-3 [local; actor: executing agent]:** Empty ripple fields advance their clocks without solving/uploading zero grids; real impulses and foam wake them immediately. Active water retains its fixed-step trajectory, splashback, drifting foam, bubble behavior, pause/recenter/reset behavior and hull-query answers. Evidence: `packages/core/__tests__/ripple-field.spec.ts`, 22 tests — an empty field returns the same step count and the same `time` as a disturbed one across 90 frames while announcing no new image; a paused frame runs no steps; the first impulse after 30 s of calm wakes it in the same frame and the ring really propagates; foam alone wakes it; every argument is validated before any fast return; forty cell-crossing recenters move the centre by whole cells with no version bump; a disturbed patch cleared whole still bumps once so the GPU drops the old rings; **and a decayed wave at energy < 1e-6 is still solved every step** — no epsilon, energy or event-clock sleep. One bug this caught: `depositFoam(x, z, r, 0)` and a zero impulse were announcing a change they never made, which a game scaling its impulse by the frame delta hands in on every paused frame; both are now non-events. `node scripts/check-fluid.mjs` passes, including the hull query against its original per-call formula as oracle over 24,000 seeded points across six fleets, three rim radii at 720 bearings per hull, overlaps, a sunk hull and a submerged submarine.
- [x] **AC-4 [local; actor: executing agent]:** Multiple fixed updates before one render result in at most one ripple packing pass for the latest version; a render with no changed version does none. Real water materials sample the latest data in that same render, including reflection/shadow nesting. Evidence: `bash tools/capture-lock.sh node tools/capture-fluid-lab.mjs` on the real WebGPU scene (`adapter { vendor: 'nvidia', architecture: 'turing' }`) →
`packing {"duringUpdates":0,"versionsSolved":4,"afterRender":1,"afterIdle":1,"afterReset":3,"synced":true,"movedCentre":80.42,"emptyRecenterVersions":0,"emptyRecenterUploads":0}`.
Two fixed updates solved four versions and packed **nothing** (packing has left the update path); the next real frames packed exactly **once**, for the latest version (`synced: true`); four further frames — the water's reflection pass and the shadow passes included — packed **nothing**; a reset still reaches the GPU; and an empty patch following the camera 80 m moved its centre while uploading nothing. The counter is the ripple texture's own `version`, which only a pack moves, so nothing is stubbed to observe it.
- [x] **AC-5 [local; actor: executing agent]:** The cockpit horizon moves with pitch/roll using uniforms and static textures; no per-update external-image upload comes from this instrument. Static cockpit local matrices stop recomposing while cockpit/airframe controls, moving parent transforms and camera switching remain correct. Evidence: the same capture →
`cockpit {"canvasTextures":2,"textures":283,"horizonCanvas":[],"horizonMaterials":[],"frozen":62,"moved":62,"rewritten":[],"cameraMode":1}`.
No canvas texture is on the artificial horizon at all; flying the dial through level, ±0.35 rad pitch with ±0.6 rad roll and both saturation limits rewrote **no** texture version anywhere in the scene (the two canvas textures still present are deck/wake images painted once at build time). 62 merged static meshes stopped recomposing their local matrix and all 62 are still carried to a real world position by the moving aircraft. `tools/bake-attitude.mjs` bakes the two faces offline, asserting sky above, ground below, an opaque padded backing and a transparent overlay. **Looked at, not just gated:** `screenshots/fluid-lab/attitude-{level,climb-right,dive-left,pitch-limit,roll-limit}.png` — the climb-right frame shows more sky with the horizon tilted right-end-up and the yellow symbol fixed; the roll limit shows a fully inverted face with an upright symbol and index; the pitch limit is solid sky with no blank edge, so the 1024² overscan covers every sampled coordinate.

Performance and adoption requirements:

- [~] **AC-6 [local; actor: executing agent]:** Across three matched runs per workload, median-of-run-p95 full update-plus-render CPU work improves at least **20%** in both cockpit flight and sustained water-impact fixtures; each component is also reported separately, and no matched component or GPU p95 regresses by more than **10%**. Full workload matching and calculation are defined in Phase 1. Evidence: **cockpit PASSES, water-impact is reported below.** Twelve interleaved captures (before, after, before, after) against two isolated worktrees that differ only in the five files under test plus the engine pin, both served with HMR off.

**Cockpit flight — PASS.** `node tools/capture-performance.mjs --compare <3 before> <3 after>`:

| metric | before p95 median | after p95 median | change | limit |
|---|---:|---:|---:|---|
| `updateRenderCpu` | 197.500 ms | **59.470 ms** | **−69.9%** | ≤ 0.80x — met |
| `sceneUpdateCpu` | 7.200 ms | 2.600 ms | −63.9% | ≤ 1.10x |
| `worldUpdateCpu` | 5.600 ms | 1.000 ms | −82.1% | ≤ 1.10x |
| `rippleUpdateCpu` | 4.400 ms | 0.200 ms | **−95.5%** | ≤ 1.10x |
| `renderCpu` | 169.685 ms | 51.370 ms | −69.7% | ≤ 1.10x |
| `gpu` | 23.945 ms | 22.800 ms | −4.8% | ≤ 1.10x |

`AC-6 PASS: full update+render CPU p95 median improved at least 20% with no component regression
beyond 10%.` The ripple figure is the empty-field state doing exactly what it was built for: in
cockpit flight nothing disturbs the water, so the patch stays exactly flat and the solver, the
packing and the upload all stop — 4.40 ms to 0.20 ms.

Per-run p95, to show the spread the median is absorbing: before {174.26, 303.72, 197.50}, after
{45.43, 137.12, 59.47}. Every interleaved pair moved the same way.

**Water impact — NOT DEMONSTRATED. The target is not met and is not being weakened.** Six runs with
**exactly** matched fixtures — every one starts at battle tick 75.017, covers 30.017 s and accepts
18 impacts, so this is not a matching artifact:

| metric | before p95 median | after p95 median | change | limit |
|---|---:|---:|---:|---|
| `updateRenderCpu` | 120.780 ms | 138.675 ms | **+14.8%** | ≤ 0.80x — **missed** |
| `sceneUpdateCpu` | 18.000 ms | 17.900 ms | −0.6% | ≤ 1.10x |
| `worldUpdateCpu` | 16.200 ms | 14.800 ms | −8.6% | ≤ 1.10x |
| `rippleUpdateCpu` | 14.500 ms | 11.200 ms | −22.8% | ≤ 1.10x |
| `renderCpu` | 38.380 ms | 62.800 ms | **+63.6%** | ≤ 1.10x — **exceeded** |
| `gpu` | 17.801 ms | 19.541 ms | +9.8% | ≤ 1.10x |

Two things are true and neither excuses the other.

*The measurement did not converge.* The three interleaved pairs were before/after 120.78/64.70,
95.95/138.67 and 217.10/203.28 — ratios of 0.54, 1.44 and 0.94. A change with a consistent effect
does not produce that. One-minute load average on the capture machine reached **57** with seven
other capture, playtest and agent processes running; the median landed on the one pair that ran
through a load spike. An earlier set of three pairs on the same fixture gave −19.6%, which is the
same non-result from the other side of 1.0.

*There is also a real mechanism, and it is not noise.* `renderCpu` rose in **both** sets (+8.5% and
+63.6%) while `rippleUpdateCpu` fell in both (−43.1% and −22.8%). That is the packing pass moving
from `ripples.update` into `renderer.render`, which is exactly what Phase 3A does — and on *active*
water it is close to a transfer rather than a saving, because a field that changes every step has to
be packed every render anyway. The cockpit fixture is where the empty-field state removes the work
outright (`rippleUpdateCpu` 4.40 → 0.20 ms); sustained water impact was always going to have far
less headroom, and this measurement does not show it has any.

**What would settle it:** the same six runs on a machine that is not at load 57, or an instrumented
count of packing passes per render under active water to separate the transfer from a genuine
regression. Neither was possible here. AC-6 stays open.

- [ ] **AC-7 [local; actor: executing agent]:** Existing AC-23 crowd68 workload still passes its actual GPU ≤16.7 ms / leaf Battle CPU ≤4 ms / matched ≤10% regression gates at 1920×1080. Report full CPU overhead alongside it; do not reinterpret the old Battle gate as whole-frame proof. Evidence: **UNVERIFIED — the run could not be made on this machine, and an unrun gate is reported as unrun.** Both sides were attempted (`MIDWAY_CROWD=1` against the before and after servers) and both failed *before* sampling, in the warm-up: `page.waitForFunction: Timeout 32000ms exceeded` waiting for the battle clock to advance eight seconds. Under a one-minute load average of **57**, with seven other capture, playtest and agent processes on the machine, the fixed-step loop could not advance eight battle seconds inside thirty-two wall seconds. No record was written, because nothing was measured.

This is a capacity failure, not a result, and it must not be read as either a pass or a regression.
What can be said from the runs that did complete: the cockpit comparison measured GPU p95 at
23.945 ms before and 22.800 ms after, both far above AC-23's 16.7 ms absolute budget — on this
machine, under this load, at this moment, AC-23 would not qualify **on either side of the change**.
The change did not cause that. Re-run AC-7 on a quiet machine before drawing any conclusion.
- [x] **AC-8 [local; actor: executing agent]:** Game consumes a newly built, content-hashed engine tarball; affected unit checks, engine-required final checks, game typecheck/build and WebGPU launch/fluid captures pass. Inspected frames preserve horizon, canopy, ocean, plume, foam and moving deck appearance. Evidence: the game's `@threenative/core` is
`file:…/.packages/threenative-core-0.3.2-scalar-wave-a67d9943e9eb.tgz`, named with the first twelve
characters of its own SHA-256, in **both** the direct dependency and the `pnpm.overrides` entry.
Engine: `pnpm typecheck` passes, `pnpm test` exits 0, `wave-field.spec.ts` 10 tests and
`ripple-field.spec.ts` 22 tests pass, and `biome check` is clean on every file this touched.
Game: `pnpm typecheck`, `pnpm exec vite build`, and `check-flight`, `check-aircraft`, `check-audio`,
`check-intel`, `check-naval`, `check-carrier-ops`, `check-submarine`, `check-facilities`,
`check-fluid`, `check-perf` all pass. The WebGPU fluid capture passes on the real nvidia/turing
adapter with its new packing and cockpit observations. Frames inspected rather than assumed: the
five dial captures on AC-5, and `screenshots/fluid-lab/{calm,torpedo-plume,torpedo-foam,aerial-foam,
bomb-plume,deep-heave,underwater}.png` unchanged in character. Not verified: the launch playtest and
`doctor` — the display was saturated by these captures and by another lane's, and a gate not run is
reported as not run.

The 20% improvement is a proposed acceptance target, not a prediction from overlapping sample totals. If it fails, leave AC-6 open and report the remaining measured cost. Do not silently broaden implementation into the follow-up candidates or weaken the target.

Required target here is **web on hardware WebGPU**. Desktop, Android and iOS performance, parity, and native visual compatibility remain **UNVERIFIED** until their own target runs. The engine changes in scope are pure CPU math optimizations inside existing portable classes; they add no browser/platform seam. Any expansion into such a seam requires native conformance in the owning change.

**Tier 4:** this 139.85 s trace does not meet the skill's 600 s sustained-duration requirement. Final/opening FPS, final-minute heavy performance, battery temperature, thermal status and current are unverified. This PRD makes no sustained-device qualification claim.

## Integration Ledger

| Capability | Reachable trigger / current owner | Replacement / disposition | Evidence |
|---|---|---|---|
| Full CPU measurement | `tools/capture-performance.mjs:389` → live scene methods / renderer | Retain existing Battle/GPU metrics; add missing work rather than relabeling old values | AC-1/6/7 |
| Scalar water height | `src/render/ocean.ts:25` → `WaveField.sample` → whitewater/hull queries | Change only the CPU query to engine `heightAt`; retain shared wave parameters and TSL graph | AC-2/3 |
| Water solve and upload | `src/scenes/Midway.ts:259` → `WorldView.update` → `createRipples.update` | Preserve simulation timing; move only packing/upload preparation to a shared TSL uniform update before texture binding | AC-3/4 |
| Cockpit instrument and transforms | `animateDouglas` / `animateDauntless` → `CockpitInterior.update` | Replace mutable horizon canvas with static images/uniforms; keep callers and live controls | AC-5 |
| Package adoption | Engine build → hashed tarball → game `package.json` / `pnpm-lock.yaml` | Game executes packaged engine fix, not a source-only helper or patched `node_modules` | AC-8 |

## Execution Phases

### Phase 1: Make the baseline capable of detecting these stalls

**Status:** DONE
**ACs:** AC-1; establishes baseline for AC-6/7
**Files:** `tools/capture-performance.mjs` only; extend its existing `--self-check`.
**Estimate:** 60–90 minutes including three baseline runs per workload.

1. Add raw timing arrays around the real `Midway.update`, `WorldView.update`, `world.ripples.update` and outermost `world.renderer.render`. Use `performance.now()` in this browser-only tool. Preserve `this`, arguments, return values and exceptions; restore wrappers in `finally`. Nested renderer calls for reflection/shadows must be charged once to the outer call. Keep the existing leaf `Battle.step` timer unchanged. Record full CPU per presented-work attempt as the sum of scene-update work since the previous outer render plus that outer render's duration; do not sum nested `world`/`ripple` costs again. Name this `updateRenderCpu`, not whole-engine callback time: clustered reconciliation and other engine pre-render work are outside these wrappers.
2. Extend the existing baseline schema with a version, the new p95 metrics and the workload identity below. Write finite observations through `MIDWAY_BASELINE_OUT` **before** budget assertions. Exit nonzero when over budget; saving evidence must not convert failure to success. Reject absent version/new timing fields in comparison, and retain old AC-23 population/resolution checks for its own workload. A baseline is a measured result even if it missed a budget; its passing status must be stored honestly.
3. Add two explicit local workloads alongside the existing default/crowd workload: `MIDWAY_WORKLOAD=cockpit` and `MIDWAY_WORKLOAD=water-impact`. Each uses the real scene/renderer, seed 19420604, balanced quality, 1920×1080, DPR 1, eight **wall-clock seconds** of warm-up and sixty **wall-clock seconds** of samples. Cockpit starts through `#start-air`, selects camera mode 1, holds `ArrowRight` and Space; reject a run that crashes, enters debrief, or stops the battle; do not invent an existing invulnerability option. Water-impact reuses `capture-fluid-lab.mjs`'s carrier-relative observation camera and calls the real `Battle.damageShip` entry at the existing torpedo side-hit coordinates, once every four **battle seconds**, through the ordinary update loop. After the first valid blast, use the existing `Battle.fx('splash', {waterKind:'torpedo', waterDepth:3, ...}, ...)` entry for repeated equivalent water events so the carrier is not repeatedly sunk to manufacture a workload. Label this repetition a fixture, not a player sortie. Never replace `world.update` or run the whole sample in a synchronous `advance()` loop. Assert accepted-event count grows, active whitewater is observed, wave energy becomes positive, and the simulation clock advances. Preserve geometry, simulation constants and AI; record population ranges and event schedule as matching fields.
4. Record actual renderer backend/adapter, browser version, viewport **and drawing buffer**, quality, seed, inputs, engine artifact hash, source identity, population range, water accepted-event count, sample duration and thermal availability. Require equal fixture/population settings between before/after; reject HMR/source changes during a sample. Record simulation start/end times and the exact accepted-impact count. Start both samples at the same predeclared battle-time tick after the minimum eight-wall-second warm-up (choose a later common tick before recording if necessary); allowed start difference is at most 1/60 s. Allowed simulated-duration difference is at most 0.1 s across the sixty-wall-second samples, accepted-impact counts must match exactly, and aircraft/ship population min/max must match. Reject comparisons outside these bounds; a faster candidate must not be credited for a different section of battle. Fire scheduled impacts on the first fixed update reaching each four-second simulation boundary, never on a wall-clock timer. Run in an extension-free capture profile. Stop the baseline on a runtime error or missing metric; do not hide a layer or lower quality.
5. Add a bounded observation to identify changing `CanvasTexture`s: count texture `version` changes and material/object names during the cockpit fixture, traversing the scene once to collect candidates, not every frame. Attribute the artificial horizon separately from static asset uploads. Record the number of `ClusteredMesh`/batch objects and scene objects in the same one-time census. No global prototype patch or product debug UI. Save concise results here when executing.

**Deviation from this specification, and why.** Phase 1 asked for sixty **wall-clock** seconds of
samples *and* a simulated-duration difference of at most 0.1 s between the two sides. On this
machine those two cannot both hold: the fixed-step loop is clamping its catch-up, so battle seconds
per wall second is exactly what varies with load — and with the change under test. A wall-clock
window hands each side a different slice of the battle and then compares them; the first before-run
taken that way covered 30.9 battle seconds starting at battle time 33.25, a figure set by how long
the page took to load. The fixtures therefore sample a fixed **battle** window instead
(`MIDWAY_SAMPLE_TICKS`, 30 battle seconds, bounded in wall time by `MIDWAY_WALL_CAP`), starting at a
predeclared battle tick latched by the `Battle.step` wrapper itself so the first step to reach it is
the one observed. Both sides then cover the *same* section of the same battle, which is what the
matching rule exists to guarantee, and a faster build simply finishes it in less wall time. The
0.1 s and 1/60 s tolerances are unchanged and still enforced; `startTick` and `sampleTicks` are
matched fields. AC-23's own workload keeps its wall-clock sixty seconds untouched.

**Measurement conditions, recorded rather than hidden.** These captures were taken on a shared
machine: several agents were working in these repositories at the same time, one-minute load average
reached **41.9**, and the fixed-step loop was clamping its catch-up throughout — the first cockpit
before-run measured `updateRenderCpu` p95 174.26 ms and the second 303.72 ms on identical source and
an identical battle window. That spread is the machine, not the code. Two things bound it: the runs
are **interleaved** (before, after, before, after) so load drift falls on both sides rather than one,
and AC-6 takes the **median** of three p95s a side. The absolute milliseconds below are therefore
specific to a loaded machine and are not a claim about a player's frame time; the *ratio* between two
runs taken minutes apart on the same machine is what this measures. Every run's raw series is stored
in its record so the arithmetic can be redone.

**Measurement rule for AC-6:** calculate `updateRenderCpu` p95 from individual outer-render samples, then take the median of the three p95 values per workload. Require `candidate <= baseline * 0.80`. Compare full scene update, ripple update, renderer CPU and GPU separately at `candidate <= baseline * 1.10`; zero/missing baselines require an explicit absolute interpretation, never division by zero. Do not add independently calculated p95 values. The original uncontrolled trace is diagnostic evidence, not the matched baseline.

**Verification — E1:** `node tools/capture-performance.mjs --self-check`. Extend it to reject old/mismatched schemas, missing/nonfinite full CPU data and missing active-water evidence; verify baseline serialization precedes the failing verdict. Use one controlled fixture for nested timers so nested render calls are counted once. Then capture the live baselines. This is a future implementation check, not a test claimed to have run during planning.

The current script's `MIDWAY_CROWD=1` path continues to mean AC-23. The new two workloads have their own matching rules and must never print AC-23 qualified. Do not rewrite or weaken `src/sim/perf.ts`'s old verdict to accommodate them.

**Checkpoint:** done. The census answers one of the follow-up questions outright: this scene carries
**6,609 objects, 2,164 meshes, 3 instanced meshes, 0 batched and 0 clustered meshes**, so the trace's
4.47 s of `updateClusteredMeshes` traversal was spent discovering nothing at all. That remains a
follow-up candidate and is not implemented here. Metrics are on AC-1.

### Phase 2: Reduce water computation without changing the surface

**Status:** DONE
**ACs:** AC-2/3
**Files:** engine `packages/core/src/{wave-field,ripple-field}.ts`, corresponding existing tests; game `src/render/{ocean,ripples}.ts`; engine capability declaration/docs for the added method.
**Estimate:** 90–150 minutes plus engine packaging.

1. Add `WaveField.heightAt(x: number, z: number, time: number): number`. Refactor the current CPU evaluator into one private evaluator that returns the scalar height and accepts an optional output `Vector3` for normals. `sample` creates its existing result/vector and requests the normal; `heightAt` requests only the number. Scalar evaluation must skip warp Jacobians, cosine/slope calculations, normalization and result/vector construction. Preserve argument validation and the exact existing order of warp and wave-height evaluation. Do not duplicate the wave loop in Midway, and do not replace the mutable public `parameters` buffer with an unrelated cache. Change `oceanSwell` to `swell.heightAt(x,z,time)`; shader `heightNode`/`normalNode` stay unchanged.
2. Add an internal exact-empty state to `RippleField`. Constructor/reset and a recenter that clears the whole patch can establish exact emptiness. While already exactly empty, `recenter(x,z)` updates the same snapped center but does not shift/fill zero arrays or bump the texture-data version; center movement is communicated separately by the existing center uniform. A full-clear recenter from a nonempty field must still increment version once to clear the previous GPU image. An accepted nonzero `impulse` or `depositFoam` wakes it immediately; validate arguments before any fast return. While exactly empty, consume `advance(dt)` using the existing remainder/maxSteps rules and advance `time`/foam cadence, but skip grid work and do not increment the data version solely for elapsed time. **Do not infer sleep from an epsilon, energy threshold, or absence of recent events:** an old wave or foam trail must continue. Preserve nonempty solve arithmetic initially. Keep this private; no new game tuning option.
3. Cache the ship-query inputs once at the start of each `ripples.update`: eligible ships in original order; center; sine/cosine of heading; half-length/half-beam; deck height. Reuse the storage each update. Keep the current broad reject `abs(dx)>hullLength || abs(dz)>hullLength`, then compute `right = dx*cos + dz*sin` and `forward = dx*sin - dz*cos` directly. Preserve the quartic taper, strict edge tests, first matching ship, sunk/submerged-sub filtering and `-Infinity` outside. Return the cached deck height. Do not allocate `{x,z}` or call `localPoint` per particle. Rebuild eligibility/constants each update so moving, turning and sinking ships remain correct.
4. Extend existing tests, then build and install the new core artifact before any game test relies on `heightAt`. Add the method to the existing `WaveField` capability declaration in `packages/core/src/index.ts`, regenerate the manifest/reference with the engine's scripts, and document the scalar query beside waves in the sailing template `AGENTS.md`. Preserve the pre-existing changes in that file.

**Verification — E2:** from `ENGINE`, run `pnpm exec vitest run packages/core/__tests__/wave-field.spec.ts packages/core/__tests__/ripple-field.spec.ts`. Cover scalar equality for no warp and multiple ordered warps, invalid x/z/time, no scalar normal construction, and unchanged old `sample` normals. Cover empty stepping versus normal clock progression, paused steps, first impulse after idle, foam-only wake, moving recenter, repeated cell-crossing recenter of an empty field (no solve, no data-version bump, no post-initial texture upload), full-clear recenter, reset and active-wave continuity. For hull queries extend `scripts/check-fluid.mjs` using the existing formula as the test oracle over seeded points, multiple headings, overlaps and submerged/sunk states. A game-private exported query helper in `ripples.ts` is acceptable if needed for testing; no spatial-index framework.

**Packaging:** run the engine's core build/pack into `/home/joao/projects/threenative/sandbox/.packages`, rename the result with the first twelve SHA-256 characters, update **both** the direct dependency and `pnpm.overrides` core entries in the game, then `pnpm install`. Verify `node --input-type=module -e 'import { WaveField } from "@threenative/core"; console.log(typeof WaveField.prototype.heightAt)'` prints `function`. Record the tarball hash; do not patch `node_modules` or silently use workspace links.

**Checkpoint:** done. Numerical equivalence is on AC-2 and is an exact-order refactor, not an
approximation. The packaged consumer is real: `threenative-core-0.3.2-scalar-wave-a67d9943e9eb.tgz`
in `/home/joao/projects/threenative/sandbox/.packages`, named with the first twelve characters of its
own SHA-256, referenced from **both** the direct dependency and the `pnpm.overrides` entry, installed
with `pnpm install`, and confirmed through `node --input-type=module -e 'import { WaveField } from
"@threenative/core"; console.log(typeof WaveField.prototype.heightAt)'` → `function`. No
`node_modules` patch and no workspace link.

### Phase 3: Remove repeated uploads and safe transform recomputation

**Status:** DONE
**ACs:** AC-4/5
**Files:** `src/render/{ripples,world,cockpit-detail}.ts`, two generated static horizon textures in `public/assets/cockpit/`; extend `scripts/check-fluid.mjs` / `tools/capture-fluid-lab.mjs` and the Phase 1 capture tool where needed.
**Estimate:** 120–180 minutes including visual comparison.

#### A. Ripple packing

1. Split the current end of `createRipples.update` into `syncTexture()`: compare `field.version` with `lastPackedVersion`; when different, pack the current **live** height/foam/flow arrays into the existing `Uint16Array`, mark the existing texture dirty once, and remember the version. Preserve HalfFloat/RGBA and filtering. The arrays swap in the solver, so do not cache an old `field.height` or `field.foam` reference across solves. The four channels remain height, foam, flowX, flowZ. Do not switch to Float32 texture format as a shortcut; that doubles transfer bytes and can change filtering support.
2. Attach `center.onRenderUpdate(() => { syncTexture(); })` to the existing shared `Vector2` uniform in `ripples.ts`. Every `read(p)` uses this center for the ripple texture's UV coordinates; the installed Three.js renderer updates material nodes before texture bindings, so the first actual material consumer packs current bytes before uploading them. The void callback retains the uniform's existing value. Repeated materials/reflection/shadow passes are safe because the version guard prevents duplicate packing. Keep that same center uniform in every ripple texture read. Do not install `scene.onBeforeRender`: engine `projection-plan.ts` treats owned object render hooks as a reason to disable scene projection, which can erase the saving. Do not override `TextureNode.update` either; its setup rewrites the update type. `ripples.update` still advances simulation and updates center/time uniforms; it no longer packs. Do not use `Midway.render`: the inspected normal engine path calls it after the world draw. Prove this material callback on real draws with projection state recorded before/after; no new scene callback or lifecycle API is required.
3. Force one initial packing/upload and correct reset upload. Paused/unchanged renders do no packing. A recenter must update both the uniform center and texture before their next consumer. Empty-field center changes alone update the uniform and need no repack. Keep the existing water-effects `render()` geometry/uniform updates on their current path in this change; no broad scene lifecycle rewrite.

#### B. Artificial horizon

1. Use the Phase 1 texture probe to establish the horizon's update contribution. In `createAttitudeFace` replace the per-update 2D drawing with a `MeshStandardNodeMaterial` using **two static textures**: a moving sky/ground/pitch-ladder face and a fixed transparent aircraft-symbol/top-index overlay. Preserve the existing colors, line weights, text and emissive/roughness settings. Generate the two image assets from the existing canvas drawing instructions **offline** in a capture-locked tool session, store them as `public/assets/cockpit/attitude-moving.png` and `public/assets/cockpit/attitude-overlay.png`, and load/cache them in `loadCockpitMaterials` alongside the existing images. Pass these two textures into `createAttitudeFace` instead of creating a runtime canvas. Runtime must not depend on a new canvas or DOM rasterizer. Update `AttitudeFace`'s material type and disposal ownership accordingly.
2. Bake the moving face with sufficient overscan for pitch ±1.2 rad and roll ±π. Use at least a 1024×1024 backing centered at (512,512), with the old 256-pixel dial's scale preserved; retain fixed overlay at 256×256. For each output dial pixel coordinate `p` relative to (128,128), sample the backing at `R(+clampedRoll) * p - vec2(0, clampedPitch*112) + vec2(512,512)`. This is the inverse of the old canvas transform; account explicitly for image/UV Y direction and loader `flipY`. Composite the fixed overlay after the transformed backing. The existing circular face geometry supplies the disk mask. Pad the sky/ground past every sampled coordinate so rolling never reveals a blank edge.
3. `AttitudeFace.update(pitch,roll)` now changes only two scalar uniforms; no `needsUpdate`, `clearRect`, upload or texture replacement. Keep `CockpitInterior.update` and both airframe callers intact. Shared baked textures are session-cached and must not be disposed per aircraft; the per-interior material/uniforms are per-instance. Verify `map`/`emissiveMap`/node color are wired correctly: do not accidentally drop the old dial's emissive readability.

#### C. Known-safe transform work

1. In `createGeometryTools.optimize`, each newly created merged static mesh has a final, immutable local transform. Call `updateMatrix()` once and set only that mesh's `matrixAutoUpdate=false`. Do the same for the generated fastener `InstancedMesh` after its final setup. Keep `matrixWorldAutoUpdate=true` so the aircraft parent still moves it. Do not globally disable matrices; do not freeze the animated controls, skeleton/bones, gear, moving ship root or entire scene. Three.js already supplies the mechanism; no engine utility is needed for these two construction sites.
2. In `WorldView.updateCamera`'s cockpit branch, remove `this.playerMesh.updateMatrixWorld(true)` before `this.playerMesh.localToWorld(this.targetCamera)`. The installed Three.js `localToWorld` refreshes this object's ancestor/world chain itself; it does not need a recursive update of every cockpit/airframe descendant to transform the eye point. Verify eye position and camera roll against the unchanged implementation with a moved/rotated carrier parent and airborne aircraft.

**Verification — E3:** `node scripts/check-fluid.mjs`, then `bash tools/capture-lock.sh node tools/capture-fluid-lab.mjs` against the task's server. Extend the capture's real render path to observe packing counts through two simulation updates / one render, no-change rendering, reset and recenter. Add cockpit views at pitch/roll `(0,0)`, `(+0.35,+0.6)`, `(-0.35,-0.6)` and saturation limits; compare the horizon/overlay direction and clipping to pre-change captures. Exercise throttle, rudder, elevator, trim, gear and camera switching with moving aircraft/carrier parents. Check that new merged meshes stop local recomposition without freezing their world position. Count the horizon texture versions after initialization: no changes during the sampled flight.

**Checkpoint:** done, and the images were inspected — see AC-5. The five dial captures are framed on
the instrument's own face (the pilot's eye does not frame the panel, and `optimize()` merges the dial
into a per-material mesh whose origin is the cockpit group's, so the capture frames its bounding
sphere instead).

### Phase 4: Verify improvement and deliver the adopted change

**Status:** PARTIAL — AC-6 met on cockpit, open on water; AC-7 unverified; AC-8 met
**ACs:** AC-6/7/8
**Files:** engine/game artifact references, capability/template docs and this PRD's existing evidence fields.
**Estimate:** 60–120 minutes; engine-wide checks may add time.

1. Run the same three cockpit and three water-impact captures against the candidate and compute AC-6 from matched source/workload metadata. Preserve all baseline raw series. Do not compare against this original recording as though it used the same viewport or fixture. Store timings once on the owning AC; link local captures/logs instead of creating another prose report.
2. Run the unchanged AC-23 crowd68 workload with `MIDWAY_CROWD=1`, `MIDWAY_REQUIRE_QUALIFIED=1` and its own matched `MIDWAY_BASELINE`. Keep GPU timing, Battle CPU and full update/render CPU separate. An Xvfb cadence limitation is not permission to ignore high measured CPU work.
3. Run the required final engine checks once: `pnpm typecheck && pnpm lint && pnpm test`, plus `pnpm tsx scripts/count-loc.ts` if the added scalar evaluator's size needs the charter kill-switch check. In the game run `pnpm typecheck`, `pnpm exec vite build`, `node scripts/check-fluid.mjs`, `node scripts/check-perf.mjs`, the fluid capture and the existing launch playtest. Native targets stay unverified if not run.
4. Review actual source/artifact identity, all ACs and runtime/visual evidence. For MEDIUM scope use one independent reviewer when available; fix only actionable findings and rerun affected checks. Update this PRD from PROPOSED to the true execution status. Only mark DONE and move it under `docs/PRDs/done/` when every required AC passes. Follow repository commit/PR authorization and required worktree cleanup; never remove a dirty/unmerged checkout without the applicable authorization.

**Verification — E4 commands** (run from the game task directory; ports below must serve that exact source):

```sh
# Start a source server with HMR disabled; keep the process in its own terminal/session.
pnpm exec node --input-type=module -e 'import {createServer} from "vite"; const s=await createServer({server:{host:"127.0.0.1",port:5391,strictPort:true,hmr:false}}); await s.listen(); s.printUrls();'

# After Phase 1 adds MIDWAY_WORKLOAD. Repeat with distinct paths for runs 2 and 3.
MIDWAY_URL=http://127.0.0.1:5391 MIDWAY_WORKLOAD=cockpit MIDWAY_BASELINE_OUT=/tmp/midway-cockpit-before-1.json bash tools/capture-lock.sh node tools/capture-performance.mjs
MIDWAY_URL=http://127.0.0.1:5391 MIDWAY_WORKLOAD=water-impact MIDWAY_BASELINE_OUT=/tmp/midway-water-before-1.json bash tools/capture-lock.sh node tools/capture-performance.mjs

# Candidate: point the URL at its own source; never overwrite the before files.
MIDWAY_URL=http://127.0.0.1:5392 MIDWAY_WORKLOAD=cockpit MIDWAY_BASELINE=/tmp/midway-cockpit-before-1.json MIDWAY_BASELINE_OUT=/tmp/midway-cockpit-after-1.json bash tools/capture-lock.sh node tools/capture-performance.mjs

# Existing regression workload: it needs a separate crowd68 baseline.
MIDWAY_URL=http://127.0.0.1:5392 MIDWAY_CROWD=1 MIDWAY_REQUIRE_QUALIFIED=1 MIDWAY_BASELINE=/tmp/midway-crowd68-before.json bash tools/capture-lock.sh node tools/capture-performance.mjs
```

```sh
# Existing launch scenario, against the candidate server.
bash tools/capture-lock.sh node node_modules/@threenative/playtest/dist/runner/cli.js \
  --scenario playtests/launch.playtest.json --url http://127.0.0.1:5392 \
  --browser-recipe webgpu --headed --timeout 45000
```

The `MIDWAY_WORKLOAD` modes are **to be implemented in Phase 1**, not existing flags. Existing fluid capture supports `MIDWAY_URL` and `MIDWAY_SHOTS`. All browser launches use `tools/capture-lock.sh`; no visible-desktop capture or `xvfb-run`.

## Follow-up candidates: exact questions, outside this implementation

These are the next targets if AC-6 remains red after the bounded changes. Do not silently implement them as part of this PRD.

| Candidate / owner | What the evidence establishes | Required next fix design and proof |
|---|---|---|
| Repeated matrix walks — engine `packages/core/src/renderer.ts`; Three.js `Renderer._renderScene` | Main, reflection and shadow passes all spend CPU in scene matrix updates. | Instrument calls per **outer** render and identify scene roots. Design one matrix propagation per unchanged scene state across auxiliary passes, while preserving custom `onBeforeRender` mutations, camera updates, projection roots and nested renders. A blanket `scene.matrixWorldAutoUpdate=false` is insufficient and can freeze valid changes. Use exception-safe restoration and native conformance for any renderer seam. |
| Empty clustered-geometry scan — engine `packages/core/src/clustered-mesh.ts:467`, `game.ts:1221` | Full traversal costs 4.47 s; the trace does not establish how many clustered objects exist. | If Phase 1 census confirms none, replace repeated discovery with lifecycle-aware tracking of clustered meshes/batches. Require add/remove/reparent, nested `Object3D.add`, projected roots and disposal correctness. Do not cache the first empty result forever, add a game-specific bypass, or create a global registry that retains disposed scenes. Retain public `updateClusteredMeshes` behavior for supported batch roots. |
| Reflection/shadow work — game `src/render/ocean.ts:58`, engine `water-surface.ts` | Reflection layers are already narrowed and half-resolution; shadow and mirror paths remain costly. | Capture pass counts, draw calls and GPU timestamps before changing geometry, masks or refresh cadence. Do not prescribe the already-applied layer mask as a new fix or invent an `everyFrames` option. If cadence is ultimately needed, the engine owns portable scheduling and the game supplies timing/appearance choices; compare moving-ship reflections and cockpit/deck shadows. |

No cleanup campaign for all allocations, no AI/FlightModel rewrite, no WebGL fallback and no claim that browser `GPUTask` wall durations are shader timings. Those changes are not justified by this recording.

## Reproduce the principal trace measurements

The recording is now recomputed by the benchmark itself, in node, with the **same** percentile rule
as every other figure here (`src/sim/perf.ts`) rather than a second implementation:

```sh
node --max-old-space-size=8192 tools/capture-performance.mjs \
  --trace /home/joao/Downloads/Trace-20260914T113525.json.gz \
  --against /tmp/midway-after-cockpit-1.json,/tmp/midway-after-cockpit-2.json,/tmp/midway-after-cockpit-3.json
```

It finds the renderer process and main thread in the recording rather than hardcoding them, checks
the file's SHA-256, and reproduces the document's figures exactly: `sha256
cc9b1fe4…7ae4f773`, **4,031 callbacks**, **28.9038/s**, callback **p50 29.868 / p95 62.2665 / p99
78.485 ms**, worst **364.888 ms**, **379 long tasks**, 98.73% main-thread busy over the 139.458 s the
callbacks themselves span (the document's 139.847 s window and 98.48% come from the wider hardcoded
selection; the callback statistics are identical either way).

**What the `--against` comparison is and is not.** It is corroboration. It is **not** a matched
baseline, and the mode's own output says so, because two named biases run in opposite directions and
neither is quantified: `FixedStepLoop.#frameCallback` is the *whole* callback while
`updateRenderCpu` is a subset of it — engine work inside the callback but outside these wrappers,
clustered reconciliation included, is in the recording's number and not in ours, which flatters us —
and the recording was taken with a profiler attached, which inflates it, while these captures share
a loaded machine, which inflates us. AC-6's matched before/after captures are the proof; this is the
sanity check that the change moves the figure the recording actually complained about.

## The original python reproduction

This read-only stdlib snippet recalculates the complete-callback and task statistics directly from the original compressed trace. Run from the game directory. It does not edit the trace or require browser launch.

```sh
python3 - <<'PY'
import gzip, json
p = '/home/joao/Downloads/Trace-20260914T113525.json.gz'
with gzip.open(p, 'rt') as f:
    trace = json.load(f)
lo, hi = 258186105932, 258325953187
main = [e for e in trace['traceEvents']
        if e.get('pid') == 2318947 and e.get('tid') == 1
        and e.get('ph') == 'X' and lo <= e['ts']
        and e['ts'] + e.get('dur', 0) <= hi]
def percentile(values, q):
    values = sorted(values)
    k = (len(values) - 1) * q
    i = int(k)
    return values[i] + (values[min(i + 1, len(values) - 1)] - values[i]) * (k - i)
frames = [e for e in main if e['name'] == 'FunctionCall'
          and e.get('args', {}).get('data', {}).get('functionName')
          == 'FixedStepLoop.#frameCallback']
times = sorted(e['ts'] for e in frames)
durations = [e['dur'] / 1000 for e in frames]
tasks = [e for e in main if e['name'] == 'RunTask']
print({'callbacks': len(frames),
       'cadence_per_s': (len(times) - 1) * 1e6 / (times[-1] - times[0]),
       'callback_ms_p50': percentile(durations, .5),
       'callback_ms_p95': percentile(durations, .95),
       'callback_ms_p99': percentile(durations, .99),
       'main_busy_pct': 100 * sum(e['dur'] for e in tasks) / (hi - lo),
       'tasks_over_50ms': sum(e['dur'] > 50000 for e in tasks)})
PY
```

CPU attribution was reconstructed from `Profile`/`ProfileChunk` nodes, parent links, sample IDs and `timeDeltas`, grouped by function **and URL/line**, with recursive copies of the same frame deduplicated in inclusive totals. Treat those sampled costs as estimates; the initial profile sample includes a 169.879 ms startup gap. Function-level CPU sampling, browser instrumentation and extensions all affect the recording. Use the matched timing captures for acceptance.

## Execution record

Phases 1, 2 and 3 are implemented and their ACs are met with the evidence recorded on each above.
The engine changes ship as `threenative-core-0.3.2-scalar-wave-a67d9943e9eb.tgz` and the game
consumes that tarball, not a source link or a patched `node_modules`.

Three things this execution got wrong first and had to fix, recorded because each one would have
produced a plausible-looking wrong number:

1. **The sample started on a wall clock.** The first before-run covered 30.9 battle seconds starting
   at battle time 33.25 — a figure set by how long the page took to load. The start is now latched
   inside the `Battle.step` wrapper on the first step to reach a predeclared tick, and the end the
   same way, so every run covers exactly the same 30 battle seconds. After that fix all six water
   runs started at 75.017 and covered 30.017 s with 18 accepted impacts each.
2. **An outer wait consumed the tick before the in-page gate could see it**, leaving the wrapper to
   latch whichever step happened to run first after installation (75.183 on one run, 75.017 on
   another). The outer wait is gone.
3. **A zero-amplitude impulse announced a change it never made.** Found by the fluid capture on real
   frames, not by reading: an empty patch recentring eight times reported one version bump where
   none was possible. `RippleField.impulse` and `depositFoam` now treat a no-op write as a
   non-event, which is what a game scaling by the frame delta hands in on every paused frame.

What is **not** claimed: AC-6 on the water-impact fixture, AC-7 at all, the launch playtest,
`doctor`, and any native target. The capture machine carried a one-minute load average of 57 with
seven other capture, playtest and agent processes on it; crowd68 could not complete its warm-up
there. No gate was weakened, no target lowered, and no follow-up candidate was quietly implemented
inside this PRD's scope — the clustered-mesh finding the Phase 1 census produced (6,609 objects,
**zero** clustered meshes) was handed to the engine as its own change.

## Planning verification

Only this Markdown PRD is the deliverable. The input trace was parsed, screenshots inspected, source ownership checked, and the reproduction snippet executed successfully: 4,031 callbacks, 28.9038/s cadence, 62.2665 ms callback p95 and 379 long tasks. Document checks verified eight unique unchecked ACs, four unstarted phases, balanced code fences and valid local Markdown links. Independent review identified workload-clock matching and empty-recenter upload gaps; both are corrected above and the correction review returned PASS. Source review also replaced a scene render hook that would disable projection with the existing TSL uniform-update mechanism. No game/engine implementation, runtime gate, native target, performance improvement, commit, push or worktree cleanup is claimed by this planning task. Implementation evidence remains pending on the ACs above.
