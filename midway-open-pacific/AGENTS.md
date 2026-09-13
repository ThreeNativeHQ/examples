# AGENTS.md — midway-open-pacific

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

## Verify

```sh
pnpm typecheck
pnpm exec vite build
node scripts/check-flight.mjs
node scripts/check-aircraft.mjs
node scripts/check-audio.mjs
bash tools/capture-lock.sh node tools/check-repair.mjs
bash tools/capture-lock.sh node node_modules/@threenative/playtest/dist/runner/cli.js \
  --scenario playtests/launch.playtest.json --url http://127.0.0.1:5199 --browser-recipe webgpu --headed
```

`playtests/launch.playtest.json` boots the briefing, clicks **Take the deck**, runs the throttle
and rotation, and fails on any console error or runtime diagnostic. A visible change also needs an
eye on the frame — the automated gates are blind to how it looks.
