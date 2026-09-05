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
