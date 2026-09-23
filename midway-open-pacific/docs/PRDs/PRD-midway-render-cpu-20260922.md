# PRD-midway-render-cpu-20260922 — Same picture, fewer submissions

**Status:** NOT STARTED
**Complexity:** 4 (MEDIUM)
**Owner:** Joao Paulo Furtado (visual sign-off); agent (implementation)
**Depends on:** None. Coordinate with the `prd398` lane, which currently holds uncommitted
`package.json`/`pnpm-lock.yaml` edits pointing the game at `threenative-core-0.3.2-prd398-*.tgz`.

Complexity: files 6–10 (+2), crosses the engine package release boundary (+2) → 4 → MEDIUM; risk
override: none.

## The rule this PRD runs under

**The look is fixed. Only the cost moves.** The owner's words: "optimize everything without nerfing
the look or make it look like trash". Every cut here must keep the same geometry, materials,
textures, shadows, reflections, resolution, MSAA, LOD distances and animation. Each cut must pass
the frozen-frame comparison in Phase 1 before it can be accepted. The following are banned here, and
already measured as visible (see `PRD-midway-flak-hunt-20260914.md`, update 2026-09-15):

- MSAA 4→1
- `resolutionScale` below 1
- turning shadows off, or gating them by distance
- decimated hulls
- reflection `refreshInterval: 2`
- dropping the sea's back side

Texture compression (KTX2/BC7) changes texels, so it is out of scope. It needs its own PRD with a
side-by-side sign-off.

## Context

### The hypothesis tested: "the USS Enterprise is causing the performance issues"

It is partly right, but not in the way expected. The hull's triangles are not the cost. The cost is
**how many separate draw submissions the carriers make, above all into the shadow map**.

`public/assets/hornet.glb` supplies all three Yorktown-class carriers: Enterprise, Hornet and
Yorktown (`src/render/world.ts:162-176`). It contains:

- 26.8 MB of data
- 347,281 triangles
- 94 primitives
- 75 materials: 71 opaque double-sided, 4 BLEND, 0 alpha-tested
- 73 JPEG images

`src/render/imported-ships.ts:38` sets `castShadow = true` on every mesh. The home carrier also
carries its parked deck load, decor and crew. On deck, the scene census counts the Enterprise
subtree at **609 meshes / 213 materials**; Hornet and Yorktown count 302 meshes / 135 materials each.

### Measurements, 2026-09-22

Setup:

- RTX 2080, Chromium 151 on WebGPU, 1920×1080, DPR 1, `quality: balanced`, run under
  `tools/capture-lock.sh`.
- The engine is the `prd398` tarball.
- The host was contended, with load average 10–13, so **only the relative numbers are evidence**.
- Wall time is Xvfb presentation, so it is ignored.

**Deck start, ABAB × 2**, 6 s per phase (`docs/perf/deck-probe-20260922.mjs`):

| Phase | Draws (main + shadow) | Triangles | Render CPU p50 / p95 | GPU p50 |
|---|---:|---:|---:|---:|
| stock | 549–550 | 2.08–2.09M | 4.7 / 15.4 ms, then 3.7 / 10.2 ms | 8.2–8.3 ms |
| US carriers `castShadow = false` | **193–194** | **1.18–1.20M** | **1.1 / 7.2 ms, then 1.0 / 6.9 ms** | 7.2–7.7 ms |

That test switches off the shadows of all three US carriers and everything parked on them. It
removes **356 submissions and about 75% of render CPU** on the deck. GPU time barely moves, because
depth-only draws are cheap for the GPU. The cost sits on the CPU, in per-draw renderer bookkeeping.
Turning off shadows is not a legal fix, since it changes the picture. **The same shadow from fewer
submissions is legal**, and Phase 2 does exactly that.

**Airborne natural workload** (`tools/capture-performance.mjs`, 20 s; baseline in
`docs/perf/natural-baseline-20260922.json`):

| | Run 1 | Run 2 | Run 3 (CPU-profiled) |
|---|---|---|---|
| `updateRenderCpu` p50 | 12.9 ms | 9.4 ms | 12.2 ms |
| `renderCpu` p50 | 5.4 ms | 3.8 ms | 5.05 ms |
| GPU p50 / p95 | 6.95 / 13.4 ms | 6.7 / 14.1 ms | 6.8 / 14.5 ms |

