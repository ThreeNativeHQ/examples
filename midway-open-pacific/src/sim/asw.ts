/**
 * The escort's side of an anti-submarine hunt. Pure records plus pure functions — `Battle` owns
 * every mutation. `submarine.ts` already holds the boat: its depth, its own hydrophone and the
 * depth charge that sinks and detonates. This file holds only what the escort believes and what it
 * does about that belief, so the hunt is a sequence of phases rather than an instant kill.
 *
 * The whole point is the escort acts on its BELIEF. It never reads the boat's true depth or
 * position, because that would be cheating: an attack is only ever as good as the contact it was
 * built from.
 */
import { clamp } from "./math.js";
import { searchArea, type LostContact } from "./submarine.js";

/** The hunt's phases, in the order the brief lays them out. */
export type AswPhase = "searching" | "investigating" | "attacking" | "reattack" | "lost" | "rejoin";

/**
 * An escort's belief about a boat. A hydrophone gives a line of bearing and nothing else, so a
 * contact can exist with a bearing and NO range: `range` is null until a second sensor or a look
 * supplies one. `depth` is the escort's estimate, metres positive downward, never the true depth.
 */
export interface AswContact {
  /** Line of bearing to the boat, radians, same convention as `bearing` in math.ts. */
  bearing: number;
  /** Half-width of the bearing error, radians. A hydrophone gives a wedge, not a point. */
  bearingUncertainty: number;
  /** Estimated range in metres, or null when only a bearing is held. */
  range: number | null;
  /** The escort's belief about the boat's depth, metres positive down. Never ground truth. */
  depth: number;
  /** True while the contact is being held right now; false for a stale last-known record. */
  held: boolean;
  /** Seconds since the contact was last refreshed. */
  lastHeld: number;
}

/** The escort's own motion, the only ship facts an attack solution needs. */
export interface AswShip {
  x: number;
  z: number;
  heading: number;
  speed: number;
}

/** Per-hunt timings, passed in so the pure test can compress a whole hunt into a few steps. */
export interface AswLimits {
  /** How long the contact must be held and studied before an attack track is allowed. */
  investigateSeconds: number;
  /** How long the attack run takes before the salvo is dropped. */
  attackSeconds: number;
  /** A contact not refreshed within this many seconds is treated as lost. */
  holdSeconds: number;
  /** How long to search an estimated area before giving up and rejoining. */
  searchSeconds: number;
  /** The lost-contact search circle's growth rate, m/s. */
  spreadRate: number;
  /** The boat speed assumed when dead-reckoning the search centre from the last fix. */
  assumedSpeed: number;
}

/** A finite salvo: a preset depth and the surface points it is dropped on. */
export interface AttackSolution {
  presetDepth: number;
  dropPoints: { x: number; z: number }[];
}

/** Everything the hunt remembers between steps. `Battle` owns mutation; this file only reads. */
export interface AswState {
  phase: AswPhase;
  /** Depth charges left. The salvo is finite, so an escort cannot hunt forever. */
  charges: number;
  /** Seconds spent in the current phase, used for the investigation and attack gates. */
  phaseTime: number;
  /** Salvoes dropped so far, for the after-action report. */
  salvoes: number;
  /** The last computed solution, kept for the run and for the record. */
  solution: AttackSolution | null;
  /** The estimated area to search once contact is lost, or null while contact is held. */
  search: { x: number; z: number; radius: number } | null;
  /** The last firm fix — a believed position, the assumed course and speed. */
  lastContact: LostContact | null;
}

/** Charges in one salvo. The finite count is what eventually sends the escort home. */
export const ASW_SALVO = 6;
/** Depth settings an escort's fuses actually have. The belief is rounded to the nearest. */
export const DEPTH_PRESETS: readonly number[] = [20, 40, 60];
/** A bearing wedge wider than this cannot be attacked on; it is a search problem, not a target. */
export const MAX_ATTACK_BEARING_UNCERTAINTY = 0.35;
/** A stopped escort's own noise floor, m/s. A quiet boat must still be audible at rest. */
export const ESCORT_BASE_NOISE = 1.0;
/** Own-noise added per (m/s)^2 of escort speed. Quadratic, so a sprint is what deafens it. */
const NOISE_PER_SPEED_SQUARED = 0.08;

/**
 * The noise a fast escort makes, as an effective hydrophone noise floor in m/s. `hydrophoneBearing`
 * refuses any target quieter than the floor, so a sprinting escort hears less exactly when it is
 * closing fastest: the trade is speed against the sensor. The quadratic term is the one that
 * matters — at a crawl the self-noise is nearly the base value, at full speed it dominates.
 */
export function fastEscortNoise(speed: number): number {
  const s = Math.max(0, speed);
  return ESCORT_BASE_NOISE + NOISE_PER_SPEED_SQUARED * s * s;
}

/** The escort's believed position of the boat, from its own position, the bearing and a range. */
function believedPoint(ship: AswShip, contact: AswContact, range: number): { x: number; z: number } {
  return {
    x: ship.x + Math.sin(contact.bearing) * range,
    z: ship.z - Math.cos(contact.bearing) * range,
  };
}

/** Round the believed depth to a fuse setting. The belief is all the escort has to set it by. */
function nearestPreset(depth: number): number {
  let best = DEPTH_PRESETS[0];
  let bestDist = Infinity;
  for (const preset of DEPTH_PRESETS) {
    const d = Math.abs(preset - depth);
    if (d < bestDist) {
      bestDist = d;
      best = preset;
    }
  }
  return best;
}

