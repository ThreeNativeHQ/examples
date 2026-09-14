# Blur-over-time in Midway — Open Pacific

## Repair plan (2026-09-14)

**Status:** DONE — game repair verified; unrelated whole-engine gates remain open in PRD-384.
**Complexity:** 5 → MEDIUM; risk override: none.

The original assessment was independently checked against the installed code and a live capture.
Trace the real consumer:
`src/main.ts` → `src/game.ts` → `config.renderer` → engine surface and frame-budget windows.
Capability discovery found `defineGame`; its existing render options own resolution policy.
The fix repairs the engine's existing scaler and keeps `resolutionScale: "auto"`.
The user rejected a fixed resolution as the normal solution: optimization belongs in the engine.
Engine plan: `docs/PRDs/PRD-384-adaptive-resolution-gpu-headroom.md` in the engine checkout.
No replacement renderer, flight changes or asset changes are needed.

1. Capture actual surface dimensions, frame budgets and images during flight and camera switches.
2. Repair GPU-aware downscaling and recovery in core, then reinstall the content-hashed tarball.
3. Repeat the same capture; record image stability, performance cost and build checks here.

- [x] AC-1 [local; actor: agent]: Observe the reported degradation in the live WebGPU game.
  `MIDWAY_SHOTS=screenshots/blur-before MIDWAY_URL=http://127.0.0.1:5391 bash tools/capture-lock.sh node tools/capture-resolution.mjs`
  reproduced the drop from 1920×1080 to 998×562 (scale 0.52) after 60 seconds. The pre-fix
  regression failed its fixed-policy assertion; all three cameras ran with no browser errors.
- [x] AC-2 [local; actor: agent]: Full drawing resolution survives flight and repeated cockpit switches.
  SBD after the engine repair: 90 seconds, nine C-key presses, 19 samples at 1920×1080 and
  `scaleSource: "auto"`; simulation advanced 71 seconds, with no browser errors. Capture:
  `MIDWAY_SHOTS=screenshots/blur-auto-fixed MIDWAY_URL=http://127.0.0.1:5391 bash tools/capture-lock.sh node tools/capture-resolution.mjs`.
  Devastator also passed the same capture with `MIDWAY_LOADOUT=torpedo` and
  `MIDWAY_SHOTS=screenshots/blur-tbd-fixed`: 19 full-resolution `auto` samples, nine camera
  switches and no browser errors. Its cockpit and final chase frames were inspected.
- [x] AC-3 [local; actor: agent]: Inspect before/after frames, measure timing, pass typecheck and web build.
  Inspected `screenshots/blur-before/{start,end}.png` and `screenshots/blur-auto-fixed/end.png`.
  Plane edges and surface detail remain sharp after repair. Completed frame windows were
  8.68/9.65/8.57 fps, with GPU samples 14.22/5.50/6.33 ms; resolution stayed full throughout.
  `pnpm typecheck` and `pnpm exec vite build` passed after installing the patched core.

Integration: `src/game.ts` still passes `config.renderer` to `defineGame`; package.json and the
lockfile adopt the repaired core. The engine's frame-budget callback already carries GPU timing.
Verification: `tools/capture-resolution.mjs` (including its recorded timing windows), `pnpm typecheck`,
`pnpm exec vite build`. Browser runs use `tools/capture-lock.sh` and an HMR-disabled server.

## Installed implementation

The source assessment below refers to the **pre-fix** installed engine:
`@threenative/core@0.3.2`, `three@0.185.1`, file
`node_modules/@threenative/core/dist/index.js` (line numbers below are that file).

## Symptom

The frame starts crisp, then **gradually blurs** while playing. A user reports it is worse after
switching into and back out of the cockpit camera (`C`). Once blurred it does not clearly recover.

## Repro

```sh
cd /home/joao/projects/threenative/sandbox/midway-open-pacific
pnpm dev --host 127.0.0.1 --port 5199 --strictPort
# choose the Devastator (torpedo loadout) or the default SBD; fly ~30–60 s
# toggle cockpit with C a few times
```

Requires a real GPU: `bash tools/capture-lock.sh node <probe.mjs>` with
`--browser-recipe webgpu --headed` (headless Chromium serves SwiftShader and proves nothing).

Config, `threenative.config.ts` (automatic resolution is retained):

```ts
display: { maxFps: 60, ... },
renderer: {
  resolutionScale: "auto",
  alphaAntialiasing: true,
},
```

## What it is NOT