The scene has 9,885 objects, 2,518 meshes, 188 draws and 0.81M triangles. GPU texture memory is
**1.30 GB**.

**CPU profile, run 3.** Self time, as a share of 7.66 s busy:

- **31.9% `copyExternalImageToTexture`.** It is reached only through `compileAsync`, which is the
  briefing's unawaited `warmUpViews()` (`src/scenes/Midway.ts:292`,
  `src/render/world.ts:637`), still uploading textures mid-flight. The call splits into two stacks:
  1.39 s via `_updateBindings → _update` and 1.06 s via `_createBindings`. That split suggests some
  textures are uploaded twice. This is a hypothesis, still unverified.
- **21% scene-graph walking:**
  - `updateMatrixWorld` 7.8%
  - engine `#visit` 4.9%
  - `traverse` 4.7%
  - `multiplyMatrices` 3.7%

  `#visit` is the `minimumProjectedPixels` gate in `@threenative/core`. It calls `root.traverse`,
  which descends into subtrees that are already hidden: the unused LOD levels, the merged stand-ins
  and the hidden hull bodies. Its own first check returns on `visible === false`, so skipping those
  subtrees with `traverseVisible` gives the same result.

### Two measurement defects found while diagnosing

1. **`MIDWAY_HIDE=ships` never hid anything.** `src/render/world.ts:823` rewrites `m.visible` on
   every ship every frame. The hide run reported the same 188 draws as stock, and on the deck
   hiding carriers left 549 draws unchanged. Every earlier "ships cost X" attribution taken that
   way is void.
2. **Steady-state samples include the warm-up compile.** `capture-performance.mjs` starts sampling
   while `warmUpViews()` is still running, so any "steady state" figure carries up to about 30% of
   the CPU's texture-upload work.

### Doctor, 2026-09-22

The run has `pass: false`:

- **fail:** native runtime and desktop target. The host runtime is v0.3.0, older than the installed
  engine 0.3.2. **Native is unreachable for this PRD.** Make no native performance claim.
- **warn:** Android. It needs JDK 17 and found 26. The asset pipeline also warns
  `TN_NATIVE_KTX2_UNSUPPORTED` / `TN_NATIVE_MESH_COMPRESSION_UNSUPPORTED` for mobile.
- **warn:** iOS. It needs darwin.

### Engine capabilities checked

Checked with `engine_search_capabilities`:

- **`mergeParts(parts, { preserve: ["uv", "normal"] })`.** Merges static parts per material while
  keeping texture UVs and authored normals. This is the main-pass tool for Phase 3.
- **`FrameBudget` / `TN_FRAME_BUDGET`.** Reports draws and triangles per pass (main, shadow,
  reflection) plus a per-frame GPU series. Use it for per-pass evidence; do not build a new
  counter.
- **`renderer.projection`.** Stays `false` (`threenative.config.ts:34`). It was measured as a net
  loss in `8c769c2`: reconcile cost 4.46 ms and a 5.35 s freeze. It is not reopened here.
- **`InstancedBatch`.** Does not apply. The three carriers share one geometry, but each carries its
  own deck state and scars.
- **`BundleGroup` (WebGPU render bundles).** Not used anywhere. It is a candidate only after
  Phases 2–3, and only if a fresh trace still shows per-draw encoding as the largest leg (see
  Follow-ups).

## Solution

This work removes repeated CPU work between the authored scene and the GPU. It never touches what
the scene is. It stays inside the charter: Three.js remains the sole renderer, the mechanisms take
the game's own geometry and materials as input, and nothing the game authored changes appearance.

1. **Make the measurement honest first.** Fix the hide modes, wait for the warm-up before sampling,
   add a deck workload, and add a frozen-frame look comparison. Every later phase is judged by
   these tools.
2. **Shadow-caster proxy.** Every static mesh under a carrier (hull, parked aircraft, decor) stops
   casting shadows itself. One merged, shadow-only mesh per carrier casts in their place, built from
   the **same triangles**. `airframeLod` (`src/render/airframe-lod.ts`) already builds that merged,
   undecimated geometry and caches it per key ("hornet").
   - The proxy lives on a layer that only the sun's shadow camera renders: the main and reflection
     cameras do not enable it, and the shadow camera enables it.
   - `receiveShadow` stays on the originals. Anything animated stays on its own caster: the elevator,
     `MOVING_NODE` matches (`src/render/world.ts:244`) and skinned crew.
   - No hornet material is alpha-tested, so a merged opaque caster casts exactly the silhouette the
     parts cast. The 4 BLEND materials cast shadows today (three.js ignores transparency when
     casting), and the proxy keeps them in.
