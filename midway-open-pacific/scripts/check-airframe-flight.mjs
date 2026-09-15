/**
 * Airframe flight check (PRD AC-5).
 *
 * `check-flight`, `check-aircraft` and `check-torpedo-run` prove pieces in isolation. This one proves
 * the criterion through a real `Battle.step`: a loaded TBD and Kate fly the engine's `FlightModel`
 * through ingress to a legal release, a Kate level-bombs, engine damage and engine loss actually
 * change the flight path, and no old motion integrator survives beside the model.
 *
 * Uses the esbuild vite already installs. Run: node scripts/check-airframe-flight.mjs
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
      export { Battle } from "./src/sim/battle.ts";
      export { torpedoEnvelope } from "./src/sim/armament.ts";
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
const { Battle, torpedoEnvelope } = await import(
  `data:text/javascript,${encodeURIComponent(built.outputFiles[0].text)}`
);

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
/** A fresh, identified contact on `target` in `team`'s own intel, dated now. */
function sight(b, team, target, classification = target.kind) {
  b.teamIntel[team].set(target.id, {
    id: target.id,
    team,
    observerId: "check",
    targetId: target.id,
    observedAt: b.time,
    x: target.x,
    z: target.z,
    heading: target.heading,
    speed: target.speed,
    errorRadius: 60,
    classification,
    confidence: 1,
    lost: false,
    time: b.time,
    kind: classification,
    identified: true,
    reported: true,
  });
}
/** Freeze the deck cycle and trim the roster, so the one aircraft under test is the only one flying. */
function isolate(b, a) {
  b.reconLaunched = true;
  for (const s of b.ships)
    if (s.kind === "carrier")
      s.mission = { kind: "none", target: null, want: {}, until: Number.POSITIVE_INFINITY };
  b.aircraft = b.aircraft.filter((x) => x === a);
}
/**
 * A real battle with one aircraft launched from `shipName` for `role`, its side holding a fresh
 * contact on an enemy hull. The aircraft is placed a short run from that hull so the flight is a
 * torpedo run rather than an eighteen-kilometre transit.
 */
function strikeRun(seed, shipName, role, targetTeam, targetKind, opts = {}) {
  const { range = 6500, quiet = false, settled = false, anchored = false } = opts;
  const b = play(seed);
  const home = b.ships.find((s) => s.name === shipName);
  const target = b.ships.find((s) => s.team === targetTeam && s.kind === targetKind && !s.sunk);
  assert.ok(home && target, `setup: ${shipName} or its target is missing`);
  // `quiet` silences the enemy flak so a claim that is about the weapon release is not gated on the
  // aircraft surviving a defended approach; the ingress claims fly against the live guns. `anchored`
  // holds the target on a straight course so the release claim is not also a torpedo-attack geometry
  // test.
  if (quiet) for (const s of b.ships) if (s.team === targetTeam) s.aa = 0;
  if (anchored) {
    target.baseSpeed = 0;
    target.speed = 0;
  }
  sight(b, home.team, target);
  // `start()` has just spotted a fighter, so the deck interval is running; wait it out.
  let a = null;
  for (let i = 0; i < Math.round(20 / STEP) && !a; i += 1) {
    a = b.launch(home, role);
    if (!a) b.step(STEP, {});
  }
  assert.ok(a, `${shipName} must launch a ${role}`);
  isolate(b, a);
  // Fly the real deck departure, so the aircraft under test is launched by the game's own cycle
  // rather than placed in the air.
  let airborne = false;
  for (let i = 0; i < Math.round(120 / STEP); i += 1) {
    b.step(STEP, {});
    if (a.mode === "flight") {
      airborne = true;
      break;
    }
    if (a.hp <= 0 || a.removed) break;
  }
  assert.ok(airborne, `${a.airframe} never left ${shipName}'s deck (altitude ${a.y.toFixed(1)} m, speed ${a.speed.toFixed(1)} m/s)`);
  assert.equal(
    a.deckRun,
    "liftoff",
    `${a.airframe} left the deck by "${a.deckRun}", not a liftoff: it reached only ${a.ias.toFixed(1)} m/s indicated`,
  );
  // Place it on a straight run-in. `settled` starts it already in the release envelope, which is
  // what the release-legality claim tests; otherwise it starts high and wide for the ingress claim.
  const fwd = { x: Math.sin(target.heading), z: -Math.cos(target.heading) };
  if (settled) {
    const runAlt = home.team === "us" ? 11 : 22;
    const runSpeed = home.team === "us" ? 51 : 70;
    a.heading = target.heading;
    a.x = target.x - fwd.x * range;
    a.z = target.z - fwd.z * range;
    a.speed = runSpeed;
    a.vx = fwd.x * runSpeed;
    a.vz = fwd.z * runSpeed;
    a.y = runAlt;
  } else {
    a.x = target.x;
    a.z = target.z + range;
    a.y = 450;
    a.heading = 0;
    a.speed = a.kind === "torpedo" ? 84 : 103;
    a.vx = 0;
    a.vz = -a.speed;
  }
  a.pitch = 0;
  a.roll = 0;
  a.vy = 0;
  if (a.flight) a.flight.reset();
  return { b, a, home, target };
}

