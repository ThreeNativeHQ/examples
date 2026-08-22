# Session retro — 2026-08-22 Bayview map build

Mined from session `d98c4df5` (04:16–12:13 UTC−3, ~8 h wall clock, 757 assistant turns).
Goal: build the reference-image map in fps-framework with all details, playtest it, no bugs.
Shape: one lead + up to five focused sub-agents (`enemy-anim`, `textures`, `palms`, `facade`,
`assets`, later `props`), all sharing one machine, one GPU, and one display.

| Outcome | |
|---|---|
| Playtest suite | **20/20 passing** (was 10 starter platformer scenarios, all deleted/rewritten) |
| Enemy bugs | 3 fixed, each root-caused with measurements (stride 0.544 → 1.000, corpse float +0.388 m → 0, envelope radius 1.589 m → 0.453 m) |
| Textures | Root-caused: stucco stretched **4.7:1 on all thirty buildings**; replaced with world-space triplanar |
| Payload | `public/` 54.7 MB → 33 MB despite adding 20 textures + models |
| Committed | **Nothing.** Entire session sits in the working tree |

Companion docs: `docs/bayview-next-steps.md` (what to build next), `FRICTION.md`
(ledger format, rows 8–28), memory files `webgpu-captures-need-headed`,
`playwright-headed-needs-x11`, `skeletonutils-*`.

---

## 1. The capture bottleneck — deep dive

This is the friction that shaped the whole session. It has **three stacked layers**, and the
session paid for all three because they were discovered bottom-up, in the wrong order.

### Layer 1 — headless renders black

Headless Chromium cannot reach the Vulkan driver here: WebGPU falls back to SwiftShader,
the page boots, the HUD paints, and the 3D canvas is black with endless
`Instance dropped in popErrorScope`. It looks *exactly* like a scene bug. Cost: any agent
that trusted headless burned a debugging cycle on a healthy scene.

**Rule:** a black screenshot means the launch mode, not the scene. Captures must be headed.

### Layer 2 — headed hangs forever under native Wayland

With headless ruled out, `chromium.launch({ headless: false })` spawns the process but it
never answers the CDP pipe. Playwright dies with `Timeout 180000ms exceeded` after 120–180 s,
every attempt, regardless of flags — and **each failed launch strands ~5 chrome processes**
that later get counted as "concurrent browsers".

The fix is one environment strip: unset `WAYLAND_DISPLAY`, set `XDG_SESSION_TYPE=x11`,
forcing the XWayland path. Measured same flags, same second: **120 000 ms timeout → 175 ms
launch** (~700×). Found only after the facade agent lost 25 minutes to it.

### Layer 3 — concurrent headed captures starve the compositor

Five agents each holding a real WebGPU/Vulkan context rendering a ~380k-triangle scene at
60 fps made the whole desktop stutter. RAM was fine (20/62 GB); it was pure GPU/compositor
contention on an 8 GB card. Hence `tools/capture-lock.sh`: a machine-wide `flock` allowing
exactly one headed capture at a time, waiting its turn instead of failing.

### The diagnosis went wrong before it went right — worth remembering

1. Desktop stuttered → concluded "agents are ignoring the lock" → messaged all five. Wrong.
2. A monitor was armed counting chrome **processes**: reported 19. Reality: 5 browsers
   (helpers inflate the count). Metric was wrong before the conclusion was drawn.
3. Later the pressure flipped again — GPU idle at 0%, CPU load 5.04 from repeated Chromium
   **startup** churn, not rendering.
4. Finally the real story: what looked like "six concurrent browsers" was largely **hung
   zombie launches from Layer 2**, not disobedience.

Lesson: on this machine, a pile of chrome processes is a *symptom of failed launches* until
proven otherwise. Count browser main processes, not helpers.

### Current solution

```sh
tools/capture-lock.sh node verify-tmp.mjs /tmp/shots
tools/capture-lock.sh npx @threenative/playtest --scenario playtests/x.playtest.json \
  --url http://127.0.0.1:4175 --browser-recipe webgpu --headed
```

Does four things: serialises via `flock` (900 s default wait), reaps profiles stranded by
timed-out launches while holding the lock, strips the Wayland env, execs the command.

### Residual friction — unsolved

