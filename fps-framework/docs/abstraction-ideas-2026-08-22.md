# Abstraction ideas from the fps-framework sessions — 2026-08-22

Proposals for what to abstract next so agent-built games (FPS first, general games
second) get cheaper to build. Every idea is gated against
`threenative-engine/docs/architecture/CHARTER.md`; ideas that fail a charter test are
listed as rejected, not quietly dropped.

**Sources:** the 2026-08-22 session retro (`session-retro-2026-08-22.md`),
`FRICTION.md` rows 1–27, `bayview-next-steps.md`, a fresh read of `src/` against the
installed `@threenative/core@0.2.0` API surface, mining of nine prior session
transcripts (Aug 18–22), and `threenative-engine/docs/PRDs/OPPORTUNITY-AREAS.md`.

---

## 0. The charter tests every idea below passed or failed

| Test | Rule applied |
| --- | --- |
| Two questions (§11.1) | Framework owns it only if the game **cannot write it portably** AND it **decides nothing about how anything looks**. Appearance ⇒ generated source in `src/render/` or a template. |
| Kill switch (§3) | Cost counted **across every repetition in one game**, never per site. Anything costing more than vanilla-across-sites gets deleted. |
| Closed list (§2) | No ECS, presets/genre recipes, editor, scene format, IR, bespoke CLI vocabulary — regardless of how clean a proposal sounds. |
| Conventions (§1) | A convention ships with a default, a named override, honest reporting when overridden — **and an entry in the template's `AGENTS.md`, or it does not exist**. |
| Native proof (§11.1.4) | Anything admitted because it is unportable lands with a native-arm conformance case or `--target` playtest in the same commit. |
| Opportunity areas | Rows the engine already scored/bounded (animation trees WONTBUILD, particles bounded by PRD-027, navigation browser-only behind `?navigation`) are respected, not re-litigated. |

---

## 1. Migrate before building — core 0.2.0 already lifted half of this game

The single cheapest efficiency win: the engine absorbed several of this repo's
hand-written mechanisms, and this repo still runs its own copies. Migrating deletes
local lines, gives each lift the live-caller proof §11.1.4 wants, and would have
prevented the documented failure where an agent wrote 206 lines of grid A* and 240
lines of bone-socket code while `@threenative/physics/navigation` and `attachToBone`
sat installed and importable (PRD-156/157 postmortem; cohort went 0/3 → 2/3 after the
capability census landed).

| Core 0.2.0 export | This repo's local copy | Action |
| --- | --- |---|
| `TracerPool3D` (+ `ITracerPool3DOptions`) | `src/render/tracers.ts` (102 lines, class `Tracers`) | Delete; spawn sites take options for colour/material. The lift itself was proposed by this repo's own session triage and promoted in PRD-162 with the charter-safe shape — material required, no colour parameter |
| `softCircleDataTexture`, `prewarm()` | `src/render/particles.ts` (39) + hand-rolled zero-opacity prewarm at ≥5 sites (`Rifle.ts:130-158`, `gunfx.ts:219-221`, `Play.ts:559-562`) | Delete; one `prewarm()` call per effect root |
| `normaliseToMetres` / `skeletonBones` / `attachToBone` | `src/render/scale.ts` longest-axis logic, `Rifle.#measureBarrel` optic search, standalone `measure.mjs` | Replace; keep only game-specific pose constants |
| `GroundSnap` | Enemy corpse grounding + settle timer block in `Enemy.ts` (~129-line class of the kind PRD-156 records) | Verify parity (leg-settle IK may stay game-side), then adopt |
| `PathFollow3D` | `ROUTE` walking in `Enemy.ts` patrol legs | Partial fit only — patrol needs straight legs + nav replanning, not CatmullRom; adopt where it fits, keep steering |
| `AnimationPlayer` `mode: "loop"\|"once"` + `finished` | Timer-driven ragdoll stop (`ctx.after(1.1, …)`), hand clip selection in `Rifle.update` | Adopt `once`+`finished`; delete timers |

Estimated deletion: ~300–500 lines. **Migration is also the acceptance test for the
lifts** — if `TracerPool3D` cannot express the enemy-tracer colour split, that is a
defect in the lift, found now and not by a stranger.

Charter fit: pure kill-switch win (vanilla-across-sites loses; the framework column
already exists). No new surface, no new package.

---

## 2. Framework mechanism proposals (Q1 pass, Q2 clear)

Ranked by recurring pain ÷ effort, using evidence from the sessions.

### 2.1 Scenario-controlled spawn & aim — the biggest single time sink found

