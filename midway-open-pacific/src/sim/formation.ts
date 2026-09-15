/**
 * The group above the individual ship. `naval.ts` already steers one hull onto one station and
 * resolves who owns the course; this file owns the formation itself: where the stations are in the
 * guide's moving frame, what course the guide should steer, and what the group loses when a station
 * empties. Pure records and functions — `Battle` applies every result, nothing here moves a ship.
 */
import { clearOfHazard, type IHazard } from "./naval.js";
import { angleDelta, clamp, forward, wrap } from "./math.js";

export type FormationId = "screen" | "line-ahead" | "dispersal";

export interface FormationSlot {
  slot: string;
  /** Metres to starboard of the guide. */
  offsetX: number;
  /** Metres ahead of the guide. */
  offsetZ: number;
  /** Share of the group's protective coverage this station contributes, relative within a table. */
  coverage: number;
}

export interface Formation {
  id: FormationId;
  slots: readonly FormationSlot[];
}

/**
 * Three tables only. The PRD warns against a preset system, so these name the shapes the battle
 * actually asks for — a screen around a carrier, a column, and the open order called for air attack
 * — and nothing else. `screen` is the guide's protection; `dispersal` deliberately trades mutual
 * support for spacing so one stick cannot straddle two hulls.
 */
export const FORMATIONS: Readonly<Record<FormationId, Formation>> = Object.freeze({
  screen: Object.freeze({
    id: "screen",
    slots: Object.freeze([
      Object.freeze({ slot: "port-bow", offsetX: -1200, offsetZ: 1800, coverage: 0.25 }),
      Object.freeze({ slot: "starboard-bow", offsetX: 1200, offsetZ: 1800, coverage: 0.25 }),
      Object.freeze({ slot: "port-beam", offsetX: -2200, offsetZ: 0, coverage: 0.15 }),
      Object.freeze({ slot: "starboard-beam", offsetX: 2200, offsetZ: 0, coverage: 0.15 }),
      Object.freeze({ slot: "port-quarter", offsetX: -1200, offsetZ: -1800, coverage: 0.1 }),
      Object.freeze({ slot: "starboard-quarter", offsetX: 1200, offsetZ: -1800, coverage: 0.1 }),
    ]),
  }),
  "line-ahead": Object.freeze({
    id: "line-ahead",
    slots: Object.freeze([
      Object.freeze({ slot: "line-2", offsetX: 0, offsetZ: -1000, coverage: 0.1 }),
      Object.freeze({ slot: "line-3", offsetX: 0, offsetZ: -2000, coverage: 0.1 }),
      Object.freeze({ slot: "line-4", offsetX: 0, offsetZ: -3000, coverage: 0.1 }),
      Object.freeze({ slot: "line-5", offsetX: 0, offsetZ: -4000, coverage: 0.1 }),
      Object.freeze({ slot: "line-6", offsetX: 0, offsetZ: -5000, coverage: 0.1 }),
      Object.freeze({ slot: "line-7", offsetX: 0, offsetZ: -6000, coverage: 0.1 }),
    ]),
  }),
  dispersal: Object.freeze({
    id: "dispersal",
    slots: Object.freeze([
      Object.freeze({ slot: "dispersal-ahead", offsetX: 0, offsetZ: 4000, coverage: 0.05 }),
      Object.freeze({ slot: "dispersal-astern", offsetX: 0, offsetZ: -4000, coverage: 0.05 }),
      Object.freeze({ slot: "dispersal-starboard", offsetX: 4000, offsetZ: 0, coverage: 0.05 }),
      Object.freeze({ slot: "dispersal-port", offsetX: -4000, offsetZ: 0, coverage: 0.05 }),
      Object.freeze({ slot: "dispersal-ne", offsetX: 3000, offsetZ: 3000, coverage: 0.05 }),
      Object.freeze({ slot: "dispersal-sw", offsetX: -3000, offsetZ: -3000, coverage: 0.05 }),
    ]),
  }),
});

