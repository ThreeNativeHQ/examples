/**
 * Naval-battle wiring check (PRD AC-14, AC-15, AC-16, AC-18).
 *
 * `check-naval.mjs`, `check-formation.mjs`, `check-submarine.mjs` and `check-rescue.mjs` already
 * prove the pure modules in isolation. This one proves the *wiring*: it drives a real `Battle`
 * through `step()` and its ordinary entry points only — no direct writes to a task, an AI
 * transition, a group station or a sub mode — and asserts what a screenshot and a playtest cannot
 * see. A formation that quietly loses its station, an escort that "detaches" and never moves, a
 * submarine whose tubes refill forever, or survivors nobody ever reaches all look normal on screen.
 *
 * Uses the esbuild vite already installs. Run: node scripts/check-naval-battle.mjs
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
      export { strikeContact } from "./src/sim/tactics.ts";
      export { depthFor, SUBMERGED_MAX, SURFACED_MAX } from "./src/sim/submarine.ts";
      export { shipClass } from "./src/sim/catalog.ts";
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
  strikeContact,
  depthFor,
  SUBMERGED_MAX,
  SURFACED_MAX,
  shipClass,
} = await import(`data:text/javascript,${encodeURIComponent(built.outputFiles[0].text)}`);

const STEP = 1 / 30;
/** `battle.ts`'s ATOLL_HAZARD_RADIUS, the fringing reef's own circle. */
const ATOLL_HAZARD_RADIUS = 4000;

const failures = [];
/** Run one labelled claim; a failed assert is reported and the rest still run. */
function claim(name, fn) {
  try {
    fn();
    console.log(`PASS  ${name}`);
  } catch (err) {
    failures.push(name);
    console.log(`FAIL  ${name}\n      ${err.message}`);
  }
}
/** Step a battle for `seconds`, spectator so the fleet's own behaviour is what is under test. */
function steps(b, seconds) {
  for (let i = 0; i < Math.round(seconds / STEP); i += 1) b.step(STEP, {});
}
/** A spectator battle already under way. */
function play(seed) {
  const b = new Battle(seed);
  b.start();
  b.player.mode = "spectator";
  return b;
}
/** A ship's offset in its guide's moving frame, the exact inverse of `naval.stationTarget`. */
function frameOffset(ship, guide) {
  const dx = ship.x - guide.x;
  const dz = ship.z - guide.z;
  const s = Math.sin(guide.heading);
  const c = Math.cos(guide.heading);
  return { x: c * dx + s * dz, z: s * dx - c * dz };
}
const groupOf = (b, ship) => b.surfaceGroups.find((g) => g.id === ship.groupId);
const carrierGroupIds = (b) =>
  new Set(b.surfaceGroups.filter((g) => b.byId(g.guideId)?.kind === "carrier").map((g) => g.id));

// ---------------------------------------------------------------------------------------------
// AC-14 — surface groups
// ---------------------------------------------------------------------------------------------

claim("AC-14 escort holds station through a turn", () => {
  const b = play(19420604);
  const guide = b.ships.find((s) => s.name === "USS Enterprise");
  const group = groupOf(b, guide);
  assert.ok(group && carrierGroupIds(b).has(group.id), "the guide should lead a carrier screen");
  const member = b.ships.find((s) => s.id === group.memberIds.find((id) => b.byId(id).kind === "destroyer"));
  assert.ok(member, "the screen should have a destroyer on a station");
  steps(b, 300);
  const before = frameOffset(member, guide);
  const headingBefore = guide.heading;
  guide.cruiseHeading = guide.heading + 0.5;
  steps(b, 300);
  const after = frameOffset(member, guide);
  const turned = Math.abs(guide.heading - headingBefore);
  assert.ok(turned > 0.35, `the group barely turned: ${turned.toFixed(2)} rad`);
  const moved = Math.hypot(after.x - before.x, after.z - before.z);
  assert.ok(
    moved < 150,
    `${member.name}'s frame offset moved ${moved.toFixed(0)} m through a ${turned.toFixed(2)} rad turn ` +
      `(before ${before.x.toFixed(0)},${before.z.toFixed(0)} after ${after.x.toFixed(0)},${after.z.toFixed(0)})`,
  );
  const stationErr = Math.hypot(after.x - member.station.offsetX, after.z - member.station.offsetZ);
  assert.ok(stationErr < 600, `${member.name} is ${stationErr.toFixed(0)} m off its station after the turn`);
});