| Problem | Evidence from session |
|---|---|
| **Solo-use trap.** With no other capturer, the lock is pure overhead, and its 900 s wait produces failures that look exactly like test failures. Two false FAILs happened *after* all agents were gone. | Suite rerun needed after discovering lock timeouts masquerading as `aim-alignment` failures |
| **Lock = global throughput ceiling.** Queue reached depth 6; the lead *yielded its own slot* and stopped verifying so agents could finish. Correct trade (desktop stays usable), still slow. | "The lock is now the throughput bottleneck… That's the correct trade, just slow." |
| **No queue visibility.** Nothing shows who holds the lock, how long, or how deep the queue is; contention was inferred from process listings. | Repeated manual checks: "GPU 2%", "oldest browser 104 s" |
| **The fix lives in a wrapper everyone must remember.** Every agent had to be told; one implemented retry-with-backoff instead — which still starts the second browser rather than preventing it. | Agent corrected to the flock wrapper mid-session |
| **Tours must run against a static build.** Dev-server HMR (triggered by agents' edits) reloads the page mid-capture, resets the player to spawn, reinstates the bridge. An 18-stop tour captured the spawn frame 18 times. Also `TN_PLAYTEST_PAGE_NAVIGATED` false failures. | Tour rebuilt against `vite preview --outDir dist-verify`; two suite runs lost earlier to the same class of failure |
| **Blunt reaping.** `pkill -f playwright_chromiumdev_profile` is pattern-based; one `pkill -f verify-tmp.mjs` matched its own shell command line and killed the run it had just started. | Session log, near the end |
| **Round timer < tour length.** The 105 s round ends under a long tour; `RUN OVER` overlay covers every later frame until the harness learns to restart rounds. | Patched into the harness mid-tour |

**Update, later the same day — Layer 3 is fully closed.** A second concurrent session kept
flashing capture windows over the user's desktop and they banned visible captures outright.
Verified that headed Chromium under **Xvfb** reaches the real NVIDIA adapter
(`nvidia | turing`, not SwiftShader) and renders correctly — so `tools/capture-lock.sh` now
spawns a throwaway virtual display per run (`Xvfb -displayfd`, dies with the script) by
default. Captures are invisible, serialised, and hang-proof without anyone remembering
anything. Opt-outs: `CAPTURE_DISPLAY=<n>` (reuse a running display), `CAPTURE_ON_DESKTOP=1`
(emergency only). Gotcha fixed en route: `Xvfb -screen` takes two words; quoting
`"0 $size"` into one argument kills Xvfb instantly. Remaining residuals: solo-run lock
overhead (use `CAPTURE_LOCK_TIMEOUT=150`) and queue visibility are still open.

---

## 2. Other bottlenecks

- **Harness aim-convergence bug** (now fixed, pattern worth stealing): under pointer lock
  *every* mouse move feeds look input — including the move back to screen centre between
  corrections. Re-centring cancels each correction and walks pitch into its clamp; every
  tour ended staring at the sky. Fix: track cursor position, only move to in-viewport points.
- **Session limit** killed all five agents simultaneously mid-integration (`facade` and
  `props` left imports unwired). The lead finished solo — survivable only because
  territories were strict files.
- **Build weight:** `weapon-ak47.glb` + `player-viewmodel.glb` + `enemy-terrorist.glb` are
  **79 % of the 23 MB load**. Loading screen (real asset-counting progress bar) treats the
  symptom; Draco/meshopt on the AK is the actual fix.
- **Silent bundle-cache writes:** `asset_list_bundle_animations` wrote 15.7 MB into
  `public/` just from *listing* clips. Caught only by a dead-weight audit.

---

## 3. Friction inventory

New findings this session, plus the framework-API rows already in `FRICTION.md` that the
session kept paying against. Grouped by who can fix them.

### Machine / environment (fixable once, locally)

| Friction | Status |
|---|---|
| Headless WebGPU = black canvas | Documented, memory + CLAUDE.md |
| Wayland headed launch hang | Fixed in `capture-lock.sh` + memory |
| Concurrent capture GPU starvation | Fixed by lock; residual issues above |
| `xvfb-run -a` exits 1 on cleanup kill, failing wrapped gates | Documented in CLAUDE.md |
| Long-lived Vite dev server degrades under heavy HMR (`game.ctx` stops resolving) | Workaround: restart before deep probes; prefer static build |
| Playtest artifacts land inside the watched project tree; `usePolling` watcher reloads the page mid-scenario → `TN_PLAYTEST_PAGE_NAVIGATED` blames the game | Worked around via `server.watch.ignored`; scaffold default is still wrong |

### Framework API gaps (`@threenative/*`) — each forced a workaround

| Gap | Workaround shipped this session(s) |
|---|---|
| No relative pointer-delta / pointer-lock helper in `InputMap` | Hand-written `MouseLook` on raw DOM events (web-only path) |
| `RigidBody3D` takes `object` only, no `position` (asymmetric with `Area3D`) | Throwaway `Object3D` per static body |
| `moveAndSlide` writes transform *after* the frame | Compare previous-frame positions, never bracket the call |
| `AnimationPlayer.play(name, { fade })` is the whole API — no loop mode, no clamp-at-end, no finished event | Timer-driven ragdoll stop + own weapon state machine |
| `ctx.raycast()`: undocumented `screen` units, no world ray, nearest-hit only | Plain `THREE.Raycaster` against explicit hittable lists |
| Viewmodel is a child of camera ⇒ whole-scene raycast hits your own rifle | Explicit hittable arrays everywhere |
| State bridge throttled ~10 Hz vs per-frame HUD feedback | Stretched decay windows; kept per-frame FX in-scene |
| No static-collision-from-level helper (no compound/heightfield) | Parallel AABB array feeding hand-built bodies |
| Zero asset introspection (bounds/clips/axis) in `ctx.assets` or tools | Standalone `measure.mjs` + 3 DOM shims to run GLTFLoader under Node |
| `SkeletonUtils.clone` leaves degenerate `bindMatrixInverse` until first render | `#syncWorldMatrices()` funnel in `Enemy.ts`; weapons still carry the latent hazard (see next-steps §3) |

### Playtest schema & runner — facts that each cost a full run to learn

- Documented `holdFrames`/`waitFrames` are accepted by the schema **but do not advance the
  fixed-step clock**; only `holdTicks`/`waitTicks` work. The docs teach the broken spelling.
- `atSteps` accepts `equals`/`label` only — no ranges, so a measured height can't be asserted per-step.
- `notes` is not a valid root key; `allowTrivial` is the only free-text field that survives validation.
- The runner validates the whole scenario **before** running anything: a schema slip burns a
  full locked GPU slot and tells you nothing about your assertions.
- `warmupFrames` does not advance gameplay — drift arithmetic off by ~6× if assumed otherwise.
- No `lte`/`lt` anywhere; a countdown can't be asserted to go down, only to change.
- Managed server port hard-coded (4173), and repeated **ten times** inside one `package.json`
  string. No flag/env/config changes it.
- `pnpm test` was ten chained invocations of starter platformer scenarios with no glob;
  deleting the starter files (explicitly permitted) meant ten hard failures, and later two
  scenarios drifted out of the chain entirely, unseen.

### Test-design traps (pattern level, not instance level)

- **Shooting a patrolling soldier is inherently marginal.** 1.8 m placement + 35 tick wait =
  0.17 m lateral drift against a ±0.25 m hitbox window — a coin flip that passes most runs.
  Hardened twice; the *class* remains open until scenarios can place a non-patrolling soldier.
- **Assertions anchored on a floating body.** `headZoneMinY >= 1.3` passed only because the
  soldier floated 23 cm; fixing grounding broke the gate by 1 cm. The gate measured the bug.
- **Sticky maxima race warmup.** `locomotionRatePeak` passed three runs by luck; re-anchored
  on `blips.0.x changed`.
- **Gates can carry false waivers.** One threshold claimed "boundaries are fixed by the
  rigged model" while the trace showed it moving 1.46 → 1.29 during the run. The owning
  agent refused to relax another owner's gate; the trace settled it.

### Repo hygiene catches

- `.gitignore` excluded **all** of `public/assets/` — a fresh clone built with no textures;
  separately, `sky.jpg` was ignored while `Play.ts` loaded it.
- `references/` has no establishable provenance (UUID filenames, no licence metadata) —
  blocks redistribution, needs a human answer.
- `.gitignore` has no `.env` rule yet; ElevenLabs key work needs it first.
- Poly Haven credit must be **player-visible**, not just `CREDITS.md` — end-screen credit added.

---

## 4. Abstraction ideas

Ranked by (recurring pain avoided) ÷ (effort).

### Tier 1 — pay once, every future session stops bleeding

1. **Bake the environment fix into the runner, not the wrapper.** `@threenative/playtest`
   (or a local `tools/capture.mjs` façade) should, when launching headed: unset
   `WAYLAND_DISPLAY`, set `XDG_SESSION_TYPE=x11`, take the flock when `CAPTURE_LOCK=1` (or
   auto-detect concurrency), skip it when solo, and print lock state ("waiting on pid X").
   `capture-lock.sh` becomes an implementation detail and the false-FAIL-via-lock-timeout
   mode disappears. Same treatment for the scaffold's `pnpm test` script.
2. **One "look at the game" command.** Today seeing the finished map = build → serve static
   → run tour script → read frames, with dev-HMR poisoning the middle. Abstract to
   `tools/look.mjs [--vantage t-spawn,a-site,…]`: build, `vite preview`, one browser launch,
   N vantages + console dump + round-restart survival, through the lock. This subsumes
   `verify-tmp.mjs`, `shot*.mjs`, `tour-tmp.mjs` (a dozen one-off scripts exist at repo root).
3. **A way to place a non-patrolling soldier in a scenario** (`setup.frozen: true` or a
   route override). Unlocks: deterministic shooting scenarios, the missing zone-contrast
   negative control, and deletes both timing hacks. Named in the handoff as the single
   highest-leverage schema addition.
4. **Cheap client-side scenario validation.** Ship the runner's schema as JSON Schema (or a
   `--validate` mode) so `atSteps: [{gte}]`-style slips fail in milliseconds at authoring
   time instead of burning a locked GPU slot per mistake. Five such facts were learned the
   expensive way this session.

