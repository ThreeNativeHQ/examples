/**
 * Midway's aircraft performance, expressed through the engine's FlightModel.
 *
 * The engine owns lift, drag, thrust, stall and the deck run; this file owns only the airframe
 * constants and the damage multipliers for this game, exactly the split the abstraction exists
 * for.
 */
import {
  FlightModel,
  airDensity,
  aircraftMass,
  attitudeAxes,
  gearClearance,
  setAttitude,
} from "@threenative/core";
import type { IAircraftAirframe, IFlightControls, IFlightModifiers, IFlightState } from "@threenative/core";
import { damageModifiers } from "./damage.js";
import { angleDelta, bearing, clamp, distance2 } from "./math.js";

export { airDensity, aircraftMass, attitudeAxes, gearClearance, setAttitude };

/** Sea-level wind the whole battle shares. */
export const SEA_WIND = Object.freeze({ x: 1.2, y: 0, z: 11 });

export const DECK_HEIGHT = 20.06;

const AIRFRAMES: Record<string, IAircraftAirframe> = Object.freeze({
  sbd: {
    chord: 2.38,
    deckHeight: DECK_HEIGHT,
    dryMass: 3050,
    fuelMass: 520,
    pitchInertia: 9400,
    power: 745700,
    propEfficiency: 0.8,
    rollInertia: 14500,
    span: 12.66,
    staticThrust: 11200,
    wingArea: 30.19,
    yawInertia: 17500,
  },
  // Consolidated PBY-5 Catalina, the flying boat the radio already calls a Catalina. It had no
  // airframe id, so it was silently flying on Dauntless constants until now.
  catalina: {
    chord: 4.1,
    deckHeight: DECK_HEIGHT,
    dryMass: 9485,
    fuelMass: 2500,
    pitchInertia: 145000,
    power: 1789680,
    propEfficiency: 0.8,
    rollInertia: 320000,
    span: 31.7,
    staticThrust: 24000,
    wingArea: 130.0,
    yawInertia: 420000,
  },
  tbd: {
    chord: 2.38,
    deckHeight: DECK_HEIGHT,
    dryMass: 2700,
    fuelMass: 460,
    pitchInertia: 9400,
    power: 670000,
    propEfficiency: 0.8,
    rollInertia: 14500,
    span: 15.24,
    staticThrust: 10000,
    wingArea: 39.2,
    yawInertia: 17500,
  },
  wildcat: {
    chord: 1.9,
    deckHeight: DECK_HEIGHT,
    dryMass: 2674,
    fuelMass: 420,
    pitchInertia: 6200,
    power: 895000,
    propEfficiency: 0.82,
    rollInertia: 6800,
    span: 11.58,
    staticThrust: 9200,
    wingArea: 24.15,
    yawInertia: 8200,
  },
  zero: {
    chord: 1.98,
    deckHeight: DECK_HEIGHT,
    dryMass: 1680,
    fuelMass: 360,
    pitchInertia: 5200,
    power: 700000,
    propEfficiency: 0.82,
    rollInertia: 5400,
    span: 12,
    staticThrust: 7600,
    wingArea: 22.44,
    yawInertia: 6800,
  },
  // Aichi D3A1. The Japanese dive bombers were flying with the Douglas's airframe until now,
  // which gave them American span, mass and power while the radio called them Vals.
  val: {
    chord: 2.43,
    deckHeight: DECK_HEIGHT,
    dryMass: 2408,
    fuelMass: 470,
    pitchInertia: 9200,
    power: 798000,
    propEfficiency: 0.8,
    rollInertia: 15600,
    span: 14.365,
    staticThrust: 10400,
    wingArea: 34.9,
    yawInertia: 17800,
  },
  kate: {
    chord: 2.4,
    deckHeight: DECK_HEIGHT,
    dryMass: 2790,
    fuelMass: 480,
    pitchInertia: 9500,
    power: 690000,
    propEfficiency: 0.8,
    rollInertia: 13000,
    span: 14.9,
    staticThrust: 9600,
    wingArea: 34.6,
    yawInertia: 16000,
  },
});

export function airframeFor(id: string | undefined): IAircraftAirframe {
  return AIRFRAMES[id ?? "sbd"] ?? AIRFRAMES.sbd;
}

