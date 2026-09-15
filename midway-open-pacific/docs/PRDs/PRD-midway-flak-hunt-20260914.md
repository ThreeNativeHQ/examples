# PRD-midway-flak-hunt-20260914 — Trace corruption and combat profiling

**Status:** OPEN for the stable 60 FPS target. The earlier engine defect and `ctx.beforeRender` seam are DONE and on `origin/develop` (`b1cae8803`, fixes #248). This session removed a redundant whole-scene transform walk and an unsampled projected shadow map (engine `d78fe429d`, game `63353412c`, both committed locally and **not pushed**); all game gates green. Stable 60 FPS remains UNMET and cannot be measured on this host — see "Where this leaves the loop".
**Complexity:** 5 (MEDIUM); risk override: none. Target expanded by the user to stable 60 FPS throughout gameplay.
**Owner:** Codex; OpenCode DeepSeek v4.1 Flash handles bounded exploration and probes.
**Depends on:** Existing capture-performance.mjs and installed engine diagnostics.

## Objective

Diagnose the supplied cockpit screenshot's long tracer lines after a multi-second freeze, profile battle hotspots, and optimize toward stable 60 FPS throughout gameplay. User-observed baseline is 40–50 FPS, falling below 40 in hotspots. Distinguish ordinary game optimization, engine defects and evidence of a JavaScript limit. Preserve all pre-existing dirty files and game behavior.

## Established facts and invariants

- `src/sim/flight.ts` is the sole flight adapter; no flight changes are planned.
- `src/render/world.ts` owns pooled tracer position/color buffers and their draw range. Combat particle and simulation callers require investigation.
- `tools/capture-performance.mjs` already measures scene/world/ripple/render CPU and GPU timestamps. Existing trace-performance PRD covers earlier water/cockpit changes; these are not new findings.
- Engine owns loop/renderer/portable mechanisms. Capability discovery matched `prewarm` and `warmUpScene`; inspect before proposing first-use compilation fixes.
- Browser jobs use `tools/capture-lock.sh`, headed WebGPU, a verified hardware adapter and an isolated source snapshot. No desktop windows, concurrent GPU probes, or native claims.
- OpenCode runs `opencode-go/deepseek-v4.1-flash --auto`; no changes outside assigned ownership, no commits/push or cleanup of other lanes.

## Acceptance criteria

- [x] AC-1 [local; actor: agent]: Trace spawn → simulation update → tracer buffers, attempt a controlled stall reproduction, and record whether the screenshot failure reproduced. See stall evidence below; original corruption not reproduced.
- [x] AC-2 [local; actor: agent]: Measure quiet versus flak-active comparable workloads, with adapter/resolution/population and CPU/GPU observations; save raw local artifacts. Live diagnostic and fixed-population visibility/packing comparisons are saved; timing variance is disclosed.
- [x] AC-3 [local; actor: agent]: Rank measured hotspots and smallest root-cause fixes; verify any implemented correction with a focused check and real rendered frame. The confirmed root cause is an engine defect: `projection-apply.ts` built every `isLine` proxy as a plain `Line`, so projected `LineSegments`/`LineLoop` became connected strips. Fixed and verified red→green (62 projection tests; 68 focused engine tests), with the rendered tracer asserted `LineSegments` on the crowded-68 and static ABBA browser captures.
- [x] AC-4 [local; actor: agent]: Record limitations and exact commands here, preserve unrelated work, and audit the isolated checkout for cleanup. Exact commands, exits and limitations are recorded under "Final integration and verification"; other lanes' edits are preserved and both worktrees are retained (see summary).
- [ ] AC-5 [local; actor: agent]: Verify the 16.7 ms frame target under representative deck, cockpit, battle/flak, water-impact and recovery workloads, including sustained testing; report unmet budgets explicitly. Hidden-display cadence is not proof of real-play presentation FPS. **Remains unmet**: no representative workload holds a 16.7 ms frame budget; see the workload table and captures below.

## Execution phases

1. Trace failure paths and reuse existing probes. OpenCode owns exploration; Codex owns scope, environment and review.
2. Run bounded profiles/reproduction, remove measured redundant work, and verify matched before/after results. Unrelated asset changes and speculative engine rewrites remain out of scope.

User authorized optimization on 2026-09-14: "goal is hitting 60 FPS stable, across all game".
First bounded change: defer particle sorting/packing from every fixed update to the actual particle mesh render using ordinary Three.js `onBeforeRender`. Particle integration and emission stay on the fixed update; appearance, capacities and gameplay stay intact. `Scene.render` is unsuitable: the installed engine calls it after the normal scene draw. Existing `GPUParticles3D` was considered; migrating all authored particle behavior is larger than eliminating redundant preparation and is deferred pending measurements.

## Integration

Initially unchanged: investigation through the existing browser game, live Battle/WorldView and renderer. Any source change must identify its consumer and regression proof here.

## Evidence

Local scratch: `/tmp/midway-flak-hunt/`. Snapshot: `/home/joao/projects/threenative/sandbox/.worktrees/flak-hunt`, branch `midway/flak-hunt`, base `d773085d14f0f2a710665583951a176057253438`, owner this Codex session; cleanup pending.

Initial 1080p hardware WebGPU probe: natural/flak/hidden particle-update p95 0.1/2.9/3.6 ms. Flak spent 8.1 ms of particle CPU per outer rendered frame on average, with 545 particle updates for 110 renders. Smoke reached its unchanged 3600-particle cap. CPU samples identify particle packing/sorting and repeated Three.js world-matrix traversal; GC was 0.3–0.4% of sampled wall time, not evidence of the freeze cause.

Injected 2500 ms stall produced a 2538 ms callback gap; tracer CPU buffers remained finite with expected 13.6 m segments. Inspected screenshots did not reproduce the user's long-line corruption. Original freeze/corruption remains unresolved.

Static visibility comparison held battle time and particle population fixed (visible/hidden/hidden/visible). GPU p95 was 24.09/10.03/22.15/22.47 ms: large host variance prevents a trustworthy GPU savings claim. Do not treat the sequential live-flak visibility delta as causal.

The separate simulation stress probe used 68 aircraft/19 ships and explicitly synthetic bullet populations. 850 near-plane gun rounds cost `updateWeapons` p95 7.66 ms; 850 flak rounds cost 0.30 ms. This is a stress ceiling, not the observed live battle. It was built from a concurrently changing primary checkout, so use it to identify the collision path, not claim a before/after improvement.

### Live battle and particle candidate (later rolled back)

`tools/capture-battle-profile.mjs` uses real AI/gunnery after one disclosed placement 2400 m astern of Akagi at 1800 m altitude. At 1920×1080 on NVIDIA/Turing it recorded 84 AA events, 85 flak bursts and 16.28 simulated seconds during the sample. Player stayed alive; damage, ship fires and water impacts were not observed. Render CPU p95 43.4 ms; full Battle.step p95 0.8 ms; ship/aircraft updates ≤0.3 ms each, weapons ≤0.1 ms. CPU sampling: 0.1% GC, world-matrix traversal the largest self-time function. Raw evidence: `/tmp/midway-flak-hunt/battle/`.

`src/render/particles.ts` now packs each batch in its ordinary mesh `onBeforeRender` callback, using the actual drawing camera. Emission/aging remain in fixed updates. `scripts/check-particle-render.mjs` failed before (10 packing calls over five updates), passes after (zero during updates; two on drawing), and verifies latest buffer contents, pool ordering, aging and reset. Main-checkout typecheck and Vite build passed; browser flak appearance inspected and retained.

Fixed scene comparison held 3312 smoke and 301 glow particles, camera, battle time, 738 draw calls and triangle count identical. Reinstating the legacy update preparation versus draw preparation in the same page gave world-update CPU per rendered frame 18.65/2.11/1.84/10.11 ms in ABBA order. Full frame CPU p95 varied 79.3/57.8/43.1/42.9 ms; this host variance prevents treating the difference as an achieved FPS gain. Evidence: `/tmp/midway-flak-hunt/particle-compare/`. Stable 60 FPS remains open.

### Scene transform scheduling

`src/scenes/Midway.ts` uses the standard Three.js scene hook to update the known single-camera scene once before its main draw and reuse those transforms in shadow/reflection passes. The original hook ownership and auto-update flag are restored on scene exit. This is game-specific scheduling, not a generic engine wrapper; arbitrary transform-mutating hooks/multi-camera games need different semantics.

The same fixed-scene ABBA prototype reduced root traversals per rendered frame from 3/1/1/3, with render CPU p95 48.7/22.2/22.8/28.7 ms and GPU p95 11.82/10.19/11.05/10.62 ms. The kept traversal is included in these CPU costs. Draw count (738), geometry and particle populations match. Drift prevents claiming a universal FPS gain.

`tools/check-frame-transforms.mjs` measured the baseline at three walks per outer frame and the delivered code at exactly one in briefing, deck, airborne cockpit, chase and wide views. Independently composed world transforms matched all tested ships, player, AI aircraft and crew bones (zero maximum difference), remained finite and changed with motion. Briefing intentionally has no AI aircraft. Browser console checks passed and deck/cockpit frames were visually inspected. The transition check uses the restart UI to enter the airborne assignment; it does not claim a flown deck launch. Evidence: `/tmp/midway-flak-hunt/frame-final/`. One intervening capture failed before gameplay with Chromium `ERR_NETWORK_CHANGED`; the unchanged-code retry passed.

Main-checkout `pnpm typecheck` and `pnpm exec vite build` passed after insertion-only integration, preserving other lanes' edits. The final qualification snapshot intentionally refreshes primary `src/` after integration; its SHA-256 aggregate is `1d35c028d07428da9c86c1dffae420da3a3196995d93aca22858b2a90d9f6688`. No source edits occur during those captures.

### Representative workload measurements (stable 60 remains unmet)

All three final jobs used the frozen source digest above, the installed hashed core, NVIDIA/Turing WebGPU, 1920×1080, DPR 1 and the capture lock; source hashes matched before/after. `capture-battle-profile.mjs` now records actual altitude/standoff, drawing buffer, profiler and frame-limit options. Close combat ran without CDP CPU sampling.

| Workload | Render CPU p95 | Update + render CPU p95 | GPU p95 | Observed workload |
| --- | ---: | ---: | ---: | --- |
| Real close combat, 350 m altitude / 1500 m astern Akagi | 44.70 ms | not collected as a combined series | not collected | 157 AA events, 84 flak bursts, 13 damage events; player alive at 66.65 HP |
| Water-impact fixture, 10 simulated seconds | 26.72 ms | 67.67 ms | 6.95 ms | three accepted impacts, 468 draws, 1.21M triangles |
| Cockpit fixture, 10 simulated seconds | 44.67 ms | 58.90 ms | 7.97 ms | actual gunfire, 322 draws, 1.49M triangles |

These CPU series measure elapsed time in the wrapped work, not thread CPU time. The water/cockpit tool printed PASS only for its GPU/fixed-step leaf gates; neither verdict qualifies as stable 60 FPS. All three commands exited zero; the full frame budgets remain over 16.7 ms. Raw logs/JSON: `/tmp/midway-flak-hunt/{closecombat,water-final.json,cockpit-final.json}`. The close-battle diagnostic's `qualified:true` means the live workload advanced and the player survived, not that a performance target passed.

An additional close-combat run disabled Chromium frame limiting/vsync and enabled the 1 ms CDP CPU sampler. It advanced 20.22 simulated seconds and observed AA/flak/damage; render CPU p95 was 87.3 ms. Its CPU samples were 93.3% active, 0.6% GC, with scene projection/traversal, per-object updates and GPU buffer submissions dominant. Different pacing and profiler overhead prevent a timing comparison with the preceding non-profiled run. Evidence: `/tmp/midway-flak-hunt/closecombat-uncapped/`. The profiler uses the same V8/CDP machinery as Chrome DevTools, in an isolated browser; it is not the user's existing DevTools recording.

Integration review identified that mesh-owned render hooks force the engine's automatic scene projection to decline. The pre-change runtime eligibility is still unknown, so a dedicated before/after eligibility and pipeline-census audit is required before accepting the particle scheduling change as a net optimization. The original screenshot artifact is still unreproduced; fixed buffer capacities exclude the observed allocation/overrun hypothesis, not every possible CPU or GPU defect.

The installed launch playtest also passed (exit 0): `bash tools/capture-lock.sh timeout 120s node node_modules/@threenative/playtest/dist/runner/cli.js --scenario playtests/launch.playtest.json --url http://127.0.0.1:5396 --browser-recipe webgpu --headed --timeout 45000`. Raw output: `/tmp/midway-flak-hunt/launch-final.log`. This verifies the existing launch scenario, not a sustained 60 FPS target.

### Batching and pipeline audit

A frozen comparison removed the particle mesh hooks and scene-root hook entirely (not no-op callbacks) and restored original auto transforms and fixed-update packing. After allowing the engine's 60-frame reclassification, the original path also declined batching: `notWorthwhile`, predicting 1659 draw candidates from 2189. Current hooks report `renderHook`; both paths produced zero batches, 738 draws and identical geometry. Thus no active batching was lost in this measured roster. This does not prove eligibility for every future population; the supported 68-aircraft roster needs a separate audit.

Pipeline census stayed at 88 creations across the flak and audit phases; no new pipeline was created then. No automatic startup-warmup marker was captured. The isolated launch playtest separately recorded 96 pipeline creations, zero failures/pending, and a longest recorded synchronous pipeline service time of 1.3 ms. These observations do not reproduce or identify the user's original multi-second stall. Source-side shader graph construction and the user's first uncached run remain outside that narrow timing statement. Evidence: `/tmp/midway-flak-hunt/projection-audit/` and `launch-final.log`.

### Full-roster regression found and removed

At `ACTIVE_CAP=68` (populated through real `Battle.launch` calls), the original path does project: 144 batches, 2778 projected objects, 3670 renderables reduced to 1036 candidates. The particle mesh hooks disabled this optimization. Their p95 renderer time was 67.8 ms versus 39.5 ms in the original projected path; projection also raised triangles from 2.39M to 5.26M at that vantage, so its full GPU tradeoff remains separate. The hook-based particle candidate is **rejected and rolled back** in both primary and isolated source. Other lanes' particle emission changes are preserved. Its regression check is pending replacement with a test of a batching-compatible engine frame boundary.

This is why the 22-aircraft result cannot qualify the whole game. Evidence: `/tmp/midway-flak-hunt/projection-crowd/`. The source root hook is not a safe particle-packing replacement: the engine mirror does not forward it. Investigating the existing engine lifecycle contract before adding any API.

### Parked-aircraft reflection correction

The existing reflection marker recursively included the parked/decorative deck load despite its documented exclusion. A frozen ABBA toggle found all 1983 deck-load nodes carrying the reflection layer. Removing only that layer cut exactly 40 draws and 41,046 triangles, with zero changes to main-camera eligibility/visibility or simulation/particle population. CPU/GPU variation exceeded the timing delta; no FPS saving is claimed. The primary/snapshot now exclude those subtrees in three lines using standard Three.js layers. The existing five-view transform check also checks that hulls remain reflected and all deck-load nodes retain the main layer while losing the reflected layer. Evidence: `/tmp/midway-flak-hunt/reflection-compare/`.

### Confirmed engine defect: projected tracer topology

Final visual inspection of `/tmp/midway-flak-hunt/projection-crowd-delivered/audit-current.png` showed long connected tracer lines while CPU buffers still contained 18 independent finite 13.6 m segments. Engine `packages/core/src/projection-apply.ts:166` constructs every `isLine` proxy with `new Line(...)`, including `LineSegments` and `LineLoop`. That changes separate segment pairs into a continuous strip when automatic batching activates. The same defect exists in the installed core (`dist/index.js:4977`). This is an engine correctness bug, separate from the ordinary scheduling optimizations. Preserve the two specialized Three.js line types before the generic Line branch; test the projected scene, then reinstall a content-hashed core tarball.

The 68-aircraft transition increased the pipeline census from 90 to 156 creations. This gives a specific hypothesis for the hitch at activation; it does not prove the timing/cause of the user's original freeze.

Engine isolated checkout: `/home/joao/projects/threenative/threenative-engine/.worktrees/tracer-topology`, branch `fix/tracer-topology`, base `0893707ac7840194efb4d47aef47e0abccc6124a`, same owner. Existing primary resolution-scaler work remains untouched. Capability lookup returned render-advisor and temporal-velocity helpers; all details were read, none replaces preservation of existing Three.js primitive topology.

- [x] Engine phase: projected-LineSegments/LineLoop regression failed on the original code, passes with specialized proxies; all 62 projection tests pass. Full build passes.
- [x] Engine phase: full required checks (typecheck exit 0; owned lint clean; unit suite owned green), browser proof and hashed-tarball adoption — see "Final integration and verification". Native frame-order counts proven (preparedFrames 7→15, preparationErrors 0); the strict native scenario also flags an unrelated fixture audio error, reported and not waived.
- [x] Engine phase: upstream confirmed-bug report (issue #248) and final classification: one-line class-preservation defect in the projection proxy.

### Authorized follow-up: once-per-draw preparation

User requested DeepSeek complete a rounded fix on 2026-09-14. Engine owns frame ordering; this mechanism chooses no appearance. Capability search for once-per-present particle buffer preparation returned FrameBudget, Scheduler, createReplayDriver, Scene and GPUReadback; all details inspected, none provides the missing pre-projection phase. The existing five Scene methods and the after-draw Scene.render contract remain intact.

- [x] Add the smallest scene-owned ctx.beforeRender registration, run once immediately before projection/world drawing, clear at scene change/stop; regression checks include multiple fixed updates and cleanup. Landed in `packages/core` (scene.ts + game.ts) with 3 focused RED→GREEN tests plus a budget-attribution test; callback runs inside the render-budget bracket.
- [x] Document in capability/template contracts, prove browser and native frame order, adopt in Midway without per-mesh hooks. Capability manifest/reference and the shared `threenative-context` SKILL updated; scaffold hashes re-pinned. Midway adopts it in `enter`; game typecheck/build and the particle regression pass.
- [x] Measure fixed-scene preparation counts and full-roster batching on the installed artifact; retain only when correctness and reduced work are demonstrated. Current packs once per outer draw (prepare:writeBatch = 1:2), legacy packs per fixed update; rendered tracer topology `LineSegments`; populations/draws/triangles match across ABBA.

### Topology verification (2026-09-14)

Projected independent lines now retain `LineSegments` on the actual browser and native renderer. `29-line-segments` passed on both NVIDIA browser WebGPU and Linux native; screenshots visually inspected, pixel mismatch 0, no GPU validation errors. Each bounded runner exits 2 because 92 unselected cases are marked blocked; the selected case passed, native process exit 0. The raw native scene has no startup-readiness gate, so its capture warns after 30 seconds before taking the valid frame; this is not a game-startup proof. Evidence: `/tmp/midway-flak-hunt/topology-{web,desktop}-final/`.

An earlier fixture attempted to draw `LineLoop`, unsupported by Three.js WebGPU; its nominal conformance PASS hid renderer errors. That fixture was rejected. The final visual fixture contains only the supported independent line segments; LineLoop class preservation remains unit-tested without claiming WebGPU rendering support. Confirmed engine issue: https://github.com/ThreeNativeHQ/threenative/issues/248.

### Final integration and verification (2026-09-14)

Engine worktree `fix/tracer-topology` (@ `0893707ac`) shipped as a local content-hashed tarball
`threenative-core-0.3.2-battle-fix-27e4fce23867.tgz` (sha256 `27e4fce23867b89dba1d62a5ae06f8574bd5789705b131eddc92afd470e97bf4`),
adopted by replacing only the `@threenative/core` dependency/override in primary and snapshot
`package.json`; installs exit 0 and the installed `dist` carries `ctx.beforeRender`.

Engine checks (logs in `/tmp/midway-flak-hunt/`): `pnpm typecheck` exits 0 after building core
(the parent-owned native fixture typechecked against the fresh core `dist`). `pnpm lint` exits 1
with 22 pre-existing `noExcessiveCognitiveComplexity` errors in unrelated `examples/` and
`test-support/`; no owned file is listed. Full `pnpm test` (capture-lock wrapped) exits 1 at the
`package-test` phase because `@threenative/runtime-native`'s native-host tests need a compiled host
(`cmake --build … mystral`), 18 unrelated failures; the suite therefore stops before `unit`. A
direct capture-lock `vitest run` exits 1 with 7 failures: 6 are the pre-existing `sailing`
`AGENTS.md`/`CLAUDE.md` mirror drift and the repo-wide quality-suppression baseline (unrelated),
and the 1 owned failure (all ten scaffold hashes moved by the new capability/template guidance)
was fixed by re-pinning `PRD_201_PARENT_SCAFFOLD_HASHES` from the measured `Received` block;
`scaffold.spec.ts` then passes 61/61.

Game checks (primary): `pnpm typecheck` 0, `pnpm exec vite build` 0,
`node scripts/check-particle-render.mjs` PASS. Snapshot Vite serves `127.0.0.1:5396`.

Crowded-68 capture (`/tmp/midway-flak-hunt/battle-fix-crowd/`): NVIDIA/Turing, 1920×1080. Both
current and legacy project and batch. Current `prepare 29 / writeBatch 58` (1:2 per outer draw);
legacy `prepare 154 / writeBatch 308`. Rendered tracer `topo LineSegments`, `nonFinite 0`,
`maxLen 13.6 m`, `bullets 18 (flak 18)`, `draws 693`, `tri 4,991,245`.

Static ABBA particle-prep capture (`/tmp/midway-flak-hunt/battle-fix-particles/`): `fill-flak
37 (flak 37)`, `draws 845`, `tri 4,238,509`; populations held fixed across legs (smoke 713,
glow 202; aircraft 22). Draw-prep legs `prepare 33/31 → writeBatch 66/62`; legacy legs
`prepare 170/160 → writeBatch 340/320`. Rendered tracer `LineSegments` throughout. No FPS claim
from host drift.

Native fixture (`/tmp/midway-flak-hunt/preparation-desktop/`): `pnpm --filter
threenative-native-smoke build` exit 0; the desktop scenario proves the seam counts —
`preparedFrames` 7→15 and `preparationErrors` 0 — but the strict run reports `pass:false` for two
unrelated reasons: `preparedFrames` is flagged trivial (already 7 before the scenario, no
`allowTrivial`) and one console/runtime diagnostic from the fixture's deliberate
`decodeAudioData(new ArrayBuffer(0))` probe (`audio_bindings.cpp:505` writes stderr). Reported,
not waived.

Stable 60 FPS remains UNMET: no representative workload holds the 16.7 ms frame budget. Full
detail, artifact hashes and unresolved items: `/tmp/midway-flak-hunt/finish-result.md`.

### Squash integration to develop (2026-09-14)

The confirmed engine fix and the `ctx.beforeRender` seam are now in a single commit on
`origin/develop`: `b1cae8803 fix(core): keep line primitive topology and add a per-world-draw seam`
(fixes #248; net +31 production LoC in `packages/core/src`). It was rebased onto fresh
`origin/develop` `6be7173dc` and pushed fast-forward; `origin/develop` equals the candidate. The
copied resolution-scaler inputs were excluded from the squash and preserved in `stash@{0}`;
candidate diff `origin/develop..HEAD` is the 20 owned fix/doc/test/conformance files. Focused
checks on the candidate: `renderProjection` + `game` + `game-frame-budget-surface` specs 113/113
pass, the scaffold stability test passes against re-pinned hashes, and `pnpm typecheck` exits 0.
The remote reported bypassed rules ("Changes must be made through a pull request" and required
check `ci-required`) — entered under the user's explicit authorization to squash directly to
`develop`, with no force push. Stable 60 FPS remains UNMET.

## Next developer: execute this loop until stable 60 FPS

**Target:** keep each presented frame within 16.67 ms at 1920×1080, DPR 1 on the user's NVIDIA WebGPU machine, through briefing/deck, takeoff, cockpit/chase/wide views, close combat/flak, impacts/fires, the full 68-aircraft roster and recovery. Do not call this finished from average FPS, a short frozen scene or a GPU-only PASS. Record p50/p95/p99, worst frame, counts above 16.67/33/100 ms, and stalls; sustain each live workload for at least 5 minutes after startup. Record cold first-use transitions separately so warmup cannot hide combat hitches. A finite run cannot guarantee every possible frame; report its actual coverage and exceptions.

### 1. Establish an honest baseline before editing

- Use an isolated checkout under the owning repository and install the game's current content-hashed core tarball. Preserve concurrent changes. Every browser/native launch goes through this game's `tools/capture-lock.sh`; use headed WebGPU on its private Xvfb, never visible desktop or `xvfb-run`. Confirm NVIDIA/Turing, viewport, drawing-buffer size and render scale. Record other GPU load; a private-display run is not proof of the user's display cadence.
- Reuse `tools/capture-battle-profile.mjs` for real fighting and `tools/capture-flak-hunt.mjs` for controlled comparisons. Known current examples: `MIDWAY_PROJECTION_CROWD=1` and `MIDWAY_COMPARE_PARTICLE_PREP=1`. Set `MIDWAY_URL` to the isolated server; use `MIDWAY_BATTLE_OUT` for the live-battle tool and `MIDWAY_OUT` for the flak tool. Set `MIDWAY_WIDTH=1920 MIDWAY_HEIGHT=1080`. For live timing use `MIDWAY_CPU_PROFILE=0`; use `1` for a separate diagnostic profile. Sample with the CPU profiler off, then take a separate diagnostic CPU profile.
- Capture the engine's `TN_FRAME_BUDGET` markers alongside GPU timestamp results. The custom probe's `frameCpu` sums wrapped scene updates, particle preparation and renderer calls; it is **not the entire engine frame** and can omit projection reconciliation, overlay and other work. Do not optimize by moving work outside the timer. Do not add CPU and GPU times as though they execute serially.
- Current installed core is `battle-fix-27e4fce23867`. Final crowd evidence: `/tmp/midway-flak-hunt/battle-fix-crowd/probe.json`; 68 aircraft, 99 batches, 693 draws, ~4.99M triangles, measured wrapped CPU p95 22.4 ms and GPU p95 12.20 ms. Static flak preparation uses one prepare/two buffer writes per draw, versus about five prepares/ten writes previously. Timings drifted between runs, so the reduced work is proven; a universal FPS gain is not.

### 2. First optimization: remove measured CPU render work

**Start here.** Live simulation was cheap relative to rendering in the measured battle. Inspect `packages/core/src/game.ts` around the world-render block, `projection-apply.ts`, and Three's `_projectObject`, `updateMatrixWorld`, uniform updates and `writeBuffer` callers identified by the CPU profile. Measure separately: game update, `ctx.beforeRender`, projection reconciliation/sync, main draw, reflection/shadows, overlay and presentation wait.

Choose the largest measured CPU contributor, then remove one repeated operation. Candidates are unchanged projected transforms being recopied/uploaded, repeated hierarchy traversal across render passes, and per-object uniform/buffer submission. Use existing dirty/version information where it is sufficient; do not create a new scheduler, ECS or generic cache without evidence. Static, moving, reparented and visibility-changing objects must remain correct. Skinned crew, articulated aircraft, LOD, shadows and reflections must keep their current transforms.

Keep the shipped fixes: particle simulation stays in fixed updates, packing stays in `ctx.beforeRender`, and the game prepares world transforms once for its known passes. **Never restore particle mesh `onBeforeRender` hooks:** they previously disabled projection for the whole full-roster scene. Never move `Scene.render` earlier; its existing consumers require after-draw timing. Keep preparation inside the frame-budget render interval.

### 3. Second optimization: stop submitting offscreen instances

Inspect `packages/core/src/projection-apply.ts`, especially instanced-batch construction and `#syncBatched`; inspect `projection-plan.ts` around `predictDraws`. The current instanced lane sets `frustumCulled = false` and submits all allocated instances. Its admission heuristic prices draw counts, not triangles. Earlier measurements rose from ~2.39M to ~5.26M submitted triangles when batching engaged. That is a concrete cost mechanism, not proof that disabling batching is faster.

**First falsifier:** freeze the same crowd; compare a view containing it with empty sky, recording submitted instance/triangle counts for each pass. Establish how much offscreen geometry the instanced lane still sends. Preserve the source objects' own `frustumCulled` setting.

If confirmed material, prototype culling/compaction using the **camera for each render pass**, then measure total CPU and GPU cost. Main-camera-only visibility must not remove objects needed by a reflection or shadow camera. Do not route everything through `BatchedMesh`, disable batching globally, or enable a union bounding sphere and declare individual culling solved. Keep the candidate only if measured frame cost improves with correct multi-camera rendering; otherwise retain the baseline and record why. A more selective batching heuristic is another candidate, but it must price visible geometry and CPU cost rather than draw count alone.

### 4. Third optimization: remove first-use combat hitches

The full-roster transition created 66 additional GPU pipelines in an earlier capture (90→156). This is a **hypothesis** for the freeze; the original freeze cause is not yet proved. Correlate a real long frame with pipeline creation/compilation, asset decode/upload and resource creation before changing code. GC occupied only 0.1–0.6% of the sampled windows and is not the leading supported explanation.

If pipeline compilation is responsible, warm the actual projected material/pass variants through the engine's existing startup/warmup mechanism. Cover flak, damage/fire, shadows and reflection variants. Do not compile every conceivable combination or merely shift an unbounded pause to startup. If a new variant must appear during play, measure a bounded preparation path and keep the old valid rendering until it is ready. Re-test a cold launch through first combat and first batching activation; a warmed second run cannot close this item.

### 5. Repeat with strict keep/revert decisions

For every candidate: write down the hotspot, proposed cause and expected reduced work; run the smallest regression that can disprove it; implement only that change; compare A/B/B/A with identical scene/camera/population and profiler settings. Record full-frame CPU, GPU, draws, triangles, preparation/upload counts and image correctness. Inspect screenshots. Keep a change only with repeatable savings and no visual/gameplay regression. After two failed attempts at the same cause, stop editing, name the doubtful assumption and take a new diagnostic measurement.

Run `node scripts/check-particle-render.mjs` and the frame-transform probe after scheduling changes. Keep the projected LineSegments/LineLoop unit regression and supported-LineSegments browser/native conformance: the original screenshot was an engine proxy changing independent segments into a continuous Line. A finite CPU tracer buffer alone does not prove correct rendering; inspect the actual rendered proxy. LineLoop itself is unsupported by Three.js WebGPU, so do not use it as a WebGPU visual fixture.

Engine changes belong in `packages/`, with focused unit and runtime proof, then a newly hashed tarball installed in the game. Never patch `node_modules`. Finish with game typecheck/build and the live coverage above; report failed/unrun checks honestly. Existing broad-repo failures and the native fixture's deliberate audio-error probe are documented above and are not permission to disable diagnostics. Once CPU is below budget, optimize GPU cost if still necessary. Do not first lower resolution, reduce the aircraft cap, remove flak, remove shadows or replace hero geometry: these change the target instead of demonstrating the requested performance. Game-authored LOD/reflection decisions remain possible only with explicit visual comparison and measured need.

**First baseline (about 60 seconds once the server is ready):** reuse the retained isolated game only after confirming its previous owner is inactive and it has the current engine package. Port 5396 is the server used for this report.

```sh
cd /home/joao/projects/threenative/sandbox/.worktrees/flak-hunt/midway-open-pacific
MIDWAY_URL=http://127.0.0.1:5396 \
MIDWAY_BATTLE_OUT="/tmp/midway-60fps-$(date +%s)" \
MIDWAY_CPU_PROFILE=0 MIDWAY_SAMPLE_MS=30000 MIDWAY_WARM_MS=8000 \
MIDWAY_BATTLE_ALTITUDE=350 MIDWAY_BATTLE_STANDOFF=1500 \
MIDWAY_WIDTH=1920 MIDWAY_HEIGHT=1080 CAPTURE_SCREEN=1920x1080x24 \
bash tools/capture-lock.sh node tools/capture-battle-profile.mjs
```

If that server is stopped, start `pnpm exec vite --host 127.0.0.1 --port 5396 --strictPort` in the same game directory first. Repeat the diagnostic run with a fresh output directory and `MIDWAY_CPU_PROFILE=1`. Work on step 2's largest measured CPU contributor first. Keep this PRD as the single running record; do not restart the investigation from scratch.

### Final handoff status

Engine fix is one commit on `develop`: `b1cae880310c424b6f905a298a5c20aa62ad713a`; the primary engine checkout was fast-forwarded to it. GitHub accepted the authorized direct push using the account's bypass for pull-request and `ci-required` rules; full CI was not established. Rebased focused checks passed 113/113 plus scaffold checks and typecheck. The game remains on content-hashed core `battle-fix-27e4fce23867`, whose runtime changes are identical to the integrated patch. The game fix and this report are consolidated on `midway/asset-battle-integration`.

Both final game frames were inspected: separate tracer segments, retained flak and intact cockpit. Stable 60 FPS remains open for the next developer; follow the ordered loop above. The test worktrees remain at `/home/joao/projects/threenative/threenative-engine/.worktrees/tracer-topology` (2.4 GB) and `/home/joao/projects/threenative/sandbox/.worktrees/flak-hunt` (game portion 1.4 GB). They hold the verified source/capture environment and preserved inputs; destructive cleanup is not authorized. The engine input stash `10448c69101eecb1f5142f068ba349be2bc75e2b` is retained; its scaler inputs are already present in develop.

### Goal continuation: CPU attribution after delivery

Previous goal turn made progress: engine `b1cae8803` and game `6089a35` were pushed, topology and particle preparation were verified, and an execution handoff was recorded. Current checkouts still match those commits and are clean; the isolated server is live on port 5396. Stable 60 remains open.

- [x] Run one current live timing baseline and a separate CPU profile; include actual engine frame-budget markers and identify the largest remaining CPU contributor before another optimization. Done 2026-09-14; see below.

### Baseline and CPU attribution (2026-09-14)

`tools/capture-battle-profile.mjs` now parses the engine's own `TN_FRAME_BUDGET`, `TN_FRAME_HITCH`
and `TN_RENDER_PROJECTION` console markers into the report (fail-closed on a malformed marker), so
the whole presented frame is recorded, not only the custom wraps. Three 30 s close-combat runs
(NVIDIA/Turing, 1920x1080, DPR 1, `resolutionScale 1`, `atFloor false`, live AA/flak/damage, player
alive) exited 0: `/tmp/midway-flak-hunt/cpu-next-{off,on,off2}/`.

**GPU is not the budget.** Whole-frame `render` mean was 121.19 / 63.31 / 49.96 ms while GPU was
10.40 / 8.42 / 2.98 ms; `overlay` and `residual` were ~0 and simulation `update` 7.8-16.7 ms. CPU
draw submission and projection, not GPU execution, own the frame.

**Absolute FPS on this host is not usable.** Identical configuration gave 5.95 / 7.35 / 8.31 fps
with load average 12.9 -> 25.5 on 24 cores (other lanes plus a long-running qemu VM). The user
observes 40-50 fps on the same machine unloaded. Only relative CPU shares, counts and
draw/triangle totals are treated as evidence here; no absolute frame-time claim is made from these
runs, and the `TN_FRAME_BUDGET` window spans startup plus warm-up at this marker cadence.

CPU profile (`cpu-next-on`, 33.76 s, active 36.8 %, gc 0.2 %): inclusive `onRender` 29.8 % (81 % of
active CPU), `three render` 20.8 %, `reconcile` 8.7 % (~24 % of active), `game update` 6.7 %. The
single largest self function is Three's `updateMatrixWorld` at 1072.3 ms, ahead of
`three update` 501.7, native `writeBuffer` 415.3, engine `walkProjection` 374.3 and
`_renderObjectDirect` 335.2. `TN_RENDER_PROJECTION` reports `projecting true`, 2189 source
renderables, 1565 projected, 99 batches, 723 draw candidates, so the decline cadence guard never
engages and the full scan plus the forced matrix pass are paid every frame.

The earlier `closecombat-uncapped` ranking (`_projectObject` 12.3 %, `updateMatrixWorld` 7.9 %)
does not reproduce: `_projectObject` is now 0.7 % self. That old run carried sampler and host
drift and is not a baseline.

### Candidate 1: stop force-recomputing static world matrices

`renderProjection.ts:237` calls `this.#source.updateMatrixWorld(true)` on every projecting frame.
The force is required to be *some* update - the renderer is handed the mirror, so nothing else
refreshes the authored scene - but the `true` also defeats any subtree a game has deliberately
marked static, recomposing and recomputing all ~2189 renderables (including the ~1983 parked
deck-load nodes and the atoll) every frame. Three's own `matrixWorldNeedsUpdate` propagation
already refreshes every default auto-updating object, so a non-forced call is identical for them.

Two halves, measured together: the engine drops the force, and the game marks its measured-static
subtrees `matrixAutoUpdate = false`. Falsifier: matrix composes per frame fall, while
`TN_RENDER_PROJECTION` keeps `projecting true` with unchanged draw candidates, and draws,
triangles and the rendered frame are unchanged. If draws or the verdict move, the gate is wrong.

### Candidate 1 corrected: the forced matrix pass was a second whole-scene walk

The first attempt — simply dropping the `true` — was **disproven before it was applied**. In Three
0.185 a `Scene` keeps `matrixAutoUpdate = true`, so `updateMatrixWorld()` composes the root's own
matrix, sets `matrixWorldNeedsUpdate`, and forces the whole subtree exactly as `updateMatrixWorld(true)`
does. The two call forms are indistinguishable unless the root is marked static, and the proposed
unit test could not be made to fail on the original code. Recorded rather than shipped.

The real finding is one level up. `src/scenes/Midway.ts:74-88` already sets
`scene.matrixWorldAutoUpdate = false` on the scene root and performs its own **unforced**
`scene.updateMatrixWorld()` in `scene.onBeforeRender`, restoring the flag on exit. The engine then
ignored that flag and ran a second, **forced**, whole-scene walk in
`renderProjection.reconcile`. So the authored scene was walked twice per frame, the second time
overriding the game's deliberate static marking.

Engine change (worktree `.worktrees/projection-dirty`, branch `perf/projection-dirty`, base
`b1cae8803`): `renderProjection.ts` now honours the same contract every Three renderer uses —
`if (this.#source.matrixWorldAutoUpdate === true) this.#source.updateMatrixWorld();`. A game that
turns the flag off has promised to update the scene itself; a subtree marked
`matrixWorldAutoUpdate = false` under a still parent is skipped rather than walked.

RED→GREEN in `packages/core/__tests__/renderProjection.spec.ts`: four cases — a moving projected
object still reaches the mirror (passes both sides), a static subtree's world matrices survive
reconcile (**failed before**, `expected [0,0,0] to deeply equal [999,0,0]`), a source scene marking
its world static is not walked at all (**failed before**, `updateMatrixWorld ... called 1 times
[true]`), and a static-marked subtree whose parent moved this frame is still refreshed (passes both
sides — the safety case). After the fix, 66/66 pass. Whole core suite 113 files / 1276 tests exit 0,
`pnpm --filter ./packages/core build` exits 0; both only after building the unbuilt workspace deps
(`@threenative/playtest`, the MCP packages, `@threenative/assets`) — the first runs failed on those,
not on this change. `pnpm typecheck` ends at 2 errors, both `examples/fps-friction` missing the
unbuilt WASM `@threenative/physics`, neither in a changed file. Packed but **not yet installed**:
`.packages/threenative-core-0.3.2-projdirty-12c96c25114f.tgz`
(sha256 `12c96c25114f91335895102fc7f50c58719782c7a445d97a777dd01618bdd858`).

Scene-node census supporting it: over 120 consecutive live-battle frames, **6527 of 6636 nodes
(98.4 %) never changed their local matrix**. The 109 that move are aircraft and ship roots, propeller
and control-surface pivots, the ocean plane and the sun. Largest never-moving subtrees: AI Zero
2072/2088, ship hulls 2019/2047, carrier + parked deck load + crew 1201/1207, SBD 1025/1059, Midway
Atoll 40/40, coupled whitewater 26/26. Probe and per-subtree counts:
`/tmp/midway-60fps/report-B.md`, `/tmp/midway-60fps/probe-matrix-120.mjs`.

### Candidate 2: the shadow pass draws a fleet into an empty 160 m box

Measured on a live cockpit frame (350 m altitude, 1500 m astern of Akagi, 19 ships / 22 aircraft):

- Exactly one shadow-casting light, the sun `DirectionalLight` (`world.ts:280-288`), with a
  **160 m x 160 m** orthographic shadow camera (2048², near 1, far 850) that **follows the player**
  (`world.ts:627-628`). Metres per texel 0.078.
- The renderer is handed the projection mirror: 518 shadow-casting renderables, of which 94 are lane
  batches (40 instanced + 54 material) and 424 exact proxies. **All 94 lane batches carry
  `frustumCulled = false`**, hard-coded by the lane, and each carries one bounding sphere spanning
  every instance across the map.
- Per-pass counts, instrumented from the page and equal to the renderer's own combined counters:
  main **1418 draws / 4,727,398 triangles**, shadow **316 draws / 1,814,234 triangles** — the shadow
  pass is **18.2 % of draws and 27.7 % of triangles**.
- Three's own object frustum test finds **0 of those 316 submissions outside** the shadow camera,
  because the map-spanning batch spheres always intersect the box. **Restoring `frustumCulled` would
  cull nothing.** `BatchedMesh` per-instance culling does not apply to `InstancedMesh`.
- In the captured frame **no cast shadow is identifiable anywhere** — the player is 350 m up, the
  nearest ship is ~1.5 km away, and nothing is inside the 160 m volume.

So the second draw of the fleet produces an empty shadow map in airborne combat. The cut is
game-side and distance-shaped: cast only within the volume the shadow camera can actually reach,
keeping the deck case (hull, parked load and crew are inside ±80 m when the player is on deck) and
always keeping the player. Evidence: `/tmp/midway-60fps/report-C.md`,
`/tmp/midway-60fps/report-C-frame.png`.

This also re-ranks PRD step 3. Offscreen instanced geometry is real, but **triangles are not the
budget**: GPU p95 was 3-10 ms against 50-121 ms of CPU. Its cost lands on the CPU through the shadow
pass's draw submissions, which is what this candidate removes.

### Candidate 2 rejected as implemented, and what it exposed

Per-object distance-gating of `castShadow` on ships, deck load, AI aircraft, projectiles and scouts
(player always casting, hysteresis on the boundary) was implemented in `src/render/world.ts` and
**reverted**. A/B/B/A with frozen camera, battle time and population, gate toggled at runtime:

| fixture | gate | projecting | main draws | main tris | shadow draws | shadow tris |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| airborne 350 m | off | true | 1426 | 4,808,475 | 316 | 1,788,928 |
| airborne 350 m | on | **false** | 1606 | 4,503,022 | 135 | 413,614 |
| deck | off | false | 371 | 2,204,888 | 321 | 817,087 |
| deck | on | false | 371 | 2,204,888 | 321 | 817,087 |

Legs were reversible (A1 == A2, B1 == B2). The deck fixture was **pixel-identical, 0 of 2,073,600
px** — the gate kept every shadow a player actually sees. The airborne fixture changed by 96.6 % of
pixels, and the shadow saving was not the gate's doing.

**`castShadow` is part of the engine's batch group key.** Gating it per object split the groups and
pushed the projection's own prediction from 723 to 1661 draw candidates of 2189, past its 0.75
worthwhile ratio, so the engine declined projection for the entire scene and rendered the authored
graph instead. The shadow drop was that decline's ordinary frustum culling. `pnpm typecheck`,
`pnpm exec vite build` and `check-particle-render` all exited 0; the change was still wrong.
Evidence: `/tmp/midway-60fps/report-D.md`, `trace-D.mjs`, `probe-report-D-settle.mjs`.

Two findings worth more than the rejected change:

**1. At this roster, batching is a draw wash and a triangle loss.** Counting both passes, projected
totals 1742 draws / 6.60 M triangles against 1741 draws / 4.92 M triangles declined. Projection
saves 180 main-pass draws and gives back 181 shadow-pass draws, because its batches hard-code
`frustumCulled = false` and carry one map-spanning bounding sphere, so the shadow camera cannot cull
them. `projection-plan.ts` `predictDraws` prices the main pass only; it does not know that batching
removes the shadow pass's culling, so its "worthwhile" verdict is computed against a draw count the
frame does not actually have. This does not generalise to the 68-aircraft roster, where an earlier
capture measured projection clearly ahead (renderer p95 39.5 ms projected against 67.8 ms declined);
it is a prediction-accuracy problem at moderate rosters, not a reason to disable batching.

**2. The rendered image is not the same with projection on and off.** The same frozen camera, battle
time and population differ by 96.6 % of pixels between the projected and declined paths, the sea
losing its wave and reflection detail. Projection is supposed to be a drawing optimisation and
should be visually transparent. This is tracked as a separate correctness question, not a
performance one, and it is not waived.


### Candidate 1 integrated: the game now runs the transform-ownership engine fix

The `perf/projection-dirty` engine fix is adopted (2026-09-14). Content-hashed core
`threenative-core-0.3.2-projdirty-12c96c25114f.tgz` (sha256 `12c96c25...bdd858`, packed from
`.worktrees/projection-dirty`, base `b1cae8803`, committed there as `f7c64c5fc`; focused core
regression `renderProjection.spec.ts` 66/66) replaces `battle-fix-27e4fce23867` in
`package.json` (dependency and `pnpm.overrides`) and `pnpm-lock.yaml`; `pnpm install` exit 0. The
installed `dist/index.js:5995` now reads
`if (this.#source.matrixWorldAutoUpdate === true) this.#source.updateMatrixWorld();`.

The engine upgrade makes the old game hook unsafe, and the refactor that absorbs it is in
`src/scenes/Midway.ts`: `scene.matrixWorldAutoUpdate` stays `false`, but the once-per-world-draw
world-matrix walk moved off the scene `onBeforeRender` hook and onto `ctx.beforeRender`. When
batching is active the projection mirror is what renders, so the authored scene's `onBeforeRender`
never fires and the old hook left every world matrix stale. The same `ctx.beforeRender` callback now
does both the walk and the particle `prepare`, and the flag is restored on scene exit.

RED → GREEN on the real renderer, hardware WebGPU (NVIDIA Turing), 1600×900, private Xvfb:

- **RED** — old hook + new engine, `tools/check-frame-transforms.mjs`:
  `airborne-cockpit: world matrices match the independent ancestor multiply (max diff 0.66794)`.
  The stale-matrix failure is exactly the projection-path bug.
- **GREEN** — refactor + new engine: all five phases ratio `1.0`
  (`briefing` 45/45, `deck` 46/46, `airborne-cockpit` 13/13, `airborne-chase` 45/45,
  `airborne-wide` 42/42), `maxWorldDiff 0`, `finite true`, `changed true`, no console/page errors:
  `PASS: one root world traversal per presented frame, transforms finite and correct, no errors`.
  Reports `/tmp/midway-flak-hunt/projdirty/frame2/frame-check.json` (green) and
  `/tmp/midway-flak-hunt/projdirty/red-old-hook/frame-check.json` (red).

`pnpm typecheck` exit 0; `pnpm exec vite build` exit 0 (only pre-existing three-mesh-bvh namespace
and chunk-size warnings). The four browser playtests against the new engine all pass
(`midway-audio-realism`, `midway-briefing`, `midway-flight`, `midway-launches`; top-level
`"pass": true`, exit 0); log `/tmp/midway-flak-hunt/projdirty/playtests.log`.

Two live close-combat profiles (altitude 350 m, standoff 1500 m, CPU sampler off so the CDP
profiler does not add load) exit 0 with the player alive and no errors; the host was contended by
other lanes, so absolute FPS is not evidence (as before):

| run | sim advanced | AA / flak / damage | render p95 | GPU p95 | update | projection | residual |
| --- | ---: | ---: | ---: | ---: | ---: | --- | ---: |
| after-1 | 18.10 s | 174 / 96 / 14 | 30.2 ms | 8.83 ms | 6.62 ms | projecting true · 99 batches (40 inst / 59 mat) · 624 exact | 0.05 ms |
| after-2 | 19.13 s | 177 / 100 / 13 | 25.7 ms | 6.82 ms | 6.70 ms | projecting true · 99 batches (40 inst / 59 mat) · 624 exact | 0.04 ms |

The projection verdict and batch census are unchanged from the doc's record (99 batches, 40
instanced, 59 material, 624 exact), so the adopted fix is correct and stable but does not by itself
change the CPU-bound frame: the authored scene still walks once per world draw. The per-frame saving
the engine fix enables needs a game that marks its measured-static subtrees
(`matrixWorldAutoUpdate = false`); Midway does not request a static list here, and the doc's
execution order keeps that behind the structural-plan work. Stable 60 remains unmet, and the two
correctness questions above (per-pass batching, projected/declined image parity) remain open.
### Candidate 3 rejected: gating the sun light itself

`castShadow` on the single sun `DirectionalLight` is not batched and has no group key, so gating the
light instead of its casters left the projection verdict untouched (`projected`, 99 batches, 723
candidates, identical on and off) and the main pass unchanged (1423 draws / 4,808,382 triangles in
every leg). It still fails, for two independent reasons, and was reverted.

An altitude ladder with frozen camera and battle time — on deck, 20, 50, 100, 150, 250, 350 m —
found **no pixel-neutral altitude**. Every rung differs by ~434,000 of 2,073,600 px (20.9 %) between
the light casting and not. The reason is structural: the shadow camera is centred on the player, so
the player's own airframe is always inside the volume and its cockpit self-shadow is always part of
the image. There is no altitude at which the sun's shadow stops contributing, so there is no
threshold to set.

Worse, an airborne start with the light already disabled makes Three's `ShadowNode.updateShadow`
dereference a null `depthTexture` every frame and freezes the canvas. Reproduced three times with
the gate and, decisively, **also with the gate's logic removed entirely** — a bare wrapper forcing
`sun.castShadow = false` from the first frame reproduces it, while toggling the light off after the
scene has booted with it on does not. So it is the renderer starting with its only shadow light
disabled, not the gate. Recorded, not chased.

The deck fixture passed cleanly again (0 px of 2,073,600, main and verdict unchanged).
`pnpm typecheck`, `pnpm exec vite build` and `check-particle-render` exited 0; the change still
cannot ship. Evidence: `/tmp/midway-60fps/report-E.md`.

### Candidate 4: the projection mirror clones the sun, and both suns draw a shadow map

A hypothesis that the shadow map was re-rendered for the ocean's reflection pass was **disproved**,
and the disproof is worth more than the hypothesis. Wrapping `renderer.render` as a stack and
attributing every `renderer.info.update` submission to the innermost active render call gives, for
one presented frame of the airborne fixture:

```
world render (world camera) — the projection MIRROR scene
  Shadow Map [ID: 9335]   158 draws / 894,464 tris   light = the projection's clone of the sun
  Scene [ Reflector ]     528 draws / 1,679,925 tris  reflection pass — no shadow render inside it
  Shadow Map [ID: 872]    158 draws / 894,464 tris   light = the authored w.sun
```

There are **two shadow-casting lights, not one map drawn twice**: the authored `w.sun` in the source
scene and the `light.clone()` the projection mirror makes in `ProjectionMirror.#syncLights`. Both
update from `ShadowNode.updateBefore` while objects render; the reflector pass is a sibling and
renders no shadow map. On the deck fixture, where projection declines, there is exactly one light and
one map (321 draws / 817,087 triangles) — which is itself the proof.

That reconciles the 316-versus-158 discrepancy between the two earlier probes: both summed every
`ShadowMap` submission in the frame without deduplicating by light, and the earlier A/B/B/A page
happened to capture a one-light state. Re-running the unchanged probe on the current tree reads 316.

So while projecting, one full shadow map — **158 draws and 894,464 triangles, about 9 % of the
frame's draws and 14 % of its triangles** — is rendered every frame and never sampled. Also recorded:
three 0.185.1's WebGPU renderer has no `shadowMap.autoUpdate`; the node path reads per-light
`light.shadow.autoUpdate` / `needsUpdate` in `ShadowNode.updateBefore`, which is the mechanism any
fix must use. Baseline gates on the unchanged tree: `pnpm typecheck` 0, `pnpm exec vite build` 0,
`check-particle-render` PASS, `playtests/launch.playtest.json` pass. Evidence:
`/tmp/midway-60fps/report-F.md` and its three probes.

### Candidate 4 shipped: the authored light's shadow map goes offline while projecting

Established from three 0.185.1's own source, not by inference. `#syncLights` does `light.clone()` and
adds the clone to the mirror; `DirectionalLight.copy` clones the shadow (`three.core.js:47418`) and
`LightShadow.copy` clones its camera (`:46030-46032`, `:46057-46060`), so the two lights have
separate maps. `renderer.render` projects the scene it is handed (`three.webgpu.js:60191`),
`_projectObject` collects that scene's lights (`:62323-62325`), `RenderList.finish` builds
`lightsNode.setLights(lightsArray)` (`:33542`) and every render object takes `renderList.lightsNode`
(`:59975`); a material overrides that only through `material.lightsNode`, which is null by default
and which the engine never sets. **The drawn pixels read the clone's map; the authored sun's map is
dead work.** `ShadowNode.updateBefore` reads per-light `shadow.needsUpdate || shadow.autoUpdate`
(`:45528`), which is the switch used.

`projection-apply.ts` now captures the authored light's `shadow.autoUpdate` when the mirror takes the
light, sets it false, and restores the captured value on retire, on decline and in `releaseAll`. A
light that was already off is never forced on; a scene that never projects is untouched. RED→GREEN on
three lifecycle cases (`expected true to be false` before, 71/71 after); whole core suite 113 files /
1281 tests exit 0; `pnpm typecheck` ends at the 2 pre-existing `examples/fps-friction` errors, none in
a changed file. Packed as
`.packages/threenative-core-0.3.2-projshadow-bb0d10b1b34a.tgz`
(sha256 `bb0d10b1b34a89c1cb6c7939dc27b3b6b3ed2f62646afec04a24bc8bd3f8bc54`), carrying both engine
changes. Evidence: `/tmp/midway-60fps/report-G.md`.

### Candidate 1 shipped and verified in the game, with the game half it needs

Installing the guard alone **breaks the game**, and the check caught it. While projecting, the
renderer is handed the mirror, so Three never calls `onBeforeRender` on the authored scene: Midway's
own walk fired 0 times per frame and the authored world matrices went stale —
`tools/check-frame-transforms.mjs` failed with `maxWorldDiff` 0.537 in cockpit, 56.13 in chase and
110.27 in wide, and `rootWalks` 0.

The game half is one hunk in `src/scenes/Midway.ts`: the per-draw walk moves from
`scene.onBeforeRender` to `ctx.beforeRender(() => scene.updateMatrixWorld())`, the seam the engine
runs once per world draw *before* `projection.reconcile()`. `scene.matrixWorldAutoUpdate = false`
stays, and the original state is still restored on exit. With it, the gate passes with every phase at
`rootWalks/frames = 1`, `maxWorldDiff 0` and `changed true`.

Measured on the frozen airborne fixture with the sim running, 60 frames:

| core | authored-scene walks / frame | forced | `updateMatrix` composes / frame |
| --- | ---: | ---: | ---: |
| old | 2.0 | 1.0 (engine) | 13,266 |
| new + game hunk | **1.0** | 0 | **6,703** |
| new, without the game hunk | 0 | 0 | 140 — **stale, rejected** |

Draws, triangles and the projection verdict are identical old and new on both fixtures (air 1384
main draws / 4,806,383 tris, `projected`, 723 candidates, 99 batches; deck 366 / 2,202,170,
`notWorthwhile`, 1665 candidates). Pixel differences were bounded against same-core controls: the
airborne 115 px at maxΔ6 sits under a 132 px same-core control, and the deck 9891 px at maxΔ195
reproduces with the core held fixed and is a bimodal deck-crew and propeller animation phase from
page-load timing, confined to one bounding box. Motion confirmed live: 59 of 60 frame transitions
moved player, ship, AI aircraft, propeller and a bone. Game gates all exit 0 — typecheck, vite build,
`check-particle-render` PASS, `check-fleet` PASS, `check-frame-transforms` PASS, launch playtest
`pass: true`. **No timing or FPS gain is claimed from this host.** Evidence:
`/tmp/midway-60fps/report-H.md`.

Installed and verified in the game on the same frozen deterministic fixtures (airborne state hash
960,838,321, deck 953,154,903, t = 30), reinstalling between legs:

| fixture | core | shadow renders / frame | shadow draws / triangles |
| --- | --- | ---: | ---: |
| airborne | `projdirty` | 2 | 316 / 1,788,928 |
| airborne | `projshadow` | **1** | **158 / 894,464** |
| deck | `projdirty` | 1 | 321 / 817,087 |
| deck | `projshadow` | 1 | 321 / 817,087 |

The authored sun's `shadow.autoUpdate` reads `true` on the old core and `false` on the new one while
airborne, and `true` on both on the deck, where projection declines. Main pass identical on both
fixtures (air 1384 / 4,806,383; deck 366 / 2,202,170) and `TN_RENDER_PROJECTION` byte-identical
(air `projected`, 723 candidates, 99 batches; deck `notWorthwhile`, 1665 candidates, 0 batches).

Pixels, stated against same-core controls rather than against zero: airborne cross-core 98 px of
2,073,600 at maxΔ5, inside the 51–286 px same-core range in the same 11-row gun-sight bounding box;
deck cross-core **0 px**, against a 7283 px same-core bimodal crew and propeller phase. Crops of the
airborne frame are visually identical; no shadow is lost.

The restore path was measured, not asserted. Forcing a decline at runtime: projecting `autoUpdate`
false with one 158-draw map; declined `autoUpdate` **true** with the authored map back at 135 draws /
413,614 triangles; re-projecting after the 60-frame rescan returns to false and 158 draws; and
`game.goto("midway")` teardown restores it false → true. Cross-core pixel difference at those states
is 7 px projected and 2 px declined. Game gates on the final tree all exit 0: typecheck, vite build,
`check-particle-render`, `check-fleet`, `check-frame-transforms` (ratio 1 every phase, `maxWorldDiff`
0) and the launch playtest `pass: true`. **No timing or FPS gain is claimed.** Evidence:
`/tmp/midway-60fps/report-I.md`.

Note recorded and out of scope: the projected (mirror) frame and the declined (authored) frame differ
by 1,985,767 px at maxΔ181, **identically on both cores**, so that gap predates these changes. It is
the same correctness question raised above — projection should be visually transparent — and it is
not waived.

Side effect worth keeping: with the duplicate shadow map gone, batching is no longer a draw wash at
this roster. Projected now totals 1542 draws (1384 main + 158 shadow) against 1741 declined
(1606 + 135), so the projection lane is genuinely ahead where it previously broke even.

### Delivered-tree timing, and why this host cannot answer the 60 FPS question

Three 30 s close-combat runs on the delivered tree (core `projshadow-bb0d10b1b34a` + the
`ctx.beforeRender` hunk), same fixture as the recorded baseline, load and GPU utilisation recorded
before and after each run:

| run | fps | hitches | update | render | hostGap | GPU | custom p50/p95 | step p95 | load before → after |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- | ---: | --- |
| off | 7.29 | 3 | 8.37 | 51.55 | 97.22 | 9.02 | 22.0 / 29.4 | 1.0 | 13.51 → 12.05 |
| on | 8.17 | 3 | 7.47 | 42.53 | 88.37 | 8.81 | 17.9 / 23.9 | 0.9 | 11.26 → 11.42 |
| off2 | 8.18 | 3 | 7.27 | 42.65 | 88.39 | 12.08 | 18.3 / 23.1 | 0.9 | 7.86 → 11.23 |
| baseline off | 5.95 | 6 | 16.74 | 121.19 | 93.79 | 10.40 | 47.2 / 121.9 | 3.0 | 12.9 → 25.5 across the three |
| baseline on | 7.35 | 4 | 9.34 | 63.31 | 90.52 | 8.42 | 23.6 / 40.6 | 1.1 | |
| baseline off2 | 8.31 | 3 | 7.78 | 49.96 | 80.88 | 2.98 | 22.6 / 28.7 | 0.9 | |

All three runs were live (sim advanced 21.1 / 23.8 / 23.0 s of 30 s wall, 200-233 AA events,
106-121 flak bursts, 11-15 damage events, player alive), and no run logged a console error.

**These absolute numbers are not comparable to the baseline and no FPS gain is claimed from them.**
The baseline ran at load 12.9 rising to 25.5 on 24 cores; these ran at 7.9-13.5. The delivered fps
is higher, and that is at least partly the lighter host. The admissible evidence is each quantity's
share of that run's own ACTIVE CPU, which cancels the profiler's idle differences:

| quantity | baseline share of active CPU | delivered share of active CPU |
| --- | ---: | ---: |
| `reconcile` inclusive | 23.64 % | **16.36 %** |
| `updateMatrixWorld` self | 8.70 % | 8.35 % |
| `renderShadow` + `updateShadow` inclusive | 16.37 % | 18.66 % |

`reconcile` fell materially, which is the change that was made. `updateMatrixWorld` self is flat,
because the walk that was removed was one of several — the mirror scene and the shadow pass walk
their own graphs, so halving the authored scene's composes (13,266 → 6,703) moves less of that
function than the count suggests. The shadow share *rose* as a fraction even though its absolute cost
fell (2034 ms → 1896 ms), because total active CPU fell further (12.42 s → 10.16 s over comparable
windows). Shares can move against you while the work goes down; both numbers are reported.

**Stable 60 FPS remains UNMET and this rig cannot decide it.** No run held a 16.7 ms frame; whole-frame
`render` mean was 51.55 / 42.53 / 42.65 ms. More importantly, `hostGap` — the time outside the game's
own callback — was 88-97 ms of a ~125-137 ms frame, roughly 70 % of it, while the game's own
`update + render` was 50-60 ms and the GPU 9-12 ms. The harness presents to a throwaway Xvfb display
on a host carrying an unrelated multi-day VM; the user observes 40-50 FPS on the same machine. So the
measured frame here is five to six times the user's, and the dominant term is presentation the game
does not control. Every optimisation in this session can only address the ~30 % that is game work.

The consequence for this PRD: **the 60 FPS verdict has to be taken on the user's own display**, and
the in-harness evidence must stay what it has been — deterministic counts (draws, triangles, shadow
renders, matrix walks and composes, projection verdicts) and profile shares, never frame times.

### Candidate 5: the water reflects 8 km past the range it can sample

Measured on the frozen airborne fixture. The reflection pass renders into a **960 x 540**
colour-only target (half the drawing buffer, `resolutionScale 0.5`, no MSAA) and costs **528 draws /
1,679,925 triangles**. What it draws: 272 exact meshes (1,088,470 tris) and 256 batched sub-draws
(591,455 tris) — the hero carrier 1.4-1.7 km away, three detailed US carriers at 17.8 / 18.1 /
19.1 km, Midway Atoll at 18.5 km, two floatplane scouts at 7.2 and 8.5 km, and about fifteen distant
LOD ships. Nothing airborne, no crew, tracers, particles or parked aircraft — those are already off
`REFLECTED_LAYER`.

`ocean.ts:21` sets `FAR_RANGE = 8000` and `ocean.ts:138` replaces the mirror read with a sky lookup
beyond it. So **338 of 528 draws (64 %) and 1,295,258 of 1,679,925 triangles (77 %) are provably
never sampled** by the conservative bounding-sphere-near-edge test — 473 draws / 1,452,565 triangles
by object centre. At 350 m the only reflection a player can see is the faint smeared hull and wake of
the carrier 1.5 km away; the 18 km ships and the atoll contribute nothing but sky and haze.

**No safe cut exists from game code, and the search for one is recorded rather than attempted.** The
only batch-neutral lever is the reflection camera's own frustum, and three's
`ReflectorBaseNode.updateBefore` overwrites `virtualCamera.near`, `far` and `projectionMatrix` from
the main camera on every reflection render (`three.webgpu.js:37988-37992`); setting the virtual
camera's far to 8000 every frame was measured to leave it at 95000 with the reflected draws
unchanged. Setting the *main* camera's far does cut the reflected pass (1383 → 918 draws) but culls
the main pass with it. Core's `WaterSurface3D` exposes no reflection near or far — its only
virtual-camera wrapper sets the layers mask. The remaining game-side lever, the per-object
`REFLECTED_LAYER`, is batch-keyed (`batchFlagsOf` keys on `layers.mask`, `castShadow`,
`receiveShadow`, `frustumCulled`) and so cannot be distance-gated per frame without repeating the
candidate-2 failure; and no object class is provably never sampled, since the atoll and the US
carriers come within a few kilometres in normal play. Evidence: `/tmp/midway-60fps/report-K.md`.

This is precisely a case the charter assigns to the engine: the game cannot write it portably because
the seam is inside Three's reflector, and the package chooses no appearance — the distance arrives as
a call argument, so the game can change the look completely without editing package code.

Candidate 5 is **blocked at the engine, and the block is physics, not effort.** An attempt to add a
`reflection.far` option to `WaterSurface3D` — validated, defaulting to today's behaviour, applied
from the existing virtual-camera wrapper — made the far value correct and still did not cull.
`ReflectorBaseNode.updateBefore` applies Lengyel oblique near-plane clipping after copying the
camera (`three.webgpu.js:38001-38033`), which swings the near plane onto the water surface and, in
Lengyel's own words, inescapably destroys the conventional far plane; three then derives the far
plane from the oblique row (`Frustum.js:116`), so `camera.far` has nothing to narrow. Measured
against the real `updateBefore` with a stub renderer:

```
camera.far 95000
plain   virtual far 95000  ndc@95000 0.2968  culls 20000: false  culls 100000: false
clamped virtual far  8000  ndc@8000  0.2575  culls 20000: false  culls 100000: false
ordinary camera            ndc@95000 1.0000  culls 100000: true
```

The option was reverted rather than shipped: an option that does not cull would be a false
capability, and the template contract would then document something that does not exist. No
`reflectfar` tarball was produced. Report-K's claim that setting the main camera's far cut the
reflected pass (1383 → 918 draws) is also **withdrawn**: the probe counted every non-shadow
render-target draw, and what fell was the main pass's own offscreen draws, whose projection is not
oblique. Evidence: `/tmp/midway-60fps/report-L.md`.

Two paths remain for a future attempt, neither of them the one tried: reconstructing a finite far
*after* the oblique pass (a second seam), or the per-object `reflection.layers` mask, which is
batch-keyed and cannot be distance-gated per frame. Both need a GPU re-measure, not a node test.

### Integration (2026-09-14, this session)

Both verified changes are committed locally in the primary checkouts. **Neither repository was
pushed**, and no worktree was removed.

- Engine `develop` `d78fe429d8e6ec483ca872219c35142a999e042a` —
  `fix(core): stop re-walking static scene transforms and drop the unsampled projected shadow map`.
  The `matrixWorldAutoUpdate` guard was already on primary as `3c78a7e22`, so the applied delta was
  the +146 lines in `projection-apply.ts` and the spec. From the primary:
  `pnpm --filter ./packages/core build` 0, `renderProjection.spec.ts` 0 (71 passed),
  `pnpm typecheck` 0. Packed as
  `.packages/threenative-core-0.3.2-projfix-b2629381e2dc.tgz`
  (sha256 `b2629381e2dc68cda0b05a6ac27c232799377a024ff7cabe45256724054da301`).
- Game `main` `63353412c550b308ae6161d3e06014abf83c9362` —
  `perf(midway): prepare scene transforms on the engine's per-draw seam`, which is
  `src/scenes/Midway.ts` plus the core repoint. Gates from the primary on its own port 5397:
  `pnpm install` 0, `pnpm typecheck` 0, `pnpm exec vite build` 0, `check-particle-render` 0,
  `check-fleet` 0, `check-catalog` 0, `check-frame-transforms` 0 (ratio 1.0 in all five views —
  44/44 briefing, 41/41 deck, 37/37 cockpit, 38/38 chase, 41/41 wide — `maxWorldDiff` 0, adapter
  nvidia/turing), launch playtest `pass: true`. The port was released afterwards.

Left untouched because they belong to other lanes: the engine's
`packages/core/mcp/engine-server.mjs`, which went dirty mid-session, and every other worktree and
its dirty files. Evidence: `/tmp/midway-60fps/report-N.md`.

### Where this leaves the loop

Removed per presented frame, by deterministic count rather than by timing:

| | before | after |
| --- | ---: | ---: |
| authored-scene transform walks | 2 (one of them forced) | **1** |
| `updateMatrix` composes | 13,266 | **6,703** |
| shadow map renders (airborne, projecting) | 2 | **1** |
| shadow draws / triangles (airborne) | 316 / 1,788,928 | **158 / 894,464** |
| `reconcile` share of active CPU | 23.64 % | **16.36 %** |

Four candidates were rejected with their evidence rather than shipped: per-object `castShadow`
distance gating (splits the engine's batch groups and makes projection decline), gating the sun light
itself (no pixel-neutral altitude exists, and an airborne start with the only shadow light off
crashes three's `ShadowNode`), the double-shadow-render hypothesis (disproved — it was two lights,
which is what led to the fix that shipped), and a reflection far plane (oblique clipping destroys the
far plane).

**AC-5 is still unmet, and this harness cannot settle it.** The next work needs one thing this
session could not get: a frame-time measurement on the user's own display, unloaded. Until then the
ranked remaining targets, all CPU draw submission, are: the reflector pass at 528 draws / 1.68 M
triangles with 64 % of it provably unsampled (blocked on the oblique far plane; the two remaining
approaches are named above), `scanProjection` at roughly 11.5 % of active CPU re-deriving an almost
never-changing classification every projecting frame while the *declined* path already has a
60-frame cadence guard, and the main camera pass itself at about 856 draws.

