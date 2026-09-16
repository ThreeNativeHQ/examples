/** Perception-limited tactical AI. Game-tuned flight envelopes, not pilot/airfoil data. */
import {
  angleDelta,
  bearing,
  bombImpact,
  clamp,
  distance2,
  distance3,
  lerp,
  onDeck,
  segmentDistance,
  wrap,
} from "./math.js";
import { aircraftWorld, damageModifiers, initDamage, poseAxes, stepDamage } from "./damage.js";
import {
  rearGunHitsOwnTail,
  rearGunMountFor,
  rearGunMuzzle,
  rearGunTailBoxFor,
} from "./gun-mount.js";
import { torpedoEnvelope, torpedoIntercept, updateStores } from "./armament.js";
import { AircraftFlight, DECK_HEIGHT, initFlightState, SEA_WIND, steerToward, type ISteerLimits } from "./flight.js";
import { DRIFT_RATE, isStale, STALE_SECONDS } from "./intel.js";

/**
 * `damageModifiers` returns exactly these values for an untouched airframe, and integrity only ever
 * falls. Sharing one frozen object saves an allocation for every undamaged aircraft every step.
 */
const NEUTRAL_MODIFIERS = Object.freeze({ controls: 1, drag: 0, lift: 1, power: 1, roll: 0 });
function modifiersFor(a: Any): { power: number; lift: number; drag: number; roll: number; controls: number } {
  const d = a.damage;
  if (
    !d ||
    (!a.engineCut &&
      d.engine.integrity === 1 &&
      d.leftWing.integrity === 1 &&
      d.rightWing.integrity === 1 &&
      d.fuselage.integrity === 1 &&
      d.tail.integrity === 1)
  )
    return NEUTRAL_MODIFIERS;
  return damageModifiers(a);
}

type Any = any;

/** Classifications an aircraft or a boat will spend a weapon on. Not "small", and not "unknown". */
const STRIKE_CLASSES: ReadonlySet<string> = new Set(["carrier", "cruiser"]);

/** How far a deck will send a strike at a reported contact. */
const STRIKE_RADIUS = 30000;

/**
 * The rectangle an attacker judges a release against, by what it believes the contact to *be*. An
 * attacking crew has no access to the ship's measured geometry — and a contact record deliberately
 * carries none — so the aiming rectangle comes from the classification instead.
 */
const CLASS_HULL: Readonly<Record<string, { length: number; width: number }>> = Object.freeze({
  carrier: { length: 250, width: 30 },
  cruiser: { length: 190, width: 20 },
  escort: { length: 115, width: 12 },
  submarine: { length: 95, width: 9 },
  small: { length: 95, width: 11 },
  unknown: { length: 120, width: 14 },
});

/**
 * One believed target, dead-reckoned from the report that created it. Everything downstream steers,
 * leads and releases against this estimate, so a stale or mistaken report actually sends the attack
 * to the wrong patch of sea rather than quietly reading the ship's true position.
 */
function believedTarget(b: Any, c: Any): Any {
  // Dead-reckoned inline rather than through `estimatePosition`, which would allocate a fresh
  // `{ x, z, radius }` for every attacker every step. `BELIEVED` is scratch, refilled here and read
  // by `selectNavalTarget`'s caller before the next aircraft's turn.
  const age = b.time - c.observedAt;
  const reach = c.speed * age;
  const hull = CLASS_HULL[c.classification] ?? CLASS_HULL.unknown;
  const t = BELIEVED;
  Object.assign(t, c);
  t.x = c.x + Math.sin(c.heading) * reach;
  t.z = c.z - Math.cos(c.heading) * reach;
  t.y = 0;
  t.uncertainty = c.errorRadius + DRIFT_RATE * age * (c.lost ? 3 : 1);
  t.age = age;
  t.deckLength = hull.length;
  t.deckWidth = hull.width;
  t.hullLength = hull.length;
  t.hullBeam = hull.width;
  t.id = c.id;
  return t;
}

/**
 * The contact a ship or a boat would commit to: the closest fresh, reasonably certain report of
 * something worth a torpedo, inside strike range. Reads only delivered reports — with none, a
 * submarine or a carrier has nothing to attack, however close the enemy actually is.
 */
export function strikeContact(b: Any, s: Any): Any {
  const known = b.teamIntel[s.team];
  if (!known) return null;
  let best: Any = null;
  let score = Infinity;
  for (const c of known.values()) {
    // A lost contact stays attackable: the report was transmitted before the observer was lost, and
    // `er` below already inflates its uncertainty threefold, so it ranks behind a held sighting
    // rather than disappearing. Only a stale one — beyond the fleet's usable window — is dropped.
    if (isStale(c, b.time, STALE_SECONDS) || !STRIKE_CLASSES.has(c.classification)) continue;
    // `estimatePosition` inlined: its temporary `{ x, z, radius }` was one allocation per contact.
    const age = b.time - c.observedAt;
    const reach = c.speed * age;
    const ex = c.x + Math.sin(c.heading) * reach;
    const ez = c.z - Math.cos(c.heading) * reach;
    const er = c.errorRadius + DRIFT_RATE * age * (c.lost ? 3 : 1);
    const d = Math.hypot(s.x - ex, s.z - ez);
    if (d > STRIKE_RADIUS) continue;
    const rank = d + er * 4 + (c.classification === "cruiser" ? 8000 : 0);
    if (rank < score) {
      score = rank;
      best = c;
    }
  }
  return best;
}

/**
 * What a deck should be doing, from what it can see and what it can arm. There is no launch cadence
 * and no ship name anywhere in it: the inputs are the team's *delivered* contacts, the air threat
 * over this ship, and the aircraft this ship has ready with stores left to arm them. `ready` is
 * counted by the caller, which owns the airframe and store tables.
 */
export function chooseCarrierMission(
  b: Any,
  s: Any,
  ready: Record<string, number>,
  commitSeconds: number,
): { kind: string; target: string | null; want: Record<string, number>; until: number } {
  // Counted in place: the old `.filter(...).length` built a throwaway array of every hostile in range.
  let threat = 0;
  for (const a of b.aircraft) {
    if (a.team !== s.team && a.hp > 0 && a.kind !== "recon" && distance2(a, s) < 9000) threat += 1;
  }
  const contact = strikeContact(b, s);
  const want: Record<string, number> = {};
  // Local defence first: fighters held back over the group are fighters not escorting a strike, which
  // is the whole of the CAP-versus-escort choice.
  if (threat > 0) want.fighter = Math.min(ready.fighter, 2 + Math.min(4, threat));
  if (contact) {
    want.torpedo = Math.min(ready.torpedo, 3);
    want.bomber = Math.min(ready.bomber, 3);
    if (want.torpedo + want.bomber > 0) want.fighter = Math.min(ready.fighter, (want.fighter ?? 0) + 2);
  } else {
    want.fighter = Math.max(want.fighter ?? 0, Math.min(ready.fighter, 2));
    // Nothing found: put a search leg up, because a fleet with no contacts has to go looking.
    want.recon = Math.min(ready.recon, 1);
  }
  return {
    kind: contact ? "strike" : threat ? "intercept" : "patrol",
    target: contact?.id ?? null,
    want,
    until: b.time + commitSeconds,
  };
}

