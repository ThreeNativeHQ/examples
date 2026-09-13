# Engine Flight API — installed `@threenative/core`

Read from the installed declaration files, not from documentation or memory. The entire flight
surface is declared in one file:

`node_modules/@threenative/core/dist/index.d.ts`

Every `path:line` below is relative to this repository root unless it names `node_modules`. Runtime
defaults that are not visible in a `.d.ts` are cited to
`node_modules/@threenative/core/dist/index.js`.

---

## 1. `FlightModel`

Class declaration: `index.d.ts:2063`.

Constructor signature (`index.d.ts:2066`):

```ts
constructor(options: IFlightModelOptions<TState>);
```

Constructor options — `IFlightModelOptions` (`index.d.ts:2051-2054`) extends
`IFlightEnvironment` and adds `state`:

```ts
interface IFlightModelOptions<TState extends IFlightState = IFlightState> extends IFlightEnvironment {
    /** The game's own aircraft object, extended with whatever else the game needs on it. */
    readonly state: TState;
}
```

`IFlightEnvironment` (`index.d.ts:2006-2013`):

```ts
interface IFlightEnvironment {
    readonly airframe: IAircraftAirframe;
    readonly wind?: IFlightVector3;
    readonly modifiers?: IFlightModifiers;
    readonly gravity?: number;
    /** Height of the carrier deck surface above the water, m. */
    readonly deckHeight?: number;
}
```

So the constructor options are: `state` (required), `airframe` (required, via
`IFlightEnvironment`), and the optional `wind`, `modifiers`, `gravity`, `deckHeight`.

Public properties (`index.d.ts:2064-2065`):

```ts
readonly state: TState;
readonly environment: IFlightEnvironment;
```

Public methods (`index.d.ts:2067-2073`):

```ts
setAttitude(heading?: number, pitch?: number, roll?: number): void;
reset(): void;
axes(): IFlightAxes;
gearClearance(): number;
forces(modifiers?: IFlightModifiers): IFlightForces;
step(dt: number, controls: IFlightControls, modifiers?: IFlightModifiers): void;
stepDeck(deck: IFlightDeck, dt: number, controls: IFlightControls, modifiers?: IFlightModifiers): "liftoff" | "overrun" | null;
```

Class doc comment (`index.d.ts:2055-2062`):

```ts
/**
 * One aircraft's dynamics: a thin owner of a game-authored state object plus its environment.
 *
 * @example
 * const model = new FlightModel({ airframe: sbd, state: aircraft, wind: seaWind });
 * model.setAttitude(0, 0.2, 0);
 * model.step(1 / 60, { turn: -1, pitch: 0.4 });
 */
```

Runtime behaviour of the constructor: it retains the passed options object by reference and calls
`initFlight(this.state, this.environment)` (`index.js:16491-16494`).

---

## 2. `IFlightState`

Declaration: `index.d.ts:1954-2005`. The interface has no doc comment. Fields:

