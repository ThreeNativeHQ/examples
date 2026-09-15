/**
 * Battle-level mission-decision check (PRD AC-8 and AC-9).
 *
 * `check-carrier-cycle.mjs` already proves the pure modules and much of the wiring. This check drives
 * a real `Battle` through its ordinary entry points for the two criteria that are about *decisions*:
 * what a deck's next mission becomes from what that one carrier has been told and holds (AC-8), and
 * what suspends a deck and what genuinely reopens it (AC-9). A mission that quietly ignores a fresh
 * contact, a fighter that escorts instead of holding CAP, a suspension with no readable reason, or a
 * repair that hands back destroyed stores all look normal on screen.
 *
 * Uses the esbuild vite already installs. Run: node scripts/check-mission-decisions.mjs
 */
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { build } from "esbuild";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const built = await build({
  stdin: {
    contents: `export { Battle } from "./src/sim/battle.ts";`,
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
const { Battle } = await import(`data:text/javascript,${encodeURIComponent(built.outputFiles[0].text)}`);

const STEP = 1 / 30;
const failures = [];
/** Run one labelled claim; a failed assert is reported and the rest still run. */
function claim(name, fn) {
  try {
    fn();
    console.log(`PASS  ${name}`);
  } catch (err) {
    failures.push({ name, message: err.message });
    console.log(`FAIL  ${name}\n      ${err.message}`);
  }
}
/** Step a battle for `seconds` at the fixed 1/30 s the sim itself uses. */
function steps(b, seconds) {
  for (let i = 0; i < Math.round(seconds / STEP); i += 1) b.step(STEP, {});
}
const count = (rec) => Object.values(rec).reduce((n, c) => n + c, 0);
const aboard = (s) => count(s.air.airframes);
const readyOf = (s) => count(s.air.ready);
const carrier = (b, name) => b.ships.find((s) => s.name === name);
const firstCarrier = (b, team) => b.ships.find((s) => s.team === team && s.kind === "carrier");

/**
 * A delivered contact, through the same file/deliver path the observation sweep uses: the observer
 * is placed on the target so the range is zero and the classification is exact, and its report
 * reaches the fleet at once. This is the one input AC-8 says must change a carrier's next mission.
 */
function deliverContact(b, team, target) {
  b.fileReport(team, { id: "test-observer", x: target.x, z: target.z, altitude: target.deckHeight ?? 10, delay: 0 }, target);
  b.deliverReports();
}

/** Everything a repeated run must reproduce; names and radio text are deliberately absent. */
function digest(b) {
  const r = (n) => Math.round(n * 1000) / 1000;
  return JSON.stringify({
    time: r(b.time),
    score: b.score,
    status: b.status,
    ships: b.ships.map((s) => [
      s.id, r(s.x), r(s.z), r(s.hp), r(s.deck), r(s.fire), r(s.list ?? 0), s.launchCount,
      s.air ? [aboard(s), readyOf(s), JSON.stringify(s.air.stores), r(s.air.fuel), s.lostAircraft, s.writtenOff] : 0,
    ]),
    aircraft: b.aircraft.map((a) => [a.id, a.kind, a.airframe, r(a.x), r(a.z), r(a.y), r(a.hp), a.target ?? "", a.tactic ?? ""]),
    contacts: [...b.contacts.values()].map((c) => [c.id, c.kind, r(c.observedAt), r(c.errorRadius)]),
    intel: ["us", "jp"].map((t) => [...b.teamIntel[t].values()].map((c) => [c.id, c.kind, r(c.observedAt)])),
  });
}

/** The two source files that own mission, launch and targeting decisions. */
const battleSrc = readFileSync(resolve(root, "src/sim/battle.ts"), "utf8");
const tacticsSrc = readFileSync(resolve(root, "src/sim/tactics.ts"), "utf8");

// ---------------------------------------------------------------------------------------------
// AC-8 — one input changes one carrier's next mission
// ---------------------------------------------------------------------------------------------

claim("AC-8 a fresh contact turns exactly one carrier's next mission into a strike naming it", () => {
  const seed = 19420604;
  // Same seed, same fleet, same everything: the only difference is the delivered contact.
  const blind = new Battle(seed);
  const blindDeck = carrier(blind, "Kaga");
  blind.updateCarrier(blindDeck);
  assert.equal(blindDeck.mission.kind, "patrol", `a carrier with no contact must keep patrolling, got ${blindDeck.mission.kind}`);
  assert.equal(blindDeck.mission.target, null, "a carrier with no contact must name no target");
  assert.ok((blindDeck.mission.want.recon ?? 0) > 0, "a carrier with no contact must still put up a search leg");

  const informed = new Battle(seed);
  const informedDeck = carrier(informed, "Kaga");
  const target = firstCarrier(informed, "us");
  deliverContact(informed, "jp", target);
  assert.ok(informed.teamIntel.jp.has(target.id), "the delivered report must be held by the fleet");
  informed.updateCarrier(informedDeck);
  assert.equal(informedDeck.mission.kind, "strike", `a fresh contact must arm a strike, got ${informedDeck.mission.kind}`);
  assert.equal(informedDeck.mission.target, target.id, "the strike must name the contact that was delivered");
  assert.ok(
    (informedDeck.mission.want.torpedo ?? 0) + (informedDeck.mission.want.bomber ?? 0) > 0,
    "a strike mission must actually want strike aircraft",
  );
});

claim("AC-8 CAP versus escort follows the local threat and where the fighters end up", () => {
  // --- escort: a strike to escort, no local threat -> the fighters go with the strike.
  const escort = new Battle(19420604);
  escort.start();
  const escortDeck = escort.home;
  const contact = firstCarrier(escort, "jp");
  deliverContact(escort, "us", contact);
  escortDeck.mission = null;
  escort.updateCarrier(escortDeck);
  assert.equal(escortDeck.mission.kind, "strike", "the escort scenario must be flying a strike");
  assert.equal(escortDeck.mission.want.fighter, 2, `an unthreatened strike escorts with 2 fighters, got ${escortDeck.mission.want.fighter}`);
  const threatNearEscort = escort.aircraft.filter(
    (a) => a.team !== escortDeck.team && a.hp > 0 && a.kind !== "recon" && Math.hypot(a.x - escortDeck.x, a.z - escortDeck.z) < 9000,
  ).length;
  assert.equal(threatNearEscort, 0, "the escort scenario must have no local air threat");

  const strike = escort.launch(escortDeck, "bomber");
  assert.ok(strike, "the escort scenario must get a strike aircraft airborne");
  Object.assign(strike, { mode: "flight", y: 1400, x: escortDeck.x, z: escortDeck.z + 200 });
  // The deck interval from the strike launch has to clear before the fighter rolls.
  steps(escort, 7);
  Object.assign(strike, { mode: "flight", y: 1400, x: escortDeck.x, z: escortDeck.z + 200 });
  const escortFighter = escort.launch(escortDeck, "fighter");
  assert.ok(escortFighter, "the escort deck must put up its escorting fighter");
  Object.assign(escortFighter, { mode: "flight", y: 1500, x: escortDeck.x, z: escortDeck.z - 150 });
  escort.step(STEP, {});
  assert.equal(
    escortFighter.tactic,
    "escort",
    `with a strike to escort and no threat a fighter must go with the strike, got ${escortFighter.tactic}`,
  );

  // --- CAP: hostile aircraft near the carrier -> the fighters are held over the group.
  const cap = new Battle(19420604);
  cap.start();
  const capDeck = cap.home;
  const raider = cap.aircraft.find((a) => a.team === "jp" && a.kind === "fighter" && a.hp > 0);
  assert.ok(raider, "the launch-on-start should provide a hostile fighter to place");
  Object.assign(raider, { mode: "flight", x: capDeck.x + 6000, z: capDeck.z, y: 1500 });
  capDeck.mission = null;
  cap.updateCarrier(capDeck);
  assert.equal(capDeck.mission.kind, "intercept", `a local threat must intercept, got ${capDeck.mission.kind}`);
  assert.ok((capDeck.mission.want.fighter ?? 0) > 0, "a carrier under threat must want fighters up");

  const capFighter = cap.launch(capDeck, "fighter");
  assert.ok(capFighter, "the threatened deck must put up a fighter");
  Object.assign(capFighter, { mode: "flight", y: 1500, x: capDeck.x, z: capDeck.z - 150 });
  cap.step(STEP, {});
  assert.equal(
    capFighter.tactic,
    "CAP",
    `with hostile aircraft near and no strike to escort the fighter must hold over the group, got ${capFighter.tactic}`,
  );
});

// ---------------------------------------------------------------------------------------------
// AC-8 — no name-specific and no modulo-only decision
// ---------------------------------------------------------------------------------------------

claim("AC-8 no proper ship name appears in a launch, mission or targeting decision", () => {
  const NAMES = [
    "Kaga", "Akagi", "Soryu", "Hiryu", "Yorktown", "Enterprise", "Hornet",
    "Tone", "Chikuma", "Mogami", "Hammann", "Arashi", "Nagara",
  ];
  // tactics.ts is exactly the mission and targeting policy: it must carry no name at all.
  for (const name of NAMES) assert.ok(!tacticsSrc.includes(name), `tactics.ts mentions the hull ${name}`);
  // battle.ts may name hulls in its fleet tables, its `add()` construction calls, comments and the
  // radio lookup; every other line carrying a name is a decision branching on one.
  for (const line of battleSrc.split("\n")) {
    if (!NAMES.some((n) => line.includes(n))) continue;
    const allowed =
      line.includes("add(") ||
      line.includes("radioShipName") ||
      line.includes("//") ||
      /^\s*\*/.test(line) ||
      /^\s*"?[\w .'-]+"?\s*:/.test(line);
    assert.ok(allowed, `battle.ts decides on a hull name: ${line.trim()}`);
  }
  // A name-driven decision would also change the battle when the name changes. Rename every hull and
  // the whole run must reproduce, because nothing downstream reads a name to decide anything.
  const run = (rename) => {
    const b = new Battle(19420604);
    if (rename) b.ships.forEach((s, i) => (s.name = `Hull ${i}`));
    b.start();
    b.player.mode = "spectator";
    steps(b, 30);
    return digest(b);
  };
  assert.equal(run(true), run(false), "renaming every hull changed the battle, so a decision still keys off a name");
});

claim("AC-8 no modulo of a counter gates a launch or a spawn", () => {
  // Strip comments and string literals before looking for `%`: only a real modulo operator remains.
  const withoutLiterals = (src) =>
    src
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split("\n")
      .map((line) => line.replace(/\/\/.*$/, "").replace(/`(?:[^`\\]|\\.)*`/g, '""').replace(/'(?:[^'\\]|\\.)*'/g, '""').replace(/"(?:[^"\\]|\\.)*"/g, '""'))
      .join("\n");
  for (const [file, src] of [["src/sim/battle.ts", battleSrc], ["src/sim/tactics.ts", tacticsSrc]]) {
    const lines = withoutLiterals(src).split("\n");
    for (let i = 0; i < lines.length; i += 1) {
      if (!lines[i].includes("%")) continue;
      assert.ok(
        lines[i].includes("360"),
        `${file}:${i + 1} uses a modulo on a decision: ${lines[i].trim()}`,
      );
    }
  }
  // And the real launch order is not the old modulo sequence: the deck that operated most does not
  // reproduce the old `i % 4` / `i % 3` cadence.
  const b = new Battle(19420604);
  const log = [];
  const launch = b.launch.bind(b);
  b.launch = (s, role) => {
    const a = launch(s, role);
    if (a) log.push({ ship: s.id, role });
    return a;
  };
  b.start();
  b.player.mode = "spectator";
  steps(b, 300);
  const byDeck = new Map();
  for (const e of log) byDeck.set(e.ship, [...(byDeck.get(e.ship) ?? []), e.role]);
  const busiest = [...byDeck.values()].sort((p, q) => q.length - p.length)[0] ?? [];
  assert.ok(busiest.length >= 4, `no deck launched enough to judge the sequence: ${busiest.length}`);
  const modulo = busiest.map((_, i) => (i % 4 === 0 ? "fighter" : i % 3 === 0 ? "torpedo" : "bomber"));
  assert.notDeepEqual(busiest, modulo, `a deck still launches on the modulo sequence: ${busiest}`);
});

// ---------------------------------------------------------------------------------------------
// AC-9 — suspensions carry readable reasons
// ---------------------------------------------------------------------------------------------

claim("AC-9 evasion suspends deck operations with the readable reason evading", () => {
  const b = new Battle(19420604);
  b.status = "playing";
  b.time = 5;
  const cv = b.home;
  assert.equal(b.deckSuspension(cv), null, "an untouched deck is not suspended");
  // A visible torpedo on a closing course, spawned through the real weapon entry point.
  const t = b.spawnTorpedo({ id: "wake", owner: "wake", team: "jp", airframe: "kate", kind: "bomber", x: cv.x - 700, z: cv.z }, Math.PI / 2);
  assert.ok(t, "the torpedo must spawn");
  b.step(STEP, {});
  assert.ok(cv.evadeUntil > b.time, "a visible torpedo must put the ship into evasion");
  const reason = b.deckSuspension(cv);
  assert.equal(reason, "evading", `an evading deck must report exactly 'evading', got ${JSON.stringify(reason)}`);
  assert.equal(b.launch(cv, "fighter"), null, "an evading deck must refuse a launch");
  assert.equal(cv.launchBlocked, "evading", `the refusal must carry the same readable reason, got ${cv.launchBlocked}`);
  // The suspension is the evasion's, not a permanent state: once the window passes the deck clears.
  b.time = cv.evadeUntil + 1;
  assert.equal(b.deckSuspension(cv), null, "the deck must reopen when the evasion window ends");
});

claim("AC-9 a corridor fire and a heavy list each report their own distinct reason", () => {
  const b = new Battle(19420604);
  b.status = "playing";
  b.time = 5;
  const akagi = carrier(b, "Akagi");
  const kaga = carrier(b, "Kaga");
  // A bomb leaves burning fuel across the landing corridor but does not flood the hull.
  b.damageShip(akagi, 150, { x: akagi.x, y: akagi.deckHeight, z: akagi.z }, "bomb", "us");
  assert.equal(kaga.list, 0, "a bomb must not list the hull");
  const fireReason = b.deckSuspension(akagi);
  assert.equal(fireReason, "fire in the landing corridor", `a burning corridor must report its own reason, got ${JSON.stringify(fireReason)}`);
  // Three torpedoes flood the hull past the heavy-list threshold.
  for (let i = 0; i < 3; i += 1) b.damageShip(kaga, 0, { x: kaga.x, y: 0, z: kaga.z }, "torpedo", "us");
  const listReason = b.deckSuspension(kaga);
  assert.equal(listReason, "heavy list", `a flooded hull must report its own reason, got ${JSON.stringify(listReason)}`);
  assert.notEqual(fireReason, listReason, "a corridor fire and a heavy list must not share one reason");
  assert.equal(b.launch(kaga, "fighter"), null, "a heavy-listed deck must refuse a launch");
  assert.equal(kaga.launchBlocked, "heavy list", "the refusal must carry the same reason as the suspension");
});

claim("AC-9 an occupied deck refuses a launch and clears when the interval ends", () => {
  const b = new Battle(19420604);
  b.start();
  const cv = b.home; // the player's deck, held while the player is chocked, so only we launch it
  assert.equal(b.deckSuspension(cv), null, "an untouched deck is not suspended");
  const first = b.launch(cv, "fighter");
  assert.ok(first, "the first launch must succeed on a free deck");
  const occupiedUntil = cv.deckState.occupiedUntil;
  assert.ok(occupiedUntil > b.time, "the launch must foul the deck for the launch interval");
  const second = b.launch(cv, "fighter");
  assert.equal(second, null, "a launch on an occupied deck must be refused");
  assert.ok(cv.launchBlocked && /deck/.test(cv.launchBlocked), `the refusal must name the deck's occupancy, got ${JSON.stringify(cv.launchBlocked)}`);
  // Drive the clock past the interval; the same deck then launches again.
  steps(b, 7);
  assert.ok(cv.deckState.occupiedUntil <= b.time, "the launch interval must have elapsed");
  const third = b.launch(cv, "fighter");
  assert.ok(third, `the deck must launch once the occupancy clears, blocked by ${cv.launchBlocked}`);
});

claim("AC-9 reopening a repairable suspension keeps the destroyed hull, aircraft and stores gone", () => {
  const b = new Battle(19420604);
  b.status = "playing";
  b.time = 5;
  const kaga = carrier(b, "Kaga");
  // An aircraft away from the deck, so it can genuinely be destroyed while the deck is suspended.
  const airborne = b.launch(kaga, "fighter");
  assert.ok(airborne, "the deck must put an aircraft up before it is suspended");
  const before = { hp: kaga.hp, airframes: aboard(kaga), ready: readyOf(kaga), stores: { ...kaga.air.stores }, fuel: kaga.air.fuel };
  // Three torpedoes: a heavy list, which counter-flooding can honestly bring back.
  for (let i = 0; i < 3; i += 1) b.damageShip(kaga, 0, { x: kaga.x, y: 0, z: kaga.z }, "torpedo", "us");
  assert.equal(b.deckSuspension(kaga), "heavy list", "the deck must be suspended by the heavy list");
  assert.equal(b.launch(kaga, "fighter"), null, "a suspended deck must not launch");
  assert.equal(kaga.launchBlocked, "heavy list", "the refusal must be the suspension's reason");

  // While it is suspended: destroy the airborne aircraft, wreck more on deck, burn stores and fuel.
  b.planeDestroyed(airborne, null);
  b.wreckAircraft(kaga, 2);
  b.burnStores(kaga, 3, 20);
  const destroyed = kaga.lostAircraft;
  const hit = { hp: kaga.hp, airframes: aboard(kaga), ready: readyOf(kaga), stores: { ...kaga.air.stores }, fuel: kaga.air.fuel };
  assert.ok(destroyed >= 1, "the airborne aircraft must be counted lost");
  assert.ok(hit.fuel < before.fuel, "the burn must have spent aviation fuel");
  assert.notDeepEqual(hit.stores, before.stores, "the burn must have spent stores");
  assert.equal(hit.airframes, before.airframes, "wrecking aircraft must move them, not delete them");

  // Counter-flooding and firefighting run at the rate the simulation already runs them.
  let reopened = 0;
  for (let i = 0; i < Math.round(600 / STEP) && !reopened; i += 1) {
    b.step(STEP, {});
    if (b.deckSuspension(kaga) === null) reopened = b.time;
  }
  assert.ok(reopened, `the deck never reopened: ${b.deckSuspension(kaga)} after ${(b.time - 5).toFixed(0)} s`);
  assert.ok(kaga.hp < before.hp, "the fire that suspended the deck must have cost the hull");
  assert.ok(kaga.hp <= hit.hp, "reopening must not repair the hull");
  assert.ok(kaga.lostAircraft >= destroyed, "an aircraft destroyed while suspended must stay destroyed");
  assert.ok(kaga.air.fuel <= hit.fuel, "aviation fuel burnt while suspended must not be refilled");
  assert.deepEqual(kaga.air.stores, hit.stores, "stores spent while suspended must stay spent");
  assert.equal(aboard(kaga), hit.airframes, "the reopened deck must not invent airframes");
  // The reopened deck puts up its own next sortie, through the same cycle it always uses.
  const launchesBefore = kaga.launchCount;
  steps(b, 8);
  assert.ok(kaga.launchCount > launchesBefore, "the reopened deck must actually launch again");
});

// ---------------------------------------------------------------------------------------------

console.log("");
if (failures.length) {
  console.log(`check-mission-decisions: ${failures.length} claim(s) FAILED`);
  for (const f of failures) console.log(`  - ${f.name}`);
  process.exitCode = 1;
} else {
  console.log("check-mission-decisions: contact-driven missions, CAP/escort, name-free and modulo-free decisions, and readable/recoverable deck suspensions all hold through Battle");
}
