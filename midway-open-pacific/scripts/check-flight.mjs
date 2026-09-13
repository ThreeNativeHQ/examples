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
const deck = new Battle(); deck.home.length = 220; deck.home.width = 20; deck.start();
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
  const launch = new Battle(); launch.home.length = 220; launch.home.width = 20; launch.selectLoadout(loadout); launch.start();
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
  b.bombs.push({ id: b.id('bomb'), x: s.x, y: 21, z: s.z, vx: 0, vy: -120, vz: 0, team, owner, age: 0, damage });
  b.updateWeapons(1 / 60);
};
const bombNear = (b, s, owner, team = 'us') => {
  b.bombs.push({ id: b.id('bomb'), x: s.x + s.width / 2 + 20, y: 1, z: s.z, vx: 0, vy: -120, vz: 0, team, owner, age: 0, damage: 155 });
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
assert.ok(hiryu.impacts.every((m) => Math.abs(m.forward) < hiryu.length && Math.abs(m.right) < hiryu.width * 4), 'impacts are stored in the ship frame');
assert.ok(hiryu.impacts.every((m) => m.owner === 'player' && m.weapon === 'bomb' && m.nearMiss === false), 'impact records carry their attribution');

console.log(JSON.stringify({ sortieRealismE1: true, bombSequence, score: credit.score, stats: credit.stats }));
