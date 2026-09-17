# Midway on the native desktop target — parity report

**Date:** 2026-09-16
**Lane:** `.worktrees/native-port` (branch `feat/native-port`, off `develop` @ `6cbad3e`)
**Runtime:** locally built `packages/runtime-native/build/tn-linux/mystral`, passed to the build via
`THREENATIVE_RUNTIME_BINARY`. Host: Linux, NVIDIA RTX 2080, Vulkan/Dawn, WebGPU.

Midway now builds and runs on the desktop native target from one command. This records what was
broken, what was fixed, and the remaining gaps. This lane is still work in progress.

---

## Status

| # | Issue | Where | Status |
|---|-------|-------|--------|
| 1 | Native build refused: DOM in the game bundle | game | **fixed** |
| 2 | WebP assets rejected for every tarball consumer | engine | **fixed** |
| 3 | Native UI overlay untestable (no compositing manager) | engine | **partly fixed** |
| 4 | 2D canvas shim missing `createRadialGradient`, `clip`, `setLineDash`, `lineJoin` | engine | **fixed** |
| 5 | Cockpit renders white | game | **fixed** |
| 6 | React HUD never appeared on native | game | **verified: minimal React HUD visible; native UI gate passes** |
| 7 | Gunshots make no sound on native | engine | **absolute scheduling fixed; PCM regression passes; in-game audio still unverified** |
| 8 | Explosions reportedly missing on native | unresolved | **real bomb-drop gate fails: splash event recorded, particles absent at sample** |

---

## Slice: finish native parity (2026-09-16, in progress)

Bounded fix + performance slice. Acceptance criteria, each a native run under
`tools/capture-lock.sh` unless stated:

- [ ] **#7** A one-shot cue fired at t > 0 is audible at *that* time on native: `audio_graph_test`
      proves `start(when=currentTime)` sounds immediately (red before the fix), and a native
      capture shows the gun event's source leaves the active-source set instead of piling up.
- [x] **#6** A native capture of the running HUD shows non-blank pixels (crop distinct from sky).
- [ ] **#8** `native-playtests/explosion.playtest.json` actually releases a weapon, observes a
      hit, and asserts a *weapon-specific* effect — the assertion fails if the effect is absent.
- [ ] **#3** `TN_UI_OVERLAY:{"attached":true}` on a fresh Xvfb with COMPOSITE and no manager, and
      a captured root frame shows the overlay blended over the game.
- [ ] **Perf** `threenative-playtest perf --executable dist-native/midway-open-pacific` reports
      steady windows (startup discarded) for deck, air and combat, plus a
      native V8 CPU profile naming hot functions. The engine's `profile-production.mjs` profiles
      its template, not Midway; do not use that trace as evidence for this game.
- [ ] Gates green: game `pnpm typecheck`, `node scripts/check-*.mjs` in scope, native + web
      launch playtests; engine `pnpm typecheck && pnpm lint && pnpm test` (touched packages).
- [ ] Temporary probes (`TN_FIRE`, `TN_GUN_EVENT`) removed.

### Latest verification and remaining work

Tested game checkpoint: `0f344ac`. Engine snapshot: `7c17ff95e` on
`fix/midway-native-parity`, retained in the engine's `.worktrees/midway-native-parity`.

- Native `ui`, `launch`, `cockpit` and `vfx` scenarios pass. The cockpit image was inspected:
  olive frame and dark dashboard are visible. The React UI is only telemetry and a key legend;
  web briefing, map and debrief parity is not implemented. Logs: `/tmp/midway-native-target-gates.5FJunX/`.
- Native `explosion` fails: airborne and splash-event checks pass, but live particles are `0 → 0`.
  `artifacts/playtest/native-bomb-impact.png.png` shows no visible splash. Timing/camera versus
  missing rendering is unresolved; do not weaken the assertion or call this fixed.
