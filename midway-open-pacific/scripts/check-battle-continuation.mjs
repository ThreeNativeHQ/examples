/**
 * Battle-continuation check: a shoot-down must not end the battle, a replacement must be charged
 * exactly once across airframe, store, fuel and ammunition, and the map's appraisal must move only
 * on confirmed enemy losses — never on hidden hull state or a reported-contact count.
 *
 * The crash/launch economy is otherwise only visible in a browser; this exercises the pure Battle
 * directly. Run: node scripts/check-battle-continuation.mjs
 */
import assert from "node:assert/strict";
import { build } from "esbuild";

const { outputFiles } = await build({
  stdin: {
    contents: 'export { Battle } from "./src/sim/battle.ts"; export { totalAircraft, canLaunch } from "./src/sim/carrier-ops.ts";',
    loader: "ts",
    resolveDir: process.cwd(),
  },
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
  logLevel: "silent",
});
const { Battle } = await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString("base64")}`);

/** Mirrors `FUEL_PER_LAUNCH` in src/sim/battle.ts (one launch consumes one fuel load). */
const FUEL_LOAD = 1;

const ready = (s) => Object.values(s.air.ready).reduce((n, v) => n + v, 0);
/** The bomb/torpedo stores only, so an ammunition draw does not masquerade as an ordnance debit. */
const ordnance = (s) => (s.air.stores.bomb ?? 0) + (s.air.stores.torpedo ?? 0);
const ammoStores = (b) => usCarriers(b).reduce((n, s) => n + (s.air.stores.ammo ?? 0), 0);
const usCarriers = (b) => b.ships.filter((s) => s.kind === "carrier" && s.team === "us");
const fleetReady = (b) => usCarriers(b).reduce((n, s) => n + ready(s), 0);
const fleetOrdnance = (b) => usCarriers(b).reduce((n, s) => n + ordnance(s), 0);
const fleetLost = (b) => usCarriers(b).reduce((n, s) => n + (s.lostAircraft ?? 0), 0);

function airborne(seed = 19420604, assignment = "strike") {
  const b = new Battle(seed);
  b.selectAssignment(assignment);
  b.start(true);
  return b;
}

/** Destroy the player and run the fall until the wreck has settled. Returns the pre-kill time. */
function shootDown(b) {
  const t0 = b.time;
  b.player.y = 900;
  b.damagePlane(b.player, 9999, "jp", "fuselage");
  assert.equal(b.player.mode, "crashing", "a lethal hit must put the aircraft into the dive");
  for (let i = 0; i < 60 * 60 && b.player.mode !== "downed"; i += 1) b.step(1 / 60);
  assert.equal(b.player.mode, "downed", "the settled wreck must leave a downed pilot, not a defeat");
  return t0;
}

/** Freeze every US deck's hangar so no AI launch moves the inventory while the player rolls. */
function freezeDecks(b) {
  for (const s of usCarriers(b))
    if (s.air) {
      s.air.ready = {};
      s.air.servicing = {};
      s.air.damaged = {};
    }
}

// ---------------------------------------------------------------------------------------------
// 1 — A shoot-down freezes the sortie but the battle, the clock and the AI keep running.
// ---------------------------------------------------------------------------------------------
{
  const b = airborne();
  const oldId = b.sortie.id;
  const t0 = shootDown(b);
  assert.equal(b.status, "playing", "a shoot-down must not end the battle while a deck is afloat");
  const oldResult = b.sortie.result;
  assert.ok(oldResult && oldResult.outcome === "lost", "the lost sortie is frozen as lost before the replacement");
  assert.equal(b.stats.playerLosses, 1, "the player's own loss is counted exactly once");
  const lostBefore = fleetLost(b);

  const ai = b.aircraft.find((a) => a.hp > 0 && a.team === "jp") || b.aircraft.find((a) => a.hp > 0);
  assert.ok(ai, "AI aircraft must still be in the air while the player is downed");
  const tDowned = b.time;
  for (let i = 0; i < 60 * 3; i += 1) b.step(1 / 60);
  assert.ok(b.time > tDowned + 2.9, `the clock keeps running while downed (${tDowned} -> ${b.time})`);
  assert.ok(b.time > t0, "time advanced through the crash and the settle");
  assert.ok(b.aircraft.some((a) => a.hp > 0), "the AI battle keeps running while the pilot is downed");

  // ---- Replacement: one airframe, one store, one fuel load and one gun load, each exactly once ----
  // The downed airframe's own partial rounds must not follow the pilot into the new aircraft.
  b.player.ammo = 250;
  b.player.rearAmmo = 40;
  const before = new Map(usCarriers(b).map((s) => [s.id, { r: ready(s), ord: ordnance(s), ammo: s.air.stores.ammo ?? 0, fuel: s.air.fuel }]));
  const fleetBefore = fleetReady(b);
  const ordnanceBefore = fleetOrdnance(b);
  const ammoBefore = ammoStores(b);
  assert.equal(b.takeAnotherAircraft(), true, "an operational fleet offers a replacement");
  assert.equal(b.player.mode, "deck", "the replacement puts the pilot back on a deck");
  assert.equal(b.status, "playing");
  assert.equal(b.sortie.id, oldId + 1, "the replacement opens a new sortie id");
  assert.equal(b.lastResult, oldResult, "the frozen result of the lost sortie survives");
  assert.equal(fleetReady(b), fleetBefore - 1, "the replacement must spend exactly one ready airframe");
  assert.equal(fleetOrdnance(b), ordnanceBefore - 1, "the replacement must spend exactly one ordnance store");
  assert.equal(ammoStores(b), ammoBefore - 1, "a fresh airframe draws exactly one gun load");
  assert.equal(b.player.ammo, 1400, "the new airframe draws a full gun load, not the downed plane's rounds");
  assert.equal(b.player.rearAmmo, 240);
  assert.equal(b.player.fuel, 100, "the replacement draws one full tank");
  assert.equal(b.battleStatus().airLosses, lostBefore + 1, "the player's loss rides in allied losses once");

  const fuelled = usCarriers(b).filter((s) => s.air.fuel === before.get(s.id).fuel - FUEL_LOAD);
  assert.equal(fuelled.length, 1, "exactly one deck is charged exactly one fuel load");
  for (const s of usCarriers(b)) {
    const b0 = before.get(s.id);
    assert.equal(s.air.fuel, b0.fuel - (fuelled.includes(s) ? FUEL_LOAD : 0), `deck ${s.name} fuel accounting`);
  }
  const chosen = fuelled[0];
  for (const s of usCarriers(b)) {
    if (s === chosen) continue;
    assert.equal(ready(s), before.get(s.id).r, `deck ${s.name} must not lose an airframe`);
    assert.equal(ordnance(s), before.get(s.id).ord, `deck ${s.name}'s ordnance must not be touched`);
    assert.equal(s.air.stores.ammo ?? 0, before.get(s.id).ammo, `deck ${s.name}'s ammunition must not be touched`);
  }

  // ---- Repeated action: a no-op that consumes nothing ----
  const repeatReady = fleetReady(b);
  const repeatOrdnance = fleetOrdnance(b);
  const repeatFuel = chosen.air.fuel;
  const repeatAmmo = ammoStores(b);
  assert.equal(b.takeAnotherAircraft(), false, "a second take while flying must be refused");
  assert.equal(fleetReady(b), repeatReady, "a refused repeat must consume no airframe");
  assert.equal(fleetOrdnance(b), repeatOrdnance, "a refused repeat must consume no ordnance");
  assert.equal(chosen.air.fuel, repeatFuel, "a refused repeat must consume no fuel");
  assert.equal(ammoStores(b), repeatAmmo, "a refused repeat must consume no ammunition");

  // ---- Takeoff: the deck run charges nothing more than the single launch already charged ----
  freezeDecks(b);
  const readyOnDeck = ready(chosen);
  const ordnanceOnDeck = ordnance(chosen);
  const fuelOnDeck = chosen.air.fuel;
  const ammoOnDeck = chosen.air.stores.ammo ?? 0;
  for (let i = 0; i < 60 * 20 && b.player.mode !== "flight"; i += 1) b.step(1 / 60, { throttleUp: true });
  assert.equal(b.player.mode, "flight", "the replacement must be able to fly off the deck");
  assert.equal(ready(chosen), readyOnDeck, "the launch run must not charge a second airframe");
  assert.equal(ordnance(chosen), ordnanceOnDeck, "the launch run must not charge a second ordnance store");
  assert.equal(chosen.air.fuel, fuelOnDeck, "the launch run must not draw a second fuel load");
  assert.equal(chosen.air.stores.ammo ?? 0, ammoOnDeck, "the launch run must not draw a second gun load");
}

