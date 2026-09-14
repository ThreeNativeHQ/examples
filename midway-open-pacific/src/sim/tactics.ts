/** Perception-limited tactical AI. Game-tuned flight envelopes, not pilot/airfoil data. */
import {
  angleDelta,
  bearing,
  bombImpact,
  clamp,
  distance2,
  distance3,
  forward,
  lerp,
  onDeck,
  segmentDistance,
  wrap,
} from "./math.js";
import { damageModifiers, initDamage, stepDamage } from "./damage.js";
import { torpedoEnvelope, torpedoIntercept, updateStores } from "./armament.js";
import { AircraftFlight, DECK_HEIGHT, initFlightState, steerToward, type ISteerLimits } from "./flight.js";
import { estimatePosition, isStale, STALE_SECONDS } from "./intel.js";

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
  const e = estimatePosition(c, b.time);
  const hull = CLASS_HULL[c.classification] ?? CLASS_HULL.unknown;
  return {
    ...c,
    x: e.x,
    z: e.z,
    y: 0,
    uncertainty: e.radius,
    age: b.time - c.observedAt,
    deckLength: hull.length,
    deckWidth: hull.width,
    hullLength: hull.length,
    hullBeam: hull.width,
    id: c.id,
  };
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
    if (c.lost || isStale(c, b.time, STALE_SECONDS) || !STRIKE_CLASSES.has(c.classification)) continue;
    const e = estimatePosition(c, b.time);
    const d = distance2(s, e);
    if (d > STRIKE_RADIUS) continue;
    const rank = d + e.radius * 4 + (c.classification === "cruiser" ? 8000 : 0);
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
  const threat = b.aircraft.filter(
    (a: Any) => a.team !== s.team && a.hp > 0 && a.kind !== "recon" && distance2(a, s) < 9000,
  ).length;
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

