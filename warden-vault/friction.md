# friction.md — warden-vault (physics-puzzle, framework arm)

**First game code written at tool call:** 22. Calls 1-21 were the operating contract, the scaffold,
the reference image, the brief, the generated `AGENTS.md`, the four `.d.ts` files that stand in for
the missing source, the assertion reference, and the capability searches — of which the searches and
the `.d.ts` reading were worth every call and the rest was orientation.

**Total tool calls:** ~145.

**Where they went, roughly:** 20 on orientation, 25 on writing the game, 15 on the visual loop,
**about 45 on proof** — writing scenarios, reading their failures, and fixing what they found — and
the rest on commits and the friction log. The proof share is the headline number in this round and it
is not waste: nine of the eleven scenarios failed at least once, and **seven of those failures were
real defects in the game**, not bad assertions. Two of the seven would have shipped a game that dies
on a documented keypress.

## Honest verdict

The framework helped, and the help and the friction came from the same place. Physics, the fixed
step, input, the render chain, the state bridge and the loading screen are all real and all worked;
`TN_WORLD_ENVIRONMENT` naming every stage it did *not* build, `TN_QUALITY_TIER` naming the source of
the tier, and the asset error page printing both URLs it tried are better diagnostics than most
engines ship. I never had to write a renderer, a loop, a collision solver or a state bridge: the
game is **2,121 lines I wrote**, on top of 1,963 lines of generated source I kept largely unchanged
(the render chain, the loading screen, the shape helpers, the UI shell), plus 736 lines of scenario
JSON. But the two hardest days of this build were both framework
gaps rather than game problems: **a dynamic rigid body cannot be repositioned**, which makes "run the
simulation again from the same state" inexpressible without destroying and rebuilding every body —
and rebuilding changes the answer, deterministically and invisibly (F10); and **the playtest surface
keys on a physics `entity` namespace that is not the scene-registry namespace**, so a game whose
trigger demonstrably fired reports no contact at all (F9). Both are silent. Neither is discoverable
from the types.

The playtest runner itself is the best part of the framework and the most expensive. Its diagnostics
are specific enough to act on — it names the path, prints the value, and refuses to let an assertion
that was already true count as proof — and that refusal is *right*: it caught four rows of mine that
proved nothing, including one that had been green for two suite runs while measuring a deferred
transform that was always zero (F12). The cost is that the triviality rule cannot see a value that
changed before its first sample (F7) or one that came back to where it started (F14), and its own
suggested remedy (`changed: true`) does not fix either. Every one of those cost a build and a run.

Net: **helped**, clearly — but the friction is concentrated in exactly the surface this round is
about, and it is the kind that costs a day rather than a minute.

## What I wrote by hand that the framework already shipped

Nothing large, and I checked. Before the determinism work I searched
`engine_search_capabilities` for "put a rigid body back where it started and reset the physics
world", "restart a level so the physics simulation begins from the same state" and "compare two runs
of the same simulation for determinism"; the index returned `afterPhysics`, `CollisionShape3D`,
`rapier`, `Joint3D`, `TerrainTiles`, `sendUiIntent`, `buildStaticColliders`, `createRandom`,
`Scheduler` and `GPUReadback`. None of them resets a body, and the digest-and-drift comparison I
wrote (about 30 lines) has no equivalent in the manifest. `createReplayDriver` is the closest thing
and it replays *input*, which was never the problem — my input was already scripted and pure.

Two smaller ones, both caught by searching first rather than after: I nearly hand-rolled a seeded
PRNG before using `ctx.random`, and I considered writing an instanced draw for forty crates before
reading `InstancedBatch` — which I then correctly did **not** use, because every crate carries its
own simulated transform and instancing would have meant writing forty matrices a frame to save
forty draws.

One I got wrong in the other direction: the starter's `shapes.ts` already had `roundedBox`, and I
used it — but I wrote `crateShape.ts`'s geometry merge without searching first, and `mergeGeometries`
silently returns `null` when its inputs' attribute sets differ. `roundedBox` deletes its UVs, my
plank boxes had them, and I only avoided a null geometry because I happened to remember the rule.

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