### Tier 2 — close framework gaps that force web-only/DOM workarounds

5. `InputMap`: relative pointer-delta channel + `requestPointerLock` helper. FPS look
   shouldn't require raw DOM reaches that break the native build contract.
6. `AnimationPlayer`: `loop` mode, `clampWhenFinished`, a `finished` promise/event. Death
   animations and one-shot fire→idle sequencing are impossible in-framework today.
7. Raycast upgrade: world-ray option (`{ origin, direction }`), `all` hits, and documented
   `screen` units. Hitscan weapons and occlusion tests currently bypass `ctx` entirely.
8. Asset introspection: `ctx.assets.model()` returns/attaches `{ bounds, clips, axis }`.
   Generalize `measure.mjs` (and kill its three DOM shims) into the loader.
9. Static-collision helper: `world.addStaticBox(aabb)` (or compound from merged level
   meshes) so levels stop hand-feeding parallel collider arrays.
10. Per-frame event channel beside the throttled store (e.g. `ctx.state.emit('hit')`),
    since a 10 Hz sampler structurally cannot carry hit markers or damage flashes.
11. Ship a clone-and-measure-safe helper (repair `bindMatrixInverse` post-clone, or a
    `safeBounds(obj)` that forces `updateMatrixWorld`). The SkeletonUtils hazard is subtle
    enough that the third party kit assets will keep biting.