| Field | Type | Optional | Doc comment |
|---|---|---|---|
| `x` | `number` | no | — |
| `y` | `number` | no | — |
| `z` | `number` | no | — |
| `vx` | `number` | no | — |
| `vy` | `number` | no | — |
| `vz` | `number` | no | — |
| `attitude` | `IFlightQuaternion` | **yes** (`attitude?`) | — |
| `heading` | `number` | no | — |
| `pitch` | `number` | no | — |
| `roll` | `number` | no | — |
| `rollRate` | `number` | no | — |
| `pitchRate` | `number` | no | — |
| `yawRate` | `number` | no | — |
| `speed` | `number` | no | — |
| `ias` | `number` | no | — |
| `groundSpeed` | `number` | no | — |
| `throttle` | `number` | no | — |
| `rpm` | `number` | no | — |
| `fuel` | `number` | no | — |
| `hp` | `number` | no | — |
| `engineCut` | `boolean` | no | — |
| `gear` | `boolean` | no | — |
| `brakes` | `boolean` | no | — |
| `gearPos` | `number` | no | — |
| `brakePos` | `number` | no | — |
| `flapPos` | `number` | no | — |
| `flaps` | `number` | no | — |
| `aileron` | `number` | no | — |
| `elevator` | `number` | no | — |
| `rudder` | `number` | no | — |
| `controlAileron` | `number` | no | — |
| `assist` | `boolean` | no | — |
| `trim` | `number` | no | — |
| `gforce` | `number` | no | — |
| `aoa` | `number` | no | — |
| `beta` | `number` | no | — |
| `stall` | `number` | no | — |
| `payloadMass` | `number` | no | `/** Mass of everything under the wings, kg. The game writes it as stores are released. */` |
| `payloadDrag` | `number` | no | `/** Extra flat-plate drag coefficient from external stores. */` |
| `flightTime` | `number` | no | — |
| `lift` | `number` | no | — |
| `drag` | `number` | no | — |
| `thrust` | `number` | no | — |
| `mass` | `number` | no | — |
| `deckSpeed` | `number` | **yes** (`deckSpeed?`) | — |
| `deckLateral` | `number` | **yes** (`deckLateral?`) | — |
| `deckOffset` | `number` | **yes** (`deckOffset?`) | — |
| `chocks` | `boolean` | **yes** (`chocks?`) | — |

The optional fields are exactly: `attitude`, `deckSpeed`, `deckLateral`, `deckOffset`, `chocks`
(`index.d.ts:1961`, `2001-2004`). Every other field is declared required, so the caller must
supply it at construction as far as the type is concerned.

At runtime the constructor's `initFlight` backfills a subset with `??` fallbacks rather than
requiring them: `heading`, `pitch`, `roll` (`index.js:16232`), `speed` (`16234`), `gear`,
`brakes` (`16241-16242`), `flaps` (`16243`), `throttle` (`16245`), `assist` (`16246`), `trim`
(`16247`), `fuel` and `payloadMass` are read with `??` in `aircraftMass` (`16185`). It also writes
`x/y/z`-independent fields such as `vx/vy/vz`, `rollRate`, `pitchRate`, `yawRate`, `gearPos`,
`brakePos`, `flapPos`, `rpm`, `aileron`, `elevator`, `rudder`, `controlAileron`, `gforce`, `aoa`,
`beta`, `stall`, `ias`, `groundSpeed` and `flightTime` (`index.js:16230-16259`). Those runtime
writes do not relax the required fields in the declared type.

---

## 3. `IFlightControls`

Declaration: `index.d.ts:1936-1943`:

```ts
/** One fixed step of pilot input. Every field is a dimensionless command in `[-1, 1]`. */
interface IFlightControls {
    readonly turn?: number;
    readonly pitch?: number;
    readonly rudder?: number;
    readonly wheelBrake?: boolean;
    /** When true, stability assist is bypassed and the game commands the attitude directly. */
    readonly autopilot?: boolean;
}
```

Fields and ranges:

| Field | Type | Optional | Range |
|---|---|---|---|
| `turn` | `number` | yes | dimensionless, doc says `[-1, 1]`; clamped to `[-1,1]` at `index.js:16334` |
| `pitch` | `number` | yes | dimensionless, doc says `[-1, 1]`; clamped to `[-1,1]` at `index.js:16337` |
| `rudder` | `number` | yes | dimensionless, doc says `[-1, 1]`; clamped to `[-1,1]` at `index.js:16340` |
| `wheelBrake` | `boolean` | yes | — |
| `autopilot` | `boolean` | yes | — |

**There is no `throttle` field in `IFlightControls`.** Throttle is not a control input; it is a
field on the state object, `IFlightState.throttle: number` (`index.d.ts:1971`), which the game
writes directly. The engine reads it: `initFlight` sets `state.rpm = state.throttle || 0`
(`index.js:16245`), and `updateActuators` lerps `state.rpm` toward `state.throttle`
(`index.js:16326-16329`), with `state.fuel <= 0 || state.engineCut` forcing zero. `flightForces`
uses `state.rpm ?? state.throttle ?? 0` to scale thrust (`index.js:16298-16302`). So throttle is
set by assigning `state.throttle`, not by passing anything to `step`.