`alphaAntialiasing` is innocent. `installDrawHook` (`:7567`) calls `convertMaterial` (`:6906`),
which only sets the Three.js `alphaToCoverage` flag on **opaque alphaTest cutouts** (`:6912`):

```js
if (!isCutout(candidate) || candidate.alphaToCoverage === true) return;
candidate.alphaToCoverage = true;
```

and `isCutout` (`:6862`) explicitly rejects anything transparent:

```js
function isCutout(material) {
  if (material.transparent === true || material.alphaHash === true) return false;
  const threshold = material.alphaTest;
  return typeof threshold === "number" && threshold > 0 || material.alphaTestNode !== void 0 && material.alphaTestNode !== null;
}
```

No history, no shader code, no temporal accumulation. Canopy glass, roundels, sprites and the TSL
ocean/particles are all `transparent: true` and never touched. Alpha-to-coverage is per-sample and
stateless. The game also never calls `renderer.createRenderChain(...)`, so there is no TAA/motion
blur/temporal-reproject stage in this build to smear frames.

## Confirmed mechanism: the adaptive resolution scaler

`resolutionScale: "auto"` installs a `ResolutionScaler` (`:8052`) in the engine loop (`:9979`):

```js
const scaler = renderer.surface().scaleSource === "auto"
  ? new ResolutionScaler({ targetFps: this.#config.display?.maxFps ?? DEFAULT_TARGET_FPS })
  : void 0;
```

Constants (`:7963`):

```js
var RESOLUTION_SCALER = {
  rungs: [1, 0.85, 0.72, 0.61, 0.52, 0.44, 0.38, 0.32, 0.27, 0.23],
  targetFpsFraction: 0.98,   // 60 * 0.98 = 58.8 fps
  upTailFraction: 1.15,      // p95 bar = 1000/60 * 1.15 = 19.167 ms
  stallP99Multiple: 10,
  stallMaxMultiple: 10,
  upWindows: 4,
  cooldownWindows: 1,
  warmupWindows: 1,
  maxDownRungs: 4,
  oscillationCycles: 2,
  oscillationWindows: 1 + 4 + 1,
  // ...
};
```

`observe(window)` (`:8112`):

- Drop: only when `fps < targetFps` **and** `#overBudget(window)`, then `#step(#rungsToDrop(fps))`
  (1–4 rungs at once); at the last rung it sets `#atFloor = true` (`:8127`).
- `#overBudget` (`:8163`): `p50 > 17.007ms || p95 > 19.167ms`.
- `#stalled` (`:8171`): a window whose p99 or max ≥ 10× p50 is ignored entirely.
- Climb: needs `fps >= 58.8` **and** `presented.p95 <= 19.167ms` for **4 consecutive** windows
  (`upWindows = 4`, `:8141`), and only ever one rung at a time. More precisely, it counts four
  qualifying windows: a low-fps window which is not over budget returns without resetting that
  count, so they need not be consecutive.

The loop also skips scaling until startup is ready and skips windows containing explicit renderer
compilation (`:10006`). The original assessment omitted these guards.

Applying the scale shrinks the **drawing buffer** while leaving the CSS size fixed (`:7838`):

```js
renderer.setSize(
  Math.max(1, Math.round(width * pixelRatio * state2.resolutionScale)),
  Math.max(1, Math.round(height * pixelRatio * state2.resolutionScale)),
  false
);
```

The compositor then bilinearly upscales a lower-res buffer to the element size. That is the blur.

### Why it can look permanent

1. **CPU-bound deficit never recovers.** Dropping resolution only helps a pixel-bound deficit. If
   the deficit is CPU (draw calls, animation, sim, asset churn, a loaded host), `fps` stays below
   58.8, `#overBudget` keeps firing, and the scaler walks to the `0.23` floor and stays. `atFloor`
   reports true and the true low scale keeps being reported (`:8110`).
2. **Oscillation auto-pin.** After 2 cycles across one rung boundary within
   `oscillationWindows = 6` windows, the scaler does
   `this.#index = Math.max(this.#index, boundary + 1); this.#scaleSource = "auto-pinned";`
   (`:8211`). From then on `observe()` returns immediately (`:8114`) — **pinned one rung below the
   boundary, permanently**, with no recovery path.
3. **Lingering climb.** Even a genuine transient drop needs ~4 clean windows *per rung* (windows
   are 300 frames by default, `reportEvery = 300`), so a blur from one cockpit toggle can visibly
   persist for tens of seconds.

## Independent live evidence (2026-09-14)