// ---------------------------------------------------------------------------------------------
// AC-5 — TBD and Kate ingress
// ---------------------------------------------------------------------------------------------

/** Fly one aircraft to a torpedo release or the time limit, watching the whole envelope. */
function flyIngress(b, a, target, limit = 210) {
  const believed = () => {
    const c = b.teamIntel[a.team].get(target.id) ?? target;
    const age = b.time - (c.observedAt ?? b.time);
    return { x: c.x + Math.sin(c.heading) * c.speed * age, z: c.z - Math.cos(c.heading) * c.speed * age };
  };
  let minD = Infinity;
  let sawTorpedoRun = false;
  const startD = Math.hypot(a.x - believed().x, a.z - believed().z);
  for (let i = 0; i < Math.round(limit / STEP); i += 1) {
    b.step(STEP, {});
    if (a.hp <= 0 || a.removed || a.mode === "crashing") break;
    for (const key of ["x", "y", "z", "vx", "vy", "vz", "speed", "ias"]) {
      if (a[key] !== undefined && !Number.isFinite(a[key])) throw new Error(`${a.id}: ${key} became ${a[key]}`);
    }
    if (a.y < 0 || a.y > 6000) throw new Error(`${a.id}: altitude left the sane envelope at ${a.y.toFixed(1)} m`);
    if (a.speed < 5 || a.speed > 220) throw new Error(`${a.id}: speed left the sane envelope at ${a.speed.toFixed(1)} m/s`);
    const p = believed();
    minD = Math.min(minD, Math.hypot(a.x - p.x, a.z - p.z));
    if (a.tactic === "torpedo-run") sawTorpedoRun = true;
  }
  return { startD, minD, sawTorpedoRun };
}

claim("AC-5 a loaded TBD flies a stable engine-driven ingress and closes the range", () => {
  const { b, a, target } = strikeRun(19420604, "USS Hornet", "torpedo", "jp", "carrier");
  const r = flyIngress(b, a, target);
  assert.ok(r.sawTorpedoRun, `the TBD never reached a torpedo run (final tactic ${a.tactic})`);
  assert.ok(
    r.minD < Math.min(r.startD - 3000, 1500),
    `the TBD did not close the range: ${Math.round(r.startD)} m -> ${Math.round(r.minD)} m (final y ${a.y.toFixed(1)} m, speed ${a.speed.toFixed(1)})`,
  );
});

claim("AC-5 a loaded Kate flies a stable engine-driven ingress and closes the range", () => {
  const { b, a, target } = strikeRun(19420604, "Akagi", "torpedo", "us", "carrier");
  const r = flyIngress(b, a, target);
  assert.ok(r.sawTorpedoRun, `the Kate never reached a torpedo run (final tactic ${a.tactic})`);
  assert.ok(
    r.minD < Math.min(r.startD - 3000, 1500),
    `the Kate did not close the range: ${Math.round(r.startD)} m -> ${Math.round(r.minD)} m (final y ${a.y.toFixed(1)} m, speed ${a.speed.toFixed(1)})`,
  );
});

// ---------------------------------------------------------------------------------------------
// AC-5 — legal release
// ---------------------------------------------------------------------------------------------