---

## 4. `IFlightDeck`

Declaration: `index.d.ts:1944-1953`:

```ts
/** The moving deck an aircraft launches from. */
interface IFlightDeck {
    readonly x: number;
    readonly y?: number;
    readonly z: number;
    readonly heading: number;
    readonly speed: number;
    readonly length: number;
    readonly width: number;
}
```

Fields: `x` (number, required), `y` (number, **optional**), `z` (number), `heading` (number),
`speed` (number), `length` (number), `width` (number).

`y` has **no doc comment** on the field itself. The only doc comment on `IFlightDeck` is the type
line, `/** The moving deck an aircraft launches from. */` (`index.d.ts:1944`). There is no
verbatim field-level explanation of `y` to quote. The `IFlightDeck` shape in the game's wrapper
omits `y` entirely (`src/sim/flight.ts:177-185`), which the optional type permits.

---

## 5. Flight environment options and `deckHeight`

The environment is `IFlightEnvironment` (`index.d.ts:2006-2013`), quoted in full in section 1
above. `deckHeight` carries the only field-level doc comment in that interface:

```ts
    /** Height of the carrier deck surface above the water, m. */
    readonly deckHeight?: number;
```
`index.d.ts:2011-2012`.

`deckHeight` is a **construction-time option only**. It is declared `readonly` on
`IFlightEnvironment`, which `IFlightModelOptions` extends (`index.d.ts:2051`), and there is no
method or property on `FlightModel` to change it after construction (`index.d.ts:2063-2074`). The
model keeps the options object as its `environment` (`index.js:16493`, typed `IFlightEnvironment`
at `index.d.ts:2065`) and re-spreads it on every `forces`/`step`/`stepDeck` call
(`index.js:16509`, `16512`, `16515`). There is no API to mutate it, so a `deckHeight` change
requires constructing a new `FlightModel`. Runtime default when omitted is `20`:
`const deckHeight = environment.deckHeight ?? 20;` (`index.js:16426`).

---

## 6. Airframe definition and freezing

The airframe type is `IAircraftAirframe` (`index.d.ts:1901-1925`):

```ts
/** Per-aircraft constants. The game supplies these; the model ships no airframe of its own. */
interface IAircraftAirframe {
    /** Empty mass, kg. */
    readonly dryMass: number;
    /** Mass of a full fuel load, kg. */
    readonly fuelMass: number;
    /** Reference wing area, m². */
    readonly wingArea: number;
    /** Wingspan, m. */
    readonly span: number;
    /** Mean aerodynamic chord, m. */
    readonly chord: number;
    /** Shaft power at full throttle, W. */
    readonly power: number;
    /** Propeller efficiency, 0–1. */
    readonly propEfficiency: number;
    /** Maximum static thrust, N. */
    readonly staticThrust: number;
    /** Pitch moment of inertia, kg·m². */
    readonly pitchInertia: number;
    /** Roll moment of inertia, kg·m². */
    readonly rollInertia: number;
    /** Yaw moment of inertia, kg·m². */
    readonly yawInertia: number;
}
```

Every field is declared `readonly`. The file comment says the game supplies them and the model
ships no airframe of its own (`index.d.ts:1901`). The engine therefore has no airframe object to
freeze. The one frozen object the flight module ships is
`NEUTRAL_FLIGHT_MODIFIERS` (`index.d.ts:1934`), created with `Object.freeze({...})` at
`index.js:16159-16165`. The engine's internal `SEA_WIND` is also frozen (`index.js:16167`). For
comparison, this game freezes its own airframe table: `const AIRFRAMES: Record<string,
IAircraftAirframe> = Object.freeze({...})` (`src/sim/flight.ts:26`). `deckHeight` is **not** part
of `IAircraftAirframe`; it belongs to `IFlightEnvironment` (`index.d.ts:2012`).

---

## 7. Exported symbols containing Flight, Deck, Aero or Airframe

