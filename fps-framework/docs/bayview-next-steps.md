# Bayview — what is left to improve

Handoff for the next agent. Written 2026-08-22 after a five-agent pass that rebuilt the
map's surfaces, facades, palms and props and fixed three enemy animation bugs.

Read `CLAUDE.md` first — it is authoritative and several items below are only
comprehensible against its rules. Then `docs/bayview-design.md` (layout) and
`docs/asset-manifest.md` (every shipped asset, its world tile size, and the colour space
each map must load in — the tiling column is load-bearing).

---

## Before you touch anything: how to see the game

This is the part that costs newcomers the most time, so it is first.

- **Headless Chromium renders a black canvas here.** Captures must be headed.
- **Headed Chromium hangs forever on launch under native Wayland on this host.** The
  process spawns but never answers the CDP pipe; Playwright dies after 120–180 s and each
  failed launch strands ~5 chrome processes. Forcing XWayland takes launch from a timeout
  to ~175 ms.
- Both problems are already solved by `tools/capture-lock.sh`, which unsets
  `WAYLAND_DISPLAY`, sets `XDG_SESSION_TYPE=x11`, reaps stranded profiles, and serialises
  so two captures never overlap:

  ```sh
  tools/capture-lock.sh node verify-tmp.mjs /tmp/shots
  tools/capture-lock.sh npx @threenative/playtest --scenario playtests/x.playtest.json \
    --url http://127.0.0.1:4175 --browser-recipe webgpu --headed
  ```

  **The lock only earns its keep when several agents capture at once.** Working alone,
  skip it and use `env -u WAYLAND_DISPLAY XDG_SESSION_TYPE=x11 …` directly — the lock's
  900 s wait will otherwise time out and look exactly like a test failure. That happened
  during this session and produced two false FAILs.
- `verify-tmp.mjs` at the repo root tours 18 vantage points in one browser launch and
  survives round restarts. **Its aim convergence was broken and is now fixed**; the bug is
  worth knowing because it will bite any similar harness: under pointer lock *every* mouse
  move produces look input, including a move back to screen centre. Re-centring between
  corrections feeds the game an equal and opposite delta, which cancels the correction and,
  with viewport clamping, walks the pitch into its clamp. Every capture then stares at the
  sky. Track the cursor position instead and only ever move to a new in-viewport point.
- Live servers during the last session: dev on `:4175` (HMR — reloads the page under a
  long capture, which resets the player to spawn), and a static production build on
  `:4180` via `vite preview --outDir dist-verify`. **Prefer the static build for tours.**

---

## Priority 0 — the game is silent

**Nothing plays any sound at all.** There is no audio code anywhere in `src/` — confirmed
by grep: no `ctx.assets.audio`, no playback, nothing. This is the single largest gap between
the current build and something that feels finished, and it is bigger than any remaining
visual item.

Seven cues are already shipped and credited, and are simply not wired up:

```
public/audio/hit-impact.ogg      public/audio/bullet-whizz.ogg
public/audio/ui-click.ogg        public/audio/round-complete.ogg
public/audio/round-failed.ogg    public/audio/clock-tick.ogg
public/pickup.ogg                (starter scaffold, unreferenced)
```

**What is missing and matters most**, roughly in order of how much a player would notice:

1. **The rifle shot.** There is no gunfire. `Rifle.fire()` in `src/entities/Rifle.ts` is
   where it hooks in; the enemy's shot hooks into `onMuzzleFlash` in `Play.ts`.
2. **Footsteps on stone**, for the player and for soldiers — the main source of positional
   information in a competitive FPS, and its absence changes how the map plays, not just how
   it sounds.
3. **Impact sounds by surface** — the raycast in `Play.ts` already knows what it hit
   (plaster, wood crate, steel door, soldier), so surface-specific impacts are nearly free.
4. **Harbour ambience** — gulls, water, distant town. The map is a coastal port and reads as
   a vacuum.
5. Reload, magazine drop, weapon raise/lower; the round clock's last-ten-seconds tick
   (`clock-tick.ogg` is already shipped for exactly this).

### The ElevenLabs key

