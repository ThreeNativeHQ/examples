/**
 * Midway-facility check. Exercises the pure `src/sim/facilities.ts` base model without a browser:
 * stores-only ignition, burn-out, repair retention, per-kind capability averaging, the Open Pacific
 * gate, and the observation snapshot. The module owns no randomness, so every assertion is exact.
 *
 * Uses the esbuild vite already installs. Run: node scripts/check-facilities.mjs
 */
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { build } from "esbuild";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const built = await build({
  stdin: { contents: 'export * from "./src/sim/facilities.ts";', loader: "ts", resolveDir: root },
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node20",
  write: false,
  logLevel: "silent",
});
const {
  FACILITY_KINDS,
  FIRE_THRESHOLD,
  damageFacility,
  stepFacility,
  airstripCapability,
  storesCapability,
  radarWarning,
  radioDelivery,
  seaplaneCapability,
  baseAviationLost,
  observedCapability,
  spreadFire,
  repairPlan,
  japaneseFollowUp,
} = await import(`data:text/javascript,${encodeURIComponent(built.outputFiles[0].text)}`);

const fac = (over = {}) => ({
  id: over.id ?? "f",
  kind: over.kind ?? "airstrip",
  x: 0,
  z: 0,
  radius: 100,
  health: 1,
  burning: false,
  repairProgress: 0,
  repairBlocked: null,
  ...over,
});
const freeze = (x) => Object.freeze(x);

assert.deepEqual(
  [...FACILITY_KINDS],
  ["airstrip", "stores", "radar", "radio", "seaplane"],
  "there must be exactly the five facility kinds",
);

// 1 — only stores can catch fire, and only from a hit at or above the threshold.
{
  const stores = fac({ id: "st", kind: "stores", health: 1 });
  assert.equal(damageFacility(stores, FIRE_THRESHOLD, 0).burning, true, "a stores hit at the threshold must ignite");
  assert.equal(
    damageFacility(stores, FIRE_THRESHOLD - 0.05, 0).burning,
    false,
    "a stores hit below the threshold must not ignite",
  );
  for (const kind of FACILITY_KINDS.filter((k) => k !== "stores")) {
    assert.equal(damageFacility(fac({ kind, health: 1 }), 1, 0).burning, false, `${kind} must never catch fire`);
  }
  assert.equal(stores.burning, false, "damageFacility must not mutate its input");
}

// 2 — a burning facility loses health, and the loss stops once the fire burns out.
{
  const rates = { repair: 0, burn: 0.5 };
  const lit = fac({ id: "st", kind: "stores", health: 1, burning: true });
  const after = stepFacility(lit, 0.5, rates);
  assert.ok(after.health < lit.health, "a burning facility must lose health over time");
  let out = lit;
  for (let i = 0; i < 20; i += 1) out = stepFacility(out, 0.5, rates);
  assert.equal(out.burning, false, "the fire must eventually burn out");
  const settled = out.health;
  assert.equal(stepFacility(out, 5, rates).health, settled, "a burned-out fire must stop the loss");
}

// 3 — an interrupted repair keeps its progress and resumes from there, never from zero.
{
  const rates = { repair: 0.1, burn: 0 };
  const hurt = fac({ id: "as", kind: "airstrip", health: 0.4 });
  const once = stepFacility(hurt, 1, rates);
  assert.ok(once.repairProgress > 0, "repair must make progress when free");
  const blocked = stepFacility(freeze({ ...once, repairBlocked: "crew" }), 1, rates);
  assert.equal(blocked.repairProgress, once.repairProgress, "a blocked repair must not lose its progress");
  const resumed = stepFacility({ ...blocked, repairBlocked: null }, 1, rates);
  assert.ok(resumed.repairProgress > once.repairProgress, "repair must resume from where it stopped");
}

// 4 — one dead radar of two leaves half the warning; the base is not closed by a single hit.
{
  const list = freeze([fac({ id: "r1", kind: "radar", health: 1 }), fac({ id: "r2", kind: "radar", health: 0 })]);
  assert.equal(radarWarning(list), 0.5, "one dead radar of two must leave the base at half warning");
  assert.ok(radarWarning(list) > 0, "one radar loss must not close the base");
}

// 5 — destroyed stores ground the seaplanes even though the seaplane area is untouched.
{
  const area = fac({ id: "sp", kind: "seaplane", health: 1 });
  const stores = fac({ id: "st", kind: "stores", health: 1 });
  const before = seaplaneCapability(freeze([area, stores]));
  const after = seaplaneCapability(freeze([area, damageFacility(stores, 1, 0)]));
  assert.ok(after < before, "destroyed stores must fall the seaplane capability");
}

