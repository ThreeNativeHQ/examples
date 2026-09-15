/**
 * Rescue and alongside damage-control as pure records and functions. `Battle` owns every mutation:
 * it reads the returned rescue state, survivor counts and assistance benefit and writes them onto
 * its own ships. Nothing here touches Three.js, the DOM or a browser global, and no draw is seeded:
 * exposure and pumping are continuous, so a later rescue genuinely saves fewer people.
 */
import { clamp } from "./math.js";
import type { ShipDamage } from "./damage.js";
import type { ISurvivorGroup } from "./naval.js";

type Any = any;

/** A boatload in the water. Extends the surface group `naval.ts` already diverts an escort to. */
export interface Survivors extends ISurvivorGroup {
  /** The hull they abandoned, so rescue credit has a source and a report can name it. */
  fromShipId: string;
}

export type RescuePhase = "approaching" | "recovering" | "done" | "aborted";

/**
 * A rescuing ship's own progress. `recovered` is cumulative people taken aboard, so the debrief
 * reads what the ship actually saved rather than what the sea happened to hold.
 */
export interface RescueState {
  targetId: string;
  phase: RescuePhase;
  startedAt: number;
  recovered: number;
}

export interface IRescueShip {
  x: number;
  z: number;
  /** Metres per second. A boat cannot come alongside a survivor group still under way. */
  speed: number;
}

export interface RescueLimits {
  /** Boats recover only inside this radius, metres. */
  pickupRange: number;
  /** Above this speed the ship cannot hold station long enough to take anyone aboard. */
  maxRecoverySpeed: number;
  /** People per second once in position. */
  rate: number;
  /** Per-capita hazard the water imposes, per second. */
  exposureRate: number;
}

export const DEFAULT_RESCUE_LIMITS: Readonly<RescueLimits> = Object.freeze({
  pickupRange: 60,
  maxRecoverySpeed: 1.5,
  rate: 2,
  exposureRate: 0.01,
});

export interface IRescueStep {
  state: RescueState;
  survivors: Survivors[];
}

/**
 * One step of a rescue. Exposure is continuous and applies to every group whether or not the ship
 * is in position, so waiting costs lives: the same group reached later yields fewer aboard. A ship
 * takes people on only when it is both inside `pickupRange` and at or below `maxRecoverySpeed`.
 * Inputs are never mutated; the caller replaces its records with the returned ones.
 */
export function stepRescue(
  state: RescueState,
  ship: IRescueShip,
  survivors: Survivors[],
  dt: number,
  limits: RescueLimits,
): IRescueStep {
  const decayed: Survivors[] = survivors.map((s) => ({
    ...s,
    count: s.count * Math.exp(-limits.exposureRate * Math.max(0, dt)),
  }));
  if (state.phase === "done" || state.phase === "aborted" || !(dt > 0)) {
    return { state: { ...state }, survivors: decayed };
  }
  const index = decayed.findIndex((s) => s.id === state.targetId);
  if (index < 0 || decayed[index].count <= 0) {
    return { state: { ...state, phase: "done" }, survivors: decayed };
  }
  const group = decayed[index];
  const close = Math.hypot(group.x - ship.x, group.z - ship.z) <= limits.pickupRange;
  const slow = ship.speed <= limits.maxRecoverySpeed;
  if (!close || !slow) {
    return { state: { ...state, phase: "approaching" }, survivors: decayed };
  }
  const take = Math.min(limits.rate * dt, group.count);
  decayed[index] = { ...group, count: group.count - take };
  return {
    state: {
      ...state,
      phase: decayed[index].count > 0 ? "recovering" : "done",
      recovered: state.recovered + take,
    },
    survivors: decayed,
  };
}

export type AssistPhase = "approaching" | "alongside" | "done" | "aborted";

/**
 * A destroyer's alongside operation on a damaged carrier. It carries no benefit itself: the
 * damage-control effect lives in `assistBenefit`, so a caller cannot mistake the record for the
 * result.
 */
export interface AssistState {
  carrierId: string;
  phase: AssistPhase;
  startedAt: number;
}

