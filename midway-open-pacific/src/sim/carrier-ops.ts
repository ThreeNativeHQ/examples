/**
 * Conserved carrier air inventory and straight-deck operations. Pure data and pure functions:
 * `Battle` owns every mutation and applies the returned records. Nothing here touches Three.js,
 * the DOM or a browser global.
 *
 * Invariant: for one carrier, `totalAircraft` (the sum of `airframes`) plus the number of that
 * carrier's aircraft currently airborne is constant. A launch moves one airframe out; a recovery
 * moves one back. Every other function only shuffles an existing airframe between `ready`,
 * `servicing` and `damaged`, so a permanent write-off on failed repair is the only place the
 * count may fall.
 */
export interface CarrierAir {
  airframes: Record<string, number>;
  ready: Record<string, number>;
  damaged: Record<string, number>;
  /**
   * Recovered or repaired but not yet armed. `ready` and `damaged` alone cannot say which
   * airframe completes service, so the type has to be kept here.
   */
  servicing: Record<string, number>;
  /** Hangar work has its own clock; launches and later recoveries cannot restart it. */
  serviceSince?: number;
  stores: Record<string, number>;
  fuel: number;
}

export type DeckMode =
  | "available"
  | "preparing"
  | "deck-ready"
  | "launching"
  | "recovering"
  | "servicing";

export interface DeckState {
  mode: DeckMode;
  since: number;
  occupiedUntil: number;
  suspended: string | null;
}

export interface ITimes {
  launchInterval: number;
  recoveryInterval: number;
  serviceSeconds: number;
  repairSeconds: number;
}

export interface ILaunchCheck {
  ok: boolean;
  reason: string;
}

/** Only these modes accept a launch; the rest are mid-cycle and still occupy the deck. */
const LAUNCH_MODES: ReadonlySet<DeckMode> = new Set(["available", "deck-ready"]);

/** A straight deck listing beyond this is unsafe to work. */
export const HEAVY_LIST = 0.35;
/** The shared launch threshold: a deck failed below this cannot operate at all. */
export const DECK_SUSPEND = 0.35;
/** A repair roll below this is a permanent write-off. */
export const REPAIR_FAIL_CHANCE = 0.15;

function copyCounts(src: Record<string, number>): Record<string, number> {
  return { ...src };
}

function cloneAir(air: CarrierAir): CarrierAir {
  return {
    airframes: copyCounts(air.airframes),
    ready: copyCounts(air.ready),
    damaged: copyCounts(air.damaged),
    servicing: copyCounts(air.servicing),
    serviceSince: air.serviceSince,
    stores: copyCounts(air.stores),
    fuel: air.fuel,
  };
}

function firstPositive(rec: Record<string, number>): string | null {
  for (const key in rec) if (rec[key] > 0) return key;
  return null;
}

function totalCount(rec: Record<string, number>): number {
  let n = 0;
  for (const key in rec) n += rec[key];
  return n;
}

/** The ordnance family an airframe re-arms with: torpedo planes, dive bombers, everything else. */
function storeFamily(airframe: string): string {
  if (airframe === "tbd" || airframe === "kate") return "torpedo";
  if (airframe === "sbd" || airframe === "val") return "bomb";
  return "ammo";
}

/**
 * The single launch gate. It only reads, so a queued launch at the active cap consumes nothing.
 * The caller checks this before every launch and applies `applyLaunch` only on `ok`.
 */
export function canLaunch(
  air: CarrierAir,
  deck: DeckState,
  airframe: string,
  store: string,
  now: number,
  activeCount: number,
  activeCap: number,
): ILaunchCheck {
  if (deck.suspended) return { ok: false, reason: deck.suspended };
  if (!LAUNCH_MODES.has(deck.mode)) return { ok: false, reason: `deck ${deck.mode}` };
  if ((air.ready[airframe] ?? 0) <= 0) return { ok: false, reason: `no ready ${airframe}` };
  if ((air.stores[store] ?? 0) <= 0) return { ok: false, reason: `no ${store}` };
  if (deck.occupiedUntil > now) return { ok: false, reason: "deck occupied" };
  if (activeCount >= activeCap) return { ok: false, reason: "active cap" };
  return { ok: true, reason: "" };
}

/**
 * Move one prepared aircraft, its airframe and one store off the deck. The inputs are never
 * touched; the caller replaces its records with the result. The active cap is the caller's
 * concern, so this refuses only the reasons `canLaunch` reports with no cap.
 */
