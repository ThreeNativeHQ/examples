# PRD-midway-flak-hunt-20260914 — Trace corruption and combat profiling

**Status:** IN PROGRESS — full-roster audit rejected particle mesh hooks; rolled back, engine frame-preparation seam under investigation
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
- [ ] AC-3 [local; actor: agent]: Rank measured hotspots and smallest root-cause fixes; verify any implemented correction with a focused check and real rendered frame.
- [ ] AC-4 [local; actor: agent]: Record limitations and exact commands here, preserve unrelated work, and audit the isolated checkout for cleanup.
- [ ] AC-5 [local; actor: agent]: Verify the 16.7 ms frame target under representative deck, cockpit, battle/flak, water-impact and recovery workloads, including sustained testing; report unmet budgets explicitly. Hidden-display cadence is not proof of real-play presentation FPS.

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
