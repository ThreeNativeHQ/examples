/**
 * Carrier-ops check: conserved launch/recovery inventory and the straight-deck gates.
 *
 * A carrier that loses or invents an airframe looks fine in a screenshot and only shows up as a
 * fleet that quietly grows or empties over a long sortie, so this exercises the pure module
 * directly. Run: node scripts/check-carrier-ops.mjs
 */
import assert from "node:assert/strict";
import { build } from "esbuild";

const { outputFiles } = await build({
  stdin: { contents: 'export * from "./src/sim/carrier-ops.ts"; export { Battle } from "./src/sim/battle.ts"; export { rearRoundsFor } from "./src/sim/armament.ts";',
    loader: "ts", resolveDir: process.cwd() },
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
});
const ops = await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString("base64")}`);

const TIMES = { launchInterval: 1, recoveryInterval: 1, serviceSeconds: 2, repairSeconds: 5 };
const air = (over = {}) => ({
  airframes: { sbd: 1 },
  ready: { sbd: 1 },
  damaged: {},
  servicing: {},
  stores: { bomb: 1000, torpedo: 20, ammo: 400 },
  fuel: 1000,
  ...over,
});
const deck = (over = {}) => ({ mode: "deck-ready", since: 0, occupiedUntil: 0, suspended: null, ...over });
const snapshot = (value) => JSON.parse(JSON.stringify(value));
const freeze = (o) => {
  for (const v of Object.values(o)) if (v && typeof v === "object") Object.freeze(v);
  return Object.freeze(o);
};

// Launch then recovery conserves the aircraft count exactly over 50 cycles, and a launch spends
// exactly one store while a recovery restores none.
let a = air();
let d = deck();
let airborne = 0;
const conserved = ops.totalAircraft(a) + airborne;
for (let i = 0; i < 50; i += 1) {
  let now = i * 10;
  const bombs = a.stores.bomb;
  const launched = ops.applyLaunch(a, d, "sbd", "bomb", now, TIMES);
  a = launched.air;
  d = launched.deck;
  airborne += 1;
  assert.equal(a.stores.bomb, bombs - 1, `cycle ${i}: launch must spend exactly one bomb`);
  assert.equal(ops.totalAircraft(a) + airborne, conserved, `cycle ${i}: count changed on launch`);

  now += 3;
  const recovered = ops.applyRecovery(a, d, "sbd", now, TIMES, false);
  a = recovered.air;
  d = recovered.deck;
  airborne -= 1;
  assert.equal(a.stores.bomb, launched.air.stores.bomb, `cycle ${i}: recovery must not restore a bomb`);
  assert.equal(ops.totalAircraft(a) + airborne, conserved, `cycle ${i}: count changed on recovery`);

  now += 3;
  const serviced = ops.stepService(a, d, now, TIMES, 0.99);
  a = serviced.air;
  d = serviced.deck;
}
assert.equal(ops.totalAircraft(a) + airborne, conserved, "conservation broke over the run");
assert.equal(a.ready.sbd, 1, "the fifty-first launch should find a ready aircraft");
assert.equal(a.stores.bomb, 950, "fifty sorties must spend fifty stores, including all service cycles");

// At the active cap the launch is refused and nothing is consumed.
const capAir = air();
const capDeck = deck();
const capBefore = snapshot({ air: capAir, deck: capDeck });
assert.deepEqual(ops.canLaunch(capAir, capDeck, "sbd", "bomb", 0, 68, 68), { ok: false, reason: "active cap" });
assert.deepEqual({ air: capAir, deck: capDeck }, capBefore, "a queued launch must not consume anything");

// applyLaunch throws whenever the same gate is false.
assert.throws(() => ops.applyLaunch(air({ ready: { sbd: 0 } }), deck(), "sbd", "bomb", 0, TIMES));
assert.throws(() => ops.applyLaunch(air(), deck({ suspended: "evading" }), "sbd", "bomb", 0, TIMES));

// An occupied deck refuses a launch before its occupiedUntil and allows it at exactly that time.
const occAir = air({ ready: { sbd: 2 }, airframes: { sbd: 2 } });
const occDeck = deck({ occupiedUntil: 10 });
assert.equal(ops.canLaunch(occAir, occDeck, "sbd", "bomb", 9.999, 0, 68).reason, "deck occupied");
assert.equal(ops.canLaunch(occAir, occDeck, "sbd", "bomb", 10, 0, 68).ok, true);

// canRecover mirrors canLaunch: the suspension's own reason, then occupancy, and no mutation.
assert.deepEqual(ops.canRecover(air(), deck({ suspended: "evading" }), "sbd", 0),
  { ok: false, reason: "evading" }, "a suspended deck must refuse a recovery with its own reason");
assert.equal(ops.canRecover(air(), deck({ occupiedUntil: 10 }), "sbd", 9.999).reason, "deck occupied");
assert.equal(ops.canRecover(air(), deck({ occupiedUntil: 10 }), "sbd", 10).ok, true);
const recAir = air();
const recDeck = deck({ suspended: "evading" });
const recBefore = snapshot({ air: recAir, deck: recDeck });
ops.canRecover(recAir, recDeck, "sbd", 0);
assert.deepEqual({ air: recAir, deck: recDeck }, recBefore, "a refused recovery must consume nothing");

// applyRecovery throws on the same gate that refuses the call.
assert.throws(() => ops.applyRecovery(air(), deck({ suspended: "evading" }), "sbd", 0, TIMES, false));

// Launch and recovery agree on occupancy: the same deck and now refuse both.
assert.equal(ops.canLaunch(occAir, occDeck, "sbd", "bomb", 5, 0, 68).reason, "deck occupied");
assert.equal(ops.canRecover(occAir, occDeck, "sbd", 5).reason, "deck occupied");

// suspendReason is the single readable gate for every suspending condition.
assert.equal(ops.suspendReason({ evading: true }), "evading");
assert.equal(ops.suspendReason({ list: 0.5 }), "heavy list");
assert.equal(ops.suspendReason({ corridorFire: true }), "fire in the landing corridor");
assert.equal(ops.suspendReason({ deck: 0.1 }), "deck damage");
assert.equal(ops.suspendReason({ deck: 1, list: 0 }), null);
assert.equal(ops.suspendReason(null), null);

// The last store must fly one sortie, even after recovery/service. Charge only at dispatch.
let ra = air({ ready: {}, stores: { bomb: 1 } });
let rd = deck();
const returned = ops.applyRecovery(ra, rd, "sbd", 0, TIMES, false);
ra = returned.air;
rd = returned.deck;
assert.equal(ops.canLaunch(ra, rd, "sbd", "bomb", 100, 0, 68).ok, false, "a recovered aircraft is not ready");
const readyAgain = ops.stepService(ra, rd, 2, TIMES, 0.99);
ra = readyAgain.air;
rd = readyAgain.deck;
assert.equal(ra.stores.bomb, 1, "service must leave the store for dispatch, not charge it twice");
assert.equal(ops.canLaunch(ra, rd, "sbd", "bomb", 100, 0, 68).ok, true, "service must make it ready");
assert.equal(ops.applyLaunch(ra, rd, "sbd", "bomb", 100, TIMES).air.stores.bomb, 0,
  "the last store must allow exactly one launch after service");

// A second recovery cannot restart work on the first aircraft, or it never finishes on a busy deck.
const firstReturn = ops.applyRecovery(air({ ready: {} }), deck(), "sbd", 0, TIMES, false);
const secondReturn = ops.applyRecovery(firstReturn.air, firstReturn.deck, "sbd", 1, TIMES, false);
const underway = ops.stepService(secondReturn.air, secondReturn.deck, 2, TIMES, 0.99);
assert.equal(underway.air.ready.sbd, 1, "another recovery must not delay existing hangar work");
assert.equal(underway.air.servicing.sbd, 1, "the second aircraft still needs its own service interval");

// Launch traffic also leaves the hangar's clock alone.
const withFighter = ops.applyRecovery(air({ ready: { wildcat: 1 }, airframes: { wildcat: 1 } }), deck(), "sbd", 0, TIMES, false);
const traffic = ops.applyLaunch(withFighter.air, { ...withFighter.deck, mode: "available" }, "wildcat", "ammo", 1, TIMES);
assert.equal(ops.stepService(traffic.air, traffic.deck, 2, TIMES, 0.99).air.ready.sbd, 1,
  "a launch must not delay existing hangar work");

// Missing torpedoes must not strand a supplied bomber or stop an independent repair.
const mixed = air({ ready: {}, airframes: { tbd: 1, sbd: 1, wildcat: 1 },
  servicing: { tbd: 1, sbd: 1 }, damaged: { wildcat: 1 }, stores: { bomb: 1 } });
const supplied = ops.stepService(mixed, deck(), 2, TIMES, 0.99);
assert.equal(supplied.air.ready.sbd, 1, "a torpedo shortage must not block bomber service");
const repaired = ops.stepService(supplied.air, supplied.deck, 7, TIMES, 0.99);
assert.equal(repaired.air.damaged.wildcat, 0, "a torpedo shortage must not block repairs");
assert.equal(repaired.air.servicing.wildcat, 1);

// With no store the aircraft stays unready, and then finishes the moment one arrives.
const empty = ops.stepService(
  air({ ready: {}, servicing: { sbd: 1 }, stores: {} }),
  deck({ mode: "servicing", since: 0 }),
  2,
  TIMES,
  0.99,
);
assert.equal(empty.air.ready.sbd ?? 0, 0, "no store means no ready aircraft");
assert.equal(empty.air.servicing.sbd, 1, "and it stays in servicing");
const stocked = ops.stepService({ ...empty.air, stores: { bomb: 1 } }, empty.deck, 3, TIMES, 0.99);
assert.equal(stocked.air.ready.sbd, 1, "a store arriving later completes the same service");

// A failed repair is a permanent write-off; a successful one enters service.
const broken = air({ ready: {}, airframes: { sbd: 1 }, damaged: { sbd: 1 } });
assert.equal(ops.stepService(broken, deck({ mode: "servicing", since: 0 }), 5, TIMES, 0).air.airframes.sbd, 0);
const fixed = ops.stepService(broken, deck({ mode: "servicing", since: 0 }), 5, TIMES, 0.99).air;
assert.equal(fixed.airframes.sbd, 1);
assert.equal(fixed.servicing.sbd, 1);

// Neither apply function mutates its inputs.
assert.doesNotThrow(() => ops.applyLaunch(freeze(air()), freeze(deck()), "sbd", "bomb", 0, TIMES));
assert.doesNotThrow(() => ops.applyRecovery(freeze(air()), freeze(deck()), "sbd", 0, TIMES, false));

// Battle owns the same clock: a second real recovery must not postpone the first aircraft's
// service. This isolates the maintenance boundary, not the feasibility of an AI landing approach.
const battle = new ops.Battle(7);
const carrier = battle.home;
carrier.air.ready = { wildcat: 1, tbd: 1 };
carrier.air.airframes = { ...carrier.air.ready };
carrier.air.stores.torpedo = 2;
battle.start();
battle.player.mode = "spectator";
// The home deck no longer launches on `start()`: its aircraft wait on deck while the player is
// chocked there, so this test requests the second aircraft through the same `launch` the cycle
// uses rather than assuming the automatic launch still happened.
const fighter = battle.launch(carrier, "fighter");
assert.ok(fighter, "the home deck puts up a fighter to recover as the second aircraft");
const advanceTo = (time) => { while (battle.time < time) battle.step(1 / 30, {}); };
advanceTo(7);
const torpedoPlane = battle.launch(carrier, "torpedo");
assert.ok(torpedoPlane);
advanceTo(35);
assert.equal(battle.recoverAircraft(carrier, torpedoPlane), true);
torpedoPlane.recovered = true; // navigateHome normally clears the caller's airborne record.
advanceTo(100);
assert.equal(battle.recoverAircraft(carrier, fighter), true);
fighter.recovered = true;
advanceTo(338); // 300 seconds of service plus the one-second operational cadence.
assert.equal(carrier.air.ready.tbd, 1, "Battle.step must finish the first service despite a later recovery");
assert.equal(carrier.air.stores.torpedo, 1, "Battle service must retain the last torpedo for dispatch");
assert.ok(battle.launch(carrier, "torpedo"), "the serviced aircraft must fly with that last torpedo");
assert.equal(carrier.air.stores.torpedo, 0);

// Player service must obey the same finite carrier fuel, independently of its bomb rack.
for (const [carrierFuel, bombs, expectedFuel, ammo, fullGuns] of [[0, 2, 10, 0, false], [0.25, 0, 35, 0, false], [2, 1, 100, 1, false], [2, 1, 100, 2, true]]) {
  const b = new ops.Battle(11);
  b.selectAssignment("operation");
  b.start();
  const h = b.home;
  b.player.fuel = 10;
  b.player.bombs = 0;
  b.player.ammo = fullGuns ? 1400 : 12;
  b.player.rearAmmo = fullGuns ? ops.rearRoundsFor("sbd") : 7;
  h.air.fuel = carrierFuel;
  h.air.stores.bomb = bombs;
  h.air.stores.ammo = ammo;
  b.recover(h);
  for (let i = 0; i < 800 && b.player.mode === "service"; i++) b.step(1 / 60, {});
  assert.equal(b.player.mode, "deck", "finite supplies must still finish deck service");
  assert.ok(Math.abs(b.player.fuel - expectedFuel) < 1e-6,
    `player fuel must come from the carrier: expected ${expectedFuel}, got ${b.player.fuel}`);
  assert.ok(Math.abs(h.air.fuel - (carrierFuel - (expectedFuel - 10) / 100)) < 1e-6,
    "carrier must spend only the fuel actually transferred");
  assert.equal(b.player.bombs, bombs > 0 ? 3 : 0);
  assert.deepEqual([b.player.ammo, b.player.rearAmmo], ammo ? [1400, ops.rearRoundsFor("sbd")] : [12, 7], "gun refill requires ammunition stores");
  assert.equal(h.air.stores.ammo, ammo && !fullGuns ? ammo - 1 : ammo, "one gun refill costs one store; full guns cost nothing");
  const stock = JSON.stringify(h.air.stores);
  const payload = b.player.bombs;
  assert.equal(b.selectLoadout("bomb"), true);
  assert.equal(b.player.bombs, payload, "selecting the current loadout must never replenish it");
  assert.equal(JSON.stringify(h.air.stores), stock, "selecting the current loadout consumes nothing");
  h.air.stores.torpedo = 0;
  assert.equal(b.selectLoadout("torpedo"), false, "an empty torpedo rack must refuse a deck swap");
  assert.equal(b.player.loadout, "bomb", "a refused swap must retain the actual airframe and stores");
  h.air.stores.torpedo = 1;
  assert.equal(b.selectLoadout("torpedo"), true);
  assert.equal(h.air.stores.torpedo, 0, "the deck swap must spend the loaded torpedo");
  assert.equal(h.air.stores.bomb, bombs, "a complete unused bomb load is returned on a deck swap");
}

console.log("check-carrier-ops: carrier and player stores, fuel, service clocks and Battle recovery/relaunch hold");