`name — path:line` for the declaration; all are exported from the package barrel at
`index.d.ts:2395`:

- `FlightModel` — `node_modules/@threenative/core/dist/index.d.ts:2063`
- `IFlightAxes` — `node_modules/@threenative/core/dist/index.d.ts:1896`
- `IFlightControls` — `node_modules/@threenative/core/dist/index.d.ts:1936`
- `IFlightDeck` — `node_modules/@threenative/core/dist/index.d.ts:1945`
- `IFlightEnvironment` — `node_modules/@threenative/core/dist/index.d.ts:2006`
- `IFlightForces` — `node_modules/@threenative/core/dist/index.d.ts:2014`
- `IFlightModelOptions` — `node_modules/@threenative/core/dist/index.d.ts:2051`
- `IFlightModifiers` — `node_modules/@threenative/core/dist/index.d.ts:1927`
- `IFlightQuaternion` — `node_modules/@threenative/core/dist/index.d.ts:1890`
- `IFlightState` — `node_modules/@threenative/core/dist/index.d.ts:1954`
- `IFlightVector3` — `node_modules/@threenative/core/dist/index.d.ts:1885`
- `IAircraftAirframe` — `node_modules/@threenative/core/dist/index.d.ts:1902`
- `NEUTRAL_FLIGHT_MODIFIERS` — `node_modules/@threenative/core/dist/index.d.ts:1934`
- `aerodynamicCoefficients` — `node_modules/@threenative/core/dist/index.d.ts:2039`

No other file under `node_modules/@threenative/core/dist/*.d.ts` contains any of the words
Flight, Deck, Aero or Airframe.

---

## How `src/sim/flight.ts` uses it today

`src/sim/flight.ts` is a thin wrapper. It constructs one `FlightModel` per `AircraftFlight`
(`src/sim/flight.ts:139-191`). The constructor (`src/sim/flight.ts:145-149`):

```ts
constructor(state: any, airframeId = "sbd") {
  this.state = state;
  this.#airframeId = airframeId;
  this.#model = new FlightModel({ airframe: airframeFor(airframeId), state, wind: this.wind });
}
```

What it passes: `airframe` from `airframeFor` (`src/sim/flight.ts:131-133`), the game `state`
(typed `any`, `src/sim/flight.ts:140`), and `wind` (a copy of the frozen shared `SEA_WIND`,
`src/sim/flight.ts:22`, `141`). What it leaves defaulted: `gravity`, `modifiers`, and
`deckHeight` are not passed to the constructor, so the model uses engine defaults — gravity
`9.80665` (`index.js:16377-16378`), `NEUTRAL_FLIGHT_MODIFIERS` (`index.js:16379`), and deck
height `20` (`index.js:16426`). The game defines `DECK_HEIGHT = 20.06`
(`src/sim/flight.ts:24`) but never passes it as the environment option; instead it is written into
each airframe record (`src/sim/flight.ts:29`, repeated per airframe), where `IAircraftAirframe`
(`index.d.ts:1902-1925`) has no such field, so it is ignored by the engine.

`step` injects this game's damage multipliers as the optional third argument
(`src/sim/flight.ts:173-175`):

```ts
step(dt: number, controls: Record<string, unknown>): void {
  this.#model.step(dt, controls, damageModifiers(this.state));
}
```

`stepDeck` does the same and passes a deck object with no `y`
(`src/sim/flight.ts:177-190`), permitted because `IFlightDeck.y` is optional
(`index.d.ts:1947`). `setAirframe` rebuilds the model when the airframe id changes
(`src/sim/flight.ts:151-155`) — this is the only way the wrapper changes the environment, because
`airframe`, like `deckHeight`, is a construction-time option. The wrapper exposes
`state`, `setAirframe`, `reset`, `setAttitude`, `axes`, `gearClearance`, `step` and `stepDeck`; it
never calls `forces` (`src/sim/flight.ts:139-191`). In the game, this wrapper is used only for the
player: `this.playerFlight = new AircraftFlight(this.player, "sbd")`
(`src/sim/battle.ts:188`) and `this.playerFlight.step(dt, controls)`
(`src/sim/battle.ts:1360`). AI aircraft are not driven through it.

