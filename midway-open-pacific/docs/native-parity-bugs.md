# Midway on the native desktop target — parity report

**Date:** 2026-09-17
**Lane:** `.worktrees/native-port` (branch `feat/native-port`, off `develop` @ `6cbad3e`)
**PRs:** [game #6](https://github.com/ThreeNativeHQ/examples/pull/6),
[engine #273](https://github.com/ThreeNativeHQ/threenative/pull/273). These PRs record the current CI results and merge commits.
**Final artifact:** `dist-native/midway-open-pacific`, SHA-256
`6f29f1f8d6178a2b3d25e7f3aa47e19cbffdddd5376e5d627d9e6c775c7ded5a`, 329,859,845 bytes. Its embedded
host prefix (first 127,706,336 bytes) is SHA-256
`a329e5cf5c30753754e4ba60d4b818a36aec5fa6ea1d642a74f70e4e4d3f3dd2`, an exact byte copy of the
preserved production runtime `/home/joao/.cache/midway-native-parity-fgODHg/runtime-a329/mystral`
(sidecar `mystral-tools` kept beside it). Build it with the supported CLI override and normal
preflight:

```sh
THREENATIVE_RUNTIME_BINARY=/home/joao/.cache/midway-native-parity-fgODHg/runtime-a329/mystral \
  pnpm build:desktop
```

The primary engine checkout's diagnostic `packages/runtime-native/build/tn-linux/mystral` must **not**
be used. The earlier UI baseline artifact `021f2d5a` embedded runtime
`973f480c33754a835637a0a6580ce762aa51304bf77676414eeb120bc458a848` (runtime `973f`) and is still the
source of the performance and visible-water evidence below. Host: Linux, NVIDIA RTX 2080, Vulkan/Dawn,
WebGPU.

This records the current behaviour on the desktop native target, the evidence for it, and what is
still open. It is not a chronology: superseded plans, options and dead-end investigations are gone.
Ephemeral evidence lives in `/tmp/midway-muse.fgODHg/` and
`/home/joao/.cache/midway-native-parity-fgODHg/`; both can be wiped.

---

## Status (current)

| # | Issue | Where | Status |
|---|-------|-------|--------|
| 1 | Native build refused: DOM in the game bundle | game | **fixed** — UI sits behind an `IShell`/`IHud` seam |
| 2 | WebP assets rejected for every tarball consumer | engine | **fixed** — fail-closed decoder probe |
| 3 | Native UI overlay untestable (no compositing manager) | engine | **fixed** — stock helper, COMPOSITE+SHAPE, SHAPE `Unsorted` |
| 4 | 2D canvas shim missing radial gradient / clip / dash / join | engine | **fixed** — real Skia pixels |
| 5 | Cockpit renders white | game | **fixed** — capability-based texture loader |
| 6 | React HUD / web UI never appeared on native | game | **verified** — full native route on the final artifact: OS T/R/H/L ack barriers, assisted recovery to the debrief and a real OS New Deck Sortie restart |
| 7 | Gunshots make no sound on native | engine | **fixed** — absolute scheduling; in-game PCM presence proved, exact latency not |
| 8 | Water/explosion effect presence | game | **verified** — final artifact: three clean explosion runs (impact, effect-specific counters); visible water burst proven on the `021` baseline |
| 9 | Intermittent WebGPU sampler-vs-texture `binding 7` | engine | **fixed** — one-binding WGSL decision mirroring `490f`; final artifact shows zero validation errors across 11 runs; paired engine filter flip RED→GREEN |

**Final parity: the listed native parity checks pass on the final artifact** — the 11 native
scenarios pass and the OS-composited route proved briefing, dropdown, Recon selection, OS T/R/H/L
acks, assisted recovery to the debrief (287.7 sim s) and the New Deck Sortie restart. Only CI/delivery
gates remain. The fresh `6f29` frames are the current proof; the earlier `021` proof frames and the
performance profile below are clearly labelled historical baseline. Do not call an effect fixed
or missing from a particle/effect counter: the counter can be structurally incapable of changing
(see #8).

---

## UI parity with the web build (verified)

The user's acceptance is "native behaves like web". The web UI is the reference and is reused
whole: `index.html` markup, `src/style.css`, `src/hud.ts` and `src/ui/dom.ts` are the *same* files on
both targets. `src/ui/main.tsx` mounts the published `index.html` body into the native web view
inside `<UiLayer>` and installs the same `createDomShell()`; the game reaches it only through
typed, JSON-safe published state (`src/ui/bridge.ts` → `src/ui/state.ts`) and returns the very
`Intent` values `dom.ts` already emits. **No second HUD and no redesign** — the markup and CSS are
shared; a screen added to the briefing reuses them on both targets, though new screens may still need
new typed handlers.

**Native `ui-parity` scenario is green** (`native-playtests/ui-parity.playtest.json`): the runner's
native injected input (`input.pointer`) selects the aircraft (torpedo loadout) and takes the deck,
`KeyQ` opens the command overlay, an injected pointer orders cover, and the map opens and closes.
Six asserted state resources, zero runtime diagnostics, 610 frames. On the final artifact all 11
native scenarios pass serially (ui-parity, explosion ×3, briefing, cockpit, launch, vfx, ui,
chooser, boot), each with `consoleErrors 0`. This is injected WebView input with state assertions,
not OS-level XTEST. Evidence: `/home/joao/.cache/midway-native-parity-fgODHg/final-native-scenarios/`
(final artifact `6f29f1f8`), plus the earlier
`ui-pointer-fixed/ui-parity-green.json` (runtime `973f`, game `77010d65`).

**Regressions are guarded without a browser** by `scripts/check-hud-transport.mjs`. It drives the
scene's *real* terminal transition (`Midway.update` on a debrief-status battle through the bridge)
and its real `restartToBriefing()`, and covers coalescing, event replay, session reset and the
cumulative-elapsed timing contract:

- HUD time is a **cumulative total of live seconds** (`elapsed`), not a per-publish `updateDt`. The
  web view applies only the increase since its last apply, so an event publish repeating the total
  adds nothing and several tick publishes coalesced into one flush still carry the whole interval
  exactly once. Rationale and the RED/GREEN evidence byte-for-byte:
  `/tmp/midway-muse.fgODHg/hud-time-fix-result.txt`.
- `hitSeq` stamps a hit as an event (never a level cleared after publish); a session id resets
  per-HUD memory so a replaced HUD's first toast/debrief is not dropped behind the old counters.
- The published state is JSON-safe: `undefined` is stripped, or the native sampler rejects the
  state and every native playtest dies the moment the HUD snapshot lands.

**Interaction proof and remaining seams.**

- **Visible debrief/restart proven on `021f2d5a`.** The normal recon route selected Recon through
  real OS input, started airborne, found/reported two carriers, returned with H and L, caught a wire,
  and displayed **Objective achieved — recovered** after 287.4 simulated seconds. Root inspected
  the composited `native-recon-proof/07-debrief.png`. A real click at `(494,520)` on **New Deck Sortie**
  returned to playing/deck servicing and hid the debrief; `08-restarted.png` was inspected too.
  Total wall time was 151.9 seconds including startup. No simulation state was injected.
  The immediate-return route has an accepted **matched pair**: a web run (`recovery-web-pair`)
  reproduced its pre-landing position and LSO acknowledgement, then failed the same way on both web
  and native — a shared route outcome, not a native input defect. Evidence:
  `/home/joao/.cache/midway-native-parity-fgODHg/{native-recon-proof,recovery-web-pair}/`.
- Artifact `021f2d5` supplied the earlier recon/debrief proof. The final artifact `6f29f1f8` carries
  the HUD cache fix and the removed briefing Enter shortcut (the sample embed is byte-identical to the
  earlier `a560`, only the host prefix changed). Its corrected OS-composited run proved the whole
  route at 1280×720 on the original mission timing: full **briefing**, a real OS dropdown open with
  the briefing preserved behind it, OS **Recon selection** ("Scout and report"), T/R/H acked within
  one poll (R/H at 28.4 sim s), first READY at 265.0, L acked at 265.1, assisted recovery to
  "Objective achieved — recovered" at **287.7 sim s** (wall 154.3 s), and a real OS click on **New
  Deck Sortie** (494,520) back to deck servicing. Frames:
  `/home/joao/.cache/midway-native-parity-fgODHg/native-os-ack-fixed-proof/{07-debrief,08-restarted}.png`.
  The injected scenario set separately proves `briefing` moves briefing→playing on an injected Take
  Deck pointer, while `chooser` asserts visibility only — **no Take Deck click** is claimed there.
- A `<select>` popup cannot be opened by the runner's injected events even when they reach the page,
  so the assignment dropdown was checked with real XTEST instead. Opening and selecting Recon work;
  the first capture also showed the briefing disappearing behind it. The engine now ignores only
  the temporary `NotifyGrab` focus event; real focus loss, including `NotifyWhileGrabbed`, still
  hides the overlay. Nine Rust tests pass. Root inspected the rebuilt native popup and Recon
  selection frames in `native-popup-focus/` on the `021` lineage: the full briefing stays visible.
  Selection alone would have missed this defect. On the final artifact the OS-composited capture
  reproduced the OS dropdown open with the full briefing preserved behind it and OS Recon selection:
  `/home/joao/.cache/midway-native-parity-fgODHg/{final-composited-proof,final-recon-os-proof,native-os-ack-fixed-proof}/`.
- **Final OS ack barriers (T/R/H/L), real XTEST.** On `6f29f1f8` the corrected harness used real OS
  XTEST keys with an acknowledgement barrier before each large batch: T/R/H acked within one poll
  (R/H at 28.4 sim s), first READY at 265.0, L acked at 265.1 (`lsoAck`, radio `R21`, LSO "Final
  approach assist engaged"), then the assisted final recovered to the debrief at 287.7 sim s and a
  real OS **New Deck Sortie** click restarted to deck servicing. An earlier immediate observation of a
  bridged KeyL without an ack is one observation with a different hold (2 vs 6 ticks); state publishes
  only every 6 ticks, so a 2-tick snapshot can be stale and a later 100 s radio sample can roll the ack
  off. That leaves the cause **unproven** — it does not establish what happened to the old key, and no
  cause in the input path is claimed. No bridge or production change was made, and the physical-window
  720 check did not itself recover, so the follow window was not the cause. Evidence:
  `/tmp/midway-muse.fgODHg/native-os-ack-fixed-result.txt`.
- The runner's pointer bug — pointer-down at the UI element but pointer-up at `(0, 0)` — is fixed by
  preserving the last point, including a cross-step bare release. It is shared by desktop and
  Android; the follow-up in `09d188100` also preserves explicit zero-mask releases and held gestures
  across wait steps. All 126 targeted checks pass. Engine CI run `09` was all green on a **previous**
  head; it is not the current commit and does not authorise a merge — see the gate counts below.

---

## Root causes kept

**#1 DOM-free game bundle.** The native builder bundles from `src/game.ts` and refuses any
`document.getElementById` (`TN_NATIVE_WEB_ONLY_UI`). The HUD now runs behind `src/ui/port.ts`
(`IShell`/`IHud`/`Intent`, imports no DOM); `src/ui/dom.ts` is the real DOM shell installed only by
the web/native web-view entry; `src/scenes/Midway.ts` is DOM-free. Ground truth, not assumption:
`window` and `document` exist on native but `Image` does not (`TN_GLOBALS`).

**#2 WebP preflight.** `asset-preflight.mjs` could only detect WebP from a runtime *source
checkout*, so an installed tarball release that reports `WebP format support: YES` was rejected as
"cannot tell ⇒ unsupported". The fix asks the shipped binary the question it already answers at boot
(`canvas.toDataURL("image/webp")`, `--no-sdl`, bounded 30 s, no display inherited): a **valid
explicit receipt** confirms support, while a missing, errored or malformed probe returns `undefined`
and the caller keeps its refusal. The selected runtime binary is authoritative: fail-closed and
bounded, with no foreign-host fallback.

**#3 Compositor and SHAPE.** The engine ships a stock compositor helper: private Xvfb with
`COMPOSITE+SHAPE` on PATH, borrowing `xcompmgr`/`picom`/`compton`; no compositor is shipped and the
old 358-line `xcompmin.c` prototype is removed. CI installs `xcompmgr`; `doctor` names the choices.
The `XShapeCombineRectangles` `BadMatch` (request_code 129, minor 1) was arbitrary DOM rectangles
declared `YSorted` when they are `Unsorted`; a real native unsorted-overlapping-regions probe went
RED then GREEN, with 7 Rust tests. The game UI now passes. There is deliberately **no fallback that
ignores X errors**.

**#4 Canvas 2D.** `createRadialGradient`, `clip`, `setLineDash` and `lineJoin` were implemented in
C++ on the existing Skia backend and verified in actual pixels, not by method presence alone.

**#5 White cockpit.** `cockpit-detail.ts` gated every texture load behind
`typeof window !== "undefined" && typeof Image !== "undefined"`; native has no `Image`, so the
guard skipped all loads and `pbr()`'s map-as-colour materials fell back to white. The loader is now
chosen by capability (`fetch` + `createImageBitmap`), with `flipY` handled at decode. The only site
with that pattern. Root viewed the final native cockpit frames: textures render rather than white and
the instruments read correctly.

**#7 Audio.** Native treated Web Audio's absolute `when` as a relative delay; Three.js supplies
`currentTime + delay`, so the clock was added twice. The engine now schedules at
`max(when, currentTime)`, proven by a rebuilt PCM regression. In-game, an SDL3 *disk* driver
captured the real output bus: a global matched filter on `gun-50.ogg` gives an absolute correlation
magnitude of **0.321** on the firing run versus **0.044** on the no-fire control, after the context
clock is running. That is **waveform presence only**; the correlation offset is fitted, so it makes
no timing or audible-speaker claim. The diagnostic detail in
`/tmp/midway-muse.fgODHg/effects-audio-result.txt` includes superseded visible/timing claims and is
**not** authoritative proof.

**#8 Water/explosion.** The old `state.particles changed` assertion was wrong: a water burst uses
`WaterEffects`, which returns before smoke/glow (`particles.ts:188-190`), so that counter could
never move. The scenario now asserts effect-specific resources. On a real release: ordnance `3→2`,
splashes `0→1`, `waterAccepted 0→1`, `waterRejected 0`. **The water burst is now visually proven**
on artifact `021f2d5a`: an overhead attack view with dive brakes kept the bomb impact in frame.
Root inspected `water-visual-proof/frame-0538.png` before impact and `frame-0550.png` /
`frame-0570.png` showing the new white spray at the impact point. The accepted impact occurred at
bomb age 541 ticks, with the aircraft still flying at 383.5 m. No carrier wake is present there.
Earlier captures missed the burst: the first overhead attempt projected impact below the 720 px
frame, while bomb-follow and rear-gunner attempts also failed to frame it. Counters alone were
insufficient; no rendering change was needed for this final framing check. On the final artifact
`6f29f1f8` the explosion scenario passed three independent serial runs, each with the same
effect-specific counters (ordnance `3→2`, splashes `0→1`, `waterAccepted 0→1`, `waterRejected 0`);
those are counter-level, so the visible-burst frames above remain the `021` visual evidence.

**#9 Intermittent binding 7.** A shader sampler versus layout texture validation error at
`CreateRenderPipeline`, `@group(1) @binding(7)`, reproduced in 2 of 5 older runs and again in the
latest sparse run. The named pipeline is the **Placard `label-instruments`** group. C++ diagnostics
captured the exact mismatch: nine shader bindings versus eight layout entries, with the first
sampler omitted from the layout and all later indices shifted. Three's WGSL builder decided sampler
inclusion twice from mutable texture properties. The owned Three patch (`490f9054`, the same change
in the root, `core` and template consumers) now emits declarations from the binding already created.
Two deterministic WGSL-filter-change regressions fail before the patch and pass after it. On the
final artifact a native pipeline census saw 69 `TN_PIPELINE_EVENT`s / 51 unique programs, all
`created`, with checkpoint `present=55 requested=69 emitted=69 outstanding=0` and **zero validation
errors** in every one of the 11 runs; the diagnostic `/tmp` markers are gone. Native pipeline labels
are retained as a **permanent** diagnosis aid (C++ only; no TEMP instrumentation). Three clean runs
are consistent with the fix but are not by themselves causal — that comes from the paired engine
filter-flip RED/GREEN tests.

---

## Gates and performance (current numbers)

- **Engine:** source head `b0925694`. Fresh full `pnpm test`: **5,492 passed / 5 skipped**,
  454 files passed / 1 skipped, exit 0; temporary-directory guard clean. Typecheck, lint, budgets
  and the native production build pass. An earlier browser-test failure did not recur in its
  isolated 19-test run or the fresh full suite; its cause was not established.
  The generated native-coverage digest was refreshed after the C++ change.
  [CI for this head](https://github.com/ThreeNativeHQ/threenative/actions/runs/35212649736) records
  the remote checks; the linked PR records the merge verdict.
- **Test isolation (fixed; full gate green):** `packages/runtime-native/tests/gpu/fetch.test.ts`
  recursed into and deleted the shared `runtimeNativeRoot/.test-tmp`, which
  `tests/webtransport/webtransport.test.ts` nested inside; under parallel vitest that deleted the
  WebTransport fixture before the native loader read it. Both files now create a private suite dir
  through the existing `test-support/temp-dir.ts` `makeTempDirSync` helper — **+7/-3 across the two
  runtime-native fixture files** (the earlier `+9/-6` was stale), no production/Rust/C++ change. The
  focused race pair is green (36 passed / 4 skipped), the temp-dir guard passes, and the awaited
  full `pnpm test` is the PASS above. Exact detail:
  `/tmp/midway-muse.fgODHg/test-isolation-fix-result.txt`.
- **Capture framing:** a root capture of 1600×900 against a 1280×720 window produced the grey border
  — a resolution mismatch, not a layout bug; matched size fills the frame. Resize at 1024×600 and
  1440×810 was accepted earlier. **GPU screenshots omit the WebView overlay**; UI proof needs an
  actual OS-composited capture. That capture ran on `6f29f1f8` at 1280×720 and proved the full route
  through the debrief and New Deck Sortie restart (see above), with every frame correctly fit.

The UI-enabled baseline artifact `021f2d5a` was measured twice on private Xvfb at 1280×720, FIFO,
4× MSAA: once without profiling and once with V8 profiling. The following values are from the
unprofiled run. Each row uses two complete 300-frame windows entirely inside its phase; p95 columns
are averages of the windows' p95 values, not pooled percentiles.

| Phase | FPS | Processing p95 | Presented interval p95 | GPU mean |
|---|---:|---:|---:|---:|
| Deck | 13.08 | 30.9 ms | 84.6 ms | 11.4 ms |
| Flight | 14.63 | 26.0 ms | 75.0 ms | 8.4 ms |
| Weapon use / nearby combat | 14.01 | 35.0 ms | 78.5 ms | 6.4 ms |

These are **virtual-display measurements, not physical-desktop FPS**. The combat window includes
ammunition running out; it is not continuous player gunfire. Composited frames confirm the deck,
airborne and firing states. This `021` baseline is the **only** performance measurement: the final
artifact was not profiled, and no final FPS or optimization benefit is claimed.

Correctly aligned V8 windows identify scene transforms/traversal and animation among the largest
named JS costs: `updateMatrixWorld` accounts for 7.6% / 14.1% / 11.4% of samples across the three
phases; GC is 1.7% / 0.9% / 1.0%. Roughly 38–41% remains in the unsymbolized native binary.
Host plus WebKit peak RSS/PSS was **3,936/3,745 MiB** unprofiled and **4,004/3,810 MiB** profiled.
RSS rose roughly 420–460 MiB during the run. This does not establish or rule out a leak.

Launch to the first 300-frame budget report took 56.2/54.2 seconds; this is **not first-frame or
click-response latency**. The initial analysis accidentally dropped `launch pid=…` and selected
windows 54 seconds early; the corrected parser and decoded ranges are in
`/tmp/midway-muse.fgODHg/perf/`, with the results in `profile-021-result.txt` in its parent directory.

---

## Reproducing this state

```sh
cd /home/joao/projects/threenative/sandbox/midway-open-pacific

# Build against a verified runtime. Pin the absolute path to the chosen content-hashed runtime;
# never the primary engine checkout's diagnostic build. The supported production runtime is
# a329e5cf5c30753754e4ba60d4b818a36aec5fa6ea1d642a74f70e4e4d3f3dd2 (runtime `a329`):
THREENATIVE_RUNTIME_BINARY=/home/joao/.cache/midway-native-parity-fgODHg/runtime-a329/mystral \
  pnpm build:desktop

# Native UI gate — the injected input/page proof. ui-parity.playtest.json is the scenario that works.
bash tools/capture-lock.sh node node_modules/@threenative/playtest/dist/runner/cli.js \
  --scenario native-playtests/ui-parity.playtest.json --target desktop \
  --executable dist-native/midway-open-pacific --timeout 600000

# Web must stay green.
pnpm typecheck
bash tools/capture-lock.sh node node_modules/@threenative/playtest/dist/runner/cli.js \
  --scenario playtests/launch.playtest.json --url http://127.0.0.1:5311 \
  --browser-recipe webgpu --headed --timeout 90000
```

Content-hashed artifacts: never trust a version or timestamp; rebuild against a new runtime hash.
Native scenarios in this lane: `native-playtests/{boot,launch,vfx,cockpit,ui,ui-parity,briefing,chooser,explosion}.playtest.json`.
(`recovery.playtest.json` was removed once the recon/recovery route was covered by the scenarios
above and is not part of the final set.)

---

## Delivery and cleanup

The linked PRs are the delivery record. Squash to `develop` requires the native proof above and
green CI on the final head. The verified binary/UI and runtime are preserved outside the task
worktrees in `/home/joao/.cache/midway-native-parity-fgODHg/`; unique local evidence was also copied
and hash-checked before cleanup. The user's primary-checkout `style.css` changes — one file, seven
added lines — are preserved. No deployment or release was requested.

There is **no temporary native instrumentation owed out**: `rg` over the tree confirms `TN_FIRE`,
`TN_GUN_EVENT` and `TN_AUDIO_LOAD` are absent. Native pipeline labels are a permanent engine
diagnosis aid (C++ only), not temporary.

Engine-side changes made outside this repo (squash candidates for #273) include the fail-closed
decoder probe, Xvfb `COMPOSITE+SHAPE`, the SHAPE `Unsorted` fix, the canvas 2D methods, absolute
audio scheduling, the pointer last-point fix, the popup `NotifyGrab` focus fix, the sampler
one-binding WGSL change (`490f`), and the runtime-native test-fixture isolation fix.