// ---------------------------------------------------------------------------------------------
// 1b — Exactly one load of fuel: a deck with precisely one load tops the replacement up and ends dry.
// ---------------------------------------------------------------------------------------------
{
  const b = airborne();
  shootDown(b);
  const carriers = usCarriers(b);
  for (const s of carriers) s.air.fuel = 0;
  const donor = carriers.find((s) => (s.air.ready.sbd ?? 0) > 0 && (s.air.stores.bomb ?? 0) > 0) ?? carriers[0];
  donor.deckState.mode = "available";
  donor.deckState.occupiedUntil = 0;
  donor.deckState.suspended = null;
  donor.air.ready = { sbd: 1 };
  donor.air.stores = { bomb: 1, ammo: 1, torpedo: 0 };
  donor.air.fuel = FUEL_LOAD;
  assert.equal(b.takeAnotherAircraft(), true, "a deck with exactly one load of fuel can still launch");
  assert.equal(b.player.fuel, 100, "the new plane gets a full tank from that one load");
  assert.equal(donor.air.fuel, 0, "the carrier ends with zero fuel after the single load");
}

// ---------------------------------------------------------------------------------------------
// 2 — A replacement comes from an alternate operational deck when home cannot fly.
// ---------------------------------------------------------------------------------------------
{
  const b = airborne();
  shootDown(b);
  const home = b.ships.find((s) => s.id === b.player.home);
  home.sunk = true;
  home.hp = 0;
  home.deck = 0;
  assert.equal(b.takeAnotherAircraft(), true, "another friendly deck can still spot an aircraft");
  assert.notEqual(b.player.home, home.id, "the replacement must come from an operational deck");
  assert.equal(b.ships.find((s) => s.id === b.player.home).sunk, false);
}

