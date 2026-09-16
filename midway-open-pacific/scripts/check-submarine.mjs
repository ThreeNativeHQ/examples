/**
 * Submarine state check. Bundles the pure module with esbuild and exercises it with node:assert,
 * no test framework. Every assertion here is a property the game must be able to lean on when
 * `Battle` replaces the sine-timer boats. Run: node scripts/check-submarine.mjs
 */
import assert from "node:assert/strict";
import { build } from "esbuild";

const { outputFiles } = await build({
  entryPoints: ["src/sim/submarine.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
});
const s = await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString("base64")}`);

// The pure module is the rules; `Battle` is where they have to actually happen. Bundle it too so
// this gate proves the wiring — a boat that dives, attacks, is hunted and is lost — not just the
// arithmetic a screenshot and a playtest cannot see.
const { outputFiles: battleOut } = await build({
  entryPoints: ["src/sim/battle.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
});
const { Battle } = await import(`data:text/javascript;base64,${Buffer.from(battleOut[0].text).toString("base64")}`);
const STEP = 1 / 30;
const play = (seed) => {
  const b = new Battle(seed);
  b.start();
  b.player.mode = "spectator";
  return b;
};

const state = (over = {}) => ({
  depth: 0,
  depthRate: 0,
  mode: "surfaced",
  battery: 1,
  tubes: 4,
  reloads: 2,
  reloadUntil: 0,
  lastLook: 0,
  ...over,
});
const angleDelta = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));

// stepDepth reaches periscope depth in the expected number of steps and never overshoots.
let dive = state();
let steps = 0;
let maxDepth = 0;
while (dive.depth < s.PERISCOPE_DEPTH && steps < 100) {
  dive = s.stepDepth(dive, "periscope", 0.5, 2);
  steps += 1;
  maxDepth = Math.max(maxDepth, dive.depth);
}
assert.equal(steps, s.PERISCOPE_DEPTH, `reaches periscope depth in ${steps} half-second steps`);
assert.equal(dive.depth, s.PERISCOPE_DEPTH);
assert.equal(dive.mode, "periscope");
assert.ok(maxDepth <= s.PERISCOPE_DEPTH, `never overshoots, peaked at ${maxDepth}`);

// Mode changes on the gauge, not on the order.
const ordered = s.stepDepth(state(), "deep", 0.1, 2);
assert.equal(ordered.mode, "surfaced", "ordering deep does not make the boat deep");
let deep = state();
let claimedAt = null;
for (let i = 0; i < 1000 && claimedAt === null; i += 1) {
  deep = s.stepDepth(deep, "deep", 0.5, 2);
  if (deep.mode === "deep") claimedAt = deep.depth;
}
assert.ok(claimedAt !== null, "the boat eventually reports deep");
assert.ok(Math.abs(claimedAt - s.DEEP_DEPTH) <= 1, `deep mode within 1 m, got ${claimedAt}`);

// Surfaced running spends no battery; a fast submerged boat spends more than a slow one.
assert.equal(s.batteryDrain(state({ mode: "surfaced" }), 9, 10), 0, "diesels do not drain the battery");
const slow = s.batteryDrain(state({ mode: "deep" }), 1, 10);
const fast = s.batteryDrain(state({ mode: "deep" }), 4, 10);
assert.ok(slow > 0 && fast > slow, "submerged drain grows with speed");
assert.ok(Math.abs(fast / slow - 64) < 1e-9, "drain is cubic in speed (4^3 / 1^3)");
assert.equal(s.maxSpeed(state({ mode: "surfaced" })), s.SURFACED_MAX);
assert.equal(s.maxSpeed(state({ mode: "deep" })), s.SUBMERGED_MAX);
assert.equal(s.maxSpeed(state({ mode: "deep", battery: 0 })), s.CRAWL_SPEED, "a flat battery is a crawl");

// A deep boat sees nothing, whatever the range or visibility.
assert.equal(s.canSee(state({ mode: "deep", depth: s.DEEP_DEPTH }), 1, 1e9), false, "deep is blind");
assert.equal(s.canSee(state({ mode: "periscope", depth: s.PERISCOPE_DEPTH }), 100, 1e9), true);
assert.equal(s.canSee(state({ mode: "periscope", depth: s.PERISCOPE_DEPTH }), s.PERISCOPE_HORIZON + 1, 1e9), false, "periscope horizon is short");
assert.equal(s.canSee(state({ mode: "surfaced" }), 9000, 1e9), true, "the bridge sees farther");

// Hydrophone: null below the floor, otherwise a bearing-only contact.
assert.equal(s.hydrophoneBearing(0, 0, 1000, 0, 2, 4, 0.5), null, "quieter than the noise floor is not heard");
const contact = s.hydrophoneBearing(0, 0, 1000, 0, 8, 4, 1);
assert.ok(contact !== null, "a loud target is heard");
const truth = Math.atan2(1000, 0);
assert.ok(Math.abs(angleDelta(contact.bearing, truth)) <= contact.uncertainty, `bearing ${contact.bearing} within +/- ${contact.uncertainty} of ${truth}`);
assert.deepEqual(Object.keys(contact).sort(), ["bearing", "uncertainty"], "bearing only, no range and no identity");
assert.equal("range" in contact, false);
assert.equal("id" in contact, false);

// canFire: deep is refused, shallow is allowed, and the last tube starts a reload.
assert.equal(s.canFire(state({ mode: "deep", depth: 30 }), 0).ok, false, "30 m is too deep");
assert.equal(s.canFire(state({ mode: "deep", depth: 30 }), 0).reason, "too deep");
assert.equal(s.canFire(state({ mode: "periscope", depth: 10 }), 0).ok, true, "10 m can fire");
const fired = s.applyFire(state({ mode: "periscope", depth: 10, tubes: 1, reloads: 2, reloadUntil: 0 }), 50, 40);
assert.equal(fired.tubes, 0);
assert.equal(fired.reloads, 1, "the last tube consumes one reload");
assert.equal(fired.reloadUntil, 90, "and starts its reload clock");
assert.equal(s.canFire(fired, 60).ok, false, "while reloading it cannot fire");
assert.equal(s.canFire(fired, 60).reason, "reloading");

// Intercept: a faster opening target is unreachable; a slow closing one has a usable heading.
assert.equal(s.interceptCourse(0, 0, 6, 0, 100, Math.PI, 8), null, "a faster target opening away cannot be caught");
const meet = s.interceptCourse(0, 0, 6, 0, 100, 0, 2);
assert.ok(meet !== null, "a slow closing target can be caught");
let sx = 0;
let sz = 0;
let tx = 0;
let tz = 100;
const dt = 0.05;
const ticks = Math.ceil(meet.time / dt);
for (let i = 0; i < ticks; i += 1) {
  sx += Math.sin(meet.heading) * 6 * dt;
  sz += -Math.cos(meet.heading) * 6 * dt;
  tx += Math.sin(0) * 2 * dt;
  tz += -Math.cos(0) * 2 * dt;
}
assert.ok(Math.hypot(sx - tx, sz - tz) < 1, `stepping both reaches the same point, missed by ${Math.hypot(sx - tx, sz - tz)}`);

// Depth charges: sink to the preset, and damage is a full 3D falloff.
let charge = { x: 0, y: -1, z: 0, presetDepth: 20, sinkRate: 5, armed: false };
for (let i = 0; i < 100 && !charge.armed; i += 1) charge = s.stepCharge(charge, 0.5);
assert.equal(charge.armed, true, "the charge detonates at its preset depth");
assert.equal(charge.y, -20, "and stops at that depth");
const deepBoatY = s.subY(state({ depth: s.DEEP_DEPTH }));
assert.ok(s.subY(state({ depth: 0 })) === 0, "surface is y 0");
assert.ok(deepBoatY < 0, "a submerged boat is below the surface");
const overhead = { x: 0, y: 0, z: 0, presetDepth: 0, sinkRate: 1, armed: true };
assert.equal(s.chargeDamage(overhead, 0, deepBoatY, 0, 20), 0, "a shallow charge 60 m above a deep boat does nothing");
const alongside = { x: 0, y: -50, z: 0, presetDepth: 50, sinkRate: 1, armed: true };
const hit = s.chargeDamage(alongside, 0, deepBoatY, 0, 20);
assert.ok(hit > 0 && hit <= 1, `a 10 m separation damages, got ${hit}`);
assert.ok(Math.abs(hit - 0.5) < 1e-9, `falloff is linear in 3D distance, got ${hit}`);
const horizontalOnly = { x: 0, y: deepBoatY, z: 0, presetDepth: 60, sinkRate: 1, armed: true };
assert.equal(s.chargeDamage(horizontalOnly, 0, deepBoatY, 0, 20), 1, "co-located is full damage, proving the vertical axis is used");

// searchArea: grows with age and is centred on the dead-reckoned last fix, not the last fix itself.
const lastFix = Object.freeze({ x: 100, z: -200, heading: 0, speed: 2, time: 10 });
const atFix = s.searchArea(lastFix, 10, 5);
assert.equal(atFix.radius, 0, "no age, no circle");
assert.equal(atFix.x, 100);
assert.equal(atFix.z, -200);
const laterArea = s.searchArea(lastFix, 40, 5);
assert.ok(laterArea.radius > atFix.radius, "the circle grows with age");
assert.equal(laterArea.radius, 5 * 30, "radius grows at spreadRate");
assert.equal(laterArea.x, 100, "a boat on course 0 does not move in x");
assert.ok(Math.abs(laterArea.z - (-200 - 2 * 30)) < 1e-9, `centre dead-reckons along the last course, got z ${laterArea.z}`);

// transmitCost: surfaced is exposed, deep is not, and each says why.
const surfacedTx = s.transmitCost(state({ mode: "surfaced" }));
assert.equal(surfacedTx.detectable, true, "a surfaced boat transmitting is seen");
assert.ok(surfacedTx.reason.length > 0, "and gives a reason");
const deepTx = s.transmitCost(state({ mode: "deep", depth: s.DEEP_DEPTH }));
assert.equal(deepTx.detectable, false, "a deep boat transmitting is not");
assert.ok(deepTx.reason.length > 0, "and gives a reason");
assert.notEqual(deepTx.reason, surfacedTx.reason, "the reason differs by mode");
assert.equal(s.transmitCost(state({ mode: "periscope", depth: s.PERISCOPE_DEPTH })).detectable, true, "periscope is exposed too");

// enduranceLeft: cubic in speed, and zero on a flat battery.
const crawlEndurance = s.enduranceLeft(state({ mode: "deep" }), s.CRAWL_SPEED);
const sprintEndurance = s.enduranceLeft(state({ mode: "deep" }), s.SUBMERGED_MAX);
assert.ok(sprintEndurance > 0 && crawlEndurance > sprintEndurance, "a sprint is much shorter than a crawl");
const cubic = (s.SUBMERGED_MAX / s.CRAWL_SPEED) ** 3;
assert.ok(Math.abs(crawlEndurance / sprintEndurance - cubic) < 1e-9, `endurance ratio is cubic in speed, got ${crawlEndurance / sprintEndurance}`);
assert.equal(s.enduranceLeft(state({ mode: "deep", battery: 0 }), s.SUBMERGED_MAX), 0, "a flat battery has no endurance");

// strafeDamage: a shallow boat is reached through the blast path, a deep one is not.
assert.equal(s.strafeDamage(state({ depth: s.DEEP_DEPTH }), 0), 0, "ordinary strafing cannot touch a deep boat");
const shallowHit2 = s.strafeDamage(state({ depth: 2 }), 0);
assert.ok(shallowHit2 > 0, `just under the surface is nonzero, got ${shallowHit2}`);
const midHit = s.strafeDamage(state({ depth: s.PERISCOPE_DEPTH - 10 }), 0);
assert.ok(midHit > 0 && midHit < 1, `a shallow boat is damaged, got ${midHit}`);
assert.equal(s.strafeDamage(state({ depth: 2 }), s.SHALLOW_BLAST_DEPTH + 1), 0, "a blast below the shallow limit misses");

// Purity: every input frozen, and no function throws or mutates.
const frozenState = Object.freeze(state({ mode: "deep", depth: s.DEEP_DEPTH, battery: 0.5 }));
const frozenCharge = Object.freeze({ x: 0, y: -1, z: 0, presetDepth: 20, sinkRate: 5, armed: false });
assert.doesNotThrow(() => {
  s.stepDepth(frozenState, "periscope", 0.5, 2);
  s.maxSpeed(frozenState);
  s.batteryDrain(frozenState, 3, 1);
  s.canSee(frozenState, 100, 1000);
  s.hydrophoneBearing(0, 0, 100, 0, 8, 4, 0.5);
  s.canFire(frozenState, 0);
  s.applyFire(frozenState, 0, 40);
  s.interceptCourse(0, 0, 6, 0, 100, 0, 2);
  s.subY(frozenState);
  s.stepCharge(frozenCharge, 0.5);
  s.chargeDamage(frozenCharge, 0, 0, 0, 20);
  s.searchArea(lastFix, 30, 5);
  s.transmitCost(frozenState);
  s.enduranceLeft(frozenState, 3);
  s.strafeDamage(frozenState, 0);
}, "frozen inputs never throw");
assert.equal(frozenState.depth, s.DEEP_DEPTH, "the boat depth is untouched");
assert.equal(frozenState.battery, 0.5, "the battery is untouched");

// ---------------------------------------------------------------------------------------------
// Battle wiring — the pure rules above only matter if a real battle exercises them.
// ---------------------------------------------------------------------------------------------

// A boat with nothing to attack and nothing near runs on the surface to charge; a hostile aircraft
// overhead puts it under. This is the "submarines behave like submarines" reachability check.
{
  const b = play(19420604);
  const sub = b.ships.find((ship) => ship.name === "I-168");
  assert.ok(sub, "the Japanese boat exists");
  // Far from every hull, so no report can place a target and no warship can threaten it: calm water.
  sub.x = 0;
  sub.z = 60000;
  sub.sub.depth = s.DEEP_DEPTH;
  sub.sub.mode = "deep";
  sub.surfaced = false;
  sub.y = -s.DEEP_DEPTH;
  for (let i = 0; i < Math.round(40 / STEP); i += 1) b.step(STEP, {});
  assert.ok(sub.sub.depth < 10, `with nothing near, the boat should surface to charge; depth ${sub.sub.depth.toFixed(1)}`);
  // Now a hostile airframe overhead: the same boat must put itself under and stay there.
  sub.sub.depth = 0;
  sub.sub.mode = "surfaced";
  sub.surfaced = true;
  sub.y = 0;
  const plane = b.aircraft.find((a) => a.team === "us" && a.hp > 0);
  assert.ok(plane, "a US airframe exists");
  for (let i = 0; i < Math.round(40 / STEP); i += 1) {
    plane.x = sub.x + 200;
    plane.z = sub.z;
    plane.y = 400;
    plane.hp = 500;
    plane.mode = "flight";
    b.step(STEP, {});
  }
  assert.ok(sub.sub.depth > 30, `a hostile aircraft overhead should dive the boat; depth ${sub.sub.depth.toFixed(1)}`);
}

// A boat in range of an observed capital ship fires a torpedo at it through the ordinary path.
{
  const b = play(19420604);
  const sub = b.ships.find((ship) => ship.name === "I-168");
  const target = b.ships.find((ship) => ship.name === "USS Enterprise");
  sub.x = target.x + 3000;
  sub.z = target.z;
  sub.torpTimer = 1;
  // ASW is proven in its own check below; here it would sink the boat before the scout's report is
  // even delivered, so the hunt is stood down and this measures the boat's attack wiring alone.
  for (const e of b.ships) if (e.hunt) e.hunt = null;
  const scout = b.aircraft.find((a) => a.team === "jp" && a.hp > 0);
  assert.ok(scout, "the Japanese scout exists");
  let launched = 0;
  const real = b.spawnTorpedo.bind(b);
  b.spawnTorpedo = (a, heading, options) => {
    const t = real(a, heading, options);
    if (a === sub) launched += 1;
    return t;
  };
  for (let i = 0; i < Math.round(150 / STEP) && launched === 0; i += 1) {
    scout.x = target.x + 200;
    scout.z = target.z;
    scout.y = 900;
    scout.hp = 500;
    scout.mode = "flight";
    b.step(STEP, {});
  }
  assert.ok(launched > 0, "the boat never fired a torpedo at the observed carrier");
}

// A bomb dropped over a boat 60 m down does nothing; the same bomb on a surfaced boat does. This is
// the point of submerging, and the reason `strafeDamage` is called rather than left on the shelf.
{
  const b = play(19420604);
  const sub = b.ships.find((ship) => ship.name === "I-168");
  const drop = () =>
    b.bombs.push({ x: sub.x, y: 2, z: sub.z, vx: 0, vy: -60, vz: 0, age: 0, damage: 155, team: "us", owner: "player", dead: false });
  sub.sub.depth = s.DEEP_DEPTH;
  sub.sub.mode = "deep";
  sub.surfaced = false;
  sub.y = -s.DEEP_DEPTH;
  const hp = sub.hp;
  drop();
  b.step(STEP);
  assert.equal(sub.hp, hp, "a bomb reached a boat 60 m down");
  sub.sub.depth = 0;
  sub.sub.mode = "surfaced";
  sub.surfaced = true;
  sub.y = 0;
  drop();
  b.step(STEP);
  assert.ok(sub.hp < hp, "a bomb did not touch a boat on the surface");
}

// A destroyer's own sonar holds a shallow boat, opens the attack track and drops a salvo that lands.
{
  const b = play(19420604);
  const sub = b.ships.find((ship) => ship.name === "I-168");
  const escort = b.ships.find((ship) => ship.name === "USS Hammann");
  assert.ok(escort && escort.hunt, "a US escort carries a depth-charge hunt");
  const charges = () => b.ships.reduce((n, e) => n + (e.hunt?.charges ?? 0), 0);
  const start = charges();
  let dropped = false;
  for (let i = 0; i < Math.round(120 / STEP); i += 1) {
    // Hold the boat shallow alongside the escort: this measures the hunt wiring, not evasion.
    sub.x = escort.x + 600;
    sub.z = escort.z;
    sub.sub.depth = 0;
    sub.sub.mode = "surfaced";
    sub.surfaced = true;
    sub.y = 0;
    b.step(STEP, {});
    if (charges() < start) dropped = true;
    if (dropped && sub.hp <= 0) break;
  }
  assert.ok(dropped, "the screen never dropped a depth charge on a boat 600 m away");
  assert.ok(sub.hp <= 0 || sub.hp < 90, `the salvo never hurt the boat; hp ${sub.hp.toFixed(0)}`);
}

console.log(JSON.stringify({
  pass: true,
  periscopeSteps: steps,
  intercept: meet,
  contact,
  hit,
  searchRadius: laterArea.radius,
  enduranceRatio: crawlEndurance / sprintEndurance,
  strafe: shallowHit2,
}));
