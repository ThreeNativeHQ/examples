# friction.md — warden-vault (physics-puzzle, framework arm)

**First game code written at tool call:** (see below)
**Total tool calls:** (updated at the end)

## Honest verdict

(written at the end)

## What I wrote by hand that the framework already shipped

(updated as discovered)

---

### F1: The engine MCP server is registered in `.mcp.json` but its tools are not callable from my agent session
**Surface:** `.mcp.json` written by `create-threenative` / `threenative-engine-mcp`
**What I was trying to do:** run `engine_search_capabilities` before writing any entity, as `AGENTS.md`
step 1 requires ("Critical planning gate").
**What happened:** `engine_search_capabilities` and `engine_capability_detail` were not present in my
tool list at all. The scaffolded `.mcp.json` is correct and the server binary
(`node_modules/@threenative/core/mcp/engine.mjs`) works, but nothing in the project tells you what to
do when the host has not loaded it. The instructions in AGENTS.md are written as if the tools are
always there.
**How I found out:** nothing told me. I only noticed because the tool names were absent when I went
to call them; there is no error, no fallback CLI, and no `npx threenative capabilities <query>`.
**Cost:** ~3 tool calls to write a JSON-RPC stdio client by hand.
**What I did instead:** wrote a ~35-line stdio MCP client and drove `engine.mjs` directly. It works
and returned good results (`Area3D`, `interactionGroups`, `InstancedBatch`, `createReplayDriver`).
**What would have prevented it:** ship a CLI face on the same index — `npx threenative capabilities
search "<situation>"` / `detail <symbol>` — so the mandatory planning gate does not depend on the
host's MCP wiring. `capabilities.json` is already sitting in the project root; nothing reads it
without MCP.
**Silent:** yes

### F2: The capability index does not return `Area3D` for the most natural goal-trigger phrasing
**Surface:** `engine_search_capabilities`, scope `mechanic`
**What I was trying to do:** find the supported way to detect the character reaching the destination
pad — the brief forbids a distance check, so I needed the contact-based capability.
**What happened:** `"detect when the player steps onto a glowing floor pad destination"` returned
`GroundSnap`, `NavigationAgent3D`, `buildStaticColliders`, `ao`, `publishUiState` — five hits, none
of them the answer. Rephrasing to `"a trigger volume fires when a body overlaps it"` returned
`Area3D` immediately (plus `AudioBus`).
**How I found out:** I already knew `Area3D` existed from reading the scaffolded `src/entities/Goal.ts`.
An agent without that prior would have taken `buildStaticColliders` or written a distance check —
which the brief explicitly calls an invalid win condition.
**Cost:** 1 extra search; would have been much worse without the scaffold to read.
**What I did instead:** used `Area3D` with `CollisionShape3D.box`.
**What would have prevented it:** add "player reaches a goal / steps on a pad / enters a destination"
to `Area3D`'s `situations` list. Its two registered situations are both phrased around *enemies*.
**Silent:** yes — a wrong-but-plausible answer is worse than no answer.

### F3: `vite build` produces a game with no assets, and both shipped tools use it
**Surface:** the scaffolded `package.json` `test` script, `tools/look.mjs`, `vite.config.ts`
**What I was trying to do:** take the first screenshot of the game with the tool the project ships
for exactly that (`node tools/look.mjs --webgpu`).
**What happened:** a cream page reading
`TN_ASSETS_UNRESOLVED: 'native-proof.png' could not be loaded from 2 candidate url(s):
native-proof.png (The source image could not be decoded.); assets/native-proof.png (...)`.
The asset pipeline only runs inside `threenative build` and inside the dev server's watch plugin.
`tools/look.mjs` calls vite's `build()` API directly, so `public/` was still empty and every
packaged asset 404'd. The shipped `"test"` script is `vite build && threenative-playtest ...`, so it
has the same hole: every scenario in `playtests/` would have run against an asset-less build.
**How I found out:** the error screen itself, which is genuinely good — it names the file, both URLs
it tried, and why each failed. What it does not say is *which command* would have produced them.
**Cost:** ~4 tool calls to work out that `pnpm build` had to run first.
**What I did instead:** run `pnpm build` (i.e. `threenative build`) once before `tools/look.mjs`,
which populates `public/` and makes every later vite build correct.
**What would have prevented it:** `tools/look.mjs` and the `test` script should call
`threenative build`, not `vite build` — or vite's build hook should run the asset pass the way the
serve hook does. The plugin's own comment ("builds compile through `threenative build`") documents
the split; the two commands in the same `package.json` do not honour it.

