<!-- Generated mirror of AGENTS.md. Do not edit; edit AGENTS.md. -->

# AGENTS.md — metahuman-lab

Instructions for the AI agent in this game. `CLAUDE.md` mirrors this file; edit `AGENTS.md`.

## Ownership

ThreeNative owns bootstrap, renderer, fixed-step loop, input, loading, physics bindings, and the state bridge. This repository owns gameplay and every visible choice in `src/render/`, `src/entities/`,
`src/scenes/`, and `src/ui/`; `src/game.ts` is portable and React mounts from `src/main.ts`. The render camera also skips an object that projects under **0.5 px** in it; `renderer.minimumProjectedPixels` raises that threshold (`false` disables the cut, not the count) and `alwaysRender(object)` exempts an object, while camera-attached objects and shadow casters are kept. The engine also owns the per-frame world-matrix walk, and by default it does not descend into a hidden subtree — so a game that reads a hidden object's `matrixWorld` directly must use `getWorldPosition` (or call `object.updateWorldMatrix(true, false)`) first; `renderer.matrixWorld: "all"` restores three's every-node walk, and `TN_PROJECTION` reports the visited-node count either way. `src/render/hero.ts` merges the hero's primitives into one buffer with `mergeParts`; pass `{ preserve: ["uv", "normal"] }` to keep authored texture coordinates and normals, and prepare any missing channel in the pieces first.

## Start every change

1. **Critical planning gate:** invoke `threenative-capabilities` before `prd-creator`. Search
   `engine_search_capabilities` for the full request and each concrete mechanic, inspect relevant
   matches with `engine_capability_detail`, and record a capability or no-match for the plan. Apply the `ponytail` ladder before writing code; never hand-write what the capability search already installs.
2. Then invoke `prd-creator`. Draft the plan around those capabilities and binding constraints,
   direct the user to review it, and wait for explicit approval plus an instruction to implement it.
3. Treat returned constraints as binding. `@threenative/physics/navigation` is browser-only WASM;
   use returned subpaths and `attachToBone` rather than rebuilding installed systems.
4. If a build, import, device, or blank frame fails, run `npx threenative doctor` and `npx @threenative/playtest doctor`; missing observations are not zero. For *"a bullet passes through a wall"*, `RigidBody3D` enables continuous collision by default; `continuousCollision` is the named per-body override, and `body.continuousCollision` reports the effective setting on web and native.

## When the framework blocks you, write plain Three.js

When an `@threenative/*` API is broken, missing, or does not do what you need, replace only that
piece with portable Three.js/plain code. Keep the loop, scenes, input, registry, and playtest
bridge; avoid DOM globals, dynamic `import()`, and raw physics handles. **Report what blocked you**
(API, expectation, result, replacement); never stall the game.

## Workflow skills

- `.agents/skills/prd-creator/SKILL.md` / `.claude/skills/prd-creator/SKILL.md` — game plan and approval gate.
- `.agents/skills/threenative-capabilities/SKILL.md` / `.claude/skills/threenative-capabilities/SKILL.md` — capability search.
- `.agents/skills/threenative-playtest/SKILL.md` / `.claude/skills/threenative-playtest/SKILL.md` — diagnosis and proof.
- `.agents/skills/threenative-assets/SKILL.md` / `.claude/skills/threenative-assets/SKILL.md` — assets and sculpting.
- `.agents/skills/threenative-visuals/SKILL.md` / `.claude/skills/threenative-visuals/SKILL.md` — captures and look.
- `.agents/skills/threenative-performance/SKILL.md` / `.claude/skills/threenative-performance/SKILL.md` — measured budgets.
- `.agents/skills/threenative-ui/SKILL.md` / `.claude/skills/threenative-ui/SKILL.md` — native-safe UI.
- `.agents/skills/threenative-context/SKILL.md` / `.claude/skills/threenative-context/SKILL.md` — portable ctx APIs.
- Confirmed framework bugs: use `file-engine-bug` in `.agents/skills/` or `.claude/skills/` after a minimal repro. A game-side `patches/` fix is temporary: once it is settled, it moves into the engine in one PR. Lazy-first: `.agents/skills/ponytail/SKILL.md` / `.claude/skills/ponytail/SKILL.md` — smallest correct change, and its reuse rung is the capability search above.

## Commands and map

```sh
pnpm specimen        # prepare the licensed specimen into content/ (run this first)
pnpm dev
pnpm test            # the one playtest, under tools/capture-lock.sh
pnpm typecheck
node tools/look.mjs
```

