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
const { rearRoundsFor, initRearState } = await import(`data:text/javascript;base64,${Buffer.from(armament.outputFiles[0].text).toString('base64')}`);
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

// 6d. Non-Douglas rear-armed types keep the generic muzzle: the Kate's single Type 92 and a Val's
// defensive gun still fire at a target dead astern, even though neither carries the Douglas mount.
for (const [airframe, kind, rear] of [['kate', 'torpedo', 582], ['val', 'bomber', 240]]) {
  const force = airborne();
  const wing = {
    id: `ai-${airframe}`, team: 'us', kind, airframe, home: force.ships[0].id,
    x: 0, y: 1000, z: 0, heading: 0, pitch: 0, roll: 0, speed: 95, hp: 95, maxHp: 95,
    ammo: 350, rearAmmo: rear, rearTimer: 0, mode: 'flight', age: 0, think: 0, target: null,
    gunTimer: 0, attackCooldown: 0, wing: true, phase: 0, vx: 0, vy: 0, vz: 0, fuel: 100, fuelCapacity: 100,
  };
  force.aircraft.push(wing, enemyAt(0, 1000, 200));
  force.updateAircraft(1 / 60);
  assert.equal(wing.rearAmmo, rear - 1, `friendly AI ${airframe.toUpperCase()} rear gun still fires`);
}

// 6e. The briefing loadout sets the airframe's own rear capacity: the TBD's 600, and the SBD's
// 1200 on the way back. This is the path the deck select really uses (`selectLoadout`).
const brief = new Battle();
assert.equal(brief.selectLoadout('torpedo'), true, 'the briefing accepts the torpedo loadout');
assert.equal(brief.player.airframe, 'tbd');
assert.equal(brief.player.rearAmmo, 600, 'the briefing TBD starts with its 600 rear rounds');
assert.equal(brief.selectLoadout('bomb'), true, 'the briefing accepts the bomb loadout again');
assert.equal(brief.player.airframe, 'sbd');
assert.equal(brief.player.rearAmmo, 1200, 'returning to the SBD restores its 1200 rear rounds');

// 6f. A deck swap is never a free ammunition refill: with the carrier's ammo store empty the carried
// rounds are capped to the new gun's capacity; with a store present exactly one unit is spent.
const swap = new Battle();
swap.start();
swap.player.loadout = 'bomb';
swap.player.airframe = 'sbd';
swap.player.rearAmmo = 100;
swap.home.air.stores.ammo = 0;
swap.home.air.stores.torpedo = 5;
assert.equal(swap.selectLoadout('torpedo'), true, 'the deck accepts the swap with no ammo store');
assert.equal(swap.player.airframe, 'tbd');
assert.equal(swap.player.rearAmmo, 100, 'an empty ammo store never tops the rear gun up on a swap');
assert.equal(swap.home.air.stores.ammo, 0, 'no store was spent when none was aboard');
swap.home.air.stores.ammo = 1;
swap.home.air.stores.bomb = 5;
assert.equal(swap.selectLoadout('bomb'), true, 'the deck accepts the swap with a store aboard');
assert.equal(swap.player.airframe, 'sbd');
assert.equal(swap.player.rearAmmo, 1200, "a store aboard loads the new airframe's full rear capacity");
assert.equal(swap.home.air.stores.ammo, 0, 'the swap spends exactly one ammunition store');

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