// ---------------------------------------------------------------------------------------------
// 3 — Exhausted stocks and a deck that cannot launch refuse truthfully and stay downed.
// ---------------------------------------------------------------------------------------------
{
  const b = airborne();
  shootDown(b);
  for (const s of usCarriers(b)) if (s.air) {
    s.air.ready = {};
    s.air.fuel = 0;
  }
  assert.equal(b.takeAnotherAircraft(), false, "no ready airframe or fuel must refuse the replacement");
  assert.equal(b.player.mode, "downed", "a refusal leaves the pilot downed, not defeated");
  assert.ok(
    b.events.some((e) => e.type === "notice" && /NO REPLACEMENT AIRCRAFT/.test(e.text ?? "")),
    `a refusal must be surfaced with a truthful reason: ${JSON.stringify(b.events.at(-1))}`,
  );
  const t = b.time;
  for (let i = 0; i < 60 * 3; i += 1) b.step(1 / 60);
  assert.ok(b.time > t + 2.9, "waiting for a replacement is not an automatic defeat");
  assert.equal(b.status, "playing");
}

// ---------------------------------------------------------------------------------------------
// 4 — Losing the last friendly carrier *while downed* is the defeat, checked during the wait.
// ---------------------------------------------------------------------------------------------
{
  const b = airborne();
  shootDown(b);
  assert.equal(b.status, "playing", "still waiting with a deck afloat");
  // The decks go under after the pilot is already downed, so the defeat has to be detected by the
  // waiting branch, not by the crash settle.
  for (const s of usCarriers(b)) {
    s.sunk = true;
    s.hp = 0;
    s.deck = 0;
  }
  for (let i = 0; i < 60 * 10 && b.status === "playing"; i += 1) b.step(1 / 60);
  assert.equal(b.status, "lost", "losing every friendly carrier while downed is the battle's defeat");
}