### F13: The scaffold ships twenty scenarios written against a different game, and you must triage all of them
**Surface:** `playtests/` in the `starter` template
**What I was trying to do:** start proving my own game.
**What happened:** the template ships 24 scenario files, every one of them written against the
coastal demo the template also ships — `goal`, `coyote`, `respawn`, `odometer`, `zoom-wheel`,
`cloth`, `models`, `textures` with baseline PNGs. All of them assert on a `GameState` shape my game
does not have (`score`, `lives`, `flagDisplacement`). None of them can survive contact with a new
game, and `pnpm test` runs `playtests/*.playtest.json`, so the first thing a new game's test command
does is fail twenty times for reasons that have nothing to do with the new game.
**How I found out:** by reading them one at a time to decide what to keep.
**Cost:** ~2 tool calls plus the reading.
**What I did instead:** deleted 20 and rewrote 4.
**What would have prevented it:** ship the demo's scenarios under `playtests/starter/` and point the
`test` glob at `playtests/*.playtest.json`, so the shipped proofs are available to read and
obviously not yours to keep. The generated `AGENTS.md` tells you to "keep
`playtests/survives.playtest.json` as smoke proof and update outcome tests" — but `survives`
asserts on two `components` rows (`groundClearance`, `normaliseFactor`) that only exist because the
starter's `Player` calls `GroundSnap` and `normaliseToMetres`. A flat-floored game that deletes
`conventions.ts` cannot keep the file the instructions say to keep.

### F14: `changed: true` cannot express "it came back", and the diagnostic recommends it anyway
**Surface:** `@threenative/playtest` — `TN_PLAYTEST_ASSERTION_TRIVIAL`, `resources.changed`
**What I was trying to do:** prove that `R` rebuilds the vault: `status` goes `playing` → `won` →
`playing`, and `sealedBy` goes `none` → `warden` → `none`. A round trip is exactly what a restart
*is*.
**What happened:** both rows failed as trivial — "already satisfied before the scenario ran" —
because triviality compares the first sample with the final one, and a round trip ends where it
started. `changed: true` does not help; it is the very thing the diagnostic's suggestion recommends.
The right tool is `atSteps`, which is listed in the assertion reference but is not what the
diagnostic points at.
**How I found out:** two failed runs and a re-read of the reference.
**Cost:** ~3 tool calls, two runs.
**What I did instead:** `"atSteps": [{"label": "won", "equals": "won"}, {"label": "vault-reopens",
"equals": "playing"}]`, which is a much better assertion than what I first wrote — it pins the value
at both ends instead of only at the end.
**What would have prevented it:** one clause in the triviality suggestion: "…or `atSteps`, when the
value is supposed to return to where it started."

### F15: Two restart bugs the scenario found and nothing else would have
**Surface:** my game, `ctx.startup.whenReady()`, `ctx.add()`
**What I was trying to do:** write the outcome test for `R`, which the HUD advertises.
**What happened:** two separate defects, both invisible in normal play because I had never pressed R
after winning.
1. `ctx.startup.whenReady()` is a **boot** milestone, not a per-scene one. My vault opened on that
   promise (see F7). On the rebuild `goto("play")` causes it has already resolved and never resolves
   again, so `buildCrates()` never ran: `crates: 0`, an empty room, a warden alone in it. Fixed by
   opening immediately when `ctx.startup.progress >= 1`.
2. `ctx.add()` **reparents** the object it is handed. Adding the mesh found inside a loaded glTF
   empties that glTF's scene; the asset loader hands the same cached object back on the next load,
   and my `load()` threw `Proof glTF did not contain a mesh` — a dead game after one keypress. Fixed
   by cloning. `ctx.add`'s doc comment describes what it returns and says nothing about ownership.
**How I found out:** the scenario. `crates: 0` in the report and a `TN_PLAYTEST_CONSOLE_ERROR` with
the page error and its stack line.
**Cost:** ~6 tool calls, three runs — and worth every one.
**What would have prevented it:** for (1), a note on `IStartupStatus` that it describes the boot and
not the scene. For (2), one sentence on `ctx.add`: "the object is reparented into the scene".
**Silent:** yes for (1) — nothing throws, the room is simply empty.