### F4: `CollisionShape3D.box` extents are undocumented, and I had to measure them
**Surface:** `@threenative/physics` — `CollisionShape3D.box(width, height, depth)`
**What I was trying to do:** size the floor slab, the four walls and the goal's `Area3D` volume.
**What happened:** nothing failed loudly, but I could not tell from the types or the capability
detail whether the three numbers are full extents or half extents. `CollisionShape3D.capsule` has a
16-line doc comment that spells out exactly where its origin sits and what floats if you get it
wrong; `box` and `sphere` have no comment at all. Rapier's own `cuboid` takes half-extents, so the
wrong guess is the *likely* one, and it is invisible: the level just behaves as if everything is
twice its size.
**How I found out:** I dropped a crate on the floor and logged its resting height
(`WV_PROBE settledY=0.4581` against a 0.92 m crate), which proved full extents. That is a build,
a capture and a console grep to answer a question a docstring could have answered.
**Cost:** ~3 tool calls plus two builds.
**What I did instead:** measured it, then deleted the probe.
**What would have prevented it:** one sentence on `box`: "full extents, centred on the body origin"
— the same courtesy `capsule` already gets. The capability detail's example
(`CollisionShape3D.box(1, 1, 1)` for "a crate") reads as full extents but never says so.
**Silent:** yes

### F5: `Area3D` reports the floor and the walls, and a goal volume that touches y=0 is won at boot
**Surface:** `@threenative/physics` — `Area3D` + `bodyEntered`
**What I was trying to do:** end the run when the warden, or a crate it shoved, overlaps the seal
plate in the floor. The brief forbids a distance check, so this had to be a real overlap.
**What happened:** the game reported `status: "won"` on the very first frame, with the warden still
standing at its spawn eight metres away and the HUD reading `shoved 0`. `Area3D.on("bodyEntered")`
fires for **every** body that overlaps, including the fixed floor slab whose top face is exactly the
plane the plate sits on, and including the wall bodies. There is no `collisionMask` value that
expresses "dynamic bodies only", and the handler receives the body node with no `type`, `name` or
`entity` to filter on unless the game happened to set one.
**How I found out:** a screenshot with "SEAL BROKEN" printed across an untouched room. Nothing in
the API surface hinted at it.
**Cost:** ~6 tool calls across three separate rediscoveries — it also bit me twice more when
authored crates clipped the volume by a centimetre.
**What I did instead:** lifted the area clear of the floor plane, kept a `Set` of the live crate
bodies, and rejected any contact that is neither the warden's body nor a member of that set. Then
wrote a fail-closed authoring check that throws, naming the crate, if any crate is authored inside
the seal — because I could not otherwise tell an authoring mistake from a physics one.
**What would have prevented it:** `Area3D` should carry the warning `capsule` gets, and the
handler should hand back something a game can filter on without keeping its own registry — the
body's `type` would be enough to drop every fixed collider in one line.
**Silent:** yes — the failure looks exactly like a game that works, and its own HUD lies about it.

### F6: `tools/look.mjs` has a fixed 2.5 s settle and no hook for "the loading screen has gone"
**Surface:** `tools/look.mjs` (`SETTLE_MS = 2500`), `src/render/loading.ts`
**What I was trying to do:** take a comparable screenshot on every iteration of the visual loop.
**What happened:** one capture in about eight came back as a black frame with the loading bar at
94 % and a correct HUD. The scene had not failed; the shipped loading screen was still covering it.
**How I found out:** the screenshot — which, if I had been less suspicious, reads exactly like the
"headless Chromium serves a black WebGPU frame" trap the project's own docs warn about.
**Cost:** 2 tool calls (one wasted capture, one re-run).
**What I did instead:** re-ran it.
**What would have prevented it:** `look.mjs` already knows about `window.__LOOK_VANTAGES__`; it
should also wait on the runtime's own readiness (`ctx.startup.whenReady()` is already exposed) or on
the loading layer being torn down, instead of a wall-clock constant.