export interface IAssistEscort {
  id: string;
  /** Set by the fleet when a higher-priority task already owns this escort. */
  neededElsewhere?: boolean;
  /** Fraction of the carrier's flooding and fire rates this escort's pumps can offset. */
  assistFactor?: number;
  /** Fraction of the screen this ship contributes on station; alongside gives all of it up. */
  screenCoverage?: number;
}

export interface IAssistCarrier {
  id: string;
  /** The hull's own damage record, the same shape `damage.ts` steps for ships. */
  damage: ShipDamage;
  sunk?: boolean;
}

export interface IThreat {
  /** Only a running torpedo aborts an alongside; other kinds are ignored here. */
  kind: string;
  team: string;
  x: number;
  z: number;
}

export interface IAssistCheck {
  ok: boolean;
  reason: string;
}

/**
 * The one alongside gate. A detected torpedo threat aborts it: a destroyer tied to a carrier's
 * flank cannot comb a track, so the PRD's "abort on a detected torpedo threat" is checked first.
 * An escort the screen still needs, a carrier already lost, and a carrier with nothing burning or
 * flooding are the other refusals. Read-only, so a refused alongside has changed nothing.
 */
export function canAssist(
  escort: IAssistEscort,
  carrier: IAssistCarrier,
  threats: IThreat[],
): IAssistCheck {
  if (threats.some((t) => t.kind === "torpedo")) {
    return { ok: false, reason: "torpedo threat detected" };
  }
  if (escort.neededElsewhere === true) {
    return { ok: false, reason: "escort needed elsewhere" };
  }
  if (!carrier.damage || carrier.sunk === true || carrier.damage.hull >= 1) {
    return { ok: false, reason: "carrier beyond assistance" };
  }
  if (carrier.damage.flooding <= 0 && carrier.damage.fire <= 0) {
    return { ok: false, reason: "no damage to fight" };
  }
  return { ok: true, reason: "" };
}

/** Fraction of a flooding or fire rate a default destroyer's damage-control party offsets. */
export const ASSIST_FACTOR = 0.6;

/**
 * What the escort's pumps and hoses are worth over `dt` seconds alongside: the flooding and fire
 * severity it keeps the carrier from taking on. It is a quantity, not a flag, so stepping the
 * carrier with and without assistance over the same elapsed time gives different numbers. A
 * carrier that is sunk or has no active flooding or fire yields zero, because there is nothing to
 * offset. The caller invokes this only while the escort is actually alongside.
 */
export function assistBenefit(
  carrier: IAssistCarrier,
  escort: IAssistEscort,
  dt: number,
): { floodingDelta: number; fireDelta: number } {
  if (!carrier.damage || carrier.sunk === true || !(dt > 0)) {
    return { floodingDelta: 0, fireDelta: 0 };
  }
  const factor = clamp(escort.assistFactor ?? ASSIST_FACTOR, 0, 0.95);
  return {
    floodingDelta: clamp(carrier.damage.flooding, 0, 1) * factor * dt,
    fireDelta: clamp(carrier.damage.fireRate, 0, 1) * factor * dt,
  };
}

/**
 * What going alongside costs the escort: it leaves its screen station and, tied to a carrier's
 * flank, loses the freedom to manoeuvre. The coverage figure is the ship's own contribution, so one
 * already detached reports less than a full station.
 */
export function assistCost(escort: IAssistEscort): {
  screenCoverageLost: number;
  manoeuvrable: boolean;
} {
  const contribution =
    typeof escort.screenCoverage === "number" && Number.isFinite(escort.screenCoverage)
      ? clamp(escort.screenCoverage, 0, 1)
      : 1;
  return { screenCoverageLost: contribution, manoeuvrable: false };
}

export interface IDetached {
  reason: string;
  detachedAt: number;
}

/**
 * Leave either activity cleanly, recording why and when. It rewrites only the activity's own
 * record: the carrier's damage, the survivors' positions and the escort's screen station are the
 * caller's state and are never touched here. An activity already `done` stays done; only an active
 * one is aborted.
 */
export function detach<T extends RescueState | AssistState>(
  state: T,
  reason: string,
  now: number,
): T & IDetached {
  const next: Any = {
    ...state,
    phase: state.phase === "done" ? "done" : "aborted",
    reason,
    detachedAt: now,
  };
  return next as T & IDetached;
}