The game boots straight into `Lab`: one MetaHuman head, head-and-shoulders, lit neutrally, with
the expression panel on the right. There is no gameplay, no physics and no asset pipeline.

## The specimen is licensed and local

`content/` is **gitignored** and holds Epic's Fab Standard License MetaHuman (Ada `FaceMesh` LOD0)
after `node tools/prepare.mjs` reads the exported GLB and its head DNA and writes
`specimen.glb`, `head.dna` and `bindings.json`. Nothing under `content/` is ever committed, and
`tools/prepare.mjs` never copies a licensed file into a tracked path.

The sidecar is derived by construction, never hand-edited: joints by exact DNA joint name ==
glTF node name, morphs from `<dnaMesh>__<DNA channel>` target names on the primitives that carry
deltas, one LOD0 entry, and the 20 semantic faceboard aliases resolved against the rig's real
`RigEvaluator.names("gui")`. Add a channel by editing `SEMANTIC_CHANNELS` in `tools/prepare.mjs`
and a row in `src/ui/groups.ts`; a declared alias with no UI row is a load-time error, not a
control that silently does nothing.

There is no `assets/` directory and no `assets.manifest.json`, which is why the loader takes its
no-manifest route and serves `content/` verbatim (a vite plugin in `vite.config.ts` does the
serving, and copies `content/` into `dist/` on a plain `vite build`). **`threenative build` does
not carry `content/`** — use `pnpm dev`, or `vite build && vite preview`, to run a built bundle.

## What this game owns

- `src/scenes/Lab.ts` owns the rig: the one `ctx.beforeRender` that coalesces UI intents into a
  single `human.setControls`, drives `human.update()`, and publishes the probes. Keep the probes
  read off the Three.js objects after the update — off the applied morph influence and the applied
  joint transform — never off the numbers the UI sent. A playtest that only proved the sliders
  moved would prove the transport, not the face.
- `src/render/webgpuDevice.ts` is the one renderer setting. MetaHuman LOD0 carries 821 blend
  shapes, three encodes them as an array texture whose depth is the target count, and WebGPU's
  default device limit is 256 layers, so the head is never drawn without it. The engine hard-codes
  the limit list it asks for, so the game re-asks through `webgpuFactory`.
- `src/render/materials.ts` replaces the Unreal import's guesses (flat 0.8 grey, a bent-normal map
  bound to occlusion, an eye normal map bound to base colour, `COLOR_0` that is nearly black) with
  this sample's own surfaces, and disables `vertexColors` on all of them. The eyelash cards ship
  without a mask and are drawn as a translucent dark veil; drawn opaque they are two black holes.
- `src/ui/ExpressionPanel.tsx` is real `<input type="range">` plus real number entry, so the
  keyboard owns it. Both carry `data-tn-interactive`. Every row publishes the value the rig was
  actually given, or the panel shows the neutral while the face moves.
- `src/render/strands.ts` draws the groom as real strands: `node tools/prepare.mjs --strands`
  converts the licensed `.strands.bin` grooms (cm, z-up) into `content/*.strands.bin` (m, y-up,
  shuffled) plus the root-derived scalp mask, and every fibre is a one-pixel camera-facing ribbon
  expanded from a storage buffer, kept per strand in proportion to its true width, resolved by the
  TRAA. The hair hangs off the `head` joint; each brow strand rides its root's skin (`browFollow`).
  Unreal's own shading is **not** reproduced, and the diagnostics panel says so permanently.
  Animated-map outputs are bound and observable through `human.animatedMaps()`; no wrinkle
  material is wired to them.

LOD0 is pinned as the inspection override and reported as such. This import exported no LOD1, so
`human.setLod(1)` throws `TN_MH_BAD_LOD` and the UI says so rather than offering a dead toggle.

`playtests/face-controls.playtest.json` is the whole proof: it waits for `ready`, drives the jaw
and left-blink sliders through real clicks and key presses, asserts the sampled joint and morph
values moved and that the right eyelid did not, and captures neutral, jaw-open, left-blink and
smile+brow. Its assertions are floors, not exact values, because a key press can land before the
UI has re-published the previous value.

## Portable authoring contracts

