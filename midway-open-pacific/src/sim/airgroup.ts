/**
 * The strike package between a carrier's inventory and the group's intent. `carrier-ops.ts` owns the
 * deck and stores; `agenda.ts` owns why the group strikes; this module owns what actually launches
 * and how its escorts behave once airborne. Pure records and functions — `Battle` owns every
 * mutation.
 *
 * Nothing here reads a ship or contact's true state. A package is built from a delivered belief and
 * what is genuinely ready, so a hidden name or damage state cannot change a composition or a reason.
 */
import { STALE_SECONDS } from "./intel.js";

export type PackagePhase = "forming" | "outbound" | "attacking" | "withdrawing" | "returning";

export interface StrikePackage {
  id: string;
  groupId: string;
  targetContactId: string;
  /** Strike aircraft: torpedo bombers or level/dive bombers, depending on the airframe. */
  strikers: number;
  /** Fighters assigned to protect the strikers. */
  escorts: number;
  /** Battle.time the launch order was issued; while `forming`, this is when assembly began. */
  launchedAt: number;
  phase: PackagePhase;
}

/** A delivered contact belief. Only its identity enters a package; its truth never does. */
export interface IStrikeBelief {
  id: string;
}

/** What a group has ready to fly now, independent of any target. */
export interface IStrikeAvailable {
  groupId: string;
  /** Ready strike aircraft. */
  strikers: number;
  /** Ready fighters; the pool escorts and CAP are drawn from. */
  escorts: number;
  /** Battle.time the readiness was read, so the package's form-up clock starts then. */
  at: number;
}

/** How hard a group escorts and how small a package it will risk. */
export interface IStrikeDoctrine {
  /** Fewer ready strikers than this is not worth the aircraft: the package stands down. */
  minStrikers: number;
  /** Escorts wanted per striker, rounded up. */
  escortPerStriker: number;
  /** A package with fewer escorts than this does not launch while fighters are still wanted. */
  minEscorts: number;
  /** No single package may take more fighters than this. */
  maxEscorts: number;
}

/**
 * How many strikers and escorts to send. Returns null when the package would be too weak to be worth
 * the aircraft: fewer ready strikers than the doctrine floor, or fewer escorts than its floor. At or
 * above the floor it sends every ready striker, with escorts at the doctrine ratio rounded up, never
 * more than `maxEscorts` and never more than exist. Escorts are capped before the floor is checked,
 * so a group short of fighters stands the package down rather than launching it unescorted.
 */
export function composePackage(
  available: IStrikeAvailable,
  contact: IStrikeBelief | null,
  doctrine: IStrikeDoctrine,
): StrikePackage | null {
  if (!contact) return null;
  if (available.strikers < doctrine.minStrikers) return null;
  const wanted = Math.max(doctrine.minEscorts, Math.ceil(available.strikers * doctrine.escortPerStriker));
  const escorts = Math.min(available.escorts, doctrine.maxEscorts, wanted);
  if (escorts < doctrine.minEscorts) return null;
  return {
    id: `pkg-${available.groupId}-${contact.id}`,
    groupId: available.groupId,
    targetContactId: contact.id,
    strikers: available.strikers,
    escorts,
    launchedAt: available.at,
    phase: "forming",
  };
}

/** What has actually reached the assembly point, as opposed to what was ordered. */
export interface IAssembled {
  formed: number;
  escorts: number;
}

export interface IAssembleLimits {
  /** Fewer formed strikers than this and the package cannot go. */
  minStrikers: number;
  /** The escort floor used while waiting. */
  minEscorts: number;
  /** Seconds after the launch order that the package stops waiting. */
  maxWait: number;
}

/**
 * Should the package go? A torpedo strike assembles with its escort, but a package must not hold
 * over a moving target forever. It launches as soon as the striker and escort floors are met. Until
 * the deadline it waits for stragglers; at the deadline it goes with the escorts on hand, or stands
 * down if the strikers never formed. Either way it never waits past `maxWait`.
 */
export function assemble(
  pkg: StrikePackage,
  aircraft: IAssembled,
  now: number,
  limits: IAssembleLimits,
): boolean {
  if (pkg.phase !== "forming") return true;
  if (aircraft.formed >= limits.minStrikers && aircraft.escorts >= limits.minEscorts) return true;
  if (now - pkg.launchedAt < limits.maxWait) return false;
  return aircraft.formed >= limits.minStrikers;
}

/** An escort section as this decision reads it: identity and whether command has detached it. */
export interface IEscort {
  id: string;
  /** Command has ordered this section away from the package. */
  detached?: boolean;
}

export interface IEscortDecision {
  stay: boolean;
  reason: string;
}

/** Below this fraction of fuel an escort can no longer hold station over a strike. */
export const ESCORT_FUEL_RESERVE = 0.2;

/**
 * Does an escort stay with its strike? Yes unless something justifies separation, and every separation
 * carries a readable reason: a detached order, a local threat the fighters must answer, or fuel too
 * low to keep station. A `null` package is itself the reason not to stay.
 */
export function escortDecision(
  escort: IEscort,
  pkg: StrikePackage | null,
  localThreat: boolean,
  fuel: number,
): IEscortDecision {
  if (!pkg) return { stay: false, reason: "no package" };
  if (escort.detached === true) return { stay: false, reason: "detached by order" };
  if (localThreat) return { stay: false, reason: "local threat" };
  if (fuel <= ESCORT_FUEL_RESERVE) return { stay: false, reason: "low fuel" };
  return { stay: true, reason: "escort with package" };
}

export interface IAbortDecision {
  abort: boolean;
  reason: string;
}

/** At or below this fraction the strike lacks the fuel to press an approach and return. */
export const ABORT_FUEL = 0.15;
/** At or above this threat level the approach is not flyable, whatever the contact age. */
export const ABORT_THREAT = 0.75;

/**
 * Should the package abort its approach? Torpedo bombers abort an unusable approach or inadequate
 * fuel, and a contact old enough to dead-reckon onto empty sea is itself reason to break off. Returns
 * null while the approach is still flyable, so a caller can treat null as "continue"; once the
 * package is withdrawing or returning the decision is already made and stays null.
 */
export function abortCriteria(
  pkg: StrikePackage,
  fuel: number,
  contactAge: number,
  threat: number,
): IAbortDecision | null {
  if (pkg.phase === "withdrawing" || pkg.phase === "returning") return null;
  if (fuel <= ABORT_FUEL) return { abort: true, reason: "inadequate fuel" };
  if (contactAge > STALE_SECONDS) return { abort: true, reason: "stale contact" };
  if (threat >= ABORT_THREAT) return { abort: true, reason: "unusable approach" };
  return null;
}

export type KateLoadout = "torpedo" | "bomb";

/** What a Kate is being sent against. Only an identified ship can justify a torpedo. */
export interface IKateTarget {
  kind: "island" | "ship" | "unknown";
  /** A ship whose class and identity have been established by observation. */
  identified: boolean;
}

export interface IOrdnanceStores {
  torpedo: number;
  bomb: number;
}

/**
 * The Kate's loadout, chosen before launch and re-armed only when the stores are actually aboard.
 * An island is bombed; an identified ship may justify torpedoes once a real rearm has put them in
 * the rack. A Kate never flies a Val-style dive attack: it always returns a level-bombing or
 * torpedo loadout, or null when the stores are not there.
 */
export function kateLoadout(target: IKateTarget, stores: IOrdnanceStores): KateLoadout | null {
  if (target.kind !== "island" && target.identified && stores.torpedo > 0) return "torpedo";
  if (stores.bomb > 0) return "bomb";
  return null;
}