claim("AC-14 no surface ship teleports", () => {
  const b = play(19420604);
  let worst = { ratio: 0, ship: "" };
  for (let i = 0; i < Math.round(300 / STEP); i += 1) {
    const before = b.ships.map((s) => ({ x: s.x, z: s.z, base: s.baseSpeed }));
    b.step(STEP, {});
    b.ships.forEach((s, j) => {
      if (s.sunk) return;
      const d = Math.hypot(s.x - before[j].x, s.z - before[j].z);
      const ratio = d / (before[j].base * STEP);
      if (ratio > worst.ratio) worst = { ratio, ship: s.name };
    });
  }
  assert.ok(
    worst.ratio <= 1.000001,
    `${worst.ship} moved ${(worst.ratio * 100).toFixed(1)}% of its speed-times-dt in one step`,
  );
});

claim("AC-14 ships avoid the atoll", () => {
  const b = play(19420604);
  const guide = b.ships.find((s) => s.name === "USS Enterprise");
  // Put the guide just outside the reef steering straight at its centre: routing has to earn it.
  guide.x = b.island.x;
  guide.z = b.island.z + 4600;
  guide.cruiseHeading = 0;
  let minD = Infinity;
  for (let i = 0; i < Math.round(300 / STEP); i += 1) {
    b.step(STEP, {});
    for (const s of b.ships) {
      if (s.sunk || s.kind === "sub") continue;
      const d = Math.hypot(s.x - b.island.x, s.z - b.island.z);
      if (d < minD) minD = d;
    }
  }
  assert.ok(minD < 4800, `no ship ever approached the reef (min ${minD.toFixed(0)} m); the hazard was not tested`);
  assert.ok(minD >= ATOLL_HAZARD_RADIUS, `a ship closed to ${minD.toFixed(0)} m of the atoll centre, inside the ${ATOLL_HAZARD_RADIUS} m reef`);
});

claim("AC-14 removing an escort changes coverage", () => {
  const control = play(19420604);
  steps(control, 30);
  const group = control.surfaceGroups.find(
    (g) => g.memberIds.length >= 2 && g.memberIds.some((id) => control.byId(id).kind === "destroyer"),
  );
  assert.ok(group, "a screen with an escort should exist");
  const beforeControl = group.coverageLost;
  const victim = control.byId(group.memberIds.find((id) => control.byId(id).kind === "destroyer"));
  victim.sunk = true;
  control.step(STEP, {});
  const afterControl = group.coverageLost;
  assert.ok(afterControl > beforeControl, `coverage did not change when ${victim.name} was removed`);
  assert.ok(afterControl > 0, `coverage lost was ${afterControl}; the removed station contributed nothing`);
});

// ---------------------------------------------------------------------------------------------
// AC-15 — the Mogami group
// ---------------------------------------------------------------------------------------------

claim("AC-15 Mogami and Mikuma exist, are Mogami class, and are not in a carrier group", () => {
  const b = new Battle(19420604);
  const mogami = b.ships.find((s) => s.name === "Mogami");
  const mikuma = b.ships.find((s) => s.name === "Mikuma");
  assert.ok(mogami && mikuma, "Mogami and Mikuma should both be in the fleet after construction");
  const cls = shipClass("mogami");
  assert.equal(mogami.hullBeam, cls.hullBeam, "Mogami should carry the Mogami class beam");
  assert.equal(mikuma.hullBeam, cls.hullBeam, "Mikuma should carry the Mogami class beam");
  assert.notEqual(mogami.hullBeam, shipClass("tone").hullBeam, "Mogami must not be fitted with the Tone's hull");
  assert.ok(mogami.support && mikuma.support, "the sisters should be marked as the detached support group");
  const carriers = carrierGroupIds(b);
  for (const s of [mogami, mikuma]) {
    assert.ok(!carriers.has(s.groupId), `${s.name} is in a carrier screen, not the detached group`);
    const group = groupOf(b, s);
    assert.ok(group?.route, `${s.name}'s group should have its own route`);
    for (const id of carriers) {
      const cg = b.surfaceGroups.find((g) => g.id === id);
      assert.ok(!cg.memberIds.includes(s.id), `${s.name} was assigned a carrier station`);
    }
  }
});

