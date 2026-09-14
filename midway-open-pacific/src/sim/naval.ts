/**
 * Surface-group behaviour as pure records and functions. `Battle` owns every mutation: it reads a
 * heading and speed here and writes them onto the ship, so nothing in this file moves anything.
 */
import { angleDelta, bearing, clamp, distance2, forward, wrap } from "./math.js";

/** A station in the group's moving frame: +Z ahead of the guide, +X to starboard, metres. */
export interface FormationStation {
  shipId: string;
  groupId: string;
  offsetX: number;
  offsetZ: number;
}

export type ShipTask =
  | "station"
  | "investigate"
  | "attack-submarine"
  | "rescue"
  | "assist"
  | "withdraw";

export interface ITaskOrder {
  task: ShipTask;
  targetId: string | null;
  startedAt: number;
  reason: string;
}

export interface IVessel {
  x: number;
  z: number;
  heading: number;
  speed: number;
}

export interface ISteerLimits {
  maxSpeed: number;
  turnRate: number;
  slowRadius: number;
}

export interface IHazard {
  x: number;
  z: number;
  radius: number;
}

export interface ISituation {
  survival: boolean;
  /** Whether the committed task's target is still worth keeping. */
  taskFeasible: boolean;
  opportunity: { task: ShipTask; targetId: string; reason: string } | null;
  stationFeasible: boolean;
}

export const COMMIT_SECONDS = 60;

/** How far avoidance swings the heading. Under PI, so an avoidance order never becomes a reversal. */
const AVOID_TURN = 0.6;

/**
 * The one place the moving frame is rotated. Heading 0 faces -Z and starboard is +X, matching
 * `forward` in math.ts, so offsetZ positive maps one station ahead of the guide.
 */
export function stationTarget(
  guideX: number,
  guideZ: number,
  guideHeading: number,
  station: FormationStation,
): { x: number; z: number } {
  const c = Math.cos(guideHeading);
  const s = Math.sin(guideHeading);
  return {
    x: guideX + station.offsetX * c + station.offsetZ * s,
    z: guideZ + station.offsetX * s - station.offsetZ * c,
  };
}

/**
 * Turn-rate-limited steering with a speed that bleeds off inside `slowRadius`, so a ship eases onto
 * its station instead of coasting past it. The caller applies the returned values; this never moves
 * the ship or snaps its heading.
 */
export function steerToStation(
  ship: { x: number; z: number; heading: number },
  target: { x: number; z: number },
  dt: number,
  limits: ISteerLimits,
): { heading: number; speed: number } {
  const error = angleDelta(bearing(ship, target), ship.heading);
  const heading = wrap(ship.heading + clamp(error, -limits.turnRate * dt, limits.turnRate * dt));
  const gap = distance2(ship, target);
  const speed = limits.maxSpeed * clamp(gap / limits.slowRadius, 0, 1);
  return { heading, speed };
}

/**
 * Analytic closest point of approach for two constant-velocity ships in the x-z plane. A negative
 * solution means the pair is already opening, so time is clamped to zero.
 */
export function closestApproach(
  aX: number,
  aZ: number,
  aVX: number,
  aVZ: number,
  bX: number,
  bZ: number,
  bVX: number,
  bVZ: number,
): { time: number; distance: number } {
  const rx = aX - bX;
  const rz = aZ - bZ;
  const vx = aVX - bVX;
  const vz = aVZ - bVZ;
  const vv = vx * vx + vz * vz;
  const time = vv > 1e-12 ? Math.max(0, -(rx * vx + rz * vz) / vv) : 0;
  const dx = rx + vx * time;
  const dz = rz + vz * time;
  return { time, distance: Math.hypot(dx, dz) };
}

/**
 * Returns an adjusted heading when the nearest approaching ship would pass within `minSeparation`
 * inside `lookahead` seconds, otherwise null. The turn is away from that ship's bearing and capped
 * below PI, so an avoidance order never becomes a reversal.
 */
export function avoidanceHeading(
  ship: IVessel,
  others: IVessel[],
  lookahead: number,
  minSeparation: number,
): number | null {
  const sf = forward(ship.heading);
  const svx = sf.x * ship.speed;
  const svz = sf.z * ship.speed;
  let urgent: { bearing: number; time: number } | null = null;
  for (const other of others) {
    const of = forward(other.heading);
    const c = closestApproach(
      ship.x,
      ship.z,
      svx,
      svz,
      other.x,
      other.z,
      of.x * other.speed,
      of.z * other.speed,
    );
    if (c.time <= lookahead && c.distance < minSeparation) {
      if (!urgent || c.time < urgent.time) urgent = { bearing: bearing(ship, other), time: c.time };
    }
  }
  if (!urgent) return null;
  const delta = angleDelta(urgent.bearing, ship.heading);
  const side = delta === 0 ? 1 : -Math.sign(delta);
  return wrap(ship.heading + side * AVOID_TURN);
}