### F16: `atSteps` catches the frame-one fake win — but its failure message throws away the evidence it already has
**Surface:** `@threenative/playtest` — `resources[].atSteps`, `TN_PLAYTEST_RESOURCE_TRANSITION_ASSERTION_FAILED`
**What I wanted to assert, in plain words:** the run reached `won` *because* the warden's body
overlapped the seal — that the terminal state arrived after the contact and never before it. This is
the exact defect of F5, where the game reported `won` on frame one with the warden eight metres
away and every scenario I had at the time went green.
**What I wrote:**
```json
{ "id": "state", "path": "status", "atSteps": [
  { "label": "vault-drops", "equals": "playing" },
  { "label": "cross-the-vault", "equals": "playing" },
  { "label": "after-the-contact", "equals": "won" } ] }
```
plus `{"entity":"player","with":"seal","kind":"trigger","atStep":"reach-the-seal"}`.
**What the runner did — the good half:** I reintroduced the F5 defect exactly (seal area lowered
onto the floor plane, body filter removed) and re-ran. **It failed, and it should have.** So the
answer to "can you distinguish a real win from that fake one" is *partly yes*: `atSteps` pins the
value at labelled boundaries, and pinning `status: "playing"` before the contact is the assertion I
did not know to write when F5 bit me.
**What the runner did — the bad half:** the message was
`Resource 'state' path 'status' did not match the expected labeled-step transition.`
Three times, once per row, with no step, no expectation and no observed value. The report's
`details.samples` **already carries all of it** —
`{"expected":{"equals":"playing","label":"vault-drops"},"pass":false,"value":"won"}` — so the
information exists and only the human-readable line drops it. A build's worth of `grep` to recover
what the runner had already computed.
**What I still cannot assert:** causation, and sub-step ordering. `atSteps` is a comparison at step
*boundaries*. A win that arrives 199 ticks into a 200-tick step is indistinguishable from one that
arrives at tick 200 alongside the contact. If my `cross-the-vault` step had been one tick longer, or
if the fake win had appeared one step later than the one I happened to pin, the scenario would have
gone green on a broken game. I can prove "not won earlier than step N". I cannot prove "won because
of, and no earlier than, this contact".
**Cost:** ~4 tool calls including the negative control.
**What would have prevented it:** see `## Ideas`, `causedBy`.