claim("AC-15 the support route advances on its own", () => {
  const b = play(19420604);
  const mogami = b.ships.find((s) => s.name === "Mogami");
  const mikuma = b.ships.find((s) => s.name === "Mikuma");
  const start = { x: mogami.x, z: mogami.z, mx: mikuma.x, mz: mikuma.z };
  steps(b, 200);
  const moved = Math.hypot(mogami.x - start.x, mogami.z - start.z);
  const movedSister = Math.hypot(mikuma.x - start.mx, mikuma.z - start.mz);
  assert.ok(moved > 500, `Mogami advanced only ${moved.toFixed(0)} m under its own route in 200 s`);
  assert.ok(movedSister > 500, `Mikuma advanced only ${movedSister.toFixed(0)} m in 200 s`);
  const group = groupOf(b, mogami);
  assert.ok(group?.route, "the advancing group should still be the detached support group");
});

claim("AC-15 a Mogami contact is designatable for a surface strike", () => {
  const b = new Battle(19420604);
  assert.equal(b.selectAssignment("surface"), true, "the surface assignment should be selectable in the briefing");
  b.start();
  b.player.mode = "spectator";
  const mogami = b.ships.find((s) => s.name === "Mogami");
  b.recordContact(mogami);
  assert.ok(b.targetContacts().some((c) => c.id === mogami.id), "the sighted Mogami should be an offered target");
  assert.equal(b.designateTarget(mogami.id), true, "designating the sighted Mogami should succeed");
  assert.equal(b.sortie.target, mogami.id, "the designation should reach the single sortie record");
});

claim("AC-15 damage slows a Mogami without deleting it", () => {
  const b = play(19420604);
  const mogami = b.ships.find((s) => s.name === "Mogami");
  steps(b, 20);
  const before = { speed: mogami.speed, engine: mogami.engine, hp: mogami.hp };
  b.damageShip(mogami, 90, { x: mogami.x, y: mogami.deckHeight, z: mogami.z }, "bomb", "us");
  b.step(STEP);
  assert.ok(mogami.hp < before.hp, "the bomb should take hull");
  assert.ok(mogami.engine < before.engine, "the bomb should foul the engine");
  assert.ok(mogami.speed < before.speed, `speed did not fall: ${before.speed.toFixed(2)} -> ${mogami.speed.toFixed(2)} m/s`);
  assert.ok(!mogami.sunk, "a damaged Mogami should still be afloat");
});

// ---------------------------------------------------------------------------------------------
// AC-16 — submarines
// ---------------------------------------------------------------------------------------------

claim("AC-16 a boat changes depth before its mode changes", () => {
  const b = play(19420604);
  const sub = b.ships.find((s) => s.name === "I-168");
  const target = b.ships.find((s) => s.name === "USS Enterprise");
  const scout = b.aircraft.find((a) => a.team === "jp" && a.hp > 0);
  assert.ok(sub && scout, "the Japanese boat and a scout should exist");
  let prevMode = sub.sub.mode;
  let transitions = 0;
  let dived = false;
  for (let i = 0; i < Math.round(300 / STEP); i += 1) {
    // A scout the boat's own side can actually see through: the normal observation path.
    scout.x = target.x + 200;
    scout.z = target.z;
    scout.y = 900;
    scout.hp = 500;
    scout.mode = "flight";
    b.step(STEP, {});
    if (sub.sub.mode !== prevMode) {
      transitions += 1;
      const want = depthFor(sub.sub.mode);
      assert.ok(
        Math.abs(sub.sub.depth - want) <= 1.000001,
        `mode changed to ${sub.sub.mode} at depth ${sub.sub.depth.toFixed(2)} m, but that mode is ${want} m`,
      );
    }
    if (sub.sub.depth > 5) dived = true;
    prevMode = sub.sub.mode;
    if (dived && transitions > 0 && b.time > 80) break;
  }
  assert.ok(dived, `the boat never submerged over ${b.time.toFixed(0)} s`);
  assert.ok(transitions > 0, "the boat's mode never changed, so the depth rule was never exercised");
});

claim("AC-16 a submarine never targets a ship its side has not observed", () => {
  const b = play(19420604);
  const subs = b.ships.filter((s) => s.kind === "sub");
  assert.ok(subs.length >= 1, "there should be at least one boat");
  for (const s of subs) assert.equal(strikeContact(b, s), null, `${s.name} had a target with no report on the air`);
  assert.equal(b.teamIntel.us.size + b.teamIntel.jp.size, 0, "nothing should have been observed yet");
  steps(b, 4);
  assert.equal(b.torpedoes.length, 0, "a boat fired with nothing observed");
});