// 6 — the airstrip serves land-based aircraft only and is blind to the seaplane area.
{
  const strip = fac({ id: "as", kind: "airstrip", health: 1 });
  const area = fac({ id: "sp", kind: "seaplane", health: 1 });
  assert.equal(airstripCapability(freeze([strip, area])), 1, "the airstrip counts airstrips, not seaplanes");
  assert.equal(
    airstripCapability(freeze([strip, damageFacility(area, 1, 0)])),
    1,
    "a destroyed seaplane area must not touch the airstrip",
  );
}

// 7 — a damaged radio delays the report; a whole radio adds exactly none.
{
  const full = freeze([fac({ id: "rd", kind: "radio", health: 1 })]);
  assert.equal(radioDelivery(full), 1, "a whole radio must add no delay");
  const half = freeze([fac({ id: "rd", kind: "radio", health: 0.5 })]);
  const dead = freeze([fac({ id: "rd", kind: "radio", health: 0 })]);
  assert.ok(radioDelivery(half) > 1, "a damaged radio must delay the report");
  assert.ok(radioDelivery(dead) > radioDelivery(half), "a worse radio must delay it further");
  assert.ok(Number.isFinite(radioDelivery(dead)), "a destroyed radio must still give a finite multiplier");
}

// 8 — aviation is lost only when both the airstrip and the seaplane route are gone.
{
  const strip = fac({ id: "as", kind: "airstrip", health: 1 });
  const area = fac({ id: "sp", kind: "seaplane", health: 1 });
  const fuel = fac({ id: "st", kind: "stores", health: 1 });
  const stripOnly = freeze([strip, damageFacility(area, 1, 0), damageFacility(fuel, 1, 0)]);
  assert.equal(baseAviationLost(stripOnly), false, "a surviving airstrip must keep aviation alive");
  const seaplaneOnly = freeze([damageFacility(strip, 1, 0), area, fuel]);
  assert.equal(baseAviationLost(seaplaneOnly), false, "surviving seaplanes must keep aviation alive");
  const neither = freeze([damageFacility(strip, 1, 0), damageFacility(area, 1, 0), damageFacility(fuel, 1, 0)]);
  assert.equal(baseAviationLost(neither), true, "both routes gone must close the base");
}

// 9 — the attacker's belief comes from the report, so later damage does not move it.
{
  const list = freeze([fac({ id: "as", kind: "airstrip", health: 1 }), fac({ id: "sp", kind: "seaplane", health: 1 })]);
  const observed = { as: 1, sp: 1 };
  const before = observedCapability(list, observed);
  const bombed = freeze([damageFacility(list[0], 1, 0), damageFacility(list[1], 1, 0)]);
  assert.equal(before, 1, "the snapshot reported full capability");
  assert.equal(observedCapability(bombed, observed), before, "the belief must not move with later damage");
  assert.equal(observedCapability(list, { as: 0, sp: 0 }), 0, "a stale sighting of ruin must read as ruin");
}

// 10 — records are copied, and frozen inputs survive every call untouched.
{
  const rates = { repair: 0.1, burn: 0.5 };
  const f = freeze(fac({ id: "st", kind: "stores", health: 0.6, burning: true }));
  const list = freeze([f]);
  const observed = Object.freeze({ st: 0.6 });
  const damaged = damageFacility(f, 0.3, 0);
  const stepped = stepFacility(f, 1, rates);
  assert.notEqual(damaged, f, "damageFacility must return a new record");
  assert.notEqual(stepped, f, "stepFacility must return a new record");
  assert.equal(f.health, 0.6, "the frozen input must be untouched by damage");
  assert.equal(f.burning, true, "the frozen input must be untouched by step");
  assert.equal(airstripCapability(list), 0, "queries must run on frozen input");
  assert.equal(storesCapability(list), 0.6, "storesCapability must read the frozen record");
  assert.ok(Number.isFinite(observedCapability(list, observed)), "observedCapability must read a frozen snapshot");
}

