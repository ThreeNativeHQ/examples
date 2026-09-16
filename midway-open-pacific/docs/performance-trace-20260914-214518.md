# Performance diagnosis — September 14, 2026, 21:45 trace

**The game is spending its frame budget on CPU rendering work. There is no evidence of a 30 FPS limiter.** Even the fastest five-second interval averages **34.90 ms inside the game callback**, before browser work between callbacks. That supports about 27 callbacks/second in this recording. The main costs are Three.js scene submission, world transforms, and—later—maintaining the engine's batched rendering scene.

**A separate 5.35-second freeze occurs when the engine constructs render batches and Three.js synchronously builds their shader graphs during gameplay.** After this transition, projection reconciliation alone costs an estimated **14.94 ms per game frame**.

This is an inspection report on `main`, not an implementation or a claim that performance has improved.

## Recording and measurement boundaries

| Item | Evidence |
| --- | --- |
| Input | `/home/joao/Downloads/Trace-20260914T214518.json.gz`; SHA-256 `f1c6cb829a2bf99386f8f5395a7a187cddb316d363e11a7ba4a6d7942fcb1edd` |
| Recording | DevTools start `2026-09-15T04:45:18.100Z`, September 14 at 21:45:18 in Vancouver; selected window **33.742835 s**, trace timestamps `294778301593–294812044428` µs |
| Page and profile | `http://localhost:5400/`; renderer process `1372239`, main thread `1`; **254,292 events**, **177,382 CPU samples**, **38,949 profile nodes** |
| Inspected checkout | `main`, HEAD `af4910d6fbb04d53c3adf508aed9d7a8424b6473`; installed core `threenative-core-0.3.2-projfix-b2629381e2dc.tgz`, Three.js `0.185.1` |
| Source correspondence | Trace dependency hash `0ac91478` matches the installed Vite `browserHash`; sampled dependency line locations match those bundles. The trace does not embed the game's Git revision; game source references describe this checkout. |

These dependency identities were recorded at the start of inspection. Concurrent edits to the package manifest, lockfile and aircraft source appeared before delivery; they were left untouched. The measurements describe the supplied recording and the inspected bundles, not those later edits.

The filmstrip contains 450 screenshots, ending at **19.392 s**. Inspected frames show the flight manual initially and airborne chase-camera gameplay at 9.521 s and 19.392 s. There is no screenshot of the later freeze: the exact player action or scene mutation that triggers batching is **not established**.

This was a development-server recording with extensions and CPU profiling active. Profiler startup itself occupies **491.908 ms** near the beginning. GPU model, driver, CPU-throttling setting, machine load, temperatures and actual drawing-buffer dimensions are not recorded here. A layout event reports a 1472×935 document, and metadata says DPR 1; neither establishes the WebGPU drawing-buffer resolution.

The trace proves substantial CPU work; it does not isolate GPU execution time. `GPUTask` slices run on the GPU-process CPU thread, and some are attributed to other renderer processes. They must not be summed into this game's GPU frame time. Native desktop, Android and iOS remain unverified. The 33.7-second capture also cannot establish the performance skill's ten-minute sustained/thermal criteria.

## What “30 FPS” means in this trace

The configured ceiling is **60 FPS** in [threenative.config.ts](../threenative.config.ts). [src/game.ts](../src/game.ts) sets a **1/60-second simulation step**. The installed `FixedStepLoop` requests another animation frame after each callback; it does not deliberately skip alternate callbacks. Browser `BeginFrame` intervals have a **16.666 ms median**, consistent with approximately 60 Hz scheduling.

| Measurement | Result |
| --- | ---: |
| Complete game callbacks | **579**, occupying **30.877 s**; **17.456 callbacks/s** across first-to-last starts |
| Callback duration, p50 / p95 / p99 | **42.552 / 65.457 / 76.257 ms**; maximum **5,350.824 ms** |
| Callback budget misses | **579/579** exceed 16.67 ms; **455/579** exceed 33.33 ms |
| Main-thread task occupancy | **32.497 / 33.743 s = 96.31%**; recorded thread CPU time **29.689 s**, or 87.99% of the window |
| Long tasks | **211** tasks longer than 50 ms; maximum **5,354.575 ms** |