/**
 * The follow-up strike on the atoll, and the fallback target only: a ship contact always outranks
 * it, which is the dilemma `Battle` orders this mission out of. A land target does not move and is
 * not a contact, so there is no dead reckoning here — but coming at all is still a belief.
 * `b.islandStrike` is the staff's read of the last report, never the facilities' live health, so a
 * base already flattened keeps drawing strikes until somebody flies over and sees it. The aim point
 * is the least damaged facility still standing, so a second wave finishes what the first left.
 */
function islandTarget(b: Any, a: Any): Any {
  if (a.team !== "jp" || !(a.bombs > 0) || !b.islandStrike) return null;
  let best: Any = null;
  for (const f of b.facilities ?? []) {
    if (f.health <= 0) continue;
    if (!best || f.health > best.health) best = f;
  }
  if (!best) return null;
  const t = ISLAND_AIM;
  t.x = best.x;
  t.z = best.z;
  // The footprint a bomb has to land in is the facility's own, not a hull's.
  t.deckLength = best.radius * 2;
  t.deckWidth = best.radius * 2;
  return t;
}

export function selectNavalTarget(b: Any, a: Any): Any {
  const known = b.teamIntel[a.team];
  if (!known) return null;
  // A player-ordered wing uses the same eligible designation as map/TAB and the sortie.
  // It still needs a delivered report and steers at that estimate, never at the live hull.
  if (a.team === "us" && a.wing && b.command === "strike") {
    const c = known.get(b.target);
    if (!c || isStale(c, b.time, STALE_SECONDS) || !b.targetContacts().some((r: Any) => r.id === c.id)) return null;
    a.target = c.id;
    return believedTarget(b, c);
  }
  const candidates = NAVAL_CANDIDATES;
  candidates.length = 0;
  for (const c of known.values()) {
    // A lost contact stays attackable: its report was transmitted before the observer was lost, and
    // `er` below already inflates its uncertainty threefold, so it ranks behind a held sighting
    // rather than disappearing. Only a stale one — beyond the fleet's usable window — is dropped.
    if (isStale(c, b.time, STALE_SECONDS) || !STRIKE_CLASSES.has(c.classification)) continue;
    candidates.push(c);
  }
  if (a.wing && b.command === "strike" && b.target) {
    const c = candidates.find((c: Any) => c.id === b.target);
    if (c) {
      a.target = c.id;
      return believedTarget(b, c);
    }
  }
  if (!a.target && a.section !== undefined) {
    const mate = b.aircraft.find(
      (e: Any) => e !== a && e.hp > 0 && e.home === a.home && e.section === a.section && e.target && e.kind !== "fighter",
    );
    if (mate && candidates.some((c: Any) => c.id === mate.target)) a.target = mate.target;
  }
  if (a.target) {
    const c = candidates.find((c: Any) => c.id === a.target);
    if (c) return believedTarget(b, c);
  }
  let best: Any = null;
  let score = Infinity;
  // How many teammates are already committed to each contact, counted once instead of once per
  // candidate: the pressure term is the same for every candidate and reads only live aircraft.
  let pressure: Map<Any, number> | null = null;
  if (candidates.length > 0) {
    pressure = PRESSURE;
    pressure.clear();
    for (const other of b.aircraft) {
      if (other.id === a.id || other.team !== a.team || !(other.bombs + other.torpedo > 0)) continue;
      if (other.target == null) continue;
      pressure.set(other.target, (pressure.get(other.target) || 0) + 1);
    }
  }
  for (const c of candidates) {
    const committed = pressure ? pressure.get(c.id) || 0 : 0;
    // `estimatePosition` inlined; see `strikeContact`.
    const age = b.time - c.observedAt;
    const reach = c.speed * age;
    const ex = c.x + Math.sin(c.heading) * reach;
    const ez = c.z - Math.cos(c.heading) * reach;
    const er = c.errorRadius + DRIFT_RATE * age * (c.lost ? 3 : 1);
    // An uncertain, poorly identified report is worth attacking less than a tight one. The target's
    // own damage state is deliberately absent: nobody outside that ship knows it.
    const rank = Math.hypot(a.x - ex, a.z - ez) + committed * 1150 + er * 3 + (1 - c.confidence) * 3000;
    if (rank < score) {
      score = rank;
      best = c;
    }
  }
  if (best) {
    a.target = best.id;
    return believedTarget(b, best);
  }
  return null;
}

export function chooseFighterTarget(b: Any, a: Any, shipsById?: Map<Any, Any>): Any {
  const home = shipsById ? shipsById.get(a.home) : b.ships.find((s: Any) => s.id === a.home);
  // Gather candidates with a squared-range reject, so only the handful actually in range pay for a
  // `Math.hypot`. The order is the aircraft order the old `.filter()` produced, with the player last.
  const candidates = FIGHTER_CANDIDATES;
  candidates.length = 0;  for (const e of b.aircraft) {
    if (e.team === a.team || e.hp <= 0 || e.mode === "launch") continue;
    const dx = e.x - a.x;
    const dy = e.y - a.y;
    const dz = e.z - a.z;
    if (dx * dx + dy * dy + dz * dz < 12250000) candidates.push(e);
  }
  if (a.team === "jp" && b.player.mode === "flight" && b.player.hp > 0) {
    const dx = b.player.x - a.x;
    const dy = b.player.y - a.y;
    const dz = b.player.z - a.z;
    if (dx * dx + dy * dy + dz * dz < 12250000) candidates.push(b.player);
  }
  let best: Any = null;
  let score = -Infinity;
  // How many of this aircraft's own side are already chasing each target, tabulated once rather than
  // by rescanning the whole fleet for every candidate.
  let attacks: Map<Any, number> | null = null;
  if (candidates.length > 0) {
    attacks = ATTACKS;
    attacks.clear();
    for (const f of b.aircraft) {
      if (f.team === a.team && f !== a && f.airTarget != null)
        attacks.set(f.airTarget, (attacks.get(f.airTarget) || 0) + 1);
    }
  }
  for (const e of candidates) {
    const d = distance3(a, e);
    const strike = e.kind === "bomber" || e.kind === "torpedo";
    const danger = home ? (e.x - home.x) * (e.x - home.x) + (e.z - home.z) * (e.z - home.z) < 23040000 : false;
    const attacking = attacks ? attacks.get(e.id) || 0 : 0;
    let rank = (strike ? 2500 : 0) + (danger ? 1400 : 0) - d - attacking * 1050 + (a.airTarget === e.id ? 500 : 0);
    if (a.wing && distance3(e, b.player) < 900) rank += 1400;
    if (e.kind === "fighter" && e.airTarget === a.id) rank += 900;
    if (rank > score) {
      score = rank;
      best = e;
    }
  }
  return best;
}