// 11 — only a burning stores fire spreads, only within its radius, and only on a passing draw.
{
  const rates = { repair: 0, burn: 1 };
  const byId = (out, id) => out.find((f) => f.id === id);
  const source = fac({ id: "st", kind: "stores", x: 0, z: 0, radius: 100, health: 0.5, burning: true });
  const near = fac({ id: "as", kind: "airstrip", x: 50, z: 0, health: 1 });
  const far = fac({ id: "rd", kind: "radar", x: 500, z: 0, health: 1 });
  const list = freeze([source, near, far]);

  const passed = spreadFire(list, 0.5, rates, 0.4); // chance = burn*dt = 0.5
  assert.equal(byId(passed, "as").burning, true, "a neighbour inside the radius must catch on a passing draw");
  assert.equal(byId(passed, "rd").burning, false, "a facility outside the radius must not catch");
  assert.notEqual(byId(passed, "as"), near, "spreadFire must return new records");
  assert.equal(near.burning, false, "spreadFire must not mutate its input");
  assert.equal(byId(spreadFire(list, 0.5, rates, 0.6), "as").burning, false, "a failing draw must not spread fire");

  const radarSource = fac({ id: "rd2", kind: "radar", x: 0, z: 0, radius: 100, health: 0.5, burning: true });
  const beside = fac({ id: "sp", kind: "seaplane", x: 10, z: 0, health: 1 });
  assert.equal(
    byId(spreadFire(freeze([radarSource, beside]), 1, rates, 0), "sp").burning,
    false,
    "only a stores fire may spread",
  );

  const ratesBurn = { repair: 0, burn: 0.5 };
  let out = source;
  for (let i = 0; i < 20; i += 1) out = stepFacility(out, 0.5, ratesBurn);
  assert.equal(out.burning, false, "the source must have burned out first");
  const afterOut = spreadFire(freeze([out, near]), 1, rates, 0);
  assert.equal(afterOut.find((f) => f.id === "as").burning, false, "a burned-out fire must stop spreading");
}

// 12 — repair picks by priority, skips burning and blocked, and never exceeds the work available.
{
  const list = freeze([
    fac({ id: "burn", kind: "stores", health: 0.2, burning: true }),
    fac({ id: "full", kind: "airstrip", health: 1 }),
    fac({ id: "strip", kind: "airstrip", health: 0.5 }),
    fac({ id: "depot", kind: "stores", health: 0.3 }),
    fac({ id: "radar", kind: "radar", health: 0.5 }),
    fac({ id: "blocked", kind: "stores", health: 0.1, repairBlocked: "crew" }),
  ]);
  const plan = repairPlan(list, 2, 10);
  assert.equal(plan.length, 2, "repair must spend no more than the work available");
  assert.ok(!plan.some((p) => p.id === "burn"), "a burning facility must never be worked");
  assert.ok(!plan.some((p) => p.id === "blocked"), "a blocked facility must not be worked");
  assert.ok(!plan.some((p) => p.id === "full"), "a whole facility needs no work");
  assert.equal(plan[0].id, "strip", "the airstrip is the first priority");
  assert.equal(plan[1].id, "depot", "stores is the next priority after the airstrip");
  assert.deepEqual(repairPlan(list, 0, 10), [], "no work means no plan");
}

// 13 — the repeat-strike call reads the report, so live damage after the sighting cannot move it.
{
  const live = freeze([fac({ id: "as", kind: "airstrip", health: 1 }), fac({ id: "sp", kind: "seaplane", health: 1 })]);
  const snapshot = Object.freeze({ as: 1, sp: 1 });
  const observed = observedCapability(live, snapshot);
  const before = japaneseFollowUp(observed, 0.5);
  assert.equal(before.worthwhile, true, "a report of full capability justifies another strike");
  const bombed = freeze([damageFacility(live[0], 1, 0), damageFacility(live[1], 1, 0)]);
  assert.equal(observedCapability(bombed, snapshot), observed, "the sighting must not follow live health");
  assert.deepEqual(japaneseFollowUp(observed, 0.5), before, "the call must not change with later damage");
  assert.equal(
    japaneseFollowUp(observedCapability(bombed, { as: 0, sp: 0 }), 0.5).worthwhile,
    false,
    "a report of suppression must cancel the repeat strike",
  );
  assert.ok(japaneseFollowUp(0.1, 0.5).reason.length > 0, "the answer must carry a readable reason");
}

// 14 — every new function tolerates frozen inputs and leaves them untouched.
{
  const rates = Object.freeze({ repair: 0.1, burn: 0.5 });
  const f = Object.freeze(fac({ id: "st", kind: "stores", x: 0, z: 0, radius: 100, health: 0.6, burning: true }));
  const near = Object.freeze(fac({ id: "as", kind: "airstrip", x: 20, z: 0, health: 0.4 }));
  const list = Object.freeze([f, near]);
  assert.doesNotThrow(() => spreadFire(list, 1, rates, 0), "spreadFire must accept frozen input");
  assert.doesNotThrow(() => repairPlan(list, 1, 5), "repairPlan must accept frozen input");
  assert.doesNotThrow(() => japaneseFollowUp(0.9, 0.5), "japaneseFollowUp must accept a plain number");
  assert.equal(f.health, 0.6, "spreadFire must not touch the frozen source");
  assert.equal(near.burning, false, "spreadFire must not light a frozen neighbour in place");
  assert.equal(repairPlan(list, 1, 5)[0].id, "as", "repairPlan must read the frozen record");
}

console.log("check-facilities: 14 checks passed");
