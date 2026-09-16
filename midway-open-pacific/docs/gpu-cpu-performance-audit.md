# Midway GPU/CPU offload audit

Read-only research; no source was changed and the only deliverable is this file. Measured at
worktree HEAD `dcd83dc`. Candidate status was checked against engine HEAD `ef422907` (read-only,
`packages/`, `.worktrees/` excluded). Everything below is measured on this HEAD or labelled
inspection/historical/hypothesis.

## 1. Summary

**Most of the visual work already runs on the GPU; the engine improvements still worth testing are
narrower than a general offload push.** The GPU carries ocean shading, particle motion, skinning and
the render passes. What remains is pass-budget pressure on sea-filled 1080p, one game-fixture CPU
spike, and a present/wall deficit this instrumentation cannot attribute. The first engine candidates
are better resolution-controller *diagnostics* and an opt-in
GPU-tail scaling *experiment* (conditional); the ripple-sleep idea is rejected under the current
contract, and the instanced-upload idea is a low-occupancy optimization worth measuring before
believing. Three things must be kept apart, because a p95 series from moments that were not sampled
together cannot establish a whole-frame bottleneck.

1. **GPU pass budget pressure — measured, real on sea-filled 1080p.** Resolved `timestamp-query`
   render-pass time reaches p95 **16.40 ms** (natural, 1920×1080), **17.29 ms** (cockpit,
   1920×1080), **18.71 ms** (water-impact, 1920×1080). Two of the three sit above the AC-23
   16.67 ms absolute line — **one run each, no repeat, no matched baseline** — so that is an
   observational miss, not a "regression". The historical AC-23 ablation (hiding the ocean mesh
   collapsed p95 to 4.66 ms) is evidence that fill is a large contributor; it is not a current
   isolated proof, and it does not say fewer pixels fixes every GPU workload. The GPU series is also
   a subset of observations: the combat window resolved **74 of 300** frames (`gpuStale 226`,
   `gpuAgeFrames 4`), and the fixture raw `gpu` arrays hold 151/193/188 observations, roughly half
   of them adjacent duplicates (75/96/94). This is pass-budget pressure; it is not proof the whole
   frame is GPU-bound.