claim("AC-16 submerged speed stays under the submerged maximum", () => {
  const b = play(19420604);
  let maxSurfaced = 0;
  let maxSubmerged = 0;
  let submerged = false;
  for (let i = 0; i < Math.round(300 / STEP); i += 1) {
    const mode = new Map(b.ships.filter((s) => s.kind === "sub").map((s) => [s.id, s.sub.mode]));
    b.step(STEP, {});
    for (const s of b.ships) {
      if (s.kind !== "sub" || s.sunk) continue;
      if (mode.get(s.id) === "surfaced") maxSurfaced = Math.max(maxSurfaced, s.speed);
      else {
        maxSubmerged = Math.max(maxSubmerged, s.speed);
        submerged = true;
      }
    }
  }
  assert.ok(maxSurfaced <= SURFACED_MAX + 1e-6, `a surfaced boat made ${maxSurfaced.toFixed(2)} m/s over the ${SURFACED_MAX} m/s limit`);
  assert.ok(maxSubmerged <= SUBMERGED_MAX + 1e-6, `a submerged boat made ${maxSubmerged.toFixed(2)} m/s over the ${SUBMERGED_MAX} m/s limit`);
  assert.ok(submerged, "no boat ever submerged, so the submerged cap was not tested");
});

claim("AC-16 tubes are finite: no launch after they are spent", () => {
  const b = play(7);
  const sub = b.ships.find((s) => s.name === "I-168");
  const target = b.ships.find((s) => s.name === "USS Enterprise");
  // The target is made unsinkable so this measures tube endurance, never a ship's survival.
  target.hp = 1e9;
  target.maxHp = 1e9;
  const scout = b.aircraft.find((a) => a.team === "jp" && a.hp > 0);
  const launches = [];
  const real = b.spawnTorpedo.bind(b);
  b.spawnTorpedo = (a, heading, options) => {
    const t = real(a, heading, options);
    if (a === sub) launches.push({ time: b.time, tubes: a.sub.tubes, reloads: a.sub.reloads });
    return t;
  };
  let emptiedAt = null;
  for (let i = 0; i < Math.round(600 / STEP); i += 1) {
    scout.x = target.x + 200;
    scout.z = target.z;
    scout.y = 900;
    scout.hp = 500;
    scout.mode = "flight";
    b.step(STEP, {});
    if (emptiedAt === null && sub.sub.tubes <= 0 && sub.sub.reloads <= 0) emptiedAt = b.time;
    if (emptiedAt !== null && launches.some((l) => l.time > emptiedAt)) break;
  }
  assert.ok(emptiedAt !== null, `the boat never spent its ${sub.sub.reloads} spare loads over ${b.time.toFixed(0)} s`);
  const after = launches.filter((l) => l.time > emptiedAt + STEP / 2);
  assert.equal(
    after.length,
    0,
    `tubes and reloads were both spent at ${emptiedAt.toFixed(0)} s, yet ${after.length} more torpedo(es) launched ` +
      `(first at ${after[0]?.time.toFixed(0)} s with ${after[0]?.tubes} tubes / ${after[0]?.reloads} reloads)`,
  );
});

// ---------------------------------------------------------------------------------------------
// AC-18 — rescue and assist
// ---------------------------------------------------------------------------------------------

claim("AC-18 sinking a ship puts survivors in the water", () => {
  const b = new Battle(19420604);
  const victim = b.ships.find((s) => s.kind === "destroyer" && s.team === "jp");
  b.damageShip(victim, 9999, { x: victim.x, y: 0, z: victim.z }, "bomb", "us");
  assert.ok(victim.sunk, "the destroyed destroyer should be sunk");
  const group = b.survivors.find((g) => g.fromShipId === victim.id);
  assert.ok(group, "sinking a hull should create a survivor group");
  assert.ok(group.count > 0, `the survivor group held ${group.count}`);
});

claim("AC-18 a close escort recovers; a distant one recovers none", () => {
  const run = (near) => {
    const b = play(19420604);
    const victim = b.ships.find((s) => s.kind === "destroyer" && s.team === "jp");
    if (near) {
      const hammann = b.ships.find((s) => s.name === "USS Hammann");
      victim.x = hammann.x + 60;
      victim.z = hammann.z;
    } else {
      victim.x = 40000;
      victim.z = 40000;
    }
    b.damageShip(victim, 9999, { x: victim.x, y: 0, z: victim.z }, "bomb", "us");
    let recovered = 0;
    for (let i = 0; i < Math.round(400 / STEP); i += 1) {
      b.step(STEP, {});
      for (const s of b.ships) recovered = Math.max(recovered, s.recovered ?? 0);
    }
    return { recovered, left: b.survivors.reduce((n, g) => n + g.count, 0) };
  };
  const near = run(true);
  const far = run(false);
  assert.ok(near.recovered > 0, `a close, slow escort recovered nobody (${near.recovered})`);
  assert.equal(far.recovered, 0, `a distant escort recovered ${far.recovered} people`);
  assert.ok(far.left > 0, "the distant survivors should still be in the water");
});