- The rebuilt native `threenative-audio-graph-test` passes with `SDL_AUDIODRIVER=dummy`, including
  `absolute-start=1`. This proves PCM scheduling after the clock advances, not audible gunfire
  in the running game. Log: `/tmp/midway-audio-graph-test.log`.
- Web build and launch pass; game typecheck and the other recorded pure gates pass. Flight gate
  `scripts/check-flight.mjs:521` fails ordered-wing recovery in all five seeds. Engine typecheck
  and lint pass; full tests fail: three archive tests lack `zip`, the Android WebP source-contract
  check rejects the new diagnostic, and the Canvas2D script hash contract needs updating.
- Compositor review remains open: selection ownership, foreign-window destruction races,
  redirection before the first pump and stale background pixels need resolution and proof.
  Decoder-probe review also found an unremoved temporary directory and an Android fallback that
  consults a host executable rather than proving the Android runtime's capabilities.

Native performance was measured on private Xvfb, FIFO, 1280×720, 4× MSAA; these are not physical
desktop FPS. Unprofiled deck windows after startup: **15.04 / 14.99 FPS**, frame p95
**30.10 / 30.03 ms**, GPU **6.44 / 6.46 ms**, median host presentation **39.099 ms**. Both 60 FPS
and 16.7 ms gates fail. Log: `/tmp/midway-native-baseline.lFDZZa/probe.log`.
An actual V8 `--prof` run is in `/tmp/midway-native-initial-profile.m4J7ZL/`; preliminary JS hot
functions include `updateMatrixWorld`, `multiplyMatrices`, animation `_update` and scene `#visit`.
Its decoder reports a V8 version mismatch, and the profile includes startup. Flight/combat
performance, sustained memory growth and an optimization with measured benefit remain unverified.

The cheap implementation provider repeatedly returned no response, including a minimal health
probe. The latest retry was stopped without a model substitution; remaining fixes are parked,
not complete. No credit-exhaustion diagnostic was returned. Delivery is limited to draft review;
this lane is not ready to merge or release.

## 1. Native build refused — DOM in the game bundle (fixed)

`threenative build --target desktop` bundles from `nativeEntry: src/game.ts`, then text-scans the
bundle and refuses any DOM UI:

```
TN_NATIVE_WEB_ONLY_UI: desktop bundle contains document.getElementById.
```

The chain was `game.ts → scenes/Midway.ts → hud.ts`, and `hud.ts` is 959 lines of
`document.getElementById` driving the hand-written markup in `index.html`. The gate is correct:
native runs the game in its own JS engine, and the DOM belongs to the UI layer only.

**Fix.** The HUD now sits behind a seam:

- `src/ui/port.ts` — `IShell` / `IHud` / `Intent`, plus `nullShell`. Imports no DOM.
- `src/ui/dom.ts` — the real DOM shell. Imported from `src/main.ts` only.
- `src/scenes/Midway.ts` — DOM-free; reads input from `ctx.input`, emits/consumes `Intent`s.
- `src/render/world.ts` — publishes `cockpitView` instead of touching `document.body`.

An earlier attempt at this exists on the unmerged branch `feat/e3-native` (13 Sep, 62 commits
behind). This lane re-applied the approach to current `develop` rather than merging it.

Native input was verified end to end, not assumed:

```
TN_PROBE:{"keys":["KeyW"],"status":"playing","mode":"deck","throttle":0.43,"speed":19.0}
TN_PROBE:{"keys":["KeyW"],"status":"playing","mode":"deck","throttle":1.00,"speed":35.9}
```

`native-playtests/launch.playtest.json` passes: IAS 19 → 55 m/s, altitude 22 → 55 m, airborne true.

---

## 2. WebP assets rejected for every tarball consumer (engine, fixed)

`packages/runtime-native/scripts/asset-preflight.mjs` could only determine WebP support by reading a
runtime **source checkout** (`third_party/webp/libwebp-*`). Installed from the published tarball —
the supported path — it fell through to:

```
TN_NATIVE_ASSET_UNSUPPORTED: 19 assets cannot be decoded by the desktop target.
  ... is not a runtime source checkout, and a prebuilt desktop release does not declare
      which decoders it was built with
```

The runtime itself reports `[Mystral] WebP format support: YES`. So a release built *with* libwebp
was rejecting the WebP-packed GLBs the documented `gltf-transform webp` pipeline produces. This is
the same hardcoded staleness the file's own header warns about, pointing the other way: it treated
"I cannot tell" as "unsupported".

**Fix.** `probePrebuiltDecoders()` asks the shipped binary the question it already answers at boot
(`canvas.toDataURL("image/webp")`, from `src/runtime-scripts/image-support-init.js`), run under
`--no-sdl` with no display, ~0.6 s, cached per executable. A probe that cannot run returns
`undefined` and the caller keeps its refusal — the probe can never *grant* support.

Wired into both the desktop and Android prebuilt branches. Three tests added in
`packages/runtime-native/tests/desktop-assets.test.mjs`; 11 pass there, 27 across both preflight
suites.

---

## 3. Native UI overlay untestable (engine, partly fixed)

The desktop runtime refuses to attach its UI web view when no compositing manager owns
`_NET_WM_CM_S0`:

```
TN_UI_OVERLAY:{"attached":false,"reason":"no compositing manager is running, so nothing would blend the overlay"}
```

The playtest runner provisions a private Xvfb (`packages/playtest/src/runner/captureEnvironment.ts`)
with neither the COMPOSITE/SHAPE extensions nor a compositing manager. Consequence: **the starter
template's own shipped `native-playtests/react-hud.playtest.json` fails on a freshly scaffolded
project**, with a confusing `uiReady` mismatch rather than a named cause. Reproduced on a clean
`create-threenative --template starter`.

**Fixed part.** Xvfb now starts with `+extension COMPOSITE +extension SHAPE`, in both
`captureEnvironment.ts` and `packages/runtime-native/scripts/xvfb.sh`. 12 tests pass in
`capture-environment.spec.ts`.

**Still open.** Extensions alone are not enough — a compositing manager must also run. Verified by
hand: with the engine's own `native/ui-overlay/tools/xcompmin.c` compiled and running on the virtual
display, the same binary reports `TN_UI_OVERLAY:{"attached":true}`.

`xcompmin.c` is **not** in the runtime-native package `files` list, so a consumer cannot compile it.
Three options, none chosen yet:

1. Ship a compiled `xcompmin` in `prebuilt/<key>/` (needs a release).
2. Have the playtest runner compile it on demand (needs `cc` + X11 headers on the user's machine).
3. Have the desktop runtime self-redirect when COMPOSITE is present but no manager is (C++; fixes it
   for every consumer in test *and* production, no new dependency).

Option 3 looks right. Not attempted.

This does not affect a real desktop session, which has a compositor.

---

## 4. 2D canvas shim gaps (engine, fixed)

Probed against the shipped runtime:

```
missing methods:    createRadialGradient, clip, setLineDash, createPattern, roundRect
missing properties: globalCompositeOperation, lineJoin, filter, shadowBlur
```

`createLinearGradient` was implemented; radial was not. Any draw touching a radial gradient threw
(`c.createRadialGradient is not a function`), which took the whole scene build down until the game
added a fallback.

**Fix.** Skia was already the backend and supports all of these. Implemented:

- `createRadialGradient` — Skia's two-point conical gradient, which is exactly what the canvas spec
  describes. `CanvasGradient` gained `r0`, `r1`, `radial`
  (`include/mystral/canvas/canvas2d.h`, `src/canvas/canvas2d.cpp`, `src/canvas/canvas2d_bindings.cpp`).
  Degenerate handling differs for radial: concentric circles of *different* radii are the ordinary
  case and must still draw.
- `setLineDash` / `getLineDash` — `SkDashPathEffect`, odd-length patterns doubled per spec.
- `clip()` — `SkCanvas::clipPath`, scoped by the existing `save()`/`restore()` pairing.
- `lineJoin` — `SkPaint::setStrokeJoin`, mirroring the existing `lineCap` plumbing.

Verified against the rebuilt runtime:

```
TN_RADIAL:{"centre":[249,249],"edge":[0,0],"dash":[4,4],"join":"round"}
```

Centre opaque, edge transparent — a real ramp, not a uniform fill.

`createPattern`, `roundRect`, `globalCompositeOperation`, `filter` and `shadowBlur` remain
unimplemented. Midway uses none of them.

---

## 5. Cockpit renders white (game, fixed)

The whole cockpit interior rendered white and fully metallic on native; correct on web.

**Root cause.** `src/render/cockpit-detail.ts:53` gated every cockpit texture load behind a browser
sniff:

```ts
if (typeof window !== "undefined" && typeof Image !== "undefined") {
```

The native runtime's actual globals:

```
TN_GLOBALS:{"window":true,"Image":false,"document":true,"fetch":true,
            "createImageBitmap":true,"ImageBitmap":true,"HTMLImageElement":false}
```

`window` and `document` exist, but **`Image` does not** — so the guard skipped all texture loading.
And `pbr()` in that file carries no `color`: colour comes entirely from the basecolor **map**, with
`roughness: 1, metalness: 1` acting as map multipliers. With no map, every material fell back to
`MeshStandardMaterial`'s white, fully rough, fully metallic default.

Red → green, same probe both sides:

```
before   Interior green primer   color=ffffff  map=no    rough=1  metal=1
after    Interior green primer   color=ffffff  map=yes   rough=1  metal=1
```

**Fix.** Select the loader by capability, not by browser. Native has `fetch` + `createImageBitmap`,
which is exactly what THREE's `ImageBitmapLoader` uses, so the loader is chosen accordingly and the
texture gets `flipY = false` (an `ImageBitmap` ignores `texture.flipY`; the flip happens at decode
via `imageOrientation: "flipY"`). Confirmed visually: olive-green interior, dark instrument panel,
readable dial faces, blue attitude indicator — matching the web capture.

This was the only site in the codebase with that pattern (`grep "typeof Image\|typeof window"`).

### Related, kept

`canvasTexture()` in `src/render/assets.ts` now returns a 1×1 white `DataTexture` instead of
throwing when a target has no 2D canvas, or when a draw throws on an unimplemented method. Return
types widened `CanvasTexture` → `Texture` in `assets.ts`, `model-damage.ts`, `rear-station.ts`.
`createAttitudeFace()` in `cockpit-detail.ts` degrades to the painted dial face rather than
crashing. With the fixed runtime, zero textures take these paths (instrumented: 0 fallbacks).

---

## 6. React HUD never appeared on native (verified for the minimal HUD)

The overlay attached (`TN_UI_OVERLAY:{"attached":true}`) but drew nothing.

`Midway.publish()` called `ctx.state.set(...)` but never `ctx.state.flush()`. `set` only stages the
patch; the UI channel receives nothing until flushed. The web view attaches, subscribes, and waits
forever for a first snapshot — so `useUiState()` stays `undefined` and the HUD returned `null`:
an overlay that is present and permanently blank.

**Fix applied:** `ctx.state.flush()` after each publish, and `NativeHud` now renders
`SCOUT TWO · AWAITING TELEMETRY` before the first snapshot instead of nothing — a HUD that draws no
pixels is indistinguishable from an overlay that failed to attach, which is what hid this.

There was a second cause: `src/ui/main.tsx` rendered `NativeHud` without `UiLayer`, so `useUiState`
threw `TN_UI_LAYER_MISSING`. Wrapping it in `UiLayer` fixes that error. The running HUD was inspected
at `/tmp/midway-ofinish/boot1/root.png`, and the desktop `ui` scenario passes.

Supporting work: `src/ui/main.tsx` + `src/ui/NativeHud.tsx` (React, reads published state only),
`ui.renderer` set back to `"web"` so native composites the overlay. Published `GameState` is now
`{status, mode, altitude, ias, throttle, airborne, particles}`.

---

## 7. Gunshots make no sound on native (engine fix; game audio proof pending)

**Current finding:** native `AudioBufferSourceNode.start/stop` treated Web Audio's absolute `when`
as a relative delay. Three.js supplies `currentTime + delay`, so the old code effectively added
the clock twice. The engine now schedules at `max(when, currentTime)`. The rebuilt PCM regression
passes after the clock advances. The investigation below predates this finding.

**Symptom (user, on the real desktop):** engine and sea are audible; pressing Space produces no
gunfire sound.

### Established by measurement

| Fact | Evidence |
|---|---|
| Space reaches the sim | `TN_FIRE:{"keys":["Space"],"fire":true,...}` |
| The guns actually fire | `ammo` 1362 → 1350 → 1338 → 1326 → 1314 |
| The audio event is emitted | `TN_GUN_EVENT` ×48, `{"type":"gun","weapon":"gun50"}` |
| Audio is not muted | `muted:false` |
| Every sound file decodes | `TN_AUDIO_LOAD:{"loaded":140,"failedCount":0,"failed":[]}` |
| The AudioContext clock runs | `TN_CLOCK:{"samples":[0,0,0.0697,...,0.6037],"advanced":true}` |
| Web Audio exists on native | `AudioContext:true, createPanner:function, createGain:function` |

### Hypotheses disproven

1. *No Web Audio on native* — false. An early probe used `--no-sdl`, which disables audio; the
   user's own report (engine and sea audible) contradicted it. **Do not probe audio with `--no-sdl`.**
2. *Positional audio missing* — `createPanner` works. Note `PannerNode` and `createStereoPanner` are
   undefined globally and `listener.positionX` is absent (only the deprecated `setPosition` exists),
   but THREE falls back to `setPosition`, and gun events carry no `at` anyway.
3. *The gun buffer failed to decode* — all 140 buffers load. Note `Soundscape.load`
   (`src/audio.ts:305`) silently drops rejected decodes; instrumentation was added to prove this.
4. *The cooldown clock is frozen* — `#play` returns early when
   `now - lastAt < tune.cooldown`, with `now = bus.listener.context.currentTime`. A frozen clock
   would allow exactly one shot then silence, which fits the symptom perfectly — but the clock
   advances.

### Where it must be

Execution reaches `Soundscape.event()` with a valid unmuted gun event and a loaded buffer. The event
has no `at`, so it takes the **non-positional** path:

```
event()  →  #cueFor(e)  →  #play(cue, attenuation, lane, ownVolume)   [src/audio.ts:506]
                              →  this.bus.play(buffer, {...})          [@threenative/core AudioBus]
```

Engine and sea — the sounds that *do* work — are continuous loops via `syncEmitters()` →
`bus.playAt(buffer, source, {loop: true, ...})`. **The two paths differ: `bus.play()` vs
`bus.playAt()`.** The leading hypothesis is therefore that `AudioBus.play()` — the non-positional
one-shot — does not produce output on native, while `playAt()` does.

### Original next step (superseded by the scheduling finding)

One instrumented run: log immediately before `this.bus.play(...)` in `#play` (`src/audio.ts:515`) to
confirm the line is reached rather than short-circuited by `#cueFor` returning nothing, a missing
`ONE_SHOT[key]` entry, or `attenuation <= 0.01`. If it is reached, the fault is inside
`@threenative/core`'s `AudioBus.play` on native and the fix is engine-side.

---

## 8. Explosions reportedly missing on native (bomb-drop gate now fails)

**Current result:** the scenario now really releases a bomb and observes a splash event, but the
live-particle assertion fails and the impact frame has no visible splash. Root cause is unresolved.
The initial investigation below explains why the older scenario was not evidence:

- Particles do render natively — tracers are visible in `native-vfx.png`, and the published live
  particle count changes while firing.
- The explosion path does **not** use the 2D canvas: `water-effects.ts` builds its own
  `cloudTexture()` as a `DataTexture`, and `particles.ts` is pure TSL (`mx_noise_float`,
  `MeshBasicNodeMaterial`). So issue 4's fix does not touch it either way.
- `native-playtests/explosion.playtest.json` was written but never released a weapon — the aircraft
  flew level over open sea and no blast occurred, so there is no failing case to work from.

**Needed:** how the explosion was triggered — bomb on a ship, an aircraft shot down, or the player's
own crash. `tools/capture-crash.mjs` already drives a crash on web and would be the model for a
native equivalent.

---

## Reproducing this state

```sh
cd .worktrees/native-port/midway-open-pacific

# Build against the locally fixed runtime (issue 4 is C++; it is not in any released prebuilt).
THREENATIVE_RUNTIME_BINARY=/home/joao/projects/threenative/threenative-engine/packages/runtime-native/build/tn-linux/mystral \
  pnpm build:desktop

# Native gates
bash tools/capture-lock.sh node node_modules/@threenative/playtest/dist/runner/cli.js \
  --scenario native-playtests/launch.playtest.json --target desktop \
  --executable dist-native/midway-open-pacific --timeout 240000

# Web must stay green
pnpm typecheck
bash tools/capture-lock.sh node node_modules/@threenative/playtest/dist/runner/cli.js \
  --scenario playtests/launch.playtest.json --url http://127.0.0.1:5311 \
  --browser-recipe webgpu --headed --timeout 90000
```

Current results: typecheck clean; native launch passes; web launch passes; cockpit matches web.

New scenarios in this lane: `native-playtests/{boot,launch,vfx,cockpit,explosion}.playtest.json`.

---

## Cleanup owed before this lane merges

Temporary instrumentation is still in the tree and must come out:

- `src/scenes/Midway.ts` — the `TN_FIRE` probe.
- `src/audio.ts` — the `TN_GUN_EVENT` probe and the `TN_AUDIO_LOAD` logging.

The `TN_AUDIO_LOAD` reporting is arguably worth keeping in some form: `Soundscape.load` currently
discards failed decodes in silence, and its own doc comment claims a missing file is "reported once".
It is not.

## Engine changes made outside this repo

The original engine checkout retains its uncommitted work. A source snapshot is checkpointed at
`7c17ff95e` in `/home/joao/projects/threenative/threenative-engine/.worktrees/midway-native-parity`:

- `packages/runtime-native/scripts/asset-preflight.mjs` — decoder probe (issue 2)
- `packages/runtime-native/tests/desktop-assets.test.mjs` — 3 tests for it
- `packages/playtest/src/runner/captureEnvironment.ts` — Xvfb COMPOSITE/SHAPE (issue 3)
- `packages/runtime-native/scripts/xvfb.sh` — same
- `include/mystral/canvas/canvas2d.h`, `src/canvas/canvas2d.cpp`,
  `src/canvas/canvas2d_bindings.cpp`, `src/runtime-scripts/canvas2d-properties.js` — canvas gaps (issue 4)
- `native/ui-overlay/src/{argb,abi}.rs` — compositor prototype, review findings unresolved (issue 3)
- `src/audio/audio_context.cpp`, `tests/audio_graph_test.cpp` — absolute scheduling (issue 7)

Issue 4 is C++: it reaches other machines only via a new prebuilt runtime release. Until then a
build must pass `THREENATIVE_RUNTIME_BINARY`, or the cockpit regresses to white on any other
machine.

Staged tarball for issue 2: `.packages/threenative-runtime-native-0.3.2-decoderprobe-780fae08e012.tgz`.
