/**
 * Cruiser and flying-boat scouting as pure records: a finite scout, the sectors it searches, the
 * fuel that ends the sortie and the water-contact recovery alongside a slowed ship. `Battle` owns
 * every mutation; this module reads the world and returns new records, and every random draw arrives
 * as a 0..1 argument. Nothing here loads a model, draws a frame or knows a renderer exists.
 *
 * Fuel is carried as **seconds of endurance remaining**, never as a volume or a knot figure, so a
 * burn rate and a leg budget share one unit and the reserve reads as time.
 */
import { clamp } from "./math.js";

export const SCOUT_STATES = [
  "aboard",
  "catapult",
  "outbound",
  "searching",
  "returning",
  "alongside",
  "lost",
] as const;
export type ScoutState = (typeof SCOUT_STATES)[number];

/** A finite scout. Identical aboard any hull; the home ship supplies the facilities, not the record. */
export interface ScoutAircraft {
  id: string;
  homeShipId: string;
  state: ScoutState;
  /** The sector this sortie was sent to, or null before one is assigned. */
  sectorId: string | null;
  /** Seconds of endurance left. Reaching zero in the air is a loss, not a glide. */
  fuel: number;
  /** Battle.time of the last launch, or null while it has never flown. */
  launchedAt: number | null;
  /** Battle.time of the last recovery, or null while it has never been picked up. */
  recoveredAt: number | null;
}

/**
 * One wedge of ocean to search: a bearing range and a depth from an origin. `lastSearchedAt` is the
 * only freshness fact, and null means never searched, which is maximally stale.
 */
export interface SearchSector {
  id: string;
  origin: { x: number; z: number };
  /** Radians, measured the same way as `math.ts` headings. */
  fromBearing: number;
  toBearing: number;
  /** Metres out from the origin along each bearing in the range. */
  depth: number;
  lastSearchedAt: number | null;
}

/** The ship facts scouting reads. A hull that declares no aviation simply has none. */
export interface ScoutShip {
  id?: string;
  sunk?: boolean;
  /** Speed through the water in m/s, for the pickup envelope. */
  speed?: number;
  /** 0..1 aviation capability: catapult, crane, fuel and crew. 0 means no scout operations. */
  aviation?: number;
  /** Damage that grounds flying even though the hull still has an aviation fitting. */
  aviationDamage?: boolean;
}

/** States that are in the air and therefore cannot be launched again. */
const AIRBORNE: readonly ScoutState[] = ["catapult", "outbound", "searching", "returning"];

/**
 * The fuel reserve: at or below this the scout turns for home whatever leg it was on, so the tank is
 * never spent searching. A caller that wants a tighter sortie raises it.
 */
export const SCOUT_RESERVE = 600;
/** Default fractional spread on the burn rate, centred so the r01 draw of 0.5 is exactly `burn`. */
export const SCOUT_BURN_SPREAD = 0.1;

/** The endurance a scout counts as full, for normalising group capacity. */
export const SCOUT_FULL_FUEL = 3600;

/** Per-second fuel spend and the fuel level at which each leg ends. */
export interface ScoutLimits {
  /** Seconds of fuel burned per simulated second airborne. */
  burn: number;
  /** Fraction the 0..1 draw spreads the burn around `burn`; defaults to `SCOUT_BURN_SPREAD`. */
  burnSpread?: number;
  /** Fuel remaining when the outbound leg reaches its sector. */
  outboundFuel: number;
  /** Fuel remaining when the search on station must end. */
  searchFuel: number;
  /** Fuel held back from searching. At or below this the scout is returning. */
  reserve: number;
  /** Fuel remaining when the scout reaches the ship's water pickup envelope. */
  pickupFuel: number;
}

/**
 * Which sector most deserves the next sortie. The longest unsearched wins; a null `lastSearchedAt`
 * is older than every timestamp. A tie is broken by the sector's position in the caller's array, so
 * the order the fleet lists its sectors is the tie-break and the answer is deterministic. Returns
 * null when every sector is fresher than `staleAfter`: a fresh sector is not worth the sortie.
 */
export function assignSector(
  sectors: SearchSector[],
  now: number,
  staleAfter: number,
): SearchSector | null {
  let best: SearchSector | null = null;
  let bestAge = -Infinity;
  for (const sector of sectors) {
    const age = sector.lastSearchedAt === null ? Infinity : now - sector.lastSearchedAt;
    // Strictly greater keeps the earlier declaration on a tie.
    if (age >= staleAfter && age > bestAge) {
      best = sector;
      bestAge = age;
    }
  }
  return best;
}