3. **Main-pass merge per material.** Group the full-detail hull's static meshes by material and
   merge them with `mergeParts({ preserve: ["uv", "normal"] })`. Each material draws once per
   carrier instead of once per part.
   - The same material objects and textures are kept, so the picture is identical.
   - The BLEND materials stay as their own meshes, keeping `renderOrder` and transparency sorting.
   - The merged geometry is shared across the three carriers by the `lod` key, like the stand-in.
   - This also removes hundreds of objects from `updateMatrixWorld` and the frame gate's walk.
4. **Engine walk and warm-up.** Change the frame gate to `traverseVisible`, lifted into
   `packages/core` with a red-green unit test. Also find out why warm-up uploads textures twice and
   fix it where the cause lives. Keep the warm-up's timing and its "compile before first view"
   guarantee.

Consumer flow: the player takes the deck or flies the sortie → `Midway.update` → `World.update`
(visibility, LOD) → the engine frame gate → `renderer.render`, with main, shadow and reflection
passes. Every change is reached on that path. No option is added and nothing is opt-in.

Risks:

- **The proxy's shadow drifts from the parts' shadow.** It would drift if the elevator or other
  movers were baked in. Guard it by keeping `MOVING_NODE` matches and `userData.elevator` out of the
  merge, and confirm with the Phase 1 frame comparison during an elevator cycle.
- **Layers on the shadow camera may not be honoured by the WebGPU `ShadowNode` in the pinned
  three@0.185.1 (patched).** Check this first, in the Phase 2 spike. The fallback is a proxy material
  with `colorWrite: false, depthWrite: false`. It costs 1 main-pass draw per carrier instead of 0,
  which is still roughly 300 fewer.
- **De-indexing in `mergeParts` raises vertex memory.** One shared hull is about 1.04M vertices.
  Report the memory delta; it is shared once across the three carriers.
- **The engine change crosses the shared engine tree.** Stage only this lane's paths (see memory
  "threenative-engine shared tree lanes") and re-pin the scaffold hash if the manifest moves.

## Acceptance Criteria

Evidence rules:

- Performance ACs use `tools/capture-performance.mjs --compare` in **interleaved stock/candidate
  pairs, at least 3 pairs**, with matched `acceptedImpacts`.
- Any look AC uses the Phase 1 frozen-frame comparison.
- Record the tested revision, including the dirty diff digest the tool already prints.

- [ ] AC-1 [local; actor: agent]: Attribution is real. The `MIDWAY_HIDE=ships` and new
  `us-carriers` modes still hide after `World.update` has run. Negative control: a hide run's
  per-pass draw count must be lower than stock's, where today it reads identical (188 = 188). The
  sample starts only after `warmUpViews()` resolves, and the report prints when it did. —
  Evidence: pending.
- [ ] AC-2 [local; actor: agent]: The deck workload exists. `tools/capture-deck-perf.mjs`, promoted
  from `docs/perf/deck-probe-20260922.mjs`, reports per-pass draws and triangles from
  `TN_FRAME_BUDGET`, GPU p50/p95 and render CPU p50/p95 on the deck start at 1920×1080. It records
  a stock baseline to `docs/perf/`. — Evidence: pending.
- [ ] AC-3 [local; actor: agent]: The look comparison exists and can fail. It freezes the sim at a
  fixed tick, sets a fixed camera for three views (deck, 400 m chase past the home carrier, and a
  carrier at 2 km in the reflection), captures stock and candidate, and prints a per-pixel diff.
  Controls:
  - stock against stock gives the noise floor;
  - US carriers with `castShadow = false` must exceed that floor, so the tool catches a shadow nerf.

  — Evidence: pending.
- [ ] AC-4 [local; actor: agent]: The shadow proxy passes both tests below. — Evidence: pending.
  - **Cost:** on the deck workload, shadow-pass draws for the US carrier subtrees are **≤ 12** (from
    about 356). Deck render CPU p50 is **≥ 50% lower** than the AC-2 stock baseline.
  - **Look:** all three AC-3 views stay within the noise floor, including one frame mid-elevator
    cycle.
