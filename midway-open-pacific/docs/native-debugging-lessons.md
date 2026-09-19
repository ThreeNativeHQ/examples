# Native debugging lessons — Midway Open Pacific

Reusable runbook for native parity work on this port. Durable issues and evidence live in
[docs/native-parity-bugs.md](native-parity-bugs.md); `/tmp/midway-muse.fgODHg/` and
`/home/joao/.cache/midway-native-parity-fgODHg/` are ephemeral. This is not a chronology.

## Does native playtest work? Yes, with limits

This investigation proves the Linux desktop target; it does not qualify Android or iOS.
The playtest CLI runs against `--target desktop` and drives a real SDL/WebKit binary, making real
native runtime assertions and GPU-frame checks (frames rendered, game state changed, overlay attach
reported). UI parity uses injected pointer and key events; pointer hits on UI are forwarded to
the WebView script. These are separate from OS-level XTEST: the `ui-parity.playtest.json` scenario
selects and launches an aircraft, orders a wing command and opens/closes the map under those
injected events with zero runtime diagnostics, asserted on state. On the final artifact `6f29f1f8`
this whole set ran as **11 serialized scenarios, every one `pass:true` with `consoleErrors 0`**
(ui-parity: 610 frames, 6/6 state asserts under the **injected page pointer, not an OS pointer**;
explosion ×3; briefing moved briefing→playing on an injected Take Deck pointer; chooser asserted
visibility only — **no click**; boot/cockpit/launch/vfx/ui too). Actual OS window routing and
`<select>` popups are a separate question, answered only by an OS-composited capture driven by real
XTEST input — not by this runner path. That capture ran on the final artifact and proved the full
1280×720 route through the debrief and New Deck Sortie restart (see below).

A native recon run on the earlier `021f2d5a` artifact proved the complete route: select Recon through
the real OS popup, start airborne, find/report a carrier, return with the existing assists, recover,
show the visible debrief, and click **New Deck Sortie** back to deck servicing. It took 287.4
simulated seconds and 151.9 wall seconds including startup. That popup capture also exposed a
separate defect: opening it hid the briefing. The engine now distinguishes a temporary keyboard grab
from real focus loss, and rebuilt native popup frames kept the full briefing visible; selection
success alone would have missed that visual failure. On the final artifact the popup verdict
repeated (dropdown open, briefing preserved, Recon selected). A corrected **ack-barrier** capture
with real OS XTEST T/R/H/L then proved the whole route on the original mission timing: T/R/H acked
within one poll (R/H at 28.4 sim s), first READY at 265.0, L acked at 265.1 (`lsoAck`, R21 and LSO
"Final approach assist engaged"), assisted recovery to the debrief at 287.7 sim s (wall 154.3 s), and
a real OS click on **New Deck Sortie** (494,520) back to deck servicing. An earlier bridged-KeyL run
that showed no ack is a **single observation with a different hold (2 vs 6 ticks)**: a 2-tick snapshot
can be stale (state publishes every 6 ticks) and a later 100 s radio window can roll the ack off, so
the cause stays **unproven** — it does not establish what happened to the old key, and no cause in the
input path is claimed. No bridge or production change was made, and the physical-window 720 check did
not itself recover, so the follow window was not shown to be the cause. Do not enshrine harness
mistakes as production bugs.

What it cannot prove on its own:

- The OS-composited WebView layer. A GPU framebuffer screenshot omits the overlay; an OS-composited
  root capture is required for anything visual in the HUD.
- Real OS pointer/resize routing and `<select>` popups: an injected event, even one that reaches the
  page, cannot open a popup. Only a separate OS-composited root capture driven by real XTEST input
  answers these; no runner scenario is claimed to open a select popup.
- Long-horizon outcomes on a wall-clock deadline: `waitForResource` advances **one fixed tick per
  mailbox round-trip**, so a 1-tick wait loop can exhaust the whole 120 s wall budget after only a
  few thousand simulation ticks. Use **ack barriers**: assert the fresh domain acknowledgement
  (`ackTicks`, `lsoAck`) before large transit batches, because state publishes only every 6 ticks and
  a 1–2 tick snapshot can be stale. The **immediate-return route** has a matched web pair — same
  pre-landing position and LSO acknowledgement, same failure on both targets — so that is a shared
  route outcome. A separate **recon web control was not equivalent** (objective at 28.3 s on web vs
  38.3 s on native, and the **native home command fired 10 s later**), so it neither proves nor rules
  out a native defect. The corrected real-OS run on the same game, defaults and no injected setup did
  recover. Record simulated time, the acknowledgement and the final outcome; reaching an intermediate
  gate is insufficient proof.