/** The capability a ship actually has, with an absent or non-finite figure reading as none. */
function capabilityOf(ship: ScoutShip | null | undefined): number {
  const value = ship?.aviation ?? 0;
  return Number.isFinite(value) ? value : 0;
}

/**
 * Whether a scout may leave now. A scout still in the air cannot launch again, a hull without
 * aviation cannot launch at all, and a hull whose aviation facilities are damaged is grounded even
 * though the fitting remains. `now` is kept in the contract for a later servicing rule, the same
 * way `repairPlan` keeps its clock.
 */
export function canLaunchScout(
  ship: ScoutShip,
  scout: ScoutAircraft,
  now: number,
): { ok: boolean; reason: string } {
  void now;
  if (scout.state === "lost") return { ok: false, reason: "scout is lost" };
  if (AIRBORNE.includes(scout.state)) {
    return { ok: false, reason: `scout is still airborne (${scout.state})` };
  }
  if (scout.state === "alongside") return { ok: false, reason: "scout is alongside, not yet aboard" };
  if (ship?.aviationDamage) return { ok: false, reason: "ship aviation facilities are damaged" };
  if (!(capabilityOf(ship) > 0)) return { ok: false, reason: "ship has no aviation capability" };
  return { ok: true, reason: "" };
}

/**
 * One tick of flight: burn endurance, then move the scout along its legs from fuel alone, which is
 * why the record needs no phase timer. The reserve turns it home before the tank is empty; an empty
 * tank while airborne is a loss. Aboard, alongside and lost are terminal for this function — only
 * the caller returns a recovered scout to "aboard". `r01` spreads the burn slightly, centred so 0.5
 * is exactly `limits.burn`.
 */
export function stepScout(
  scout: ScoutAircraft,
  dt: number,
  limits: ScoutLimits,
  r01: number,
): ScoutAircraft {
  if (scout.state === "aboard" || scout.state === "alongside" || scout.state === "lost") {
    return { ...scout };
  }
  const spread = limits.burnSpread ?? SCOUT_BURN_SPREAD;
  const factor = 1 + (clamp(r01, 0, 1) - 0.5) * spread;
  const burned = Math.max(0, limits.burn) * factor * Math.max(0, dt);
  const fuel = Math.max(0, scout.fuel - burned);
  if (fuel <= 0) return { ...scout, fuel: 0, state: "lost" };

  let state: ScoutState = scout.state;
  if (state === "catapult") state = "outbound";
  // The reserve outranks the leg schedule: whatever it was doing, low fuel means home.
  if (fuel <= limits.reserve) state = "returning";
  else if (state === "outbound" && fuel <= limits.outboundFuel) state = "searching";
  else if (state === "searching" && fuel <= limits.searchFuel) state = "returning";
  // Reaching the pickup envelope ends powered flight; the ship's crane takes it from here.
  if (state === "returning" && fuel <= limits.pickupFuel) state = "alongside";
  return { ...scout, fuel, state };
}

/** The fastest a ship may be going when a floatplane touches down alongside for recovery, in m/s. */
export const PICKUP_MAX_SHIP_SPEED = 8;

/**
 * The low-speed water-contact envelope for recovering a floatplane alongside a stopped or slowed
 * cruiser. This is a bounded operational transition gated on the ship's speed, not a hydrodynamics
 * model: it says yes or no and why, and leaves the water forces to the flight code.
 */
export function pickupWindow(
  scout: ScoutAircraft,
  ship: ScoutShip,
): { ok: boolean; reason: string } {
  if (scout.state !== "returning") {
    return { ok: false, reason: `scout is not on the return leg (${scout.state})` };
  }
  if (!ship || ship.sunk) return { ok: false, reason: "ship cannot recover aircraft" };
  if (!(capabilityOf(ship) > 0)) return { ok: false, reason: "ship has no aviation capability" };
  if ((ship.speed ?? 0) > PICKUP_MAX_SHIP_SPEED) {
    return { ok: false, reason: "ship too fast for a water pickup" };
  }
  return { ok: true, reason: "" };
}

/**
 * How much searching the group can still do, in full-scout equivalents: each flyable scout counts
 * its fuel as a fraction of a full load, and a lost or recovered one counts nothing. Interception of
 * a scout therefore shrinks later coverage without touching any report already filed.
 */
export function reconnaissanceCapacity(scouts: ScoutAircraft[]): number {
  let total = 0;
  for (const scout of scouts) {
    if (!scout || scout.state === "lost" || scout.state === "alongside") continue;
    total += clamp((scout.fuel ?? 0) / SCOUT_FULL_FUEL, 0, 1);
  }
  return total;
}