export function selectNavalTarget(b: Any, a: Any): Any {
  const known = b.teamIntel[a.team];
  if (!known) return null;
  // A player-ordered wing uses the same eligible designation as map/TAB and the sortie.
  // It still needs a delivered report and steers at that estimate, never at the live hull.
  if (a.team === "us" && a.wing && b.command === "strike") {
    const c = known.get(b.target);
    if (!c || c.lost || isStale(c, b.time, STALE_SECONDS) || !b.targetContacts().some((r: Any) => r.id === c.id)) return null;
    a.target = c.id;
    return believedTarget(b, c);
  }
  const candidates = [...known.values()].filter(
    (c: Any) => !c.lost && !isStale(c, b.time, STALE_SECONDS) && STRIKE_CLASSES.has(c.classification),
  );
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
  for (const c of candidates) {
    const pressure = b.aircraft.filter(
      (other: Any) => other.id !== a.id && other.team === a.team && other.target === c.id && other.bombs + other.torpedo > 0,
    ).length;
    const e = estimatePosition(c, b.time);
    // An uncertain, poorly identified report is worth attacking less than a tight one. The target's
    // own damage state is deliberately absent: nobody outside that ship knows it.
    const rank = distance2(a, e) + pressure * 1150 + e.radius * 3 + (1 - c.confidence) * 3000;
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

export function chooseFighterTarget(b: Any, a: Any): Any {
  const home = b.ships.find((s: Any) => s.id === a.home);
  const candidates = b.aircraft.filter(
    (e: Any) => e.team !== a.team && e.hp > 0 && e.mode !== "launch" && distance3(e, a) < 3500,
  );
  if (a.team === "jp" && b.player.mode === "flight" && b.player.hp > 0 && distance3(a, b.player) < 3500)
    candidates.push(b.player);
  let best: Any = null;
  let score = -Infinity;
  for (const e of candidates) {
    const d = distance3(a, e);
    const strike = e.kind === "bomber" || e.kind === "torpedo";
    const danger = home && distance2(e, home) < 4800;
    const attacking = b.aircraft.filter((f: Any) => f.team === a.team && f !== a && f.airTarget === e.id).length;
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
 * deliver what is asked, and refuses by stalling or sinking rather than by clamping.
 */
function limitsFor(a: Any): ISteerLimits {
  switch (a.tactic) {
    case "dive":
      return { bank: 0.9, climb: 8, floor: 55, lead: 80, sink: 115 };
    // A fixed aim distance, so the run-in descends to release height at once instead of easing down
    // over the whole approach and arriving over the ship still too high to drop.
    case "torpedo-run":
      return { bank: 0.6, climb: 6, floor: 6, lead: 550, leadMax: 550, sink: 32 };
    case "landing":
      return { bank: 0.5, climb: 5, floor: 6, sink: 5.5 };
    case "ditching":
      return { bank: 0.4, climb: 2, floor: 0, sink: 4 };
    case "evade":
      return { bank: 1.1, climb: 12, floor: 55, sink: 30 };
    default:
      return a.kind === "fighter"
        ? { bank: 1.02, climb: 11, floor: 55, sink: 18 }
        : { bank: 0.73, climb: 8, floor: 55, sink: 12 };
  }
}

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
  const m = damageModifiers(a);
  const avoid = a.avoid || { x: 0, z: 0 };
  const aim = { x: dest.x + avoid.x, z: dest.z + avoid.z };
  const slow = a.tactic === "landing" || a.tactic === "torpedo-run";
  // Configuration follows the tactic: flaps for slow flight and the climb-out, dive brakes to hold a
  // dive-bomber's speed inside its release window, wheels only to land.
  a.flaps = slow || a.y < 120 ? 0.33 : 0;
  a.gear = a.tactic === "landing";
  a.brakes = a.tactic === "dive";
  // Power is trimmed, not scheduled: a proportional lever droops, and a torpedo bomber that settles
  // six knots above its release limit never drops. `throttle` is the engine's own state field — there
  // is no throttle control input — and the engine lags `rpm` towards it, which damps this.
  a.throttle = clamp(a.throttle + (targetSpeed - (a.ias || a.speed)) * dt * 0.06, 0, 1);
  // With the engine gone the aircraft glides: no floor to hold, no climb to command, so it really
  // does trade height for speed instead of being held up by a minimum-speed rule.
  const limits: ISteerLimits =
    m.power < 0.12 ? { ...limitsFor(a), climb: -2, floor: undefined } : limitsFor(a);
  fl.step(dt, steerToward(a, aim, alt, limits));
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
    const ahead = b.aircraft.filter(
      (o: Any) => o !== a && o.home === a.home && o.mode === "launch" && o.deckRun !== undefined,
    ).length;
    Object.assign(a, {
      brakes: false,
      chocks: true,
      deckLateral: 0,
      deckOffset: Math.max(-(home.deckLength / 2) + 6, -(home.deckLength / 2) + 10 - 14 * ahead),
      deckRun: "spotted",
      deckSpeed: 0,
      flaps: 0.33,
      gear: true,
      heading: home.heading,
      pitch: 0.22,
      speed: 0,
      throttle: 0.2,
    });
    fl.reset();
  }
  if (a.deckRun === "spotted") {
    const rolling = b.aircraft.some((o: Any) => o !== a && o.home === a.home && o.deckRun === "rolling");
    if (!rolling) {
      a.deckRun = "rolling";
      a.throttle = 1;
    }
  }
  const departure = fl.stepDeck(
    {
      heading: home.heading,
      length: home.deckLength,
      speed: home.speed,
      width: home.deckWidth,
      x: home.x,
      z: home.z,
    },
    dt,
    // The deck is a moving, turning frame: a ship under helm rotates the corridor out from under an
    // aircraft that holds its launch heading, and the run then ends as a lateral overrun at half
    // flying speed. Steer down the deck instead.
    { pitch: 0, rudder: clamp(angleDelta(home.heading, a.heading) * 6, -1, 1) },
  );
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
  const point = { x: t.x + (t.vx || 0) * lead, y: t.y + (t.vy || 0) * lead, z: t.z + (t.vz || 0) * lead };
  const f = forward(a.heading, a.pitch);
  const len = distance3(a, point) || 1;
  const dot = ((point.x - a.x) * f.x + (point.y - a.y) * f.y + (point.z - a.z) * f.z) / len;
  if (d > 850 || dot < 0.994 || a.ammo <= 0) return false;
  if (b.aircraft.some((p: Any) => p.team === a.team && p.id !== a.id && p.hp > 0 && distance3(a, p) < d && segmentDistance(a, point, p) < 17))
    return false;
  b.fire(a, t);
  return true;
}

export function rearGunner(b: Any, a: Any, dt: number): void {
  if (a.kind === "fighter" || a.kind === "recon" || !(a.rearAmmo > 0) || a.mode === "crashing") return;
  a.rearTimer = Math.max(0, (a.rearTimer || 0) - dt);
  if (a.rearTimer > 0) return;
  const f = forward(a.heading, a.pitch);
  const foes = b.aircraft.filter((e: Any) => e.team !== a.team && e.hp > 0);
  if (a.team === "jp" && b.player.mode === "flight") foes.push(b.player);
  const t = foes.find((e: Any) => {
    const d = distance3(a, e);
    return d < 650 && d > 25 && ((e.x - a.x) * f.x + (e.y - a.y) * f.y + (e.z - a.z) * f.z) / (d || 1) < -0.6 && (e.y - a.y) / d > -0.13;
  });
  if (!t) return;
  const d = distance3(a, t);
  const tt = d / 730;
  const aim = { x: t.x + (t.vx || 0) * tt - a.x, y: t.y + (t.vy || 0) * tt - a.y, z: t.z + (t.vz || 0) * tt - a.z };
  const len = Math.hypot(aim.x, aim.y, aim.z) || 1;
  a.rearTimer = 0.28;
  a.rearAmmo -= 1;
  b.event("gun", {
    at: { x: a.x - f.x * 4, y: a.y + 0.8, z: a.z - f.z * 4 },
    source: a.id,
    weapon: "gun30",
  });
  b.bullets.push({
    id: b.id("bullet"),
    x: a.x - f.x * 4,
    y: a.y + 0.8,
    z: a.z - f.z * 4,
    vx: (aim.x / len) * 730 + (b.random() - 0.5) * 13,
    vy: (aim.y / len) * 730 + (b.random() - 0.5) * 13,
    vz: (aim.z / len) * 730 + (b.random() - 0.5) * 13,
    ttl: 1.1,
    team: a.team,
    owner: a.id,
    type: "gun",
    damage: 3,
  });
}

export function navigateHome(b: Any, a: Any, dt: number): void {
  let h = b.ships.find((s: Any) => s.id === a.home && !s.sunk && s.deck > 0.3);
  if (!h)
    h = b.ships
      .filter((s: Any) => s.team === a.team && s.kind === "carrier" && !s.sunk && s.deck > 0.3)
      .sort((s: Any, t: Any) => distance2(a, s) - distance2(a, t))[0];
  if (a.home === "midway") h = b.island;
  if (!h) {
    a.tactic = "ditching";
    flyAircraft(a, { x: a.x + Math.sin(a.heading) * 1000, z: a.z - Math.cos(a.heading) * 1000 }, 3, 48, dt);
    if (a.y < 4) {
      b.recordLoss(a);
      a.removed = true;
      b.fx("splash", a, 1.6);
    }
    return;
  }
  a.home = h.id || "midway";
  const f = forward(h.heading || 0);
  const astern = { x: h.x - f.x * 520, z: h.z - f.z * 520 };
  // The straight deck: a launch or another recovery in progress, or any suspended condition, keeps
  // this aircraft in the pattern. `Battle.recoverAircraft` is the same test at the moment of contact.
  const busy = (h.deckState?.occupiedUntil ?? 0) > b.time || h.deckState?.suspended != null || (h.evadeUntil || 0) > b.time;
  if (a.tactic !== "landing" && (distance2(a, astern) > 350 || Math.abs(angleDelta(bearing(a, h), h.heading || 0)) > 0.65 || busy)) {
    a.tactic = "rtb";
    flyAircraft(
      a,
      busy ? { x: h.x + Math.sin(b.time * 0.025 + a.phase) * 1300, z: h.z + Math.cos(b.time * 0.025 + a.phase) * 1300 } : astern,
      busy ? 450 : Math.max(90, Math.min(900, distance2(a, astern) * 0.14)),
      a.kind === "fighter" ? 94 : 84,
      dt,
    );
    return;
  }
  a.tactic = "landing";
  const along = (a.x - h.x) * f.x + (a.z - h.z) * f.z;
  flyAircraft(a, { x: h.x + f.x * 140, z: h.z + f.z * 140 }, h.id ? 22 + Math.max(0, -along - 65) * 0.08 : 10, 51, dt);
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
  for (const a of b.aircraft) {
    if (a.recovered || a.removed) continue;
    if (a.mode === "crashing") {
      a.crashAge = (a.crashAge || 0) + dt;
      a.roll += (a.phase > 3 ? 1 : -1) * dt * 0.9;
      a.pitch = Math.max(-1.3, a.pitch - dt * 0.15);
      a.vy = (a.vy || 0) - 9.81 * dt;
      a.vx *= Math.exp(-dt * 0.04);
      a.vz *= Math.exp(-dt * 0.04);
      a.x += (a.vx || 0) * dt;
      a.z += (a.vz || 0) * dt;
      a.y += a.vy * dt;
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
    a.age += dt;
    a.fuel = Math.max(0, a.fuel - (dt * 100) / a.enduranceSeconds);
    a.gunTimer = Math.max(0, a.gunTimer - dt);
    a.attackCooldown = Math.max(0, a.attackCooldown - dt);
    rearGunner(b, a, dt);
    const home = b.ships.find((s: Any) => s.id === a.home);
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
      ![...b.teamIntel[a.team].values()].some(
        (c: Any) => !isStale(c, b.time, STALE_SECONDS) && distance2(a, estimatePosition(c, b.time)) < 4600,
      )
    ) {
      const f = forward(home.heading);
      a.tactic = "muster";
      flyAircraft(
        a,
        { x: home.x + f.x * 1900 + Math.sin(b.time * 0.025 + a.phase) * 650, z: home.z + f.z * 1900 + Math.cos(b.time * 0.025 + a.phase) * 650 },
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
    a.avoid = { x: 0, z: 0 };
    for (const other of b.aircraft) {
      if (other === a || other.hp <= 0) continue;
      const d = distance3(a, other);
      if (d > 1 && d < 75) {
        const gain = ((75 - d) * 14) / d;
        a.avoid.x += (a.x - other.x) * gain;
        a.avoid.z += (a.z - other.z) * gain;
      }
    }
    let dest: Any;
    let alt = 1400;
    let speed = a.kind === "fighter" ? 117 : a.kind === "torpedo" ? 84 : a.kind === "recon" ? 83 : 103;
    if (a.kind === "recon") {
      a.tactic = "scouting";
      dest = a.team === "us" ? b.search : { x: -500, y: 1000, z: 6300 };
      alt = 1300;
      if (distance2(a, dest) < 1300) dest = { x: dest.x + Math.sin(b.time * 0.018 + a.phase) * 2800, z: dest.z + Math.cos(b.time * 0.018 + a.phase) * 2800 };
    } else if (a.kind === "fighter") {
      const t = chooseFighterTarget(b, a);
      a.airTarget = t?.id || null;
      if (t) {
        const d = distance3(a, t);
        const f = forward(a.heading, a.pitch);
        if (d < 150 && a.tactic !== "extend") {
          a.tactic = "extend";
          a.extendUntil = b.time + 5;
          a.extendPoint = { x: a.x + f.x * 1000, z: a.z + f.z * 1000 };
        }
        if (a.tactic === "extend" && b.time < a.extendUntil) {
          dest = a.extendPoint;
          alt = a.y + 150;
          speed = 130;
        } else {
          a.tactic = "intercept";
          const lead = clamp(d / 250, 0, 2.1);
          dest = { x: t.x + (t.vx || 0) * lead, z: t.z + (t.vz || 0) * lead };
          alt = t.y;
          fireClear(b, a, t);
          const threat = b.aircraft.find(
            (e: Any) => e.team !== a.team && e.airTarget === a.id && distance3(e, a) < 700 && Math.abs(angleDelta(bearing(a, e), a.heading)) > 2.2,
          );
          if (threat && a.y > 220) {
            a.tactic = "evade";
            dest = {
              x: a.x + Math.sin(a.heading + (Math.sin(b.time * 0.45 + a.phase) > 0 ? 1.1 : -1.1)) * 900,
              z: a.z - Math.cos(a.heading + (Math.sin(b.time * 0.45 + a.phase) > 0 ? 1.1 : -1.1)) * 900,
            };
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
          const f = forward(leader.heading);
          dest = { x: leader.x - f.x * 180 + Math.cos(leader.heading) * 140 * Math.sin(a.phase), z: leader.z - f.z * 180 + Math.sin(leader.heading) * 140 * Math.sin(a.phase) };
          alt = leader.y + 110;
          speed = clamp(leader.speed + (distance2(a, leader) - 250) * 0.055, 67, 133);
        } else {
          a.tactic = "CAP";
          const h = home || b.search;
          dest = { x: h.x + Math.sin(b.time * 0.018 + a.phase) * 1500, z: h.z + Math.cos(b.time * 0.018 + a.phase) * 1500 };
          alt = 1350 + Math.sin(a.phase) * 250;
        }
      }
    } else if (a.wing && b.command === "cover" && b.player.mode === "flight") {
      a.tactic = "formation";
      const p = b.player;
      const f = forward(p.heading);
      dest = { x: p.x - f.x * 130 + Math.cos(p.heading) * 95 * Math.sin(a.phase), z: p.z - f.z * 130 + Math.sin(p.heading) * 95 * Math.sin(a.phase) };
      alt = p.y + 30;
      speed = clamp(p.speed + (distance2(a, p) - 160) * 0.1, 53, 128);
    } else {
      const t = selectNavalTarget(b, a);
      if (!t) {
        a.tactic = "search";
        dest = a.team === "us" ? b.search : { x: -500, z: 6300 };
        alt = a.kind === "torpedo" ? 700 : 1750;
        if (distance2(a, dest) < 1800) dest = { x: dest.x + Math.sin(b.time * 0.012 + a.phase) * 2300, z: dest.z + Math.cos(b.time * 0.012 + a.phase) * 2300 };
      } else {
        const d = distance2(a, t);
        dest = t;
        a.tactic = "ingress";
        alt = a.kind === "torpedo" ? 450 : 1850;
        if (a.kind === "bomber" && d < 2250) {
          a.tactic = "dive";
          const fall = bombImpact({ ...a, y: a.y - 1.6 }, { x: a.vx, y: a.vy - 2, z: a.vz }, 20);
          const tf = forward(t.heading);
          const lead = { ...t, x: t.x + tf.x * t.speed * fall.time, z: t.z + tf.z * t.speed * fall.time };
          dest = lead;
          alt = 160;
          if (onDeck(fall, lead, 5) && a.y > 140 && a.y < 2400 && a.bombs > 0) {
            b.dropBomb(a);
            a.tactic = "egress";
            a.egressUntil = b.time + 12;
            const f = forward(a.heading);
            a.egressPoint = { x: a.x + f.x * 1800, z: a.z + f.z * 1800 };
            alt = 650;
          }
          if (a.y < 145 && a.bombs > 0) {
            a.tactic = "egress";
            a.egressUntil = b.time + 16;
            const f = forward(a.heading);
            a.egressPoint = { x: a.x + f.x * 1800, z: a.z + f.z * 1800 };
            alt = 650;
          }
        } else if (a.kind === "torpedo" && d < 4200) {
          a.tactic = "torpedo-run";
          alt = a.team === "us" ? 12 : 23;
          speed = a.team === "us" ? 51 : 70;
          dest = torpedoIntercept(a, t, a.team === "us" ? 17.25 : 21);
          const aligned = Math.abs(angleDelta(bearing(a, dest), a.heading)) < 0.075;
          if (d < 1250 && d > 260 && aligned && torpedoEnvelope(a).safe && a.torpedo) {
            b.dropTorpedo(a);
            a.tactic = "egress";
            a.egressUntil = b.time + 13;
            const f = forward(a.heading + Math.PI / 3);
            a.egressPoint = { x: a.x + f.x * 1900, z: a.z + f.z * 1900 };
            alt = 350;
          } else if (d < 230) {
            a.mode = "rtb";
            alt = 400;
          }
        }
      }
    }
    flyAircraft(a, dest || home || b.search, alt, speed, dt);
    if (a.y < 1) {
      a.hp = 0;
      b.planeDestroyed(a, a.lastAttacker);
    }
  }
  b.aircraft = b.aircraft.filter((a: Any) => !a.removed && !a.recovered);
}
