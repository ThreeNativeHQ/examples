/**
 * What a carrier group intends next, chosen from what it has and what it knows. This is the
 * group-level counterpart to naval.ts's per-ship `chooseTask`: one agenda per division, while every
 * hull still runs its own task. Pure records and functions; `Battle` owns all mutation.
 *
 * No decision here reads a ship's name or the target's true state. Group identity enters only as
 * `groupId` for bookkeeping, so swapping names cannot change an intent, a target or a reason.
 */
import { STALE_SECONDS } from "./intel.js";

export type GroupIntent = "strike" | "search" | "cap" | "recover" | "withdraw" | "hold";

/** A group's standing decision, kept on the group so `chooseAgenda` can honour its commitment. */
export interface GroupAgenda {
  groupId: string;
  intent: GroupIntent;
  targetId: string | null;
  committedAt: number;
  reason: string;
}

/** What the group has to launch with, independent of any target. */
export interface IGroupResources {
  /** Total airframes that could fly now. */
  readyAircraft: number;
  /** Fighters among them: the pool CAP and escorts are drawn from. */
  readyFighters: number;
  /** Usable ordnance, 0..1. */
  stores: number;
  /** Usable fuel, 0..1. */
  fuel: number;
}

/** A carrier group as the agenda reads it: capability and condition, never a name. */
export interface ICarrierGroup extends IGroupResources {
  id: string;
  agenda: GroupAgenda | null;
}

/** One thing the group's knowledge currently offers. */
export interface IGroupOpportunity {
  intent: "strike" | "search";
  targetId: string | null;
  reason: string;
}

/** The picture the group decides from. Each field is a fact, not a preference. */
export interface IGroupSituation {
  /** An immediate threat to the group: evade now, whatever was committed. */
  survival: boolean;
  /** Airborne aircraft with a deck that can take them: bring them home. */
  recovery: boolean;
  /** A local air or surface threat the group's fighters must answer. */
  localDefence: boolean;
  /** The committed task's target or premise still holds. */
  committedFeasible: boolean;
  /** Fresh knowledge that opens a strike or a search. */
  opportunity: IGroupOpportunity | null;
  /** Whether ordinary patrol is possible. */
  patrol: boolean;
}

/** A group keeps a fresh decision at least this long, so it cannot switch every evaluation tick. */
export const COMMIT_SECONDS = 60;

/** A change at or above this magnitude is material; below it is noise. */
export const MATERIAL_THRESHOLD = 0.25;

function make(
  groupId: string,
  intent: GroupIntent,
  targetId: string | null,
  committedAt: number,
  reason: string,
): GroupAgenda {
  return { groupId, intent, targetId, committedAt, reason };
}

/**
 * Which agenda the group should run now. Priority is the PRD's, exactly: immediate survival, then
 * safe recovery and local defence, then the existing committed task, then a new opportunity, then
 * patrol. A held agenda is not displaced by a merely-better opportunity until `COMMIT_SECONDS`
 * lapses; it is displaced at once by survival, recovery or local defence, which outrank it.
 */
export function chooseAgenda(
  group: ICarrierGroup,
  situation: IGroupSituation,
  now: number,
): GroupAgenda {
  if (situation.survival) return make(group.id, "withdraw", null, now, "withdrawal ordered");
  if (situation.recovery) return make(group.id, "recover", null, now, "low fuel");
  if (situation.localDefence) return make(group.id, "cap", null, now, "escort requested");
  const held = group.agenda;
  if (held && (situation.committedFeasible || now - held.committedAt < COMMIT_SECONDS)) {
    return make(group.id, held.intent, held.targetId, held.committedAt, held.reason);
  }
  if (situation.opportunity) {
    const o = situation.opportunity;
    return make(group.id, o.intent, o.targetId, now, o.reason);
  }
  return make(group.id, "hold", null, now, situation.patrol ? "patrol" : "hold");
}

/** The report a strike is judged against: a belief held by the fleet, never the target itself. */
export interface IStrikeContact {
  targetId: string;
  observedAt: number;
  /** Battle.time when the report reached the fleet. */
  deliveredAt: number;
  /** Contact broken; the estimate is only extrapolated. */
  lost: boolean;
}

/**
 * Is a strike worth launching? Only from a delivered, unstale report and only from aircraft, stores
 * and fuel the group actually has. It never receives the target ship, so a name or a hidden damage
 * state cannot make a strike look worthwhile.
 */
export function strikeWorthwhile(
  group: Pick<ICarrierGroup, "id">,
  contact: IStrikeContact | null,
  resources: IGroupResources,
  now: number,
): { worthwhile: boolean; reason: string } {
  if (!contact || now < contact.deliveredAt) return { worthwhile: false, reason: "no delivered contact" };
  if (now - contact.observedAt > STALE_SECONDS) return { worthwhile: false, reason: "stale contact" };
  if (resources.readyAircraft <= 0) return { worthwhile: false, reason: "no ready aircraft" };
  if (resources.stores <= 0) return { worthwhile: false, reason: "no stores" };
  if (resources.fuel <= 0) return { worthwhile: false, reason: "no fuel" };
  return { worthwhile: true, reason: "strike worthwhile" };
}

/**
 * How many fighters stay home on combat air patrol. Escorts leaving with a strike reduce what is
 * left at home, so more escort demand means a smaller CAP. `threats` is the number of stations the
 * group currently feels it must fill; the group never keeps more home than remain after escorts.
 */
export function capCommitment(
  group: Pick<ICarrierGroup, "readyFighters">,
  threats: number,
  escortDemand: number,
): number {
  const wanted = Math.max(0, threats);
  const atHome = Math.max(0, group.readyFighters - Math.max(0, escortDemand));
  return Math.min(atHome, wanted);
}

/** A change in what the group knows or can do. Values are 0..1 magnitudes. */
export interface IAgendaChange {
  /** New damage or losses that change capability. */
  damage: number;
  /** Change in fuel or ordnance. */
  stores: number;
  /** Fresh information that changes the picture. */
  information: number;
  /** New orders; always material. */
  orders: boolean;
}

/**
 * Should the group re-decide before its commitment window lapses? Only a material change justifies
 * breaking a fresh commitment. A lapsed window is itself reason to re-decide, so a small report
 * arriving after `COMMIT_SECONDS` still returns true.
 */
export function reevaluate(agenda: GroupAgenda, change: IAgendaChange, now: number): boolean {
  if (change.orders) return true;
  if (change.damage >= MATERIAL_THRESHOLD) return true;
  if (change.stores >= MATERIAL_THRESHOLD) return true;
  if (change.information >= MATERIAL_THRESHOLD) return true;
  return now - agenda.committedAt >= COMMIT_SECONDS;
}
