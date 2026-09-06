<!-- Generated mirror of AGENTS.md. Do not edit; edit AGENTS.md. -->

# AGENTS.md — sailing sailing

Instructions for the AI agent in this game. `CLAUDE.md` mirrors this file; edit `AGENTS.md`.

## Ownership

ThreeNative owns bootstrap, renderer, fixed-step loop, input, loading, physics bindings, and the state bridge. This repository owns ship handling, the sea state, `Buoyancy3D`, course order, HUD,
water, and look; `src/game.ts` is portable and React mounts from `src/main.ts`.

## Start every change

1. **Critical planning gate:** invoke `threenative-capabilities` before `prd-creator`. Search
   `engine_search_capabilities` for the full request and each concrete mechanic, inspect relevant
   matches with `engine_capability_detail`, and record a capability or no-match for the plan.
2. Then invoke `prd-creator`. Draft the plan around those capabilities and binding constraints,
   direct the user to review it, and wait for explicit approval plus an instruction to implement it.
3. Treat returned constraints as binding. `@threenative/physics/navigation` is browser-only WASM;
   this kit uses its analytic wave field and measured hull points instead.
4. If a build, import, device, or blank frame fails, run `npx threenative doctor` and
   `npx @threenative/playtest doctor`; missing observations are not zero.
For *"a bullet passes through a wall"*, `RigidBody3D` defaults to continuous collision; `continuousCollision` is the named per-body override, and `body.continuousCollision` reports the effective setting on web/native.

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
- Confirmed framework bugs: use `file-engine-bug` in `.agents/skills/` or `.claude/skills/` after a minimal repro.

## Commands and map

```sh
pnpm dev
pnpm build
pnpm build --target desktop
pnpm test:native
```

`Ship.ts` uses `RigidBody3D` plus `Buoyancy3D`; apply forces before fixed-step simulation.
The sea is a `SpectralOcean` and it draws **nothing** — the mesh, the material, every colour, the
foam line and the tessellation are all in `src/render/ocean.ts`, which is this game's file and not
the framework's. The vertex stage reads the same cascade buffers the CPU height query is copied
from, so the water the ship rides is the water on screen. Three things about it that are easy to
get wrong and expensive to diagnose:

1. **The game owns the sea's clock.** `ocean.advance(seconds)` every frame, or the compute passes
   run forever on the spectrum at t = 0: the dispatches count up, the readback lands, and the bytes
   are identical. A still ocean passes every other assertion in this template.
2. **`sampleHeight` is a copy, and it says how old it is.** Read it through `surfaceHeight()` in the
   same file, which corrects for that age by sampling upwind at the swell's phase speed. Anything
   put straight onto the raw height floats on water the renderer stopped drawing.
3. **Difference the normal finer than the mesh.** Shading detail below the geometric resolution is
   what a normal is for; buying it as geometry costs twice the triangle budget for an identical
   frame. `normalNode` is view space and overrides `normalView`, so hand it
   `transformNormalToView(...)` — fed a world-space normal the sun's reflection becomes a column of
   glare that follows the camera.

Tune the sea state in `SEA`, the surface's look below it, hull points and handling in
`src/entities/Ship.ts`, and the course in `src/scenes/Sailing.ts`. The sails are `SoftBody3D` and
live at the **scene root**, not under the hull: the class disposes itself on `removed`, so `Ship`
carries them to their yards each tick. The single React HUD reads published state; keep
`playtests/survives.playtest.json` as smoke proof and native scenarios honest.

On a touch-primary device (`isMobile() && isTouchscreenAvailable()`), `src/render/touch-controls.ts`
adds a left movement stick whose vector `Sailing` passes to `Ship`; keyboard is the desktop fallback.

## Portable authoring contracts