2. **Measured CPU work — small, except one fixture.** Fixed-step sim p95 0.70/0.70/1.00 ms
   (natural/cockpit/water-impact). Wrapped CPU p95: `renderCpu` 5.00/6.91/12.80, `sceneUpdate`
   1.60/1.70/8.30, `worldUpdate` 0.60/0.60/7.20, `rippleUpdate` 0.20/0.20/**6.50**,
   `updateRenderCpu` 10.13/12.00/**48.73**. Only the water-impact fixture shows a multi-ms CPU
   spike.
3. **Present/wall delay — measured, not attributable from this instrumentation.** The performance
   tool's `wall` p95 is 333/317/417 ms. The real-combat `frameBudget` window reports `fps 12.53`
   with `frame` work mean **17.23 ms** against `presented` mean **79.82 ms**, and `hostGap` mean
   **70.75 ms = 88.6 %** of the presented interval (`p95 105.2`, `max 1711.2`). The runner measures
   `wall` as the delta between `requestAnimationFrame` callbacks whose body `await`s
   `renderer.resolveTimestampsAsync("render")` before re-arming
   (`tools/capture-performance.mjs:1085–1087`), and the battle tool itself labels its rAF ring "a
   presentation cadence on the virtual display, not a physical FPS claim"
   (`tools/capture-battle-profile.mjs:100`, `limits`). The best available explanation for 12.5 FPS
   and the 300–400 ms wall is a headed-Chromium-on-Xvfb present/scheduler cadence plus the
   harness's own asynchronous readback delaying the next sample; the split between browser
   scheduler, virtual-display compositor and harness readback is **not recoverable** from what was
   recorded, and O7 below stays unattributed. `hostGap` is measured outside the timed callbacks, so
   GPU waits, browser work, native CPU and other work may all contribute. Corroboration: the new
   combat CPU profile is **78 % `(idle)`**, the per-method fixed-step series are all p95 ≤ 0.7 ms,
   and `writeBuffer` self time is ~89 ms across a 21.1 s profile.

The current division of labour described above (see also §4) keeps simulation and the synchronous
exact-height path on the CPU. The visual ripple/whitewater CPU path is **not** a "must": the field
is render-only and no authoritative gameplay reads it (§R2). Nothing measured here shows a CPU
offload error; nothing measured here shows a whole-frame GPU bottleneck either. The engine
mechanisms below are source-backed hypotheses, not measured speedups.

## 2. Candidates

### R1. Engine: resolution-controller diagnostics are the definite candidate; GPU-tail scaling is a conditional experiment
**Severity: medium. Inspection + measured context; hypothesis, not a measured speedup.**
**Seam:** `ResolutionScaler.observe` in `@threenative/core` (installed
`node_modules/@threenative/core/dist/index.js:8601–8642`; engine HEAD
`packages/core/src/resolution-scaler.ts:243–286`, same decision logic). A down-step needs
`window.fps < targetFps && (gpuMs === undefined || gpuMs > budgetMs)` (`:8619`), corroborated by
`#overBudget` (`presented.p50 > budgetMs || presented.p95 > tailMs`, `:8705–8707`), where `gpuMs` is
the **window mean** of fresh resolved readings (`gpu.mean`, `:3279`) gated by
`#freshGpuMs`/`maxGpuAgeFrames = 8` (`:8708–8710`). A step is `0.72×` pixels, bounded by the rung
ladder (index 0 … `rungs.length-1`), `maxDownRungs 4`, `warmupWindows 1`, `cooldownWindows 1` and
the oscillation guard (`:8490–8528`); `surface` already reports
`resolutionScale/scaleSource/atFloor`.
**What Midway shows:** at combat `gpuMs 7.63 ≤ 16.67` with `gpuStale 226/300` (74 fresh samples),
the scaler holds at `scale 1 (auto), atFloor false` (`frameBudget.latest.surface`) — the designed
"present-bound, do not spend a rung" behaviour, not a bug, and it must not be changed to scale on
fps alone.
**Definite candidate — diagnostics:** add `surface.reason`
(`held: gpu headroom | stale gpu | warmup | present-bound`) plus the resolved-frame fraction to
`TN_FRAME_BUDGET`, so a breach like the cockpit 1080p p95 is diagnosable instead of guessed at.
This does not change pixels or appearance.
**Conditional experiment — GPU-tail scaling:** accept the over-budget branch when the window's
already-computed GPU `p95` exceeds `budgetMs`, not only the mean. It must preserve the existing
freshness checks (`maxGpuAgeFrames`/`#freshGpuMs`), an adequate resolved-sample count, the
sustained-window hysteresis (warmup/cooldown/up-windows/oscillation guard), the min/max rung and
quality bounds, and the named explicit override — `renderer.resolutionScale: "auto" | number` and
`renderer.android.resolutionScale` (installed `:6546–6566`; Midway sets `"auto"` in
`threenative.config.ts`). **Do not** prescribe unconditional p95-based downscaling from sparse or
duplicate readings: the combat window resolved 74/300, and the fixture arrays are about half
duplicates. Changing scale affects image sharpness, so it is a look tradeoff, not free.
**Acceptance:** (1) a window whose GPU samples are stale or too sparse keeps the same scale; (2) a
CPU/present-bound window stays at scale 1 and reports `held: present-bound`; (3) an explicit
`renderer.resolutionScale` is respected; (4) **as an experiment**, a sustained run of fresh GPU-tail
pressure (`gpu.p95 > budgetMs` while the mean is under) steps down. No measured speedup is
asserted; native proof is a `--target` playtest that prints the marker and a step.
Document the default diagnostics and existing scale overrides in the template instructions.

### R2. Engine `RippleField`: quiet-field sleeping is rejected under current semantics; the offload question is the game's water cost
**Severity: medium. Measured bucket + inspection + MCP contract.**
**Seam:** `RippleField.advance/#integrate/#transportFoam` (installed `index.js:16121–16196`).
`#empty` is cleared by the first impulse/foam and restored only by `reset()` or an out-of-range
recenter (`:16027–16034`, `:16094`, `:16241`); `#integrate` early-outs only while `#empty`
(`:16136–16140`). Once any impact lands, the full interior loop — **36,864 cells at resolution 192,
not 147 k** (147,456 is the game's `n*n*4` half-float conversion count, `src/render/ripples.ts:31,42`)
— runs every `step` plus 30 Hz foam transport, even after every wave has decayed. `#empty` is exact
all-zero equality, not "small".
**Rejected under current semantics — automatic approximate sleeping.** The engine documents that an
epsilon or energy threshold "would delete a real wave that had simply got far from the camera"
(installed `:15966–15971`; engine HEAD `packages/core/src/ripple-field.ts:85`). Keeping `#empty`
physically exact is that rejection, not an available optimization; engine HEAD shows no activity or
skip path. A caller-chosen tolerance or an approximate visual mode **could** enable sleeping, but it
requires caller cooperation (the game accepts a visible approximation of a quiet field) and cannot
be sold as free.
**Isolate first — the 6.5 ms bucket does not prove solver cost.** The measured `rippleUpdateCpu`
bucket wraps `world.ripples.update` (`tools/capture-performance.mjs:975`), which includes
`cacheHulls` + game `Whitewater.step` (12,000 parcels, several
`heightAt`/`hullHeightAt`/`flowAt` samples each, `src/render/whitewater.ts:51–125`) + game
`WaterEffects.render` (sheet vertex writes, `src/render/water-effects.ts:176–201`). Split
`RippleField` from the game `Whitewater`/sheet cost on the same fixture before acting.
**What a GPU ripple would have to preserve.** (1) One same-tick height both the shader and the CPU
parcels read, so a parcel crossing the surface agrees with the rendered surface; (2) synchronous
feedback from CPU parcels (`Whitewater.step` calls `wave.impulse`/`depositFoam` many times per
impact) back into the field. `GPUReadback` cannot satisfy (1): its contract is an asynchronous,
throttled copy that is "never this frame" and carries `staleFrames`
([GPU buffer mapping](https://gpuweb.github.io/gpuweb/#buffer-mapping)). `FluidField2D` is a GPU
velocity+dye grid with game-owned appearance, not a drop-in heightfield. `SpectralOcean` is a
different spectral swell simulation (cascaded spectra inverse-transformed on the GPU each frame),
not a ripple replacement. `RippleField`'s own contract is "add its height to an analytic swell,
never in place of one" (MCP `RippleField` detail). A GPU field plus a coarse CPU proxy for the read
path, or a coupled GPU visual feedback design, is worth a design note — **not** a new abstraction as
the first choice, and not a switch.
**Key finding:** no authoritative gameplay reads the ripple. `src/sim/` reads no ripple
height; `world.ts:663–665` only sets hull pose from `ripples.heightAt` (swell plus ripple). The
coupling is a **visual** tradeoff, not gameplay determinism, so a coarse CPU proxy is viable for
looks and is not blocking authoritative simulation.
Any engine GPU backend proposal still needs native conformance or a `--target` playtest before adoption.

### R3. Engine: upload only the live prefix of dynamic instanced data
**Severity: low-medium. Source-backed hypothesis; no isolated measurement.**
**Seam:** three r185's WebGPU backend already performs partial `queue.writeBuffer` from
`attribute.updateRanges` (`node_modules/three/build/three.webgpu.js:81215–81266`), and ranges are in
attribute **components** — three's own
`addUpdateRange(vertexStart*itemSize, count*itemSize)` (`three.core.js:26721`). Engine
`ClusteredBatch.#applyCut` already ranges its geometry index (`index.js:12738`) but re-uploads the
full `instanceMatrix` (`:12735`); engine HEAD `packages/core/src/clustered-batch.ts:398–403` does
the same — `instanceMatrix.needsUpdate = true` while only the index is ranged. **The smallest engine
change is therefore to the existing `ClusteredBatch` owned buffers where a live-prefix consumption
is proven, not a new one-use helper.** `InstancedBatch.build` is one-shot (`:12420`);
`GPUParticles3D` always processes and draws `amount` (`:15306–15311`), so a live count there is a
semantic addition, not a drop-in.
**Midway case:** `particles.writeBatch` writes the live prefix, sets `instanceCount = count`, then
marks **every** instanced attribute dirty (`src/render/particles.ts:360–367`) → a full-capacity
upload per world draw. For Midway's custom particles this requires caller range marking or adoption
of an existing engine path; arbitrary JS particle systems cannot be optimized automatically.
**Partial-upload caveats:** ranges are in components, not instances; a backend may clear ranges
after upload; the buffer still needs its initial full allocation; an empty count should avoid
marking dirty, and an empty ranges list may mean "full upload" rather than "nothing"; count
shrink/grow and visibility changes invalidate a naive live prefix.
**Acceptance:** uploaded-byte counters fall with unchanged captured frames (visual parity). Web and
native are **unverified until actually run**; do not claim WebGL or native proof from source
inspection. Honest caveat: the largest proportional saving is at **low occupancy**, and full
capacity saves nothing. The only measurement is the **historical** Sept-14 `writeBuffer`
1.34 ms/frame total — all buffer uploads, not particle cost — and the new combat profile does not
show it as a hotspot. Measure the flak/water phase before believing the gain.

### R4. Assets: renderer-reported texture allocation estimate is ~1.03–1.04 GiB, and the engine's compression pass is unused
**Severity: low on web; gate for any native claim. Measured counters + inspection.**
**Measured** (`renderer.info.memory` in the tool's stdout): natural `textures 216`,
`texturesSize 1,110,074,463 B = 1.034 GiB`, `total 1,173,813,101 B = 1.094 GiB`; water-impact
`textures 230`, `texturesSize 1,119,951,546 B = 1.043 GiB`, `total 1,188,026,809 B = 1.107 GiB`;
cockpit `1346.9 MiB` total. These are three.js's own allocation estimate, **not confirmed driver
resident VRAM** — API counters do not establish physical residency. The scene census counts 322
textures; the renderer counts resident ones by its own map.
The existing engine mechanism is `@threenative/assets` — `texturePass` (KTX2/Basis mipmapped
textures; HEAD `packages/assets/src/passes/texture.ts`), `modelPass` (GLB geometry +
embedded-texture passes; `packages/assets/src/passes/model.ts`), `compileAssets` (project
pipeline), with the manifest's 4-divisible-source rule and a `codec:"none"` fallback. Midway ships
WebP/PNG GLBs (`docs/asset-provenance.md`, `tools/import-*.sh`), so residency is uncompressed.
Requested texture format and resolution are **game controlled**; the engine can provide compression,
loading and caching defaults with a supported-format fallback. **No automatic memory saving is
claimed.** Native implications are **unverified**.
**Acceptance:** `texturesSize` falls with unchanged captured frames, plus a native `--target` memory
report. The perf skill's ~500 MiB driver floor is a host reference, not a game pass/fail threshold.

### R5. Game: bound the one measured CPU spike, and time it rather than infer it
**Severity: medium (the only measured CPU miss). Measured.**
Water-impact `updateRenderCpu` p95 48.73 ms vs 10.13/12.00 elsewhere; `rippleUpdateCpu` 6.50 vs
0.20; 8 accepted impacts / 9 scheduled events; `whitewaterMax` 4263 parcels; `energyMax` 17.06.
**Smallest concept:** cap solver substeps or freeze the field/whitewater when no event is near and
the field is quiet (the recenter logic already tracks the action, `src/render/ripples.ts:62–67`),
then re-measure on the same fixture. Game-owned; no blind look change. **Acceptance:** rerun the
water-impact command and compare `rippleUpdateCpuP95` and `updateRenderCpuP95` in the JSON, with the
near-water frames captured before/after.
**Attribution limit:** independently measured sub-series p95s cannot be summed or subtracted to
decompose `updateRenderCpu` p95 — nested buckets and separately resolved percentiles do not add, and
the wrappers charge a nested call once to its outer caller (`tools/capture-performance.mjs:960–982`).
Current instrumentation can name which wrapped buckets exist; it cannot attribute the remainder. If
attribution matters, add a same-frame exclusive timer around each `beforeRender` callback on the
fixture.

## 3. Measured results

Isolated worktree server `pnpm exec vite --port 5388`; headed Chromium 151.0.7922.34 via
`tools/capture-lock.sh` (private Xvfb; **not** headless) with `--browser-recipe webgpu --headed`;
adapter verified in-page `nvidia/turing`, `WebGPUBackend`, DPR 1. Host: Linux 7.2.3 cachyos,
AMD Ryzen 9 5900X, RTX 2080 (driver 610.57.04); Node 20.19.6, pnpm 10.25.0. Seed 19420604. Fixed
step: the game sets `step: 1/60` (`src/game.ts:16`), so the simulation rate is 60 Hz; the battle
`sample.substeps` mean 3.61 (max 5) per presented frame is catch-up multi-stepping at a slow
presented cadence, **not** the simulation rate or speed. The engine's own hitch rule excluded the
one startup stall (`hitches 1`, presented max 1094 ms).

| Run | GPU p50 / p95 ms | Fixed-step CPU p95 | renderCpu p95 | ripple p95 | updateRender p95 | Draws / tris | Verdict |
|---|---|---|---|---|---|---|---|
| Natural airborne, 1920×1080, 8 s + 30 s, 22 ac | 11.96 / **16.40** (151 obs) | 0.70 | 5.00 | 0.20 | 10.13 | 56 / 270,697 | PASS but AC-23 NON-QUALIFYING (30 s sample; 22 < 68 envelope) |
| Cockpit, 1920×1080, 8 s + 60 s | — / **17.29** | 0.70 | 6.91 | 0.20 | 12.00 | 353 / 2.42 M | FAIL gpuP95 (single run, observational) |
| Water-impact, 1920×1080, 8 s + 60 s, 8 impacts | 14.66 / **18.71** (188 obs) | 1.00 | 12.80 | 6.50 | 48.73 | 361 / 758,320 | FAIL gpuP95 (single run, observational) |
| Real combat, 1600×900, 8 s + 20 s, 104 aa / 108 flak | gpu mean 7.63, p95 15.56 (74/300 fresh) | 0.70 | 6.00 (`render` method) | 0.20 | — | main draws mean 134.7, p50 145 | diagnostic only |

**Attribution of the two `gpu` series.** The three fixtures' raw `gpu` arrays are the *runner's own
per-rAF observation*: the callback `await`s `renderer.resolveTimestampsAsync("render")` and records
`renderer.info.render.timestamp` (`tools/capture-performance.mjs:1085–1087`); the reported p50/p95
are over those observations. `resolveTimestampsAsync` awaits **asynchronous** readback, which delays
the observer's next sampling callback; it is not a synchronous GPU readback, and a delayed observer
sample is not the game's rAF cadence. The arrays hold 151/193/188 observations with adjacent
duplicate/stale readings (75/96/94 adjacent duplicates) — **observation counts, not proven unique
resolved frames**. The battle run's `frameBudget.gpu` is a **separate engine `TN_FRAME_BUDGET`
window** (`tools/capture-battle-profile.mjs:84–121`, `:750–756`), not the capture-performance series;
the two are not automatically the same FrameBudget series. `wall` p95 (333/317/417 ms) is the
runner's rAF delta between those awaited callbacks, not a game number. Draws/tris: the three
fixtures report the **final** `renderer.info.render` readings at sample end (`draw calls …
triangles …`, tool stdout); the battle run reports the engine's **per-frame pass series**
(`p50/mean/…`, main pass `draws` mean 134.7, p50 145). All runs are single-shot: within-run
distributions only, run-to-run variance unmeasured, another lane captured concurrently and
`capture-lock.sh` serialised browser access.

## 4. Steady-state CPU/GPU ownership map (with source)

| Frame stage | Owner | Where | Evidence |
|---|---|---|---|
| Fixed-step sim (AI, weapons, damage, radio, intel, sortie) | CPU, engine loop + game rules | `src/sim/battle.ts` stepped by the engine fixed-step loop (`step: 1/60`, `src/game.ts:16`); flight constants `src/sim/flight.ts:27–134` | p95 ≤ 0.3 ms per method; leaf-step p95 0.4–1.0 ms all runs |
| Swell height for buoyancy/collisions | CPU analytic, mirrors GPU | `WaveField.heightAt` via `src/render/ocean.ts:25–28`; 4 taps/hull `src/render/ship-motion.ts:44–47` | Exact, synchronous, allocation-free scalar path; CPU keeps this |
| Ripple/foam solver + whitewater (render-only, no gameplay read) | Engine `RippleField` + game `Whitewater` | `RippleField` 192² (`src/render/ripples.ts:10`), stepped `ripples.ts:55–81`; `Whitewater.step` `src/render/whitewater.ts:51–125` | `world.ripples.update` bucket p95 6.5 ms water-impact; `src/sim/` reads no ripple height — hull pose only (`world.ts:663–665`), i.e. swell **plus** ripple, not ripple alone |
| Particles (smoke/fire/sparks) | GPU motion, CPU spawn+upload | TSL vertex anim `src/render/particles.ts:29–52`; full-attribute upload `:367`; spawn `update()` | Motion offloaded; upload not bounded by live count, R3 |
| Ocean surface shading | GPU (TSL) | `src/render/ocean.ts`, range-gated viewport reads | Fill-bound; pass budget pressure, R1/historical AC-23 |
| Reflection + shadows | GPU passes, CPU traversal | Reflector + shadow `renderShadow` (Sept-14 trace: historical CPU cost) | No change proposed |
| Scene traversal / submission | CPU (three.js) | `scene.updateMatrixWorld()` once per world draw (`src/scenes/Midway.ts:81`); static opt-outs `src/render/world.ts:561–593` | New CPU profile shows `updateMatrixWorld` self cost spread across call paths; pass-gate culls still run per frame |
| Animation / deck crew | GPU skinning, CPU clip advance | Engine `AnimationPlayer`/`SkeletalMesh3D` | Trivial population; no finding |
| HUD | CPU canvas 2D, once per presented frame | `hud.draw()` in `beforeRender` (`src/scenes/Midway.ts:90`); state split `src/hud.ts:84–92` | `overlay 0 ms` in the battle window is **not** zero cost: the HUD draws inside `render`, and overlay only measures engine overlay work |
| Audio | CPU WebAudio, event-driven | engine audio bank | No JS hotspot; WebAudio processing can run off the JS thread and is not fully visible to a JS profile |
| Draw collapsing | deliberately off | `renderer.projection:false`, `minimumProjectedPixels:2` (`threenative.config.ts:29–39`) | The decline keeps the historical Sept-14 `14.94 ms/frame` measurement cited, and that trace itself notes it does not prove disabling projection improves the same frame. `minimumProjectedPixels:2` stays on; the cull runs per render camera and is not timed separately |

## 5. Other findings

| # | Issue | Severity | Basis | Owner / next check |
|---|---|---|---|---|
| O1 | GPU signal is intermittent: 74/300 fresh readings in the combat window (`gpuStale 226`) | medium | measured | engine / fold the resolved-frame fraction into `surface` (R1) |
| O2 | 6,694 objects / 2,205 meshes traversed per frame for 56–361 draws; `updateMatrixWorld` self time spread across paths | medium | measured (census + new CPU profile) | game / per-view object census before traversal work |
| O3 | `Math.max(...field.height)` spread over **36,864** cells in `ripples.peak()` (`ripples.ts:83`) — stack-risky and O(n) | low | inspection | game; tool-only caller (`capture-ripples.mjs`); cap or loop |
| O4 | `battle.effects.filter` + torpedo spreads per tick (`ripples.ts:61,79`) and `seen`-set rebuild at >650 | low | inspection | game / revisit only if the water fixture is being optimised |
| O5 | Nearest-impact scan O(impacts) with `Math.hypot` per effect per tick (`ripples.ts:64`) | low | inspection | game / fine at current counts |
| O6 | Cockpit draws 2.42 M tris / 353 draws vs 271 k / 56 airborne | info | measured | game / feeds the scaler decision, not an offload |
| O7 | Large observer intervals and time outside measured engine callbacks remain unattributed; the combat `fps 12.53` window and capture-performance's sparse observer intervals are different instruments | medium | measured, unattributed | harness/engine / trace engine frames, observer callbacks, browser scheduling and GPU completion together before assigning a cause |
| O8 | Tier-4 thermal, native/desktop/Android/iOS, load/shader-compile time | unverified | not run | future work; `docs/startup-and-resolution.md` covers load separately |

## 6. Installed vs engine HEAD

Engine HEAD inspected read-only at `ef422907` (`packages/`, `.worktrees/` excluded). Four candidate seams:

| Candidate | Installed tarball | Engine HEAD `ef422907` | Status |
|---|---|---|---|
| R1 resolution controller | `ResolutionScaler.observe` mean-based, no `surface.reason` | `packages/core/src/resolution-scaler.ts:243–286` — same decision logic, `#overBudget` p50/p95 tail, `maxGpuAgeFrames 8`, no `reason` | **Same behaviour; not addressed upstream** — diagnostics and p95-tail experiment remain valid |
| R2 ripple sleeping | `RippleField` exact `#empty`, no activity skip | `packages/core/src/ripple-field.ts` — same `#empty` gate and same "delete a real wave" objection at `:85`; no activity/quiet path | **Same behaviour; not addressed upstream** — rejection stands |
| R3 live-prefix upload | `ClusteredBatch.#applyCut` ranges index, full `instanceMatrix` | `packages/core/src/clustered-batch.ts:398–403` — `instanceMatrix.needsUpdate` with only the index ranged | **Same behaviour; not addressed upstream** — smallest change is here, not a new helper |
| R4 texture compression | `@threenative/assets` KTX2 passes ship in the tarball | `packages/assets/src/passes/texture.ts`, `passes/model.ts`, `compile.ts` — KTX2/Basis passes present | **Mechanism already upstream** — only game adoption of the pass is open, no engine fix proposed |

## 7. Evidence, commands, limitations

**Engine/capability evidence.** The installed manifest is `node_modules/@threenative/core/capabilities.json`
(v2, 297 entries). Live MCP capability calls were performed and their full responses preserved as
`screenshots/gpu-offload-audit-20260916/midway-gpu-audit-capability-{evidence,extra}.json`.
Searches covered the full request plus particles/batching/framebudget/waves/animation; details were
fetched for `FrameBudget`, `renderer.projection`, `GPUParticles3D`, `WaveField`, `AnimationPlayer`,
`ComputeDrivenRegistry`, `SkeletalMesh3D`, `GPUReadback`, `RippleField`, `FluidField2D`. **MCP
manifest scope ≠ installed manifest**: `WaterEffects` is a **game** class — the detail call returned
`Unknown engine capability 'WaterEffects'`. General WebGPU API statements are cited from primary
docs ([three.js Backend](https://threejs.org/docs/pages/Backend.html) for timestamp-query support
and async readback; [GPU buffer mapping](https://gpuweb.github.io/gpuweb/#buffer-mapping) for
`mapAsync` waiting on GPU completion), but the installed bytes govern: three r185 is what was
inspected. No feature is claimed from the live web version. Findings describe the tarballs below;
engine HEAD is compared separately in §6, and anything lifted must be re-verified there.
`RippleField`/`GPUReadback` constraints quoted are the installed contract.

**Engine artifacts measured** (immutable tarball names verified by sha256):
`core-0.3.2-tracerfix-0c2c923dc202`, `physics-0.3.2-midway-d5f4b4747fc7`,
`ui-0.3.2-midway-68eb08c22fc6`, `playtest-0.3.2-consolidated-0bcb4f36a906`,
`assets-0.3.2-midway-31630a90db89`, `runtime-native-0.3.2-midway-4662ac5aa85a`.

**Exact commands** (all measured on worktree server `:5388`; set `MIDWAY_SAMPLE=60` explicitly rather than relying on the default for the two fixtures):

```sh
pnpm exec vite --port 5388   # in the worktree, once per session

MIDWAY_URL=http://127.0.0.1:5388 MIDWAY_WIDTH=1920 MIDWAY_HEIGHT=1080 MIDWAY_WARMUP=8 \
MIDWAY_SAMPLE=30 MIDWAY_BASELINE_OUT=/tmp/gpu-audit/natural-airborne.json \
bash tools/capture-lock.sh node tools/capture-performance.mjs

MIDWAY_URL=http://127.0.0.1:5388 MIDWAY_WIDTH=1920 MIDWAY_HEIGHT=1080 MIDWAY_WARMUP=8 \
MIDWAY_SAMPLE=60 MIDWAY_WORKLOAD=cockpit MIDWAY_BASELINE_OUT=/tmp/gpu-audit/cockpit.json \
bash tools/capture-lock.sh node tools/capture-performance.mjs

MIDWAY_URL=http://127.0.0.1:5388 MIDWAY_WIDTH=1920 MIDWAY_HEIGHT=1080 MIDWAY_WARMUP=8 \
MIDWAY_SAMPLE=60 MIDWAY_WORKLOAD=water-impact MIDWAY_BASELINE_OUT=/tmp/gpu-audit/water-impact.json \
bash tools/capture-lock.sh node tools/capture-performance.mjs

MIDWAY_URL=http://127.0.0.1:5388 MIDWAY_BATTLE_OUT=/tmp/gpu-audit/battle \
MIDWAY_WIDTH=1600 MIDWAY_HEIGHT=900 \
bash tools/capture-lock.sh node tools/capture-battle-profile.mjs
```

**Preserved raw evidence** (copied with no clobber from `/tmp`; the `/tmp` copies are temporary).
The destination is the primary's ignored `screenshots/*` area; create only this directory:
`/home/joao/projects/threenative/sandbox/midway-open-pacific/screenshots/gpu-offload-audit-20260916/`

- `natural-airborne.json`, `cockpit.json`, `water-impact.json` (per-run baseline JSON)
- `battle/battle-profile.json`, `battle/battle-combat.cpuprofile`,
  `battle/battle-start.png`, `battle/battle-final.png`
- `midway-gpu-audit-capability-evidence.json`, `midway-gpu-audit-capability-extra.json`
- `capture-stdout.log` (full run stdout, including the `renderer.info.memory` lines and the exact
  command echo)

**Limitations.** One run per workload; no repeats, so run-to-run variance is unknown and the two
above-threshold GPU p95s are observational. Combat ran with CDP CPU sampling at 1000 µs
(`MIDWAY_CPU_PROFILE` default), which biases CPU; set it `0` for throughput. The virtual display is
Xvfb, so `wall`/`hostGap` are present-cadence numbers, not physical FPS. Tier-4 thermal, native,
desktop, Android and iOS remain unverified.

## 8. Document checks

Paths verified on worktree HEAD `dcd83dc`: `src/sim/flight.ts`,
`src/render/{ocean,ripples,particles,ship-motion,hull-query,whitewater,water-effects,world}.ts`,
`src/scenes/Midway.ts`, `src/game.ts`, `src/hud.ts`, `threenative.config.ts`,
`tools/{capture-performance,capture-battle-profile}.mjs`, engine installed
`node_modules/@threenative/core/dist/index.js` and
`node_modules/three/build/three.webgpu.js`, engine HEAD
`packages/{core/assets}/src/…`, `docs/perf/AC-23-findings.md`, and the primary-only
`docs/performance-trace-20260914-214518.md` (historical). Every measured number above points at a
§7 command and a JSON or stdout field; every inspection claim points at a file:line. Only this
report is changed (plus the preserved evidence directory, ignored).

---

# Execution log — 2026-09-16

The audit above is read-only research. This section records what was **executed** from it, what it
cost, what was measured, and what was rejected on measurement. Engine work landed in
`threenative-engine` as `e530e74a5`; the game work is the commit carrying this section.

## 0. A methodology correction that invalidates part of the audit's own evidence

**Cross-batch comparison is not valid on this host.** The audit's numbers, and this session's first
four measurement batches, compared runs captured minutes-to-hours apart. Over one afternoon the same
unchanged code path measured `gpu` p95 anywhere between **4.17 ms and 17.96 ms**, and
`updateRenderCpu` p95 between **34.10 ms and 40.60 ms**. The host runs other lanes: load average
reached 7.3 with an Android emulator at 163 % CPU and a second Chromium capture running.

Two wrong conclusions were drawn and then reversed inside this session:

- A batch measuring the engine bump appeared to regress natural-airborne `renderCpu` by 13.9 % and
  `gpu` by 24.9 %. A later batch with **no engine change at all** regressed the same workload
  *more*. The regression was drift, not code.
- The engine fix first measured as −19.1 % cross-batch. Interleaved it is **−8 %**. The
  cross-batch figure was drift-inflated and is not used.

**Every number below is from an interleaved A/B**: `stock` and `mine` alternate back to back on the
same machine state, three pairs, switching the engine tarball and the game source between runs
(`scratchpad/abx.sh`). Where the fixture accepted a different number of impacts on the two sides,
that pair is reported but excluded from the headline, because fewer impacts is less work.

## 1. R5 — the measured CPU spike: root cause found, and it was not where the audit looked

The audit named the water-impact `updateRenderCpu` p95 as the only measured CPU miss, and proposed
capping solver substeps or freezing a quiet field. A CPU profile of the fixture (added for this, see
§4) found neither was needed. Busy CPU was 33.7 % of wall, and of that:

| self % of wall | function | owner |
|---|---|---|
| 9.02 | `RippleField.#integrate` | engine |
| 3.82 | `WaveField.#evaluateCpu` | engine |
| 1.74 | `Whitewater.step` | game |
| 1.45 | `hull-query.heightAt` | game |
| 1.01 | `RippleField.#transportFoam` | engine |

`#integrate` alone was **27 % of all busy JS**. Its loop is clean typed-array code, but it ran at
~30 ns per cell — 6–15× slower than a stencil of that shape should cost. The cause was one call:
`Math.hypot(gx, gz)`, the breaking-crest gradient magnitude. V8 implements hypot as an
overflow-safe scaling algorithm; measured against `Math.sqrt` of the squares on this data it is
**32.4 ns vs 5.1 ns per cell, 6.4×** — enough to account for the entire solver.

The substitution is **not** bit-identical: sqrt-of-squares loses up to **2 ulp** when one component
is negligible beside the other, measured over 173,056 gradient pairs. It is licensed only because
this magnitude reaches `foam` alone — never `height`, never `velocity` — so no float, hull pose or
height query can observe it. `packages/core/__tests__/ripple-field.spec.ts` pins the 2-ulp bound.

`WaveField.#evaluateCpu` was the second hotspot. Its per-wave amplitude,
`parameters[offset + 2] + parameters[offset + 6] / waveNumber`, is constant for the life of the
field, yet it paid a divide per wave per call. Hoisted into the constructor, reading the slots back
out of `parameters` so the stored double is the one the divide produced — bit-identical, and pinned
in `wave-field.spec.ts` against the pre-hoist expression rather than against itself.

Game side, both exact and both no-ops visually: `ripples.ts` `rimCPU` returns `1` directly for the
interior (its four smoothsteps saturate at exactly 1 there, so the early-out is the same double),
and `whitewater.ts` memoises each parcel's `exp(-drag·dt)`, `travel` and `terminal` against the dt
they were computed for instead of recomputing them every substep, with the bubble-rise decay hoisted
out of the loop entirely.

**The audit's own proposals were not needed and were not taken.** Substeps are not capped and no
field is frozen: both trade appearance for time, and the cost turned out to be a slow library call
instead.

## 2. Measured result (interleaved, three pairs a side)

Water-impact fixture, 1920×1080, WebGPU, `nvidia/turing`, seed 19420604.

| pair | impacts | stock `updateRenderCpu` p95 | mine | Δ |
|---|---|---|---|---|
| 1 | 8 vs 8 | 34.40 ms | 31.80 ms | **−7.6 %** |
| 2 | 8 vs 7 | 39.17 ms | 34.62 ms | −11.6 % (excluded, unmatched) |
| 3 | 7 vs 7 | 40.60 ms | 37.19 ms | **−8.4 %** |

`rippleUpdateCpu` p95 fell on all three pairs: 5.10→4.50, 5.40→4.70, 5.34→4.70, a **−12 to −13 %**
median. Natural-airborne, the regression guard, also improved on all three pairs (9.00→8.48,
10.67→10.20, 11.35→10.40, median **−4.4 %**) with every component inside the 1.1× limit.

**AC-6's 20 % improvement bar is not met.** The honest figure is ~8 % on the fixture the audit
targeted, with no component regression in either workload. `gpu` is not claimed in either direction:
its spread across identical code paths this afternoon was wider than any effect measured here.

## 3. R3 — rejected on measurement

The audit's live-prefix instanced upload was implemented in `particles.ts` exactly as specified
(`clearUpdateRanges` then `addUpdateRange(0, count * itemSize)`, ranges in components, no dirty mark
at count 0; three r185's WebGPU backend honours the ranges and clears them after upload,
`three.webgpu.js:81215`). It **cost** `updateRenderCpu` about 1.5 ms and pushed `renderCpu` +13.2 %
on water and +11.1 % on natural. Removing it returned water `updateRenderCpu` to its without-R3
value exactly. Reverted, and not shipped.

This is the outcome the audit's own caveat predicted — "the largest proportional saving is at low
occupancy, and full capacity saves nothing … measure the flak/water phase before believing the
gain". It was measured; it does not pay. **That sentence is now the engine's design constraint:
range-marking a dynamic instance buffer per frame is not free, and a full `writeBuffer` of a
particle pool is cheaper than the bookkeeping that avoids it at these occupancies.**

## 4. Tooling added

`tools/capture-performance.mjs` gained `MIDWAY_CPU_PROFILE_OUT=<path>`: opt-in CDP CPU profiling of
the sampled window only (warm-up excluded, 1000 µs interval). Unset, no CDP session is opened and
nothing changes — the before/after runs above were captured with it off. It is what found the
`Math.hypot` call, after two rounds of reasoning from source had picked the wrong suspects
(`Whitewater.emit`'s O(capacity) free-slot scan never appears in the profile at all).

## 5. Not executed

- **R1** (resolution-controller `surface.reason` diagnostics, and the GPU-tail scaling experiment) —
  not started. Still the audit's "definite candidate", and unaffected by anything here.
- **R2** (ripple quiet-field sleeping) — the audit rejects it under the current contract and this
  execution agrees: the cost was never the field being awake, it was one call inside the step.
- **R4** (texture compression; ~1.03 GiB renderer-reported allocation) — not started. Untouched by
  this work and still the only candidate with a native gate attached.
- **O2** (6,694 objects traversed per frame) — after the solver fix, scene traversal
  (`updateMatrixWorld` + `traverse` + `#visit` + `multiplyMatrices`) is **4.32 % of wall**, now the
  second-largest cluster behind the water solver. It is the next thing worth profiling.

## 6. Caveat on the engine adoption

The game's engine pin moves from `core-0.3.2-tracerfix-0c2c923dc202` to
`core-0.3.2-watercpu-6899e4096eae`. That tarball is built from engine HEAD plus the two fixes above,
and the shipped `dist/index.js` differs from the old one by **1,122 lines** — the two fixes are ~10
of them; the rest is other lanes' work that had accumulated and had never been adopted here. An
attempt to rebuild the fixes onto the exact commit the old tarball came from failed: these tarballs
are cut from per-lane branches, not linear history, and no single commit reproduces the old one.
The interleaved A/B in §2 therefore measures **the whole adoption**, not the two fixes alone, and it
is clean on both workloads. `scripts/check-flight.mjs` and `scripts/check-aircraft.mjs` fail, but
they fail identically on the untouched baseline with the old engine — pre-existing, not caused here.
