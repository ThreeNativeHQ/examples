// The rear-gun station: guards, AI-pilot handover, one shared firing path, and reset on loss.
//
// Bundles the real Battle (the same pattern as check-flight.mjs) and drives it with keys only —
// no DOM, no renderer. The friendly AI rear gun must keep firing exactly as before; only the
// player's own station changes authority.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import * as T from 'three';

const { outputFiles } = await build({ entryPoints: ['src/sim/battle.ts'], bundle: true, platform: 'node', format: 'esm', write: false });
const battleUrl = `data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`;
const { Battle } = await import(battleUrl);
const armament = await build({ entryPoints: ['src/sim/armament.ts'], bundle: true, platform: 'node', format: 'esm', write: false });
const { rearRoundsFor } = await import(`data:text/javascript;base64,${Buffer.from(armament.outputFiles[0].text).toString('base64')}`);
const airborne = () => { const b = new Battle(); b.start(true); b.aircraft.length = 0; return b; };
const deck = () => { const b = new Battle(); b.start(); return b; };
const tick = (b, seconds, input = {}) => { for (let i = 0; i < Math.round(seconds * 60); i++) b.step(1 / 60, input); };
const forwardOf = (a) => ({ x: Math.sin(a.heading) * Math.cos(a.pitch), y: Math.sin(a.pitch), z: -Math.cos(a.heading) * Math.cos(a.pitch) });
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const enemyAt = (x, y, z) => ({
  id: `jp-${Math.round(x)}-${Math.round(z)}`, team: 'jp', kind: 'fighter', airframe: 'zero',
  home: 'nowhere', x, y, z, heading: 0, pitch: 0, roll: 0, speed: 90, hp: 50, maxHp: 50,
  ammo: 100, fuel: 100, mode: 'flight', age: 0, think: 0, target: null, gunTimer: 0,
  attackCooldown: 0, wing: false, phase: 0, vx: 0, vy: 0, vz: 0,
});
const placeAstern = (p, e, dist) => { const f = forwardOf(p); e.x = p.x - f.x * dist; e.y = p.y - f.y * dist; e.z = p.z - f.z * dist; e.vx = e.vy = e.vz = 0; };

// 1. Guards: no station on the deck, in a single-seat fighter, or in a wreck.
assert.equal(deck().setGunner(true), false, 'no rear station on the deck');
const fighter = airborne();
fighter.player.airframe = 'wildcat';
assert.equal(fighter.setGunner(true), false, 'a single-seat fighter has no rear gun');
const wreck = airborne();
wreck.crashPlayer('check');
assert.equal(wreck.setGunner(true), false, 'no station in a wreck');
const empty = airborne();
empty.player.rearAmmo = 0;
assert.equal(empty.setGunner(true), true, 'an empty gun is still inspectable');
assert.equal(empty.setGunner(false), true, 'Y returns even from an empty station');
assert.equal(empty.player.gunner, false);

// 2. Manning hands the aircraft to its own course-hold autopilot, and gunner inputs never take it back.
const fly = airborne();
fly.player.rearAmmo = 240;
const nav = fly.player.nav;
assert.equal(fly.setGunner(true), true);
assert.equal(fly.player.gunner, true);
assert.equal(fly.player.autopilot, true, 'manning engages course hold');
tick(fly, 4, { turn: 1, pitch: 1, rudder: 1 });
assert.equal(fly.status, 'playing');
assert.equal(fly.player.mode, 'flight');
assert.equal(fly.player.autopilot, true, 'gunner stick input must not disengage the AI pilot');
assert.equal(fly.player.nav, nav, 'the navigation order is preserved');
assert.ok(fly.player.y > 200 && fly.player.stall < 0.2, 'the AI pilot keeps the aircraft flying');

// 3. A manual burst spends rear ammo, leaves forward ammo alone, and leaves aft.
const man = airborne();
man.player.rearAmmo = 240;
man.player.ammo = 1400;
man.player.rearTimer = 0;
man.setGunner(true);
const fwd = forwardOf(man.player);
man.step(1 / 60, { fire: true });
const mine = man.bullets.filter((b) => b.owner === 'player');
assert.equal(mine.length, 1, 'one rear round per pulled trigger');
assert.equal(man.player.rearAmmo, 239, 'the rear gun spends rear ammunition');
assert.equal(man.player.ammo, 1400, 'the forward guns are untouched in the gunner seat');
assert.ok(dot({ x: mine[0].vx, y: mine[0].vy, z: mine[0].vz }, fwd) < 0, 'the round leaves aft, never through the nose');