One overall average hides two different operating states and the compilation freeze:

| Trace interval | Game callbacks | Mean callback work | Mean start interval | Callback cadence¹ |
| --- | ---: | ---: | ---: | ---: |
| 5–10 s | 135 | **34.898 ms** | 37.021 ms | **27.01/s** |
| 10–15 s | 127 | 37.259 ms | 39.179 ms | 25.52/s |
| 15–20 s | 93 | 50.943 ms | 53.806 ms | 18.59/s |
| 30–33.743 s | 57 | **61.208 ms** | 64.607 ms | **15.48/s** |

¹ `(count − 1) / elapsed time between first and last callback starts`. This is callback cadence, not a claim of exact displayed FPS. The 578 `AnimationFrame::Presentation` markers also have a slow **49.934 ms median / 83.244 ms p95** spacing, and a **6,133.491 ms** maximum gap. Removing just the giant callback still leaves **44.163 ms mean callback work** across the other 578 callbacks.

There are two animation callbacks per cycle. Three.js's small `update` callback totals only **38.278 ms over 580 calls**. Counting every `FireAnimationFrame` would double-count the effective game cadence. Removing that small callback would not solve this problem.

## 1. High priority: CPU rendering already exceeds the 60 FPS budget

The following are **time-weighted CPU-profile estimates divided by game callback count**, not instrumented per-frame percentiles or promised savings. The two columns are different portions of a changing gameplay session, **not a controlled before/after comparison**.

| Separate frame phases | 5–10 s, 135 callbacks | 27.309–33.743 s, 96 callbacks |
| --- | ---: | ---: |
| Engine fixed-update phase, including game/world/HUD updates | **5.80 ms/frame** | **11.19 ms/frame** |
| Authored scene transform preparation in `beforeRender` | **5.63 ms/frame** | **8.57 ms/frame** |
| Engine `SceneRenderProjection.reconcile` | **0.07 ms/frame** | **14.94 ms/frame** |
| Outermost Three.js `render`, including auxiliary passes | **22.99 ms/frame** | **26.20 ms/frame** |

**Why:** [Midway.enter](../src/scenes/Midway.ts) prepares the authored scene's world matrices before rendering. The engine then reconciles its rendering scene and Three.js traverses visible objects, updates material bindings, and submits the main, reflected and shadow views.

Inside the **22.99 ms** Three.js row in the fastest interval:

| Included work; do not add these rows to their parent | Estimated cost |
| --- | ---: |
| Ocean reflector `updateBefore`, including its nested scene render | **6.55 ms/frame** |
| `renderShadow`, including its nested scene render | **4.36 ms/frame** |
| `_projectObject`, across main/reflection/shadow views | **6.27 ms/frame**; overlaps the preceding two rows |
| `writeBuffer` browser API self time | **1.34 ms/frame**; CPU submission time, not GPU execution |

Across the whole trace, `_projectObject` alone has **2.671 s self time**. The main render bottleneck is a large amount of object traversal and per-object submission work, not just expensive flight equations.

**Next change to evaluate:** measure object and draw counts separately for the main, mirror and shadow views, then remove repeated/static per-object work while preserving the scene. For transforms, identify locally immutable children that still recompose each frame. Three.js `Object3D.updateMatrixWorld` recursively visits children without checking `visible`; hiding a group does not by itself remove its transform traversal. The trace does not identify how much of this cost belongs to each hidden subtree, so that needs a census before editing.