/**
 * How far each tactic lets the controller depart from straight and level. These are the game's
 * tactical envelopes, not the airframe's: the engine decides whether the aircraft can actually
 * deliver what is asked, and refuses by stalling or sinking rather than by clamping. The envelopes
 * are constants, so they are shared frozen objects rather than rebuilt for every aircraft every step.
 */
const TACTIC_LIMITS: Readonly<Record<string, ISteerLimits>> = Object.freeze({
  // A fixed aim distance, so the run-in descends to release height at once instead of easing down
  // over the whole approach and arriving over the ship still too high to drop.
  "torpedo-run": Object.freeze({ bank: 0.6, climb: 6, floor: 6, lead: 550, leadMax: 550, sink: 32 }),
  ditching: Object.freeze({ bank: 0.4, climb: 2, floor: 0, sink: 4 }),
  dive: Object.freeze({ bank: 0.9, climb: 8, floor: 55, lead: 80, sink: 115 }),
  evade: Object.freeze({ bank: 1.1, climb: 12, floor: 55, sink: 30 }),
  landing: Object.freeze({ bank: 0.5, climb: 5, floor: 6, sink: 12 }),
});
const FIGHTER_LIMITS: ISteerLimits = Object.freeze({ bank: 1.02, climb: 11, floor: 55, sink: 18 });
const ATTACKER_LIMITS: ISteerLimits = Object.freeze({ bank: 0.73, climb: 8, floor: 55, sink: 12 });

function limitsFor(a: Any): ISteerLimits {
  return TACTIC_LIMITS[a.tactic] ?? (a.kind === "fighter" ? FIGHTER_LIMITS : ATTACKER_LIMITS);
}

/** Is any live report this aircraft believes within `radius`? A loop, so no array is built per step. */
function contactNear(b: Any, a: Any, radius: number): boolean {
  for (const c of b.teamIntel[a.team].values()) {
    if (isStale(c, b.time, STALE_SECONDS)) continue;
    // `estimatePosition` inlined; see `strikeContact`.
    const age = b.time - c.observedAt;
    const reach = c.speed * age;
    const ex = c.x + Math.sin(c.heading) * reach;
    const ez = c.z - Math.cos(c.heading) * reach;
    if (Math.hypot(a.x - ex, a.z - ez) < radius) return true;
  }
  return false;
}

/** Module scratch for `flyAircraft`: reused, never retained past the synchronous engine step. */
const GLIDE_LIMITS: ISteerLimits = {};
const FLY_AIM = { x: 0, z: 0 };
const FLY_CONTROLS = { autopilot: false, pitch: 0, rudder: 0, turn: 0 };
const ZERO_AVOID = { x: 0, z: 0 };
/** Reused only for a steer aim that is consumed within the same iteration; never stored on an aircraft. */
const DEST = { x: 0, z: 0 };
function aimPoint(x: number, z: number): { x: number; z: number } {
  DEST.x = x;
  DEST.z = z;
  return DEST;
}
/** Reused candidate buffers and count maps: the AI is single-threaded and never retains them. */
const FIGHTER_CANDIDATES: Any[] = [];
const NAVAL_CANDIDATES: Any[] = [];
const ATTACKS = new Map<any, number>();
const PRESSURE = new Map<any, number>();
/**
 * Scratch objects for one step. Each is refilled immediately before use and read before the next
 * aircraft's turn; none is stored on an aircraft, so a stale field cannot leak into the simulation.
 * They exist because every one of these was a fresh literal per aircraft per step.
 */
const SHIPS_BY_ID = new Map<Any, Any>();
const BELIEVED: Any = {};
/** Scratch for the island aim point, refilled per attacker like `BELIEVED`. */
const ISLAND_AIM: Any = { id: "midway", kind: "base", team: "us", heading: 0, speed: 0, y: 0,
                          deckLength: 0, deckWidth: 0, uncertainty: 0, age: 0 };
const FIRE_POINT = { x: 0, y: 0, z: 0 };
const GUN_AIM = { x: 0, y: 0, z: 0 };
const ASTERN = { x: 0, z: 0 };
const BOMB_POINT = { x: 0, y: 0, z: 0 };
const BOMB_VEL = { x: 0, y: 0, z: 0 };
const BOMB_LEAD: Any = {};
/** The deck frame and launch stick for one `stepDeck` call; consumed synchronously, never retained. */
const DECK_FRAME = { x: 0, y: 0, z: 0, heading: 0, speed: 0, length: 0, width: 0 };
const DECK_CONTROLS = { pitch: 0, rudder: 0 };

/** A destroyed aircraft: no power, no lift, no control authority. The engine integrates the fall. */
export const DESTROYED_MODIFIERS = Object.freeze({ power: 0, lift: 0, drag: 0, roll: 0, controls: 0 });

/**
 * One aircraft's engine flight, built on first use. Everything the engine requires is finite before
 * the model exists, the fuel is converted to the percentage the engine and the player already share,
 * and the payload is counted once from the stores this aircraft launched with — `Battle`'s release
 * path owns it from then on, so nothing applies a store twice.
 */
function flightOf(a: Any): AircraftFlight {
  if (!a.flight) {
    // Endurance arrived in seconds; `IFlightState.fuel` is a percentage of the airframe's fuel mass,
    // which is also the unit `damage.ts` leaks and `aircraftMass` weighs. Keep the endurance the
    // launch chose as the burn rate and normalise the reading.
    a.enduranceSeconds = Math.max(1, a.fuelCapacity ?? a.fuel ?? 600);
    a.fuel = clamp((100 * (a.fuel ?? 0)) / a.enduranceSeconds, 0, 100);
    a.fuelCapacity = 100;
    updateStores(a);
    initFlightState(a);
    a.flight = new AircraftFlight(a, a.airframe, DECK_HEIGHT);
    a.flight.reset();
  }
  return a.flight;
}