The user has an ElevenLabs account and wants it used to generate the missing cues.
**I searched `~/projects/threenative` and found no API key** — only Brave browser artifacts
showing the site has been visited. The key is not in the workspace.

**Ask the user for it**, and place it as `ELEVENLABS_API_KEY` in a **gitignored** `.env` at
the repo root. Do not hardcode it in source, do not commit it, and do not read it out of
browser profile data. Note `.gitignore` currently has no `.env` rule — add one before
creating the file.

Generated audio is fine to ship, but **add it to `CREDITS.md`** with its origin, and check
ElevenLabs' current terms for what a generated SFX may be used for commercially.

### Portability constraint

`CLAUDE.md` is explicit: the native build has no DOM and no `window`. Audio must go through
`ctx.assets.audio(...)` and the framework's audio bus, **never** through `new Audio()` or
`window.AudioContext`. The playtest bridge exposes an audio channel (`runtime.audio`,
reporting `queued` and `voices`), so a scenario can assert that firing actually produced a
voice — that is the gate to add alongside the feature.

---

## Priority 1 — visual gaps against the reference

The reference set is `references/`: `0400ed3d…` is the design sheet, `2e6abeab…` is nine
in-game callout frames, `4aa4e46f…` is the hero frame. Compare against those, not against
your own sense of improvement.

### 1.1 The painted dado reads as flat plastic

`dado` (`0x86a0ae`) is now the only surface in the lane with no texture on it, because the
walls, ground, trim and joinery all moved to world-projected textures and it did not. In
the A-site frame it reads as a plastic skirt stuck to the bottom of the wall. Route it
through the same world-projected path the walls use in `townMaterials.ts`. Owner: whoever
takes `facade.ts` / `townMaterials.ts`.

### 1.2 Palm fronds read as flat cartoon cards

The palm *geometry* is good — trunk taper, bark stepping, radial arching fronds, dead-frond
skirt. The *surface* is not: one uniform mid-green with almost no value separation between
sunlit and shaded fronds, so the crown flattens into a single silhouette. Real palm crowns
have strong internal contrast (bleached tips, dark inner fronds) and that contrast is most
of what makes them read as foliage.

`palm.ts`'s header says colour variation is baked into a vertex-colour attribute. Either it
is not reaching the material (needs `vertexColors: true`) or its range is too narrow.
Check which. Note the `frond` material lives in `townMaterials.ts`.

### 1.3 Building massing is still fairly uniform

Facades are now excellent at eye level, but the skyline is flatter than the reference's,
which has more varied setbacks, height steps and roof clutter breaking the silhouette. Low
priority next to 1.1 and 1.2, but it is what stops a wide shot reading as the reference.

### 1.4 Ground is uniformly warm

The flagstone reads believable up close but the whole deck sits at one warm beige. The
reference lanes are greyer and vary between plazas and streets. `bayview-paving` (a second,
credited CC0 set, fan-pattern setts, 2:1 aspect — **must keep a 2:1 repeat ratio or the
cobbles render as ellipses**) is shipped and unused; it exists precisely to give streets a
different surface from plaza flags.

---

## Priority 2 — test-suite integrity

The suite is 21 scenarios, all wired into `pnpm test`. The two structural weaknesses below
are **fixed as of 2026-08-22**; the pattern still matters for any new shooting scenario.

### 2.1 Scenarios that shoot a patrolling soldier — FIXED with a frozen sentry

The old failure: `enemy-death-settles`/`death-no-snap` placed a *patrolling* soldier whose
lateral drift gave each shot only a ~7-tick hit window, papered over with 1-tick waits and
extra press cycles.