### F7: A scenario cannot witness anything the game does before the runner's first sample
**Surface:** `@threenative/playtest` runner — `TN_PLAYTEST_ASSERTION_TRIVIAL`
**What I was trying to do:** prove the brief's requirement that thirty-plus dynamic bodies "stack,
topple, collide, and come to rest after the initial drop".
**What happened:** every assertion about the drop failed as *trivial*: `settledCrates` already read
44 at the first sample, `settled` was already `true`. The runner's first observation lands after
`startup.whenReady()` — 3.0 s in on this machine — and the pile built in `Scene.enter()` had fallen,
collided and gone to sleep 2.2 s before that. The diagnostic's own advice ("assert `changed: true`")
does not help, because the change happened in a window the scenario cannot reach.
**How I found out:** the diagnostic, which is excellent — it names the path and prints the value it
was already satisfied by. It just cannot say *why* the value was already settled.
**Cost:** ~4 tool calls plus two full scenario runs.
**What I did instead:** moved the drop behind `ctx.startup.whenReady()` so the vault opens on the
first observed frame. This is a better opening for a player too, so it is not a pure tax — but I
changed the game to fit the instrument, which is worth naming.
**What would have prevented it:** the triviality diagnostic could say "the first sample was taken at
tick N, T ms after the runtime reported ready" — that one sentence turns "your assertion is bad"
into "your event happened before I was looking".
**Silent:** no — the diagnostic is loud and specific. The *cause* is the silent part.

### F8: `settled` matches every physics body in the world, including the ones that never sleep
**Surface:** `@threenative/playtest` — the `settled` assertion
**What I was trying to do:** assert that the dropped crates came to rest.
**What happened:** `TN_PLAYTEST_PHYSICS_NOT_SETTLED: Expected at least 30 physics bodies matching
'physics.body.' to be asleep; observed 44 of 49.` All 44 crates *were* asleep. The other five are
the floor slab and the four walls — fixed bodies, which never report as sleeping — and there is no
way to exclude them by kind. `minBodies: 30` reads like a floor on the cohort; it is not the
predicate that decides the pass.
**How I found out:** the message, which prints both numbers and so at least made the arithmetic
visible. The fix was not visible: the `entity` field on the assertion is a *prefix match on the
body's own `entity` option*, and `RigidBody3D`'s `entity` is documented as one word with no type.
**Cost:** ~3 tool calls and one run.
**What I did instead:** named every crate `crate.<n>` and asserted `entity: "crate."`.
**What would have prevented it:** exclude fixed bodies from the cohort by default — a fixed body is
never going to fall asleep and its presence can only ever make the assertion wrong — or say in the
assertion reference that `entity` is a prefix over `RigidBody3D({ entity })` and that unnamed
bodies land in one undifferentiated `physics.body.` pool.

### F9: Physics contacts are invisible to a `contacts` assertion unless the bodies are named
**Surface:** `@threenative/physics` `entity` option, `@threenative/playtest` `contacts` assertion
**What I was trying to do:** assert `{"kind": "trigger", "minCount": 1}` for the warden entering
the seal — the brief requires the destination to be reached through simulated contact, so the
contact log is exactly the evidence that matters.
**What happened:** `TN_PLAYTEST_CONTACT_NOT_OBSERVED: Expected contact/trigger for 'player' was not
observed 1 time(s)` — on a run where the game's own state showed the trigger had fired, the run was
`won`, and `sealContacts` was 1. The contact log keys on the **physics** `entity` option, which is a
different namespace from `ctx.entities.add("player", ...)`. Registering the entity in the scene
registry is not enough; the `CharacterBody3D` and the `Area3D` each need their own `entity` string.
**How I found out:** by elimination — every other assertion in the same scenario passed, including
the one reading the state the trigger handler wrote.
**Cost:** ~3 tool calls, one full run.
**What I did instead:** `new CharacterBody3D({ entity: "player" })` and `new Area3D({ entity:
"seal" })`, then asserted `{"entity": "player", "with": "seal", "kind": "trigger"}`.
**What would have prevented it:** the diagnostic knows the log is empty of *any* named contact; it
could say so — "no physics body in this run declared an `entity`, so no contact can be attributed".
Or the physics nodes could default `entity` to the scene-registry name they were added under.
**Silent:** yes — a game that works reports a missing contact, and the two `player`s look like one.

### F10: A dynamic `RigidBody3D` cannot be repositioned, so "run it again" is not expressible
**Surface:** `@threenative/physics` — `RigidBody3D`
**What I was trying to do:** the brief's determinism requirement — run the same input sequence twice
under a fixed step and report whether the two runs ended in the same state.
**What happened:** there is no way to put a dynamic body back. `CharacterBody3D` has `teleport`;
`RigidBody3D` has `applyImpulse`, `applyForce`, `applyForceAtPoint` and a `linearVelocity` setter,
and its doc comment says those four exist "because there is otherwise no portable way to move a
dynamic body at all" — which is true and is exactly the problem: an impulse cannot *place*
anything. There is no position setter, no `teleport`, and no angular-velocity setter.
`syncToPhysics()` is undocumented and looked like the one candidate; it is not. Measured: after
writing the object's transform and calling it, then giving the solver ninety settling steps, the
pile was still **0.8011 m** from the pose it had been handed. It does not write a dynamic body.