claim("AC-18 the alongside lowers flooding and fire, and costs the screen station", () => {
  const run = (assist) => {
    const b = play(19420604);
    const carrier = b.ships.find((s) => s.name === "USS Yorktown");
    for (let i = 0; i < 3; i += 1)
      b.damageShip(carrier, 30, { x: carrier.x, y: carrier.deckHeight, z: carrier.z }, "torpedo", "jp");
    if (assist) {
      const escort = b.ships.find((s) => s.name === "USS Northampton");
      escort.x = carrier.x + 100;
      escort.z = carrier.z;
    }
    const start = { fire: carrier.fire, list: carrier.list };
    let alongsideShip = null;
    let stationWhenAlongside;
    for (let i = 0; i < Math.round(30 / STEP); i += 1) {
      b.step(STEP, {});
      for (const s of b.ships)
        if (s.assist && s.assist.carrierId === carrier.id && s.assist.phase === "alongside" && !alongsideShip) {
          alongsideShip = s;
          // The station is given up while the ship is actually tied alongside, not after it leaves.
          stationWhenAlongside = s.station;
        }
    }
    return { start, fire: carrier.fire, list: carrier.list, alongsideShip, stationWhenAlongside };
  };
  const assisted = run(true);
  const control = run(false);
  assert.ok(assisted.alongsideShip, "no escort ever went alongside the damaged carrier");
  assert.ok(
    assisted.fire < control.fire,
    `fire with assistance ${assisted.fire.toFixed(3)} did not beat ${control.fire.toFixed(3)} without`,
  );
  assert.ok(
    assisted.list < control.list,
    `flooding with assistance ${assisted.list.toFixed(3)} did not beat ${control.list.toFixed(3)} without`,
  );
  assert.equal(assisted.stationWhenAlongside, null, "the escort did not give up its screen station alongside");
  assert.ok(assisted.alongsideShip.screenCoverageLost > 0, "the escort should report the screen contribution it gave up");
});

// ---------------------------------------------------------------------------------------------
// Determinism — the same seed and input trace reproduce the same battle.
// ---------------------------------------------------------------------------------------------

claim("determinism: same seed and trace, same state", () => {
  const trace = (i) => (i % 3 === 0 ? { throttleUp: true } : i % 3 === 1 ? { pitch: 0.2 } : { turn: -0.1 });
  const r = (n) => Math.round(n * 1000) / 1000;
  const digest = (b) =>
    JSON.stringify({
      time: r(b.time),
      status: b.status,
      score: b.score,
      ships: b.ships.map((s) => [
        s.id, r(s.x), r(s.z), r(s.hp), r(s.speed), r(s.heading), r(s.engine), s.sunk ? 1 : 0,
        s.sub ? [r(s.sub.depth), s.sub.mode, s.sub.tubes, s.sub.reloads, r(s.sub.battery)] : 0,
      ]),
      aircraft: b.aircraft.length,
      torpedoes: b.torpedoes.length,
      bombs: b.bombs.length,
      survivors: b.survivors.map((g) => [g.id, r(g.count), g.fromShipId]),
      coverage: b.surfaceGroups.map((g) => [g.id, r(g.coverageLost)]),
    });
  const run = (seed) => {
    const b = new Battle(seed);
    b.start();
    b.player.mode = "spectator";
    for (let i = 0; i < Math.round(300 / STEP); i += 1) b.step(STEP, trace(i));
    return b;
  };
  const a = run(19420604);
  const c = run(19420604);
  assert.equal(digest(a), digest(c), "the same seed and input trace produced a different battle");
  assert.notEqual(digest(a), digest(run(19420605)), "two different seeds produced an identical battle");
});

console.log("");
if (failures.length) {
  console.log(`check-naval-battle: ${failures.length} claim(s) FAILED`);
  for (const name of failures) console.log(`  - ${name}`);
  process.exitCode = 1;
} else {
  console.log("check-naval-battle: formations, the support group, submarines and rescue all hold through Battle.step");
}
