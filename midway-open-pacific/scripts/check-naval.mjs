/**
 * Surface-group check for the pure `src/sim/naval.ts` helpers. No browser, no test framework: esbuild
 * bundles the TS and node:assert/strict asserts the station frame, steering limits, closest approach,
 * avoidance, task priority and hazard circles. Run: node scripts/check-naval.mjs
 */
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { build } from "esbuild";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const built = await build({
  stdin: { contents: 'export * from "./src/sim/naval.ts";', loader: "ts", resolveDir: root },
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node20",
  write: false,
  logLevel: "silent",
});
const {
  stationTarget,
  steerToStation,
  closestApproach,
  avoidanceHeading,
  chooseTask,
  clearOfHazard,
  rejoinCourse,
  courseAuthority,
  rescueWindow,
  COMMIT_SECONDS,
} = await import(`data:text/javascript,${encodeURIComponent(built.outputFiles[0].text)}`);

const close = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const freeze = (o) => Object.freeze(o);

// 1 — stationTarget rotates the station into the guide's moving frame for 0, PI/2 and PI.
{
  const station = freeze({ shipId: "s", groupId: "g", offsetX: 30, offsetZ: 40 });
  const at0 = stationTarget(100, 200, 0, station);
  assert.ok(close(at0.x, 130) && close(at0.z, 160), `heading 0 should place the station at (130, 160), got (${at0.x}, ${at0.z})`);
  const at90 = stationTarget(100, 200, Math.PI / 2, station);
  assert.ok(close(at90.x, 140) && close(at90.z, 230), `heading PI/2 should place the station at (140, 230), got (${at90.x}, ${at90.z})`);
  const at180 = stationTarget(100, 200, Math.PI, station);
  assert.ok(close(at180.x, 70) && close(at180.z, 240), `heading PI should place the station at (70, 240), got (${at180.x}, ${at180.z})`);
}

// 2 — the turn is rate-limited per frame and the ship closes on its station over 20 steps.
{
  const limits = freeze({ maxSpeed: 20, turnRate: 0.05, slowRadius: 150 });
  const turning = steerToStation({ x: 0, z: 0, heading: 0 }, { x: 0, z: 500 }, 1, limits);
  assert.ok(
    close(turning.heading, limits.turnRate, 1e-9),
    `a large error must turn exactly turnRate*dt, got ${turning.heading}`,
  );
  let ship = { x: 0, z: 0, heading: 0 };
  const target = freeze({ x: 0, z: -500 });
  const start = dist(ship, target);
  for (let i = 0; i < 20; i += 1) {
    const r = steerToStation(ship, target, 1, limits);
    ship = { x: ship.x + Math.sin(r.heading) * r.speed, z: ship.z - Math.cos(r.heading) * r.speed, heading: r.heading };
  }
  const end = dist(ship, target);
  assert.ok(end < start, `steering must reduce distance over 20 steps, went ${start} -> ${end}`);
}

// 3 — closestApproach solves a known crossing and does not go negative when already opening.
{
  const crossing = closestApproach(0, 0, 10, 0, 100, 0, 0, 10);
  assert.ok(close(crossing.time, 5, 1e-9), `crossing time should be 5 s, got ${crossing.time}`);
  assert.ok(close(crossing.distance, Math.SQRT2 * 50, 1e-7), `crossing distance should be 70.71 m, got ${crossing.distance}`);
  const opening = closestApproach(0, 0, -10, 0, 100, 0, 0, 0);
  assert.equal(opening.time, 0, `an opening course must clamp time to 0, got ${opening.time}`);
  assert.ok(close(opening.distance, 100, 1e-9), `opening distance should be the current 100 m, got ${opening.distance}`);
}

// 4 — avoidance is null on a clear pass and a new heading when a collision is coming.
{
  const ship = freeze({ x: 0, z: 0, heading: 0, speed: 20 });
  const clear = freeze([freeze({ x: 500, z: 1000, heading: 0, speed: 10 })]);
  assert.equal(avoidanceHeading(ship, clear, 10, 100), null, "a distant parallel ship is not a hazard");
  const headOn = freeze([freeze({ x: 0, z: -200, heading: Math.PI, speed: 20 })]);
  const adjusted = avoidanceHeading(ship, headOn, 10, 100);
  assert.notEqual(adjusted, null, "a head-on contact inside lookahead must produce a heading");
  assert.notEqual(adjusted, ship.heading, "avoidance must change the heading");
  assert.ok(Math.abs(adjusted - ship.heading) < Math.PI, "avoidance must never reverse");
}