/**
 * Fly one aircraft one step towards a point, at an altitude and a speed, through the engine's
 * `FlightModel`. The tactic picks the envelope and the configuration; the controller only ever emits
 * the installed `IFlightControls` fields, and power reaches the engine as `state.throttle`, which is
 * not a control input at all.
 */
function flyAircraft(a: Any, dest: Any, alt: number, targetSpeed: number, dt: number): void {
  if (!dest) return;
  const fl = flightOf(a);
  const m = modifiersFor(a);
  const avoid = a.avoid || ZERO_AVOID;
  FLY_AIM.x = dest.x + avoid.x;
  FLY_AIM.z = dest.z + avoid.z;
  const slow = a.tactic === "landing" || a.tactic === "torpedo-run";
  // Configuration follows the tactic: flaps for slow flight and the climb-out, dive brakes to hold a
  // dive-bomber's speed inside its release window, wheels only to land.
  a.flaps = slow || a.y < 120 ? 0.33 : 0;
  a.gear = a.tactic === "landing";
  a.brakes = a.tactic === "dive";
  // Power is trimmed, not scheduled: a proportional lever droops, and a torpedo bomber that settles
  // six knots above its release limit never drops. `throttle` is the engine's own state field — there
  // is no throttle control input — and the engine lags `rpm` towards it, which damps this.
  // Power is trimmed, not scheduled, and it answers to height as well as to speed. A throttle that
  // watches airspeed alone is satisfied by a descent: an aircraft held at approach speed below its
  // glide path mushes into the sea at part power with the stick doing nothing, because attitude
  // cannot buy energy the engine is not delivering.
  a.throttle = clamp(
    a.throttle +
      ((targetSpeed - (a.ias || a.speed)) * 0.06 + clamp(alt - a.y, -20, 20) * 0.05) * dt,
    0,
    1,
  );
  // With the engine gone the aircraft glides: no floor to hold, no climb to command, so it really
  // does trade height for speed instead of being held up by a minimum-speed rule.
  let limits = limitsFor(a);
  if (m.power < 0.12) {
    GLIDE_LIMITS.bank = limits.bank;
    GLIDE_LIMITS.climb = -2;
    GLIDE_LIMITS.floor = undefined;
    GLIDE_LIMITS.lead = limits.lead;
    GLIDE_LIMITS.leadMax = limits.leadMax;
    GLIDE_LIMITS.sink = limits.sink;
    limits = GLIDE_LIMITS;
  }
  fl.step(dt, steerToward(a, FLY_AIM, alt, limits, FLY_CONTROLS), m);
}

/**
 * Fly one aircraft off its own deck, through the engine's deck run rather than a synthetic climb.
 * The launch interval is shorter than a full run, so a second departure is spotted farther aft and
 * waits with its chocks in — `stepDeck` holds a chocked aircraft still below 55% power — until the
 * aircraft ahead of it is off.
 */
function deckDeparture(b: Any, a: Any, home: Any, dt: number): void {
  const fl = flightOf(a);
  if (!home || home.sunk || !(home.deckLength > 0)) {
    // Midway's runway is not a carrier deck corridor, and a sinking ship is not one either: the
    // aircraft is airborne from here and flies on the engine like everything else.
    a.mode = "flight";
    a.deckRun = "airborne";
    return;
  }
  fl.setDeck(home.deckHeight);
  if (a.deckRun === undefined) {
    let ahead = 0;
    for (const o of b.aircraft)
      if (o !== a && o.home === a.home && o.mode === "launch" && o.deckRun !== undefined) ahead += 1;
    a.brakes = false;
    a.chocks = true;
    a.deckLateral = 0;
    a.deckOffset = Math.max(-(home.deckLength / 2) + 6, -(home.deckLength / 2) + 10 - 14 * ahead);
    a.deckRun = "spotted";
    a.deckSpeed = 0;
    a.flaps = 0.6;
    a.gear = true;
    a.heading = home.heading;
    a.pitch = 0.22;
    a.speed = 0;
    a.throttle = 0.2;
    fl.reset();
  }
  if (a.deckRun === "spotted") {
    let rolling = false;
    for (const o of b.aircraft) {
      if (o !== a && o.home === a.home && o.deckRun === "rolling") {
        rolling = true;
        break;
      }
    }
    if (!rolling) {
      a.deckRun = "rolling";
      a.throttle = 1;
    }
  }
  DECK_FRAME.x = home.x;
  DECK_FRAME.z = home.z;
  DECK_FRAME.heading = home.heading;
  DECK_FRAME.speed = home.speed;
  DECK_FRAME.length = home.deckLength;
  DECK_FRAME.width = home.deckWidth;
  // Rotate late: the engine's own tail-rise schedule only reaches for the nose past 42 m/s, which a
  // loaded torpedo aircraft never sees on a deck, and holding the stick back from a standstill buys
  // angle of attack at a drag price that costs more roll than it gains lift.
  DECK_CONTROLS.pitch = a.speed > 24 ? 1 : 0;
  DECK_CONTROLS.rudder = clamp(angleDelta(home.heading, a.heading) * 6, -1, 1);
  // A carrier turns into the wind before launching. That turn is not simulated here — steering the
  // whole group off its transit course for every departure derails the surface battle — so an
  // airframe that cannot make its deck run in the ambient wind is given the wind the turn would
  // produce: a headwind along the ship's heading of the shared sea wind's speed. Only the loaded Kate
  // on a downwind Japanese deck is marginal; everything else already flies off in the true wind.
  const wind = fl.wind;
  const keptX = wind.x;
  const keptZ = wind.z;
  if (a.airframe === "kate") {
    const seaSpeed = Math.hypot(SEA_WIND.x, SEA_WIND.z);
    wind.x = -Math.sin(home.heading) * seaSpeed;
    wind.z = Math.cos(home.heading) * seaSpeed;
  }
  const departure = fl.stepDeck(
    DECK_FRAME,
    dt,
    // The deck is a moving, turning frame: a ship under helm rotates the corridor out from under an
    // aircraft that holds its launch heading, and the run then ends as a lateral overrun at half
    // flying speed. Steer down the deck instead.
    DECK_CONTROLS,
  );
  wind.x = keptX;
  wind.z = keptZ;
  if (departure !== null) {
    // `stepDeck` reports the departure but the game owns `mode`; without this the aircraft stays
    // pinned to the deck plane and never climbs.
    a.mode = "flight";
    a.deckRun = departure;
    a.chocks = false;
  }
}