// 4. While manned, the AI gunner is silent: no autonomous double fire.
const silent = airborne();
silent.player.rearAmmo = 240;
silent.setGunner(true);
const foe = enemyAt(0, 0, 0);
placeAstern(silent.player, foe, 200);
silent.player.rearTimer = 0;
silent.aircraft.push(foe);
tick(silent, 1);
assert.equal(silent.player.rearAmmo, 240, 'the AI gunner must not fire while the player mans the gun');
assert.equal(silent.bullets.filter((b) => b.owner === 'player').length, 0, 'no autonomous player burst');

// 5. Handing back resumes the AI gunner.
const hand = airborne();
hand.player.rearAmmo = 240;
hand.setGunner(true);
tick(hand, 0.5);
hand.setGunner(false);
assert.equal(hand.player.gunner, false);
assert.equal(hand.player.autopilot, false, 'entering from manual returns to manual, course order intact');
const back = enemyAt(0, 0, 0);
placeAstern(hand.player, back, 150);
hand.player.rearTimer = 0;
hand.aircraft.push(back);
const before = hand.player.rearAmmo;
tick(hand, 0.5);
assert.ok(hand.player.rearAmmo < before, 'the AI rear gunner resumes when the pilot returns');

// 6. Friendly AI SBD/TBD keep their functional rear guns.
for (const [airframe, kind] of [['sbd', 'bomber'], ['tbd', 'torpedo']]) {
  const force = airborne();
  const wing = {
    id: `ai-${airframe}`, team: 'us', kind, airframe, home: force.ships[0].id,
    x: 0, y: 1000, z: 0, heading: 0, pitch: 0, roll: 0, speed: 95, hp: 95, maxHp: 95,
    ammo: 350, rearAmmo: 240, rearTimer: 0, mode: 'flight', age: 0, think: 0, target: null,
    gunTimer: 0, attackCooldown: 0, wing: true, phase: 0, vx: 0, vy: 0, vz: 0, fuel: 100, fuelCapacity: 100,
  };
  force.aircraft.push(wing, enemyAt(0, 1000, 200));
  force.updateAircraft(1 / 60);
  assert.equal(wing.rearAmmo, 239, `friendly AI ${airframe.toUpperCase()} rear gun still fires`);
}

// 6b. The AI tail cone and its depression are measured in the airframe's own frame, not world Y: a
// nose-up gunner engages a target dead astern in his own up frame, which the world `dy` test rejects.
const frame = airborne();
const noseUp = {
  id: 'ai-noseup', team: 'us', kind: 'bomber', airframe: 'sbd', home: frame.ships[0].id,
  x: 0, y: 1000, z: 0, heading: 0, pitch: Math.PI / 2, roll: 0, speed: 95, hp: 95, maxHp: 95,
  ammo: 350, rearAmmo: 240, rearTimer: 0, mode: 'flight', age: 0, think: 0, target: null,
  gunTimer: 0, attackCooldown: 0, wing: true, phase: 0, vx: 0, vy: 0, vz: 0, fuel: 100, fuelCapacity: 100,
};
const below = enemyAt(0, 0, 0);
below.x = noseUp.x;
below.y = noseUp.y - 200;
below.z = noseUp.z;
below.vx = below.vy = below.vz = 0;
frame.aircraft.push(noseUp, below);
frame.updateAircraft(1 / 60);
assert.equal(noseUp.rearAmmo, 239, 'the AI rear gun uses the aircraft up frame, not world Y');

// 6c. Rear capacity comes from the gun table, not a 240 constant: the SBD's provisional 1200 and
// the TBD's documented 600, empty on a single-seater, and a burst drains the seeded count.
const seeded = airborne();
assert.equal(rearRoundsFor('sbd'), 1200, 'the SBD rear capacity is the provisional 1200');
assert.equal(rearRoundsFor('tbd'), 600, 'the TBD rear capacity is the documented 600');
assert.equal(rearRoundsFor('zero'), 0, 'a single-seat fighter has no rear capacity');
assert.equal(seeded.player.rearAmmo, rearRoundsFor('sbd'), 'the player rear gun is seeded from the gun table');
seeded.player.rearTimer = 0;
seeded.setGunner(true);
seeded.step(1 / 60, { fire: true });
assert.equal(seeded.player.rearAmmo, rearRoundsFor('sbd') - 1, 'a burst drains the seeded rear capacity');

// 7. The station is left on a crash, a touchdown and a recovery.
const crashed = airborne();
crashed.setGunner(true);
crashed.crashPlayer('check');
assert.equal(crashed.player.gunner, false, 'a crash leaves the gun');
const landed = airborne();
landed.setGunner(true);
landed.touchdown(landed.ships[0]);
assert.equal(landed.player.gunner, false, 'touchdown leaves the gun');
const recovered = airborne();
recovered.setGunner(true);
recovered.recover(recovered.ships.find((s) => s.team === 'us' && s.kind === 'carrier'));
assert.equal(recovered.player.gunner, false, 'recovery leaves the gun');