// 5 — the commitment window holds a task, survival always overrides it.
{
  const now = 130;
  const held = freeze({ task: "investigate", targetId: "sub-1", startedAt: 100, reason: "submarine contact" });
  const ship = freeze({ task: held });
  const situation = freeze({
    survival: false,
    taskFeasible: false,
    opportunity: freeze({ task: "attack-submarine", targetId: "sub-2", reason: "fresh contact" }),
    stationFeasible: true,
  });
  const kept = chooseTask(ship, situation, now);
  assert.equal(kept.task, "investigate", `a task inside COMMIT_SECONDS must survive a new opportunity, got ${kept.task}`);
  assert.equal(kept.targetId, "sub-1", "the committed target must be kept");
  const overrode = chooseTask(ship, freeze({ ...situation, survival: true }), now);
  assert.equal(overrode.task, "withdraw", `survival must replace a committed task, got ${overrode.task}`);
  const expired = chooseTask(ship, situation, held.startedAt + COMMIT_SECONDS);
  assert.equal(expired.task, "attack-submarine", `after the window a feasible new opportunity replaces the task, got ${expired.task}`);
}

// 6 — clearOfHazard is false inside a circle plus margin and true outside.
{
  const hazards = freeze([freeze({ x: 0, z: 0, radius: 100 }), freeze({ x: 300, z: 0, radius: 50 })]);
  assert.equal(clearOfHazard(0, 0, hazards, 20), false, "the hazard centre must be blocked");
  assert.equal(clearOfHazard(110, 0, hazards, 20), false, "inside radius plus margin must be blocked");
  assert.equal(clearOfHazard(130, 0, hazards, 20), true, "outside radius plus margin must be clear");
  assert.equal(clearOfHazard(300, 0, hazards, 20), false, "the second hazard must also block");
}

// 7 — every function is pure: frozen inputs never throw and repeated calls match.
{
  const station = freeze({ shipId: "s", groupId: "g", offsetX: 12, offsetZ: -7 });
  assert.doesNotThrow(() => stationTarget(5, 6, 0.4, station), "stationTarget must not mutate its station");
  assert.deepEqual(stationTarget(5, 6, 0.4, station), stationTarget(5, 6, 0.4, station), "stationTarget must be repeatable");

  const ship = freeze({ x: 1, z: 2, heading: 0.3, speed: 14 });
  const target = freeze({ x: 40, z: -30 });
  const limits = freeze({ maxSpeed: 18, turnRate: 0.04, slowRadius: 120 });
  assert.doesNotThrow(() => steerToStation(ship, target, 0.5, limits), "steerToStation must not mutate its ship");
  assert.deepEqual(steerToStation(ship, target, 0.5, limits), steerToStation(ship, target, 0.5, limits), "steerToStation must be repeatable");

  const others = freeze([freeze({ x: 0, z: -150, heading: Math.PI, speed: 20 })]);
  assert.doesNotThrow(() => avoidanceHeading(ship, others, 5, 80), "avoidanceHeading must not mutate its inputs");
  assert.equal(avoidanceHeading(ship, others, 5, 80), avoidanceHeading(ship, others, 5, 80), "avoidanceHeading must be repeatable");

  const held = freeze({ task: "rescue", targetId: "dd-1", startedAt: 10, reason: "escort requested" });
  const taskShip = freeze({ task: held });
  const situation = freeze({
    survival: false,
    taskFeasible: true,
    opportunity: null,
    stationFeasible: true,
  });
  assert.doesNotThrow(() => chooseTask(taskShip, situation, 20), "chooseTask must not mutate its inputs");
  assert.deepEqual(chooseTask(taskShip, situation, 20), chooseTask(taskShip, situation, 20), "chooseTask must be repeatable");

  const hazards = freeze([freeze({ x: 0, z: 0, radius: 50 })]);
  assert.doesNotThrow(() => clearOfHazard(80, 0, hazards, 10), "clearOfHazard must not mutate its hazards");
  assert.equal(clearOfHazard(80, 0, hazards, 10), clearOfHazard(80, 0, hazards, 10), "clearOfHazard must be repeatable");

  const rejoin = freeze({ x: 40, z: -30, dt: 0.5 });
  const rejoinShip = freeze({ x: 1, z: 2, heading: 0.3 });
  assert.doesNotThrow(() => rejoinCourse(rejoinShip, rejoin, limits), "rejoinCourse must not mutate its inputs");
  assert.deepEqual(rejoinCourse(rejoinShip, rejoin, limits), rejoinCourse(rejoinShip, rejoin, limits), "rejoinCourse must be repeatable");

  const authorityShip = freeze({ id: "a", groupId: "g", guide: false, evading: true });
  const authorityOther = freeze([freeze({ id: "b", groupId: "g", guide: true, evading: false })]);
  assert.doesNotThrow(() => courseAuthority(authorityShip, authorityOther), "courseAuthority must not mutate its inputs");
  assert.equal(courseAuthority(authorityShip, authorityOther), courseAuthority(authorityShip, authorityOther), "courseAuthority must be repeatable");

  const survivors = freeze([freeze({ id: "a", x: 10, z: 0, since: 0, count: 5 })]);
  const rescueLimits = freeze({ fromX: 0, fromZ: 0, range: 100, minCount: 3, abandonAfter: 600 });
  assert.doesNotThrow(() => rescueWindow(survivors, 100, rescueLimits), "rescueWindow must not mutate its inputs");
  assert.deepEqual(rescueWindow(survivors, 100, rescueLimits), rescueWindow(survivors, 100, rescueLimits), "rescueWindow must be repeatable");
}

