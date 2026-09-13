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
assert.equal(steps, 14, `reaches 14 m in 14 half-second steps, got ${steps}`);
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

console.log(JSON.stringify({ pass: true, periscopeSteps: steps, intercept: meet, contact, hit }));