- [ ] AC-5 [local; actor: agent]: The main-pass merge passes both tests below. — Evidence: pending.
  - **Cost:** home-carrier main-pass draws are **≤ 80**, down from the per-part count that AC-2
    records.
  - **Look:** all three AC-3 views stay within the noise floor, with BLEND parts still sorted
    correctly.
- [ ] AC-6 [local; actor: agent]: The engine frame gate walks only visible subtrees. It is a
  `packages/core` unit test, red then green, with the failing and passing output pasted. The engine
  gates pass: `pnpm typecheck && pnpm lint && pnpm test`. The package goes out as a content-hashed
  tarball in `.packages/`, and the game is repointed to it. — Evidence: pending.
- [ ] AC-7 [local; actor: agent]: Warm-up uploads each texture once, and no texture upload lands in
  a sampled flight window. Count uploads per texture across `warmUpViews()`; the result must be
  1 each. The airborne CPU profile must show `copyExternalImageToTexture` below 1% of busy time.
  — Evidence: pending.
- [ ] AC-8 [local; actor: agent]: The whole airborne frame is cheaper. `updateRenderCpu` p50 is
  **≥ 25% lower** than the stock baseline on the natural workload. GPU p95 is no worse than stock
  beyond the host's pair-to-pair spread. — Evidence: pending.
- [ ] AC-9 [local; actor: agent]: Nothing regressed. All of these pass:
  - `pnpm typecheck`
  - `pnpm exec vite build`
  - the `launch.playtest.json` per-pass budget on `--browser-recipe webgpu --headed`
  - `capture-deck.mjs`
  - `capture-fleet.mjs`
  - `capture-sortie-runs.mjs`
  - `check-fleet.mjs`
  - `check-catalog.mjs`

  — Evidence: pending.
- [ ] AC-10 [owner; actor: Joao]: The owner compares stock and candidate on his own display, at
  1472×935, flying the deck launch and a pass by the fleet. He confirms the carriers, shadows and
  deck look unchanged. — Evidence: pending.

Native desktop and Android are **unreachable**: the doctor reports runtime v0.3.0 against engine
0.3.2, and Android needs JDK 17. Nothing in this PRD claims a native gain.

## Integration Ledger

| Capability | Reachable consumer/trigger | Replaces / disposition | Evidence |
|---|---|---|---|
| Carrier shadow proxy | `World` ship build → `addHullLod` (`src/render/world.ts:1307`) → sun shadow pass | Per-part `castShadow` from `cloneModel` (`src/render/imported-ships.ts:38`) is switched off for static parts, not kept alongside the proxy | AC-4 |
| Per-material hull merge | Same build path, full-detail `body` group | Per-part hull meshes are deleted from the scene graph after the merge | AC-5 |
| Visible-only frame gate walk | Engine frame gate before every `renderer.render` | `root.traverse` → `traverseVisible`, in place | AC-6 |
| Honest hide and warm-up-aware sampling | `tools/capture-performance.mjs`, `tools/capture-deck-perf.mjs` | The per-frame-overwritten `visible` hide is replaced | AC-1, AC-2 |

## Execution Phases

#### Phase 1: Measurement you can trust
**Status:** NOT STARTED
**ACs:** AC-1, AC-2, AC-3
**Files:**
- `tools/capture-performance.mjs`: hide after update, wait for warm-up, add `us-carriers`.
- `tools/capture-deck-perf.mjs`: new.
- `tools/compare-frames.mjs`: new, or extend an existing capture tool if one already freezes a tick.
- `src/render/world.ts`: expose a `warmUpDone` promise only if nothing observable exists yet.

**Implementation:**
- Hide through a post-`World.update` hook, or by layer mask, so that `world.ts:823` cannot undo it.
- Await `warmUpViews()` before the warm-up clock starts.
- The deck tool reads per-pass numbers from `TN_FRAME_BUDGET` lines, not `renderer.info` (that
  reports the last pass only).
- The frozen-frame comparison stops the fixed-step clock and pins the ocean time uniform and the
  camera. It diffs PNGs and prints the noise floor and the candidate delta.