Leave `assets` absent: the cook selects target-decodable passes, with `models.sharedImages: true` deduplicating images. `sharedImages: false` embeds duplicate copies; `models: "none"` / `textures: "none"` skip those passes and report uncooked bytes. Android/iOS currently skip compression and model dedupe. `assets.exclude` defaults to `[]`; source-relative globs (for example `["unused/**"]`) omit matching files and report saved bytes. `assets.budget` accepts `{ uncooked?: number | "none", total?: number | "none" }`, default `{ uncooked: 64_000_000, total: "none" }`: only bytes left uncooked where cooking was possible count toward `uncooked`. A number sets that ceiling; `"none"` disables both gates. Either disabled gate still reports bytes. Automatic texture cooking retains unaligned source images unchanged and reports `block-size`; those bytes still count toward the uncooked budget. An explicit compression codec override must satisfy four-pixel block alignment; `codec: "none"` opts out. Cooking never silently resizes an image to fix alignment.

Relative look capture: a binding with `pointerRelative: true` captures the canvas on click by default; set `captureOnClick: false` and call `ctx.input.captureMouse()` from your own gesture to opt out. Desktop mode precedence is CLI (`--windowed`, `--maximized`, `--fullscreen`) over `display.fullscreen` over `window.maximized`; with both false, `window.width`/`height` size the normal window.
Scenes use `load`, `enter`, `update`, `exit`, `render`; physics nodes are Godot-named and disposable. Generated conventions call `normaliseToMetres` for authored ship scale; buoyancy owns water contact.
`input.vector()` ends in `clampLength(0, 1)`, which is right for a thumbstick and wrong for two
independent controls: read through one vector, a helm and a set of sheets held together each get
0.707. `helm` and `sheets` are separate bindings for that reason; `move` stays for the touch stick.
`.y` is +up and means forward; use one explicit conversion to the model's bow.
Rigged assets: put a `.glb` in `assets/`, await `ctx.assets.model("hero.glb")` in `Scene.load()`, then drive `AnimationPlayer` beside its entity. `ctx.goto(name)` rebuilds without resetting game
state; from a frame function `goto` and then `return`; `ctx.state.set({ /* copy this game's initial-state shape */ })`
is a partial patch. `game.goto("<scene-name>")` also rebuilds the scene, but it resets the game's
state. Seeded randomness is deterministic only when `defineGame({ seed })` is configured.

`src/render/quality.ts` owns `low`, `medium`, `high`; `isMobile()` chooses `low`, otherwise `high`;
override with `setupPost(..., { tier: "low" })`. Unknown tiers throw and `TN_QUALITY_TIER` reports
the source. The bridge flushes about 100 ms; keep speed/lap in state and frame feedback in Three.js.

When an animation looks wrong, measure it before rewriting it. `clipPoseError` scores a
retargeted clip against its source per bone in degrees — whole quaternions relative to each rig's
own bind pose, so the two rigs' bind conventions cancel and a limb rolled about its own axis is
caught where a bone-direction check reads zero. `clipTrackBindings` names tracks that bind nothing
(the `<bone>.undefined` failure that plays the bind pose instead of the animation),
`clipBoneCoverage` names bones the clip does not drive and which therefore keep the previous
clip's pose, and `boneContact` reports in metres whether a named bone reaches the prop it is
supposed to be touching. Two loading conventions come from `@threenative/core`, not from your own loops: `loadAll(items, load)` fetches six at a time and returns results **in the input's order** (a pool that pushes returns completion order, so a positional pick lands a different asset every load), and `addInSlices(objects, (object) => ctx.add(object))` attaches 256 per presented frame so hundreds of objects never land in one long frame; override `concurrency`/`sliceSize`, pass `while: () => alive` to stop a torn-down scene without throwing, and `marker: false` silences `TN_LOAD_ALL`/`TN_ADD_SLICES` but never the measurement.

## Budget real time for the look

Open a capture after visual changes. A scenario with no assertions or missing observations fails.

Recipes shipped in the project: `agent-docs/assertion-reference.md`, `agent-docs/capability-reference.md`, `agent-docs/capture-the-frame.md`, `agent-docs/ctx-cookbook.md`, `agent-docs/debug-surface.md`, `agent-docs/finding-assets.md`, `agent-docs/gameplay-recipes.md`, `agent-docs/menu-screens.md`, `agent-docs/mobile-memory-budget.md`, `agent-docs/sculpt-from-a-reference.md`, `agent-docs/trace-a-slow-frame.md`, `agent-docs/visual-baseline.md`, and `agent-docs/webview-ui.md`.