/** A surface group. The guide is the hull the moving frame and the course authority hang off. */
export interface Group {
  id: string;
  guideId: string;
  memberIds: string[];
  formationId: FormationId;
  /** The guide's current course, radians. */
  course: number;
  /** The guide's current speed, m/s. */
  speed: number;
}

/** What the group is trying to do. Only launch/recovery calls for a turn into wind. */
export type GroupIntentKind = "transit" | "screen" | "launch-recovery" | "evade" | "withdraw";

export interface IGroupIntent {
  kind: GroupIntentKind;
  /** The course the guide is asked to steer, radians. */
  course: number;
  /** The speed the group is asked to make, m/s. */
  speed: number;
  /** The guide's present position: the origin every hazard route is measured from. */
  guideX: number;
  guideZ: number;
}

export interface IGroupLimits {
  /** Highest speed the guide will plan for, m/s. */
  maxSpeed: number;
  /** How far ahead a planned course is sampled for hazards, metres. */
  lookahead: number;
  /** Clearance kept around each hazard, metres. */
  margin: number;
  /** Angular step used when searching either side of the requested course, radians. */
  step: number;
}

/** One planned guide course with the reason it was chosen. */
export interface IGroupCourse {
  course: number;
  speed: number;
  reason: string;
}

/** A wind blowing toward +x/+z; the course that faces into it is `turnIntoWind`'s job. */
export interface IWind {
  x: number;
  z: number;
}

export interface ISeaRoom {
  /** Open water available along the turn, metres. */
  available: number;
  /** What the manoeuvre needs, metres. */
  required: number;
}

/** A ship after an attack scattered the formation, with the station it held if that is known. */
export interface IScatteredShip {
  id: string;
  slot: string | null;
}

/** The station a ship is sent back to. Offsets resolve through `naval.stationTarget`. */
export interface StationAssignment {
  shipId: string;
  slot: string;
  offsetX: number;
  offsetZ: number;
  /** Sim time the reform order was issued. */
  at: number;
}

/**
 * Sample count along a planned course. Eight points over the lookahead catches the atoll before the
 * guide reaches it without a continuous ray-vs-circle test that the caller would have to tune.
 */
const ROUTE_SAMPLES = 8;

/** A planned course only ever searches three-quarters of a turn, so routing is never a reversal. */
const MAX_SWING = (Math.PI * 3) / 4;

function routeClear(
  x: number,
  z: number,
  course: number,
  hazards: IHazard[],
  limits: IGroupLimits,
): boolean {
  const f = forward(course);
  for (let i = 1; i <= ROUTE_SAMPLES; i += 1) {
    const t = (limits.lookahead * i) / ROUTE_SAMPLES;
    if (!clearOfHazard(x + f.x * t, z + f.z * t, hazards, limits.margin)) return false;
  }
  return true;
}

/** The requested course if it clears, otherwise the nearest course either side that does, else null. */
function nearestClearCourse(
  x: number,
  z: number,
  requested: number,
  hazards: IHazard[],
  limits: IGroupLimits,
): number | null {
  if (routeClear(x, z, requested, hazards, limits)) return requested;
  const step = limits.step > 0 ? limits.step : 0.1;
  const maxSteps = Math.max(1, Math.floor(MAX_SWING / step));
  for (let k = 1; k <= maxSteps; k += 1) {
    const right = wrap(requested + k * step);
    if (routeClear(x, z, right, hazards, limits)) return right;
    const left = wrap(requested - k * step);
    if (routeClear(x, z, left, hazards, limits)) return left;
  }
  return null;
}

/**
 * The guide's course for what the group is trying to do, planned clear of hazards. The reason always
 * records whether the asked-for course held or which way it was bent and why, so a route decision is
 * auditable rather than a silent heading change. A route with no clear course holds the guide's
 * current one and says so instead of inventing a course through the reef.
 */