export function fireClear(b: Any, a: Any, t: Any): boolean {
  const d = distance3(a, t);
  const lead = d / 950;
  // `FIRE_POINT` and the forward scalars replace a fresh point and a `forward()` result per call.
  FIRE_POINT.x = t.x + (t.vx || 0) * lead;
  FIRE_POINT.y = t.y + (t.vy || 0) * lead;
  FIRE_POINT.z = t.z + (t.vz || 0) * lead;
  const fx = Math.sin(a.heading) * Math.cos(a.pitch);
  const fy = Math.sin(a.pitch);
  const fz = -Math.cos(a.heading) * Math.cos(a.pitch);
  const len = distance3(a, FIRE_POINT) || 1;
  const dot = ((FIRE_POINT.x - a.x) * fx + (FIRE_POINT.y - a.y) * fy + (FIRE_POINT.z - a.z) * fz) / len;
  if (d > 850 || dot < 0.994 || a.ammo <= 0) return false;
  const others = b.aircraft;
  for (let i = 0; i < others.length; i += 1) {
    const p = others[i];
    if (p.team === a.team && p.id !== a.id && p.hp > 0 && distance3(a, p) < d && segmentDistance(a, FIRE_POINT, p) < 17)
      return false;
  }
  b.fire(a, t);
  return true;
}

/**
 * The rear gun's one engagement envelope, shared by the AI gunner and the manned station: the
 * muzzle must stay in the tail cone (at least 127° from the nose, `dot < REAR_GUN_DOT`) and no
 * lower than a shallow depression. The manned station adds no second envelope.
 */
export const REAR_GUN_DOT = -0.6;
export const REAR_GUN_ELEVATION = -0.13;

/**
 * One round from the tail gun, aimed along a world-space direction. Both the AI gunner and the
 * manned station fire through this, so the muzzle, event, tracer speed, ammunition and credit can
 * never drift apart between the two callers. The muzzle is one of the approved gun's own two mouths,
 * rotated by the gun's aim and alternating barrels; a round that would cross the aircraft's own fin
 * is refused (the shared `gun-mount` guard) rather than fired through the tail. Callers own the gate,
 * cooldown and ammo test. Returns whether a round left the gun.
 */
function rearShot(b: Any, a: Any, dx: number, dy: number, dz: number, spread: number): boolean {
  const mount = rearGunMountFor(a.airframe);
  if (!mount) return false;
  const len = Math.hypot(dx, dy, dz) || 1;
  const nx = dx / len;
  const ny = dy / len;
  const nz = dz / len;
  // The gun's own angles, measured in the airframe's real attitude frame: the same mapping the
  // pivot Euler uses, so the drawn barrel and the round leave the same mouth.
  const frame = poseAxes(a);
  const lx = nx * frame.r.x + ny * frame.r.y + nz * frame.r.z;
  const ly = nx * frame.u.x + ny * frame.u.y + nz * frame.u.z;
  const lz = -(nx * frame.f.x + ny * frame.f.y + nz * frame.f.z);
  const yaw = Math.atan2(lx, lz);
  const pitch = Math.asin(clamp(ly, -1, 1));
  const barrel = (a.rearBarrel = a.rearBarrel ? 0 : 1);
  const mouth = rearGunMuzzle(mount, barrel, yaw, pitch);
  const local = [
    mount.pivot[0] + mouth[0],
    mount.pivot[1] + mouth[1],
    mount.pivot[2] + mouth[2],
  ] as const;
  const tail = rearGunTailBoxFor(a.airframe);
  if (tail && rearGunHitsOwnTail(tail, local, [lx, ly, lz])) return false;
  const muzzle = aircraftWorld(a, { x: local[0], y: local[1], z: local[2] });
  const mx = muzzle.x;
  const my = muzzle.y;
  const mz = muzzle.z;
  a.rearAmmo -= 1;
  a.rearYaw = yaw;
  a.rearPitch = pitch;
  b.event("gun", { at: { x: mx, y: my, z: mz }, source: a.id, weapon: "gun30" });
  b.bullets.push({
    id: b.id("bullet"),
    x: mx,
    y: my,
    z: mz,
    vx: nx * 730 + (b.random() - 0.5) * spread,
    vy: ny * 730 + (b.random() - 0.5) * spread,
    vz: nz * 730 + (b.random() - 0.5) * spread,
    ttl: 1.1,
    team: a.team,
    owner: a.id,
    type: "gun",
    damage: 3,
  });
  return true;
}

/**
 * The player's own hand on the rear gun. Aim is a world direction built by the caller from the
 * airframe's real attitude and the bounded station angles, so roll and pitch aim coherently. The
 * cooldown advances exactly once per tick whether or not the trigger is down, so releasing does
 * not freeze it; a tight spread and the same tracer speed keep it the same weapon as the AI's.
 */
export function fireRearManual(
  b: Any,
  a: Any,
  aim: { x: number; y: number; z: number } | null,
  fire: boolean,
  dt: number,
): void {
  if (a.mode === "crashing" || !(a.rearAmmo > 0)) return;
  a.rearTimer = Math.max(0, (a.rearTimer || 0) - dt);
  if (!fire || !aim || a.rearTimer > 0) return;
  // A refused shot (the round would cross the fin) leaves the trigger free, so holding it fires the
  // moment the aim clears rather than waiting out a cadence for a round that never left.
  a.rearTimer = rearShot(b, a, aim.x, aim.y, aim.z, 3) ? 0.08 : 0;
}

export function rearGunner(b: Any, a: Any, dt: number): void {
  if (a.kind === "fighter" || a.kind === "recon" || !(a.rearAmmo > 0) || a.mode === "crashing") return;
  a.rearTimer = Math.max(0, (a.rearTimer || 0) - dt);
  if (a.rearTimer > 0) return;
  // The tail cone and its depression are measured in the airframe's own frame, the same `poseAxes`
  // mapping the muzzle uses: a banked or pitched gunner's world `dy` is not his up.
  const frame = poseAxes(a);
  const fx = frame.f.x;
  const fy = frame.f.y;
  const fz = frame.f.z;
  const ux = frame.u.x;
  const uy = frame.u.y;
  const uz = frame.u.z;
  // One pass for the first enemy behind the tail, in aircraft order with the player last, and the
  // range found once instead of twice. A squared reject keeps the (slow) `Math.hypot` for the rare
  // foe already in the 25–650 m envelope, which is the only place its value is used.
  let t: Any = null;
  let d = 0;
  const ax = a.x;
  const ay = a.y;
  const az = a.z;
  const others = b.aircraft;
  for (let i = 0; i <= others.length; i += 1) {
    let e: Any;
    if (i === others.length) {
      if (!(a.team === "jp" && b.player.mode === "flight")) break;
      e = b.player;
    } else {
      e = others[i];
      if (e.team === a.team || e.hp <= 0) continue;
    }
    const dx = e.x - ax;
    const dy = e.y - ay;
    const dz = e.z - az;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 >= 422500 || d2 <= 625) continue;
    const dd = Math.hypot(dx, dy, dz);
    if ((dx * fx + dy * fy + dz * fz) / dd < REAR_GUN_DOT && (dx * ux + dy * uy + dz * uz) / dd > REAR_GUN_ELEVATION) {
      t = e;
      d = dd;
      break;
    }
  }
  if (!t) return;
  const tt = d / 730;
  // `GUN_AIM` is scratch, read by the one bullet this shot emits before the next aircraft is handled.
  GUN_AIM.x = t.x + (t.vx || 0) * tt - a.x;
  GUN_AIM.y = t.y + (t.vy || 0) * tt - a.y;
  GUN_AIM.z = t.z + (t.vz || 0) * tt - a.z;
  // A refused shot (the round would cross the fin) keeps the gun on target without a cadence, so it
  // fires the moment the aircraft's own attitude clears the tail.
  a.rearTimer = rearShot(b, a, GUN_AIM.x, GUN_AIM.y, GUN_AIM.z, 13) ? 0.28 : 0;
}