The fix is game-owned and needs no schema change: `game.ts` registers an extra
non-rendered placeholder entity **"enemy-frozen"** (parked off-map at y=−1000 so "never
placed" is distinguishable from "placed at the origin"). A scenario that includes it in
`setup.entities` turns soldier 0 into a **sentry** at that position: `EnemyOptions.frozen`
disconnects hearing, vision *and* the hurt-path engage reflex (`hurt()` used to force
`phase = "engage"` on any surviving hit), so rounds landing near him never walk him out of
his spawn. `Play.enter()` reads the placeholder like the existing player/enemy ones.

Both death scenarios now use the sentry; every timing hack is gone — one Space press
kills (level ray crosses the head zone at eye height 1.66 > headZoneMinY ≈ 1.46), then a
single settle wait. Each passes repeatedly. Any new shooting scenario should use
`enemy-frozen`; do not shoot patrollers.

### 2.2 Zone-contrast control — FIXED as a two-scenario pair

`zone-contrast-body` and `zone-contrast-head` share one geometry: frozen sentry at the
origin, player 4 m south on the same axis, fired with Space (no pointer input anywhere).
They differ **only** in the player placeholder's spawn pitch, carried in the setup
entity's rotation quaternion and applied by `Play.enter()` onto `player.look`
(identity = level):

- level ray crosses the body at world Y ≈ 1.66 ≥ headZoneMinY ≈ 1.46 → head zone:
  `lastHitMultiplier equals 4`, `health equals 0`, dead;
- pitched-down quaternion [−0.05722, 0, 0, 0.99836] (−0.1145 rad ≈ −6.6°) crosses at
  ≈ 1.20, mid-way between legZoneMaxY ≈ 0.94 and headZoneMinY ≈ 1.46 → body zone:
  `lastHitMultiplier equals 1`, `health exactly 26`, `deathObserved equals false`.

Zone bands were measured off the live rig via the bridge components, not guessed.
Both assert the sentry never moves (`blips.0.x/z equals 0 throughoutSteps`). No timing
sensitivity: the aim is fixed at spawn, the soldier cannot move, one round per run.

**Do not rebuild it as another timing-sensitive scenario.** Its honest prerequisite is 2.1.

### 2.3 Playtest schema facts that cost real time

- `atSteps` accepts **`equals` and `label` only** — no `gte`/`lte`. That is why
  `lastHitMultiplier` and `health` can use it (exact integers) and a measured height cannot.
- `notes` is **not** a valid scenario root key. Valid roots: `acceptanceId, artifacts,
  assert, inputDelivery, name, parity, schemaVersion, setup, steps, subject, target,
  viewport, warmupFrames`. `allowTrivial` is the only free-text field that survives
  validation, so rationale has to live there.
- The runner validates the whole scenario **before** running anything, so a schema slip
  costs a full run and tells you nothing about your assertions.
- `warmupFrames` does **not** advance gameplay. Only `waitTicks` do. Getting this wrong
  makes drift arithmetic off by ~6×.
- `allowTrivial` excuses only the *triviality* check, never the *value* check. A waived
  assertion still fails on a bad value.

### 2.4 Beware assertions anchored on a sticky maximum

`locomotionRatePeak` was un-waived and passing, which looked sound. It is a sticky max on a
soldier who patrols from spawn, so whether the baseline snapshot lands before or after his
first step is a **race against warmup**. It passed three runs by luck. Re-anchored on
`blips.0.x changed` — a blip that moved proves a soldier travelled and cannot race warmup.
Two neighbouring scenarios already used that idiom.

---

## Priority 3 — known correctness risks, not yet bugs

### 3.1 The weapons carry the same latent hazard the soldier had

`weapon-ak47.glb` (2 skinned meshes) and `player-viewmodel.glb` (5) are rigged and
`cloneSkeleton`d. They are fine **only** because every measurement taken of them is
non-precise: `new Box3().setFromObject(weapon)` with `precise` defaulting to false reads
geometry bounding boxes and never touches `bindMatrixInverse`.

Add one *precise* (vertex-walking) measurement of either **before the first rendered frame**
and it will collapse to a point, exactly as the soldier's skin envelope did. See the full
mechanism in 3.2. Deliberately not hardened, because grip alignment rides on
`rightHandToGrip` / `leftHandToRifle` and changing working code inside a bug fix is how
someone loses an afternoon.

### 3.2 The mechanism behind 3.1, written down

`SkeletonUtils.clone()` ends with `mesh.bind(mesh.skeleton, mesh.bindMatrix)`, and `bind()`
sets `bindMatrixInverse = bindMatrix⁻¹`. These assets have an identity `bindMatrix`, so a
clone starts with an identity `bindMatrixInverse`. In three's default `attached` bind mode
that field must equal `matrixWorld.invert()`, and three refreshes it in exactly one place:
`SkinnedMesh.updateMatrixWorld`. `Object3D.updateWorldMatrix` recurses through
`updateWorldMatrix`, which `SkinnedMesh` does **not** override — so
`updateWorldMatrix(true, true)` never repairs it. `applyBoneTransform` then returns world
coordinates, contract-following callers multiply by `matrixWorld` and double-transform, and
these Sketchfab exports carry a ×0.000346 root scale that folds the body onto the origin.

Measured one call apart on the same rig: after `updateWorldMatrix(true, true)` the body box
is `(0,0,0)`; after `updateMatrixWorld(true)` it is `(1.113, 1.786, 0.384)`.

It hides because the renderer calls `scene.updateMatrixWorld()` every frame, so the field is
correct from frame 1 onward. **Only constructor-time measurements ever see it.**
`Box3.expandByObject(precise)` and `SkinnedMesh.computeBoundingBox()` collapse identically.

`Enemy.ts` routes all ten refresh sites through one `#syncWorldMatrices()` helper for this
reason. Gated by `maxEnvelopeRadius lte 0.8` in `enemy-stride-matches-speed`.

### 3.3 A whole-body AABB is not a hitbox

Repairing the vertex walk made the constructor start seeing the *real* bind-pose box — 1.113 m
wide, because the bind pose is a T. A posed measurement is no better: over a walk cycle the
box is 1.13 m deep because the stride reaches fore and aft. Hitbox width and depth now come
from `scale.ts`. Do not reintroduce a bounds-derived hitbox.

### 3.4 Node materials require WebGPU — VERIFIED FALSE (2026-08-22)

Confirmed empirically by forcing the webgl2 path (shadowing `navigator.gpu` in a headed
Chromium): `@threenative/core` falls back to `WebGLRenderer` silently when WebGPU init
fails, and **this map boots and renders correctly on it** — three 0.185's node system
draws `MeshStandardNodeMaterial` + TSL fine over WebGL2. The feared `setOutputNode`
refusal no longer applies either: nothing in `src/` calls it any more.
Full write-up: "Renderer requirement" in `docs/bayview-design.md`.

---

## Priority 4 — content the references show that the map still lacks

An asset agent searched the CC0 catalogues exhaustively. **These do not exist as compatible
CC0 assets and must be written in code** (`src/render/vehicles.ts` is the precedent — the
van and boat there were built for exactly this reason):

| Missing | Why no asset | Evidence |
|---|---|---|
| Satellite dishes, AC condensers | Not in either catalogue | ambientCG's entire 3D catalogue is 34 items and they are all fruit, bread, pastries, a stick and a tree stump |
| Bollards, mooring cleats | Same | |
| Rifle **run** cycle | No compatible skeleton | Fastest locomotion is `RifleWalk` at 1.31 m/s real stride; a 3.6 m/s chase plays it at 2.75×, which reads as a comically fast march |

**On the run cycle specifically: `CHASE_SPEED` was deliberately left alone.** Lowering it
would change how long a soldier takes to cross the map, and `enemy-reaches-walkway`,
`walkway-reachable` and `enemy-foot-contact` are all timed in ticks against that travel
time. Trading passing behavioural gates for a playback-rate cosmetic is a bad deal. If you
want to fix it properly, source or author a run clip; do not retune the speed.

**Sketchfab is the one untried avenue** for the boat/van class of asset. It is
`agentReady: false` — downloads need the user's `SKETCHFAB_API_TOKEN`, and its models are
per-model CC-BY requiring attribution. Ask the user before going down that road.

---

## Priority 5 — housekeeping

- **`references/` has no establishable provenance.** Eight files, opaque UUID names, no
  author metadata, no tool result reporting a licence. `CREDITS.md` says so plainly rather
  than inventing an attribution, and warns it must be resolved before redistribution. This
  needs a human answer.
- **Poly Haven requires a visible credit** wherever its API was used, and "visible" means a
  player must be able to see it. There is one on the end screen in `Hud.tsx`. Do not remove
  it. ambientCG (CC0) requires nothing; Kenney's is optional; Sonniss requires none but
  forbids redistributing its bundle as an asset library.
- **Build weight.** `public/` is ~33 MB. `weapon-ak47.glb` (11.75 MB),
  `player-viewmodel.glb` (7.50 MB) and `enemy-terrorist.glb` (3.67 MB) are **79% of
  everything that loads**. All three are third-party kit GLBs and gitignored. If the build
  must shrink, Draco/meshopt compression on the AK is the only place with real headroom.
- **`*-tmp.mjs` at the repo root is gitignored** and is how you look at the game. Delete
  your own when done; do not commit them.
- **Nothing is committed.** The whole session's work is staged/unstaged in the working
  tree. Someone needs to decide on commit granularity.
- **`.gitignore` has no `.env` rule.** Add one before creating any file that holds a key.
- Two scenarios (`debug-clear`, `debug-endurance`) existed on disk but were never in
  `pnpm test`. Now wired in. **Worth re-checking after adding any scenario** — the test
  script is a hand-maintained chain of 20 invocations and drifts silently.

---

## What was fixed this session, so you do not re-fix it

1. **Texture scale.** A box's UVs run 0–1 *per face*, so `repeat(n,n)` cannot express
   "one tile per N metres". The old scheme picked `n` from each building's longest side,
   giving one building two different plaster scales on its long wall and its return, and —
   because wall height never entered the calculation — **stretching the stucco to 4.7:1 on
   all thirty buildings, both plazas and the quay**. Replaced with world-space triplanar
   sampling at fixed metres-per-tile.
2. **Foot slide.** All nine clips are authored in place (verified — no hips translation
   track in any of them). The walk clip was played at rate 1 while the body moved at
   2.4 m/s, so feet covered 54% of the ground. `timeScale` is now driven by stride measured
   off the rig, from the distance the body actually moved that frame.
3. **Floating corpse.** Grounding pinned a bone-sphere estimate to the deck every frame
   while dead; once the death clip rotated the limbs the spheres read up to 1.20 m below the
   real skin and that error became height one-for-one, ratcheting against the leg-settle IK.
4. **Degenerate skin envelope** (3.2). Not latent — a soldier taking a hit was riding 26 cm
   off the deck.
5. **Palm placement.** Two palms stood *inside* buildings, one mid-corridor, one 0.8 m off a
   patrol line and 3 m from the first plate the player shoots, and one filled the T-spawn
   opening view. All thirteen re-placed onto plaza corners and building returns.
6. **Two undressed player-facing walls**, including the one beside the player on spawn.
7. **HUD** rosters and score wired to live state instead of hardcoded decoration.
8. **`.gitignore`** excluded every map texture, so a clone built a game with no textures.
9. **`sky.jpg` was gitignored while `Play.ts` loaded it** — same failure, caught separately.
10. **Corrugated steel shipped without roughness/metalness** — would have rendered as a flat
    blue rectangle, i.e. exactly the bug the facade work existed to fix.
11. **Boot showed a black canvas** for several seconds. There is now a Bayview loading
    screen with a **real** progress bar: `Play.load()` counts each asset as it resolves into
    `assetsLoaded` / `assetsTotal`, and `ready` flips when the scene has finished building
    rather than when the last byte arrived. The bar caps at 92% until then, so it never sits
    full while the first frame is still being drawn. Measured 23 assets on this build.

    **Still worth improving:** the load itself is ~23 MB and three GLBs are 79% of it (see
    Priority 5). The honest fix is a smaller payload, not a nicer spinner — Draco/meshopt on
    `weapon-ak47.glb` is the biggest single win available.

---

## A note on method

Three of the four hardest bugs this session were found by **measuring rather than
reasoning**, and in two cases the first plausible hypothesis was wrong:

- The corpse float was assumed to be root motion or `clampWhenFinished`. It was neither.
- A playtest failure was assumed to be geometry blocking a shot. Rerunning showed the round
  landed fine and the *assertion* was calibrated against a floating body.

Both were settled by running the thing. Where a gate and a fix disagree, find out which one
is wrong before changing either — twice this session the gate was the wrong one, and once
it had a written justification that was factually false.
