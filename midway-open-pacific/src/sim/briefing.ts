/**
 * The briefing's selection layer: which of the five assignment categories the world can actually
 * offer, which hulls a Surface Strike may designate, and the one fleet-support duty that is real.
 * Pure functions over plain battle records, so the briefing, the map selection, target cycling,
 * wing orders and the debrief read one {kind,id} contract and cannot disagree. Nothing here mutates
 * its inputs, and no random draw is made here.
 */
import { STALE_SECONDS } from "./intel.js";
import {
  ASSIGNMENTS,
  SUPPORT_DUTIES,
  feasibleSupportDuties,
  operationOutcome,
  targetEligible,
} from "./sortie.js";
import type { Assignment, SupportDuty, TargetKind } from "./sortie.js";

type Any = any;

/** One briefing category, or one designated surface hull the briefing can present. */
export interface BriefingOption {
  /** The assignment category this option is for. */
  kind: Assignment;
  /** The kind of the designated hull, or null when the category designates nothing. */
  targetKind: TargetKind | null;
  /** The designated hull's id; for fleet support, the duty name. Null when nothing is designated. */
  targetId: string | null;
  label: string;
  detail: string;
  /** False means the category is shown with a reason, never silently dropped. */
  feasible: boolean;
  reason: string;
}

/** The plain battle records this layer reads. Contacts are Battle's map values. */
export interface IBriefingWorld {
  ships?: Any[];
  aircraft?: Any[];
  contacts?: Any[];
  survivors?: Any[];
  facilities?: Any[];
}

/** The contact fields this layer reads. `kind` is the identified hull kind when there is one. */
export interface IBriefingContact {
  id?: string;
  kind?: string;
  classification?: string;
  observedAt?: number;
  time?: number;
  deliveredAt?: number;
  lost?: boolean;
  surfaced?: boolean;
  name?: string;
}

const HULL_WORD: Record<string, string> = {
  carrier: "carrier",
  cruiser: "cruiser",
  destroyer: "destroyer",
  sub: "submarine",
};

/** Delivered to the fleet, fresh enough to designate, and not a broken track. */
function usableContact(c: IBriefingContact | null | undefined, now: number): boolean {
  if (!c || !c.id || c.lost === true) return false;
  if ((c.deliveredAt ?? 0) > now) return false;
  return now - (c.observedAt ?? c.time ?? 0) <= STALE_SECONDS;
}

function contactKind(c: IBriefingContact): TargetKind {
  return (c.kind ?? c.classification ?? "") as TargetKind;
}

function shipOf(world: IBriefingWorld, id: string | null): Any {
  if (!id) return null;
  return (world.ships ?? []).find((s: Any) => s && s.id === id) ?? null;
}

function targetOption(assignment: Assignment, c: IBriefingContact): BriefingOption {
  const targetKind = contactKind(c);
  const word = c.name ?? HULL_WORD[targetKind] ?? targetKind;
  return {
    kind: assignment,
    targetKind,
    targetId: c.id ?? null,
    label: assignment === "strike" ? `${ASSIGNMENTS.strike.name} — ${word}` : `Surface strike — ${word}`,
    detail: ASSIGNMENTS[assignment].brief,
    feasible: true,
    reason: "",
  };
}

/**
 * The delivered, fresh contacts an assignment may designate. When the world models the hull the
 * single validator judges it; a contact whose hull is absent is judged from its identified kind, so
 * the same rule covers a full battle and a plain contact list.
 */
function knownTargets(world: IBriefingWorld, now: number, assignment: Assignment): BriefingOption[] {
  const out: BriefingOption[] = [];
  for (const c of (world.contacts ?? []) as IBriefingContact[]) {
    if (!usableContact(c, now)) continue;
    const ship = shipOf(world, c.id ?? null) ?? {
      kind: contactKind(c),
      team: "jp",
      sunk: false,
      surfaced: c.surfaced,
    };
    if (!targetEligible(assignment, ship)) continue;
    out.push(targetOption(assignment, c));
  }
  return out;
}

/**
 * The known hulls a Surface Strike may designate: a cruiser, a destroyer or a *surfaced* submarine,
 * from delivered, non-stale contacts only. A carrier is excluded because carrier strike remains
 * carrier-only, and a submerged boat is excluded because the one validator will not point an
 * aircraft at one. The caller gets the same pair the map selection and TAB cycling build.
 */
export function surfaceStrikeTargets(contacts: IBriefingContact[], now: number): BriefingOption[] {
  const out: BriefingOption[] = [];
  for (const c of contacts ?? []) {
    if (!usableContact(c, now)) continue;
    if (contactKind(c) === "carrier") continue; // carrier strike stays carrier-only
    if (contactKind(c) === "sub" && c.surfaced !== true) continue; // a submerged boat is no target
    const ship = { kind: contactKind(c), team: "jp", sunk: false, surfaced: c.surfaced };
    if (!targetEligible("surface", ship)) continue;
    out.push(targetOption("surface", c));
  }
  return out;
}