// 10. The muzzle is one of the approved gun's own mouths, on the hinge the renderer draws, riding
// the airframe's real attitude; the two barrels alternate without doubling the ammunition, and a
// real round damages a target dead astern.
const mountOutput = await build({ entryPoints: ['src/sim/gun-mount.ts'], bundle: true, platform: 'node', format: 'esm', write: false });
const { REAR_GUN_MOUNTS, rearGunMuzzle } = await import(`data:text/javascript;base64,${Buffer.from(mountOutput.outputFiles[0].text).toString('base64')}`);
const mount = REAR_GUN_MOUNTS.sbd;
const rear = airborne();
rear.player.rearAmmo = 240;
rear.player.ammo = 1400;
tick(rear, 1.5, { turn: 1 });
assert.ok(Math.abs(rear.player.roll) > 0.3, 'the firing aircraft is actually banked');
rear.setGunner(true);
// A non-zero station aim, so the muzzle is checked after its own yaw and pitch, not only at rest.
rear.player.gunnerYaw = 0.5;
rear.player.gunnerPitch = 0.2;
rear.step(1 / 60, { fire: true });
const first = rear.bullets.find((b) => b.owner === 'player');
assert.ok(first, 'a banked rear gunner still fires');
const q = rear.player.attitude;
const ua = { x: 2 * (q.x * q.y - q.z * q.w), y: 1 - 2 * (q.x * q.x + q.z * q.z), z: 2 * (q.y * q.z + q.x * q.w) };
const fa = { x: -2 * (q.x * q.z + q.y * q.w), y: -2 * (q.y * q.z - q.x * q.w), z: -(1 - 2 * (q.x * q.x + q.y * q.y)) };
const ra = { x: 1 - 2 * (q.y * q.y + q.z * q.z), y: 2 * (q.x * q.y + q.z * q.w), z: 2 * (q.x * q.z - q.y * q.w) };
const localMuzzle = (barrel) => {
  const m = rearGunMuzzle(mount, barrel, rear.player.gunnerYaw, rear.player.gunnerPitch);
  return { x: mount.pivot[0] + m[0], y: mount.pivot[1] + m[1], z: mount.pivot[2] + m[2] };
};
const worldOf = (p) => ({
  x: rear.player.x + ra.x * p.x + ua.x * p.y - fa.x * p.z,
  y: rear.player.y + ra.y * p.x + ua.y * p.y - fa.y * p.z,
  z: rear.player.z + ra.z * p.x + ua.z * p.y - fa.z * p.z,
});
const expected = worldOf(localMuzzle(1));
const ox = first.x - first.vx / 60;
const oy = first.y - first.vy / 60;
const oz = first.z - first.vz / 60;
assert.ok(Math.hypot(ox - expected.x, oy - expected.y, oz - expected.z) < 0.05, 'the muzzle is the approved upper mouth on the drawn hinge, under real attitude');
assert.equal(rear.player.rearBarrel, 1, 'the first round leaves one barrel');
// The next round, after the cadence, leaves the other mouth and spends exactly one more round.
for (let i = 0; i < 8; i += 1) rear.step(1 / 60, { fire: false });
rear.step(1 / 60, { fire: true });
const second = rear.bullets.filter((b) => b.owner === 'player')[1];
assert.ok(second, 'a second round fires');
assert.equal(rear.player.rearBarrel, 0, 'the barrels alternate');
const secondExpected = worldOf(localMuzzle(0));
const sx = second.x - second.vx / 60;
const sy = second.y - second.vy / 60;
const sz = second.z - second.vz / 60;
assert.ok(Math.hypot(sx - secondExpected.x, sy - secondExpected.y, sz - secondExpected.z) < 0.05, 'the second round leaves the matching other mouth');
assert.equal(rear.player.rearAmmo, 238, 'two rounds cost exactly two rear rounds, never four');
const n = Math.hypot(first.vx, first.vy, first.vz);
const behind = enemyAt(first.x + (first.vx / n) * 50, first.y + (first.vy / n) * 50, first.z + (first.vz / n) * 50);
rear.aircraft.push(behind);
const hp = behind.hp;
for (let i = 0; i < 40 && behind.hp >= hp; i += 1) rear.step(1 / 60, {});
assert.ok(behind.hp < hp, 'a real rear-gun round damaged the target, not just the ammo counter');