**Evidence:** one overnight session ran 13 identical five-command cycles (patch
`SPAWN` → run playtest → copy frame → revert patch) just to capture vantage frames;
~65 of its commands were this ceremony. Aggravators, all real: two sources of truth
for the player start (`town.spawn` exists but "`Play.ts` never reads town.spawn"), a
silent no-op when an override didn't take, and revert slips that corrupted `town.ts`.
The zone-contrast pair works today only via the hand-built placeholder-quaternion
channel (`game.ts:24-40`, `Play.enter()` reading `"enemy-frozen"`/rotation).

**Proposal:** a first-class scenario `setup` placement vocabulary — `spawn: {x,z}`,
`aim: {yaw,pitch}` — delivered through the same entity-placeholder mechanism, plus
the template convention **one owner of the player start**. The frozen-sentry flag
(`frozen: true`) graduates from a game hack to the same vocabulary
(`place: {entity, at, facing, frozen}`). Two session lessons shape it: aim must be a
runner-native `aimAt(zone)` step — one setup = one pitch is why zone contrast shipped
as *two* scenario files, and CDP mouse deltas read zero without OS focus — and
placement needs explicit presence semantics, because the current sentinel hack parks
`enemy-frozen` at y=−1000 after an origin-spawn was silently rejected by a
`lengthSq() > 0` check ("that bug bit me once").

**Gate:** playtest harness is framework-owned (§5b left column); it observes and
stages, it does not decide looks. The game keeps its own spawn constants; scenarios
override them for determinism. Honest-reporting rule applies: an overridden spawn
must be visible in run diagnostics, never silent.

### 2.2 Static collision from level data

**Evidence:** `Play.enter()` hand-builds one fixed body per AABB (`staticBody`
closure, `Play.ts:269-294`) from `town.colliders` — the same array doubling as the
enemy's nav blocker set. FRICTION.md row 23: "no 'add this mesh as static collision'
helper and no compound/heightfield path", workaround = parallel collider array.

**Proposal:** `ctx.physics.world.addStaticBoxes(aabbs)` (batch create, one ABI
crossing), later compound-from-mesh, with the builder asserting/clamping positive
extents — descending stair flights produced `CollisionShape3D.box requires a positive
finite value` crashes until the map builder grew its own standing guard. Physics
binding is the canonical Q1-pass area —
Rapier web-WASM vs native typed-array ABI is exactly what a game cannot write
portably.

**Gate:** mechanism only; shapes and placement stay in game data. Native-arm proof
required in the same commit (§11.1.4): one `--target desktop` playtest asserting the
player still slides along a batch-added wall.

### 2.3 Asset-loader decoder seam

**Evidence:** the installed loader is literally `new GLTFLoader()` — a bundle-wide
grep finds no draco/meshopt/ktx2 decoder wiring anywhere, identical on web and
native. `tools/optimize-models.sh` therefore refuses Draco/meshopt ("both need a
decoder wired into GLTFLoader at runtime, and `ctx.assets` is framework-owned") and
an agent that correctly identified Draco as the payload fix *stopped and reported*
rather than shipping it — twice. The workaround pipeline (quantize + WebP +
`--vertex-layout separate`, now an mtime-cached vite plugin taking `public/` from
54.7 → 16 MB) works precisely because it needs no decoder at load time.

**Proposal:** two routes, both already asked for by name — the user's words during
the pipeline work were "any way the engine can do it without the dev needing to lift
a finger?": (a) wire decoders in core (`defineGame({ assets: { decoders: { draco,
meshopt } } })`, scaffold prewiring the common case) so Draco payloads load
everywhere; or (b) bless the decoder-free optimize plugin upstream into
`create-threenative` as scaffold default — it is proven, cached, and needs zero
runtime surface. (b) is shippable today; (a) unlocks the remaining headroom.
Three.js ships both decoder paths already; this is wiring, not wrapping.

**Gate:** Q1 pass — the loader is framework-owned. Q2 clear — decoders change bytes,
not pictures. Bonus: unblocks the payload fix with zero new asset work.

### 2.4 Loading progress as a framework feature

**Evidence:** `Play.load()` hand-counts 23 assets with a `track()` closure wrapper
(`Play.ts:129-138`) and the HUD caps its bar at 92% because "ready" ≠ "last byte".
Every future game re-derives this or ships a black canvas. PRD-075 already owns
loading-scene separation; progress is the missing input to it.

**Proposal:** `ctx.assets.onProgress(cb)` (or a returned promise handle with
`{loaded, total}`). Q1 pass (asset loading is framework-owned); Q2 clear (numbers,
not pixels). The same session produced the structural reason it keeps being
hand-counted: the load list lives as one 26-line `Promise.all` destructure in
`Play.ts`, so *every* asset addition touches that one file — a parallel agent had to
file a cross-ownership request and the lead made a six-line edit personally. Modules
declaring their own load requests, aggregated by the scene, fix both: no single-file
chokepoint, and progress falls out of the aggregation for free.

### 2.5 A per-frame channel beside the throttled store

**Evidence:** hit feedback is stretched to survive 10 Hz sampling — `hitFlash`
decays over 0.42 s so the throttled sampler cannot miss it (`FRICTION.md` row 22,
`Play.ts:682`). Camera shake, muzzle bloom and damage vignettes stay out of React
entirely. The store's own docs say "never subscribe a component to per-frame data"
but name no alternative.

**Proposal:** `ctx.state.emit(event)` — a small event queue React drains via
`useSyncExternalStore` at animation rate, for events shorter than one sample
(hitmarker, damage flash, kill feed). The throttled JSON store stays the channel for
numbers.

**Gate:** UI state bridge is framework-owned (§5b left column). It carries events;
it styles nothing.

### 2.6 AudioBus spatial tuning at call time

**Evidence:** `GameAudio.#spatial()` reaches past the bus into three's
`PositionalAudio` to set ref distance and rolloff per family, with the comment "The
bus exposes only fade/loop/volume, and three's panner defaults … make a shot 20 m
away all but silence" (`GameAudio.ts:283-291`). Six tune families, all set post-hoc,
every game.