Do not remove the existing `beforeRender` matrix preparation: the projected scene relies on current authored transforms. The earlier duplicate authored transform walk and duplicate projected shadow map were already fixed in this installed core; [the previous investigation](PRDs/PRD-midway-flak-hunt-20260914.md) records both fixes. This trace measures the remaining work.

**Ownership:** game-owned static geometry/transforms and reflection content in `src/render/`; portable renderer/projection mechanisms in engine `packages/core/`. No second flight model is warranted.

## 2. High priority: batching activation causes a 5.35-second gameplay freeze

At **21.359975–26.710799 s**, one `FixedStepLoop.#frameCallback` lasts **5,350.824 ms**. Its recorded thread CPU time is **4,488.403 ms**, so this is not just waiting for a display refresh.

The sampled call paths inside that callback show:

| Work | Estimated inclusive time |
| --- | ---: |
| Projection reconciliation | **163.636 ms** |
| `ProjectionMirror.apply → #applyMaterialGroups → #ensureBatched` | **124.738 ms** inside reconciliation; includes copying geometry into new batches |
| `Nodes.getForRender → NodeBuilder.build` | **4,115.26 ms** synchronously building shader graphs |
| Minor/major GC pauses, measured as trace events | **429.634 ms**, across 21 collections |

**Cause established by source and trace:** new batching resources are constructed inside the active frame, followed by cache-miss shader construction in the ordinary draw path. In the matching installed `three_webgpu.js`, `Nodes.getForRender` at line 38473 defaults `useAsync` to `false` and invokes `nodeBuilder.build()` on a missing builder state. `NodeBuilder.build` at line 37376 constructs the shader graph synchronously. The main-thread cost is predominantly that JavaScript construction; do not describe all 4.1 seconds as GPU-driver shader compilation.

**Likely sequence:** the engine changes from its declined/unbatched path to a projected/batched scene during this frame. Newly created batches need shader variants that earlier warm-up did not cover. New batch creation and shader construction are confirmed; the reason classification changes at this exact point is not available in the trace. It could be a roster/material/scene change, but choosing one without the projection report would be speculation.

**Next change to evaluate:** in engine `packages/core/src/renderProjection.ts` and `projection-apply.ts`, prepare and warm the actual batch variants before making them the active rendering scene. Reuse the existing `warmUpScene`/Three.js compilation machinery; the startup warm-up in engine `game.ts` already compiles the projection root that exists at startup. A later projection needs equivalent coverage. Keep rendering a valid scene while preparation completes, and verify the actual main/shadow/reflection variants are covered. Moving only the same synchronous work into another ordinary gameplay callback would still freeze play.

## 3. High priority: the batching optimizer has a substantial recurring CPU cost

In the **96 callbacks after the stall**, `SceneRenderProjection.reconcile` takes **1.435 s sampled total**, approximately **14.94 ms/frame** and **24.3% of sampled game-callback time** in that interval.

| Included reconciliation work | Total | Per game callback |
| --- | ---: | ---: |
| `scanProjection` | **987.057 ms** | **10.28 ms** |
| `ProjectionMirror.apply` | **412.477 ms** | **4.30 ms** |
| `walkProjection`, included in scanning | **519.527 ms** | **5.41 ms** |
| `groupEligibleMeshes`, included in scanning | **318.855 ms** | **3.32 ms** |

**Why:** engine `renderProjection.ts` scans, classifies and synchronizes the scene every projected frame. `projection-plan.ts` rechecks renderability, geometry, materials, hooks and batching flags, then groups eligible meshes. The declined path has a 60-frame rescan guard; the active projected path does not. The installed planner's admission rule is based on eligible mesh count and predicted draw reduction, not a measured net CPU saving.

The trace confirms costly ongoing bookkeeping. It **does not prove disabling projection would improve the same frame**: batching also reduces Three.js traversal/submission, and the early and late scene states differ.

**Next change to evaluate:** run an otherwise identical projected/unprojected comparison including **all** transform preparation, reconciliation, rendering and GPU work. Use the result to decide whether this scene benefits from the optimizer and which part merits improvement. Keep per-frame correctness when objects spawn, change materials or change render flags.