// 10b. The measured fin is a thin slab the two barrels straddle: a dead-astern level shot clears it,
// but a round yawed toward the centreline enters the fin and is refused. A refused shot spends no
// round and never flips the barrel, so the two mouths only alternate on rounds that actually leave.
const guarded = airborne();
guarded.setGunner(true);
guarded.player.rearBarrel = 1; // the next round leaves the port mouth at x = -0.091
guarded.player.gunnerYaw = 5 * (Math.PI / 180); // yawed toward the centreline, into the fin band
guarded.player.gunnerPitch = 0;
guarded.player.rearTimer = 0;
guarded.player.rearAmmo = 240;
guarded.step(1 / 60, { fire: true });
assert.equal(guarded.player.rearAmmo, 240, 'a round yawed into the fin is refused');
assert.equal(guarded.player.rearBarrel, 1, 'a refused shot never flips the barrel');
assert.equal(guarded.bullets.filter((b) => b.owner === 'player').length, 0, 'a refused shot fires no round');
// The same trigger, aimed straight aft, straddles the thin fin and fires at once.
guarded.player.gunnerYaw = 0;
guarded.player.rearTimer = 0;
guarded.step(1 / 60, { fire: true });
assert.equal(guarded.player.rearAmmo, 239, 'a dead-astern shot clears the straddled fin');
assert.equal(guarded.player.rearBarrel, 0, 'only the clearing shot flips the barrel');

// 10c. The Douglas fuselage and horizontal tail sit inside a conservative below-level central
// sector the thin-fin guard alone does not cover (parent BVH grid: pitch −0.13 hits the hull to
// |yaw| ≤ 0.45), so an SBD depressed central shot is refused — no round, no ammunition, no barrel
// flip, and no cadence lock: levelling the gun fires at once. A depressed shot swung off the
// centreline (outside the sector) still clears, and the TBD is never refused for depression.
const lowCentre = airborne();
lowCentre.setGunner(true);
lowCentre.player.rearAmmo = 240;
lowCentre.player.rearBarrel = 1; // the next round would leave the port mouth at x = -0.091
lowCentre.player.gunnerYaw = 0;
lowCentre.player.gunnerPitch = Math.asin(-0.13);
lowCentre.player.rearTimer = 0;
lowCentre.step(1 / 60, { fire: true });
assert.equal(lowCentre.player.rearAmmo, 240, 'an SBD depressed central shot spends no round');
assert.equal(lowCentre.bullets.filter((b) => b.owner === 'player').length, 0, 'no bullet leaves on the refused SBD shot');
assert.equal(lowCentre.player.rearBlocked, true, 'the refused SBD shot raises the block cue');
assert.equal(lowCentre.player.rearBarrel, 1, 'a refused SBD shot never flips the barrel');
// The very next tick, gun levelled: the round clears the straddled thin fin and the refused shot
// left the cadence free, so it fires at once.
lowCentre.player.gunnerPitch = 0;
lowCentre.step(1 / 60, { fire: true });
assert.equal(lowCentre.player.rearAmmo, 239, 'the SBD fires at once once the gun is levelled');
assert.equal(lowCentre.player.rearBlocked, false, 'a clearing shot lowers the block cue');
// The same depression off the centreline is outside the guarded sector and still fires.
lowCentre.player.rearTimer = 0;
lowCentre.player.gunnerYaw = 0.7;
lowCentre.player.gunnerPitch = Math.asin(-0.13);
lowCentre.step(1 / 60, { fire: true });
assert.equal(lowCentre.player.rearAmmo, 238, 'an SBD depressed side shot outside the central sector still fires');
// A TBD at the same depression and yaw always fires: the guard is Douglas-only.
const tbdLow = airborne();
tbdLow.player.airframe = 'tbd';
tbdLow.setGunner(true);
tbdLow.player.rearAmmo = 240;
tbdLow.player.gunnerYaw = 0;
tbdLow.player.gunnerPitch = Math.asin(-0.13);
tbdLow.player.rearTimer = 0;
tbdLow.step(1 / 60, { fire: true });
assert.equal(tbdLow.player.rearAmmo, 239, 'the TBD has no below-level central guard');

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