// ---------------------------------------------------------------------------------------------
// 5 — The map appraisal is confirmed attrition only; partial contacts never imply enemy strength.
// ---------------------------------------------------------------------------------------------
{
  const b = new Battle(19420604);
  b.selectAssignment("strike");
  b.start(false);
  let st = b.battleStatus();
  assert.equal(st.appraisal, "INSUFFICIENT INTELLIGENCE", "no reported enemy carrier means no appraisal");
  assert.equal(st.airKills, 0, "the map reports the player's own confirmed kills");

  const akagi = b.ships.find((s) => s.name === "Akagi");
  b.recordContact(akagi); // observed, intact
  st = b.battleStatus();
  assert.equal(st.enemyReported, 1, "only the reported carrier is counted");
  assert.equal(st.enemyDecksOut, 0);
  assert.equal(st.appraisal, "CONTESTED", "one reported but intact contact must not create an allied lead");

  // A hit nobody observed is not a claim the crew can make.
  b.damageShip(akagi, 200, { x: akagi.x, y: 0, z: akagi.z }, "bomb", "us", { owner: "player" });
  assert.ok(akagi.deck < 0.35, "the hit really did take the deck out");
  st = b.battleStatus();
  assert.equal(st.enemyDecksOut, 0, "unseen enemy deck damage must never be claimed");
  assert.notEqual(st.appraisal, "ALLIES LEADING", "unseen damage cannot move the appraisal");

  // A later dated observation of the wrecked deck confirms it.
  b.recordContact(akagi);
  st = b.battleStatus();
  assert.equal(st.enemyDecksOut, 1, "an observation after the impact confirms the deck out");
  assert.equal(st.appraisal, "ALLIES LEADING", "a confirmed enemy deck out leads when no friendly deck is out");

  // A fresh observation of a repaired deck clears the claim.
  akagi.deck = 1;
  b.recordContact(akagi);
  st = b.battleStatus();
  assert.equal(st.enemyDecksOut, 0, "a fresh observation of a repaired deck clears the claim");
  assert.notEqual(st.appraisal, "ALLIES LEADING", "the appraisal follows the cleared claim");

  // An unreported hull's state does not exist to the crew at all.
  const kaga = b.ships.find((s) => s.name === "Kaga");
  kaga.deck = 0;
  kaga.sunk = true;
  assert.equal(b.battleStatus().enemyReported, 1, "an unreported hull never appears");
  assert.equal(b.battleStatus().enemyDecksOut, 0);

  // Friendly losses stand on their own: a deck out of action against no confirmed enemy loss.
  const usc = usCarriers(b);
  usc[1].sunk = true;
  st = b.battleStatus();
  assert.equal(st.friendlyOperational, 2);
  assert.equal(st.appraisal, "ENEMY LEADING", "a friendly deck out of action with no confirmed enemy loss reads adverse");

  // Confirming one enemy deck out equalises confirmed attrition: contested, not an allied lead.
  b.damageShip(akagi, 200, { x: akagi.x, y: 0, z: akagi.z }, "bomb", "us", { owner: "player" });
  b.recordContact(akagi);
  st = b.battleStatus();
  assert.equal(st.enemyDecksOut, 1);
  assert.equal(st.appraisal, "CONTESTED", "one confirmed enemy loss against one friendly loss is contested");

  // A second friendly loss with no second confirmed kill tips it adverse again.
  usc[2].sunk = true;
  assert.equal(b.battleStatus().appraisal, "ENEMY LEADING", "confirmed attrition still governs the label");
}

// ---------------------------------------------------------------------------------------------
// 6 — Losing one aircraft on any surface path is one replaceable loss, not the battle's end.
// ---------------------------------------------------------------------------------------------
{
  // Ditching in the sea: the fleet keeps fighting and another aircraft can be spotted.
  {
    const b = airborne();
    b.player.mode = "flight";
    b.player.y = 0.5;
    b.player.takeoffGrace = 0;
    const before = b.stats.playerLosses;
    b.step(1 / 60);
    assert.equal(b.status, "playing", "ditching with decks afloat must not end the battle");
    assert.equal(b.player.mode, "downed", "a ditching is a replaceable aircraft loss");
    assert.equal(b.player.hp, 0, "the lost aircraft cannot remain a live target");
    assert.equal(b.player.engineCut, true, "the lost aircraft's engine is off");
    assert.equal(b.player.throttle, 0, "the lost aircraft has no throttle");
    assert.equal(b.stats.playerLosses, before + 1, "the ditching counts the player's loss exactly once");
  }

  // An aircraft destroyed on a deck that goes under: downed, then replaced from a surviving deck.
  {
    const b = airborne();
    b.player.mode = "deck";
    const doomed = b.ships.find((s) => s.id === b.player.home);
    doomed.sunk = true;
    doomed.hp = 0;
    doomed.deck = 0;
    b.step(1 / 60);
    assert.equal(b.status, "playing", "losing one deck does not end the battle");
    assert.equal(b.player.mode, "downed", "an aircraft lost on a wrecked deck is replaceable");
    assert.equal(b.stats.playerLosses, 1, "the deck loss counts the player's aircraft once");
    assert.equal(b.takeAnotherAircraft(), true, "a surviving alternate deck spots another aircraft");
    assert.notEqual(b.player.home, doomed.id, "the replacement comes from a surviving deck");
  }

  // Lethal damage while aboard: the carrier is lost under the pilot, not the battle.
  {
    const b = airborne();
    b.player.mode = "service";
    const home = b.ships.find((s) => s.id === b.player.home);
    home.sunk = true;
    home.hp = 0;
    home.deck = 0;
    b.step(1 / 60);
    assert.equal(b.status, "playing", "a carrier lost during recovery does not end the battle");
    assert.equal(b.player.mode, "downed", "the aircraft aboard a lost carrier is a replaceable loss");
    assert.equal(b.takeAnotherAircraft(), true, "a surviving deck spots the replacement");
  }

  // Genuine defeat stays terminal: the same loss with no friendly deck left ends the battle.
  {
    const b = airborne();
    b.player.mode = "flight";
    b.player.y = 0.5;
    b.player.takeoffGrace = 0;
    for (const s of usCarriers(b)) {
      s.sunk = true;
      s.hp = 0;
      s.deck = 0;
    }
    b.step(1 / 60);
    assert.equal(b.status, "lost", "no friendly carrier left is a defeat, not a replacement");
  }
}