### F17: A frame-one bug and a lazy assertion produce the same message
**Surface:** `TN_PLAYTEST_ASSERTION_TRIVIAL`
**What happened:** against the reintroduced F5 defect, my main win scenario
(`through-the-ward-onto-the-seal`) failed with
`Assertion 'resource.state' at path 'status' was already satisfied before the scenario ran (value "won").`
and `…path 'sealContacts' … (value 1)`. That is the runner correctly refusing a trivial assertion —
and it is also the *only* thing it said about a game that had won itself before the warden moved.
The suggestion it offers ("Drive the asserted value from a failing initial state, or assert
`changed:true`… `allowTrivial` takes the reason it is held") points the author at editing the
scenario. Following that advice on this run would have added an `allowTrivial` and made a broken
game green.
**How I found out:** only because I *knew* the defect was there; I had planted it.
**Cost:** free this time, and it is exactly the trap that cost six calls in F5.
**Silent:** yes, in the worst way — the harness detected the symptom and blamed the wrong side.
**What would have prevented it:** when a resource's initial sample already satisfies a
`won`/terminal-shaped assertion, that is at least as likely to be a game that started finished as a
lazy assertion. The message could say so: *"value was already `won` at the first sample — if this is
a terminal state, the run may have ended before it began."*

### F18: `entityVisible.throughoutFrames` counts frames from before the world exists
**Surface:** `visual[].entityVisible.throughoutFrames`
**What I wanted to assert:** the warden never leaves the frame — the brief requires the character to
stay legible, and this is a fixed camera, so it should hold for the whole run.
**What I wrote:** `{"entityVisible":{"entity":"player","minProjectedPixels":200,"throughoutFrames":true}}`
**What happened:** `TN_PLAYTEST_ENTITY_VISIBILITY_DROPPED: Entity 'player' dropped below 200
projected pixels.` I lowered it to 60. Same. I lowered it to **1** — `Entity 'player' dropped below
1 projected pixels.` There is no threshold at which it passes, because the run includes frames
before the scene has presented anything and the entity's projected bounds are zero there.
**How I found out:** by bisecting the threshold to 1, which is the only way to tell "the entity
really left the frame" from "the assertion covers frames in which nothing exists".
**Cost:** 3 tool calls, two runs.
**What I did instead:** dropped `throughoutFrames` and asserted the final frame only, which proves
much less — it cannot catch a camera that loses the character for two seconds in the middle.
**What would have prevented it:** `visual` needs the `window: { startStep, endStep }` that
`framebufferCoverage` already has. It is the same problem and the same shape of answer.
**Silent:** no, but the message is misleading: it reports a gameplay symptom for a lifecycle cause.

### F19: Every visual threshold is an absolute magic number, and there is no way to compare two regions
**Surface:** `visual[].region` — `maxDarkPixelRatio`, `minDarkPixelRatio`, `maxLuminance`, `minNonblankPixelRatio`
**What I wanted to assert, in plain words:** the seal is the brightest thing in the room and the
floor is dark — the two-source lighting the reference is built on. That is a *relative* claim and it
survives a change of exposure, tone curve or palette.
**What I could write:** two independent absolute rows —
```json
{ "region": { "x": 780, "y": 215, "width": 90, "height": 60, "maxDarkPixelRatio": 0.3 } },
{ "region": { "x": 470, "y": 520, "width": 300, "height": 120, "minDarkPixelRatio": 0.5 } }
```
**What happened:** the first attempt failed with
`Screenshot region at (780, 215) contained 0.19296296296296298 dark pixels, above maximum ratio 0.05.`
— an excellent message, and a number I then had to hand-fit. The seal is a set of concentric rings
with dark gaps between them by design, so "19 % dark" is correct and my 5 % was wrong. I ended up
choosing 0.3 because 0.193 was what this build measured, which is a threshold that says almost
nothing and will need re-fitting the next time anyone touches the exposure. The rows are also pinned
to pixel coordinates in a 1280x720 frame: they encode my camera, so any reframing silently
invalidates them without failing.
**What I still cannot assert:** "region A is brighter than region B", "this region is brighter than
it was at step X", or "the region bounded by entity `seal`" — `region.element` binds to a DOM node,
and there is no entity-bound equivalent even though the runner already projects entity bounds for
`entityVisible`.
**Cost:** 3 tool calls, two runs.
**What would have prevented it:** see `## Ideas`, `regionCompare` and `region.entity`.

### F20: `settled` can tell a real settle from a frozen one — but only by a tuned distance, and the two numbers are a factor of two apart
**Surface:** `settled[].compareToStep` + `minMeanPoseDistance`
**What I wanted to assert:** the bodies came to rest *after moving*, not because they were authored
at rest and never moved — the brief says "stack, topple, collide, and come to rest **after the
initial drop**", and "45 of 45 asleep" is equally true of a room where nothing ever fell.
**What I wrote:**
```json
{ "atStep": "fall-and-settle", "entity": "crate.", "minBodies": 30,
  "compareToStep": "first-look", "minMeanPoseDistance": 0.02 }
```
**What happened — the good half:** this works, and I had assumed it did not exist. I ran the
negative control (every crate authored at its resting height, so nothing falls) and it failed:
`Expected mean settled-pose distance for 'crate.' to reach 0.02m from step 'first-look'; observed
0.01595886305145731m across 45 bodies.` The real build measures 0.0312 m.
**What is unsatisfying:** 0.0160 m versus 0.0312 m. A pile that never fell still reports 1.6 cm of
mean motion, because settling bodies micro-adjust before they sleep. The distinction is a factor of
two and a hand-fitted threshold, not a category. A game with a gentler drop than mine has no
threshold that separates the two at all.
**What would have prevented it:** report the *peak* speed each body reached between the two steps as
well as the pose delta. "Every body was moving at some point" is categorical; "the mean pose moved
2 cm" is a magic number. See `## Ideas`, `settled.minPeakSpeed`.

### F21: The determinism check is the one thing in this game the harness cannot check at all
**Surface:** `resources` vs the brief's replay requirement
**What I wanted to assert:** that the two replay passes produced the same final state.
**What I can actually assert:** `{"id":"state","path":"replayMatch","equals":true}` — which reads a
boolean **my own game computed**. The harness never sees the two digests. If my comparison were
`replayMatch = true` with no digest at all, every scenario I have would still be green, and the
report would still say `pass: true` with `trivialityOptOutCount: 0`.

This is the purest example of the thing worth naming in this round: **a green run asserting far less
than it appears to.** `same-input-twice-same-vault` looks like a determinism proof. It is a proof
that a boolean in my state store is `true`. I mitigated it inside the game — publishing
`replayDrift` (the largest disagreeing component, `0` here) and `replayBodies` (3) so the report
carries the measurement and its scope rather than only the verdict — but that mitigation is *also*
my own code marking its own homework. Nothing in the harness can distinguish my honest
implementation from a `return true`.

The general shape: the runner can observe state, contacts, poses, pixels and diagnostics, but it has
no way to **re-run the same scenario twice and compare its own observations**. That capability would
move determinism from "the game says so" to "the harness measured it", and it needs nothing from the
game at all — the observations are already recorded per tick.
**Cost:** this one cost nothing to discover and about 25 calls to work around (F10).
**What would have prevented it:** see `## Ideas`, `repeat`.

---

## Ideas

Capabilities I wanted and could not write, with the JSON I would have written. Ordered by what they
would have saved me on this build.

### 1. `causedBy` — the assertion F5 needed and I still cannot write

The single most valuable one. Today I can prove *"not won before step N"*; I cannot prove *"won
because of this contact, and never before it"*. The runner already records contacts with ticks and
resources per tick, so this is a comparison it can do without any new observation channel.

```json
{
  "causedBy": [
    {
      "effect": { "resource": "state", "path": "status", "becomes": "won" },
      "cause": { "contact": { "entity": "player", "with": "seal", "kind": "trigger" } },
      "withinTicks": 4,
      "neverBefore": true
    }
  ]
}
```

- `neverBefore: true` fails if the effect is ever observed before the first cause — which is exactly
  the F5 defect, at tick granularity rather than step granularity.
- `withinTicks` fails a game that reaches the terminal state a long time after the contact, which is
  the signature of a distance check or a timer that happens to fire near a contact.
- The `cause` should also accept `{ "resource": …, "becomes": … }` and `{ "signal": … }`, so
  "the door opened because the plate was pressed" is expressible with the same row.

This is the sentence the brief is really asking a physics-puzzle proof to make: *the destination was
reached through simulated contact*. Right now the runner can see the contact and can see the state,
and nothing relates them.

### 2. `repeat` — let the runner run the scenario twice and compare its own observations

Turns determinism from a claim the game makes into a measurement the harness takes (F21), and it
needs nothing from the game.

```json
{
  "repeat": {
    "runs": 2,
    "compare": {
      "poses": { "entity": "crate.", "maxDrift": 0.0001 },
      "resources": [{ "id": "state", "path": "status" }],
      "atStep": "fall-and-settle"
    }
  }
}
```

Failure would read `run 2 diverged from run 1 by 0.0312 m at body 'crate.27' by step
'fall-and-settle'` — which is the message I had to build inside my own game to make any progress at
all on F10, and which every physics game will need. It would also have found F10's real cause much
faster: two runs of the *same* build in the *same* process, compared by something that is not the
build under test.

### 3. `visual[].window` and `region.entity`

Two small ones that together make visual assertions usable (F18, F19).

```json
{
  "visual": [
    {
      "window": { "startStep": "vault-drops", "endStep": "after-the-contact" },
      "entityVisible": { "entity": "player", "minProjectedPixels": 60, "throughoutFrames": true }
    },
    {
      "region": { "entity": "seal", "pad": 8, "maxDarkPixelRatio": 0.3 }
    }
  ]
}
```

`window` is already the shape `framebufferCoverage` uses, so it is a consistency fix rather than a
new idea. `region.entity` reuses the projected bounds the runner already computes for
`entityVisible`, and removes the pixel coordinates that silently encode my camera into my scenarios.

### 4. `regionCompare` — relative brightness, so a look change does not invalidate every threshold

```json
{
  "regionCompare": [
    { "brighter": { "entity": "seal" }, "than": { "entity": "player" }, "byRatio": 1.5 },
    { "region": { "entity": "seal" }, "brighterThanAtStep": "vault-drops", "byRatio": 1.3 }
  ]
}
```

Every absolute threshold I wrote in F19 is a number fitted to one build of one look. The claims I
actually wanted — "the seal is the brightest thing in the room", "the seal got brighter when it was
broken" — are relative, are stable across exposure and palette changes, and are what a person means
by "is it lit".

### 5. `settled[].minPeakSpeed` — categorical instead of hand-fitted

```json
{ "settled": [{ "atStep": "fall-and-settle", "entity": "crate.", "minBodies": 30,
                "compareToStep": "first-look", "minPeakSpeed": 0.5 }] }
```

"Every body exceeded 0.5 m/s at some point and is now asleep" separates a real drop from a frozen
one categorically. `minMeanPoseDistance` separates them by a factor of two and a magic number (F20).

### 6. Two failure messages that already have their evidence and drop it

- `TN_PLAYTEST_RESOURCE_TRANSITION_ASSERTION_FAILED` should print the failing samples it already
  computed: `at step 'vault-drops' expected "playing", observed "won" (2 of 3 steps failed)` (F16).
- `TN_PLAYTEST_ASSERTION_TRIVIAL` on a value that looks terminal should offer the other reading
  before the scenario-editing advice: *"the run may have ended before it began"* (F17).

### 7. `contacts[].requiresEntityNames` — or just say it

A `contacts` row against a game whose physics bodies carry no `entity` can never pass, and the
message says "was not observed", which reads as a gameplay failure (F9). The runner knows the
contact log has no named participants at all. One extra clause — *"no physics body in this run
declared an `entity`; contacts cannot be attributed"* — turns a two-hour hunt into a one-line fix.

### 8. An `entity` default, and a `deliveredMotion` accessor

Not assertions, but the two API changes that would have removed the most silent failure from this
build: default a physics node's `entity` to the name it was registered under with
`ctx.entities.add` (F9), and give `CharacterBody3D` a `deliveredMotion` reading the solver's last
applied delta, so "was I blocked" is not a question every game answers wrongly against a deferred
transform (F12).