Leave `assets` absent: the cook selects target-decodable passes, with `models.sharedImages: true` deduplicating images. `sharedImages: false` embeds duplicate copies; `models.compact` (default `{ flatten: true, join: true, instance: true }`) flattens the scene graph, merges primitives by material and batches a mesh shared by several nodes as `EXT_mesh_gpu_instancing` — all lossless, keeping any node matching `protectedPattern` (or named in `protectedNames`), an animation target, or a skin joint individually addressable; `compact: false` ships the scene graph as authored. `models: "none"` / `textures: "none"` / `audio: "none"` skip those passes and report uncooked bytes. Android/iOS currently skip compression and model dedupe. `assets.exclude` defaults to `[]`; source-relative globs (for example `["unused/**"]`) omit matching files and report saved bytes. `assets.budget` accepts `{ uncooked?: number | "none", total?: number | "none" }`, default `{ uncooked: 64_000_000, total: "none" }`: only bytes left uncooked where cooking was possible count toward `uncooked`. A number sets that ceiling; `"none"` disables both gates. Either disabled gate still reports bytes. Automatic texture cooking retains unaligned source images unchanged and reports `block-size`; those bytes still count toward the uncooked budget. An explicit compression codec override must satisfy four-pixel block alignment; `codec: "none"` opts out. Cooking never silently resizes an image to fix alignment.

Relative look capture: a binding with `pointerRelative: true` captures the canvas on click by default; set `captureOnClick: false` and call `ctx.input.captureMouse()` from your own gesture to opt out. Desktop mode precedence is CLI (`--windowed`, `--maximized`, `--fullscreen`) over `display.fullscreen` over `window.maximized`; with both false, `window.width`/`height` size the normal window.
Scenes use `load`, `enter`, `update`, `exit`, `render`; physics nodes are Godot-named and disposable; generated conventions call `GroundSnap` for floor contact and `normaliseToMetres` for authored model scale. `ctx.beforeRender(fn)` registers scene work that runs once per actual world draw, after the frame's last fixed update and before the projection packs, so `fn` reads the frame's final state; a held loader frame draws no world and dispatches nothing, and the registration clears on scene change and stop like `ctx.afterPhysics`. Automatic drawing resolution (`render.resolutionScale: "auto"` on `defineGame`) reads fresh GPU cost before presentation timing, so a host delay alone does not spend pixels while GPU headroom is observed and sustained headroom restores resolution; missing or stale GPU timing probes one rung and refunds it unless fewer pixels earn a better frame rate, oscillation holds are temporary, a numeric `resolutionScale` is the named pin override, and `TN_FRAME_BUDGET` reports the actual scale, its source, the GPU time as a mean/p50/p95/max series over resolved frames (`gpu`, with `gpuStale` counting frames that had no fresh reading and `gpu` absent rather than zero when there were none), and the draw calls and triangles each render pass submitted (main, shadow, reflection) under either policy. The engine's scene-render projection — an internal mirror that collapses repeated draws — is on by default; `render.projection: false` is the named opt-out and builds no mirror, so a game that measured it as a loss pays nothing to decline it, reported as `TN_RENDER_PROJECTION` reasonCode `disabled`. When the mirror draws props whose materials differ only in base colour, it proves a **bounded slice** of those materials each frame (`render.projection.materialChecks: "spread"`, the default) instead of all of them, so a base-colour edit still lands the same frame while any other material edit — a new roughness, map or define — leaves the batch and is drawn exactly up to `materialCheckStaleFrames` frames later, which `TN_RENDER_PROJECTION` reports. Name `"everyFrame"` to pay for every material every frame instead. A water surface's mirrored pass redraws every frame by default; `reflection.refreshInterval: N` redraws it every Nth presented frame and samples the previous reflection target in between, which halves the pass's cost at the price of up to `N - 1` frames of lag while the camera moves.
React never touches the scene graph. Native UI reads published state and sends intents; mark every touch target `data-tn-interactive`, and style `[data-tn-native-select]` / `[data-tn-native-select-option]` if the game has a `<select>`: on desktop the UI is drawn into the game's own frame with no view for a native popup to open into, so the engine renders the list in the page and the project gives it a look, the same division as `[data-threenative-debug-overlay]`. Rigged assets: put a `.glb` in `assets/`, await `ctx.assets.model("hero.glb")` in `Scene.load()`, then drive `AnimationPlayer` beside its entity.
`ctx.goto(name)` rebuilds without resetting game state; from a frame function `goto` and then
`return`; `ctx.state.set({ /* copy this game's initial-state shape */ })` is a partial patch.
`game.goto("<scene-name>")` also rebuilds the scene, but it resets the game's state. Seeded
randomness is deterministic only when `defineGame({ seed })` is configured.