// 8 — a rejoin is turn-rate-limited every step and closes on the station monotonically over 30 steps.
{
  const limits = freeze({ maxSpeed: 20, turnRate: 0.05, slowRadius: 150 });
  const station = freeze({ x: 200, z: -800, dt: 1 });
  let ship = { x: 0, z: 0, heading: 0 };
  let previous = dist(ship, station);
  for (let i = 0; i < 30; i += 1) {
    const r = rejoinCourse(ship, station, limits);
    const turned = Math.abs(Math.atan2(Math.sin(r.heading - ship.heading), Math.cos(r.heading - ship.heading)));
    assert.ok(turned <= limits.turnRate * station.dt + 1e-9, `step ${i} turned ${turned} rad, past the ${limits.turnRate} rad/s limit`);
    ship = { x: ship.x + Math.sin(r.heading) * r.speed, z: ship.z - Math.cos(r.heading) * r.speed, heading: r.heading };
    const nowDist = dist(ship, station);
    assert.ok(nowDist < previous, `step ${i} must close on station, went ${previous} -> ${nowDist}`);
    previous = nowDist;
  }
}

// 9 — evasion holds course authority; when it ends the guide regains it, and two ships never both yield.
{
  const guide = freeze({ id: "g1", groupId: "g", guide: true, evading: false });
  const escort = freeze({ id: "e2", groupId: "g", guide: false, evading: false });
  assert.equal(courseAuthority(escort, freeze([guide])), "g1", "a non-guide yields to the guide");
  assert.equal(courseAuthority(guide, freeze([escort])), null, "the guide sets its own course");

  const evader = freeze({ id: "e2", groupId: "g", guide: false, evading: true });
  assert.equal(courseAuthority(guide, freeze([evader])), "e2", "the guide yields to an evasion");
  assert.equal(courseAuthority(evader, freeze([guide])), null, "the evader holds the course");
  assert.equal(courseAuthority(escort, freeze([guide])), "g1", "once evasion ends the guide regains authority");

  const evaderA = freeze({ id: "a", groupId: "g", guide: false, evading: true });
  const evaderB = freeze({ id: "b", groupId: "g", guide: false, evading: true });
  const aYields = courseAuthority(evaderA, freeze([evaderB]));
  const bYields = courseAuthority(evaderB, freeze([evaderA]));
  assert.ok(!(aYields && bYields), `two ships must not mutually yield, got ${aYields} and ${bYields}`);
  assert.ok(aYields === null || bYields === null, "at most one of the pair yields");
}

// 10 — rescueWindow prefers the larger, then the closer group, and refuses a group past abandonment.
{
  const limits = freeze({ fromX: 0, fromZ: 0, range: 500, minCount: 3, abandonAfter: 600 });
  const mixed = freeze([
    freeze({ id: "near-small", x: 50, z: 0, since: 0, count: 4 }),
    freeze({ id: "far-large", x: 300, z: 0, since: 0, count: 9 }),
  ]);
  const larger = rescueWindow(mixed, 100, limits);
  assert.equal(larger.targetId, "far-large", `the larger group must win, got ${larger.targetId}`);
  assert.equal(larger.until, 600, `until must be since + abandonAfter, got ${larger.until}`);

  const tied = freeze([
    freeze({ id: "far", x: 400, z: 0, since: 0, count: 6 }),
    freeze({ id: "near", x: 20, z: 0, since: 0, count: 6 }),
  ]);
  assert.equal(rescueWindow(tied, 100, limits).targetId, "near", "closer wins a count tie");

  const stale = freeze([freeze({ id: "old", x: 10, z: 0, since: 0, count: 9 })]);
  assert.equal(rescueWindow(stale, 700, limits), null, "past the abandon time no group is attempted");
  assert.equal(rescueWindow(freeze([freeze({ id: "out", x: 900, z: 0, since: 0, count: 9 })]), 100, limits), null, "out of range is not attempted");
  assert.equal(rescueWindow(freeze([freeze({ id: "few", x: 10, z: 0, since: 0, count: 2 })]), 100, limits), null, "below minCount is not attempted");
}

console.log("check-naval: 10 checks passed");
