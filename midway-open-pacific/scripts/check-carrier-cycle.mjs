/**
 * Carrier-cycle and contact-intelligence check (PRD AC-7 to AC-10, AC-13).
 *
 * `check-carrier-ops.mjs` and `check-intel.mjs` already prove the two pure modules in isolation.
 * This one proves the *wiring*: it drives the real `Battle` through `step` and its ordinary entry
 * points only — no direct writes to a mission, a deck mode, a tactic or a contact record — and
 * asserts the things a screenshot and a playtest cannot see. A fleet that quietly grows or empties
 * over twelve minutes, a blocked launch that silently spent a torpedo, or an AI that reads a ship's
 * true position instead of the report it was sent all look completely normal on screen.
 *
 * Uses the esbuild vite already installs. Run: node scripts/check-carrier-cycle.mjs
 */
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { build } from "esbuild";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const built = await build({
  stdin: {
    contents: `
      export { Battle, ACTIVE_CAP } from "./src/sim/battle.ts";
      export { selectNavalTarget } from "./src/sim/tactics.ts";
      export { STALE_SECONDS, estimatePosition } from "./src/sim/intel.ts";
    `,
    loader: "ts",
    resolveDir: root,
  },
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node20",
  write: false,
  logLevel: "silent",
});
const { Battle, ACTIVE_CAP, selectNavalTarget, STALE_SECONDS, estimatePosition } = await import(
  `data:text/javascript,${encodeURIComponent(built.outputFiles[0].text)}`
);

const STEP = 1 / 30;
/**
 * How long the old report is left to age: short of `STALE_SECONDS`, so it is still a live belief, and
 * short of the moment the oncoming Japanese strike gets close enough to file a fresh one of its own.
 */
const STALE_WINDOW = 105;
const carriersOf = (b) => b.ships.filter((s) => s.air);
const aboard = (s) => Object.values(s.air.airframes).reduce((a, c) => a + c, 0);
const airborneFrom = (b, s) => b.aircraft.filter((a) => a.hp > 0 && a.home === s.id).length;
const ready = (s) => Object.values(s.air.ready).reduce((a, c) => a + c, 0);

/**
 * One run, with every launch recorded as it happens. The wrapper only observes: it calls the real
 * method and passes its result straight back, so the run is exactly the run the game would have had.
 */
function run(seed, seconds, setup = () => {}, input = () => ({}), after = () => {}) {
  const b = new Battle(seed);
  const log = [];
  const launch = b.launch.bind(b);
  b.launch = (s, role) => {
    const a = launch(s, role);
    if (a) log.push({ ship: s.name, role, airframe: a.airframe, time: b.time });
    return a;
  };
  setup(b);
  const initial = new Map();
  for (const s of carriersOf(b)) initial.set(s.id, aboard(s));
  b.start();
  // A spectator player is neither shot at nor able to end the run, so the fleet's own cycle is what
  // is under test rather than one pilot's luck.
  b.player.mode = "spectator";
  after(b);
  const samples = [];
  const steps = Math.round(seconds / STEP);
  for (let i = 0; i < steps; i += 1) {
    b.step(STEP, input(i));
    if (i % 60 === 0)
      for (const s of carriersOf(b))
        if (s.launchBlocked) samples.push({ ship: s.name, reason: s.launchBlocked, launched: s.launchCount, time: b.time });
  }
  return { b, log, samples, initial };
}

/** Everything a repeated run must reproduce exactly. Radio text is prose, so it is left out. */
function digest(b) {
  const r = (n) => Math.round(n * 1000) / 1000;
  return JSON.stringify({
    time: r(b.time),
    score: b.score,
    status: b.status,
    ships: b.ships.map((s) => [
      s.id,
      r(s.x),
      r(s.z),
      r(s.hp),
      r(s.deck),
      r(s.fire),
      r(s.list ?? 0),
      s.air ? [aboard(s), ready(s), JSON.stringify(s.air.stores), r(s.air.fuel), s.lostAircraft, s.writtenOff] : 0,
    ]),
    aircraft: b.aircraft.map((a) => [a.id, a.kind, a.airframe, r(a.x), r(a.z), r(a.y), r(a.hp), a.target ?? "", a.tactic ?? ""]),
    contacts: [...b.contacts.values()].map((c) => [c.id, c.kind, r(c.observedAt), r(c.errorRadius)]),
    intel: ["us", "jp"].map((t) => [...b.teamIntel[t].values()].map((c) => [c.id, c.kind, r(c.observedAt)])),
    reports: b.reports.map((c) => [c.id, c.team, r(c.deliveredAt)]),
  });
}