// 8. Aim is clamped to the AI gunner's own tail cone, and the cone closes as the gun is raised.
const CONE = Math.acos(0.6);
const aimClamp = airborne();
aimClamp.setGunner(true);
aimClamp.aimRear(10, 0);
assert.ok(Math.abs(aimClamp.player.gunnerYaw - CONE) < 1e-9, 'yaw clamps to the shared tail cone at level pitch');
assert.ok(dot(aimClamp.gunnerAim(), forwardOf(aimClamp.player)) < -0.6 + 1e-9, 'the clamped gun still points inside the rear cone');
aimClamp.aimRear(0, 10);
assert.ok(Math.abs(aimClamp.player.gunnerPitch - CONE) < 1e-9, 'pitch tops out at the cone edge');
assert.ok(Math.abs(aimClamp.player.gunnerYaw) < 1e-9, 'a fully raised gun has no yaw left inside the cone');
const aimDown = airborne();
aimDown.setGunner(true);
aimDown.aimRear(0, -10);
assert.ok(Math.abs(aimDown.player.gunnerPitch - Math.asin(-0.13)) < 1e-9, 'the depression limit is the AI gunner\'s');

// 9. The trigger cooldown advances while the trigger is released, so a later tap fires at once.
const cadence = airborne();
cadence.player.rearAmmo = 240;
cadence.setGunner(true);
cadence.step(1 / 60, { fire: true });
assert.equal(cadence.player.rearAmmo, 239, 'the first tap fires');
tick(cadence, 0.2);
cadence.step(1 / 60, { fire: true });
assert.equal(cadence.player.rearAmmo, 238, 'a one-tick tap fires after the cooldown expired while released');

// 10. The muzzle rides the airframe's real attitude and a real round damages a target dead astern.
const rear = airborne();
rear.player.rearAmmo = 240;
rear.player.ammo = 1400;
tick(rear, 1.5, { turn: 1 });
assert.ok(Math.abs(rear.player.roll) > 0.3, 'the firing aircraft is actually banked');
rear.setGunner(true);
rear.step(1 / 60, { fire: true });
const round = rear.bullets.find((b) => b.owner === 'player');
assert.ok(round, 'a banked rear gunner still fires');
const q = rear.player.attitude;
const ua = { x: 2 * (q.x * q.y - q.z * q.w), y: 1 - 2 * (q.x * q.x + q.z * q.z), z: 2 * (q.y * q.z + q.x * q.w) };
const fa = { x: -2 * (q.x * q.z + q.y * q.w), y: -2 * (q.y * q.z - q.x * q.w), z: -(1 - 2 * (q.x * q.x + q.y * q.y)) };
const expected = { x: rear.player.x + ua.x - fa.x * 0.8, y: rear.player.y + ua.y - fa.y * 0.8, z: rear.player.z + ua.z - fa.z * 0.8 };
const ox = round.x - round.vx / 60;
const oy = round.y - round.vy / 60;
const oz = round.z - round.vz / 60;
assert.ok(Math.hypot(ox - expected.x, oy - expected.y, oz - expected.z) < 1e-9, 'the muzzle is the local gun transformed by real attitude');
const n = Math.hypot(round.vx, round.vy, round.vz);
const behind = enemyAt(round.x + (round.vx / n) * 50, round.y + (round.vy / n) * 50, round.z + (round.vz / n) * 50);
rear.aircraft.push(behind);
const hp = behind.hp;
for (let i = 0; i < 40 && behind.hp >= hp; i += 1) rear.step(1 / 60, {});
assert.ok(behind.hp < hp, 'a real rear-gun round damaged the target, not just the ammo counter');

// 11. The visual pivot's Euler mapping agrees with the sim aim, so the sight and barrel cannot drift.
const pivot = airborne();
pivot.setGunner(true);
pivot.player.attitude = undefined;
pivot.player.heading = 0;
pivot.player.pitch = 0;
pivot.player.gunnerYaw = 0.4;
pivot.player.gunnerPitch = 0.3;
const e = pivot.rearGunPivotEuler();
const spun = new T.Vector3(0, 0, 1).applyEuler(new T.Euler(e.x, e.y, e.z, 'YXZ'));
const dir = pivot.gunnerAim();
assert.ok(
  Math.abs(spun.x - dir.x) < 1e-9 && Math.abs(spun.y - dir.y) < 1e-9 && Math.abs(spun.z - dir.z) < 1e-9,
  'the pivot Euler and the sim aim disagree',
);

console.log(JSON.stringify({ pass: true, forwardAmmo: man.player.ammo, rearAmmo: silent.player.rearAmmo }));
process.exit(0);
