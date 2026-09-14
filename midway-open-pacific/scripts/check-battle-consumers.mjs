/**
 * Battle-consumer wiring check (PRD AC-7, AC-12, AC-13, AC-17).
 *
 * `check-carrier-cycle.mjs`, `check-facilities.mjs`, `check-briefing.mjs` and
 * `check-torpedo-run.mjs` already prove the pure modules in isolation. This one proves the
 * *wiring*: it drives a real `Battle` through `step()` and its ordinary entry points only — no
 * direct writes to a task, an objective or an AI transition — and asserts what a screenshot and a
 * playtest cannot see. A carrier whose inventory quietly diverges, a wrecked aircraft that
 * reappears ready, a raid that rewrites a decision already made on a report, three target
 * consumers that disagree, or a live torpedo that ignores its own variant all look normal on
 * screen.
 *
 * Uses the esbuild vite already installs. Run: node scripts/check-battle-consumers.mjs
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
      export { validateSelection } from "./src/sim/briefing.ts";
      export {
        airstripCapability, radarWarning, radioDelivery, observedCapability, japaneseFollowUp,
      } from "./src/sim/facilities.ts";
      export { torpedoVariant, actualRunDepth } from "./src/sim/armament.ts";
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
const {
  Battle,
  ACTIVE_CAP,
  selectNavalTarget,
  validateSelection,
  airstripCapability,
  radarWarning,
  radioDelivery,
  observedCapability,
  japaneseFollowUp,
  torpedoVariant,
  actualRunDepth,
} = await import(`data:text/javascript,${encodeURIComponent(built.outputFiles[0].text)}`);

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
const count = (rec) => Object.values(rec).reduce((n, c) => n + c, 0);
const aboard = (s) => count(s.air.airframes);
const readyOf = (s) => count(s.air.ready);
const airborneFrom = (b, s) => b.aircraft.filter((a) => a.hp > 0 && a.home === s.id).length;
const carriers = (b) => b.ships.filter((s) => s.air);
const facility = (b, kind) => b.facilities.find((f) => f.kind === kind);

// ---------------------------------------------------------------------------------------------
// AC-7 — conserved carrier cycle
// ---------------------------------------------------------------------------------------------

claim("AC-7 airframe identities are conserved over a long run", () => {
  const b = play(19420604);
  // The baseline already includes the aircraft `start()` put on the air, not just those on the deck.
  const initial = new Map(
    carriers(b).map((s) => [s.id, aboard(s) + airborneFrom(b, s) + s.lostAircraft + s.writtenOff]),
  );
  steps(b, 300);
  for (const team of ["us", "jp"]) {
    const fleet = carriers(b).filter((s) => s.team === team);
    const start = fleet.reduce((n, s) => n + initial.get(s.id), 0);
    const now = fleet.reduce((n, s) => n + aboard(s) + airborneFrom(b, s) + s.lostAircraft + s.writtenOff, 0);
    assert.equal(now, start, `${team}: ${now} airframes accounted for, from ${start}`);
  }
  const launches = carriers(b).reduce((n, s) => n + s.launchCount, 0);
  assert.ok(launches > 4, `only ${launches} launches in 300 s; conservation was not exercised`);
});

claim("AC-7 a launch spends one store and a recovery restores the airframe, not the store", () => {
  const b = new Battle(19420604);
  b.start();
  const h = b.home;
  const before = { airframes: aboard(h), stores: JSON.parse(JSON.stringify(h.air.stores)) };
  const a = b.launch(h, "torpedo");
  assert.ok(a, "the home deck must launch a torpedo aircraft");
  assert.equal(aboard(h), before.airframes - 1, "a launch must take exactly one airframe off the deck");
  for (const family of Object.keys(before.stores)) {
    const spent = family === "torpedo" ? 1 : 0;
    assert.equal(
      h.air.stores[family],
      before.stores[family] - spent,
      `a torpedo launch must spend exactly one ${family} store, not ${before.stores[family] - h.air.stores[family]}`,
    );
  }
  // The player is still chocked on deck, so the home deck does not auto-launch while its interval runs.
  steps(b, 7);
  const beforeRec = {
    airframes: aboard(h),
    stores: JSON.parse(JSON.stringify(h.air.stores)),
    servicing: count(h.air.servicing),
    ready: readyOf(h),
  };
  assert.equal(b.recoverAircraft(h, a), true, "the deck must recover the aircraft once the interval has cleared");
  assert.equal(aboard(h), beforeRec.airframes + 1, "a recovery must restore exactly one airframe");
  assert.deepEqual(h.air.stores, beforeRec.stores, "a recovery must restore the airframe but no store");
  assert.equal(count(h.air.servicing), beforeRec.servicing + 1, "the recovered aircraft waits in servicing, not ready");
  assert.equal(readyOf(h), beforeRec.ready, "a recovery must not make the aircraft ready");
});

claim("AC-7 a launch blocked at the active cap spends nothing and succeeds later", () => {
  const b = new Battle(19420604);
  const h = b.home;
  const before = {
    air: JSON.parse(JSON.stringify(h.air)),
    deck: JSON.parse(JSON.stringify(h.deckState)),
    stores: { ...h.air.stores },
  };
  for (let i = 0; i < ACTIVE_CAP; i += 1) b.aircraft.push({ id: `cap-${i}`, team: "jp", kind: "fighter", hp: 100 });
  assert.equal(b.launch(h, "torpedo"), null, "a launch at the active cap must be refused");
  assert.equal(h.launchBlocked, "active cap", `the refusal must name the cap, got ${h.launchBlocked}`);
  assert.deepEqual(h.air, before.air, "a blocked launch consumed inventory or stores");
  assert.deepEqual(h.deckState, before.deck, "a blocked launch fouled the deck");
  b.aircraft.length = 0;
  const a = b.launch(h, "torpedo");
  assert.ok(a, "the same deck must launch once a slot frees");
  assert.equal(before.stores.torpedo - h.air.stores.torpedo, 1, "the deferred launch must spend exactly one store");
});

claim("AC-7 a wrecked aircraft stays damaged rather than reappearing ready", () => {
  const b = play(19420604);
  const h = b.ships.find((s) => s.kind === "carrier" && s.team === "us");
  const frames = aboard(h);
  const readyBefore = readyOf(h);
  const damagedBefore = count(h.air.damaged);
  b.wreckAircraft(h, 3);
  assert.equal(readyOf(h), readyBefore - 3, "wrecking must move three aircraft out of ready");
  assert.equal(count(h.air.damaged), damagedBefore + 3, "and into damaged");
  assert.equal(aboard(h), frames, "a wreck must move identities, never delete them");
  steps(b, 120);
  assert.ok(
    count(h.air.damaged) + count(h.air.servicing) >= damagedBefore + 1,
    "the wrecked aircraft vanished from the inventory",
  );
  assert.ok(readyOf(h) <= readyBefore, "a wrecked aircraft reappeared as ready without the repair path running");
});

// ---------------------------------------------------------------------------------------------
// AC-12 — Midway's facilities
// ---------------------------------------------------------------------------------------------

claim("AC-12 radar damage changes warning but not airstrip capability, and vice versa", () => {
  const b1 = new Battle(19420604);
  const radar = facility(b1, "radar");
  const strip = facility(b1, "airstrip");
  assert.equal(radarWarning(b1.facilities), 1, "an intact radar should warn at 1");
  assert.equal(airstripCapability(b1.facilities), 1, "an intact airstrip should be at 1");
  b1.hitFacility(radar, 0.6, { x: radar.x, y: 0, z: radar.z });
  assert.ok(radarWarning(b1.facilities) < 1, "bombing the radar must lower radar warning");
  assert.equal(airstripCapability(b1.facilities), 1, "bombing the radar must not touch the airstrip");

  const b2 = new Battle(19420604);
  const strip2 = facility(b2, "airstrip");
  b2.hitFacility(strip2, 0.6, { x: strip2.x, y: 0, z: strip2.z });
  assert.ok(airstripCapability(b2.facilities) < 1, "bombing the runway must lower airstrip capability");
  assert.equal(radarWarning(b2.facilities), 1, "bombing the runway must not touch radar warning");
});

claim("AC-12 a damaged radio measurably increases report delivery delay", () => {
  const delayWith = (radioHealth) => {
    const b = new Battle(19420604);
    if (radioHealth < 1) {
      const r = facility(b, "radio");
      b.hitFacility(r, 1 - radioHealth, { x: r.x, y: 0, z: r.z });
    }
    b.time = 100;
    const observer = { id: "air-observer", x: b.island.x, z: b.island.z, delay: 8 };
    const target = b.ships.find((s) => s.team === "jp");
    b.fileReport("us", observer, target);
    const report = b.reports.at(-1);
    assert.ok(report, "the radio must put a report on the air");
    return { delay: report.deliveredAt - b.time, factor: radioDelivery(b.facilities) };
  };
  const healthy = delayWith(1);
  const damaged = delayWith(0.5);
  assert.equal(healthy.delay, 8, `an intact radio should deliver in 8 s, got ${healthy.delay}`);
  assert.ok(
    damaged.delay > healthy.delay,
    `a damaged radio must delay the report: ${healthy.delay} s -> ${damaged.delay} s`,
  );
  assert.ok(
    Math.abs(damaged.delay - healthy.delay * (damaged.factor / healthy.factor)) < 1e-9,
    `the delay must scale by radioDelivery: ${damaged.delay} vs ${healthy.delay * damaged.factor}`,
  );
});

claim("AC-12 one dead radar of two leaves warning at half, not zero", () => {
  const b = new Battle(19420604);
  const radar = facility(b, "radar");
  b.facilities.push({ ...radar, id: "midway-radar-2", x: radar.x + 1200 });
  assert.equal(radarWarning(b.facilities), 1, "two intact radars should both warn");
  const second = b.facilities.find((f) => f.id === "midway-radar-2");
  b.hitFacility(second, 1, { x: second.x, y: 0, z: second.z });
  assert.equal(b.facilities.find((f) => f.id === "midway-radar-2").health, 0, "the second radar should be dead");
  const warning = radarWarning(b.facilities);
  assert.equal(warning, 0.5, `one of two radars dead must leave 0.5, got ${warning}`);
});

claim("AC-12 japaneseFollowUp decides on observed capability, not live health", () => {
  const b = new Battle(19420604);
  const snapshot = {};
  for (const f of b.facilities) snapshot[f.id] = f.health;
  const observedBefore = observedCapability(b.facilities, snapshot);
  const decisionBefore = japaneseFollowUp(observedBefore, 0.5);
  // Change the truth AFTER the observation was taken.
  for (const kind of ["airstrip", "seaplane"]) {
    const f = facility(b, kind);
    b.hitFacility(f, 1, { x: f.x, y: 0, z: f.z });
  }
  assert.equal(airstripCapability(b.facilities), 0, "the live airstrip should be destroyed");
  const observedAfter = observedCapability(b.facilities, snapshot);
  assert.equal(
    observedAfter,
    observedBefore,
    `observed capability followed the live health: ${observedBefore} -> ${observedAfter}`,
  );
  assert.deepEqual(
    japaneseFollowUp(observedAfter, 0.5),
    decisionBefore,
    "the decision changed after live health did, with no new observation",
  );
  const fresh = {};
  for (const f of b.facilities) fresh[f.id] = f.health;
  assert.ok(
    observedCapability(b.facilities, fresh) < observedBefore,
    "a fresh report of the destruction must lower the observed capability",
  );
});

claim("AC-12 the live operation consumes the observed-capability follow-up", () => {
  const src = readFileSync(resolve(root, "src/sim/battle.ts"), "utf8");
  assert.match(
    src,
    /\bjapaneseFollowUp\b/,
    "battle.ts never calls japaneseFollowUp, so no live follow-up responds to observed capability",
  );
  assert.match(src, /\bobservedCapability\b/, "battle.ts never computes observedCapability");
});

// ---------------------------------------------------------------------------------------------
// AC-13 — the consumers agree
// ---------------------------------------------------------------------------------------------

claim("AC-13 map, target cycling and wing orders agree on the same {kind,id}", () => {
  const b = new Battle(19420604);
  assert.equal(b.selectAssignment("surface"), true, "the surface assignment should be selectable");
  // No `start()`: the fleet's own observation sweep would populate `contacts` for us, so the
  // unobserved case below would not be unobserved. A synthetic wing actor is the wing-order input.
  const wing = { id: "test-wing", team: "us", wing: true, target: null };

  const cruiser = b.ships.find((s) => s.team === "jp" && s.kind === "cruiser" && !s.sunk);
  const unobservedDestroyer = b.ships.find((s) => s.name === "Arashi");
  const carrier = b.ships.find((s) => s.team === "jp" && s.kind === "carrier" && !s.sunk);
  const friendly = b.ships.find((s) => s.team === "us" && s.kind === "destroyer");
  const sub = b.ships.find((s) => s.team === "jp" && s.kind === "sub" && !s.sunk);
  const doomed = b.ships.find((s) => s.name === "Nowaki");
  sub.surfaced = true;
  for (const s of [cruiser, carrier, friendly, sub, doomed]) b.recordContact(s);
  doomed.sunk = true;
  b.report();
  b.time += 30;
  b.deliverReports();
  b.setCommand("strike");

  const optionFor = (s) => ({
    kind: "surface",
    targetKind: s.kind,
    targetId: s.id,
    label: s.name,
    detail: "",
    feasible: true,
    reason: "",
  });

  for (const s of [cruiser, sub, unobservedDestroyer, carrier, friendly, doomed]) {
    // The map/list path: exactly what the briefing layer validates before it draws a clickable contact.
    const mapOffered = validateSelection(optionFor(s), b.briefingWorld(), b.time).ok;
    // The cycle path: the only list the map's cycle function walks.
    const cycleOffered = b.targetContacts().some((c) => c.id === s.id);
    // The map click path and the wing-order path, both through the live Battle.
    const designated = b.designateTarget(s.id);
    const wingId = selectNavalTarget(b, wing)?.id ?? null;
    const wingOffered = wingId === s.id;
    assert.equal(mapOffered, cycleOffered, `${s.kind}/${s.id}: cycling disagrees with map selection`);
    assert.equal(designated, mapOffered, `${s.kind}/${s.id}: designation disagrees with map selection`);
    assert.equal(
      wingOffered,
      mapOffered,
      `${s.kind}/${s.id}: wing orders disagree with map selection (wing chose ${wingId})`,
    );
  }

  // Agreement is not empty: name one accepted and one rejected case on each dimension.
  assert.equal(b.targetContacts().some((c) => c.id === cruiser.id), true, "an observed cruiser must be offered");
  assert.equal(
    b.targetContacts().some((c) => c.id === unobservedDestroyer.id),
    false,
    "an unobserved ship must never be offered",
  );
  assert.equal(b.designateTarget(unobservedDestroyer.id), false, "an unobserved ship must be rejected for designation");
  assert.notEqual(selectNavalTarget(b, wing)?.id, unobservedDestroyer.id, "wing orders must not accept an unobserved ship");

  assert.equal(b.targetContacts().some((c) => c.id === sub.id), true, "a surfaced submarine is a legal surface target");
  sub.surfaced = false;
  assert.equal(b.targetContacts().some((c) => c.id === sub.id), false, "a submerged boat must not be offered");
  assert.equal(b.designateTarget(sub.id), false, "a submerged boat must be rejected for designation");
  assert.notEqual(selectNavalTarget(b, wing)?.id, sub.id, "wing orders must not accept a submerged contact");
});

// ---------------------------------------------------------------------------------------------
// AC-17 — torpedo variants are live
// ---------------------------------------------------------------------------------------------

claim("AC-17 a released torpedo's run comes from its variant, not a shared constant", () => {
  const b = new Battle(19420604);
  const usRun = b.spawnTorpedo({ team: "us", x: 0, z: 0, id: "l-us", owner: "l-us", airframe: "tbd" }, 0, {
    aerial: true,
  });
  const jpRun = b.spawnTorpedo({ team: "jp", x: 0, z: 0, id: "l-jp", owner: "l-jp", airframe: "kate" }, 0, {
    aerial: true,
  });
  const mk13 = torpedoVariant("mk13");
  const type91 = torpedoVariant("type91");
  const mismatches = [];
  const expect = (label, actual, expected) => {
    if (actual !== expected) mismatches.push(`${label}: live ${actual}, variant ${expected}`);
  };
  expect("mk13 speed", usRun.speed, mk13.settings[0].speed);
  expect("mk13 running depth", -usRun.y, actualRunDepth("mk13", mk13.runDepth.min));
  expect("mk13 arming distance", usRun.armedDistance, mk13.armingDistance);
  expect("mk13 range", usRun.range, mk13.settings[0].range);
  expect("type91 speed", jpRun.speed, type91.settings[0].speed);
  expect("type91 running depth", -jpRun.y, actualRunDepth("type91", type91.runDepth.min));
  expect("type91 arming distance", jpRun.armedDistance, type91.armingDistance);
  expect("type91 range", jpRun.range, type91.settings[0].range);
  assert.deepEqual(
    mismatches,
    [],
    `the running torpedo does not carry its variant:\n      - ${mismatches.join("\n      - ")}`,
  );
});

claim("AC-17 two different variants actually differ in the running weapon", () => {
  const b = new Battle(19420604);
  const usRun = b.spawnTorpedo({ team: "us", x: 0, z: 0, id: "l-us", owner: "l-us", airframe: "tbd" }, 0, {
    aerial: true,
  });
  const jpRun = b.spawnTorpedo({ team: "jp", x: 0, z: 0, id: "l-jp", owner: "l-jp", airframe: "kate" }, 0, {
    aerial: true,
  });
  const fields = ["speed", "y", "armedDistance", "range"];
  const differ = fields.filter((f) => usRun[f] !== jpRun[f]);
  assert.ok(
    differ.length >= 3,
    `Mark 13 and Type 91 differ in speed, depth, arming and range, but the running weapons differ only in: ${
      differ.join(", ") || "nothing"
    }`,
  );
});

claim("AC-17 a hit inside the arming distance does not detonate", () => {
  const strikeAt = (distance) => {
    const b = new Battle(19420604);
    const target = b.ships.find((s) => s.kind === "destroyer" && s.team === "jp");
    target.x = 0;
    target.z = -distance;
    target.heading = 0;
    const before = target.hp;
    b.spawnTorpedo({ team: "us", x: 0, z: 0, id: "l", owner: "l" }, 0, { aerial: true });
    for (let i = 0; i < 2000 && b.torpedoes.length; i += 1) b.updateWeapons(STEP);
    return { before, after: target.hp, consumed: b.torpedoes.length === 0 };
  };
  const near = strikeAt(100);
  assert.ok(near.consumed, "the torpedo must reach the hull inside the arming distance");
  assert.equal(near.after, near.before, `a hit inside the arming distance must not detonate: ${near.before} -> ${near.after}`);
  const far = strikeAt(400);
  assert.ok(far.after < far.before, `a hit beyond the arming distance must detonate: hull held at ${far.after}`);
});

claim("AC-17 a torpedo running deeper than the target's draught passes under it", () => {
  const b = new Battle(19420604);
  const target = b.ships.find((s) => s.kind === "destroyer" && s.team === "jp");
  target.x = 0;
  target.z = -400;
  target.heading = 0;
  const before = target.hp;
  const t = b.spawnTorpedo({ team: "us", x: 0, z: 0, id: "l", owner: "l" }, 0, { aerial: true });
  // Hand the weapon a run depth well below a destroyer's keel.
  t.y = -50;
  for (let i = 0; i < 2000 && b.torpedoes.length; i += 1) b.updateWeapons(STEP);
  assert.equal(
    target.hp,
    before,
    `a torpedo at ${Math.abs(t.y)} m ran under a destroyer, yet hit it for ${before - target.hp} hp; ` +
      `Battle's live torpedo test never compares running depth to draught (torpedo-run.sweptHit does)`,
  );
});

console.log("");
if (failures.length) {
  console.log(`check-battle-consumers: ${failures.length} claim(s) FAILED`);
  for (const f of failures) console.log(`  - ${f.name}`);
  process.exitCode = 1;
} else {
  console.log("check-battle-consumers: carrier conservation, facilities, the target contract and torpedo variants all hold through Battle");
}