/**
 * A single scout, put where it can actually see the enemy, and nothing else in sight of anybody. The
 * aircraft already exists and is already flying; only its position is set, which is a fact about the
 * world rather than a decision taken for the AI.
 */
function scoutOver(b, target, height = 900) {
  const scout = b.aircraft.find((a) => a.team !== target.team && a.hp > 0 && a.kind !== "recon");
  assert.ok(scout, "the launched CAP should provide an aircraft to use as a scout");
  Object.assign(scout, { x: target.x + 1200, z: target.z, y: height, mode: "flight" });
  return scout;
}

const notes = [];

// 1 — over twelve simulated minutes, every airframe is still accounted for. An aircraft is aboard a
//     deck, airborne, lost in action, or written off by a failed repair: never anything else, and
//     never invented. Cross-decking moves airframes between ships, so the sum is per team.
{
  const { b, samples, initial } = run(19420604, 12 * 60);
  for (const team of ["us", "jp"]) {
    const fleet = carriersOf(b).filter((s) => s.team === team);
    const start = fleet.reduce((n, s) => n + initial.get(s.id), 0);
    const now = fleet.reduce((n, s) => n + aboard(s) + airborneFrom(b, s) + s.lostAircraft + s.writtenOff, 0);
    assert.equal(now, start, `${team}: ${now} airframes accounted for, from ${start}`);
    assert.ok(fleet.some((s) => s.launchCount > 4), `${team} decks barely operated: ${fleet.map((s) => s.launchCount)}`);
  }
  // Real losses actually happened, so the conservation above is not the trivial case of a quiet sea.
  const lost = carriersOf(b).reduce((n, s) => n + s.lostAircraft, 0);
  assert.ok(lost > 5, `only ${lost} aircraft lost in twelve minutes; conservation was not exercised`);
  assert.ok(carriersOf(b).some((s) => Object.values(s.air.servicing).some((n) => n > 0) || Object.values(s.air.damaged).some((n) => n > 0)),
    "no deck ever had an aircraft in service or under repair");

  // 2a — the active cap was reached, refused a launch by name, and that deck launched again later.
  const capped = samples.filter((s) => s.reason === "active cap");
  assert.ok(capped.length, "the 68-aircraft cap was never reached in twelve minutes of operations");
  const first = capped[0];
  const after = carriersOf(b).find((s) => s.name === first.ship);
  assert.ok(
    after.launchCount > first.launched,
    `${first.ship} was blocked at the cap with ${first.launched} launches and never launched again`,
  );
  notes.push(`12 min: ${lost} aircraft lost, ${capped.length} cap refusals, all airframes accounted for`);
}

// 2b — a launch refused at the cap spends nothing at all: not an aircraft, not a store, not fuel.
{
  const b = new Battle(3);
  const h = b.ships[0];
  assert.equal(b.deckSuspension(h), null, "an undamaged deck is not suspended");
  const before = JSON.stringify(h.air);
  const occupied = h.deckState.occupiedUntil;
  for (let i = 0; i < ACTIVE_CAP; i += 1) b.aircraft.push({ id: `dummy-${i}`, team: "jp", kind: "fighter", hp: 100 });
  assert.equal(b.launch(h, "torpedo"), null, "a launch at the active cap must be refused");
  assert.equal(h.launchBlocked, "active cap", `the refusal must name the cap, got ${h.launchBlocked}`);
  assert.equal(JSON.stringify(h.air), before, "a queued launch consumed inventory, stores or fuel");
  assert.equal(h.deckState.occupiedUntil, occupied, "a queued launch fouled the deck");
  b.aircraft.length = 0;
  const flown = b.launch(h, "torpedo");
  assert.ok(flown, "the same launch must succeed once a slot frees");
  assert.equal(flown.airframe, "tbd", `a US torpedo launch is a TBD, got ${flown.airframe}`);
  assert.equal(JSON.parse(before).ready.tbd - h.air.ready.tbd, 1, "a real launch spends exactly one aircraft");
  assert.equal(JSON.parse(before).stores.torpedo - h.air.stores.torpedo, 1, "and exactly one torpedo");
}