/**
 * Which task the ship should be running now. Priority: survival, a rescue or assist already
 * committed, the committed task while feasible, a fresh opportunity, then station. A task started
 * inside COMMIT_SECONDS is not displaced by the lower-priority opportunity or station.
 */
export function chooseTask(
  ship: { task: ITaskOrder | null },
  situation: ISituation,
  now: number,
): { task: ShipTask; targetId: string | null; reason: string } | null {
  if (situation.survival) return { task: "withdraw", targetId: null, reason: "survival" };
  const held = ship.task;
  if (held && (held.task === "rescue" || held.task === "assist")) {
    return { task: held.task, targetId: held.targetId, reason: held.reason };
  }
  if (held && (situation.taskFeasible || now - held.startedAt < COMMIT_SECONDS)) {
    return { task: held.task, targetId: held.targetId, reason: held.reason };
  }
  if (situation.opportunity) return situation.opportunity;
  if (situation.stationFeasible) return { task: "station", targetId: null, reason: "station keeping" };
  return null;
}

/** True when (x, z) is outside every hazard circle by at least `margin`: the atoll and reef. */
export function clearOfHazard(x: number, z: number, hazards: IHazard[], margin: number): boolean {
  for (const h of hazards) {
    if (Math.hypot(x - h.x, z - h.z) < h.radius + margin) return false;
  }
  return true;
}

/** A resolved world point a rejoining ship steers for, plus the step the heading is applied over. */
export interface IRejoinStation {
  x: number;
  z: number;
  dt: number;
}

/**
 * Steering back onto station once an evasion has ended. It reuses `steerToStation`'s turn-rate
 * limit rather than a second one, so the rejoin is bounded by the same rudder rate as ordinary
 * station keeping and the ship arcs back instead of snapping to the bearing. The caller decides
 * when evasion has ended; this only expresses the rejoin.
 */
export function rejoinCourse(
  ship: { x: number; z: number; heading: number },
  station: IRejoinStation,
  limits: ISteerLimits,
): { heading: number; speed: number } {
  return steerToStation(ship, station, station.dt, limits);
}

/** A ship's formation identity as far as course authority is concerned. */
export interface ICourseShip {
  id: string;
  groupId: string;
  /** Sets the group's course while nobody is evading. */
  guide: boolean;
  /** Committed to an evasion; immediate survival outranks station keeping. */
  evading: boolean;
}

/**
 * Who owns the course. Rule: an evasion outranks station keeping, so a group yields to its lowest-id
 * evader, and among evaders the lowest id leads — that is what stops two evaders from each yielding
 * to the other. With nobody evading the guide holds the course and every non-guide yields to it.
 * A ship that leads returns null, meaning it may set its own course.
 */
export function courseAuthority(ship: ICourseShip, others: ICourseShip[]): string | null {
  const group = others.filter((o) => o.groupId === ship.groupId);
  if (ship.evading) {
    const senior = group
      .filter((o) => o.evading && o.id < ship.id)
      .map((o) => o.id)
      .sort();
    return senior.length > 0 ? senior[0] : null;
  }
  const evaders = group
    .filter((o) => o.evading)
    .map((o) => o.id)
    .sort();
  if (evaders.length > 0) return evaders[0];
  if (ship.guide) return null;
  const guide = group.find((o) => o.guide);
  return guide ? guide.id : null;
}

/** A crew or boat group in the water: a plain record, never an entity. */
export interface ISurvivorGroup {
  id: string;
  x: number;
  z: number;
  /** Simulation time the group was first seen, seconds. */
  since: number;
  count: number;
}

export interface IRescueLimits {
  /** The escort's own position: reach is measured from here. */
  fromX: number;
  fromZ: number;
  /** Furthest an escort will detach from the screen, metres. */
  range: number;
  /** A group smaller than this does not justify a dedicated run. */
  minCount: number;
  /** Seconds after `since` at which the attempt is abandoned. */
  abandonAfter: number;
}

/**
 * The rescue an escort should divert to, or null. Rule: only groups within `range`, at least
 * `minCount` strong and not yet abandoned are candidates; among them the most survivors win, then
 * the nearest, then the longest in the water, then the lowest id for a deterministic result.
 * `until` is when the attempt is abandoned whether or not it has started.
 */
export function rescueWindow(
  survivors: ISurvivorGroup[],
  now: number,
  limits: IRescueLimits,
): { targetId: string; until: number } | null {
  let best: ISurvivorGroup | null = null;
  let bestDist = 0;
  for (const s of survivors) {
    if (s.count < limits.minCount) continue;
    if (now >= s.since + limits.abandonAfter) continue;
    const d = Math.hypot(s.x - limits.fromX, s.z - limits.fromZ);
    if (d > limits.range) continue;
    if (
      !best ||
      s.count > best.count ||
      (s.count === best.count &&
        (d < bestDist ||
          (d === bestDist && s.since < best.since) ||
          (d === bestDist && s.since === best.since && s.id < best.id)))
    ) {
      best = s;
      bestDist = d;
    }
  }
  return best ? { targetId: best.id, until: best.since + limits.abandonAfter } : null;
}
