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