// 3 — what a deck launches follows from what it has and what it has been told. Three separate
//     changes, each to one input, each changing that carrier's next mission.
{
  const seconds = 6 * 60;
  const control = run(77, seconds);
  const kateLaunches = (r, ship) => r.log.filter((e) => e.ship === ship && e.airframe === "kate").length;

  // 3a — stores. Kaga with no torpedoes flies no torpedo aircraft, and still flies everything else.
  const noTorps = run(77, seconds, (b) => {
    b.ships.find((s) => s.name === "Kaga").air.stores.torpedo = 0;
  });
  assert.ok(kateLaunches(control, "Kaga") > 0, "the control run should have flown Kaga's torpedo aircraft");
  assert.equal(kateLaunches(noTorps, "Kaga"), 0, "a deck with no torpedoes must not fly torpedo aircraft");
  assert.ok(
    noTorps.log.filter((e) => e.ship === "Kaga").length > 0,
    "and it must still fly the aircraft it can arm",
  );

  // 3b — ready aircraft. Soryu with no fighters aboard flies none, without stopping operating.
  const noFighters = run(77, seconds, (b) => {
    const s = b.ships.find((x) => x.name === "Soryu");
    s.air.ready.zero = 0;
    s.air.airframes.zero = 0;
  });
  const zeros = (r) => r.log.filter((e) => e.ship === "Soryu" && e.airframe === "zero").length;
  assert.ok(zeros(control) > 0, "the control run should have flown Soryu's fighters");
  assert.equal(zeros(noFighters), 0, "a deck with no ready fighters must not fly one");
  assert.ok(noFighters.log.some((e) => e.ship === "Soryu"), "and it must still fly its other aircraft");

  // 3c — contacts. A carrier that has been sent a report of an enemy carrier arms a strike; the same
  //      deck at the same moment with nothing reported puts up patrol and search aircraft instead.
  // One Japanese aircraft put where it can actually see the US carriers, at the start of the run, and
  // the identical battle without it. Nothing else about the two runs differs.
  const informed = run(77, 150, undefined, undefined, (b) => scoutOver(b, b.ships.find((s) => s.name === "USS Enterprise")));
  const blind = run(77, 150);
  // Only the side that was given the sighting. The other side's own scouts find things in both runs.
  const JP = new Set(["Akagi", "Kaga", "Soryu", "Hiryu"]);
  const jpStrike = (r) => r.log.filter((e) => JP.has(e.ship) && (e.role === "torpedo" || e.role === "bomber")).length;
  const informedStrike = jpStrike(informed);
  const blindStrike = jpStrike(blind);
  assert.ok(
    informedStrike > blindStrike,
    `a delivered contact must change the mission: ${informedStrike} strike launches informed vs ${blindStrike} blind`,
  );

  // 3d — nothing is on a launch sequence. The old rule picked the type from a modulo of the launch
  //      count; assert the real sequence is not that sequence.
  for (const ship of ["Kaga", "USS Enterprise"]) {
    const roles = control.log.filter((e) => e.ship === ship).map((e) => e.role);
    const modulo = roles.map((_, i) => (i % 4 === 0 ? "fighter" : i % 3 === 0 ? "torpedo" : "bomber"));
    assert.ok(roles.length > 3, `${ship} launched too little to judge: ${roles}`);
    assert.notDeepEqual(roles, modulo, `${ship} still launches on the modulo sequence: ${roles}`);
  }

  // 3e — no behaviour hangs off a ship's name. Renaming one carrier after the fleet is built changes
  //      nothing at all, which the old Hiryu-only scout launch would have failed.
  const renamed = run(77, 90, (b) => {
    b.ships.find((s) => s.name === "Hiryu").name = "Unryu";
  });
  const plain = run(77, 90);
  assert.equal(
    digest(renamed.b).replace(/Unryu/g, "Hiryu"),
    digest(plain.b),
    "renaming a carrier changed the battle, so something still keys off a ship's name",
  );
  notes.push(
    `missions: Kaga kates ${kateLaunches(control, "Kaga")}→0 with no torpedoes, strike launches ${blindStrike}→${informedStrike} with a contact`,
  );
}

