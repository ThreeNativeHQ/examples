/**
 * Reports on battle runs. It does not itself require any rare event to occur.
 *
 * AC-21 asks two separate things: which roles a handful of natural seed runs happen to show, and
 * then proof that every remaining role is reachable through a bounded scenario. This module is the
 * tallying half of that proof only. It folds the transitions the simulation modules already produce
 * into one flat count per role, compares two runs that differed by a single intervention, and
 * digests a state trace so "repeating a seed repeats state" is a string equality. It never runs a
 * battle, never assigns a task or AI-transition field, and never treats "this role did not happen in
 * five arbitrary seeds" as failure: a missing role here is a question to answer elsewhere, not a
 * verdict. Pure by construction -- no Three.js, no DOM, no random draws, no mutation of any input.
 */
import type { AswPhase } from "./asw.js";
import type { FacilityKind } from "./facilities.js";
import type { AssistPhase, RescuePhase } from "./rescue.js";
import type { SubMode } from "./submarine.js";
import type { SupportDuty } from "./sortie.js";

/**
 * The observable roles a run can evidence. The four support duties are named by `sortie.ts` itself,
 * so they appear verbatim rather than under a second name.
 */
export const ROLES = [
  "scout-report",
  "contact-delivered",
  "strike-launched",
  "escort-engaged",
  "submarine-attack",
  "depth-charge",
  "rescue-started",
  "alongside-assist",
  "facility-hit",
  "scout-cover",
  "air-defence",
  "sub-report",
  "rescue-cover",
] as const;
export type Role = (typeof ROLES)[number];

/** One flat count per role. A run folds events into this and reports the non-zero ones. */
export type RoleTally = Record<Role, number>;

/** A zeroed tally. Exported so a caller never has to know the role list to start one. */
export function newTally(): RoleTally {
  const tally = {} as RoleTally;
  for (const role of ROLES) tally[role] = 0;
  return tally;
}

/**
 * A transition the run produced, tagged with the vocabulary of the module that owns it: a filed then
 * delivered report from `intel.ts`, Battle's launch role and `tactics.ts`'s tactic names, the hunt,
 * rescue, assist and submarine phases, a facility hit, or a `sortie.ts` support duty. The event
 * carries the module's own fields; `observeRole` is the only place that turns them into a role.
 */
export type BattleEvent =
  | { type: "report"; delivered: boolean }
  | { type: "launch"; role: string }
  | { type: "tactic"; tactic: string }
  | { type: "hunt"; phase: AswPhase; salvoes: number }
  | { type: "submarine"; mode: SubMode; fired: boolean }
  | { type: "rescue"; phase: RescuePhase }
  | { type: "assist"; phase: AssistPhase }
  | { type: "facility"; kind: FacilityKind; damage: number }
  | { type: "support"; duty: SupportDuty };

/**
 * Which role, if any, this event evidences. A torpedo or bomber launch is a strike; a fighter or
 * recon launch is not, because neither is the role being reported. Escort and intercept are the two
 * `tactics.ts` activities that commit a fighter to a fight. A salvo count above zero means charges
 * left the racks. A rescue only counts once people are actually coming aboard ("recovering"), never
 * on "done", which also covers a group that was lost before anyone was reached.
 */
function roleOf(event: BattleEvent): Role | null {
  switch (event.type) {
    case "report":
      return event.delivered ? "contact-delivered" : "scout-report";
    case "launch":
      return event.role === "torpedo" || event.role === "bomber" ? "strike-launched" : null;
    case "tactic":
      return event.tactic === "escort" || event.tactic === "intercept" ? "escort-engaged" : null;
    case "hunt":
      return event.salvoes > 0 ? "depth-charge" : null;
    case "submarine":
      return event.fired ? "submarine-attack" : null;
    case "rescue":
      return event.phase === "recovering" ? "rescue-started" : null;
    case "assist":
      return event.phase === "alongside" ? "alongside-assist" : null;
    case "facility":
      return event.damage > 0 ? "facility-hit" : null;
    case "support":
      // A duty is already a role name; membership check keeps a malformed caller from inventing one.
      return (ROLES as readonly string[]).includes(event.duty) ? (event.duty as Role) : null;
    default:
      return null;
  }
}

/** Fold one event into the tally. At most one role is counted, and the input is never written. */
export function observeRole(tally: RoleTally, event: BattleEvent): RoleTally {
  const role = roleOf(event);
  const next: RoleTally = { ...tally };
  if (role === null) return next;
  next[role] = (next[role] ?? 0) + 1;
  return next;
}

/** The roles the run actually produced, in declaration order. */
export function rolesOccurred(tally: RoleTally): Role[] {
  return ROLES.filter((role) => tally[role] > 0);
}

/**
 * The expected roles this run did not produce, in the order expected. Duplicates in `expected` are
 * reported once. A missing role here is exactly why AC-21 then asks for a bounded reachability case;
 * this function draws no conclusion beyond "not seen".
 */
export function rolesMissing(tally: RoleTally, expected: readonly Role[]): Role[] {
  const missing: Role[] = [];
  for (const role of expected) {
    if (!missing.includes(role) && !(tally[role] > 0)) missing.push(role);
  }
  return missing;
}

export interface IPairedRoles {
  /** Roles whose count differs between the two runs: the intervention moved the outcome. */
  changed: Role[];
  /** Roles identical in both: the intervention did not change that outcome. */
  unchanged: Role[];
}

/**
 * Compare two runs that differed by one intervention. AC-21 requires a paired scout, escort or
 * protection intervention to change its corresponding outcome; this names which roles actually
 * differed, so "the intervention did nothing" is a visible role sitting in `unchanged` rather than
 * something a reader has to eyeball. Counts are compared, not just presence: a strafe that lands
 * twice instead of once is a changed outcome too.
 */
export function pairedComparison(withIntervention: RoleTally, without: RoleTally): IPairedRoles {
  const changed: Role[] = [];
  const unchanged: Role[] = [];
  for (const role of ROLES) {
    if (withIntervention[role] !== without[role]) changed.push(role);
    else unchanged.push(role);
  }
  return { changed, unchanged };
}

/**
 * A canonical form for a state sequence: object keys sorted, numbers printed without a locale, so
 * the same run always serialises byte for byte and a truly unchanged run cannot hash differently
 * because a field was built in a different order. Arrays keep their order, which is the trace.
 */
function canonical(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  const kind = typeof value;
  if (kind === "number") return Object.is(value, -0) ? "0" : String(value);
  if (kind === "string" || kind === "boolean" || kind === "bigint") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (kind === "object") {
    const source = value as Record<string, unknown>;
    return `{${Object.keys(source)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(source[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

/**
 * A stable digest of a run's state sequence, so "repeating a seed and input trace repeats state" is a
 * string equality. FNV-1a is enough for a harness: it is deterministic, dependency-free and changes
 * on a single altered value.
 */
export function traceDigest(states: readonly unknown[]): string {
  const text = canonical(states);
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/** The five named seeds AC-21 runs natural battles for. */
export const SEEDS = [19420604, 19420605, 19420606, 19420607, 19420608] as const;
