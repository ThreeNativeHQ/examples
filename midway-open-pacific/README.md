# Midway — Open Pacific

A flight-combat sandbox over the 1942 Pacific. Launch an SBD Dauntless off the USS Enterprise,
search the northwest sector, confirm the Japanese carrier group, dive or torpedo their flight
decks, then bring your crew home. This is a ThreeNative port of a standalone WebGL build, with its
flight dynamics lifted into `@threenative/core` as `FlightModel` and reused here.

Controls: `W`/`S` throttle · arrow keys steer (`Down` raises the nose) · `Space` guns · `B` ordnance · `F` dive
brakes · `G` gear · `N` flaps · `C` camera · `T` course hold · `M` intel map · `Q` squadron orders
· `H` home · `P`/`Esc` pause.

## Assignments

The briefing offers three assignments. Pick one before pressing either start button; the choice
survives a restart.

**Carrier strike** is the default short sortie. Designate a known enemy carrier with `TAB`, land one
bomb or armed-torpedo direct hit on it — yourself, or with a wing you explicitly ordered onto it
with `2` — and recover alive. Strafing and near misses do not count. A hit the crew never saw is
held as unconfirmed until the target is sighted again or a fresh report comes in.

**Scout and report** is the other short sortie: get one fresh enemy-carrier contact, transmit it
with `R`, and recover alive. Reporting an escort does not satisfy it.

**Open Pacific** is the original, longer battle, unchanged: neutralize all four enemy flight decks
and recover.

A short sortie ends at the first successful recovery and gets its own debrief — elapsed time, your
own credited hits, ordered-wing hits, carriers reported, and the fuel and airframe you actually
landed with. A safe return without the assignment reads *Returned — objective incomplete*: neither
a defeat nor a victory.

`H` changed with them. It now routes to an astern setup point that moves with the carrier and then
up the groove, showing airspeed, descent rate, lineup corrections and a fuel-reserve estimate,
instead of pointing at the carrier's centre. `L` still flies the assisted final, and still needs the
same gate it always did.

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

`pnpm dev` runs the Vite dev server. The game runs on the default **WebGPU** backend: its ocean,
sky and combat particles are TSL node materials (`src/render/ocean.ts`, `world.ts`, `particles.ts`),
not GLSL. Shadow maps are deliberately off — three r185's WebGPU shadow pass raised a
`bindingBuffer ... used in submit while destroyed` validation error for this scene; the scene is
lit by the hemisphere and directional lights instead.

## Layout

- `src/sim/` — pure, deterministic game state: `battle.ts`, `tactics.ts`, `gunnery.ts`,
  `damage.ts`, `armament.ts`, `flight.ts`, `math.ts`. No Three.js and no DOM.
- `src/render/` — the world: procedural models (`assets.ts`, `dauntless.ts`), the GLSL ocean and
  particles, and `world.ts`, which builds all of it into the framework's scene.
- `src/hud.ts` — the DOM and 2D-canvas heads-up display.
- `src/scenes/Midway.ts` — the scene: input, the fixed-step battle step, and the world/HUD update.