claim("AC-5 every AI torpedo release passes the variant envelope at the moment of release", () => {
  const releases = [];
  const runs = [];
  for (const [ship, role, team] of [
    ["USS Hornet", "torpedo", "jp"],
    ["Akagi", "torpedo", "us"],
  ]) {
    const { b, a, target } = strikeRun(19420604, ship, role, team, "carrier", {
      range: 900,
      quiet: true,
      settled: true,
      anchored: true,
    });
    const original = b.dropTorpedo.bind(b);
    b.dropTorpedo = (craft) => {
      releases.push({
        airframe: craft.airframe,
        y: craft.y,
        speed: craft.speed,
        roll: craft.roll,
        pitch: craft.pitch,
        env: torpedoEnvelope(craft),
      });
      return original(craft);
    };
    const r = flyIngress(b, a, target, 300);
    runs.push(`${a.airframe} min ${Math.round(r.minD)} m, tactic ${a.tactic}, y ${a.y.toFixed(0)} m, hp ${a.hp}`);
  }
  const illegal = releases.filter((r) => !r.env.safe);
  assert.ok(releases.length > 0, `no AI torpedo release happened at all (${runs.join("; ")})`);
  assert.ok(
    releases.some((r) => r.airframe === "tbd") && releases.some((r) => r.airframe === "kate"),
    `both airframes must release: released ${JSON.stringify(releases.map((r) => r.airframe))} (${runs.join("; ")})`,
  );
  assert.deepEqual(
    illegal.map((r) => `${r.airframe}: h=${r.y.toFixed(1)} v=${r.speed.toFixed(1)} bank=${r.roll.toFixed(2)} (${r.env.problems.join(", ")})`),
    [],
    "an AI released a torpedo outside its own envelope",
  );
});

// ---------------------------------------------------------------------------------------------
// AC-5 — Kate level bombing
// ---------------------------------------------------------------------------------------------

claim("AC-5 a Kate executes level bombing, releasing from the level-bomber altitude", () => {
  const b = play(19420604);
  const home = b.ships.find((s) => s.name === "Akagi");
  let a = null;
  for (let i = 0; i < Math.round(20 / STEP) && !a; i += 1) {
    a = b.launch(home, "level");
    if (!a) b.step(STEP, {});
  }
  assert.ok(a, "the game has no level-bombing role to launch a Kate with bombs");
  assert.equal(a.airframe, "kate", `the level role produced a ${a.airframe}, not a Kate`);
  assert.ok(a.bombs > 0, "the level-bombing Kate launched with no bombs");
  isolate(b, a);
  // Get it airborne before placing it on the bomb run, as the strike runs do.
  for (let i = 0; i < Math.round(120 / STEP) && a.mode !== "flight"; i += 1) {
    if (a.hp <= 0 || a.removed) break;
    b.step(STEP, {});
  }
  assert.equal(a.mode, "flight", `the level-bombing Kate never left the deck (altitude ${a.y.toFixed(1)} m)`);
  const island = b.island;
  a.x = island.x;
  a.z = island.z + 9000;
  a.y = 1850;
  a.heading = 0;
  a.speed = 103;
  a.vz = -103;
  if (a.flight) a.flight.reset();
  let release = null;
  const original = b.dropBomb.bind(b);
  b.dropBomb = (craft) => {
    release = { airframe: craft.airframe, tactic: craft.tactic, y: craft.y };
    return original(craft);
  };
  for (let i = 0; i < Math.round(240 / STEP) && !release; i += 1) {
    b.teamIntel.jp.clear(); // keep the shore target the only one: this proves the level-bomb branch
    b.step(STEP, {});
    if (a.hp <= 0 || a.removed || a.mode === "crashing") break;
  }
  assert.ok(release, `the Kate never bombed; final tactic ${a.tactic}, altitude ${a.y.toFixed(0)} m, bombs ${a.bombs}`);
  assert.equal(release.tactic, "level-bomb", `the Kate released on the ${release.tactic} tactic, not level-bomb`);
  assert.ok(
    release.y > 1000,
    `the Kate released at ${release.y.toFixed(0)} m, which is a dive, not the level-bomber altitude`,
  );
});

// ---------------------------------------------------------------------------------------------
// AC-5 — damage changes flight; engine loss is not survivable in level flight
// ---------------------------------------------------------------------------------------------

/** Fly the same seeded flight from a fixed point, optionally with the engine damaged. */
function damagedRun(damaged) {
  const { b, a, target } = strikeRun(19420604, "USS Hornet", "torpedo", "jp", "carrier");
  if (damaged) a.damage.engine.integrity = 0.25;
  let sum = 0;
  let n = 0;
  let minY = a.y;
  for (let i = 0; i < Math.round(150 / STEP); i += 1) {
    b.step(STEP, {});
    sum += a.y;
    n += 1;
    minY = Math.min(minY, a.y);
    if (a.hp <= 0 || a.removed || a.mode === "crashing") break;
  }
  return { meanY: sum / Math.max(1, n), finalY: a.y, minY, finalSpeed: a.speed, ended: a.hp <= 0 || a.removed || a.mode === "crashing" };
}

