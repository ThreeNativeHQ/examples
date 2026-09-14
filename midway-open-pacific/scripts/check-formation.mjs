/**
 * Group-formation check for the pure `src/sim/formation.ts` helpers. No browser, no test framework:
 * esbuild bundles the TS and node:assert/strict asserts the moving frame through naval's own
 * stationTarget, the wind refusal, hazard routing, reform churn and lost coverage. The station
 * rotation is deliberately checked against `naval.stationTarget` rather than a second copy of the
 * frame maths, so a divergence between the two modules fails here.
 * Run: node scripts/check-formation.mjs
 */
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { build } from "esbuild";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const built = await build({
  stdin: {
    contents: 'export * from "./src/sim/formation.ts"; export * from "./src/sim/naval.ts";',
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
  FORMATIONS,
  groupCourse,
  turnIntoWind,
  reformAfter,
  coverageLost,
  stationTarget,
  clearOfHazard,
} = await import(`data:text/javascript,${encodeURIComponent(built.outputFiles[0].text)}`);

const close = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;
const freeze = (o) => Object.freeze(o);
const groupFrozen = (memberIds) =>
  freeze({
    id: "tf",
    guideId: "cv",
    memberIds: freeze(memberIds),
    formationId: "screen",
    course: 0,
    speed: 15,
  });

// 1 — the three formation tables exist and no more (the PRD warns against a preset system).
{
  const ids = Object.keys(FORMATIONS).sort();
  assert.deepEqual(ids, ["dispersal", "line-ahead", "screen"], `exactly three formations, got ${ids}`);
  for (const f of Object.values(FORMATIONS)) {
    assert.ok(f.slots.length > 0, `${f.id} must have stations`);
    const names = new Set(f.slots.map((s) => s.slot));
    assert.equal(names.size, f.slots.length, `${f.id} station names must be unique`);
  }
}

// 2 — the moving frame is naval's: a screen station rotates through 0, PI/2 and PI.
{
  const station = freeze({ ...FORMATIONS.screen.slots[1], groupId: "g", shipId: "e1" });
  const at0 = stationTarget(100, 200, 0, station);
  assert.ok(
    close(at0.x, 100 + station.offsetX) && close(at0.z, 200 - station.offsetZ),
    `heading 0 must place the station at (${100 + station.offsetX}, ${200 - station.offsetZ}), got (${at0.x}, ${at0.z})`,
  );
  const at90 = stationTarget(100, 200, Math.PI / 2, station);
  assert.ok(
    close(at90.x, 100 + station.offsetZ) && close(at90.z, 200 + station.offsetX),
    `heading PI/2 must place the station at (${100 + station.offsetZ}, ${200 + station.offsetX}), got (${at90.x}, ${at90.z})`,
  );
  const at180 = stationTarget(100, 200, Math.PI, station);
  assert.ok(
    close(at180.x, 100 - station.offsetX) && close(at180.z, 200 + station.offsetZ),
    `heading PI must place the station at (${100 - station.offsetX}, ${200 + station.offsetZ}), got (${at180.x}, ${at180.z})`,
  );
}

// 3 — turnIntoWind refuses for want of sea room or intent, accepts both together, and faces the wind.
{
  const group = groupFrozen(["e1", "e2"]);
  const launch = freeze({ kind: "launch-recovery", course: 1.2, speed: 10, guideX: 0, guideZ: 0 });
  const transit = freeze({ kind: "transit", course: 1.2, speed: 10, guideX: 0, guideZ: 0 });
  const wind = freeze({ x: 1, z: 0 });

  const short = turnIntoWind(group, wind, launch, freeze({ available: 500, required: 2000 }));
  assert.equal(short.ok, false, "a short sea room must refuse the turn");
  assert.match(short.reason, /sea room/, `refusal must name sea room, got "${short.reason}"`);
  assert.equal(short.course, group.course, "a refusal keeps the guide's course");

  const wrongIntent = turnIntoWind(group, wind, transit, freeze({ available: 9000, required: 2000 }));
  assert.equal(wrongIntent.ok, false, "a transit must not turn into wind");
  assert.match(wrongIntent.reason, /intent/, `refusal must name the intent, got "${wrongIntent.reason}"`);

  const accepted = turnIntoWind(group, wind, launch, freeze({ available: 9000, required: 2000 }));
  assert.equal(accepted.ok, true, "launch with sea room must turn");
  assert.match(accepted.reason, /wind/, `acceptance must name the wind, got "${accepted.reason}"`);
  const fx = Math.sin(accepted.course);
  const fz = -Math.cos(accepted.course);
  assert.ok(fx * wind.x + fz * wind.z < 0, "the accepted course must face into the wind");
}

// 4 — a hazard dead ahead bends the course clear; a clear request passes through unchanged.
{
  const group = groupFrozen(["e1", "e2"]);
  const limits = freeze({ maxSpeed: 20, lookahead: 6000, margin: 100, step: 0.1 });
  const intent = freeze({ kind: "transit", course: 0, speed: 15, guideX: 0, guideZ: 0 });
  const hazards = freeze([freeze({ x: 0, z: -5000, radius: 500 })]);

  const planned = groupCourse(group, intent, hazards, limits);
  assert.notEqual(planned.course, 0, "a hazard dead ahead must change the guide's course");
  const px = Math.sin(planned.course) * limits.lookahead;
  const pz = -Math.cos(planned.course) * limits.lookahead;
  assert.equal(
    clearOfHazard(px, pz, hazards, limits.margin),
    true,
    `the planned course must clear the hazard, ended at (${px.toFixed(0)}, ${pz.toFixed(0)})`,
  );
  assert.match(planned.reason, /hazard/, `routing must be recorded as a hazard, got "${planned.reason}"`);

  const open = freeze([freeze({ x: 9000, z: 0, radius: 500 })]);
  const straight = groupCourse(group, intent, open, limits);
  assert.equal(straight.course, 0, "a clear requested course must hold");
  assert.match(straight.reason, /clear/, `a clear route must say so, got "${straight.reason}"`);

  const fast = groupCourse(group, freeze({ ...intent, speed: 99 }), open, limits);
  assert.equal(fast.speed, limits.maxSpeed, `speed must be capped at maxSpeed, got ${fast.speed}`);
}

// 5 — reformAfter returns each ship to the station it held, and never shares a station.
{
  const group = groupFrozen(["e1", "e2", "e3"]);
  const disrupted = freeze([
    freeze({ id: "e1", slot: "starboard-bow" }),
    freeze({ id: "e2", slot: "port-bow" }),
    freeze({ id: "e3", slot: null }),
  ]);
  const back = reformAfter(group, disrupted, 500);
  assert.equal(back.length, 3, "every member must be assigned");
  assert.equal(back.find((a) => a.shipId === "e1").slot, "starboard-bow", "e1 keeps its station");
  assert.equal(back.find((a) => a.shipId === "e2").slot, "port-bow", "e2 keeps its station");
  assert.ok(back.every((a) => a.at === 500), "the order carries the issued time");
  const names = new Set(back.map((a) => a.slot));
  assert.equal(names.size, 3, "no two ships may share a station");

  const contested = freeze([
    freeze({ id: "e1", slot: "port-bow" }),
    freeze({ id: "e2", slot: "port-bow" }),
  ]);
  const settled = reformAfter(group, contested, 0);
  assert.equal(settled.find((a) => a.shipId === "e1").slot, "port-bow", "the lower id keeps a contested station");
  assert.notEqual(settled.find((a) => a.shipId === "e2").slot, "port-bow", "the other ship must move off it");
}

// 6 — coverageLost is zero with nobody away and rises as escorts are removed.
{
  const group = groupFrozen(["e1", "e2", "e3"]);
  assert.equal(coverageLost(group, freeze([])), 0, "nobody away must cost nothing");
  const one = coverageLost(group, freeze(["e1"]));
  const two = coverageLost(group, freeze(["e1", "e2"]));
  assert.ok(one > 0, `one escort away must cost coverage, got ${one}`);
  assert.ok(two > one, `two away must cost more than one, got ${two} vs ${one}`);
  assert.equal(coverageLost(group, freeze(["cv"])), 0, "the guide is not a screen station");
}

// 7 — every function is pure: frozen inputs never throw and repeated calls match.
{
  const group = groupFrozen(["e1", "e2", "e3"]);
  const intent = freeze({ kind: "transit", course: 0.3, speed: 12, guideX: 5, guideZ: 6 });
  const hazards = freeze([freeze({ x: 100, z: -200, radius: 50 })]);
  const limits = freeze({ maxSpeed: 20, lookahead: 3000, margin: 100, step: 0.1 });
  assert.doesNotThrow(() => groupCourse(group, intent, hazards, limits), "groupCourse must not mutate");
  assert.deepEqual(
    groupCourse(group, intent, hazards, limits),
    groupCourse(group, intent, hazards, limits),
    "groupCourse must be repeatable",
  );

  const wind = freeze({ x: 0, z: 1 });
  const seaRoom = freeze({ available: 4000, required: 1000 });
  assert.doesNotThrow(() => turnIntoWind(group, wind, intent, seaRoom), "turnIntoWind must not mutate");
  assert.deepEqual(
    turnIntoWind(group, wind, intent, seaRoom),
    turnIntoWind(group, wind, intent, seaRoom),
    "turnIntoWind must be repeatable",
  );

  const disrupted = freeze([freeze({ id: "e1", slot: "starboard-beam" })]);
  assert.doesNotThrow(() => reformAfter(group, disrupted, 10), "reformAfter must not mutate");
  assert.deepEqual(reformAfter(group, disrupted, 10), reformAfter(group, disrupted, 10), "reformAfter must be repeatable");

  const absent = freeze(["e2", "e3"]);
  assert.doesNotThrow(() => coverageLost(group, absent), "coverageLost must not mutate");
  assert.equal(coverageLost(group, absent), coverageLost(group, absent), "coverageLost must be repeatable");
}

console.log("check-formation: 7 checks passed");
