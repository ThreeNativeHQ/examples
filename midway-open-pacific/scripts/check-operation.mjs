/**
 * Open Pacific assignment and end-condition check (PRD AC-19, AC-20).
 *
 * `check-sortie-kinds.mjs` proves the `sortie.ts` / `briefing.ts` pure modules in isolation. This
 * check drives a REAL `Battle` through `step` and its ordinary entry points (`selectAssignment`,
 * `recordContact`, `designateTarget`, `releaseOrdnance`, `dropBomb`, `damageShip`, `recover`,
 * `updateSortie`) and asks whether those assignments and the declared Open Pacific end conditions
 * are actually reachable and honest in the live game.
 *
 * It never writes `battle.sortie` or `battle.sortie.objective` directly: every state change goes
 * through a public entry point. Where a rule only exists as a pure function, the world it reads is
 * built from a real `Battle`'s own records, and the missing call site is reported separately.
 *
 * Run: node scripts/check-operation.mjs
 */
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { build } from "esbuild";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const built = await build({
  stdin: {
    contents: `
      export { Battle } from "./src/sim/battle.ts";
      export {
        operationOutcome,
        pendingOpportunities,
        concludeOperation,
        newSortie,
        OPERATION_LAUNCH_DECK,
        OPERATION_RECOVERY_DECK,
      } from "./src/sim/sortie.ts";
      export { offerBriefing } from "./src/sim/briefing.ts";
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
  operationOutcome,
  pendingOpportunities,
  concludeOperation,
  newSortie,
  offerBriefing,
  OPERATION_LAUNCH_DECK,
  OPERATION_RECOVERY_DECK,
} = await import(`data:text/javascript,${encodeURIComponent(built.outputFiles[0].text)}`);

const STEP = 1 / 30;
const JP = (b) => b.ships.filter((s) => s.team === "jp" && s.kind === "carrier");
const US_CARRIERS = (b) => b.ships.filter((s) => s.team === "us" && s.kind === "carrier");
const surfaceCruiser = (b) => b.ships.find((s) => s.team === "jp" && s.kind === "cruiser" && !s.support);

/** The pure functions' plain world, read straight off a real Battle. */
const worldOf = (b) => ({
  ships: b.ships,
  aircraft: b.aircraft,
  contacts: [...b.contacts.values()],
  survivors: b.survivors,
  facilities: b.facilities,
});
/** Copies of a Battle's hull records, so a withheld condition never mutates the live battle. */
const cloneShips = (b, mut = () => {}) => {
  const ships = b.ships.map((s) => ({ ...s }));
  mut(ships);
  return ships;
};
/** A delivered contact shaped exactly like the ones `intel.ts` produces. */
const deliveredReport = (id, targetId, over = {}) => ({
  id,
  team: "us",
  targetId,
  observedAt: 0,
  deliveredAt: 0,
  x: 0,
  z: 0,
  heading: 0,
  speed: 0,
  errorRadius: 0,
  lost: false,
  ...over,
});
/** Disable all four enemy decks through the ordinary weapons path. */
const disableEnemyDecks = (b) => {
  for (const cv of JP(b)) b.damageShip(cv, 9999, { ...cv, y: cv.deckHeight }, "bomb", "us", { owner: "player" });
  return JP(b).every((cv) => cv.sunk || cv.deck < OPERATION_LAUNCH_DECK);
};

const results = [];
function check(name, fn) {
  const notes = [];
  try {
    fn((n) => notes.push(n));
    results.push({ name, ok: true, notes });
  } catch (e) {
    results.push({ name, ok: false, error: e?.message ?? String(e), notes });
  }
}

// ---------------------------------------------------------------------------------------------
// AC-19 — assignments are reachable and honest.
// ---------------------------------------------------------------------------------------------

check("AC-19 the briefing offers at most five categories and never a sixth", (note) => {
  const b = new Battle(1);
  const options = offerBriefing(worldOf(b), b.time);
  assert.ok(options.length <= 5, `offerBriefing returned ${options.length} categories`);
  assert.equal(options.length, 5, `expected exactly the five assignment categories, got ${options.length}`);
  const kinds = options.map((o) => o.kind);
  assert.equal(new Set(kinds).size, kinds.length, `a category repeats: ${kinds.join(", ")}`);
  assert.deepEqual([...kinds].sort(), ["operation", "recon", "strike", "support", "surface"]);
  note(`five categories: ${kinds.join(", ")}`);
});

check("AC-19 a surface strike can be selected, flown, completed and freezes exactly one result", (note) => {
  const b = new Battle(2);
  assert.equal(b.selectAssignment("surface"), true, "Surface Strike must be selectable at the briefing");
  b.start(true);
  const target = surfaceCruiser(b);
  assert.ok(target, "the fleet has an eligible surface hull");
  b.recordContact(target);
  assert.equal(b.designateTarget(target.id), true, "a sighted cruiser must designate");
  assert.equal(b.releaseOrdnance(), true, "the player must be able to release on the designated hull");
  const bomb = b.bombs[b.bombs.length - 1];
  b.damageShip(target, 40, { ...target, y: target.deckHeight }, "bomb", "us", { owner: bomb.owner, stamp: bomb.stamp });
  assert.equal(b.sortie.objective, "achieved", "a watched hit on the designated hull completes the assignment");
  b.recover(b.home);
  const r = b.sortie.result;
  assert.ok(r, "recovery must freeze a result");
  assert.equal(r.assignment, "surface", `frozen assignment is ${r.assignment}`);
  assert.equal(r.outcome, "recovered", `frozen outcome is ${r.outcome}`);
  assert.equal(r.personalHits, 1, `frozen personal hits are ${r.personalHits}`);
  const frozen = JSON.stringify(r);
  b.recover(b.home);
  b.step(STEP, {});
  assert.equal(b.sortie.result, r, "the result record must not be replaced");
  assert.equal(JSON.stringify(b.sortie.result), frozen, "the frozen result must not change");
  note(`one frozen surface result: ${frozen}`);
});

check("AC-19 an unobserved ship is never offered for designation", (note) => {
  const b = new Battle(3);
  b.selectAssignment("surface");
  const cruiser = surfaceCruiser(b);
  assert.deepEqual(b.targetContacts(), [], "no contact means no hull is offered");
  assert.equal(b.designateTarget(cruiser.id), false, "an unobserved hull cannot be designated");
  const options = offerBriefing(worldOf(b), b.time);
  const surface = options.find((o) => o.kind === "surface");
  const strike = options.find((o) => o.kind === "strike");
  assert.equal(surface.feasible, false, "Surface Strike must be infeasible with no delivered contact");
  assert.equal(strike.feasible, false, "Carrier Strike must be infeasible with no delivered contact");
  // Recording a contact for the crew is still not a delivered fleet report.
  b.recordContact(cruiser);
  assert.ok(b.targetContacts().length === 1, "a crew sighting is held, not delivered");
  note("unobserved hull refused for designation; both target-bearing categories infeasible");
});

check("AC-19 a dead designated target yields an explicit retask or unavailable, never a silent swap", (note) => {
  const b = new Battle(4);
  b.selectAssignment("surface");
  b.start(true);
  const target = surfaceCruiser(b);
  b.recordContact(target);
  assert.equal(b.designateTarget(target.id), true, "the live cruiser designates first");
  b.damageShip(target, 9999, { ...target, y: target.deckHeight }, "bomb", "us", { owner: "player" });
  assert.equal(target.sunk, true, "the designated hull is now dead");
  b.updateSortie();
  assert.equal(b.sortie.target, null, "a dead designation must be cleared, never silently swapped");
  assert.equal(b.sortie.objective, "pending", "with another legal hull left the assignment waits for a retask");
  // Remove every remaining legal surface hull; a submerged boat may still surface, so it counts.
  for (const s of b.ships) {
    if (s.team !== "jp" || s.sunk) continue;
    if (s.kind === "cruiser" || s.kind === "destroyer" || s.kind === "sub")
      b.damageShip(s, 9999, { ...s, y: s.deckHeight }, "bomb", "us", { owner: "player" });
  }
  b.updateSortie();
  assert.equal(b.sortie.objective, "unavailable", "with no eligible hull left the assignment is explicitly unavailable");
  note("dead target: cleared for retask, then explicit unavailable once no hull remains");
});

check("AC-19 an autonomous wing success earns the player no personal credit", (note) => {
  const b = new Battle(5);
  b.selectAssignment("strike");
  b.start(true);
  const target = b.ships.find((s) => s.name === "Akagi");
  b.recordContact(target);
  b.updateSortie();
  b.setCommand("strike");
  const attacker = b.launch(b.home, "bomber");
  assert.ok(attacker, "the home deck must put up the ordered wing");
  attacker.mode = "flight";
  assert.equal(b.dropBomb(attacker), true, "the wing must be able to release");
  const bomb = b.bombs[b.bombs.length - 1];
  b.damageShip(target, 40, { ...target, y: target.deckHeight }, "bomb", "us", { owner: attacker.id, stamp: bomb.stamp });
  assert.equal(b.sortie.objective, "achieved", "the ordered wing hit completes the strike");
  assert.equal(b.sortie.personalHits, 0, "the player scored nothing personally");
  assert.ok(b.sortie.wingHits >= 1, `the wing hit is counted, got ${b.sortie.wingHits}`);
  b.recover(b.home);
  assert.equal(b.sortie.result.personalHits, 0, "the frozen result records no personal credit");
  assert.ok(b.sortie.result.wingHits >= 1, "the frozen result credits the wing");
  note(`wing hit: wingHits=${b.sortie.result.wingHits}, personalHits=${b.sortie.result.personalHits}, objective=${b.sortie.result.objective}`);
});

check("AC-19 death or restart cannot duplicate a completion", (note) => {
  const b = new Battle(6);
  b.selectAssignment("surface");
  b.start(true);
  const target = surfaceCruiser(b);
  b.recordContact(target);
  b.designateTarget(target.id);
  b.releaseOrdnance();
  const bomb = b.bombs[b.bombs.length - 1];
  b.damageShip(target, 40, { ...target, y: target.deckHeight }, "bomb", "us", { owner: bomb.owner, stamp: bomb.stamp });
  b.recover(b.home);
  const r = b.sortie.result;
  const frozen = JSON.stringify(r);
  b.lose("test: a later loss must not add a second completion");
  b.step(STEP, {});
  b.recover(b.home);
  assert.equal(b.sortie.result, r, "the one completion must not be duplicated or replaced");
  assert.equal(JSON.stringify(b.sortie.result), frozen, "and its contents must not change");
  // The pure conclusion path is idempotent for the same reason.
  const pure = newSortie("surface", 0, 4);
  pure.result = { ...r };
  assert.equal(concludeOperation(pure, { state: "defeat", reason: "x" }, 999), pure.result, "concluding once keeps the same record");
  assert.equal(concludeOperation(pure, { state: "defeat", reason: "x" }, 1000), pure.result, "concluding twice keeps the same record");
  note("one frozen completion survived a later loss, a further recovery and two conclusions");
});

// ---------------------------------------------------------------------------------------------
// AC-20 — Open Pacific end conditions.
// ---------------------------------------------------------------------------------------------

check("AC-20 a fourth disabled enemy deck does not end the operation while an attack or rescue is live", (note) => {
  const b = new Battle(21);
  b.selectAssignment("operation");
  b.start(true);
  assert.equal(disableEnemyDecks(b), true, "all four enemy decks must be disabled");
  assert.ok(b.survivors.length > 0, "the sinkings must leave survivors in the water");
  b.step(STEP, {});
  assert.equal(b.status, "playing", "the operation must keep running with a rescue still live");
  const world = { ...worldOf(b), aircraft: [...b.aircraft, { team: "jp", kind: "torpedo", hp: 80, dead: false }] };
  const outcome = operationOutcome(world, b.time);
  assert.equal(outcome.state, "running", `the end-condition model must keep it running, got ${outcome.state}: ${outcome.reason}`);
  note(`four decks out at t=${b.time.toFixed(1)}s, status=${b.status}, ${b.survivors.length} survivors, model=${outcome.state}`);
});

check("AC-20 success needs all four conditions; withholding each keeps the operation running", (note) => {
  const b = new Battle(22);
  b.start();
  for (let i = 0; i < 5; i += 1) b.step(STEP, {});
  assert.equal(disableEnemyDecks(b), true, "all four enemy decks must be disabled");
  for (const a of b.aircraft) if (a.team === "jp") a.hp = 0;
  const world = worldOf(b);
  assert.equal(operationOutcome(world, b.time).state, "success", "all four conditions met must be success");

  const launchCapable = cloneShips(b, (ships) => {
    const cv = ships.find((s) => s.team === "jp" && s.kind === "carrier");
    cv.sunk = false;
    cv.deck = 1;
  });
  assert.equal(operationOutcome({ ...world, ships: launchCapable }, b.time).state, "running", "a launch-capable enemy deck withholds success");

  assert.equal(
    operationOutcome({ ...world, aircraft: [...b.aircraft, { team: "jp", kind: "fighter", hp: 80, dead: false }] }, b.time).state,
    "running",
    "an airborne enemy threat withholds success",
  );

  const noRecovery = cloneShips(b, (ships) => {
    for (const s of ships) if (s.team === "us" && s.kind === "carrier") s.deck = 0;
  });
  assert.equal(operationOutcome({ ...world, ships: noRecovery }, b.time).state, "running", "no usable friendly recovery deck withholds success");

  const lostBase = operationOutcome(
    { ...world, facilities: b.facilities.map((f) => ({ ...f, health: 0, burning: false })) },
    b.time,
  );
  assert.equal(lostBase.state, "running", "losing Midway's aviation withholds success");
  assert.match(lostBase.reason, /Midway/i, `the running reason must name the lost base aviation, got "${lostBase.reason}"`);
  note(`baseline success at t=${b.time.toFixed(1)}s; each of the four conditions withheld in turn kept it running`);
});

check("AC-20 a withdrawal counts only from a delivered observation", (note) => {
  const b = new Battle(23);
  b.start();
  for (let i = 0; i < 5; i += 1) b.step(STEP, {});
  disableEnemyDecks(b);
  for (const a of b.aircraft) if (a.team === "jp") a.hp = 0;
  const ships = cloneShips(b, (list) => {
    const cv = list.find((s) => s.team === "jp" && s.kind === "carrier");
    cv.sunk = false;
    cv.deck = 1;
    cv.x = 30000;
    cv.z = 0;
  });
  assert.ok(Math.hypot(30000, 0) > 24000, "the withdrawn hull is truly outside the declared boundary");

  const hidden = operationOutcome({ ...worldOf(b), ships, contacts: [] }, b.time);
  assert.equal(hidden.state, "running", "an enemy that withdrew but was never observed must not satisfy the condition");

  const withdrawn = ships.find((s) => s.team === "jp" && s.kind === "carrier" && !s.sunk);
  const report = deliveredReport("r-withdrawn", withdrawn.id, { x: 30000, z: 0, observedAt: b.time - 1, deliveredAt: b.time });
  const observed = operationOutcome({ ...worldOf(b), ships, contacts: [report] }, b.time);
  assert.equal(observed.state, "success", "a delivered report beyond the boundary is an observed withdrawal");
  note("unobserved withdrawal kept running; the same hull with a delivered report reached success");
});

check("AC-20 losing base aviation is not success even with friendly decks alive", (note) => {
  const b = new Battle(24);
  const ships = cloneShips(b, (list) => {
    for (const s of list)
      if (s.team === "jp" && s.kind === "carrier") {
        s.sunk = true;
        s.deck = 0;
      }
  });
  const facilities = b.facilities.map((f) => ({ ...f, health: 0, burning: false }));
  const outcome = operationOutcome({ ...worldOf(b), ships, facilities }, b.time);
  assert.equal(outcome.state, "running", "the lost base air arm withholds success");
  assert.notEqual(outcome.state, "defeat", "a lost base air arm alone is not a defeat either");
  assert.match(outcome.reason, /Midway/i, `the running reason must name the lost base aviation, got "${outcome.reason}"`);
  assert.ok(US_CARRIERS(b).every((s) => s.deck > OPERATION_RECOVERY_DECK), "the friendly decks are alive in this scenario");
  note(`base aviation lost with the friendly deck alive: state=${outcome.state}, reason="${outcome.reason}"`);
});

check("AC-20 concluding is not compulsory while a salvage or pursuit opportunity is pending", (note) => {
  const b = new Battle(25);
  b.start(true);
  const destroyer = b.ships.find((s) => s.team === "jp" && s.kind === "destroyer");
  b.damageShip(destroyer, 9999, { ...destroyer, y: destroyer.deckHeight }, "bomb", "us", { owner: "player" });
  assert.ok(b.survivors.some((v) => !v.rescued), "sinking a hull must put survivors in the water");
  const salvage = pendingOpportunities(worldOf(b), b.time);
  assert.ok(salvage.some((o) => o.kind === "salvage"), "survivors are still selectable salvage work");
  const afloat = b.ships.find((s) => s.team === "jp" && s.kind === "carrier" && !s.sunk);
  const report = deliveredReport("r-afloat", afloat.id, { x: afloat.x, z: afloat.z, observedAt: b.time - 1, deliveredAt: b.time });
  const all = pendingOpportunities({ ...worldOf(b), contacts: [report] }, b.time);
  assert.ok(all.some((o) => o.kind === "pursuit" && o.id === afloat.id), "a delivered report on an afloat enemy hull is a pursuit");
  note(`${salvage.length} salvage and ${all.filter((o) => o.kind === "pursuit").length} pursuit opportunities pending`);
});

check("AC-20 a completed short assignment keeps its own result after an operation failure", (note) => {
  const b = new Battle(26);
  b.selectAssignment("surface");
  b.start(true);
  const target = surfaceCruiser(b);
  b.recordContact(target);
  b.designateTarget(target.id);
  b.releaseOrdnance();
  const bomb = b.bombs[b.bombs.length - 1];
  b.damageShip(target, 40, { ...target, y: target.deckHeight }, "bomb", "us", { owner: bomb.owner, stamp: bomb.stamp });
  b.recover(b.home);
  const own = b.sortie.result;
  assert.ok(own && own.assignment === "surface", `the surface strike must freeze its own result, got ${JSON.stringify(own)}`);
  const frozen = JSON.stringify(own);
  for (const cv of US_CARRIERS(b)) b.damageShip(cv, 9999, { ...cv, y: cv.deckHeight }, "bomb", "jp", { owner: null });
  b.lose("The U.S. carrier force has been lost.");
  b.step(STEP, {});
  assert.equal(b.sortie.result, own, "an operation failure must not rewrite the short assignment's result");
  assert.equal(JSON.stringify(b.sortie.result), frozen, "and must not alter the frozen record");

  const independent = newSortie("surface", 0, 4);
  independent.result = { ...own };
  assert.equal(
    concludeOperation(independent, { state: "defeat", reason: "All friendly carriers are sunk." }, b.time),
    independent.result,
    "concludeOperation must return an existing short result untouched",
  );
  note("the frozen surface result survived a total friendly-carrier loss unchanged");
});

// ---------------------------------------------------------------------------------------------
// Wiring probes: do the live game's own entry points consult any of this?
// ---------------------------------------------------------------------------------------------

check("WIRING AC-20 a real Battle must conclude Open Pacific through the end conditions", (note) => {
  const b = new Battle(27);
  b.selectAssignment("operation");
  b.start(true);
  disableEnemyDecks(b);
  for (const a of b.aircraft) if (a.team === "jp") a.hp = 0;
  const outcome = operationOutcome(worldOf(b), b.time);
  assert.equal(outcome.state, "success", `all four conditions met, the model says success, got ${outcome.state}: ${outcome.reason}`);
  b.recover(b.home);
  assert.ok(b.sortie.result, "recovering an Open Pacific sortie after all four conditions are met must freeze a result");
  assert.equal(b.sortie.result.operation, "success", `the frozen operation result is ${b.sortie.result.operation}`);
  note("Battle froze an operation result");
});

check("WIRING AC-20 Battle calls operationOutcome / pendingOpportunities / concludeOperation", () => {
  const src = readFileSync(resolve(root, "src/sim/battle.ts"), "utf8");
  for (const fn of ["operationOutcome", "pendingOpportunities", "concludeOperation"]) {
    assert.ok(new RegExp(`\\b${fn}\\b`).test(src), `src/sim/battle.ts never references ${fn}()`);
  }
});

check("WIRING AC-19 a src module consumes briefing.ts", () => {
  const files = ["src/sim/battle.ts", "src/scenes/Midway.ts", "src/hud.ts", "src/render/world.ts"];
  const src = files.map((f) => readFileSync(resolve(root, f), "utf8")).join("\n");
  assert.ok(/sim\/briefing|from\s+["']\.\/briefing/.test(src), "no src module imports src/sim/briefing.ts");
});

// ---------------------------------------------------------------------------------------------

let failed = 0;
for (const r of results) {
  console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}`);
  for (const n of r.notes) console.log(`      ${n}`);
  if (!r.ok) console.log(`      ${r.error}`);
  if (!r.ok) failed += 1;
}
console.log(`\ncheck-operation: ${results.length - failed}/${results.length} passed`);
if (failed) {
  console.log(`check-operation: ${failed} FAILED — missing wiring or genuine behaviour bug, reported above`);
  process.exitCode = 1;
}