export function navigateHome(b: Any, a: Any, dt: number): void {
  let h: Any = null;
  for (const s of b.ships) {
    if (s.id === a.home && !s.sunk && s.deck > 0.3) {
      h = s;
      break;
    }
  }
  if (!h) {
    // The first suitable deck by distance, matching the old `filter().sort()[0]` but without either
    // array: a strict `<` keeps the earliest ship in fleet order on a tie, exactly as a stable sort did.
    let bestD = Infinity;
    for (const s of b.ships) {
      if (s.team !== a.team || s.kind !== "carrier" || s.sunk || !(s.deck > 0.3)) continue;
      const d = distance2(a, s);
      if (d < bestD) {
        bestD = d;
        h = s;
      }
    }
  }
  if (a.home === "midway") h = b.island;
  if (!h) {
    a.tactic = "ditching";
    flyAircraft(a, aimPoint(a.x + Math.sin(a.heading) * 1000, a.z - Math.cos(a.heading) * 1000), 3, 48, dt);
    if (a.y < 4) {
      b.recordLoss(a);
      a.removed = true;
      b.fx("splash", a, 1.6);
    }
    return;
  }
  a.home = h.id || "midway";
  const hh = h.heading || 0;
  const fhx = Math.sin(hh);
  const fhz = -Math.cos(hh);
  // `ASTERN` is scratch: read by the `distance2` tests and by `flyAircraft` in the same branch.
  ASTERN.x = h.x - fhx * 520;
  ASTERN.z = h.z - fhz * 520;
  // The straight deck: a launch or another recovery in progress, or any suspended condition, keeps
  // this aircraft in the pattern. `Battle.recoverAircraft` is the same test at the moment of contact.
  const busy = (h.deckState?.occupiedUntil ?? 0) > b.time || h.deckState?.suspended != null || (h.evadeUntil || 0) > b.time;
  if (a.tactic !== "landing" && (distance2(a, ASTERN) > 350 || Math.abs(angleDelta(bearing(a, h), h.heading || 0)) > 0.65 || busy)) {
    a.tactic = "rtb";
    flyAircraft(
      a,
      busy ? aimPoint(h.x + Math.sin(b.time * 0.025 + a.phase) * 1300, h.z + Math.cos(b.time * 0.025 + a.phase) * 1300) : ASTERN,
      busy ? 450 : Math.max(90, Math.min(900, distance2(a, ASTERN) * 0.14)),
      a.kind === "fighter" ? 94 : 84,
      dt,
    );
    return;
  }
  a.tactic = "landing";
  const along = (a.x - h.x) * fhx + (a.z - h.z) * fhz;
  // Cross the ramp at this deck's own datum, and aim just past the wires. The vertical law flies
  // towards its aim point, so an approach aimed 140 m beyond the bow arrives over the deck as high as
  // that point is distant — which is exactly what `Battle.recoverAircraft` then refuses.
  const glide = (h.id ? (h.deckHeight ?? DECK_HEIGHT) + 4 : 10) + Math.max(0, -along - 65) * 0.08;
  flyAircraft(a, aimPoint(h.x + fhx * 45, h.z + fhz * 45), glide, 51, dt);
  if ((distance2(a, h) < 150 && a.y < 42) || (!h.id && distance2(a, h) < 200 && a.y < 50)) {
    // The airframe goes back into that ship's inventory — counted again, unready, and carrying no
    // store. A deck that cannot take it refuses, and the aircraft goes round again.
    if (b.recoverAircraft(h, a)) {
      a.recovered = true;
      a.removed = true;
    }
  }
  if (along > 190 && a.y < 60) {
    a.tactic = "rtb";
    a.y = Math.max(a.y, 35);
  }
}

