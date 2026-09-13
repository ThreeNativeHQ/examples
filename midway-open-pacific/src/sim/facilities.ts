/**
 * Midway as a set of individually hittable base functions. Pure game-owned state: `Battle` owns the
 * facilities and passes a seeded 0..1 roll in, so this module never calls `Math.random`. Every
 * function returns a new record; the caller decides when to replace it.
 */
import { clamp } from "./math.js";

export const FACILITY_KINDS = ["airstrip", "stores", "radar", "radio", "seaplane"] as const;
export type FacilityKind = (typeof FACILITY_KINDS)[number];

export interface Facility {
  id: string;
  kind: FacilityKind;
  x: number;
  z: number;
  radius: number;
  health: number;
  burning: boolean;
  repairProgress: number;
  repairBlocked: null | string;
}

/** Per-second work and destruction applied by `stepFacility`. */
export interface FacilityRates {
  repair: number;
  burn: number;
}

/** A single hit at least this large can set fuel and ordnance stores alight. */
export const FIRE_THRESHOLD = 0.2;
/** A fire that has eaten this much of a facility has nothing left to burn and goes out. */
export const BURN_OUT = 0.1;
/** Radio reports are never delayed past this multiple of the base delay. */
export const RADIO_FLOOR = 0.05;
/** Aviation is effectively gone below this fraction. */
export const LOST_EPSILON = 0.01;

export function damageFacility(f: Facility, amount: number, r01: number): Facility {
  const health = clamp(f.health - amount, 0, 1);
  // Only fuel and ordnance stores burn; a big enough hit can light them, a smaller one cannot.
  const ignites = f.kind === "stores" && amount >= FIRE_THRESHOLD && r01 < amount;
  return { ...f, health, burning: f.burning || ignites };
}

export function stepFacility(f: Facility, dt: number, rates: FacilityRates): Facility {
  const next = { ...f };
  if (f.burning) {
    next.health = clamp(f.health - rates.burn * dt, 0, 1);
    if (next.health <= BURN_OUT) next.burning = false;
    return next;
  }
  // Repair pauses while blocked or alight, but keeps the progress it already made.
  if (f.repairBlocked === null && f.health < 1) {
    next.repairProgress = clamp(f.repairProgress + rates.repair * dt, 0, 1);
    next.health = clamp(f.health + rates.repair * dt, 0, 1);
  }
  return next;
}

/** Mean health over just the given kinds; a kind with no facilities contributes nothing. */
function meanHealth(list: Facility[], ...kinds: FacilityKind[]): number {
  let sum = 0;
  let count = 0;
  for (const f of list) {
    if (kinds.includes(f.kind)) {
      sum += clamp(f.health, 0, 1);
      count += 1;
    }
  }
  return count ? sum / count : 0;
}

export function airstripCapability(list: Facility[]): number {
  return meanHealth(list, "airstrip");
}

export function storesCapability(list: Facility[]): number {
  return meanHealth(list, "stores");
}

/**
 * Averaged across every radar: one dead set among two leaves 0.5, so a single hit never closes the
 * base's warning.
 */
export function radarWarning(list: Facility[]): number {
  return meanHealth(list, "radar");
}

/** A seaplane needs its area to launch and stores fuel to fly, so both kinds are averaged. */
export function seaplaneCapability(list: Facility[]): number {
  return meanHealth(list, "seaplane", "stores");
}

/** A damaged radio delays the report: exactly 1 while whole, rising as its health falls. */
export function radioDelivery(list: Facility[]): number {
  return 1 / clamp(meanHealth(list, "radio"), RADIO_FLOOR, 1);
}

/** The Open Pacific failure gate: land-based and seaplane aviation are both spent. */
export function baseAviationLost(list: Facility[]): boolean {
  return airstripCapability(list) <= LOST_EPSILON && seaplaneCapability(list) <= LOST_EPSILON;
}

/** Observed health by facility id, as last reported. */
export type ObservedSnapshot = Record<string, number>;

/**
 * What the attacker believes the base can still do, from the last report rather than the truth: a
 * commander decides on what was reported, so this never reads a facility's current health.
 */
export function observedCapability(list: Facility[], lastObserved: ObservedSnapshot): number {
  const seen: Facility[] = list.map((f) => ({ ...f, health: lastObserved[f.id] ?? 0 }));
  return (airstripCapability(seen) + seaplaneCapability(seen)) / 2;
}