claim("AC-5 engine damage measurably changes the flight path", () => {
  const healthy = damagedRun(false);
  const hurt = damagedRun(true);
  const lost = healthy.meanY - hurt.meanY;
  const slower = healthy.finalSpeed - hurt.finalSpeed;
  assert.ok(
    lost > 30 || slower > 5,
    `damaged engine flew the same: mean altitude ${healthy.meanY.toFixed(1)} -> ${hurt.meanY.toFixed(1)}, ` +
      `final speed ${healthy.finalSpeed.toFixed(1)} -> ${hurt.finalSpeed.toFixed(1)}`,
  );
});

claim("AC-5 no universal minimum-speed flight survives engine loss", () => {
  const { b, a } = strikeRun(19420604, "USS Hornet", "torpedo", "jp", "carrier");
  // Get it flying first, then destroy the engine outright.
  for (let i = 0; i < Math.round(120 / STEP) && a.mode !== "flight"; i += 1) b.step(STEP, {});
  a.damage.engine.integrity = 0;
  a.engineCut = true;
  const y0 = a.y;
  let ended = false;
  let minY = y0;
  for (let i = 0; i < Math.round(300 / STEP); i += 1) {
    b.step(STEP, {});
    minY = Math.min(minY, a.y);
    if (a.hp <= 0 || a.removed || a.mode === "crashing") {
      ended = true;
      break;
    }
  }
  assert.ok(
    ended,
    `an engine-less aircraft flew on indefinitely: y ${y0.toFixed(0)} -> ${a.y.toFixed(0)} m after 300 s at ${a.speed.toFixed(1)} m/s`,
  );
  assert.ok(minY < y0 - 50, `the engine-less aircraft never lost altitude: ${y0.toFixed(0)} m floor at ${minY.toFixed(0)} m`);
});

// ---------------------------------------------------------------------------------------------
// AC-5 — the engine model is the only integrator
// ---------------------------------------------------------------------------------------------

claim("AC-5 every airborne AI aircraft is flown by its AircraftFlight, and no hand integrator remains", () => {
  const b = play(19420604);
  steps(b, 20);
  const airborne = b.aircraft.filter((a) => a.hp > 0 && (a.mode === "flight" || a.mode === "launch"));
  assert.ok(airborne.length > 0, "no airborne AI aircraft to check");
  for (const a of airborne) {
    assert.ok(a.flight && typeof a.flight.step === "function", `${a.id} (${a.airframe}) has no AircraftFlight`);
    assert.equal(a.flight.state, a, `${a.id}'s FlightModel does not own its own state object`);
    for (const key of ["ias", "thrust", "aoa", "mass"]) {
      assert.ok(Number.isFinite(a[key]), `${a.id}'s engine never wrote ${key}`);
    }
  }
  const src = readFileSync(resolve(root, "src/sim/tactics.ts"), "utf8").split("\n");
  const offenders = [];
  for (let i = 0; i < src.length; i += 1) {
    if (/\ba\.(x|y|z)\s*\+=\s*[^;]*\bdt\b/.test(src[i])) offenders.push(`${i + 1}: ${src[i].trim()}`);
  }
  assert.deepEqual(
    offenders,
    [],
    `tactics.ts still moves an aircraft by hand beside the engine model:\n      ${offenders.join("\n      ")}`,
  );
});

// ---------------------------------------------------------------------------------------------
// AC-5 — recovery
// ---------------------------------------------------------------------------------------------

claim("AC-5 a launched TBD is accepted back and counted again on recovery", () => {
  // The player stays on the deck, so `start()` holds this ship's automatic launches and the one
  // test departure is the only thing on the schedule.
  const b = new Battle(19420604);
  b.start();
  const home = b.home;
  const counted = () => Object.values(home.air.airframes).reduce((n, c) => n + c, 0);
  const before = counted();
  const a = b.launch(home, "torpedo");
  assert.ok(a && a.airframe === "tbd", "the deck must launch a TBD");
  assert.equal(counted(), before - 1, "a launch must take exactly one airframe off the deck");
  steps(b, 7);
  assert.equal(b.recoverAircraft(home, a), true, "the deck must accept the returning TBD");
  assert.equal(counted(), before, "the recovered TBD must be counted again");
});

console.log("");
if (failures.length) {
  console.log(`check-airframe-flight: ${failures.length} claim(s) FAILED`);
  for (const f of failures) console.log(`  - ${f.name}`);
  process.exitCode = 1;
} else {
  console.log("check-airframe-flight: TBD and Kate ingress, release, level bombing, damage, engine loss, engine-only flight and recovery all hold through Battle");
}
