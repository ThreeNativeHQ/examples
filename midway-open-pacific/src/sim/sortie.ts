/**
 * One sortie's assignment and its progress. Pure game-owned state: `Battle` owns every mutation,
 * while the HUD, the map orders and the debrief all read this same record. Deliberately not a
 * mission schema — three assignments, one objective, one frozen result.
 */
type Any = any;

export type Assignment = "strike" | "recon" | "operation";
export type Objective = "pending" | "achieved" | "unavailable";
export type Outcome = "recovered" | "incomplete" | "lost";

/** A hit is confirmed by a visual contact no older than this at impact. */
export const CONFIRM_WINDOW = 3;

export const ASSIGNMENTS: Record<Assignment, { name: string; brief: string }> = Object.freeze({
  strike: {
    name: "CARRIER STRIKE",
    brief: "Designate a known enemy carrier, land one bomb or armed torpedo hit, and recover alive.",
  },
  recon: {
    name: "SCOUT AND REPORT",
    brief: "Find one enemy carrier, transmit the contact with R, and recover alive.",
  },
  operation: {
    name: "OPEN PACIFIC",
    brief: "Neutralize all four enemy flight decks, then recover to complete the operation.",
  },
});

/** Snapshot taken at weapon release. A later recall or retask cannot revoke or grant its credit. */
export interface IStamp {
  sortie: number;
  target: string | null;
  ordered: boolean;
}

/** A qualifying hit whose target was not observed at impact, still waiting for a fresh report. */
export interface IPending {
  target: string;
  time: number;
  weapon: string;
  ordered: boolean;
}

export interface IResult {
  assignment: Assignment;
  outcome: Outcome;
  objective: boolean;
  elapsed: number;
  personalHits: number;
  wingHits: number;
  nearMisses: number;
  reportedCarriers: number;
  fuel: number;
  hp: number;
  damage: string[];
  carrier: string;
}

export interface ISortie {
  assignment: Assignment;
  /** Increments per sortie so a stamp from a previous sortie can never score in this one. */
  id: number;
  startTime: number;
  target: string | null;
  objective: Objective;
  pending: IPending[];
  personalHits: number;
  wingHits: number;
  reportedCarriers: number;
  result: IResult | null;
}

export function newSortie(assignment: Assignment = "strike", time = 0, id = 1): ISortie {
  return {
    assignment,
    id,
    startTime: time,
    target: null,
    objective: "pending",
    pending: [],
    personalHits: 0,
    wingHits: 0,
    reportedCarriers: 0,
    result: null,
  };
}

/** The short assignments end at the first successful recovery; Open Pacific keeps its own rules. */
export function isShort(s: ISortie): boolean {
  return s.assignment !== "operation";
}

export function stamp(s: ISortie, target: string | null, ordered: boolean): IStamp {
  return { sortie: s.id, target, ordered };
}

/**
 * Does a resolved hit count toward the strike assignment? Only a direct hit, only from this
 * sortie's own weapon, only on the carrier that weapon was released against. Strafing and splash
 * never satisfy the assignment, and an unarmed torpedo is not a hit.
 */
export function hitQualifies(
  s: ISortie,
  mark: IStamp | null,
  ship: Any,
  weapon: string,
  nearMiss: boolean,
): boolean {
  if (s.assignment !== "strike" || s.objective !== "pending") return false;
  if (!mark || mark.sortie !== s.id || nearMiss) return false;
  if (weapon !== "bomb" && weapon !== "torpedo") return false;
  if (!ship || ship.kind !== "carrier" || ship.team === "us") return false;
  return mark.target === ship.id;
}

/**
 * Record a qualifying hit. It advances the objective immediately when the target was actually seen
 * at impact; otherwise it waits, because the simulation knowing a deck is burning is not the crew
 * having observed it.
 */
export function recordObjectiveHit(
  s: ISortie,
  ship: Any,
  weapon: string,
  ordered: boolean,
  contact: Any,
  time: number,
): void {
  if (ordered) s.wingHits += 1;
  else s.personalHits += 1;
  if (contact && time - contact.time <= CONFIRM_WINDOW) s.objective = "achieved";
  else s.pending.push({ target: ship.id, time, weapon, ordered });
}

/**
 * A later observed or reconnaissance report dated at or after an impact confirms it. Stale reports
 * predating the hit never do.
 */
export function confirmPending(s: ISortie, contactFor: (id: string) => Any): void {
  if (s.objective !== "pending" || !s.pending.length) return;
  for (const hit of s.pending) {
    const contact = contactFor(hit.target);
    if (contact && contact.time >= hit.time) {
      s.objective = "achieved";
      s.pending = [];
      return;
    }
  }
}

/** One line of assignment status for the mission panel and the map. */
export function objectiveText(s: ISortie): string {
  if (s.assignment === "operation") return "Neutralize all four enemy flight decks.";
  if (s.objective === "achieved") return "Objective complete — recover aboard a friendly carrier.";
  if (s.objective === "unavailable") return "No eligible target remains. Return and report.";
  if (s.assignment === "recon") return "Transmit one fresh carrier contact with R.";
  if (s.pending.length) return "Hit recorded — confirmation pending. Observe the target or await a report.";
  return s.target ? "Strike the designated carrier." : "Designate a known enemy carrier with TAB.";
}

export function outcomeText(r: IResult): string {
  if (r.outcome === "lost") return r.objective ? "Objective achieved — aircraft lost" : "Aircraft lost";
  return r.objective ? "Objective achieved — recovered" : "Returned — objective incomplete";
}
