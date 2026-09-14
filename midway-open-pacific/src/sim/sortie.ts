/**
 * One sortie's assignment and its progress. Pure game-owned state: `Battle` owns every mutation,
 * while the HUD, the map orders and the debrief all read this same record. Deliberately not a
 * mission schema — three assignments, one objective, one frozen result.
 */
import { baseAviationLost } from "./facilities.js";
import { estimatePosition } from "./intel.js";

type Any = any;

export type Assignment = "strike" | "recon" | "operation" | "surface" | "support";
export type Objective = "pending" | "achieved" | "unavailable";
export type Outcome = "recovered" | "incomplete" | "lost";

/**
 * Where Open Pacific stands. `running` is not failure: it is the world still offering choices,
 * including a base air arm too broken to win with. Only `success` and `defeat` are terminal.
 */
export type OperationState = "running" | "success" | "defeat";

/** The declared radius from the operation origin beyond which a fleet has left the area. */
export const OPERATION_BOUNDARY = 24000;
/** A carrier deck below this cannot launch. Mirrors Battle's own gate; the pure test cannot import Battle. */
export const OPERATION_LAUNCH_DECK = 0.35;
/** A deck at or below this cannot recover. Mirrors Battle's separate recovery gate. */
export const OPERATION_RECOVERY_DECK = 0.25;

/** Hull classes a sortie can be pointed at. A submerged boat is not one of them; see `targetEligible`. */
export type TargetKind = "carrier" | "cruiser" | "destroyer" | "sub";

/** The one fleet-support duty being flown. Offered only when `feasibleSupportDuties` says it exists. */
export type SupportDuty = "scout-cover" | "air-defence" | "sub-report" | "rescue-cover";

/** What a designation is worth right now. Never a silent substitution: the caller is told which. */
export type Designation = "eligible" | "retask" | "unavailable";

/**
 * The single target contract. Map selection, target cycling, wing orders, tactical validation and
 * debrief eligibility all speak this pair and route through `targetEligible`, so the five consumers
 * cannot disagree about what is a legal target.
 */
export interface ITarget {
  kind: TargetKind;
  id: string;
}

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
  surface: {
    name: "SURFACE STRIKE",
    brief: "Designate a known cruiser, destroyer or surfaced submarine, land one hit on that hull, and recover alive.",
  },
  support: {
    name: "FLEET SUPPORT",
    brief: "Fly one duty the fleet actually needs, take part in it yourself, and recover alive.",
  },
});