- A completed run is not a passing interaction. Assert the outcome state, then look at the frame.
- A destroyed aircraft does not guarantee a debrief. With friendly decks available, the current
  game can enter its downed/replacement flow; choose a route that actually reaches the screen being
  tested instead of relying on older crash documentation.

## Acceptance is separate checks

Do not collapse these into one verdict:

- Boot + render: process starts and a frame is produced.
- Overlay ready: native WebKit overlay attaches and reports ready.
- Click: an injected pointer event reaches a UI element.
- Acknowledgement: the game **acknowledged** the order (LSO/radio, or a persistent toast for a
  refusal), not merely received the input.
- Game state: the action actually changed simulation state.
- Visual: an OS-composited capture visibly shows it.

## Known facts (measured)

- GPU framebuffer screenshots omit the native WebKit overlay; they are not UI proof. Root captures
  were 1600×900 against a 1280×720 window — the grey padding was that mismatch, not layout.
- `xcompmgr` is the stock compositor; the engine owns private `COMPOSITE+SHAPE` Xvfb setup and
  borrows `xcompmgr`/`picom`/`compton` from PATH. The SHAPE `BadMatch` came from arbitrary DOM
  rectangles declared `YSorted` when they are `Unsorted`; a native unsorted-overlap probe reproduces
  it, and the game UI now passes. Keep platform fixes in the engine.
- The intermittent shader error (`@group(1) @binding(7)`, `Placard label-instruments`) required
  capturing both WGSL and layout entries: the shader had one extra sampler, and Three's builder made
  the sampler-inclusion decision twice. The patch (`490f9054`, same change at root/`core`/template)
  now emits declarations from the binding already created; a paired WGSL-filter-change test flips
  RED→GREEN. The final artifact's 11 native runs show 69 pipeline events / 51 programs all created,
  `present=55 requested=69 emitted=69 outstanding=0`, and zero validation errors. Keep the native
  pipeline label as permanent C++-only diagnosis.
- A water burst uses `WaterEffects`, not the smoke/glow particle path, so a particle counter is
  structurally incapable of proving it; assert effect-specific resources, and never read presence
  from a counter alone. Check actual projected pixel bounds when framing: the HUD's `visible`
  flag allows an off-screen margin, so it was true for an impact below the captured image. The final
  artifact passed the explosion scenario three times on counters; the visible spray remains `021`
  visual evidence.
- Runtime identity: rebuild against a content-hashed runtime and packs; never trust version or
  timestamp, never patch `node_modules/`. The supported runtime path is
  `/home/joao/.cache/midway-native-parity-fgODHg/runtime-a329/mystral` (embedded host prefix
  `a329e5cf…` in the final artifact). The native binary packs its own assets — never raw-run a
  foreign-cwd `game.js`.

## Recipe

```sh
# Run from the game checkout:
# /home/joao/projects/threenative/sandbox/midway-open-pacific
# Ensure a compositor (xcompmgr, picom or compton) is installed and on PATH first.
bash tools/capture-lock.sh \
  node node_modules/@threenative/playtest/dist/runner/cli.js \
  --scenario native-playtests/ui-parity.playtest.json --target desktop \
  --executable dist-native/midway-open-pacific --timeout 600000
```

Confirm the scenario path exists first (native scenarios live only in `native-playtests/`). Every
browser and native launch goes through `tools/capture-lock.sh` — no `xvfb-run`, no visible desktop.

## Next time — ranked improvements

1. **Wait for a fresh command ack, then batch transit.** Assert the fresh domain acknowledgement
   (`ackTicks`, `lsoAck`) before large `holdTicks`/`waitTicks` batches, and read the **persistent HUD
   toast** (`hud.toastText`, not `hud.toast`) for a refusal — a radio-only check can miss it. State
   publishes only every 6 ticks, so a 1–2 tick snapshot can be stale and a later sample can have rolled
   the ack off.
2. **Assert the real terminal outcome, and keep readiness/error evidence.** An ad hoc driver’s `ok` flag
   may mean only that it finished; assert debrief, recovery, restart, and absence of refusal. Retain native
   stdout/stderr even when mailbox attachment times out, so "attached" never means "interactive".
3. **An overlay-aware capture** that composites the WebKit layer, not just the GPU framebuffer, so
   debrief/restart/map are provable visually instead of inferred from state.
