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
import type { IAircraftAirframe } from "@threenative/core";
import { damageModifiers } from "./damage.js";

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
 * One aircraft's flight. Rebuilds its engine model only when the airframe changes, so a loadout
 * switch on the deck is picked up on the next step without a per-frame allocation.
 */
export class AircraftFlight {
  readonly state: any;
  wind = { ...SEA_WIND };
  #model: FlightModel;
  #airframeId: string;

  constructor(state: any, airframeId = "sbd") {
    this.state = state;
    this.#airframeId = airframeId;
    this.#model = new FlightModel({ airframe: airframeFor(airframeId), state, wind: this.wind });
  }

  setAirframe(id: string): void {
    if (id === this.#airframeId) return;
    this.#airframeId = id;
    this.#model = new FlightModel({ airframe: airframeFor(id), state: this.state, wind: this.wind });
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

  step(dt: number, controls: Record<string, unknown>): void {
    this.#model.step(dt, controls, damageModifiers(this.state));
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
    controls: Record<string, unknown>,
  ): "liftoff" | "overrun" | null {
    return this.#model.stepDeck(deck, dt, controls, damageModifiers(this.state));
  }
}