export function updateTacticalAircraft(b: Any, dt: number): void {
  // Home lookup by id, refilled once per step into module scratch: every aircraft used to rescan
  // `b.ships` for its own deck, and the old code rebuilt the Map (and its backing store) every step.
  const shipsById = SHIPS_BY_ID;
  shipsById.clear();
  for (const s of b.ships) if (!shipsById.has(s.id)) shipsById.set(s.id, s);
  for (const a of b.aircraft) {
    if (a.recovered || a.removed) continue;
    if (a.mode === "crashing") {
      a.crashAge = (a.crashAge || 0) + dt;
      // A destroyed aircraft is still the engine's: no power, no lift and no control authority, so
      // the model integrates the fall. The old hand-rolled `x += vx * dt` here was the last motion
      // integrator beside the FlightModel.
      a.aileron = a.phase > 3 ? 1 : -1;
      flightOf(a).step(
        dt,
        { autopilot: true, pitch: -0.35, rudder: 0, turn: 0 },
        DESTROYED_MODIFIERS,
      );
      if (a.y <= 0 || a.crashAge > 30) {
        a.removed = true;
        b.fx("splash", { ...a, y: 0 }, 2.7);
      }
      continue;
    }
    if (a.hp <= 0) {
      b.planeDestroyed(a, a.lastAttacker);
      continue;
    }
    if (!a.damage) initDamage(a);
    // Built before the first fuel burn: this is where the endurance in seconds becomes the percentage
    // both the engine's mass and `damage.ts`'s leak read.
    const flight = flightOf(a);
    stepDamage(a, dt);
    if (a.hp <= 0) {
      b.planeDestroyed(a, a.lastAttacker);
      continue;
    }
    // Below the surface, wherever it was going. This used to sit after the tactical steering, which
    // the return, muster and egress branches all skip with a `continue`, so a damaged aircraft could
    // fly home at minus fifteen metres.
    if (a.y < 1 && a.mode !== "launch") {
      a.hp = 0;
      b.planeDestroyed(a, a.lastAttacker);
      continue;
    }
    a.age += dt;
    a.fuel = Math.max(0, a.fuel - (dt * 100) / a.enduranceSeconds);
    a.gunTimer = Math.max(0, a.gunTimer - dt);
    a.attackCooldown = Math.max(0, a.attackCooldown - dt);
    rearGunner(b, a, dt);
    const home = shipsById.get(a.home);
    // The deck datum is a construction-time option, so the wrapper is rebound only when the aircraft's
    // own deck changes — a diversion to a carrier a metre lower otherwise rolls and lands on the
    // previous ship's deck height.
    if (home && home.deckHeight > 0) flight.setDeck(home.deckHeight);
    if (a.mode === "launch") {
      a.tactic = "launch";
      deckDeparture(b, a, home, dt);
      continue;
    }
    if (a.fuel <= 0) {
      a.engineCut = true;
      if (a.y < 5) {
        a.hp = 0;
        b.planeDestroyed(a, a.lastAttacker);
        continue;
      }
    }
    // Endurance is now a percentage, so the seconds a return leg needs are converted the same way.
    const returnFuel = (100 * (home ? distance2(a, home) / 80 + 50 : 85)) / a.enduranceSeconds;
    const hurt =
      a.hp < (a.maxHp || 100) * 0.35 ||
      a.damage.engine.integrity < 0.42 ||
      a.damage.leftWing.fire + a.damage.rightWing.fire + a.damage.engine.fire > 0.38;
    if (a.fuel < returnFuel || hurt || (a.kind === "fighter" && a.ammo <= 0) || (a.wing && b.command === "rtb")) a.mode = "rtb";
    if (a.mode === "rtb") {
      navigateHome(b, a, dt);
      continue;
    }
    if (
      (a.kind === "bomber" || a.kind === "torpedo") &&
      b.time < (a.musterUntil || 0) &&
      !(a.wing && b.player.mode === "flight") &&
      home &&
      !contactNear(b, a, 4600)
    ) {
      const hh = home.heading;
      const fhx = Math.sin(hh);
      const fhz = -Math.cos(hh);
      a.tactic = "muster";
      flyAircraft(
        a,
        aimPoint(home.x + fhx * 1900 + Math.sin(b.time * 0.025 + a.phase) * 650, home.z + fhz * 1900 + Math.cos(b.time * 0.025 + a.phase) * 650),
        a.kind === "torpedo" ? 550 : 1550,
        a.kind === "torpedo" ? 80 : 94,
        dt,
      );
      continue;
    }
    if (a.tactic === "egress") {
      if (b.time < (a.egressUntil || 0)) {
        flyAircraft(a, a.egressPoint, Math.max(350, a.y), 108, dt);
        continue;
      }
      a.mode = "rtb";
      navigateHome(b, a, dt);
      continue;
    }
    const avoid = a.avoid || (a.avoid = { x: 0, z: 0 });
    avoid.x = 0;
    avoid.z = 0;
    if (b.aircraft.length > 1) {
      const ax = a.x;
      const ay = a.y;
      const az = a.z;
      const others = b.aircraft;
      for (let i = 0, n = others.length; i < n; i += 1) {
        const other = others[i];
        if (other === a || other.hp <= 0) continue;
        const dx = ax - other.x;
        const dz = az - other.z;
        const dy = ay - other.y;
        const d2 = dx * dx + dy * dy + dz * dz;
        // Only the handful inside the 75 m separation bubble need a distance; everyone else is
        // rejected on the squared value, which is what makes this all-pairs scan affordable.
        if (d2 <= 1 || d2 >= 5625) continue;
        const d = Math.hypot(dx, dy, dz);
        const gain = ((75 - d) * 14) / d;
        avoid.x += dx * gain;
        avoid.z += dz * gain;
      }
    }
    let dest: Any;
    let alt = 1400;
    let speed = a.kind === "fighter" ? 117 : a.kind === "torpedo" ? 84 : a.kind === "recon" ? 83 : 103;
    if (a.kind === "recon") {
      a.tactic = "scouting";
      dest = a.team === "us" ? b.search : aimPoint(-500, 6300);
      alt = 1300;
      if (distance2(a, dest) < 1300) dest = aimPoint(dest.x + Math.sin(b.time * 0.018 + a.phase) * 2800, dest.z + Math.cos(b.time * 0.018 + a.phase) * 2800);
    } else if (a.kind === "fighter") {
      const t = chooseFighterTarget(b, a, shipsById);
      a.airTarget = t?.id || null;
      if (t) {
        const d = distance3(a, t);
        const fx = Math.sin(a.heading) * Math.cos(a.pitch);
        const fz = -Math.cos(a.heading) * Math.cos(a.pitch);
        if (d < 150 && a.tactic !== "extend") {
          a.tactic = "extend";
          a.extendUntil = b.time + 5;
          a.extendPoint = { x: a.x + fx * 1000, z: a.z + fz * 1000 };
        }
        if (a.tactic === "extend" && b.time < a.extendUntil) {
          dest = a.extendPoint;
          alt = a.y + 150;
          speed = 130;
        } else {
          a.tactic = "intercept";
          // A friendly fighter committing to an enemy strike aircraft is the air-defence duty, as
          // distinct from escort-engaged: the target is a bomber or torpedo making for the fleet.
          // One event per fighter-and-target engagement, never one per step while the run holds.
          if (a.team === "us" && (t.kind === "bomber" || t.kind === "torpedo") && a.airDefenceFor !== t.id) {
            a.airDefenceFor = t.id;
            b.event("support", { duty: "air-defence" });
          }
          const lead = clamp(d / 250, 0, 2.1);
          dest = aimPoint(t.x + (t.vx || 0) * lead, t.z + (t.vz || 0) * lead);
          alt = t.y;
          fireClear(b, a, t);
          const threat = b.aircraft.find(
            (e: Any) => e.team !== a.team && e.airTarget === a.id && distance3(e, a) < 700 && Math.abs(angleDelta(bearing(a, e), a.heading)) > 2.2,
          );
          if (threat && a.y > 220) {
            a.tactic = "evade";
            dest = aimPoint(
              a.x + Math.sin(a.heading + (Math.sin(b.time * 0.45 + a.phase) > 0 ? 1.1 : -1.1)) * 900,
              a.z - Math.cos(a.heading + (Math.sin(b.time * 0.45 + a.phase) > 0 ? 1.1 : -1.1)) * 900,
            );
            alt = a.y - 130;
          }
        }
      } else {
        const leader =
          a.wing && b.command === "cover" && b.player.mode === "flight"
            ? b.player
            : b.aircraft.find((e: Any) => e.home === a.home && e.kind !== "fighter" && e.kind !== "recon" && e.hp > 0 && e.mode === "flight");
        if (leader) {
          a.tactic = "escort";
          const lfx = Math.sin(leader.heading);
          const lfz = -Math.cos(leader.heading);
          dest = aimPoint(leader.x - lfx * 180 + Math.cos(leader.heading) * 140 * Math.sin(a.phase), leader.z - lfz * 180 + Math.sin(leader.heading) * 140 * Math.sin(a.phase));
          alt = leader.y + 110;
          speed = clamp(leader.speed + (distance2(a, leader) - 250) * 0.055, 67, 133);
        } else {
          a.tactic = "CAP";
          const h = home || b.search;
          dest = aimPoint(h.x + Math.sin(b.time * 0.018 + a.phase) * 1500, h.z + Math.cos(b.time * 0.018 + a.phase) * 1500);
          alt = 1350 + Math.sin(a.phase) * 250;
        }
      }
    } else if (a.wing && b.command === "cover" && b.player.mode === "flight") {
      a.tactic = "formation";
      const p = b.player;
      const pfx = Math.sin(p.heading);
      const pfz = -Math.cos(p.heading);
      dest = aimPoint(p.x - pfx * 130 + Math.cos(p.heading) * 95 * Math.sin(a.phase), p.z - pfz * 130 + Math.sin(p.heading) * 95 * Math.sin(a.phase));
      alt = p.y + 30;
      speed = clamp(p.speed + (distance2(a, p) - 160) * 0.1, 53, 128);
    } else {
      const t = selectNavalTarget(b, a) ?? islandTarget(b, a);
      if (!t) {
        a.tactic = "search";
        dest = a.team === "us" ? b.search : aimPoint(-500, 6300);
        alt = a.kind === "torpedo" ? 700 : 1750;
        if (distance2(a, dest) < 1800) dest = aimPoint(dest.x + Math.sin(b.time * 0.012 + a.phase) * 2300, dest.z + Math.cos(b.time * 0.012 + a.phase) * 2300);
      } else {
        const d = distance2(a, t);
        dest = t;
        a.tactic = "ingress";
        alt = a.kind === "torpedo" ? 450 : 1850;
        if (a.kind === "bomber" && d < 2250) {
          // A Nakajima B5N with bombs aboard attacked from level flight; only the Aichi and the
          // Douglas dived. The release solution is the same ballistic one either way — what differs
          // is the height it is flown at, and a level bomber never gives up its altitude.
          const level = a.airframe === "kate";
          a.tactic = level ? "level-bomb" : "dive";
          // `BOMB_POINT`/`BOMB_VEL` replace a spread of the whole aircraft record just to pass three
          // numbers. `BOMB_LEAD` is the lead point, refilled from the believed target.
          BOMB_POINT.x = a.x;
          BOMB_POINT.y = a.y - 1.6;
          BOMB_POINT.z = a.z;
          BOMB_VEL.x = a.vx;
          BOMB_VEL.y = a.vy - 2;
          BOMB_VEL.z = a.vz;
          const fall = bombImpact(BOMB_POINT, BOMB_VEL, 20);
          const thx = Math.sin(t.heading);
          const thz = -Math.cos(t.heading);
          Object.assign(BOMB_LEAD, t);
          BOMB_LEAD.x = t.x + thx * t.speed * fall.time;
          BOMB_LEAD.z = t.z + thz * t.speed * fall.time;
          const lead = BOMB_LEAD;
          dest = lead;
          alt = level ? 1850 : 160;
          if (onDeck(fall, lead, 5) && a.y > 140 && a.y < 2400 && a.bombs > 0) {
            b.dropBomb(a);
            a.tactic = "egress";
            a.egressUntil = b.time + 12;
            const ex = Math.sin(a.heading);
            const ez = -Math.cos(a.heading);
            a.egressPoint = { x: a.x + ex * 1800, z: a.z + ez * 1800 };
            alt = 650;
          }
          if (!level && a.y < 145 && a.bombs > 0) {
            a.tactic = "egress";
            a.egressUntil = b.time + 16;
            const ex2 = Math.sin(a.heading);
            const ez2 = -Math.cos(a.heading);
            a.egressPoint = { x: a.x + ex2 * 1800, z: a.z + ez2 * 1800 };
            alt = 650;
          }
        } else if (a.kind === "torpedo" && d < 4200) {
          a.tactic = "torpedo-run";
          alt = a.team === "us" ? 12 : 23;
          speed = a.team === "us" ? 51 : 70;
          dest = torpedoIntercept(a, t, a.team === "us" ? 17.25 : 21);
          const aligned = Math.abs(angleDelta(bearing(a, dest), a.heading)) < 0.075;
          // Released inside 650 m, not 1250. The intercept solution is exact and the belief error at
          // release measured zero, so the old drops were not badly aimed — they were simply too far
          // out: 1193 m is a 69-second run at 17.25 m/s, and a carrier making 8 m/s turns out of it
          // long before arrival. Measured miss distances were 297, 531, 1102 and 1158 m against a
          // 261 m hull, which is a ship that left rather than a torpedo that was off. Doctrine
          // agrees: the Mark 13 and the Type 91 were dropped at 400-800 m, and that is what 300-650
          // is. Torpedo hits over five seeded runs go from 2 of 39 releases to 3 of 29.
          if (d < 650 && d > 300 && aligned && torpedoEnvelope(a).safe && a.torpedo) {
            b.dropTorpedo(a);
            a.tactic = "egress";
            a.egressUntil = b.time + 13;
            const tex = Math.sin(a.heading + Math.PI / 3);
            const tez = -Math.cos(a.heading + Math.PI / 3);
            a.egressPoint = { x: a.x + tex * 1900, z: a.z + tez * 1900 };
            alt = 350;
          } else if (d < 230) {
            a.mode = "rtb";
            alt = 400;
          }
        }
      }
    }
    flyAircraft(a, dest || home || b.search, alt, speed, dt);
  }
  // Rebuild the roster only when something actually left it; the common step removes nobody, and a
  // fresh 68-element array every step is pure garbage.
  let anyGone = false;
  for (const a of b.aircraft) {
    if (a.removed || a.recovered) {
      anyGone = true;
      break;
    }
  }
  if (anyGone) b.aircraft = b.aircraft.filter((a: Any) => !a.removed && !a.recovered);
}