export function groupCourse(
  group: Group,
  intent: IGroupIntent,
  hazards: IHazard[],
  limits: IGroupLimits,
): IGroupCourse {
  const speed = clamp(intent.speed, 0, limits.maxSpeed);
  const requested = wrap(intent.course);
  const chosen = nearestClearCourse(intent.guideX, intent.guideZ, requested, hazards, limits);
  if (chosen === null) {
    return { course: wrap(group.course), speed, reason: "no clear route found; holding the guide's course" };
  }
  if (chosen === requested) return { course: requested, speed, reason: "requested course is clear" };
  const delta = angleDelta(chosen, requested);
  const side = delta > 0 ? "starboard" : "port";
  return { course: chosen, speed, reason: `routed to ${side} to clear a hazard` };
}

/** The course that faces into the wind, so a carrier can launch and recover along her deck. */
function intoWind(wind: IWind): number {
  return wrap(Math.atan2(-wind.x, wind.z));
}

/**
 * Turn into wind only when the operational intent and sea room permit, the PRD's rule. Anything but
 * a launch or recovery refuses; a turn that would run out of water refuses. A refusal keeps the
 * guide's current course and states its reason, so the caller never mistakes it for an order.
 */
export function turnIntoWind(
  group: Group,
  wind: IWind,
  intent: IGroupIntent,
  seaRoom: ISeaRoom,
): { course: number; ok: boolean; reason: string } {
  if (intent.kind !== "launch-recovery") {
    return { course: group.course, ok: false, reason: "the intent does not call for a turn into wind" };
  }
  if (seaRoom.available < seaRoom.required) {
    return { course: group.course, ok: false, reason: "not enough sea room to turn into wind" };
  }
  return { course: intoWind(wind), ok: true, reason: "turned into the wind to launch or recover" };
}

/**
 * Give every member its station back after an attack. A ship that can keep the station it already
 * held does, lowest id first when two claim the same one; the rest take the remaining stations in
 * the table's own order. Preferring the held station is what stops a scattered group from swapping
 * hulls for no reason, and sorting by id keeps the result independent of array order.
 */
export function reformAfter(
  group: Group,
  disrupted: readonly IScatteredShip[],
  now: number,
): StationAssignment[] {
  const slots = FORMATIONS[group.formationId].slots;
  const byName = new Map(slots.map((s) => [s.slot, s]));
  const held = new Map<string, string>();
  for (const d of disrupted) if (d.slot && byName.has(d.slot)) held.set(d.id, d.slot);

  const roster = [...group.memberIds].sort();
  const taken = new Set<string>();
  const assigned = new Map<string, string>();
  for (const id of roster) {
    const station = held.get(id);
    if (!station || taken.has(station)) continue;
    taken.add(station);
    assigned.set(id, station);
  }
  for (const id of roster) {
    if (assigned.has(id)) continue;
    const free = slots.find((s) => !taken.has(s.slot));
    if (!free) break;
    taken.add(free.slot);
    assigned.set(id, free.slot);
  }

  const out: StationAssignment[] = [];
  for (const id of roster) {
    const name = assigned.get(id);
    if (!name) continue;
    const slot = byName.get(name)!;
    out.push({ shipId: id, slot: name, offsetX: slot.offsetX, offsetZ: slot.offsetZ, at: now });
  }
  return out;
}

/** How much of the group's protective coverage is gone, 0..1, when the named escorts are away. */
export function coverageLost(group: Group, absentIds: readonly string[]): number {
  const slots = FORMATIONS[group.formationId].slots;
  const absent = new Set(absentIds);
  const total = slots.reduce((n, s) => n + s.coverage, 0);
  if (total <= 0) return 0;
  let lost = 0;
  for (let i = 0; i < group.memberIds.length && i < slots.length; i += 1) {
    if (absent.has(group.memberIds[i])) lost += slots[i].coverage;
  }
  return lost / total;
}
