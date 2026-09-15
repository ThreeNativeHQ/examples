/**
 * Fire-control check for src/sim/gunnery.ts: mounts fire from their own position, a bow arc refuses a
 * target astern until the ship turns, only an AA mount tracks an aircraft, coastal guns reach only
 * what enters their arc and range, and elevation limits refuse what is too high or too close.
 *
 * Uses the esbuild vite already installs. Run: node scripts/check-gunnery.mjs
 */
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { build } from "esbuild";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const built = await build({
  stdin: { contents: 'export * from "./src/sim/gunnery.ts";', loader: "ts", resolveDir: root },
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node20",
  write: false,
  logLevel: "silent",
});
const { canBear, muzzleOrigin, coastalEngagement } = await import(
  `data:text/javascript,${encodeURIComponent(built.outputFiles[0].text)}`
);

const mainMount = {
  id: "A",
  class: "main",
  forward: 30,
  right: 6,
  height: 5,
  traverse: { center: 0, half: 1.0 },
  elevation: { min: -0.1, max: 0.5 },
  minRange: 200,
  maxRange: 20000,
};
const aaMount = {
  ...mainMount,
  id: "AA1",
  class: "aa",
  traverse: { center: 0, half: Math.PI },
  elevation: { min: -0.1, max: 1.4 },
  minRange: 50,
  maxRange: 4500,
};

// 1 — a target astern is outside a bow mount's traverse arc; turning the ship brings it in.
{
  const ship = { x: 0, y: 0, z: 0, heading: 0 };
  const ahead = { x: 0, y: 10, z: -1000 };
  const astern = { x: 0, y: 10, z: 1000 };
  assert.equal(canBear(mainMount, ship, ahead), true, "a target dead ahead should be in arc");
  assert.equal(canBear(mainMount, ship, astern), false, "a target astern is outside a bow arc");
  ship.heading = Math.PI;
  assert.equal(canBear(mainMount, ship, astern), true, "rotating the ship should bring the astern target into arc");
}

// 2 — the muzzle is the mount's own position and swings with the hull, not the ship centre.
{
  const ship = { x: 0, y: 0, z: 0, heading: 0 };
  const m = muzzleOrigin(mainMount, ship);
  assert.ok(
    Math.abs(m.x - 6) < 1e-9 && Math.abs(m.y - 5) < 1e-9 && Math.abs(m.z - -30) < 1e-9,
    `mount origin is wrong: ${JSON.stringify(m)}`,
  );
  assert.ok(Math.hypot(m.x - ship.x, m.z - ship.z) > 1, "the muzzle must not be the ship centre");
  const turned = { ...ship, heading: Math.PI / 2 };
  const r = muzzleOrigin(mainMount, turned);
  assert.ok(
    Math.abs(r.x - 30) < 1e-9 && Math.abs(r.z - 6) < 1e-9,
    `the muzzle did not swing with heading: ${JSON.stringify(r)}`,
  );
}

// 3 — a main battery refuses an aircraft; the same target is acceptable to an AA mount.
{
  const ship = { x: 0, y: 0, z: 0, heading: 0 };
  const plane = { x: 0, y: 500, z: -1200, airframe: "zero" };
  assert.equal(canBear(mainMount, ship, plane), false, "a main battery must not track an aircraft");
  assert.equal(canBear(aaMount, ship, plane), true, "an AA mount should accept the aircraft");
}

// 4 — a coastal battery engages only what enters both its arc and its range.
{
  const battery = {
    id: "C1",
    class: "main",
    x: 0,
    z: 0,
    heading: 0,
    height: 20,
    traverse: { center: 0, half: 0.6 },
    elevation: { min: -0.2, max: 0.4 },
    minRange: 800,
    maxRange: 18000,
  };
  const inBoth = { x: 0, y: 0, z: -6000, heading: 0 };
  const tooFar = { x: 0, y: 0, z: -40000, heading: 0 };
  const behind = { x: 0, y: 0, z: 6000, heading: 0 };
  assert.equal(coastalEngagement(battery, inBoth).engaged, true, "a ship inside arc and range must be engaged");
  assert.equal(coastalEngagement(battery, tooFar).engaged, false, "a ship beyond range must not be engaged");
  assert.equal(coastalEngagement(battery, behind).engaged, false, "a ship outside the arc must not be engaged");
}

// 5 — elevation limits refuse a target too high, and minimum range refuses one too close.
{
  const ship = { x: 0, y: 0, z: 0, heading: 0 };
  const tooHigh = { x: 0, y: 4000, z: -200 };
  const tooClose = { x: 0, y: 0, z: -50 };
  assert.equal(canBear(mainMount, ship, tooHigh), false, "a target above the elevation limit must be refused");
  assert.equal(canBear(mainMount, ship, tooClose), false, "a target inside minimum range must be refused");
}

// 6 — purity: frozen inputs are never mutated and nothing throws.
{
  const deepFreeze = (o) => {
    for (const v of Object.values(o)) if (v && typeof v === "object") deepFreeze(v);
    return Object.freeze(o);
  };
  const ship = deepFreeze({ x: 0, y: 0, z: 0, heading: 0.3 });
  const mount = deepFreeze({ ...mainMount, traverse: { ...mainMount.traverse }, elevation: { ...mainMount.elevation } });
  const target = deepFreeze({ x: 0, y: 40, z: -1500 });
  assert.doesNotThrow(() => canBear(mount, ship, target));
  assert.doesNotThrow(() => muzzleOrigin(mount, ship));
  const battery = deepFreeze({
    id: "C2",
    class: "main",
    x: 0,
    z: 0,
    heading: 0,
    height: 20,
    traverse: { center: 0, half: 0.6 },
    elevation: { min: -0.2, max: 0.4 },
    minRange: 800,
    maxRange: 18000,
  });
  const inbound = deepFreeze({ x: 0, y: 0, z: -6000, heading: 0 });
  assert.doesNotThrow(() => coastalEngagement(battery, inbound));
}

console.log("check-gunnery: 6 checks passed");