When an animation looks wrong, measure it before rewriting it. `clipPoseError` scores a retargeted clip against its source per bone in degrees — whole quaternions relative to each
rig's own bind pose, so the two rigs' bind conventions cancel and a limb rolled about its own axis is caught where a bone-direction check reads zero. `clipTrackBindings` names
tracks that bind nothing (the `<bone>.undefined` failure that plays the bind pose instead of the animation), `clipBoneCoverage` names bones the clip does not drive and which
therefore keep the previous clip's pose, and `boneContact` reports in metres whether a named bone reaches the prop it is supposed to be touching. Two loading conventions come from `@threenative/core`, not from your own loops: `loadAll(items, load)` fetches six at a time and returns results **in the input's order** (a pool that pushes returns completion order, so a positional pick lands a different asset every load), and `addInSlices(objects, (object) => ctx.add(object))` attaches 256 per presented frame so hundreds of objects never land in one long frame; override `concurrency`/`sliceSize`, pass `while: () => alive` to stop a torn-down scene without throwing, and `marker: false` silences `TN_LOAD_ALL`/`TN_ADD_SLICES` but never the measurement.

## Budget real time for the look — see `node_modules/create-threenative/agent-docs/references/dream-loop.md`

The performance skill carries `TN_FRAME_BUDGET`, platform targets, and the `display.maxFps` rule. The engine warns you before a human does: `TN_SCENE_WARNING` fires when the GPU used under a third of the frame while the JS render phase ran longer than the display's own period, and names the census behind it — objects considered, draws per pass, triangles per draw, shadow-exempt casters. It is a scene-shape verdict, so answer it by moving the draw and object counts, not the engine: read the bucket census before promising a merge. `npx threenative doctor` repeats the last verdict and the `DEV_MODE=true` chip shows it beside the frame rate; `TN_FRAME_SPANS=1` adds the render phase's own span tree when you need to know which part costs the milliseconds. The cheapest static object is one whose transform you never write: measured on 1,561 objects, leaving them alone costs 10.10 ms of render phase against 17.45 ms when the game rewrites every transform each frame, because three skips the per-object binding update when nothing changed. So do not touch a transform you do not need to — that is worth ~7 ms where `markStatic(root)`, which additionally composes a never-moving subtree once, measured 0.009 ms. Use it for scenery you are sure of, and `invalidateStatic(object)` to announce a write inside one; it deletes matrix arithmetic, not the walk. `TN_RENDERLIST_VALIDATE=1` recomputes every world matrix the long way each frame and throws on the first that disagrees, which is how you prove a freeze did not leave something stale on screen.
Recipes in the installed create-threenative: `node_modules/create-threenative/agent-docs/references/assertion-reference.md`, `node_modules/create-threenative/agent-docs/references/build-profiles.md`, `node_modules/create-threenative/agent-docs/references/capability-reference.md`, `node_modules/create-threenative/agent-docs/references/capture-the-frame.md`, `node_modules/create-threenative/agent-docs/references/creating-creatures.md`, `node_modules/create-threenative/agent-docs/references/ctx-cookbook.md`, `node_modules/create-threenative/agent-docs/references/debug-surface.md`, `node_modules/create-threenative/agent-docs/references/finding-assets.md`, `node_modules/create-threenative/agent-docs/references/gameplay-recipes.md`, `node_modules/create-threenative/agent-docs/references/menu-screens.md`, `node_modules/create-threenative/agent-docs/references/mobile-memory-budget.md`, `node_modules/create-threenative/agent-docs/references/performance-basics.md`, `node_modules/create-threenative/agent-docs/references/rigging-characters.md`, `node_modules/create-threenative/agent-docs/references/sculpt-from-a-reference.md`, `node_modules/create-threenative/agent-docs/references/trace-a-slow-frame.md`, `node_modules/create-threenative/agent-docs/references/visual-baseline.md`, and `node_modules/create-threenative/agent-docs/references/webview-ui.md`.
## Optional multiplayer transport
For online play only, import `connect` from `@threenative/core/net` with an HTTPS URL and nonempty identity credential; configure `connectTimeoutMs`, `maxReliableMessageBytes`, `maxQueuedReliableBytes`, and `maxQueuedDatagrams` (10s/65,536/1 MiB/256), use `reliable-ordered` for ordered reliable messages and bounded `unreliable` datagrams that may drop, and keep serialization, replication, prediction, interpolation, snapshots and rejoin in this game's `src/` and server. There is no fallback: unsupported WebTransport/native rejects with `TN_NET_UNAVAILABLE`; reference Go server: `packages/runtime-native/examples/webtransport/server`.