/**
 * Build an attack from the contact estimate, or null when it is not good enough to attack on. A
 * bearing-only contact has no range and cannot aim a salvo, and a bearing wedge wider than the
 * tolerance is a search problem. The preset depth is chosen from the escort's BELIEF — using the
 * boat's true depth here would be cheating, and the signature deliberately gives it no way to.
 */
export function attackSolution(
  ship: AswShip,
  contact: AswContact,
  r01: number,
): AttackSolution | null {
  if (contact.range === null || !Number.isFinite(contact.range) || contact.range <= 0) return null;
  if (Math.abs(contact.bearingUncertainty) > MAX_ATTACK_BEARING_UNCERTAINTY) return null;
  const presetDepth = nearestPreset(contact.depth);
  const believed = believedPoint(ship, contact, contact.range);
  // The ladder straddles the believed position along the line of bearing, because the uncertainty
  // that matters most is how far the boat ran along that line. r01 staggers it off dead centre.
  const jitter = (clamp(r01, 0, 1) - 0.5) * 12;
  const spacing = 30;
  const dropPoints: { x: number; z: number }[] = [];
  for (let i = 0; i < ASW_SALVO; i += 1) {
    const along = (i - (ASW_SALVO - 1) / 2) * spacing + jitter;
    dropPoints.push({
      x: believed.x + Math.sin(contact.bearing) * along,
      z: believed.z - Math.cos(contact.bearing) * along,
    });
  }
  return { presetDepth, dropPoints };
}

/** Does the escort still have charges? A spent salvo refuses, so the hunt cannot be eternal. */
export function canAttack(state: AswState): boolean {
  return state.charges > 0;
}

/** Enter a new phase and restart its clock, dropping a stale solution unless reattacking. */
function enter(state: AswState, phase: AswPhase): AswState {
  return { ...state, phase, phaseTime: 0, solution: phase === "reattack" ? state.solution : null };
}

/**
 * Move to `lost` and open a search over the estimated area rather than pinning the last point. The
 * area is centred on the dead-reckoned last fix and grows at `spreadRate`; `step` seeds its clock
 * so the very first lost step already reports a nonzero area.
 */
function toLost(state: AswState, ship: AswShip, step: number, limits: AswLimits): AswState {
  const fix: LostContact = state.lastContact ?? {
    x: ship.x,
    z: ship.z,
    heading: ship.heading,
    speed: limits.assumedSpeed,
    time: 0,
  };
  const phaseTime = step;
  return {
    ...state,
    phase: "lost",
    phaseTime,
    solution: null,
    search: searchArea(fix, phaseTime, limits.spreadRate),
  };
}

/**
 * Advance one hunt by `dt`. The only way to reach `attacking` is through `investigating`, and the
 * only way past `reattack` with no charges left is `rejoin`: contact estimate -> investigation ->
 * attack track -> finite salvo -> reassess/search/rejoin, in that order. Pure: `state`, `contact`,
 * `ship` and `limits` are read, never written.
 */
export function stepHunt(
  state: AswState,
  contact: AswContact,
  ship: AswShip,
  dt: number,
  limits: AswLimits,
): AswState {
  const step = Math.max(0, dt);
  const held = contact.held === true && contact.lastHeld <= limits.holdSeconds;
  const next: AswState = { ...state, phaseTime: state.phaseTime + step };

  // Keep the last firm fix fresh whenever there is a range to place it with.
  if (held && contact.range !== null && Number.isFinite(contact.range) && contact.range > 0) {
    const p = believedPoint(ship, contact, contact.range);
    next.lastContact = { x: p.x, z: p.z, heading: contact.bearing, speed: limits.assumedSpeed, time: 0 };
  }

  switch (state.phase) {
    case "searching":
      return held ? enter(next, "investigating") : next;

    case "investigating":
      if (!held) return toLost(next, ship, step, limits);
      if (next.phaseTime >= limits.investigateSeconds) {
        if (canAttack(state) && attackSolution(ship, contact, 0.5) !== null) {
          return enter(next, "attacking");
        }
        // No usable solution yet: keep studying the contact rather than firing blind.
        return next;
      }
      return next;

    case "attacking": {
      if (!held) return toLost(next, ship, step, limits);
      const solution = attackSolution(ship, contact, 0.5);
      if (solution === null) return enter(next, "investigating");
      next.solution = solution;
      // The attack run must be flown before the charges go, so the ladder lands on the track.
      if (next.phaseTime < limits.attackSeconds) return next;
      const spent = Math.min(state.charges, ASW_SALVO);
      next.charges = state.charges - spent;
      next.salvoes = state.salvoes + (spent > 0 ? 1 : 0);
      return enter(next, "reattack");
    }

    case "reattack":
      if (state.charges <= 0) return enter(next, "rejoin");
      if (!held) return toLost(next, ship, step, limits);
      // Charges remain and the contact is still held: reassess, then run another pass.
      if (next.phaseTime >= limits.attackSeconds) return enter(next, "attacking");
      return next;

    case "lost":
      if (held) return enter(next, "investigating");
      next.search = searchArea(
        next.lastContact ?? {
          x: ship.x,
          z: ship.z,
          heading: ship.heading,
          speed: limits.assumedSpeed,
          time: 0,
        },
        next.phaseTime,
        limits.spreadRate,
      );
      if (next.phaseTime >= limits.searchSeconds) return enter(next, "rejoin");
      return next;

    case "rejoin":
      return next;

    default:
      return next;
  }
}
