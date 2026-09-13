# Midway — Open Pacific

A flight-combat sandbox over the 1942 Pacific. Launch an SBD Dauntless off the USS Enterprise,
search the northwest sector, confirm the Japanese carrier group, dive or torpedo their flight
decks, then bring your crew home. This is a ThreeNative port of a standalone WebGL build, with its
flight dynamics lifted into `@threenative/core` as `FlightModel` and reused here.

Controls: `W`/`S` throttle · arrow keys or mouse steer · `Space` guns · `B` ordnance · `F` dive
brakes · `G` gear · `N` flaps · `C` camera · `T` course hold · `M` intel map · `Q` squadron orders
· `H` home · `P`/`Esc` pause.

## What the engine owns

`@threenative/core`'s `FlightModel` owns lift, drag, thrust, stall, control authority and the
carrier-deck run. This game supplies the airframe constants (`src/sim/flight.ts`), the damage
multipliers (`src/sim/damage.ts`), and every model, material and colour (`src/render/`).

## Commands

```sh
pnpm dev
pnpm build
pnpm typecheck
```

`pnpm dev` runs the Vite dev server. The game selects core's WebGL2 backend
(`renderer.preferWebGPU: false`) because its ocean, sky and particle shaders are authored as GLSL;
that makes this an honest **web** lane. Rewriting those shaders as TSL is what native would take.

## Layout

- `src/sim/` — pure, deterministic game state: `battle.ts`, `tactics.ts`, `gunnery.ts`,
  `damage.ts`, `armament.ts`, `flight.ts`, `math.ts`. No Three.js and no DOM.
- `src/render/` — the world: procedural models (`assets.ts`, `dauntless.ts`), the GLSL ocean and
  particles, and `world.ts`, which builds all of it into the framework's scene.
- `src/hud.ts` — the DOM and 2D-canvas heads-up display.
- `src/scenes/Midway.ts` — the scene: input, the fixed-step battle step, and the world/HUD update.