// 12. The belt. One loaded count in the gun and an implicit reserve behind it (`total - loaded`).
// Reloading moves rounds from the sortie total into the gun and never creates any; a full belt or an
// exhausted total is refused; no round is spent while a change runs; the AI and the manned station
// share one state across a handoff.
const belt = airborne();
belt.player.rearTimer = 0;
assert.equal(belt.player.rearLoaded, 240, 'the SBD starts with a full combined belt');
assert.equal(belt.player.rearAmmo, 1200, 'and holds its whole sortie total');
belt.player.rearLoaded = 3;
belt.player.rearAmmo = 903;
belt.setGunner(true);
belt.step(1 / 60, { fire: true });
assert.equal(belt.player.rearAmmo, 902, 'a round leaves the sortie total');
assert.equal(belt.player.rearLoaded, 2, 'and the same round leaves the belt');
assert.equal(belt.reloadRear(), true, 'R starts a belt change on a partial belt');
assert.ok(belt.player.rearReloadUntil > belt.time, 'the belt change runs on the shared sim clock');
const heldTotal = belt.player.rearAmmo;
for (let i = 0; i < 30; i++) {
  belt.player.rearTimer = 0;
  belt.step(1 / 60, { fire: true });
}
assert.equal(belt.player.rearAmmo, heldTotal, 'no round is spent while the belt is changing');
assert.equal(belt.player.rearLoaded, 2, 'and the belt cannot fall further during a change');
tick(belt, 3.7);
assert.equal(belt.player.rearReloadUntil, 0, 'the belt change ends');
assert.equal(belt.player.rearLoaded, 240, 'a finished change fills the belt to a full combined 240');
assert.equal(belt.player.rearAmmo, heldTotal, 'a reload never changes the sortie total');
assert.equal(belt.reloadRear(), false, 'R on a full belt is a no-op');
belt.player.rearAmmo = 0;
belt.player.rearLoaded = 0;
assert.equal(belt.reloadRear(), false, 'an exhausted sortie total cannot be reloaded');
assert.equal(belt.player.rearLoaded, 0, 'and no round appears from nowhere');

// An empty AI belt reloads itself, and a change it starts survives the pilot taking the gun.
const hand2 = airborne();
hand2.player.rearAmmo = 500;
hand2.player.rearLoaded = 0;
hand2.player.rearTimer = 0;
hand2.setGunner(false);
tick(hand2, 1 / 60);
assert.ok(hand2.player.rearReloadUntil > hand2.time, 'an empty AI belt starts its own change');
hand2.setGunner(true);
assert.equal(hand2.reloadRear(), false, 'R while a change is already running is a no-op');
tick(hand2, 3.7);
assert.equal(hand2.player.rearLoaded, 240, 'the AI-started change completes under the player');
assert.equal(hand2.player.rearAmmo, 500, 'with the sortie total unchanged');
assert.equal(hand2.player.gunner, true, 'and the station is still manned');

// The recoil cadence advances on every path: a trigger held after the last loaded round or during a
// belt change must still settle, so the barrels can never freeze at full deflection.
const settle = airborne();
settle.setGunner(true);
settle.player.rearLoaded = 1;
settle.player.rearAmmo = 1;
settle.player.rearTimer = 0;
settle.step(1 / 60, { fire: true });
assert.equal(settle.player.rearLoaded, 0, 'the last loaded round leaves the belt');
assert.ok(settle.player.rearTimer > 0, 'the last shot sets its recoil cadence');
for (let i = 0; i < 6; i++) settle.step(1 / 60, { fire: true });
assert.equal(settle.player.rearTimer, 0, 'the recoil settles through an empty, exhausted belt');
assert.equal(settle.player.rearAmmo, 0, 'and a dry gun never invents a round');

const settleReload = airborne();
settleReload.setGunner(true);
settleReload.player.rearLoaded = 2;
settleReload.player.rearAmmo = 500;
settleReload.player.rearTimer = 0.08;
assert.equal(settleReload.reloadRear(), true, 'a belt change starts with reserve behind it');
for (let i = 0; i < 6; i++) settleReload.step(1 / 60, { fire: true });
assert.equal(settleReload.player.rearTimer, 0, 'the recoil settles through a belt change');
assert.equal(settleReload.player.rearLoaded, 2, 'and the change spends nothing while it runs');

// Seeding a belt is idempotent and never inflates the total.
const seed = airborne();
seed.player.rearAmmo = 137;
initRearState(seed.player);
assert.equal(seed.player.rearAmmo, 137, 'seeding a gun never changes the sortie total');
assert.equal(seed.player.rearLoaded, 137, 'it loads the belt up to whatever the total holds');

console.log(JSON.stringify({ pass: true, forwardAmmo: man.player.ammo, rearAmmo: silent.player.rearAmmo }));
process.exit(0);