// 4, 5, 6 — one scouting scenario, three properties: an unobserved ship is not a target, a dead
//           scout's transmitted report still arrives while no new ones do, and an old report sends
//           the attack to where the ship was going rather than where it is.
{
  const b = new Battle(23);
  b.start();
  b.player.mode = "spectator";
  const enterprise = b.ships.find((s) => s.name === "USS Enterprise");
  const striker = () => b.aircraft.find((a) => a.team === "jp" && a.hp > 0);

  // 4 — before anybody has seen anything, no Japanese aircraft can be sent at a US carrier at all.
  assert.equal(b.teamIntel.jp.size, 0, "nothing should be known at the start of the battle");
  for (const a of b.aircraft.filter((x) => x.team === "jp")) assert.equal(selectNavalTarget(b, a), null, "an unobserved fleet is not a target");
  assert.equal(b.teamIntel.us.size + b.teamIntel.jp.size, 0, "neither side holds a report yet");

  const scout = scoutOver(b, enterprise);
  for (let i = 0; i < Math.round(1.5 / STEP); i += 1) b.step(STEP, {});
  const filed = b.reports.filter((r) => r.team === "jp" && r.id === enterprise.id);
  assert.equal(filed.length, 1, `one sighting should have been filed, got ${filed.length}`);
  assert.ok(!b.teamIntel.jp.has(enterprise.id), "a report is not held by the fleet before it is delivered");
  assert.ok(filed[0].deliveredAt > b.time, "the report must still be in transmission");
  assert.equal(filed[0].deck, undefined, "a report must not carry the ship's deck health");
  assert.equal(filed[0].hp, undefined, "nor its hit points");

  // Sighted, the task force turns east. The report on the air describes the northerly course it was
  // seen on, which is what the strike will be sent to fly.
  for (const s of b.ships.filter((x) => x.team === "us" && x.kind !== "sub")) s.cruiseHeading = Math.PI / 2;
  const start = { x: enterprise.x, z: enterprise.z };

  // 5 — kill the scout. The report it already transmitted still arrives; no new one follows it.
  scout.hp = 0;
  b.step(STEP, {});
  assert.ok(scout.hp <= 0, "the scout should be dead");
  const observedAt = filed[0].observedAt;
  for (let i = 0; i < Math.round(40 / STEP); i += 1) b.step(STEP, {});
  const held = b.teamIntel.jp.get(enterprise.id);
  assert.ok(held, "a report already on the air must be delivered even though its observer is dead");
  assert.equal(held.observedAt, observedAt, "and it must be that same report");
  for (let i = 0; i < Math.round(20 / STEP); i += 1) b.step(STEP, {});
  assert.equal(
    b.teamIntel.jp.get(enterprise.id).observedAt,
    observedAt,
    "a dead scout must not go on producing new sightings",
  );

  // 4b — what the strike is now sent at is the belief, never the ship: no exact position, no deck.
  const target = selectNavalTarget(b, striker());
  assert.ok(target, "a delivered carrier contact should produce a target");
  assert.equal(target.id, enterprise.id);
  assert.equal(target.deck, undefined, "an AI target must not carry the ship's deck health");
  assert.ok(target.uncertainty > 0, "an AI target must carry its uncertainty");

  // Metadata regression on copies: selecting an ordered contact also updates what the HUD reads.
  for (const previous of [null, "previous-contact"]) {
    const actor = { ...striker(), wing: true, target: previous };
    const ordered = selectNavalTarget({ ...b, command: "strike", target: enterprise.id }, actor);
    assert.equal(ordered.id, enterprise.id);
    assert.equal(actor.target, ordered.id, "ordered target selection updates the aircraft's actual target record");
  }

  // 6 — the task force turns away. The estimate keeps running along the reported course, so the
  //     attack is sent to an empty patch of sea; the error radius says so honestly.
  // Age the one report the Japanese fleet holds, until either it goes stale or the oncoming strike
  // gets close enough to file a fresh sighting of its own — whichever the battle does first.
  let age = 0;
  let drift = 0;
  let radius = 0;
  let moved = 0;
  for (let k = 0; k < 40; k += 1) {
    for (let i = 0; i < Math.round(5 / STEP); i += 1) b.step(STEP, {});
    const c = b.teamIntel.jp.get(enterprise.id);
    if (c.observedAt !== observedAt || b.time - c.observedAt > STALE_SECONDS) break;
    const guess = estimatePosition(c, b.time);
    age = b.time - c.observedAt;
    drift = Math.hypot(guess.x - enterprise.x, guess.z - enterprise.z);
    radius = guess.radius;
    moved = Math.hypot(enterprise.x - start.x, enterprise.z - start.z);
  }
  assert.ok(age > 90, `the report was replaced after only ${age.toFixed(0)} s; it never got old`);
  assert.ok(moved > 300, `the task force barely moved (${moved.toFixed(0)} m); the test proves nothing`);
  // More than the carrier's own 251 m hull, so the attack is aimed at open water, not at the ship.
  assert.ok(drift > 260, `a ${age.toFixed(0)} s old report still lands within ${drift.toFixed(0)} m of the ship`);
  assert.ok(radius > 400, `the uncertainty should have grown with the age, got ${radius.toFixed(0)} m`);
  notes.push(`stale report: ${age.toFixed(0)} s old, ${drift.toFixed(0)} m off the ship, uncertainty ±${radius.toFixed(0)} m`);
}