A blind “scan once every 60 frames” change was already rejected in [the existing PRD](PRDs/PRD-midway-flak-hunt-20260914.md): new objects can disappear from the rendered mirror and material/flag mutations can go unnoticed. That is not a safe fix. A faster scan or lifecycle mechanism must retain those behaviors and belongs in the engine.

## 4. Medium priority: HUD drawing repeats during catch-up and forces layout

**Measured:** `Hud.update` occupies **1.334 s sampled inclusive time**, including **960.22 ms** in `drawFlight` and **404.29 ms** in `drawGauges` (nested, not additive). HUD cost rises from approximately **1.58 ms/frame** in the fast interval to **3.70 ms/frame** after the stall.

There are **239 Layout events totaling 192.749 ms**. **121 events totaling 106.688 ms explicitly contain `WorldView.project → Hud.drawFlight` in their initiating stack.** This is a directly identified synchronous-layout path.

**Cause:** [Midway.update](../src/scenes/Midway.ts) calls `world.update` and `hud.update` for every fixed simulation tick. [Hud.update](../src/hud.ts) clears/redraws its canvas before its 0.1-second text-update throttle. Multiple fixed ticks before one rendered frame therefore redraw HUD states that cannot all be presented. [WorldView.project](../src/render/world.ts) reads canvas `clientWidth`/`clientHeight` for projected markers after HUD DOM/style changes have dirtied layout. `center-tip.innerHTML` is also assigned on every text-update pass, even when the tip is unchanged.

**Next change to evaluate:** keep simulation at 60 Hz, but draw the HUD once for the latest state per presented-work attempt. Obtain viewport dimensions once through the existing viewport/resize mechanism, before DOM writes, instead of reading layout in each marker projection. Assign unchanged tip/text content only when its value changes. Preserve HUD timers and input feedback when separating update from drawing.

This is worth fixing, but its measured cost is smaller than rendering and projection. It will not independently recover 60 FPS.

## 5. Medium priority: allocation/DOM churn, concentrated GC during shader construction

| Counter | Observation |
| --- | --- |
| JS heap used | First **135.76 MB**, last **174.67 MB**, range **76.28–200.29 MB**; decimal MB |
| DOM node counter | **2,837 → 7,936** |
| Documents/listeners | Documents **3 → 1**, listeners **450 → 285**; these do not grow monotonically with nodes |
| GC pauses | 42 minor collections **445.079 ms** total, one major collection **51.187 ms** |

**86.6% of the measured GC pause time occurs inside the 5.35-second shader/batch freeze.** Fixing first-use shader construction is the first allocation-related priority. The source also establishes unnecessary DOM replacement in the HUD, but this trace cannot attribute every node or retained byte to it.

**Next check:** repeat the same flight after warm-up and compare post-GC heap/retained DOM nodes. If the retained baseline continues rising, inspect retaining paths. This recording alone does **not** establish a memory leak; resources, caches, DOM text nodes and recording/extension activity can all affect these counters. A broad pooling rewrite is not justified by these results.

## What this recording does not implicate

The earlier water/texture findings should not be copied forward as this trace's main cause. Over the full recording, `ripples.update` is about **224 ms sampled inclusive**, `copyExternalImageToTexture` about **29 ms self**, and `updateClusteredMeshes` about **2 ms inclusive**. `Battle.step` is **1.019 s inclusive**, and the primary `AircraftFlight.step` sample group is approximately **195 ms inclusive**. These are much smaller than rendering; this flight does not test the worst active-water workload.

Known extension `FunctionCall` groups are small compared with the game callback. Their presence is a measurement caveat, not evidence that an extension accounts for the persistent frame cost. GPU execution can still impose another bottleneck after CPU improvements; this trace does not supply the pass timestamps needed to decide that.

## Recommended order

