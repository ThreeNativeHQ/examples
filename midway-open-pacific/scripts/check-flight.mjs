import assert from 'node:assert/strict';
import { build } from 'esbuild';
const { outputFiles } = await build({ entryPoints: ['src/sim/battle.ts'], bundle: true, platform: 'node', format: 'esm', write: false });
const { Battle } = await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`);
const airborne = () => { const b = new Battle(); b.start(true); return b; };
const tick = (b, seconds, input = {}) => { for (let i = 0; i < seconds * 60; i++) b.step(1 / 60, input); };
const b = airborne();
b.player.stall = .4;
b.player.aoa = .31;
let commanded;
const step = b.playerFlight.step.bind(b.playerFlight);
b.playerFlight.step = (dt, controls) => { commanded = controls.pitch; step(dt, controls); };
tick(b, 1 / 60);
assert.equal(commanded, 0, 'stall limiter must not push a neutral stick');
b.player.stall = 0; b.player.ias = 43;
tick(b, 1 / 60, { pitch: 1 });
assert.ok(commanded >= .44, 'rotation must retain low-speed pitch authority');
const overrun = new Battle(); overrun.start();
overrun.playerFlight.stepDeck = () => 'overrun';
tick(overrun, 1 / 60);
assert.equal(overrun.player.launchAssist, 9, 'bow departure also receives launch assist');
b.player.launchAssist = 9;
tick(b, 1 / 60, { pitch: .2 });
assert.ok(b.player.launchAssist > 8, 'a momentary pull must not permanently cancel launch assist');
const manual = airborne();
manual.player.gear = true; manual.player.autoGearPending = true;
manual.toggleGear(); manual.toggleGear();
tick(manual, 2);
assert.equal(manual.player.gear, true, 'manual override also cancels a pending automatic retraction');
const cruise = airborne();
tick(cruise, 1, { pitch: 1 });
tick(cruise, 30);
assert.ok(Math.abs(cruise.player.vy) < 3 && cruise.player.stall < .1, 'released cruise stick settles without stalling');
const deck = new Battle(); deck.start();
for (let i = 0; i < 3000 && deck.player.mode === 'deck'; i++) tick(deck, 1 / 60, { throttleUp: true });
assert.equal(deck.player.mode, 'flight', 'must leave deck');
assert.equal(deck.player.gear, true, 'gear stays down until clear and climbing');
tick(deck, .3, { pitch: .2 });
assert.ok(deck.player.launchAssist > 0, 'launch assist survives rotation input');
tick(deck, 20, { throttleUp: true });
assert.equal(deck.status, 'playing', 'neutral climb-out survives');
assert.equal(deck.player.gear, false, 'safe positive climb automatically retracts gear');
const climbAltitude = deck.player.y;
const climbVy = deck.player.vy;
assert.ok(climbVy > -.5, 'released climb-out must not enter a sustained descent');
deck.toggleGear();
assert.equal(deck.player.gear, true);
tick(deck, 8, { throttleUp: true });
assert.equal(deck.player.gear, true, 'manual G overrides automatic retraction');
deck.player.mode = 'service'; deck.player.serviceTime = 0;
tick(deck, 1 / 60);
assert.equal(deck.player.gearManual, false, 'new sortie resets manual override');

for (const loadout of ["bomb", "torpedo"]) for (const manoeuvre of [false, true]) {
  const launch = new Battle(); launch.selectLoadout(loadout); launch.start();
  let departedAt = null, maxRoll = 0, maxRollRate = 0, minAltitude = Infinity;
  for (let i = 0; i < 3600; i++) {
    const elapsed = departedAt === null ? 0 : i / 60 - departedAt;
    const input = { throttleUp: true };
    if (manoeuvre && elapsed > 3 && elapsed < 3.5) Object.assign(input, { turn: 1, pitch: .2 });
    if (manoeuvre && elapsed > 4 && elapsed < 4.5) input.turn = -1;
    tick(launch, 1 / 60, input);
    if (launch.player.mode === 'flight' && departedAt === null) departedAt = i / 60;
    if (departedAt !== null) {
      maxRoll = Math.max(maxRoll, Math.abs(launch.player.roll));
      maxRollRate = Math.max(maxRollRate, Math.abs(launch.player.rollRate));
      minAltitude = Math.min(minAltitude, launch.player.y);
    }
  }
  assert.notEqual(departedAt, null);
  assert.equal(launch.status, 'playing');
  assert.ok(minAltitude > 20, 'shorter deck run must clear the bow safely');
  assert.ok(Math.abs(launch.player.roll) < .01 && Math.abs(launch.player.rollRate) < .01, 'released controls must not retain bank or roll rate');
  assert.ok(maxRoll < (manoeuvre ? .2 : .01), 'climb-out must avoid unexpected wing rocking');
  console.log(JSON.stringify({ loadout, manoeuvre, departedAt, maxRoll, maxRollRate, minAltitude, finalAltitude: launch.player.y }));
}

console.log(JSON.stringify({ pass: true, cruiseVy: cruise.player.vy, cruiseStall: cruise.player.stall, climbAltitude, climbVy }));

// ---- PRD-midway-sortie-realism E1: honest stores, honest credit, one launch rule ----
const bombOn = (b, s, owner, team = 'us', damage = 155) => {
  // One metre over the hit plane, which is this ship's own deck: Kaga's is 23.47 m, not 20.
  b.bombs.push({ id: b.id('bomb'), x: s.x, y: s.deckHeight + 1, z: s.z, vx: 0, vy: -120, vz: 0, team, owner, age: 0, damage });
  b.updateWeapons(1 / 60);
};
const bombNear = (b, s, owner, team = 'us') => {
  b.bombs.push({ id: b.id('bomb'), x: s.x + s.hullBeam / 2 + 20, y: 1, z: s.z, vx: 0, vy: -120, vz: 0, team, owner, age: 0, damage: 155 });
  b.updateWeapons(1 / 60);
};

// AC-1 — a released weapon leaves the racks and the flight model sees it go.
const stores = airborne();
assert.deepEqual([stores.player.payloadMass, stores.player.payloadDrag], [544, 0.003], 'loaded SBD carries its full rack');
const bombSequence = [stores.player.payloadMass];
for (let i = 0; i < 3; i++) { assert.equal(stores.releaseOrdnance(), true); bombSequence.push(stores.player.payloadMass); }
assert.deepEqual(bombSequence, [544, 90, 45, 0], 'bomb payload follows the stores actually left');
assert.equal(stores.player.payloadDrag, 0, 'an empty rack carries no drag');
assert.equal(stores.releaseOrdnance(), false, 'an empty rack rejects the release');
assert.equal(stores.player.payloadMass, 0, 'a rejected release changes nothing');
const torp = new Battle(); torp.selectLoadout('torpedo'); torp.start(true);
assert.equal(torp.player.payloadMass, 1000, 'loaded TBD carries its Mark 13');
assert.equal(torp.releaseOrdnance(), true);
assert.deepEqual([torp.player.payloadMass, torp.player.payloadDrag], [0, 0], 'torpedo payload leaves with the weapon');
stores.player.mode = 'service'; stores.player.serviceTime = 0; tick(stores, 1 / 60);
assert.equal(stores.player.payloadMass, 544, 'service restores the selected loadout and its weight');

// AC-2 — credit follows the weapon's actual owner, not its team.
const credit = airborne();
const akagi = credit.ships.find((s) => s.name === 'Akagi');
bombOn(credit, akagi, 'allied-ai', 'us', 20);
assert.deepEqual([credit.score, credit.stats.shipHits], [0, 0], 'an allied AI hit never becomes a personal hit');
assert.ok(akagi.hp < akagi.maxHp, 'the allied hit still damages the ship');
const wingman = credit.launch(credit.home, 'bomber');
bombOn(credit, akagi, wingman.id, 'us', 20);
assert.deepEqual([credit.score, credit.stats.shipHits, credit.stats.wingShipHits], [0, 0, 1], 'an ordered wing hit is a wing contribution, not a personal one');
bombOn(credit, akagi, 'player', 'us', 20);
assert.deepEqual([credit.score, credit.stats.shipHits], [250, 1], 'the player is credited for the player\'s own bomb');
bombNear(credit, akagi, 'player');
assert.deepEqual([credit.stats.shipHits, credit.stats.nearMisses], [1, 1], 'a near miss is labelled a near miss');
const friendly = airborne();
const hornet = friendly.ships.find((s) => s.name === 'USS Hornet');
bombOn(friendly, hornet, 'player', 'us', 20);
assert.deepEqual([friendly.score, friendly.stats.shipHits, friendly.stats.friendlyHits], [0, 0, 1], 'friendly damage earns no positive credit');
const burn = airborne();
const kaga = burn.ships.find((s) => s.name === 'Kaga');
kaga.hp = 40; kaga.fire = 0;
bombOn(burn, kaga, 'player', 'us', 20);
const afterHit = { score: burn.score, hits: burn.stats.shipHits, sunk: burn.stats.shipsSunk };
kaga.hp = 0.05; kaga.fire = 1;
tick(burn, 1);
assert.equal(kaga.sunk, true, 'a fire finishes a gutted ship');
assert.equal(burn.stats.shipHits, afterHit.hits, 'a fire death invents no new weapon hit');
assert.equal(burn.stats.shipsSunk, afterHit.sunk + 1, 'the last effective attacker is credited with the sinking');
tick(burn, 2);
assert.equal(burn.stats.shipsSunk, afterHit.sunk + 1, 'sinking credit is awarded exactly once');

// AC-3 — one launch rule, and a disabled deck is not a sinking.
const decks = new Battle();
const soryu = decks.ships.find((s) => s.name === 'Soryu');
soryu.deck = 0.35;
assert.ok(decks.operationalEnemyCarriers.includes(soryu), 'a deck at the launch threshold still counts as operational');
assert.notEqual(decks.launch(soryu, 'fighter'), null, 'and it can actually launch');
soryu.deck = 0.3499;
assert.ok(!decks.operationalEnemyCarriers.includes(soryu), 'just below the threshold it is no longer operational');
assert.equal(decks.launch(soryu, 'fighter'), null, 'and it can no longer launch');
assert.equal(soryu.sunk, false, 'being unable to launch is not sinking');

// AC-12 foundation — impacts are recorded in the ship's own frame, and bounded.
const marks = airborne();
const hiryu = marks.ships.find((s) => s.name === 'Hiryu');
for (let i = 0; i < 12; i++) bombOn(marks, hiryu, 'player', 'us', 5);
assert.equal(hiryu.impacts.length, 8, 'impact records stay bounded');
assert.ok(hiryu.impacts.every((m) => Math.abs(m.forward) < hiryu.hullLength && Math.abs(m.right) < hiryu.hullBeam * 4), 'impacts are stored in the ship frame');
assert.ok(hiryu.impacts.every((m) => m.owner === 'player' && m.weapon === 'bomb' && m.nearMiss === false), 'impact records carry their attribution');

console.log(JSON.stringify({ sortieRealismE1: true, bombSequence, score: credit.score, stats: credit.stats }));

// ---- E1: assignments, objective credit and distinct short-sortie results (AC-4/5/11) ----
const onTarget = (b, ship) => {
  const w = b.bombs[b.bombs.length - 1];
  Object.assign(w, { x: ship.x, y: ship.deckHeight + 1, z: ship.z, vx: 0, vy: -120, vz: 0 });
  b.updateWeapons(1 / 60);
};
const strikeBattle = () => {
  const b = new Battle();
  assert.equal(b.selectAssignment('strike'), true);
  b.start(true);
  const akagi = b.ships.find((s) => s.name === 'Akagi');
  b.recordContact(akagi);
  b.updateSortie();
  return [b, akagi];
};

// AC-4 — the briefing choice decides the assignment, and an escort report is not a carrier report.
assert.equal(new Battle().selectAssignment('nonsense'), false, 'only the three assignments exist');
const started = new Battle(); started.start(true);
assert.equal(started.selectAssignment('recon'), false, 'the assignment is a briefing choice, not a mid-flight one');
assert.ok(started.sortie.startTime >= 29, 'the airborne warm-up is excluded from the sortie clock');
const recon = new Battle(); recon.selectAssignment('recon'); recon.start(true);
const arashi = recon.ships.find((s) => s.name === 'Arashi');
recon.recordContact(arashi); recon.report();
assert.equal(recon.sortie.objective, 'pending', 'an escort-only report does not satisfy the recon assignment');
const soryuContact = recon.ships.find((s) => s.name === 'Soryu');
recon.recordContact(soryuContact);
recon.contacts.get(soryuContact.id).time = recon.time - 30;
assert.equal(recon.report(), 0, 'a stale sighting is not a fresh report');
assert.equal(recon.sortie.objective, 'pending', 'and it does not complete the assignment');
recon.recordContact(soryuContact); recon.report();
assert.equal(recon.sortie.objective, 'achieved', 'a fresh transmitted carrier contact completes the recon assignment');
assert.equal(recon.sortie.reportedCarriers, 1);

// AC-5 — objective credit follows the stamp taken at release.
const [own, ownTarget] = strikeBattle();
assert.equal(own.sortie.target, ownTarget.id, 'the designated contact becomes the sortie target');
own.releaseOrdnance(); onTarget(own, ownTarget);
assert.equal(own.sortie.objective, 'achieved', 'an observed player hit on the designated carrier completes the strike');
assert.deepEqual([own.sortie.personalHits, own.sortie.wingHits], [1, 0]);

const [ally, allyTarget] = strikeBattle();
ally.bombs.push({ id: ally.id('bomb'), x: 0, y: 0, z: 0, team: 'us', owner: 'allied-ai', age: 0, damage: 155, stamp: null });
onTarget(ally, allyTarget);
assert.equal(ally.sortie.objective, 'pending', 'unrelated allied fire never advances the assignment');
assert.ok(allyTarget.hp < allyTarget.maxHp, 'though it still damages the ship');

const [recall, recallTarget] = strikeBattle();
recall.releaseOrdnance();
recall.setCommand('rtb'); recall.target = null; recall.sortie.target = null;
onTarget(recall, recallTarget);
assert.equal(recall.sortie.objective, 'achieved', 'a recall after release cannot revoke the weapon\'s eligibility');

const [wing, wingTarget] = strikeBattle();
wing.setCommand('strike');
const attacker = wing.launch(wing.home, 'bomber');
attacker.mode = 'flight';
assert.equal(wing.dropBomb(attacker), true);
onTarget(wing, wingTarget);
assert.deepEqual([wing.sortie.objective, wing.sortie.wingHits, wing.sortie.personalHits], ['achieved', 1, 0], 'an ordered wing hit is a wing contribution that still completes the strike');

const [blind, blindTarget] = strikeBattle();
blind.releaseOrdnance();
blind.contacts.get(blindTarget.id).time = blind.time - 40;
onTarget(blind, blindTarget);
assert.equal(blind.sortie.objective, 'pending', 'an unobserved hit waits for confirmation');
assert.equal(blind.sortie.pending.length, 1);
blind.recordContact(blindTarget); blind.updateSortie();
assert.equal(blind.sortie.objective, 'achieved', 'a later fresh report confirms the recorded hit');

const [lostTarget, doomed] = strikeBattle();
doomed.lastHostileHit = { owner: 'allied-ai', team: 'us', weapon: 'bomb', time: 0 };
lostTarget.sinkShip(doomed);
lostTarget.updateSortie();
assert.equal(lostTarget.sortie.target, null, 'a target sunk by others is released, not silently credited');
assert.equal(lostTarget.sortie.objective, 'pending', 'and the assignment is not awarded');
for (const s of lostTarget.ships.filter((s) => s.team === 'jp' && s.kind === 'carrier')) s.sunk = true;
lostTarget.updateSortie();
assert.equal(lostTarget.sortie.objective, 'unavailable', 'with no eligible target the assignment is explicitly unavailable');

// AC-11 — three distinct short-sortie outcomes, frozen before the deck crew resets anything.
const landed = (objective) => {
  const [b, t] = strikeBattle();
  if (objective) { b.releaseOrdnance(); onTarget(b, t); }
  Object.assign(b.player, { fuel: 37, hp: 61 });
  b.recover(b.home);
  return b;
};
const winRun = landed(true);
assert.equal(winRun.status, 'debrief', 'a short sortie ends in its own debrief state, not operation victory');
assert.equal(winRun.sortie.result.outcome, 'recovered');
assert.equal(winRun.sortie.result.objective, true);
assert.deepEqual([winRun.sortie.result.fuel, winRun.sortie.result.hp], [37, 61], 'arrival fuel and damage are captured before repair');
assert.equal(winRun.player.fuel, 37, 'and the repair reset never runs for a short sortie');
const shortRun = landed(false);
assert.equal(shortRun.sortie.result.outcome, 'incomplete', 'a safe return without the assignment is incomplete, not a win');
assert.equal(shortRun.status, 'debrief');
const deadRun = strikeBattle()[0];
deadRun.lose('Aircraft lost to battle damage.');
assert.equal(deadRun.status, 'lost');
assert.equal(deadRun.sortie.result.outcome, 'lost', 'death is terminal and distinct');
const operation = new Battle(); operation.selectAssignment('operation'); operation.start(true);
operation.recover(operation.home);
assert.equal(operation.status, 'playing', 'Open Pacific still rearms and keeps its full operation objective');
assert.equal(operation.player.mode, 'service');
assert.equal(operation.sortie.result, null);

console.log(JSON.stringify({ sortieRealismE1b: true, recon: recon.sortie.objective, strikeResult: winRun.sortie.result }));

// ---- E1: approach guidance, diversion and the return reserve (AC-8/9/10) ----
const ahead = (s) => ({ x: Math.sin(s.heading), z: -Math.cos(s.heading) });
const placeFinal = (b, s, over = {}) => {
  const f = ahead(s);
  Object.assign(b.player, {
    mode: 'flight', gear: true, gearPos: 1, home: s.id, nav: 'home', landingAssist: null,
    x: s.x - f.x * 400, y: 60, z: s.z - f.z * 400,
    heading: s.heading, roll: 0, speed: 55, vx: f.x * 55, vy: -2, vz: f.z * 55,
    ...over,
  });
};

// AC-8 — H routes through a setup point in the moving carrier's frame, not at its centre.
const home = airborne();
const deckShip = home.goHome();
assert.ok(deckShip, 'H finds a live friendly deck');
assert.equal(home.player.nav, 'home');
const navPoint = home.navigationPoint;
const carrier = home.recoveryCarrier;
const fv = ahead(carrier);
assert.ok(Math.hypot(navPoint.x - (carrier.x - fv.x * 1600), navPoint.z - (carrier.z - fv.z * 1600)) < 1e-6, 'the return course aims at the astern setup point');
assert.ok(Math.hypot(navPoint.x - carrier.x, navPoint.z - carrier.z) > 1500, 'and not at the deck itself');

const divert = airborne();
divert.goHome();
const firstDeck = divert.ships.find((s) => s.id === divert.player.home);
firstDeck.deck = 0.1;
divert.updateRecovery();
assert.notEqual(divert.player.home, firstDeck.id, 'a deck lost in transit diverts the aircraft');
assert.ok(divert.recoveryCarrier && divert.recoveryCarrier.deck > 0.25, 'to a deck that can actually take it');
for (const s of divert.ships.filter((s) => s.team === 'us' && s.kind === 'carrier')) s.deck = 0.05;
Object.assign(divert.player, { divertNotice: false, autopilot: true, landingAssist: 'stale' });
divert.updateRecovery();
assert.equal(divert.player.autopilot, false, 'with no deck left the invalid autopilot target is dropped');
assert.equal(divert.player.landingAssist, null, 'and the final assist is cancelled');
assert.equal(divert.approach().carrier, null);
assert.deepEqual(divert.approach().cues, ['NO AVAILABLE DECK'], 'and the pilot is told the truth once');

// AC-9 — every cue agrees with the gate the game actually enforces.
const final = airborne();
const wire = final.home;
placeFinal(final, wire);
assert.equal(final.approach().ready, true, 'an aligned, slow, gear-down approach is ready');
assert.deepEqual(final.approach().cues, ['READY FOR L']);
assert.equal(final.approach().phase, 'final');
assert.equal(final.assistRecovery(), true, 'and L engages');
assert.equal(final.player.landingAssist, wire.id);
for (const [name, over, cue] of [
  ['too fast', { speed: 95, vx: ahead(wire).x * 95, vz: ahead(wire).z * 95 }, 'TOO FAST'],
  ['high', { y: 260 }, 'HIGH'],
  ['low', { y: 18 }, 'LOW'],
  ['gear up', { gear: false }, 'GEAR NOT DOWN'],
  ['right of centerline', { x: wire.x + 260 }, 'RIGHT OF CENTERLINE'],
  ['left of centerline', { x: wire.x - 260 }, 'LEFT OF CENTERLINE'],
  ['ahead of the deck', { x: wire.x, z: wire.z - 400 }, 'GO AROUND — AHEAD OF THE DECK'],
  ['misaligned', { heading: wire.heading + 0.9 }, 'LINE UP LEFT'],
]) {
  placeFinal(final, wire, over);
  const state = final.approach();
  assert.equal(state.ready, false, `${name} is not ready for L`);
  assert.ok(state.cues.includes(cue), `${name} is reported as ${cue}, got ${state.cues.join(' · ')}`);
  assert.equal(final.assistRecovery(), false, `${name} is refused by the same gate that reported it`);
}
placeFinal(final, wire);
final.assistRecovery();
tick(final, 0.2, { turn: 1 });
assert.equal(final.player.landingAssist, null, 'manual steering cancels the assisted final');
assert.equal(final.player.autopilot, false);

// A missed deck still needs a wave-off when the aircraft is low and alongside the bow.
const bolter = airborne();
const bolterDeck = bolter.home;
placeFinal(bolter, bolterDeck, {
  x: bolterDeck.x + 30, z: bolterDeck.z - bolterDeck.deckLength / 2 - 5,
  y: bolterDeck.deckHeight + 2, autopilot: true, landingAssist: bolterDeck.id,
});
bolter.playerFlight.reset();
tick(bolter, 1 / 60);
assert.equal(bolter.player.landingAssist, null, 'a low miss must leave assisted descent immediately');
tick(bolter, 15);
assert.equal(bolter.status, 'playing', `wave-off stays airborne: ${bolter.reason}`);
assert.ok(bolter.player.y > bolterDeck.deckHeight + 10, 'wave-off climbs clear of the deck');

// AC-10 — the reserve is an observed estimate, never a promise.
const reserve = airborne();
assert.equal(reserve.returnReserve().available, false, 'without a burn sample there is no estimate');
reserve.goHome();
tick(reserve, 12);
const base = reserve.returnReserve();
assert.equal(base.available, true, 'observed burn and ground speed produce an estimate');
assert.ok(Number.isFinite(base.have) && Number.isFinite(base.needed) && Number.isFinite(base.spare), 'never infinite');
assert.ok(base.needed > 120, 'the 120-second manoeuvre reserve is included');
const fuelBefore = reserve.player.fuel;
reserve.player.burnRate *= 3;
const leaking = reserve.returnReserve();
assert.ok(leaking.spare < base.spare, 'a heavier observed burn reduces the margin');
assert.equal(reserve.player.fuel, fuelBefore, 'and the estimate never adds fuel');
reserve.player.burnRate /= 3;
reserve.player.z -= 14000;
const diverted = reserve.returnReserve();
assert.ok(diverted.needed > base.needed && diverted.spare < base.spare, 'a longer diversion costs margin');
for (const bad of [0, -1, Infinity, NaN]) {
  reserve.player.burnRate = bad;
  assert.equal(reserve.returnReserve().available, false, `a ${bad} burn rate yields no estimate`);
}
reserve.player.burnRate = base.have > 0 ? reserve.player.fuel / base.have : 0.02;
Object.assign(reserve.player, { vx: 0, vz: 0 });
assert.equal(reserve.returnReserve().available, false, 'a stationary sample yields no estimate either');

console.log(JSON.stringify({ sortieRealismE1c: true, reserve: base, wing: final.wingStatus() }));

// ---- E1: the guided return actually gets home (AC-8/9, deterministic) ----
// The return leg is started from a fixed point astern of the task force, and kept short: with no
// player input at all the emergent battle kills the aircraft in about 75 seconds and eventually the
// task force too, which is a property of the simulation rather than of the guidance. The unforced
// end-to-end sorties are proved in the browser instead.
const flyHome = (b, limit = 240) => {
  const start = b.time;
  while (b.status === 'playing' && b.time - start < limit) {
    b.step(1 / 60, {});
    if (b.approach().ready) return { ready: true, elapsed: b.time - start };
  }
  const a = b.approach();
  return { ready: false, elapsed: b.time - start, status: b.status, reason: b.reason, y: b.player.y, speed: b.player.speed, phase: a.phase, cues: a.cues };
};
const inbound = (b, metres = 4500) => {
  const s = b.recoveryCarrier;
  const f = { x: Math.sin(s.heading), z: -Math.cos(s.heading) };
  Object.assign(b.player, {
    x: s.x - f.x * metres, y: 900, z: s.z - f.z * metres,
    heading: s.heading, pitch: 0, roll: 0, speed: 100, vx: f.x * 100, vy: 0, vz: f.z * 100,
    autopilot: false, landingAssist: null,
  });
  b.playerFlight.reset();
  b.goHome();
  return s;
};

const homeward = airborne();
inbound(homeward);
const arrival = flyHome(homeward);
assert.equal(homeward.status, 'playing', `the guided return must not fly the aircraft into the sea: ${JSON.stringify(arrival)}`);
assert.ok(arrival.ready, `the guided return reaches the assisted-final envelope: ${JSON.stringify(arrival)}`);
assert.equal(homeward.assistRecovery(), true, 'and the same gate that reported it accepts L');
let guard = 0;
while (homeward.status === 'playing' && guard++ < 60 * 150) homeward.step(1 / 60, {});
assert.equal(homeward.status, 'debrief', `the assisted final completes the sortie: ${JSON.stringify({ status: homeward.status, mode: homeward.player.mode, reason: homeward.reason })}`);
assert.equal(homeward.sortie.result.outcome, 'incomplete', 'a return without the assignment is incomplete, not a win');
assert.ok(homeward.sortie.result.elapsed < 12 * 60, `and it fits inside the pacing target: ${homeward.sortie.result.elapsed}`);

// A scout that actually sights and reports a carrier comes home with its assignment complete.
const scout = new Battle();
scout.selectAssignment('recon');
scout.start(true);
let seen = 0;
while (scout.status === 'playing' && seen++ < 60 * 300 && scout.sortie.objective !== 'achieved') {
  scout.step(1 / 60, {});
  if ([...scout.contacts.values()].some((c) => c.kind === 'carrier' && scout.time - c.time < 3 && !c.reported)) scout.report();
}
assert.equal(scout.sortie.objective, 'achieved', 'a scout flying the search sector finds and reports a carrier');
inbound(scout);
const scoutArrival = flyHome(scout);
assert.ok(scoutArrival.ready, `the scout gets home too: ${JSON.stringify(scoutArrival)}`);
scout.assistRecovery();
let scoutGuard = 0;
while (scout.status === 'playing' && scoutGuard++ < 60 * 150) scout.step(1 / 60, {});
assert.equal(scout.status, 'debrief', 'and recovers');
assert.equal(scout.sortie.result.outcome, 'recovered', JSON.stringify(scout.sortie.result));
assert.equal(scout.sortie.result.objective, true, JSON.stringify(scout.sortie.result));
assert.ok(scout.sortie.result.elapsed < 12 * 60, `within the pacing target: ${scout.sortie.result.elapsed}`);

console.log(JSON.stringify({ sortieRealismE1d: true, strikeReturn: homeward.sortie.result, reconRun: scout.sortie.result }));

// A late return must survive the moving deck too: normal-entry ordered-wing strike, no placement.
const wingRun = new Battle();
wingRun.selectAssignment('strike');
wingRun.start(true);
wingRun.player.autopilot = true; // T: course hold, as in the browser run.
let ordered = false, acceptedFinal = false;
for (let i = 0; i < 720 * 60 && wingRun.status === 'playing'; i++) {
  wingRun.step(1 / 60, {});
  if (!ordered && [...wingRun.contacts.values()].some((c) => c.kind === 'carrier')) {
    assert.ok(wingRun.sortie.target, 'the sighting designates a real carrier');
    wingRun.setCommand('strike');
    wingRun.goHome();
    ordered = true;
  }
  if (!acceptedFinal && wingRun.sortie.objective === 'achieved' && wingRun.approach().ready)
    acceptedFinal = wingRun.assistRecovery();
}
assert.equal(wingRun.sortie.result?.outcome, 'recovered', `late assisted return: ${JSON.stringify({ reason: wingRun.reason, result: wingRun.sortie.result, acceptedFinal })}`);
assert.ok(wingRun.sortie.result.wingHits > 0 && wingRun.sortie.result.personalHits === 0, 'the ordered wing owns the confirmed hit');
assert.ok(wingRun.sortie.result.elapsed <= 720, 'natural strike still fits twelve simulated minutes');
console.log(JSON.stringify({ naturalWingStrike: wingRun.sortie.result }));
