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