### Tier 3 — scaffolding ergonomics

12. `pnpm test` globs `playtests/*.playtest.json` instead of a hand-maintained chain of 20
    clauses (which silently dropped two scenarios); server port from one variable/env.
13. Scaffold `vite.config.ts` ships with `server.watch.ignored: [artifacts, screenshots,
    playtests]` — the current default loses real runs to `TN_PLAYTEST_PAGE_NAVIGATED`.
14. Loading-progress reporting as a framework feature (`ctx.assets.onProgress`), replacing
    the hand-counted 23-asset bar.

---

## 5. What worked — keep doing this

- **Measure, don't reason.** Three of the four hardest bugs (foot slide, corpse float,
  texture stretch) were found by instrumenting; both times a plausible first hypothesis
  (root motion; geometry blocking the shot) was wrong and a rerun/bisect settled it.
- **Strict file territories per agent.** Five writers, zero merge conflicts; the facade
  agent respected the `town.ts` boundary and *asked* instead of writing. When it did need
  touching, the lead made the edit rather than adding a sixth writer.
- **The assets agent declined all eight force-fit asks** (boat, van, dishes, bollards…) with
  catalogue evidence, then caught two defects in already-shipped assets (missing
  roughness/metalness maps; ignored-but-loaded sky). Declining with evidence beat shipping
  lookalikes.
- **Keep a stale static build for bisecting.** The pre-facade snapshot disproved a
  cross-agent regression hypothesis in one run instead of a blame spiral.
- **Gate discipline across owners.** An agent refusing to relax someone else's threshold,
  and a trace falsifying a written waiver, turned two "failures" into a stricter suite.
- **Persisting environment fixes to memory** (Wayland hang, SkeletonUtils hazard) means the
  next session starts past the hardest part of this one.

---

## 6. Open decisions (human input required)

1. `references/` provenance — unresolved licence blocks redistribution.
2. ElevenLabs API key for the seven unwired audio cues (add the `.env` gitignore rule first).
3. Commit granularity — the entire session is uncommitted in the working tree.
4. Confirm whether the WebGL2 fallback exists at all now that materials moved to node
   materials (`preferWebGPU: true` currently implies a fallback that likely cannot draw them).
