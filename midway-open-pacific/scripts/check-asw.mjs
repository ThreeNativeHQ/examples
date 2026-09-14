/**
 * Escort ASW check. Bundles the pure modules with esbuild and exercises them with node:assert, no
 * test framework. Every assertion here is a property `Battle` must be able to lean on when it gives
 * an escort a hunt instead of an instant kill. Run: node scripts/check-asw.mjs
 */
import assert from "node:assert/strict";
import { build } from "esbuild";

async function bundle(entry) {
  const { outputFiles } = await build({
    entryPoints: [entry],
    bundle: true,
    platform: "node",
    format: "esm",
    write: false,
  });
  return import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString("base64")}`);
}
const sub = await bundle("src/sim/submarine.ts");
const asw = await bundle("src/sim/asw.ts");

const limits = Object.freeze({
  investigateSeconds: 4,
  attackSeconds: 2,
  holdSeconds: 20,
  searchSeconds: 30,
  spreadRate: 5,
  assumedSpeed: 2,
});
const ship = Object.freeze({ x: 0, z: 0, heading: 0, speed: 6 });
const contact = (over = {}) => ({
  bearing: 0,
  bearingUncertainty: 0.1,
  range: 1500,
  depth: 40,
  held: true,
  lastHeld: 0,
  ...over,
});
const state = (over = {}) => ({
  phase: "searching",
  charges: 12,
  phaseTime: 0,
  salvoes: 0,
  solution: null,
  search: null,
  lastContact: null,
  ...over,
});
const fresh = contact();

// A contact estimate never jumps straight to attacking: searching always passes through investigating.
let s = asw.stepHunt(state(), fresh, ship, 0.1, limits);
assert.equal(s.phase, "investigating", "first contact goes to investigating, never straight to attacking");
const jump = asw.stepHunt(state(), fresh, ship, 999, limits);
assert.equal(jump.phase, "investigating", "no dwell time, however long, skips the investigation phase");

// Investigating, once it has studied the contact and has a solution, opens the attack track.
s = asw.stepHunt(s, fresh, ship, limits.investigateSeconds, limits);
assert.equal(s.phase, "attacking", "a studied contact with a range opens an attack");
const ran = asw.stepHunt(s, fresh, ship, limits.attackSeconds - 0.1, limits);
assert.equal(ran.phase, "attacking", "the attack run is flown before the charges go");
s = asw.stepHunt(ran, fresh, ship, 0.2, limits);
assert.equal(s.phase, "reattack", "after the attack run the escort reassesses");
assert.ok(s.solution !== null, "the attack kept its solution for the record");
assert.equal(s.charges, 12 - asw.ASW_SALVO, "the salvo spent its finite charges");
assert.equal(s.solution.dropPoints.length, asw.ASW_SALVO, "the salvo drops the whole ladder");

// Bearing-only is not a target: no range, no solution. A range, or a narrower wedge, makes one.
assert.equal(asw.attackSolution(ship, contact({ range: null }), 0.5), null, "a hydrophone bearing cannot aim a salvo");
assert.ok(asw.attackSolution(ship, contact({ range: 1500 }), 0.5) !== null, "adding a range produces a solution");
assert.equal(
  asw.attackSolution(ship, contact({ bearingUncertainty: 1.0 }), 0.5),
  null,
  "a wedge too wide to be a target is refused",
);
const points = asw.attackSolution(ship, contact({ range: 1500 }), 0.5).dropPoints;
assert.ok(points.every((p) => Number.isFinite(p.x) && Number.isFinite(p.z)), "every drop point is finite");

// The preset depth follows the escort's belief, never the boat's true depth.
const trueSubDepth = 14;
const belief = contact({ depth: 40 });
const beliefSolution = asw.attackSolution(ship, belief, 0.5);
const truthSolution = asw.attackSolution(ship, contact({ depth: trueSubDepth }), 0.5);
assert.equal(truthSolution.presetDepth, 20, "a 14 m belief rounds to the 20 m fuse");
assert.equal(beliefSolution.presetDepth, 40, "the preset follows the 40 m belief");
assert.notEqual(beliefSolution.presetDepth, truthSolution.presetDepth, "it is not the true 14 m depth");

// Charges are finite: a spent escort refuses to attack and rejoins rather than hunting forever.
assert.equal(asw.canAttack(state()), true, "charges in hand can attack");
let spent = state({ phase: "reattack", charges: 0 });
assert.equal(asw.canAttack(spent), false, "a spent salvo refuses");
spent = asw.stepHunt(spent, fresh, ship, 0.1, limits);
assert.equal(spent.phase, "rejoin", "the escort rejoins once the salvo is gone");
const rearmed = asw.stepHunt(state({ phase: "reattack", charges: asw.ASW_SALVO }), fresh, ship, limits.attackSeconds, limits);
assert.equal(rearmed.phase, "attacking", "charges in hand and a held contact justify another pass");

// A fast escort hears less: its own noise raises the hydrophone floor above the same boat.
const slowFloor = asw.fastEscortNoise(3);
const fastFloor = asw.fastEscortNoise(10);
assert.ok(fastFloor > slowFloor, "a sprint is noisier than a crawl");
assert.ok(
  sub.hydrophoneBearing(0, 0, 1000, 0, 6, slowFloor, 0.5) !== null,
  "the slow escort hears a 6 m/s boat at 1000 m",
);
assert.equal(
  sub.hydrophoneBearing(0, 0, 1000, 0, 6, fastFloor, 0.5),
  null,
  "the fast escort misses the same boat at the same range",
);

// Losing contact moves to lost and searches the estimated area, not the last point.
let hunt = asw.stepHunt(state(), fresh, ship, 0.1, limits);
assert.ok(hunt.lastContact !== null, "a contact with a range leaves a firm fix");
const fixX = hunt.lastContact.x;
const fixZ = hunt.lastContact.z;
hunt = asw.stepHunt(hunt, contact({ held: false, lastHeld: 5 }), ship, 0.1, limits);
assert.equal(hunt.phase, "lost", "losing contact moves to lost");
assert.ok(hunt.search.radius > 0, "the escort searches an area, not a point");
hunt = asw.stepHunt(hunt, contact({ held: false, lastHeld: 5 }), ship, 5, limits);
assert.ok(hunt.search.radius > 0.5, "the area grows with every unobserved second");
assert.ok(
  Math.abs(hunt.search.z - fixZ) > 0.5 || Math.abs(hunt.search.x - fixX) > 0.5,
  "the centre dead-reckons away from the last point",
);
let searched = hunt;
for (let i = 0; i < 20 && searched.phase === "lost"; i += 1) {
  searched = asw.stepHunt(searched, contact({ held: false, lastHeld: 5 }), ship, 5, limits);
}
assert.equal(searched.phase, "rejoin", "the search is finite and ends in a rejoin");

// Purity: every input frozen, and no function throws or mutates.
const frozenState = Object.freeze(state({ phase: "investigating", phaseTime: 3 }));
const frozenContact = Object.freeze(contact({ range: 1500, depth: 40 }));
const frozenShip = Object.freeze({ x: 0, z: 0, heading: 0, speed: 6 });
const frozenLimits = Object.freeze({ ...limits });
assert.doesNotThrow(() => {
  asw.stepHunt(frozenState, frozenContact, frozenShip, 1, frozenLimits);
  asw.attackSolution(frozenShip, frozenContact, 0.5);
  asw.canAttack(frozenState);
  asw.fastEscortNoise(6);
}, "frozen inputs never throw");
assert.equal(frozenState.phase, "investigating", "the state is untouched");
assert.equal(frozenState.charges, 12, "the charge count is untouched");
assert.equal(frozenContact.range, 1500, "the contact is untouched");

console.log(
  JSON.stringify({
    pass: true,
    salvo: asw.ASW_SALVO,
    presetFromBelief: beliefSolution.presetDepth,
    presetFromTruth: truthSolution.presetDepth,
    slowFloor,
    fastFloor,
    searchRadius: hunt.search.radius,
  }),
);