export function applyLaunch(
  air: CarrierAir,
  deck: DeckState,
  airframe: string,
  store: string,
  now: number,
  times: ITimes,
): { air: CarrierAir; deck: DeckState } {
  const check = canLaunch(air, deck, airframe, store, now, 0, Infinity);
  if (!check.ok) throw new Error(`launch refused: ${check.reason}`);
  const next = cloneAir(air);
  next.ready[airframe] -= 1;
  next.airframes[airframe] -= 1;
  next.stores[store] -= 1;
  return {
    air: next,
    deck: { ...deck, mode: "launching", since: now, occupiedUntil: now + times.launchInterval },
  };
}

/**
 * Take one aircraft back aboard. It is counted again but is not ready and carries no store: it
 * waits in `servicing` (or `damaged`) until the crew prepares it.
 */
export function applyRecovery(
  air: CarrierAir,
  deck: DeckState,
  airframe: string,
  now: number,
  times: ITimes,
  damaged: boolean,
): { air: CarrierAir; deck: DeckState } {
  const next = cloneAir(air);
  if (totalCount(next.servicing) + totalCount(next.damaged) === 0) next.serviceSince = now;
  next.airframes[airframe] = (next.airframes[airframe] ?? 0) + 1;
  const bucket = damaged ? next.damaged : next.servicing;
  bucket[airframe] = (bucket[airframe] ?? 0) + 1;
  return {
    air: next,
    deck: { ...deck, mode: "servicing", since: now, occupiedUntil: now + times.recoveryInterval },
  };
}

/**
 * Complete one service or repair once its interval has elapsed. Service checks that ordnance is
 * available; dispatch charges it once in applyLaunch. An empty rack holds only that airframe's
 * service, not other types or repairs. A repair can write the airframe off permanently.
 */
export function stepService(
  air: CarrierAir,
  deck: DeckState,
  now: number,
  times: ITimes,
  roll: number,
): { air: CarrierAir; deck: DeckState } {
  const next = cloneAir(air);
  const elapsed = now - (next.serviceSince ?? deck.since);

  const serviceType = Object.keys(next.servicing).find(
    (type) => next.servicing[type] > 0 && (next.stores[storeFamily(type)] ?? 0) > 0,
  );
  if (serviceType && elapsed >= times.serviceSeconds) {
    next.servicing[serviceType] -= 1;
    next.ready[serviceType] = (next.ready[serviceType] ?? 0) + 1;
    next.serviceSince = now;
    const more = totalCount(next.servicing) > 0 || totalCount(next.damaged) > 0;
    return { air: next, deck: { ...deck, mode: deck.occupiedUntil > now ? deck.mode : more ? "servicing" : "available" } };
  }

  const damagedType = firstPositive(next.damaged);
  if (damagedType && elapsed >= times.repairSeconds) {
    next.damaged[damagedType] -= 1;
    if (roll < REPAIR_FAIL_CHANCE) next.airframes[damagedType] -= 1;
    else next.servicing[damagedType] = (next.servicing[damagedType] ?? 0) + 1;
    next.serviceSince = now;
    const more = totalCount(next.servicing) > 0 || totalCount(next.damaged) > 0;
    return { air: next, deck: { ...deck, mode: deck.occupiedUntil > now ? deck.mode : more ? "servicing" : "available" } };
  }

  return { air: next, deck: { ...deck } };
}

/** Only the four ship fields the gate reads; Battle's ship record is a structural superset. */
export interface SuspendInputs {
  evading?: boolean;
  list?: number;
  corridorFire?: boolean;
  deck?: number;
}

/**
 * The one gate the HUD and the simulation both call. It reads the ship, never re-derives a deck
 * reason anywhere else, and returns null when the deck can work.
 */
export function suspendReason(ship: SuspendInputs | null | undefined): string | null {
  if (!ship) return null;
  if (ship.evading === true) return "evading";
  if (Math.abs(ship.list ?? 0) >= HEAVY_LIST) return "heavy list";
  if (ship.corridorFire === true) return "fire in the landing corridor";
  if ((ship.deck ?? 1) < DECK_SUSPEND) return "deck damage";
  return null;
}

/** The conservation invariant's accounting: this plus the airborne aircraft never changes. */
export function totalAircraft(air: CarrierAir): number {
  return totalCount(air.airframes);
}