---

## Gaps for the AI migration

Facts only; each compares what `steerAircraft` writes (`src/sim/tactics.ts:85-115`) with what
`FlightModel` requires or overwrites.

- `steerAircraft` writes attitude as scalars — `a.roll` (`src/sim/tactics.ts:94`), `a.heading`
  (`src/sim/tactics.ts:96`), `a.pitch` (`src/sim/tactics.ts:104`). `FlightModel` owns pose through
  the quaternion and derives `heading`/`pitch`/`roll` from it (`index.js:16405`,
  `index.js:16365-16367`); the only public pose writer is `setAttitude(heading?, pitch?, roll?)`
  (`index.d.ts:2067`).
- `steerAircraft` integrates its own kinematics: it computes `turn` (`src/sim/tactics.ts:95`),
  overwrites `a.speed` (`src/sim/tactics.ts:106`), writes `a.vx/vy/vz`
  (`src/sim/tactics.ts:108-110`), and adds to `a.x/y/z` (`src/sim/tactics.ts:111-113`).
  `FlightModel.step(dt, controls, modifiers?)` performs that integration
  (`index.d.ts:2072`, `index.js:16405-16414`), so those writes would be overwritten.
- `steerAircraft` computes an internal dimensionless `turn` and `desiredPitch` but emits no
  `IFlightControls`. `FlightModel` takes `turn`, `pitch`, `rudder` as `[-1, 1]` commands
  (`index.d.ts:1936-1943`).
- `steerAircraft` writes engine state as `a.rpm = m.power * 0.86` (`src/sim/tactics.ts:114`);
  it never writes `a.throttle`. `IFlightControls` has no throttle field (`index.d.ts:1936-1943`),
  and `updateActuators` overwrites `state.rpm` by lerping toward `state.throttle`
  (`index.js:16326-16329`), so an AI aircraft's power must be written to `state.throttle`
  (`index.d.ts:1971`).
- `steerAircraft` hard-clamps speed to `[32, fighter 153 / other 142]`
  (`src/sim/tactics.ts:106`). `FlightModel` has no speed clamp; it integrates momentum and only
  floors the airspeed used for forces at `12` (`index.js:16406-16412`, `index.js:16383`).
- `steerAircraft` hard-codes gravity `9.80665` in its turn formula (`src/sim/tactics.ts:95`) and
  a per-tactic bank limit (`src/sim/tactics.ts:89`, `93`). Gravity is `environment.gravity` on
  `FlightModel` (`index.d.ts:2010`, default `index.js:16377`), and there is no bank-limit input;
  roll authority comes from `rollInertia` and `span` inside `stepFlight`
  (`index.js:16399`).
- `steerAircraft` scales its own acceleration and rpm by `damageModifiers(a)`
  (`src/sim/tactics.ts:105`, `114`). `FlightModel` takes the same multipliers as its optional
  `modifiers` argument (`index.d.ts:2072`); the existing wrapper passes
  `damageModifiers(this.state)` from the call site (`src/sim/flight.ts:174`).
- `steerAircraft`'s inputs are `dest`, `alt` and `targetSpeed` (`src/sim/tactics.ts:85`, `98`,
  `105`). `FlightModel` has no navigation or target-speed concept; its inputs are per-step
  `IFlightControls`, whose only autonomy flag is `autopilot` (`index.d.ts:1942`), which bypasses
  stability assist and expects the game to command attitude directly.
- `steerAircraft` uses `a.speed` as its primary speed state (`src/sim/tactics.ts:95`, `105-106`);
  `FlightModel` writes `state.speed` from the velocity vector and maintains a separate `ias`
  (`index.js:16412-16413`), and the landing-assist code in `battle.ts` reads `p.ias ?? p.speed`
  (`src/sim/battle.ts:1306`, `1328`, `1334`).

DONE docs/engine-flight-api.md