So the only way to reset a physics world from user space is to destroy every body and build new
ones — and that changes the answer. Rebuilding 44 crates and running the identical script twice
produced two results that disagreed by **0.2817955017089844 m across 220 of 308 recorded
components**, to the same sixteen digits on every run. It alternates: moving a throwaway rebuild
from before pass one to before pass two made the two digests swap places exactly. Consecutive
rebuilds never get the same backend handles, and the solver's answer depends on them.

I ruled out the obvious alternatives on the way: `dt` is genuinely fixed (one distinct value,
`0.016666666666666666`, over every replay tick), and the character's leftover `velocity.y` survives
a `teleport` (a real bug in my code, fixed).
**How I found out:** by building a drift metric — the largest single component the two passes
disagree on — because a boolean `replayMatch: false` told me nothing at all. Everything above came
from that number plus a differing-component count.
**Cost:** the largest single item in this build. Roughly 25 tool calls and nine full scenario runs.
**What I did instead:** the check now runs on a three-body rig in a vault emptied for the duration,
with one throwaway build inserted so both passes allocate an *even* number of build-and-discard
cycles apart. That is bit-identical — `differing=0` over 24 components. The game publishes
`replayBodies: 3` beside `replayMatch` so the scope of the claim is in the report, not in a reader's
assumption. I could not make the claim for all 44.
**What would have prevented it:** `RigidBody3D.teleport(position, rotation)` with velocities zeroed,
matching the one `CharacterBody3D` already has. Failing that, `syncToPhysics()` should either write
a dynamic body's transform or throw for one, and its doc comment should say which.
**Silent:** yes, twice over — `syncToPhysics()` silently does nothing, and a rebuilt world silently
simulates differently.

### F11: A character's push strength is not tunable, so crate mass is the only lever
**Surface:** `@threenative/physics` — `CharacterBody3D({ pushesDynamicBodies: true })`
**What I was trying to do:** have the warden shove crates across the room at walking speed, which is
the whole verb of a physics puzzle.
**What happened:** `pushesDynamicBodies` is a boolean and nothing else. Rapier bounds a kinematic
character's push by the character's own mass, which no option here exposes. With crates at the
starter's `mass: 8` the warden crossed 2.5 m in 3.3 s of held input instead of 11; at 6 kg, still
2.5 m; at 2.5 kg, 6 m; at 1.5 kg it crosses cleanly. Nothing reported that the character was being
slowed — the state just showed a small odometer.
**How I found out:** a `movement.minDistance` assertion failing with the number it did reach, then a
per-60-tick position trace I wrote myself.
**Cost:** ~6 tool calls and three runs, entangled with F12 below.
**What I did instead:** dropped crate mass to 1.5 kg and raised the warden's speed. The crates are
now lighter than a crate should be, which is a look-and-feel cost paid for a physics limitation.
**What would have prevented it:** a `pushStrength` or `characterMass` option beside
`pushesDynamicBodies`, or a note in its doc comment that push authority scales with nothing the
game can set.

### F12: `moveAndSlide` is deferred, and every naive "did I actually move" measurement reads zero
**Surface:** `@threenative/physics` — `CharacterBody3D.moveAndSlide`
**What I was trying to do:** count the ticks where the warden asked to move and a body stopped it —
the brief requires the character to be unable to walk through solid bodies, and a count is how you
assert that.
**What happened:** I compared the asked-for step against `object.position` immediately after
`moveAndSlide`. That is always zero delivered motion, because the solver writes the transform after
the frame. So my "blocked" counter incremented on **every tick the player held a key**: 400 blocked
ticks in a 400-tick run in which the warden crossed six metres unobstructed. The scenario asserting
`blockedTicks >= 20` passed, and proved nothing.
**How I found out:** a position trace I added for an unrelated reason showed `blocked` climbing 60
per 60 ticks while `x` was changing steadily.
**Cost:** ~4 tool calls; the wrong assertion had already been green for two suite runs.
**What I did instead:** compare last tick's ask against last tick's delivery, one frame late.
**What would have prevented it:** nothing in the framework — the `moveAndSlide` doc comment warns
about exactly this in eleven lines, including the `clone()` trap, and I had read it. Recording it
anyway because a warning that specific being ignored is data: the API shape invites the mistake, and
a `deliveredMotion` accessor that returned the solver's last applied delta would have removed it.
**Silent:** yes — a green assertion that measures nothing is the worst possible outcome, and it is
what I shipped for two runs.