**Proposal:** `playAt(buffer, at, { refDistance, rolloff })`. Thin option pass-through
over a surface the engine already proves on the native mixer (OPPORTUNITY-AREAS #6);
no new opinion about sound design.

### 2.7 AnimationPlayer completion verbs — measured, minimal

**Evidence:** three independent hand-rolled workarounds in one game: ragdoll stop by
timer (`ctx.after(1.1,…)` because death clips looped), locomotion rate driven by
reaching into the mixer action (`timeScale` "lives on the mixer action, not on the
player" — `Enemy.ts:997-1001`), and clip selection state machines in both `Rifle.update`
and `Enemy`. `mode:"loop"|"once"` + `finished` exist in 0.2.0 but no finished
*callback*, and no rate control on the player. A third measured verb: phase events — footsteps
are synced by *two different hand-written mechanisms in one codebase* (distance
accumulator in the player, locomotion action half-cycle crossings in the enemy)
because `AnimationPlayer` emits nothing at clip phase boundaries.

**Proposal:** `play(name, {onFinished})` (or a `finished` promise) and
`setRate(name, scale)`. Explicitly NOT an AnimationTree/state machine — that is
PRD-039 WONTBUILD, and the reopen condition (measured crossfade/root-motion gap) is
only met for these two verbs. Gameplay sequencing stays the game's job (§2: gameplay
architecture is the model's job).

### 2.8 The moveAndSlide write-timing contract

**Evidence:** measuring the mesh either side of `moveAndSlide(dt)` reads zero
forever; discovered via a silently-zero odometer (`FRICTION.md` row 10). Workaround
(previous-frame comparison) is now load-bearing in `FpsPlayer.ts:152-167` stride
logic. Nothing fails; typecheck, HUD and scenes all look right.

**Proposal:** smallest honest fix first — document the timing as a physics
convention in the template `AGENTS.md` with the previous-frame idiom (§1: a
convention not documented there does not exist). If the backend can write transforms
synchronously, do that instead; otherwise expose `body.frameDelta()` so the idiom is
one portable call rather than re-derived bookkeeping. Native-arm conformance case
required either way.

### 2.9 Dev-link mode for scaffolded games

**Evidence:** engine fixes reached the game as packed tarballs — "getting the engine
fix into the game — it consumes a packed tarball"; every crossfade/pop repair cost a
pack + reinstall cycle inside a debug loop.

**Proposal:** `create-threenative` gains a dev mode that links workspace packages
(pnpm `link:`/`file:` with watch, or a documented `pnpm.overrides` recipe) so an
engine fix is visible in the game on rebuild. Tooling ergonomics, no runtime
surface; saves a pack-install round trip per engine iteration.

### 2.10 Runner environment bake-in (retro Tier-1 item, still open)

**Evidence:** the whole Layer-1/2/3 saga (headless black canvas → Wayland hang at
120 s vs 175 ms → GPU starvation → Xvfb ban on visible captures) is currently solved
by a wrapper everyone must remember, whose solo-run lock timeout produced two false
FAILs *after* all agents had gone home. Residuals: solo-use trap, no queue visibility.

**Proposal:** move the environment handling into `@threenative/playtest` launch:
strip Wayland env, prefer a private Xvfb, take the flock only when concurrency is
detected (or `CAPTURE_LOCK=1`), print lock state, default solo timeout low.
`capture-lock.sh` becomes an implementation detail. Same treatment inside the
scaffold's `test` path.

*Update, same day:* queue visibility and the worst false-FAIL mode landed in the
wrapper — lock timeouts now exit 75 printing `LOCK TIMEOUT … NOT a test failure`
with holder and queue depth, and serialisation ended the mid-run browser kills.
What remains open is exactly the structural point: all of this lives in a wrapper a
fresh subagent context can bypass, and one did — a subagent launched visible
Chromium *with the mandate written in CLAUDE.md*, and it took two user interruptions
to stop. The fix was changing the wrapper's default (private per-run Xvfb), not
restating the rule. The sky-stare aim bug had the same life: fixed inside a throwaway
harness script, script deleted, next session re-derived it blind. **Harness-class
fixes must land in the runner; prose constraints and temp scripts do not hold.**

**Gate:** test harness ownership is explicit in §5b. No new CLI verb — behaviour of
the existing `test` command.

### 2.11 One "look at the game" command — as a project tool, not a CLI verb

**Evidence:** seeing the finished map = build → static serve → tour script → read
frames, poisoned mid-way by dev-server HMR (an 18-stop tour captured the spawn frame
18 times). A dozen one-off `*-tmp.mjs` scripts exist at repo root for exactly this.
`TN_PLAYTEST_PAGE_NAVIGATED` false failures came from watcher reloads.

**Proposal:** scaffold ships `tools/look.mjs [--vantage …]`: production build →
`vite preview` → one browser → N vantages + console dump, runner-environment aware
(2.10). Deliberately a **project tool invoked with node**, not a fourth-plus-one
framework command (§6: four CLI commands, ever; §2 anti-bespoke-CLI). The scaffold's
`vite.config.ts` also ships `server.watch.ignored` for artifacts/screenshots/playtests
— the current default loses real runs.

Related small runner fixes from the same sessions: detect Vite's real bind address
(one session lost ~15 runs to `ERR_CONNECTION_REFUSED` on an IPv6-only bind before
resorting to `http://[::1]:…`; `vite preview` binding IPv6-only cost another
restart), clean stale listeners on the managed port before starting (a leftover
holder turned one port conflict into a full 23-scenario chain rerun), bake the
anti-background-throttling flags into the recipe for multi-agent hosts (headed
windows in focus fights throttled each other's fixed-step loops mid-run:
"Cannot advance a stopped loop"), honour an occlusion flag in perf probes
(minimised-window rAF throttling silently corrupts frame-time captures), and write
playtest artifacts outside the watched tree by scaffold default.

### 2.12 Renderer-honesty debug overlay

**Evidence:** an eight-iteration lighting spiral cut light after light before someone
found "Exposure is 1.14 — that's the real blowout" in postprocessing; separately the
SwiftShader-vs-NVIDIA adapter confusion cost multiple agents (now partly handled by
`TN_PLAYTEST_SOFTWARE_ADAPTER`).

**Proposal:** a debug readout (dev overlay or playtest artifact field) reporting
effective tonemapping exposure, adapter identity, and captured-frame luminance
percentiles — numbers only, so tone-mapping faults stop being misattributed to
lights. Q2-safe: it measures the picture; it decides nothing about it. Pair with
surfacing unused downloaded assets (an ignored-but-loaded sky and a shipped-unused
paving set were both caught late). Same honesty family, cheapest of all: a renderer
guard that warns or fails on `CanvasTexture` maps under WebGPU. The black-texture
trap is documented, was hit again this week anyway ("the old muzzle spark literally
rendered untextured"), and `softCircleDataTexture` already ships the way out.

### 2.13 Raycast-target auto-registration

**Evidence:** the hand-maintained `hittable` array omitted the scoring plates for a
whole pass — "the round flies through the plate and headshot-kills the waterfront
rover 7 m out behind it." Every entity already registers itself with `ctx.entities`;
raycast membership is a second, parallel hand-run list (`Play.ts:406-413`).

**Proposal:** entities (or meshes) declare themselves raycast targets at construction
and join a framework-owned set that `ctx.raycast({targets})` reads by default; scenes
override with explicit lists when they want narrowing. `ctx.raycast` is already
framework-owned with per-geometry acceleration structures — membership is mechanism,
not appearance, and the default fixes the omission class instead of documenting it.
Convention-with-range rules apply: explicit lists win over auto-registration, and an
entity excluded by a scene's list reports as such.

### 2.14 Dev-server supervisor

**Evidence:** three incidents in one session, all infrastructure: a day-old dev
server serving stale modules ("the log string proves it loaded the old `Play.ts`";
HMR-degraded state broke deep probes until restart), a port conflict with the test
chain's managed server causing `TN_PLAYTEST_SERVER_FAILED` and a full-chain rerun
(15–25 min), and two lanes sharing one live server breaking each other's runs on
every save until they improvised a chat handshake ("town clean" ping → holds runs).

**Proposal:** one supervisor owning port registry, freshness check and restart, used
identically by agents, probe scripts, audits and the `test` chain. Lane coordination
becomes build-gate locks instead of chat contracts; relaunch paths check liveness
first (a "crashed" agent recovered once and its replacement had to be killed before
they clobbered each other's edits). No new CLI verb — internal to the runner/tooling.

### 2.15 Asset fetching without an MCP host

**Evidence:** the asset MCP failed three independent ways in one week — stuck at
"Pending approval" with tools never loading, invisible because the session launched
from the parent directory, and absent entirely inside a subagent. The workaround an
agent shipped under user pressure: a hand-written standalone CLI dropped into the
global nvm bin ("asset fetching from the terminal, no MCP host approval needed";
"must be always available on tn").

**Proposal:** make that fallback durable *in the asset package's own release lane* —
`asset-mcp` already publishes independently (charter §8), so a `tn-assets fetch`
binary beside the server needs no framework CLI verb and stays outside §6's
four-command rule. The launch-dir fix (postinstall `.mcp.json` writer) landed;
host-approval and subagent-starvation modes remain.

### 2.16 Multi-agent lane primitives

**Evidence:** across two orchestration sessions: shared-server clobbering solved by
chat handshake, idle agents that never reported (two idled before seeing assignments;
one lead "stopped waiting for reports and looked myself"), zombie-recovery twins, and
scope leakage — the final commit contained a minimap nobody was briefed to build.

**Proposal:** small, boring primitives the orchestrating harness can enforce:
file-tree-scoped worktree territories (already proven — zero merge conflicts across
five writers), a build-clean gate as the handoff signal between lanes instead of a
message contract, liveness-checked relaunch, and a completion report the lead can
*await*. These are tooling patterns, not framework surface; they belong in the studio
loop this project already dogfoods.

---

## 3. Generated-source proposals (Q2 items — ship as editable files)

### 3.1 Promote this game to the `fps` starter template — the headline idea

**Why:** the platformer template is the charter's own reference workload; a genre's
starter is generated source, not a v1-style preset (no config keys, no runtime
vocabulary — full `.ts` files the model edits or deletes). Everything this repo
learned becomes the next FPS game's floor instead of being re-derived per session.

**Contents (all already written and proven here):**
- `entities/FpsPlayer.ts` — Look via `pointerRelative`, capsule + eye height from a
  `scale.ts` human-height table, stride-driven footsteps, hip/aim FOV damp, hit shake.
- `entities/Rifle.ts` — ammo/reload economy, viewmodel pose constants, barrel/optic
  measurement, ADS convergence clamp, pipeline-prewarmed flash/smoke.
- `entities/Target.ts` + scoring plates; `audio/GameAudio.ts` as an audio-director
  pattern: cues loaded through one counted manifest, bus auto-disposed on scene exit,
  and gameplay counters (`playerShots`, `peakVoices`, `barksPlayed`) exposed under a
  stable entity id so every game gets assertable audio for free — necessary because
  the official `runtime.audio` bridge channel reads zero forever (separate module
  registries), which makes these counters the load-bearing playtest gate.
- One mesh→surface tag table consumed by both impact sounds and impact VFX (see 3.6);
  the scale audit reading entity registrations instead of magic group names.
- `render/gunfx.ts` impact bursts keyed by surface; tracers; muzzle flash.
- A trimmed `Enemy` with patrol + sentry modes (see 3.2).
- The scenario patterns that finally worked: frozen-sentry shooting tests, the
  zone-contrast head/body pair sharing one geometry, aim-via-setup-quaternion.
- An `AGENTS.md` section documenting every convention above — **without that section
  none of it exists** (§1), and capability-discovery failures are measured (PRD-156/157:
  agents re-wrote installed capabilities 446 lines deep because nothing advertised them).

**Gate:** §5b satisfied — the look (palette, poses, tuning constants) is editable
source; nothing hides in a package. §2 satisfied — it is a scaffold starting point
like `platformer`, not a runtime genre system; no preset reproduces a genre, a
template *is one*, in files. LOC cost lands in the scaffolder, not framework source.

### 3.2 Navigation: the FPS is the measured caller OPPORTUNITY-AREAS asked for

**Evidence:** `Enemy.ts` carries a hand-written nav grid (0.7 m cells), segment-clear
sampling, route replanning and strafe logic — precisely the "ad-hoc A* on a grid it
invents" shape Tier-1 area #3 predicts, in the same file as AI phases. Meanwhile
PRD-052 removed the platformer's Recast caller for lack of demand and gated further
growth on "a measured live caller."

**Proposal:** an owner decision between three shapes, taken with this game as the
caller: (a) wire `@threenative/physics/navigation` (Recast, browser-only behind
`?navigation`) and port the soldier's pathing onto it, proving the retained surface
with a real FPS scenario; (b) lift the grid-A* itself as a core mechanism — it is
pathfinding plus line-of-sight, which is mechanism, not behaviour, and this session's
survey never even discussed why nav was being ignored, which is itself the §4
discoverability failure recurring; or (c) keep portable steering and lift only the
grid-from-static-boxes construction shared with 2.2's colliders. What stays out of
every shape: a "CombatAgent3D" behaviour layer bundling patrol/chase/search phases —
those decide how the game behaves, which is the model's job. A blessed FPS enemy
*skeleton in template source* (3.1) gives the same head start without the ceiling.

**Gate:** respects the PRD-052 gate rather than routing around it; no WASM dependency
inherits into native (package-boundary rule §11.5).

### 3.3 Minimap schematic emitted by the map builder

**Evidence:** `Minimap.tsx` hand-codes area rects mirroring `town.ts`'s 854 lines of
geometry, plus callout labels added by hand twice (map change ⇒ minimap drift).

**Proposal:** the map builder returns `{group, colliders, hittable, schematic}`
where `schematic` is plain data (zones, labels, extents) the HUD renders. Geometry
and its map stay one edit apart. Pure game-source pattern for the template; no
framework surface at all.

### 3.4 Pooled billboard-decay FX — resolve the kill-switch count honestly

**Evidence:** the same pool shape is written three times in this repo — `Rifle.#smoke`
(8 slots), the scene's enemy smoke (10 slots, `Play.ts:593-667`), and `ImpactBursts`'
dust/flash layers — roughly 120 lines each. CHARTER §3 cites this exact case as the
reason repetition counting matters.

**Proposal (in order of preference):**

1. Template-level: one shared `PooledBillboards` helper in the fps template's
   `src/render/` (pooling, lifetime, billboarding, per-slot material clone) with
   texture/colour/curve/timing supplied by each effect. Zero framework growth;
   future games copy-edit instead of re-deriving.
2. Framework-level only if a second game repeats the pattern: a `BillboardPool3D`
   beside `TracerPool3D`, gated as PRD-027 requires (mechanism owns pooling/lifetime;
   appearance parameters all game-supplied; hard veto test: can the game change the
   look without editing framework code — yes by construction).
3. Where effects suit compute, adopt `GPUParticles3D` with material/start/process
   from the game, as PRD-027 already bounds.

The muzzle-flash composite (star card + world light + longer-lived smoke, "three
things at once") is the same family and the one half `TracerPool3D`'s promotion did
not cover; it earns a `FlashComposite3D` under the same rules if a second game
writes it.

### 3.5 Weapon attachment recipes — measure once, share the machinery later

**Evidence:** keeping the AK in a Mixamo hand across nine clips took a hand-tuned
per-clip pose recipe (`ENEMY_AK47_RECIPE`, ~90 lines of measured constants) plus
interpolation/detach machinery — after `attachToBone` solved only the static case.
This is the §1 convention "a weapon stays in the hand that holds it."

**Proposal:** ship the recipe *data* pattern in the fps template (constants are
asset-specific and belong to the game). Lift the interpolation/attachment machinery
into core beside `attachToBone` only when a second rigged-weapon game writes it —
that is the letter of §11.1 ("becomes framework code once one game writes it more
than twice"). Pose values themselves never enter a package.

### 3.6 Surface tagging — two teams converged on the same hidden table

**Evidence:** the audio team built `MATERIAL_SURFACES` (mesh-name rules + material
identity + a default) to pick impact sounds; the VFX team then independently synced
its burst styles "to audio's MATERIAL_SURFACES table" — steel sparks, plaster dust,
wood splinters. Two agents solving the same unnamed problem is the strongest demand
signal in the whole corpus. The same mapping now feeds `resolveSurface()` at the
hitscan site too (`Play.ts:429-442`).

**Proposal:** one tag, resolved once — meshes carry `userData.surface` (or the map
builder assigns it at construction), and any consumer (audio, VFX, decals later)
reads it instead of each re-deriving name-regex tables. The *values* are game
content and stay in game source; the only candidate framework part is a resolver
helper if a second game repeats it. Template bullet first (3.1), core never until
the repetition count says so.

---

## 4. The authoring system: does it know what to use, and when?

The sessions answer the user's question with a measured **no — twice**.

### Findings

- **The measured failure.** An agent wrote 206 lines of grid A* while
  `@threenative/physics/navigation` sat installed and importable, and 240 lines of
  bone-socket code while core exported `attachToBone` — 446 lines replacing
  capabilities it never knew existed (PRD-156/157). Root cause: the template's
  `AGENTS.md` carried a hand-written "this table is the complete list" ctx surface,
  while real capability lived elsewhere. The engine's fix (capability manifest +
  census gate + MCP advertisement) moved a test cohort from 0/3 to 2/3 games importing
  nav instead of re-inventing it.
- **It is recurring here, today.** This repo's `CLAUDE.md` makes the same
  completeness claim ("This table is the complete list") for six `ctx` members —
  and omits everything core 0.2.0 actually added that this game needs: `raycast`
  world-rays/`exclude`/`raycastAll`, `prewarm()`, `TracerPool3D`,
  `softCircleDataTexture`, `GroundSnap`, `PathFollow3D`, `attachToBone`,
  `normaliseToMetres`, `skeletonBones`, `AudioBus`, `replay`. The doc cannot tell an
  agent that `src/render/tracers.ts` is now obsolete; §1's migration is invisible to
  the authoring system by construction.
- **Docs contradict code and nothing fails.** `holdFrames`/`waitFrames` are taught in
  `CLAUDE.md` and rejected at runtime; no test reads documentation against the
  validator, so the wrong spelling survived every session that hit it.
- **Knowledge strands in prose.** "How to see the game" lives in a handoff
  markdown file (`bayview-next-steps.md`) instead of in a command; every newcomer
  re-pays the capture-environment tuition until it becomes tooling (§2.10).
- **Discovery differs per surface.** `.mcp.json` was invisible when Claude launched
  from the parent directory (fixed by the postinstall writer), Codex ignores it
  entirely, and the eight-tool asset loop lives only as prose numbering inside a
  32-tool server. The charter says the agent's field of view *is* the template's
  AGENTS.md — so anything absent from it must be treated as absent, full stop (§1).

### Proposals

1. **Generate, don't hand-write, the capability rows.** Template `AGENTS.md` ctx
   sections are generated from the same manifest the census gate checks; a public
   export either appears with a use-when row or is explicitly marked internal.
   Hand-written completeness claims are retired — they are the failure mode itself.
2. **Use-when phrasing on every row.** Names are not enough; agents need trigger
   conditions: "first-person look → input action `{pointerRelative: true}`, never DOM
   listeners"; "hitscan → `ctx.raycast({origin, direction})`, not `new Raycaster`";
   "any transparent FX pool → born visible at opacity 0 + one `prewarm()` call";
   "corpse/pose grounding → `GroundSnap`, not per-vertex walks".
3. **Doc-drift tests in CI.** Schema keys documented vs validator-accepted (would have
   caught `holdFrames`); export list vs documented tables; scaffold script claims vs
   `package.json`. Documentation that cannot fail is decoration.
4. **A duplication linter for migrations.** Flag game files whose exports duplicate a
   core export's role (`class Tracers` vs `TracerPool3D`) so §1-style migrations are
   discoverable by tooling rather than by archaeology in a retro.
5. **One manifest, three surfaces.** `AGENTS.md`, the engine MCP tool descriptions,
   and the studio help generated from a single source so what the agent reads, what it
   can call, and what the tools advertise can never disagree again.
6. **Document the debug surface.** The bridge globals
   (`__THREENATIVE_PLAYTEST_BRIDGE__`, `__THREENATIVE_SCENE__`, host snapshot) exist
   but were discovered by trial — six throwaway probe scripts in one day, each
   re-finding the shapes through TypeErrors. One generated page listing each global
   and its sample shape ends that.

Gate: all of this is mechanism and documentation — no look decisions, no new runtime
surface. It serves charter §1 ("conventions … discoverable, before any game asks")
and §9b ("the scaffold is the documentation"), and it is the precondition for §1's
migration actually happening: an agent that cannot see the lift will keep the copy.

---

## 5. Playtest schema & suite integrity (framework-owned harness)

Each of these burned a full locked GPU run to learn:

| Item | Fix |
| --- | --- |
| Docs teach `holdFrames`/`waitFrames`, which don't advance the clock; only `holdTicks`/`waitTicks` work | Make the documented spelling advance the clock (alias), or fix the docs — pick one, today they contradict |
| No `lte`/`lt` anywhere; `atSteps` takes `equals`/`label` only — countdowns and measured heights unassertable | Add comparators everywhere; ranges at steps |
| Whole-scenario validation happens after the GPU slot is taken | Ship the schema as JSON Schema / `--validate` so slips die in milliseconds at authoring time |
| `notes` invalid; free text forced into `allowTrivial` | Add a documented `notes` root key |
| Managed port hard-coded (was ×10, now ×23 in one `package.json` string) | Port from config/env, one place |
| `test` script is a hand-maintained chain — deleting starter scenarios caused ten hard failures, and two scenarios silently drifted out of the chain | Glob `playtests/*.playtest.json` by default |
| Gates passing by feature deletion: a prior repair froze a death clip so "corpse never moves" trivially satisfied `deathAnkleDelta <= 0.02`; another gate checked blend weights summing to 1 while the outgoing clip snapped in one frame | Motion-aware assertion helpers (clip advanced ≥ N frames, transition max delta), auto-sticky death metrics, and a documented negative-control pattern — a gate should fail when the feature is broken, not when it is removed |
| Assertions pinned to world geometry rot silently: 10 of 15 scenarios surveyed as geometry-sensitive, exact-equality gates ("health equals 73") broke hardest, every map change forced numeric retuning across 13 scenarios | Lint/warn on exact equality and tick-count assertions that depend on world geometry; push toward bands, `changed`, and component asserts at authoring time |

---

## 6. Rejected on purpose (so nobody re-proposes them)

| Idea | Why it stays dead |
| --- | --- |
| Genre presets / config-driven FPS (`render: {fps: true}`) | §2 closed list; v1's 0-of-7 record. Templates-as-files are the sanctioned shape. |
| ECS for the soldiers/effects | §2; entities are plain classes; miniplex remains a user install. |
| AnimationTree / animation state machine package | PRD-039 WONTBUILD; only the two measured verbs in 2.7 qualify. |
| Owning materials/lighting/post/exposure values | §5b permanent negative result; 2.12 stops at *reporting*. |
| Editor, scene format, bespoke CLI verbs | §2; even good ideas here stay out — four commands ever. |
| Netcode/multiplayer | OPPORTUNITY-AREAS Tier 3 (score 25). |
| Tween/event-bus/math helper packages | Scored 5/100; models write these correctly first try. |
| Entity event emitters for weapon hooks (`onMagOut`/`onMuzzleFlash` callbacks) | Tempting after counting five hand-wired hook sites, but this is the scored-5 event-bus family in disguise; plain callbacks are idiomatic Three.js-adjacent style and every model writes them correctly. |

---

## 7. What the sessions say about method (keep doing)

- **Measure, don't reason** — foot slide, corpse float, texture stretch, and the 9.4 fps
  incident were all found by instrumenting; plausible first hypotheses were wrong twice.
- **Strict file territories per agent** — five writers, zero merge conflicts; the one
  boundary crossing became an ask instead of an edit.
- **Declining with evidence** — the assets agent refused eight force-fit downloads and
  caught two defects in already-shipped assets.
- **Stale builds for bisecting** — one pre-regression snapshot killed a blame spiral.
- **Persisting environment fixes to memory/AGENTS.md** — the next session starts past
  the hardest part of this one. The corollary is now measured: undocumented capability
  = rewritten capability (446 duplicate lines).

---

## 8. Suggested order

1. **Migrate onto core 0.2.0** (§1) — pure deletion, validates the lifts, ~a day.
2. **Section 4 authoring-system fixes** (generated manifest + use-when rows + drift
   tests) — cheap, and it is what makes step 1 discoverable at all.
3. **2.1 spawn/aim scenario vocabulary + 2.10 runner env bake-in** — removes the two
   largest proven time sinks (65-command ceremony; false-FAIL class).
4. **Section 5 schema items** — each is small; together they end pay-per-lesson authoring.
5. **2.3 asset pipeline upstreaming** — the decoder-free optimize plugin is proven
   and takes `public/` to 16 MB; scaffold default needs no engine change.
6. **3.1 fps template** — do this last so the template bakes in the fixes, not the
   friction.
7. Owner decisions to schedule: 2.7 scope vs PRD-039, 3.2 nav shape vs PRD-052,
   3.4(2) vs PRD-027.