/**
 * The one duty the fleet actually needs right now, or null when none exists. Never invents one: the
 * list comes from `feasibleSupportDuties` over the same battle records and the first is taken in
 * its stated priority. The duty name rides in `targetId` so the {kind,id} contract can carry it.
 */
export function supportDuty(world: IBriefingWorld, now: number): BriefingOption | null {
  const duty: SupportDuty | undefined = feasibleSupportDuties(world, now)[0];
  if (!duty) return null;
  return {
    kind: "support",
    targetKind: null,
    targetId: duty,
    label: ASSIGNMENTS.support.name,
    detail: SUPPORT_DUTIES[duty],
    feasible: true,
    reason: "",
  };
}

function category(
  kind: Assignment,
  target: BriefingOption | null,
  feasible: boolean,
  reason: string,
): BriefingOption {
  return {
    kind,
    targetKind: target?.targetKind ?? null,
    targetId: target?.targetId ?? null,
    label: ASSIGNMENTS[kind].name,
    detail: target?.detail ?? ASSIGNMENTS[kind].brief,
    feasible,
    reason: feasible ? "" : reason,
  };
}

/**
 * Every briefing category, at most five and never a sixth. An unavailable category is returned
 * infeasible *with* its reason, so the briefing shows why instead of dropping it. A target-bearing
 * category carries the first known hull the same validator accepts.
 */
export function offerBriefing(world: IBriefingWorld, now: number): BriefingOption[] {
  const carriers = knownTargets(world, now, "strike");
  const surface = knownTargets(world, now, "surface");
  const carrierAfloat = (world.ships ?? []).some(
    (s: Any) => s && s.kind === "carrier" && s.team !== "us" && !s.sunk,
  );
  const operation = operationOutcome(world, now);
  const support = supportDuty(world, now);
  return [
    category("strike", carriers[0] ?? null, carriers.length > 0, "No current carrier contact."),
    category("recon", null, carrierAfloat, "No enemy carrier remains to scout."),
    category("operation", null, operation.state === "running", operation.reason),
    category(
      "surface",
      surface[0] ?? null,
      surface.length > 0,
      "No current cruiser, destroyer or surfaced submarine contact.",
    ),
    category("support", support, support !== null, "No fleet-support duty is feasible right now."),
  ];
}

/**
 * The one answer to "is this selection still good?", built on `targetEligible` and the same
 * delivered/fresh contact rule the map and the briefing read. Map selection, target cycling, wing
 * orders and debrief eligibility all call it, so they cannot disagree about a legal target.
 */
export function validateSelection(
  option: BriefingOption,
  world: IBriefingWorld,
  now: number,
): { ok: boolean; reason: string } {
  if (option.kind === "recon") {
    const afloat = (world.ships ?? []).some(
      (s: Any) => s && s.kind === "carrier" && s.team !== "us" && !s.sunk,
    );
    return afloat ? { ok: true, reason: "" } : { ok: false, reason: "No enemy carrier remains to scout." };
  }
  if (option.kind === "operation") {
    const outcome = operationOutcome(world, now);
    return outcome.state === "running" ? { ok: true, reason: "" } : { ok: false, reason: outcome.reason };
  }
  if (option.kind === "support") {
    const duty = supportDuty(world, now);
    if (duty && duty.targetId === option.targetId) return { ok: true, reason: "" };
    return {
      ok: false,
      reason: duty ? `The offered duty is now ${duty.targetId}.` : "No fleet-support duty is feasible right now.",
    };
  }
  if (!option.targetId || !option.targetKind) return { ok: false, reason: "No hull is designated." };
  const ship = shipOf(world, option.targetId);
  if (!ship || !targetEligible(option.kind, ship)) {
    return {
      ok: false,
      reason: `Designated ${option.targetKind} ${option.targetId} is no longer an eligible target.`,
    };
  }
  if (!knownTargets(world, now, option.kind).some((o) => o.targetId === option.targetId)) {
    return { ok: false, reason: `No current delivered report on ${option.targetId}.` };
  }
  return { ok: true, reason: "" };
}

export type RetaskResult = "ok" | "unavailable" | "retask";

/**
 * What happens to a designation once its target is gone. The dead designation is never swapped
 * behind the crew's back: the caller is told `retask` when another legal target remains and
 * `unavailable` when none does. Nothing is mutated, so the objective can only change by choice.
 */
export function retaskOnUnavailable(
  option: BriefingOption,
  world: IBriefingWorld,
  now: number,
): { result: RetaskResult; reason: string } {
  const check = validateSelection(option, world, now);
  if (check.ok) return { result: "ok", reason: "" };
  let alternatives: BriefingOption[] = [];
  if (option.kind === "strike" || option.kind === "surface") {
    alternatives = knownTargets(world, now, option.kind);
  } else if (option.kind === "support") {
    const duty = supportDuty(world, now);
    alternatives = duty ? [duty] : [];
  }
  if (alternatives.length) return { result: "retask", reason: `${check.reason} Another target is available.` };
  return { result: "unavailable", reason: check.reason };
}
