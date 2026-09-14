/**
 * Functional ship-damage check. A hull takes a handful of named outcomes (hull, propulsion, fire,
 * aviation, weapons) instead of one hit-point pool, and the same absolute hit lands differently on
 * a destroyer and a carrier because each carries its own capacity. Pure records: every call returns
 * a new frozen object and the inputs are never mutated. Run: node scripts/check-damage.mjs
 */
import assert from "node:assert/strict";
import { build } from "esbuild";

const { outputFiles } = await build({
  entryPoints: ["src/sim/damage.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
});
const {
  SHIP_DAMAGE_ZONES,
  classCapacity,
  initShipDamage,
  applyHit,
  applyRepair,
  stepDamage,
  speedFactor,
  turnFactor,
  canOperateAircraft,
  weaponsAvailable,
} = await import(
  `data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString("base64")}`
);

const destroyer = () => initShipDamage(classCapacity("destroyer"));
const carrier = () => initShipDamage(classCapacity("carrier"));

assert.deepEqual([...SHIP_DAMAGE_ZONES], ["hull", "propulsion", "fire", "aviation", "weapons"]);
assert.equal(SHIP_DAMAGE_ZONES.length, 5, "exactly five functional zones");

// A propulsion hit slows the ship. Speed and turn both fall; the hull is untouched.
const fresh = destroyer();
const damagedProp = applyHit(fresh, "propulsion", 40, 1);
assert.notEqual(damagedProp, fresh, "applyHit returns a new record");
assert.ok(speedFactor(damagedProp) < speedFactor(fresh), "a propulsion hit slows the ship");
assert.ok(turnFactor(damagedProp) < turnFactor(fresh), "a propulsion hit reduces steering");
assert.equal(damagedProp.hull, fresh.hull, "a propulsion hit does not flood the hull");

// A hull hit floods, and the water keeps coming in over time.
const holed = applyHit(fresh, "hull", 40, 1);
assert.ok(holed.flooding > 0, "a hull hit opens a flooding rate");
assert.ok(speedFactor(holed) < speedFactor(fresh), "flooding also costs speed");
let flooded = holed;
for (let i = 0; i < 10; i += 1) flooded = stepDamage(flooded, 1);
assert.ok(flooded.hull > holed.hull, "flooding raises hull severity over time");
assert.notEqual(flooded, holed, "stepDamage returns a new record");

// An aviation hit stops aircraft operations without touching propulsion.
const carrierFresh = carrier();
assert.equal(canOperateAircraft(carrierFresh), true, "an intact carrier flies aircraft");
const decked = applyHit(carrierFresh, "aviation", 120, 1);
assert.equal(canOperateAircraft(decked), false, "an aviation hit stops aircraft operations");
assert.equal(decked.propulsion, carrierFresh.propulsion, "aviation damage leaves propulsion alone");
assert.equal(speedFactor(decked), speedFactor(carrierFresh), "a deck hit does not slow the hull");
// A hull without a flight deck never operates aircraft, however intact.
assert.equal(canOperateAircraft(destroyer()), false, "a destroyer has no flight deck");

// A fire spreads, then runs out of fuel and burns out.
let burning = applyHit(fresh, "fire", 100, 1);
assert.ok(burning.fire > 0 && burning.fireRate > 0, "a fire hit lights a spreading fire");
let grew = false;
for (let i = 0; i < 60; i += 1) {
  const before = burning.fire;
  burning = stepDamage(burning, 1);
  if (burning.fire > before) grew = true;
}
assert.ok(grew, "a fire can spread over time");
assert.equal(burning.fire, 0, "a fire burns out once it stops spreading");
assert.equal(burning.fireRate, 0, "a burnt-out fire stops spreading");

// Same absolute hit, different class capacity: the destroyer takes far more of its pool.
const dHit = applyHit(destroyer(), "hull", 40, 1);
const cHit = applyHit(carrier(), "hull", 40, 1);
assert.ok(dHit.hull > cHit.hull, "a destroyer's smaller capacity means the same hit lands harder");
assert.ok(speedFactor(dHit) < speedFactor(cHit), "the two classes end in different operable states");

// Repairing one zone does not restore a different one.
const hurt = applyHit(applyHit(destroyer(), "hull", 40, 1), "propulsion", 40, 1);
const repairedHull = applyRepair(hurt, "hull", 100);
assert.ok(repairedHull.hull < hurt.hull, "repairing the hull lowers hull damage");
assert.equal(repairedHull.propulsion, hurt.propulsion, "repairing the hull leaves propulsion as it was");
assert.equal(repairedHull.flooding, 0, "a fully repaired hull stops flooding");
const repairedProp = applyRepair(hurt, "propulsion", 100);
assert.equal(repairedProp.hull, hurt.hull, "repairing propulsion does not restore the hull");

// Real armament, not a cosmetic modelled gun count: the class table carries the actual fit.
assert.equal(classCapacity("carrier").mainGuns, 0, "a carrier is not granted a main battery");
assert.ok(classCapacity("destroyer").mainGuns > 0, "a destroyer keeps its real main battery");
assert.equal(weaponsAvailable(initShipDamage({ ...classCapacity("destroyer"), weapons: 0 })), false,
  "no real weapon mount means no weapons");

// Everything is frozen and pure: inputs survive every call unchanged.
const frozen = Object.freeze(applyHit(destroyer(), "hull", 30, 1));
const snapshot = JSON.stringify(frozen);
const stepped = stepDamage(frozen, 1);
assert.notEqual(stepped, frozen, "stepDamage returns a new record");
assert.equal(JSON.stringify(frozen), snapshot, "stepDamage does not mutate its input");
const hitAgain = applyHit(frozen, "weapons", 20, 1);
assert.notEqual(hitAgain, frozen, "applyHit does not reuse the input");
assert.equal(JSON.stringify(frozen), snapshot, "applyHit does not mutate its input");
const repaired = applyRepair(frozen, "hull", 10);
assert.notEqual(repaired, frozen, "applyRepair does not reuse the input");
assert.equal(JSON.stringify(frozen), snapshot, "applyRepair does not mutate its input");

console.log(`check-damage: five zones, class capacity, ${SHIP_DAMAGE_ZONES.join("/")} all functional`);
