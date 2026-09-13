/**
 * Weapon/outcome producer check. Runs the real `Battle` (pure sim) and asserts the enriched events
 * that audio depends on: player and AI guns carry an identity, ship AA carries a mount position and
 * a caliber family, and explosions carry material/outcome so release, airburst, water and torpedo
 * hit stay distinguishable.
 *
 * Uses the esbuild vite already installs. Run: node scripts/check-weapons.mjs
 */
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { build } from "esbuild";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const built = await build({
  stdin: { contents: 'export { Battle } from "./src/sim/battle.ts";', loader: "ts", resolveDir: root },
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node20",
  write: false,
  logLevel: "silent",
});
const { Battle } = await import(`data:text/javascript,${encodeURIComponent(built.outputFiles[0].text)}`);

const fresh = () => {
  const b = new Battle();
  b.status = "playing";
  b.time = 5;
  return b;
};

// 1 — the player's own gun is a local .50 cue; an AI Zero alternates cannon and rifle-caliber.
{
  const b = fresh();
  b.player.mode = "flight";
  b.player.ammo = 100;
  b.fire(b.player);
  const own = b.events.find((e) => e.type === "gun");
  assert.equal(own.weapon, "gun50", "the player's gun identity is wrong");
  assert.equal(own.at, undefined, "the player's own gun should be local, not positional");

  const c = fresh();
  const zero = { id: "z1", team: "jp", kind: "fighter", airframe: "zero", hp: 100, mode: "flight", x: 100, y: 100, z: 100, heading: 0, pitch: 0, ammo: 100, gunTimer: 0, vx: 0, vy: 0, vz: 0 };
  c.player.x = 0; c.player.y = 100; c.player.z = 0;
  c.fire(zero);
  const first = c.events.find((e) => e.type === "gun");
  assert.ok(["cannon20", "gun77"].includes(first.weapon), `Zero gun identity is wrong: ${first.weapon}`);
  assert.ok(first.at && first.source === "z1", "an AI gun event is not positional");
  zero.gunTimer = 0;
  c.fire(zero);
  const families = c.events.filter((e) => e.type === "gun").map((e) => e.weapon);
  assert.ok(families.includes("cannon20") && families.includes("gun77"), `Zero alternation missing: ${families}`);
}

// 2 — ship AA emits a mount position and a caliber family for an aircraft in range.
{
  const b = fresh();
  const ship = b.ships.find((s) => s.kind === "carrier" && s.team === "us");
  b.aircraft.push({ id: "z2", kind: "fighter", airframe: "zero", team: "jp", hp: 100, mode: "flight", x: ship.x + 700, y: 600, z: ship.z, vx: 0, vy: 0, vz: 0 });
  for (let i = 0; i < 600 && !b.events.some((e) => e.type === "aa"); i += 1) b.updateShips(1 / 60);
  const aa = b.events.filter((e) => e.type === "aa");
  assert.ok(aa.length > 0, "no ship AA muzzle event was produced with a target in range");
  const sample = aa.find((e) => e.weapon);
  assert.ok(sample, "ship AA carried no weapon family");
  assert.ok(sample.at && typeof sample.at.x === "number", "ship AA carried no mount position");
  assert.ok(["aaHeavy", "aa20", "aa25"].includes(sample.weapon), `unexpected AA family ${sample.weapon}`);
}

// 3 — bomb, torpedo and midair destruction keep their material/outcome labels.
{
  const b = fresh();
  const carrier = b.ships.find((s) => s.kind === "carrier" && s.team === "jp");
  const point = { x: carrier.x, y: 20, z: carrier.z };
  b.damageShip(carrier, 30, point, "bomb", "us");
  const bomb = b.events.filter((e) => e.type === "explosion").at(-1);
  assert.equal(bomb.material, "deck", "a carrier bomb hit did not read as a deck blast");
  assert.ok(bomb.at, "a deck blast carried no position");

  b.damageShip(carrier, 60, point, "torpedo", "us");
  const torp = b.events.filter((e) => e.type === "explosion").at(-1);
  assert.equal(torp.outcome, "torpedo", "a torpedo hit did not read as a torpedo detonation");

  const plane = { id: "z9", team: "jp", kind: "fighter", airframe: "zero", hp: 1, mode: "flight", x: 10, y: 200, z: 10, vx: 0, vy: 0, vz: 0, bombs: 0, torpedo: 0, damage: null, lastAttacker: "player", killCredited: false };
  b.aircraft.push(plane);
  b.planeDestroyed(plane, "player");
  const air = b.events.filter((e) => e.type === "explosion").at(-1);
  assert.equal(air.material, "air", "a destroyed aircraft did not read as an air event");
}

// 4 — a bomb that misses into the sea emits a water event with its position.
{
  const b = fresh();
  b.bombs.push({ id: "b1", x: 0, y: 0.5, z: 0, vx: 0, vy: -40, vz: 0, team: "us", owner: "player", age: 0, damage: 100 });
  b.updateWeapons(1 / 60);
  const splash = b.events.find((e) => e.type === "splash");
  assert.ok(splash, "a bomb hitting the sea produced no splash event");
  assert.ok(splash.at, "a water impact carried no position");
}

console.log("check-weapons: 4 checks passed");
