/**
 * Fog-of-war check (PRD AC-10). A Battle-level proof that the fleet fights the *reports* it holds,
 * never the live hulls: an unobserved carrier or submarine is never an AI target, a detection is a
 * dated limited report rather than a copy of the ship, delivery is delayed, and the age of a report
 * — stale, or lost because its observer died — changes what the AI does. `check-intel.mjs` proves
 * the pure estimator and `check-carrier-cycle.mjs` proves the carrier cycle; this one drives a real
 * `Battle` and asserts what only the wired simulation can show.
 *
 * Uses the esbuild vite already installs. Run: node scripts/check-fog.mjs
 */
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { build } from "esbuild";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const built = await build({
  stdin: {
    contents: `
      export { Battle } from "./src/sim/battle.ts";
      export { selectNavalTarget } from "./src/sim/tactics.ts";
      export { STALE_SECONDS, DRIFT_RATE, estimatePosition, isStale } from "./src/sim/intel.ts";
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
const { Battle, selectNavalTarget, STALE_SECONDS, DRIFT_RATE, estimatePosition, isStale } =
  await import(`data:text/javascript,${encodeURIComponent(built.outputFiles[0].text)}`);

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
/** A spectator battle already under way, so the fleet's own behaviour is what is under test. */
function play(seed) {
  const b = new Battle(seed);
  b.start();
  b.player.mode = "spectator";
  return b;
}
/**
 * Park a hull far outside every observer's reach. It stays a live, moving ship with its own crew;
 * only its position is set, which is a fact about the world rather than a decision taken for the AI.
 */
function isolate(ship) {
  ship.x += 400000;
  ship.z += 400000;
  return ship;
}
/** A plain attacker record, so a claim can ask the AI's own selector what it would choose. */
function wire(team, target = null) {
  return { id: `wire-${team}`, team, kind: "bomber", x: 0, z: 0, target, bombs: 1, torpedo: 0, wing: false, home: null, speed: 100 };
}
const ATTACK_TACTICS = new Set(["ingress", "dive", "level-bomb", "torpedo-run", "attack"]);
const observedAt = (b, team, id) => b.teamIntel[team].get(id)?.observedAt ?? null;

// ---------------------------------------------------------------------------------------------
// AC-10 — an unobserved carrier is never an AI target
// ---------------------------------------------------------------------------------------------

claim("AC-10 an unobserved enemy carrier is never an AI target, though an observed one is", () => {
  const b = play(19420604);
  const far = isolate(b.ships.find((s) => s.team === "jp" && s.kind === "carrier" && !s.sunk));
  const watched = b.ships.filter((s) => s.team === "jp" && s.kind === "carrier" && s !== far && !s.sunk).map((s) => s.id);
  let farTargeted = 0;
  let farContact = 0;
  let farRun = 0;
  let observedTargeted = 0;
  for (let i = 0; i < Math.round(150 / STEP); i += 1) {
    b.step(STEP, {});
    for (const a of b.aircraft) {
      if (a.team !== "us" || a.hp <= 0) continue;
      if (a.target === far.id) {
        farTargeted += 1;
        if (ATTACK_TACTICS.has(a.tactic)) farRun += 1;
      } else if (watched.includes(a.target)) observedTargeted += 1;
    }
    if (b.teamIntel.us.has(far.id)) farContact += 1;
  }
  assert.equal(farContact, 0, "the isolated carrier was observed, so the claim's premise does not hold");
  assert.equal(farTargeted, 0, `a US aircraft set its target to an unobserved carrier ${farTargeted} times`);
  assert.equal(farRun, 0, `an attack run was flown at the unobserved carrier's true position ${farRun} times`);
  assert.ok(observedTargeted > 0, "no US aircraft ever targeted an *observed* carrier, so the run proves nothing");
});

// ---------------------------------------------------------------------------------------------
// AC-10 — the same for a submerged submarine
// ---------------------------------------------------------------------------------------------

claim("AC-10 a submerged submarine is never an AI target, but a surfaced one is observed", () => {
  const b = play(19420604);
  const sub = b.ships.find((s) => s.team === "jp" && s.kind === "sub");
  // Put the boat deep. With no contact it wants the surface, so this is the window the criterion names.
  sub.sub.depth = 60;
  sub.sub.mode = "deep";
  sub.surfaced = false;
  sub.y = -60;
  let targeted = 0;
  let contact = 0;
  for (let i = 0; i < Math.round(10 / STEP); i += 1) {
    b.step(STEP, {});
    assert.equal(sub.surfaced, false, `the boat surfaced after ${(i * STEP).toFixed(1)} s; the premise did not hold`);
    for (const a of b.aircraft) if (a.hp > 0 && a.target === sub.id) targeted += 1;
    if (b.teamIntel.us.has(sub.id)) contact += 1;
  }
  assert.equal(contact, 0, "a deep submarine was delivered to the US fleet, so the depth gate leaked");
  assert.equal(targeted, 0, `an AI aircraft targeting a submerged boat ${targeted} times`);

  // The gate is real: the same boat on the surface is observable, so the deep negative is not vacuous.
  sub.sub.depth = 0;
  sub.sub.mode = "surfaced";
  sub.y = 0;
  steps(b, 12);
  assert.ok(b.teamIntel.us.has(sub.id), "a surfaced, in-range submarine should become a delivered contact");
});

// ---------------------------------------------------------------------------------------------
// AC-10 — a detection is a report, not a copy of the ship
// ---------------------------------------------------------------------------------------------

claim("AC-10 a detection is a dated, classified, uncertain report, not a copy of the hull", () => {
  const b = play(19420604);
  const far = isolate(b.ships.find((s) => s.team === "jp" && s.kind === "carrier" && !s.sunk));
  b.fileReport("us", { id: "air-scout-pby", x: far.x, z: far.z, delay: 6 }, far);
  const r = b.reports.find((c) => c.id === far.id && c.team === "us");
  assert.ok(r, "the sighting did not produce a report");
  assert.equal(r.observedAt, b.time, "the report must be dated at the observation");
  assert.equal(r.deliveredAt, b.time + 6, `delivery must be observedAt + delay, got ${r.deliveredAt}`);
  assert.ok(r.errorRadius > 0, "the report carries no positional uncertainty");
  assert.equal(r.classification, "carrier", `a point-blank carrier must classify as a carrier, got ${r.classification}`);
  assert.equal(r.hp, undefined, "a report must not carry the hull's hit points");
  assert.equal(r.deck, undefined, "a report must not carry the hull's deck health");

  // At range the classification degrades; it is a belief, not the hull's true identity.
  b.fileReport("us", { id: "air-scout-far", x: far.x + 12000, z: far.z, delay: 6 }, far);
  const distant = b.reports.filter((c) => c.id === far.id && c.team === "us").at(-1);
  assert.notEqual(distant.classification, "carrier", `a 12 km carrier still classified as a carrier (${distant.classification})`);

  steps(b, 8);
  const held = b.teamIntel.us.get(far.id);
  assert.ok(held, "the report was never delivered");
  const offset = Math.hypot(held.x - far.x, held.z - far.z);
  assert.ok(offset > 0, "the delivered contact is position-identical to the live hull");
});

// ---------------------------------------------------------------------------------------------
// AC-10 — delivery is delayed across its own boundary
// ---------------------------------------------------------------------------------------------

claim("AC-10 a report is unusable before deliveredAt and usable at it", () => {
  const b = play(19420604);
  const far = isolate(b.ships.find((s) => s.team === "jp" && s.kind === "carrier" && !s.sunk));
  b.fileReport("us", { id: "air-scout", x: far.x, z: far.z, delay: 5 }, far);
  const r = b.reports.find((c) => c.id === far.id && c.team === "us");
  steps(b, 4.5);
  assert.ok(b.time < r.deliveredAt, "the run passed the delivery boundary before the assertion");
  assert.equal(b.teamIntel.us.has(far.id), false, "the report reached the fleet before deliveredAt");
  steps(b, 1);
  assert.ok(b.time >= r.deliveredAt, "the run never crossed the delivery boundary");
  assert.equal(b.teamIntel.us.has(far.id), true, "the report never reached the fleet after deliveredAt");
});

// ---------------------------------------------------------------------------------------------
// AC-10 — a stale report changes search behaviour
// ---------------------------------------------------------------------------------------------

claim("AC-10 a stale contact stops being attacked and the AI goes back to searching", () => {
  const b = new Battle(19420604);
  const enterprise = b.ships.find((s) => s.name === "USS Enterprise");
  const a = b.launch(enterprise, "bomber");
  assert.ok(a, "the home deck should provide an attacker");
  const far = isolate(b.ships.find((s) => s.team === "jp" && s.kind === "carrier" && !s.sunk));
  b.start();
  b.player.mode = "spectator";
  a.musterUntil = 0;
  b.fileReport("us", { id: "air-scout", x: far.x, z: far.z, delay: 1 }, far);
  steps(b, 40);
  assert.equal(a.target, far.id, "the delivered contact did not become the attacker's target");
  assert.ok(ATTACK_TACTICS.has(a.tactic), `fresh contact should be attacked, tactic was ${a.tactic}`);

  // Let the one report age past the stale window with no observer able to refresh it. Time is the
  // sim's own clock; the aircraft keeps its fuel and position, so only the report's age changed.
  b.time += STALE_SECONDS + 5;
  const c = b.teamIntel.us.get(far.id);
  assert.ok(c && isStale(c, b.time, STALE_SECONDS), "the contact was refreshed; it never went stale");
  assert.equal(selectNavalTarget(b, a), null, "a stale contact is still selectable as a target");
  steps(b, 1);
  assert.ok(!ATTACK_TACTICS.has(a.tactic), `the AI kept attacking a stale estimate (tactic ${a.tactic})`);
  assert.equal(a.tactic, "search", `the aircraft did not return to searching, tactic ${a.tactic}`);
});

// ---------------------------------------------------------------------------------------------
// AC-10 — a lost contact grows uncertain faster, and the AI's aim reflects it
// ---------------------------------------------------------------------------------------------

claim("AC-10 a lost contact drifts three times as fast and the AI attacks its wider estimate", () => {
  const b = new Battle(19420604);
  const enterprise = b.ships.find((s) => s.name === "USS Enterprise");
  const scout = b.launch(enterprise, "fighter");
  assert.ok(scout, "a real observer aircraft is needed");
  const far = isolate(b.ships.find((s) => s.team === "jp" && s.kind === "carrier" && !s.sunk));
  b.fileReport("us", { id: scout.id, x: far.x, z: far.z, delay: 1 }, far);
  b.time += 2;
  b.deliverReports();
  const contact = b.teamIntel.us.get(far.id);
  assert.ok(contact && contact.lost === false, "a fresh fired report must start held, not lost");

  const held = selectNavalTarget(b, wire("us", far.id));
  assert.ok(held && held.id === far.id, "the AI did not use the held report");
  assert.equal(held.uncertainty, contact.errorRadius + DRIFT_RATE * (b.time - contact.observedAt), "held drift is wrong");
  // `selectNavalTarget` returns module scratch, refilled by the next call; keep the numbers.
  const heldUncertainty = held.uncertainty;

  // The observer is destroyed. Nobody is correcting the track now, and it must still be usable.
  b.planeDestroyed(scout, "jp");
  assert.equal(b.teamIntel.us.get(far.id).lost, true, "losing the observer did not mark its report lost");
  const lost = selectNavalTarget(b, wire("us", far.id));
  assert.ok(lost && lost.id === far.id, "the AI dropped a report that was already transmitted");
  assert.ok(
    lost.uncertainty > heldUncertainty,
    `a lost contact must drift faster: ${lost.uncertainty} vs ${heldUncertainty}`,
  );
  const expect = contact.errorRadius + DRIFT_RATE * (b.time - contact.observedAt) * 3;
  assert.ok(Math.abs(lost.uncertainty - expect) < 1e-6, `lost uncertainty should be ${expect}, got ${lost.uncertainty}`);
  const estimate = estimatePosition(b.teamIntel.us.get(far.id), b.time);
  assert.ok(Math.abs(lost.x - estimate.x) < 1e-6 && Math.abs(lost.z - estimate.z) < 1e-6, "the AI aim is not the dead-reckoned estimate");
});

// ---------------------------------------------------------------------------------------------
// AC-10 — killing a scout stops new reports but not one already transmitted
// ---------------------------------------------------------------------------------------------

claim("AC-10 killing a scout stops new reports but not one already on the air", () => {
  const b = new Battle(19420604);
  const akagi = b.ships.find((s) => s.name === "Akagi");
  const scout = b.launch(akagi, "bomber");
  assert.ok(scout, "the cruiser/carrier air group should provide a scout");
  const us = isolate(b.ships.find((s) => s.name === "USS Enterprise"));
  b.start();
  b.player.mode = "spectator";

  // A sighting already delivered, and a second still in transmission.
  b.fileReport("jp", { id: scout.id, x: us.x, z: us.z, delay: 1 }, us);
  b.time += 2;
  b.deliverReports();
  const delivered = b.teamIntel.jp.get(us.id);
  assert.ok(delivered, "the first report was never delivered");
  b.fileReport("jp", { id: scout.id, x: us.x, z: us.z, delay: 20 }, us);
  const inTransit = b.reports.find((r) => r.team === "jp" && r.id === us.id && r.observerId === scout.id);
  assert.ok(inTransit && inTransit.deliveredAt > b.time, "the second report should still be in transmission");

  // Destroy the scout that filed both.
  b.planeDestroyed(scout, "us");
  steps(b, 30);

  // (a) the delivered report survives, and is still usable by the fleet's attackers.
  assert.ok(b.teamIntel.jp.has(us.id), "a transmitted report was erased when its observer died");
  const usable = selectNavalTarget(b, wire("jp", us.id));
  assert.ok(usable && usable.id === us.id, "the surviving report is not usable as a target");

  // (c) the report already on the air arrives after the sender's death.
  const held = b.teamIntel.jp.get(us.id);
  assert.equal(held.observedAt, inTransit.observedAt, "the in-transit report never arrived");

  // (b) the dead scout files nothing new.
  const fromScout = b.reports.filter((r) => r.observerId === scout.id);
  assert.equal(fromScout.length, 0, "a dead scout left a new report on the air");
  const later = stepsThrough(b, 30, () => b.reports.some((r) => r.observerId === scout.id));
  assert.equal(later, false, "a dead scout filed a new report after dying");
  assert.equal(observedAt(b, "jp", us.id), inTransit.observedAt, "a new report replaced the surviving one after the scout died");
});

/** Step, returning true if `hit()` ever fires; used to catch a report that should never appear. */
function stepsThrough(b, seconds, hit) {
  for (let i = 0; i < Math.round(seconds / STEP); i += 1) {
    b.step(STEP, {});
    if (hit()) return true;
  }
  return false;
}

console.log("");
if (failures.length) {
  console.log(`check-fog: ${failures.length} claim(s) FAILED`);
  for (const f of failures) console.log(`  - ${f.name}`);
  process.exitCode = 1;
} else {
  console.log("check-fog: contact observation, delivery, staleness, loss and observer death all hold through Battle");
}