// ---------------------------------------------------------------------------------------------
// 7 — A watched sinking is a confirmed enemy loss even with its deck intact; a hidden one is not.
// ---------------------------------------------------------------------------------------------
{
  const b = new Battle(19420604);
  b.selectAssignment("strike");
  b.start(false);
  const akagi = b.ships.find((s) => s.name === "Akagi");

  // In sight: the crew files the contact, but an intact deck is not a loss.
  b.player.mode = "flight";
  b.player.y = 1000;
  b.player.x = akagi.x;
  b.player.z = akagi.z;
  b.player.heading = akagi.heading;
  b.updateIntel();
  assert.ok(b.contacts.has(akagi.id), "a carrier in sight is recorded");
  assert.equal(b.battleStatus().enemyDecksOut, 0, "an observed but intact deck is not a loss");

  // A torpedo nobody watched sinks it; the crew out of visual range cannot claim the sinking.
  akagi.hp = 1;
  b.player.x = akagi.x + 20000;
  b.damageShip(akagi, 2, { x: akagi.x, y: 0, z: akagi.z }, "torpedo", "us", { owner: "player" });
  assert.equal(akagi.sunk, true, "the torpedo sank the carrier");
  assert.ok(akagi.deck >= 0.35, "its deck was still fit to launch when it went under");
  b.updateIntel();
  assert.equal(b.battleStatus().enemyDecksOut, 0, "a sinking nobody watched is never a claim");

  // A visible sinking can be identified even if this is the observer's first report of the hull.
  b.contacts.delete(akagi.id);
  b.player.x = akagi.x;
  b.player.z = akagi.z;
  b.updateIntel();
  assert.equal(b.battleStatus().enemyDecksOut, 1, "a witnessed sinking counts even with an intact deck");
  b.time += 400;
  const st = b.battleStatus();
  assert.equal(st.enemyDecksOut, 1, "a confirmed sinking persists after the contact ages");
  assert.equal(st.appraisal, "ALLIES LEADING", "the confirmed loss governs the appraisal");

  // The disabled-but-afloat case still clears: a fresh observation of a repaired deck is not a loss.
  const kaga = b.ships.find((s) => s.name === "Kaga");
  kaga.deck = 0;
  b.recordContact(kaga);
  assert.equal(b.battleStatus().enemyDecksOut, 2, "a disabled afloat deck adds its own confirmed loss");
  kaga.deck = 1;
  b.recordContact(kaga);
  assert.equal(b.battleStatus().enemyDecksOut, 1, "repairing the deck clears its claim; the sinking stands");

  // Arriving after the hull has disappeared cannot reveal an otherwise unseen sinking.
  kaga.sunk = true;
  kaga.sink = 1;
  b.player.x = kaga.x;
  b.player.z = kaga.z;
  b.updateIntel();
  assert.equal(b.contacts.get(kaga.id).sunk, false, "a fully submerged wreck cannot be sighted");
  assert.equal(b.battleStatus().enemyDecksOut, 1, "an unseen sinking still adds no claim");
}

console.log("check-battle-continuation: downed, replacement economy and map appraisal PASS");