1. **Fix the mid-flight batching/shader freeze in the engine.** Reproduce the transition with projection reason, batch counts and first-use shader builds recorded.
2. **Measure projection's net cost on one identical scene state.** Include its roughly 15 ms/frame reconciliation cost in the decision, not only draw-count savings.
3. **Reduce remaining per-object render/transform work.** Profile main, mirror and shadow passes separately; preserve the already-shipped transform/shadow fixes.
4. **Move HUD drawing out of repeated fixed-tick work.** Eliminate the measured synchronous layout path and unchanged HTML replacement.
5. **Capture a clean follow-up and check retained memory.** Use an extension-free profile and matched source, workload, viewport/drawing buffer and machine conditions; measure GPU passes separately and run ten minutes before claiming sustained performance.

The existing [capture-performance tool](../tools/capture-performance.mjs) can provide matched CPU/GPU measurements. Browser launches must use `tools/capture-lock.sh`; this inspection did not launch a browser or change running servers. No game/engine build or playtest is claimed for this Markdown-only change.

## Reproduce the headline measurements

Run from this game directory. This reads the supplied file without modifying it:

```sh
python - <<'PY'
import gzip, json, math
from pathlib import Path

path = Path.home() / 'Downloads/Trace-20260914T214518.json.gz'
with gzip.open(path, 'rt') as f:
    trace = json.load(f)
window = trace['metadata']['modifications']['initialBreadcrumb']['window']
start, end = window['min'], window['max']
events = [e for e in trace['traceEvents']
          if e['pid'] == 1372239 and e['tid'] == 1 and e['ph'] == 'X'
          and start <= e['ts'] and e['ts'] + e['dur'] <= end]
frames = sorted((e for e in events if e['name'] == 'FunctionCall'
                 and e['args']['data'].get('functionName')
                 == 'FixedStepLoop.#frameCallback'), key=lambda e: e['ts'])
durations = sorted(e['dur'] / 1000 for e in frames)
p = lambda q: durations[math.ceil(q * len(durations)) - 1]
tasks = [e for e in events if e['name'] == 'RunTask']
print('callbacks:', len(frames))
print('callback cadence:', (len(frames) - 1) * 1e6 /
      (frames[-1]['ts'] - frames[0]['ts']))
print('callback ms p50/p95/p99/max:', p(.5), p(.95), p(.99), max(durations))
print('main busy %:', 100 * sum(e['dur'] for e in tasks) / (end - start))
print('long tasks >50ms:', sum(e['dur'] > 50000 for e in tasks))
hitch = max(frames, key=lambda e: e['dur'])
print('hitch start seconds:', (hitch['ts'] - start) / 1e6)
PY
```

CPU attribution reconstructs the single profile `0x2` from all 4,115 `ProfileChunk` events, including chunks emitted on the profiler thread. Starting with `Profile.args.data.startTime`, accumulate `timeDeltas` and resolve each sampled node's `parent` chain. Weight self time by the sample's delta; inclusive time credits each distinct `(functionName, URL, lineNumber)` once per stack, so recursive `updateMatrixWorld` and nested `render` calls are not multiplied. Restrict samples to the named intervals before aggregating. Garbage-collector samples without a game parent remain separate. Sampled values are estimates of attributed elapsed time; direct trace durations and thread CPU time are reported separately above.

Percentiles here use nearest rank. Inclusive parent/child rows overlap and cannot be added; this follows [Chrome's self-time/total-time distinction](https://developer.chrome.com/docs/devtools/performance/reference). Source line numbers in the trace refer to Vite-transformed code and differ from TypeScript source lines.

**Verification:** parsed the complete compressed trace; reconstructed its CPU profile; inspected three embedded screenshots; checked the implicated installed loop, projection, Three.js shader-build and HUD source paths; executed the reproduction block; checked Markdown links and whitespace. No performance fix, fresh runtime capture or native-platform result is claimed.