/**
 * One aircraft's flight. Rebuilds its engine model only when the airframe or the bound deck
 * changes, so a loadout switch or a diversion to another carrier is picked up on the next step
 * without a per-frame allocation.
 *
 * `deckHeight` is the engine's wheels-on-deck plane and is a construction-time environment option,
 * which is why binding a different deck rebuilds the model. The airframe's own `deckHeight` field
 * is not what the engine reads for the deck run: `stepDeck` takes `environment.deckHeight ?? 20`.
 * The state object is retained across a rebuild, so nothing the game wrote to the aircraft is lost.
 */
export class AircraftFlight {
  readonly state: any;
  wind = { ...SEA_WIND };
  #model: FlightModel;
  #airframeId: string;
  #deckHeight: number;

  constructor(state: any, airframeId = "sbd", deckHeight = DECK_HEIGHT) {
    this.state = state;
    this.#airframeId = airframeId;
    this.#deckHeight = deckHeight;
    this.#model = this.#build();
  }

  #build(): FlightModel {
    return new FlightModel({
      airframe: airframeFor(this.#airframeId),
      state: this.state,
      wind: this.wind,
      deckHeight: this.#deckHeight,
    });
  }

  setAirframe(id: string): void {
    if (id === this.#airframeId) return;
    this.#airframeId = id;
    this.#model = this.#build();
  }

  /** Bind the aircraft to one carrier's own flight-deck datum, in metres above the sea. */
  setDeck(deckHeight: number): void {
    if (!Number.isFinite(deckHeight) || deckHeight === this.#deckHeight) return;
    this.#deckHeight = deckHeight;
    this.#model = this.#build();
  }

  reset(): void {
    this.#model.reset();
  }

  setAttitude(heading = 0, pitch = 0, roll = 0): void {
    this.#model.setAttitude(heading, pitch, roll);
  }

  axes(): ReturnType<typeof attitudeAxes> {
    return this.#model.axes();
  }

  gearClearance(): number {
    return this.#model.gearClearance();
  }

  step(dt: number, controls: IFlightControls, modifiers?: IFlightModifiers): void {
    this.#model.step(dt, controls, modifiers ?? damageModifiers(this.state));
  }

  stepDeck(
    deck: {
      x: number;
      z: number;
      heading: number;
      speed: number;
      length: number;
      width: number;
    },
    dt: number,
    controls: IFlightControls,
  ): "liftoff" | "overrun" | null {
    return this.#model.stepDeck(deck, dt, controls, damageModifiers(this.state));
  }
}

/**
 * Every field `IFlightState` declares as required, with a finite value. The engine backfills some of
 * these in `initFlight`, but not all: `throttle` in particular is only ever read, and an aircraft
 * that reaches `step` without one turns `rpm` into NaN on the first actuator pass, which then
 * silently poisons thrust, velocity and position with no error anywhere. The literal is typed as
 * `IFlightState` so a field the engine adds later fails typecheck here instead of at runtime.
 */
const FLIGHT_STATE_DEFAULTS: IFlightState = Object.freeze({
  aileron: 0,
  aoa: 0,
  assist: true,
  beta: 0,
  brakePos: 0,
  brakes: false,
  controlAileron: 0,
  drag: 0,
  elevator: 0,
  engineCut: false,
  flapPos: 0,
  flaps: 0,
  flightTime: 0,
  fuel: 100,
  gear: false,
  gearPos: 0,
  gforce: 1,
  groundSpeed: 0,
  heading: 0,
  hp: 100,
  ias: 0,
  lift: 0,
  mass: 0,
  payloadDrag: 0,
  payloadMass: 0,
  pitch: 0,
  pitchRate: 0,
  roll: 0,
  rollRate: 0,
  rpm: 0,
  rudder: 0,
  speed: 0,
  stall: 0,
  throttle: 0,
  thrust: 0,
  trim: 0.04,
  vx: 0,
  vy: 0,
  vz: 0,
  x: 0,
  y: 0,
  yawRate: 0,
  z: 0,
});

/** Fill in whatever the game's own aircraft record is missing, and repair any non-finite value. */
export function initFlightState(a: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(FLIGHT_STATE_DEFAULTS)) {
    const have = a[key];
    const bad = typeof value === "boolean" ? typeof have !== "boolean" : !Number.isFinite(have);
    if (bad) a[key] = value;
  }
}

/** How far a controller may command the aircraft away from straight and level. */
export interface ISteerLimits {
  /** Maximum commanded bank, rad. */
  bank?: number;
  /** Maximum commanded climb, m/s. Negative forces a descent, which is how a glide is asked for. */
  climb?: number;
  /** Maximum commanded descent, m/s. */
  sink?: number;
  /** Shortest lookahead the vertical law will aim over, m: a small one makes a steep dive. */
  lead?: number;
  /** Longest lookahead, m. Equal to `lead` it fixes the aim distance, as a torpedo run wants. */
  leadMax?: number;
  /** Below this altitude the law asks for a climb whatever the target says, m. */
  floor?: number;
}

/**
 * The bank-and-load control law: a heading error becomes a bank command and an altitude error a
 * vertical-speed command, both leaving as the installed `IFlightControls` fields. `autopilot` is
 * set, which bypasses the engine's stability assist so the commanded bank is the aircraft's own
 * rather than a correction on top of a wing leveller, and keeps the turn coordinated.
 *
 * The same law flies the player's own autopilot (`Battle.updatePlayer`); that call site should be
 * switched to this function rather than keeping a second copy of the gains.
 */
export function steerToward(
  a: {
    x: number;
    y: number;
    z: number;
    vx: number;
    vy: number;
    vz: number;
    heading: number;
    roll: number;
    rollRate: number;
    ias?: number;
    speed: number;
    stall?: number;
  },
  aim: { x: number; z: number },
  desiredAlt: number,
  limits: ISteerLimits = {},
  out: { autopilot?: boolean; pitch?: number; rudder?: number; turn?: number } = {},
): IFlightControls {
  // Manoeuvre margin. Just off a deck an aircraft is barely flying, and neither a steep bank nor a
  // strong climb is available to it: a controller that asks anyway rolls or stalls it into the sea
  // before it has accelerated. Both authorities taper with speed instead of switching off at a
  // threshold, so slow flight is flown gently rather than abandoned.
  const margin = clamp(((a.ias || a.speed) - 30) / 40, 0.25, 1);
  const bankLimit = (limits.bank ?? 0.62) * margin;
  const desiredBank = clamp(angleDelta(bearing(a, aim), a.heading) * 0.9, -bankLimit, bankLimit);
  const currentBank = -a.roll;
  const turn = clamp((desiredBank - currentBank) * 2.5 - a.rollRate * 0.7, -1, 1);
  // The vertical command is a flight path towards the aim point, not a fixed gain on the height
  // error: the same law then flies a cruise leg, a dive-bombing run and a groove, because a short
  // lookahead is exactly what makes a dive steep.
  const reach = clamp(distance2(a, aim), limits.lead ?? 250, limits.leadMax ?? Infinity);
  const commanded = limits.climb ?? 8;
  const climbLimit = commanded > 0 ? commanded * margin : commanded;
  let desiredVY = clamp(
    ((desiredAlt - a.y) / reach) * Math.max(30, Math.hypot(a.vx, a.vz)),
    -(limits.sink ?? 12),
    climbLimit,
  );
  // The floor is the height the aircraft will not knowingly descend through, and the deeper it is the
  // harder the law climbs out — up to the tactic's own commanded climb, never past it. Capping the
  // floor push at the speed-tapered `climbLimit` instead left a slow aircraft (margin down to 0.25)
  // unable to climb out at all, which is what denied the ordered wing its torpedo and dive runs.
  if (limits.floor !== undefined && a.y < limits.floor)
    desiredVY = Math.max(desiredVY, Math.min(commanded, 2 + (limits.floor - a.y) * 0.5));
  // A banked aircraft needs more than 1 g to hold its height; the engine takes that as the load the
  // stick is asking for, so the bank compensation and the height error arrive on the same channel.
  const baseLoad = clamp(1 / Math.max(0.45, Math.cos(currentBank)), 1, 2.2);
  let pitch = clamp((baseLoad - 1) / 4.5 + (desiredVY - a.vy) * 0.02, -0.45, 0.6);
  // The engine's trimmed angle of attack reaches past the critical one, so a load command held
  // through a stall keeps the aircraft stalled. Stop pulling instead.
  if ((a.stall ?? 0) > 0.35) pitch = Math.min(pitch, 0);
  out.autopilot = true;
  out.pitch = pitch;
  out.rudder = 0;
  out.turn = turn;
  return out;
}
