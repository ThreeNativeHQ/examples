/**
 * Rescue and alongside damage-control check. Bundles the pure module with esbuild and exercises it
 * with node:assert, no test framework. Every assertion is a property the game may lean on when
 * `Battle` wires survivors, rescue and Hammann's alongside work in. Run: node scripts/check-rescue.mjs
 */
import assert from "node:assert/strict";
import { build } from "esbuild";

const { outputFiles } = await build({
  entryPoints: ["src/sim/rescue.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
});
const r = await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString("base64")}`);

const LIMITS = r.DEFAULT_RESCUE_LIMITS;
const ship = (over = {}) => ({ x: 0, z: 0, speed: 0, ...over });
const survivor = (over = {}) => ({
  id: "s1",
  x: 0,
  z: 0,
  since: 0,
  count: 10,
  fromShipId: "ship-1",
  ...over,
});
const rescue = (over = {}) => ({ targetId: "s1", phase: "approaching", startedAt: 0, recovered: 0, ...over });
const escort = (over = {}) => ({ id: "hammann", ...over });
const damage = (over = {}) => ({ hull: 0.3, flooding: 0.05, fire: 0.2, fireRate: 0.1, ...over });
const carrier = (over = {}) => ({ id: "yorktown", damage: damage(), ...over });

// A fast or a distant ship recovers nobody; neither may claim a single survivor.
const fast = r.stepRescue(rescue(), ship({ speed: 10 }), [survivor()], 1, LIMITS);
assert.equal(fast.state.recovered, 0, "a ship under way recovers nobody");
assert.equal(fast.state.phase, "approaching");
const distant = r.stepRescue(rescue(), ship({ x: 1000 }), [survivor()], 1, LIMITS);
assert.equal(distant.state.recovered, 0, "a ship outside pickup range recovers nobody");
assert.equal(distant.state.phase, "approaching");

// A slow, close ship recovers at the stated rate, and the group's count falls by that much.
const close = r.stepRescue(rescue(), ship({ speed: 0.5 }), [survivor({ count: 10 })], 1, LIMITS);
assert.equal(close.state.phase, "recovering");
assert.equal(close.state.recovered, LIMITS.rate * 1, `recovers at the stated rate, got ${close.state.recovered}`);
assert.ok(close.survivors[0].count < 10 - LIMITS.rate + 1e-9, "and the water holds correspondingly fewer");
assert.equal(close.survivors[0].fromShipId, "ship-1", "the group still cites the hull it abandoned");

// Exposure is real: the same group reached later yields fewer aboard than an immediate rescue.
const early = r.stepRescue(rescue(), ship({ speed: 0 }), [survivor({ count: 10 })], 5, LIMITS);
let late = rescue();
let lateGroup = [survivor({ count: 10 })];
for (let i = 0; i < 120; i += 1) {
  const step = r.stepRescue(late, ship({ x: 100000 }), lateGroup, 1, LIMITS);
  late = step.state;
  lateGroup = step.survivors;
}
const lateRescue = r.stepRescue(late, ship({ speed: 0 }), lateGroup, 5, LIMITS);
assert.ok(
  lateRescue.state.recovered < early.state.recovered,
  `a later rescue saves fewer: early ${early.state.recovered}, late ${lateRescue.state.recovered}`,
);
assert.ok(lateRescue.survivors[0].count >= 0, "exposure never drives the count negative");

// canAssist: a detected torpedo threat is the refusal, with that exact reason.
const healthy = r.canAssist(escort(), carrier(), []);
assert.equal(healthy.ok, true, "a damaged carrier with no threat admits an alongside");
const torpedo = r.canAssist(escort(), carrier(), [{ kind: "torpedo", team: "jp", x: 100, z: 100 }]);
assert.equal(torpedo.ok, false, "a detected torpedo threat refuses the alongside");
assert.equal(torpedo.reason, "torpedo threat detected");
const busy = r.canAssist(escort({ neededElsewhere: true }), carrier(), []);
assert.equal(busy.ok, false, "an escort the screen still needs is refused");
assert.equal(busy.reason, "escort needed elsewhere");
const intact = r.canAssist(escort(), carrier({ damage: damage({ flooding: 0, fire: 0, fireRate: 0 }) }), []);
assert.equal(intact.ok, false, "a carrier with nothing to fight is not a job for the alongside");
assert.equal(intact.reason, "no damage to fight");
const lost = r.canAssist(escort(), carrier({ sunk: true }), []);
assert.equal(lost.ok, false, "a sunk carrier cannot be helped");
assert.equal(lost.reason, "carrier beyond assistance");

// assistBenefit is a quantity. Compare the carrier's flooding and fire over the same dt with and
// without the alongside, and assert assistance removes a measurable amount.
const dt = 10;
const c = carrier();
const benefit = r.assistBenefit(c, escort(), dt);
assert.ok(benefit.floodingDelta > 0, "assistance measurably reduces flooding");
assert.ok(benefit.fireDelta > 0, "assistance measurably reduces fire spread");
assert.equal(benefit.floodingDelta, c.damage.flooding * r.ASSIST_FACTOR * dt);
assert.equal(benefit.fireDelta, c.damage.fireRate * r.ASSIST_FACTOR * dt);
const floodingWithout = c.damage.flooding * dt;
const floodingWith = floodingWithout - benefit.floodingDelta;
const fireWithout = c.damage.fireRate * dt;
const fireWith = fireWithout - benefit.fireDelta;
assert.ok(floodingWith < floodingWithout, `flooding with assistance ${floodingWith} beats ${floodingWithout}`);
assert.ok(fireWith < fireWithout, `fire with assistance ${fireWith} beats ${fireWithout}`);
assert.ok(Math.abs(floodingWithout - floodingWith) > 0.1, "the flooding difference is not a rounding error");
const noFire = r.assistBenefit(carrier({ damage: damage({ flooding: 0, fire: 0, fireRate: 0 }) }), escort(), dt);
assert.deepEqual(noFire, { floodingDelta: 0, fireDelta: 0 }, "nothing flooding or burning yields nothing");

// assistCost: alongside means the screen station is gone and the ship cannot manoeuvre.
const cost = r.assistCost(escort());
assert.equal(cost.manoeuvrable, false, "a ship tied alongside cannot manoeuvre");
assert.equal(cost.screenCoverageLost, 1, "and it gives up its whole screen contribution");
const half = r.assistCost(escort({ screenCoverage: 0.5 }));
assert.equal(half.screenCoverageLost, 0.5, "an already-partial contribution loses only what it had");

// detach records the reason and the time, for either activity, without touching the carrier.
const rescueState = Object.freeze(rescue({ phase: "recovering", recovered: 4 }));
const leftRescue = r.detach(rescueState, "torpedo threat", 12);
assert.equal(leftRescue.phase, "aborted");
assert.equal(leftRescue.reason, "torpedo threat");
assert.equal(leftRescue.detachedAt, 12);
assert.equal(leftRescue.recovered, 4, "people already aboard are not thrown back");
assert.equal(rescueState.phase, "recovering", "the input record is untouched");
const frozenDamage = Object.freeze(damage());
const frozenCarrier = Object.freeze({ id: "yorktown", damage: frozenDamage });
const carrierBefore = JSON.stringify(frozenCarrier);
const assistState = Object.freeze({ carrierId: "yorktown", phase: "alongside", startedAt: 0 });
const leftAssist = r.detach(assistState, "screen recall", 20);
assert.equal(leftAssist.phase, "aborted");
assert.equal(leftAssist.reason, "screen recall");
assert.equal(leftAssist.carrierId, "yorktown");
assert.equal(JSON.stringify(frozenCarrier), carrierBefore, "detach leaves the carrier's damage state untouched");
const finished = r.detach(Object.freeze(rescue({ phase: "done", recovered: 10 })), "recalled", 30);
assert.equal(finished.phase, "done", "detaching from a completed rescue does not un-complete it");

// Purity: every input frozen, and no function throws or mutates.
const frozenState = Object.freeze(rescue());
const frozenShip = Object.freeze(ship());
const frozenGroup = Object.freeze(survivor());
const frozenLimits = Object.freeze({ ...LIMITS });
const frozenEscort = Object.freeze(escort());
const frozenThreat = Object.freeze([{ kind: "torpedo", team: "jp", x: 0, z: 0 }]);
const before = JSON.stringify({ frozenState, frozenShip, frozenGroup, frozenEscort, frozenCarrier });
assert.doesNotThrow(() => {
  r.stepRescue(frozenState, frozenShip, [frozenGroup], 1, frozenLimits);
  r.canAssist(frozenEscort, frozenCarrier, frozenThreat);
  r.assistBenefit(frozenCarrier, frozenEscort, 10);
  r.assistCost(frozenEscort);
  r.detach(frozenState, "check", 1);
}, "frozen inputs never throw");
assert.equal(JSON.stringify({ frozenState, frozenShip, frozenGroup, frozenEscort, frozenCarrier }), before, "no input was mutated");

console.log(
  JSON.stringify({
    pass: true,
    earlyRecovered: early.state.recovered,
    lateRecovered: lateRescue.state.recovered,
    floodingDelta: benefit.floodingDelta,
    fireDelta: benefit.fireDelta,
    refusal: torpedo.reason,
  }),
);