Hardware browser capture: NVIDIA Turing, headed Chromium on the private Xvfb display, WebGPU,
1920×1080, DPR 1. Source: `118e2a7` plus the existing aircraft changes in this checkout, retained
unchanged. HMR and Vite's server watcher were disabled during captures.

The default SBD flight reproduced the degradation without the player using the new Devastator.
Nine actual C-key presses exercised chase, cockpit and wide view. The first completed frame window
reported 8.33 fps and 6.8 ms GPU; the second reported 9.55 fps and 7.74 ms GPU, then the scaler cut
the buffer to 998×562. The next window, already at 0.52 scale, still reported only 9.79 fps with
6.26 ms GPU. GPU readings are the observations at the window boundaries, not a GPU percentile.
Window 2's mean host gap was 51.56 ms, render work 37.37 ms and update work 15.77 ms.

The full-resolution start and visibly softer end frames were inspected. The unchanged CSS size
stretched 27% of the original pixels over the same viewport. This confirms adaptive scaling as
the mechanism of the reproduced blur and shows that shrinking pixels did not restore the target
frame rate. It does **not** isolate one CPU hot spot or prove the player's desktop runs at the
capture rig's frame rate. Oscillation auto-pinning and the 0.23 floor were **not observed**.
The camera switches were exercised, but their independent causal contribution was not isolated.

Raw samples and images: `screenshots/blur-before/` (local, ignored).

After repair, `package.json` and `pnpm-lock.yaml` install
`threenative-core-0.3.2-gpu-headroom-6367d7456bd5.tgz`. The game config remains `auto`.
Two attempted post-fix captures first failed during loading with Chromium
`ERR_INSUFFICIENT_RESOURCES`; they were not visual passes. The successful run above was captured
after the heavier build work finished. No AC-23 crowd/performance qualification or improvement
to host scheduling is claimed. Full engine verification has unrelated open lint/native-build
failures, recorded in PRD-384; all 1,224 core tests, native controller execution and both
typechecks passed. The source change is in core's `resolution-scaler.ts`; no permanent numeric
override remains in this game.

## How to confirm it live

After locating the active game scene as in `tools/capture-resolution.mjs`, read:

```js
const r = window.midway.ctx.renderer;          // framework renderer wrapper
r.surface();                                    // { resolutionScale, scaleSource, atFloor,
                                                //   sampleCount, drawingBufferWidth, drawingBufferHeight }
```

The original `window.midway.ctx.runtime.frameBudgetWindow()` probe was invalid: `ctx.runtime`
does not exist. The runtime object is passed separately to plugins. Capture the engine's console
marker `TN_FRAME_BUDGET:<json>` for fps, phase timings, GPU time and the surface. `atFloor` on
`renderer.surface()` is always false; the loop adds the actual scaler floor status to that marker.
`renderer.alphaAntialiasing()` reports alpha coverage independently.

Expected confirmation: `resolutionScale` < 1, `drawingBufferWidth` < CSS width, and either
`atFloor: true` or `scaleSource: "auto-pinned"` while `gpuMs` is modest (i.e. the deficit is not
pixels).

## Decision

Keep **`renderer.resolutionScale: "auto"`** and fix core. Pinning to 1 was tried as a proposed
workaround and reverted at the user's direction before acceptance. The engine now consumes the
GPU observation the frame budget already supplies: fresh GPU headroom prevents host delays from
spending pixels; real GPU overload sizes the drop; sustained headroom restores resolution even
when presentation FPS is low. Oscillation inhibits upward probes temporarily instead of disabling
adaptation permanently. Missing or stale GPU observations retain the existing presentation
fallback. GPU time is a resolved sample, not a percentile, and that limitation remains explicit.

No game-owned controller or node_modules patch is introduced. Numeric pin overrides still exist
and still preserve frame-budget reporting, but are not this repair.

Alternatives considered:

Game-side:
1. `renderer.resolutionScale: 1` (pinned) — image never blurs; fps may drop on a loaded host.
   `capture-performance.mjs` / AC-23 measures against the auto scaler, so this needs checking
   against that budget.
2. A fixed non-auto scale (e.g. `0.85`) — bounded quality loss, no runaway.
3. Keep `auto`, accept blur under load — rejected because that retains the reported defect.

Engine-side (upstream `@threenative/core`):
4. Make the scaler treat a CPU-bound deficit as un-actionable (do not keep dropping when the drop
   does not restore fps), or recover from `atFloor`.
5. Do not let the oscillation guard `auto-pin` below full resolution without a recovery path.
6. Expose pinning without disabling reporting — already supported; no new API is required.

Verification results are recorded on the acceptance criteria above.