// 9 — a damaged deck suspends operations with a reason a person can read, refuses launches while it
//     holds, and reopens once the condition is genuinely repaired — without giving back the hull or
//     the stores that were destroyed.
{
  const b = new Battle(31);
  b.status = "playing";
  b.time = 5;
  const kaga = b.ships.find((s) => s.name === "Kaga");
  assert.equal(b.deckSuspension(kaga), null, "an undamaged deck is not suspended");
  const before = { hp: kaga.hp, ready: ready(kaga), stores: JSON.stringify(kaga.air.stores), fuel: kaga.air.fuel };
  b.damageShip(kaga, 150, { x: kaga.x, y: kaga.deckHeight, z: kaga.z }, "bomb", "us");
  const reason = b.deckSuspension(kaga);
  assert.ok(reason && typeof reason === "string", `a wrecked deck must report a readable reason, got ${reason}`);
  assert.equal(b.launch(kaga, "fighter"), null, "a suspended deck must not launch");
  assert.equal(kaga.launchBlocked, reason, `the refusal must be that same reason, got ${kaga.launchBlocked}`);
  const hit = { ready: ready(kaga), stores: JSON.stringify(kaga.air.stores), fuel: kaga.air.fuel };
  assert.ok(hit.ready < before.ready, "a bomb on a working deck must wreck aircraft that were ready");
  assert.ok(hit.stores !== before.stores, "and burn stores");
  assert.ok(hit.fuel < before.fuel, "and burn aviation fuel");
  assert.ok(kaga.hp < before.hp, "and damage the ship");

  // Firefighting and deck repair, at the rate the simulation already runs them.
  let reopened = 0;
  for (let i = 0; i < Math.round(900 / STEP) && !reopened; i += 1) {
    b.step(STEP, {});
    if (b.deckSuspension(kaga) === null) reopened = b.time;
  }
  assert.ok(reopened, `the deck never reopened: ${b.deckSuspension(kaga)} after ${(b.time - 5).toFixed(0)} s`);
  assert.ok(kaga.hp < before.hp, "reopening the deck must not repair the hull");
  assert.ok(ready(kaga) + Object.values(kaga.air.damaged).reduce((a, c) => a + c, 0) <= before.ready, "nor restore written-off aircraft");
  assert.ok(kaga.air.fuel <= hit.fuel, "nor refill the burnt aviation fuel");
  assert.ok(b.launch(kaga, "fighter"), "and the deck must actually be able to launch again");
  notes.push(`suspension: "${reason}" for ${(reopened - 5).toFixed(0)} s, then limited operations with ${kaga.hp.toFixed(0)}/${kaga.maxHp} hull`);
}

// 7 — the same seed and the same input trace reproduce the same state, exactly.
{
  const trace = (i) => (i % 3 === 0 ? { throttleUp: true } : i % 3 === 1 ? { pitch: 0.2 } : { turn: -0.1 });
  const a = run(19420607, 150, undefined, trace);
  const c = run(19420607, 150, undefined, trace);
  assert.equal(digest(a.b), digest(c.b), "the same seed and input trace produced a different battle");
  assert.deepEqual(a.log, c.log, "and a different launch history");
  const other = run(19420608, 150, undefined, trace);
  assert.notEqual(digest(a.b), digest(other.b), "two different seeds produced an identical battle");
  notes.push(`determinism: ${a.log.length} launches reproduced exactly; seed 19420608 differs`);
}

// 8 — no unseeded randomness anywhere in the two files this check covers.
for (const file of ["src/sim/battle.ts", "src/sim/tactics.ts"]) {
  const src = readFileSync(resolve(root, file), "utf8");
  assert.ok(!/Math\.random/.test(src), `${file} calls Math.random; all randomness is the seeded generator`);
}

for (const line of notes) console.log(`check-carrier-cycle: ${line}`);
console.log("check-carrier-cycle: conservation, queued launches, inventory-driven missions, contact-only targeting, ageing and determinism hold");