4. **A one-command reproducer** emitting the exact runtime hash, pack hashes, GPU, display and window
   geometry, so a run is reproducible without archaeology.
5. **Preflight that fails fast** when no compositor is on PATH, printing the exact install command.

## Method discipline

- Tiny probe first, one variable at a time. Compare embedded paths and bytes before blaming a new
  host binary: `package-desktop.mjs --assets` takes the `public` root. Passing `public/assets`
  stripped the `assets/` prefix and produced an invalid probe. Also inspect complete native binding
  fields; a splash counter alone does not prove visibility.
- Compare the same controls in the real web scene: match seed, assignment, loadout and input defaults.
  Confirm acknowledgement, not merely delivery: the LSO radio for a landing assist **and** the
  persistent HUD toast for a refusal (a radio-only check misses the refusal; `battle.ts:4455` →
  `Midway.ts:395` → `hud.ts:82`). Read the field name from the actual DTO — the refusal toast is
  `hud.toastText`, not `hud.toast`; a wrong-field lookup silently reads `null`, so pin it with a small
  fixture that fails on the wrong name before a run. Record simulated time separately from wall time;
  batch transit ticks and check more finely near a gate.
- Reproduce at normal verbosity; `MYSTRAL_DEBUG` can perturb timing. Add regression tests only after
  real proof, with actual outcomes. Exercise shared consumers too: the focused pointer tests missed
  the generated shooter's explicit button-mask release and an older click-test expectation.
- Profile with `TN_V8_FLAGS="--prof --no-logfile-per-isolate --logfile=/absolute/path/v8.log"`, then
  `node --prof-process --range=<cutoff>, /absolute/path/v8.log`. Pick the cutoff from your own tick
  histogram, not a copied 33000 ms; discard startup. Preserve launch timestamps even when their log
  lines carry extra fields, align the clocks, and exclude windows crossing phase boundaries. Never
  report Xvfb FPS as physical-desktop FPS.
- Check `df -h /tmp` before long captures: this host's `/tmp` is a separate 32 GB tmpfs that filled
  mid-debugging. Serialise with the wrapper's actual file lock — a PID in the lock file can be stale
  and `pgrep -f` can match its own polling shell and wait forever.

## Next action (<2 min)

Confirm a compositor (`xcompmgr`/`picom`/`compton`) is on PATH, then run the native UI smoke with the
recipe above.

## The host binary is not the package (2026-09-19)

`pnpm build:desktop` embeds the host from
`node_modules/@threenative/runtime-native/prebuilt/<platform>-<arch>/threenative-runtime`, and that
file is **downloaded from the release**, not shipped inside the tarball. On this machine the
published `runtime-native-v0.3.2` asset is a host older than the engine it is installed beside: the
binary answers `Mystral Native Runtime v0.3.0` to its own `--version`, while `install-status.json`
next to it says 0.3.2. Nothing in the package metadata reveals it, and `pnpm install` is happy.

A game built with that host starts, renders and plays — `boot` passes with 660 frames — but its UI
never composites: every scenario that clicks the overlay dies at
`waitForResource state.ui.screens.flight` with `frames 0`. Measured on one game bundle, only the
host changed:

| host embedded | boot | launch | cockpit | ui | native-select |
| --- | --- | --- | --- | --- | --- |
| published prebuilt (v0.3.0) | PASS | FAIL | FAIL | FAIL | FAIL |
| a host at the engine's version (v0.3.2) | PASS | PASS, 2011 frames | PASS, 1895 | PASS, 931 | — |

`native-select` was not re-run against the good host in this session; the three that were are
enough to show the failure is the host, not one scenario.

So name the host explicitly when the published one is stale:

```sh
THREENATIVE_RUNTIME_BINARY=/home/joao/projects/threenative/threenative-engine/packages/runtime-native/build/tn-linux/mystral \
  pnpm build:desktop
```

or put that binary at the prebuilt path and build normally. Note the trap this creates: the
`dist-native/midway-open-pacific` artifact in the tree is only as good as the host the last build
embedded, and a plain `pnpm build:desktop` re-embeds the stale one.

The engine's `threenative doctor` now refuses the stale host — `✗ native runtime: unavailable — the
linux-x64 host reports runtime v0.3.0, older than the installed engine 0.3.2`, exit 1 — where the
same command previously printed `✓ native runtime: available (linux-x64)`. Engine commit
`6571c4ed5`; the red-green is in `packages/create-threenative/__tests__/doctor.spec.ts`.
