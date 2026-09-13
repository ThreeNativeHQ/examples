<!-- Generated mirror of AGENTS.md. Do not edit; edit AGENTS.md. -->

A ThreeNative port of the standalone `Midway — Open Pacific` WebGL game. Framework rules live in
`/AGENTS.md`; this file covers only what is different here.

## Ownership

`@threenative/core` owns the loop, renderer, input, playtest bridge, the fixed-step scene
lifecycle, and the flight dynamics (`FlightModel`). This repository owns the game: airframes,
missions, AI, damage, models, HUD and look. `src/sim/` is pure and has no Three.js or DOM;
`src/render/` is ordinary Three.js; `src/scenes/Midway.ts` wires them to the framework.

## Start every change

The flight model is the engine capability this game exists to exercise. Read
`src/sim/flight.ts` first: it is the only place airframe constants enter the engine. If a change
needs a new force, control or deck behaviour, add it to `@threenative/core`'s `FlightModel` and
reuse it here — do not grow a second flight model in this repo.

## Platform

The game runs on core's default **WebGPU** backend. Its analytic WaveField ocean and combat
particles use TSL node materials. Dawn HDR supplies the background and filtered water reflections.
Shadow maps are enabled: the installed Three patch keys shadow variants by source material,
preventing multi-material meshes from disposing GPU bindings during submission. Keep appearance in
`src/render/`. The hero Douglas and nearby carriers retain their supplied geometry; distant ships
use LOD. `public/assets/enterprise.glb` is the unused modern CVN-80 source; the visible WWII
Enterprise uses the detailed sister-ship geometry in `hornet.glb`.
Do not claim desktop, Android or iOS until a `--target` playtest has run.

## Deck crew

`src/render/deck-crew.ts` exports `loadDeckCrew(ctx)` and the `DeckCrew` class (`.group`,
`.sailors`, `.update(dt)`, `.dispose()`). It instances one rigged sailor per flight-deck station —
twelve, each with a real job (plane director, two chockmen at the main wheels, plane captain at the
engine, ordnanceman at the bomb rack, fuel detail, arresting-gear crew, deck talker, safety
observer, three handlers) — each with its own clip, start phase, playback rate and a cloth helmet
coloured for its trade. Two rules:

- The rig's height is a pipeline constant (`SOURCE_HEIGHT = 1.83`), not `SkeletalMesh3D`'s `size`:
  that option measures to the crown **bone**, which stops in the middle of the skull, and asking it
  for 1.74m produced a 2.03m sailor.
- Playback rate is applied to each sailor's own `dt` in `update()`, never to the action's
  `timeScale`, because `AnimationPlayer`'s stride pass rewrites an in-place clip's `timeScale` back
  to 1 on every frame even when `strideSync: false`.

## Imported fleet

`src/render/imported-fleet.ts` exports `loadImportedFleet(ctx)`, `createZero()`,
`createSamidare()` and `createMidwayAtoll()`. It wires up the supplied-but-previously-unused assets:
the Mitsubishi A6M3, an IJN destroyer, and Midway Atoll with a garrison camp and radar station on
Eastern Island. Every orientation and scale constant there was **measured** (with
`tools/probe-glb.mjs` and `tools/blender/preview.py`), and the file records what was measured.

## Asset pipeline

`tools/blender/rig-deck-crew.py` builds `public/assets/deck-crew.glb` by binding the supplied
unrigged WWII sailor mesh to the CC0 Quaternius Universal Animation Library skeleton. The one
non-obvious step: the library's rest pose is a T-pose while the sailor's arms hang down, so the
script swings the upper arms into the mesh's stance, applies that as the new rest pose, and then
re-bases every action by the inverse of the same delta (with rest R' = R.D a stored basis B becomes
D^-1.B) so the clips still play as authored.

## Geometry tools

- `node tools/check-fleet.mjs` — parses the shipped GLBs with no browser and asserts crew clips and
  skeleton, the A6M3's span and propeller pivot, the destroyer hull's length and axis, and the
  atoll's scale.
- `node tools/inspect-glb.mjs <file>` — dimensions, node names, clips, triangle and material counts.
- `node tools/probe-glb.mjs <file> [nameFilter]` — per-node world bounds, for finding a nose
  direction, propeller or gear.
- `node tools/probe-ocean.mjs` — measures the ocean's real significant wave height on the CPU.
- `blender -b -P tools/blender/preview.py -- <file> <out-prefix> [front,side,top]` — headless
  orthographic previews.
- `bash tools/capture-lock.sh node tools/capture-fleet.mjs` — browser capture of the deck party, the
  Zero, the destroyer and Midway, with assertions a screenshot cannot make.
- `bash tools/capture-lock.sh node tools/capture-deck.mjs` — raycasts the carrier's own geometry to
  measure deck width at each station and captures the launch.

## Verify

```sh
pnpm typecheck
pnpm exec vite build
node scripts/check-flight.mjs
node scripts/check-aircraft.mjs
node scripts/check-audio.mjs
node tools/check-fleet.mjs
node tools/probe-ocean.mjs
bash tools/capture-lock.sh node tools/check-repair.mjs
bash tools/capture-lock.sh node tools/capture-deck.mjs
bash tools/capture-lock.sh node tools/capture-fleet.mjs
bash tools/capture-lock.sh node node_modules/@threenative/playtest/dist/runner/cli.js \
  --scenario playtests/launch.playtest.json --url http://127.0.0.1:5199 --browser-recipe webgpu --headed
```

`playtests/launch.playtest.json` boots the briefing, clicks **Take the deck**, runs the throttle
and rotation, and fails on any console error or runtime diagnostic. A visible change also needs an
eye on the frame — the automated gates are blind to how it looks.