/** One line of orders per duty, for the briefing and the mission panel. */
export const SUPPORT_DUTIES: Record<SupportDuty, string> = Object.freeze({
  "scout-cover": "Cover the scout until its contact is transmitted.",
  "air-defence": "Break up the incoming strike before it reaches the task force.",
  "sub-report": "Sight the enemy boat and pass the contact to the escort.",
  "rescue-cover": "Hold cover over the rescue area until the survivors are aboard.",
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
  /** Open Pacific only: the operation state frozen alongside this record, if it concluded one. */
  operation?: OperationState;
  /** Plain-language operation reason, set only with `operation`. */
  reason?: string;
}

export interface ISortie {
  assignment: Assignment;
  /** Increments per sortie so a stamp from a previous sortie can never score in this one. */
  id: number;
  startTime: number;
  target: string | null;
  /** Fleet support only: the one duty being flown. Null for every other assignment. */
  duty: SupportDuty | null;
  objective: Objective;
  pending: IPending[];
  personalHits: number;
  wingHits: number;
  reportedCarriers: number;
  result: IResult | null;
}

export function newSortie(
  assignment: Assignment = "strike",
  time = 0,
  id = 1,
  duty: SupportDuty | null = null,
): ISortie {
  return {
    assignment,
    id,
    startTime: time,
    target: null,
    duty: assignment === "support" ? duty : null,
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
 * **The one eligibility rule.** Map selection, target cycling, wing orders, tactical validation and
 * debrief eligibility all call this and nothing else. Carrier strike is carrier-only; a surface
 * strike takes a cruiser, a destroyer or a *surfaced* submarine — a submerged boat is not a target
 * an aircraft may be pointed at. Every other assignment designates nothing.
 */
export function targetEligible(assignment: Assignment, ship: Any): boolean {
  if (!ship || ship.sunk || ship.team === "us") return false;
  if (assignment === "strike") return ship.kind === "carrier";
  if (assignment !== "surface") return false;
  if (ship.kind === "sub") return ship.surfaced === true;
  return ship.kind === "cruiser" || ship.kind === "destroyer";
}

/** The `{ kind, id }` pair for a hull record, so every consumer builds the contract the same way. */
export function targetOf(ship: Any): ITarget | null {
  return ship ? { kind: ship.kind as TargetKind, id: ship.id as string } : null;
}

/** The designated target as the contract pair. The kind is read off the hull, never stored twice. */
export function designatedTarget(s: ISortie, fleet: Any[]): ITarget | null {
  return targetOf(fleet.find((x: Any) => x && x.id === s.target) ?? null);
}

/** Cycling order: exactly the hulls selection accepts, so TAB can never land on an illegal one. */
export function eligibleTargets(assignment: Assignment, fleet: Any[]): ITarget[] {
  const out: ITarget[] = [];
  for (const ship of fleet) if (targetEligible(assignment, ship)) out.push(targetOf(ship)!);
  return out;
}

/**
 * What the current designation is worth. A dead or gone target is reported as `retask` when another
 * legal hull remains and `unavailable` when none does — this function changes nothing, so the
 * objective can never be quietly swapped for a different one behind the crew's back.
 */
export function designationStatus(s: ISortie, fleet: Any[]): Designation {
  const ship = fleet.find((x: Any) => x && x.id === s.target) ?? null;
  if (s.target && targetEligible(s.assignment, ship)) return "eligible";
  return eligibleTargets(s.assignment, fleet).length ? "retask" : "unavailable";
}

/**
 * Does a resolved hit count toward a striking assignment? Only a direct hit, only from this
 * sortie's own weapon, only on the hull that weapon was released against, and only on a hull the
 * assignment is allowed to attack. Strafing and splash never satisfy the assignment, and an unarmed
 * torpedo is not a hit. A retask cannot make a weapon stamped for an earlier sortie count here.
 */
export function hitQualifies(
  s: ISortie,
  mark: IStamp | null,
  ship: Any,
  weapon: string,
  nearMiss: boolean,
): boolean {
  if (s.assignment !== "strike" && s.assignment !== "surface") return false;
  if (s.objective !== "pending") return false;
  if (!mark || mark.sortie !== s.id || nearMiss) return false;
  if (weapon !== "bomb" && weapon !== "torpedo") return false;
  if (!targetEligible(s.assignment, ship)) return false;
  return mark.target === ship.id;
}

/**
 * Advance the objective on a qualifying hit. It completes immediately when the target was actually
 * seen at impact; otherwise the hit waits, because the simulation knowing a deck is burning is not
 * the crew having observed it. Contribution counters are kept separately, by `Battle`, so a second
 * hit still shows up in the debrief after the assignment is already satisfied.
 */
export function recordObjectiveHit(
  s: ISortie,
  ship: Any,
  weapon: string,
  ordered: boolean,
  contact: Any,
  time: number,
): void {
  if (s.objective !== "pending") return;
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

/**
 * A named fleet-support event, appended by `Battle` when the world actually produced it: the scout's
 * contact transmitted, a friendly recovery completed under cover, the reported contact received by
 * the tasked escort, the survivors aboard. `byPlayer` is set only by the player's own action at the
 * moment it happens — the same release-stamp discipline as a weapon.
 */
export interface ISupportEvent {
  duty: SupportDuty;
  time: number;
  /** The sortie that was being flown when this happened. */
  sortie: number;
  /** True only when the player did it. Being nearby never sets this. */
  byPlayer: boolean;
}

/**
 * Did the player take part? The arithmetic is only over events this sortie stamped `byPlayer`, and
 * there is deliberately **no distance, no proximity and no bystander term anywhere in it**: waiting
 * near an autonomous success contributes nothing, because nothing the player did was recorded.
 */
export function participationEarned(s: ISortie, events: ISupportEvent[]): boolean {
  if (s.assignment !== "support" || !s.duty) return false;
  for (const e of events) if (e.duty === s.duty && e.sortie === s.id && e.byPlayer) return true;
  return false;
}

/**
 * Is the assignment satisfied? The striking and scouting assignments read the objective state that
 * `recordObjectiveHit` and `confirmPending` maintain, so an unobserved hit completes nothing here
 * either — it is still `pending` until a report dated at or after the impact arrives. Fleet support
 * needs both halves: the named event must have actually happened, and the player must have taken
 * part in it.
 */
export function assignmentComplete(s: ISortie, events: ISupportEvent[], now: number): boolean {
  if (s.assignment !== "support") return s.objective === "achieved";
  if (!s.duty) return false;
  const happened = events.some((e) => e.duty === s.duty && e.time <= now);
  return happened && participationEarned(s, events);
}

/** The plain battle records `feasibleSupportDuties` reads. Contacts are the values of Battle's map. */
export interface ISupportWorld {
  ships?: Any[];
  aircraft?: Any[];
  contacts?: Any[];
  survivors?: Any[];
}

/**
 * The duties that are genuinely available right now, so the briefing cannot offer one that does not
 * exist. Each test names a real record: something to protect, something to shoot at, a boat nobody
 * has current information on, someone in the water.
 */
export function feasibleSupportDuties(world: ISupportWorld, now: number): SupportDuty[] {
  const ships = world.ships ?? [];
  const aircraft = world.aircraft ?? [];
  const contacts = world.contacts ?? [];
  const fresh = (id: string) => contacts.some((c: Any) => c && c.id === id && now - c.time <= CONFIRM_WINDOW);
  const out: SupportDuty[] = [];
  if (aircraft.some((a: Any) => a && !a.dead && a.team === "us" && a.kind === "recon")) out.push("scout-cover");
  if (
    aircraft.some((a: Any) => a && !a.dead && a.team === "jp") ||
    ships.some((s: Any) => s && !s.sunk && s.team === "jp" && s.kind === "carrier" && s.deck > 0)
  )
    out.push("air-defence");
  if (ships.some((s: Any) => s && !s.sunk && s.team === "jp" && s.kind === "sub" && !fresh(s.id))) out.push("sub-report");
  if ((world.survivors ?? []).some((v: Any) => v && !v.rescued)) out.push("rescue-cover");
  return out;
}

/** One line of assignment status for the mission panel and the map. */
export function objectiveText(s: ISortie): string {
  if (s.assignment === "operation") return "Neutralize all four enemy flight decks.";
  if (s.objective === "achieved") return "Objective complete — recover aboard a friendly carrier.";
  if (s.objective === "unavailable") return "No eligible target remains. Return and report.";
  if (s.assignment === "recon") return "Transmit one fresh carrier contact with R.";
  if (s.assignment === "support") return s.duty ? SUPPORT_DUTIES[s.duty] : "No support duty assigned.";
  if (s.pending.length) return "Hit recorded — confirmation pending. Observe the target or await a report.";
  if (s.assignment === "surface")
    return s.target ? "Strike the designated ship." : "Designate a known cruiser, destroyer or surfaced boat with TAB.";
  return s.target ? "Strike the designated carrier." : "Designate a known enemy carrier with TAB.";
}

export function outcomeText(r: IResult): string {
  if (r.operation === "success") return "Open Pacific — enemy offensive ended";
  if (r.operation === "defeat") return "Open Pacific — operation failed";
  if (r.operation === "running") return "Returned — operation incomplete";
  if (r.outcome === "lost") return r.objective ? "Objective achieved — aircraft lost" : "Aircraft lost";
  return r.objective ? "Objective achieved — recovered" : "Returned — objective incomplete";
}

/** The plain records the Open Pacific end conditions read. Contacts are the friendly fleet's own. */
export interface IOperationWorld {
  ships?: Any[];
  aircraft?: Any[];
  facilities?: Any[];
  survivors?: Any[];
  contacts?: Any[];
  /** True once the player's own aircraft is lost; `Battle` passes its own lost status in. */
  playerLost?: boolean;
  /** Override for the declared boundary, in metres from the world origin. */
  boundary?: number;
}

export interface IOperationOutcome {
  state: OperationState;
  reason: string;
}

/** One still-selectable continuation: people to pick up, or a hull the fleet knows is afloat. */
export interface IOpportunity {
  kind: "salvage" | "pursuit";
  id: string;
}

/**
 * Has the enemy been observed leaving? The friendly fleet's delivered reports are the only input:
 * a withdrawal nobody filed a report of is not a withdrawal, whatever the ships are secretly doing.
 * Reading the enemy hull's own position or sunk flag would let hidden world state end the operation.
 */
function observedWithdrawal(world: IOperationWorld, now: number): boolean {
  const boundary = world.boundary ?? OPERATION_BOUNDARY;
  for (const c of world.contacts ?? []) {
    if (!c || c.team !== "us" || !(c.deliveredAt <= now)) continue;
    const p = estimatePosition(c, now);
    if (Math.hypot(p.x, p.z) > boundary) return true;
  }
  return false;
}

/** Midway keeps an air arm while either her airstrip or her seaplane area can still work. */
function baseAviationPreserved(world: IOperationWorld): boolean {
  const facilities = world.facilities ?? [];
  // A caller that does not model the atoll is not reporting a loss, so the gate stays open.
  return facilities.length === 0 ? true : !baseAviationLost(facilities);
}

/**
 * The Open Pacific end conditions. Success needs all four: the enemy carrier offensive ended (no
 * launch-capable deck, or an observed withdrawal), current incoming threats resolved, a usable
 * friendly recovery deck, and Midway's aviation preserved. Defeat is the player lost or every
 * friendly carrier sunk. Any other shortfall leaves the operation running — a lost base air arm
 * can no longer win, but it has not lost the fleet, so it is not a defeat either.
 */
export function operationOutcome(world: IOperationWorld, now: number): IOperationOutcome {
  const ships = world.ships ?? [];
  const carriers = ships.filter((s: Any) => s && s.kind === "carrier");
  const friendly = carriers.filter((s: Any) => s.team === "us" && !s.sunk);

  if (world.playerLost) return { state: "defeat", reason: "The player aircraft was lost." };
  if (carriers.some((s: Any) => s.team === "us") && friendly.length === 0) {
    return { state: "defeat", reason: "All friendly carriers are sunk." };
  }

  const launchCapable = ships.some(
    (s: Any) => s && s.team === "jp" && s.kind === "carrier" && !s.sunk && (s.deck ?? 1) >= OPERATION_LAUNCH_DECK,
  );
  const offensiveEnded = !launchCapable || observedWithdrawal(world, now);
  const threatsResolved = !(world.aircraft ?? []).some(
    (a: Any) => a && a.team === "jp" && !a.dead && (a.hp ?? 1) > 0,
  );
  const recoveryDeck = friendly.some((s: Any) => (s.deck ?? 0) > OPERATION_RECOVERY_DECK);
  const baseAviation = baseAviationPreserved(world);

  if (offensiveEnded && threatsResolved && recoveryDeck && baseAviation) {
    return {
      state: "success",
      reason: "Enemy offensive ended, threats resolved, a recovery deck is ready and Midway's air arm is preserved.",
    };
  }
  const reasons: string[] = [];
  if (!offensiveEnded) reasons.push("an enemy deck can still launch");
  if (!threatsResolved) reasons.push("enemy aircraft are still airborne");
  if (!recoveryDeck) reasons.push("no friendly deck can recover aircraft");
  if (!baseAviation) reasons.push("Midway's aviation has been lost");
  return { state: "running", reason: reasons.join("; ") };
}

/**
 * What the operation may still continue for. Concluding is the crew's choice, so this list never
 * drains to force an ending: people still in the water are salvage work, and an enemy hull the
 * fleet has a delivered report on is a pursuit. A hull nobody reported is never chased on hidden
 * knowledge, which is the same fog-of-war rule the withdrawal inference follows.
 */
export function pendingOpportunities(world: IOperationWorld, now: number): IOpportunity[] {
  const out: IOpportunity[] = [];
  for (const v of world.survivors ?? []) {
    if (v && !v.rescued) out.push({ kind: "salvage", id: v.id });
  }
  const known = new Set<string>();
  for (const c of world.contacts ?? []) {
    if (c && c.team === "us" && c.deliveredAt <= now) known.add(c.targetId);
  }
  for (const s of world.ships ?? []) {
    if (s && s.team === "jp" && !s.sunk && known.has(s.id)) out.push({ kind: "pursuit", id: s.id });
  }
  return out;
}

/**
 * Freeze Open Pacific's one result record. A short assignment that already completed keeps its own
 * honest after-action report: the wider operation's outcome never rewrites a sortie flown and
 * reported on its own terms. Calling again is idempotent, so exactly one record is ever frozen.
 */
export function concludeOperation(s: ISortie, outcome: IOperationOutcome, now: number): IResult {
  if (s.result) return s.result;
  const objective = outcome.state === "success";
  s.result = {
    assignment: s.assignment,
    outcome: outcome.state === "defeat" ? "lost" : objective ? "recovered" : "incomplete",
    objective,
    elapsed: Math.max(0, now - s.startTime),
    personalHits: s.personalHits,
    wingHits: s.wingHits,
    nearMisses: 0,
    reportedCarriers: s.reportedCarriers,
    // An operation conclusion is not the pilot's own report, so the airframe figures only the last
    // flight could have supplied stay at zero.
    fuel: 0,
    hp: 0,
    damage: [],
    carrier: "",
    operation: outcome.state,
    reason: outcome.reason,
  };
  return s.result;
}