**Verification:** E1 covers:
- the negative controls listed in AC-1 and AC-3;
- the deck and natural stock baselines, written to `docs/perf/`.

**Checkpoint:** pending

#### Phase 2: One shadow per carrier
**Status:** NOT STARTED
**ACs:** AC-4
**Files:**
- `src/render/world.ts`: `addHullLod`, sun shadow-camera layer.
- `src/render/imported-ships.ts`: `cloneModel` shadow flags.
- `src/render/airframe-lod.ts`: only if parked aircraft need an exposed merged geometry.

**Implementation:**
- Spike first: confirm that the WebGPU shadow pass honours `shadow.camera.layers` on three 0.185.1
  as patched. If it does not, use the `colorWrite: false` fallback, and record which path was taken.
- Build the proxy from `airframeLod(detailed, key).geometry`, in the frame of `detailed`.
- Parked aircraft on the deck park get the same treatment through their own `airframeLod`. Movers
  keep per-part casting.
- Show the proxy whenever `body` is shown. The merged `low` already casts shadows when shown.

**Verification:** E2:
- deck ABAB with at least 3 pairs;
- AC-3 comparison on all three views plus the mid-elevator frame;
- `capture-deck.mjs` (deck geometry is unchanged).

**Checkpoint:** pending. `prd-work-reviewer` on the diff and on E2.

#### Phase 3: One main-pass draw per material
**Status:** NOT STARTED
**ACs:** AC-5, AC-8
**Files:**
- `src/render/world.ts` or `src/render/imported-ships.ts`: the per-material merge of the full-detail
  hull, cached per `lod` key.

**Implementation:**
- Group the static meshes of `body` by material.
- Run `mergeParts(parts, { label, preserve: ["uv", "normal"] })`, and add `uv1` or `color` to
  `preserve` if any hornet primitive carries them. Check with `tools/inspect-glb.mjs` first.
- Keep BLEND and moving parts separate.
- Remove the source meshes from the graph.
- Share the merged geometries across the three carriers.

**Verification:** E3 covers:
- AC-5 cost and the AC-3 look;
- natural-workload `--compare` for AC-8;
- the memory delta, taken from `renderer.info.memory` in the capture output.

**Checkpoint:** pending. `prd-work-reviewer` on the diff and on E3.

#### Phase 4: Engine walk and a warm-up that uploads once
**Status:** NOT STARTED
**ACs:** AC-6, AC-7, AC-9, AC-10
**Files:**
- `threenative-engine/packages/core/src/…` (frame gate) plus its unit test;
- the capability-manifest note, if behaviour is documented there;
- `package.json` / `pnpm-lock.yaml`: repoint the tarball, after coordinating with the `prd398` lane;
- the warm-up fix wherever the double upload lives:
  - if it lives in the game, `src/render/world.ts` `warmUpViews`;
  - if it lives in the engine or the three patch, fix it there and reinstall. Never patch
    `node_modules/`.

**Implementation:**
- Red-green `traverseVisible` in the engine, then pack and hash-rename the tarball.
- Instrument `_copyImageToTexture` per texture during the warm-up, find the second upload's trigger
  (for example a `needsUpdate` or version bump after the first bind), and remove it.

**Verification:** E4 covers:
- the engine gates;
- the upload count;
- the airborne CPU profile;
- the full AC-9 gate list, run once at the end;
- then one combined request to the owner for AC-10.

**Checkpoint:** pending

## Follow-ups (not required, not boxed)

- **`BundleGroup` for the static hull.** A bounded experiment, and only if a post-Phase-3 trace
  still ranks per-draw command encoding first. A render bundle keeps its recorded draws, and per-frame
  uniform uploads still run. The experiment must fall back when bundle structure changes (scars,
  parked-aircraft launch).
- **Engine lift.** "Merge static shadow casters into one proxy" is a mechanism, not a look. If a
  second game needs it, gate it against the charter for `packages/core`. Log the gap in
  `FRICTION.md` in Phase 2.
- **Texture memory, 1.30 GB.** Compressing it changes texels, so it needs a separate PRD with an
  owner side-by-side comparison.
- **`carrier.yorktown.glb`.** It is loaded in `src/render/imported-fleet.ts` and never drawn, which
  costs 13.2 MB of load. Removing it is a startup win, not a frame win.
