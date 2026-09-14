/**
 * Cruiser-scout check. Exercises the pure `src/sim/scouting.ts` model without a browser: the launch
 * gate, sector assignment, fuel-led state transitions and the lost case, the water-pickup envelope,
 * group capacity under loss, and that a scout loss never disturbs reports already filed. The module
 * owns no randomness, so every assertion is exact.
 *
 * Uses the esbuild vite already installs. Run: node scripts/check-scouting.mjs
 */
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { build } from "esbuild";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const built = await build({
  stdin: { contents: 'export * from "./src/sim/scouting.ts";', loader: "ts", resolveDir: root },
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node20",
  write: false,
  logLevel: "silent",
});
const {
  SCOUT_STATES,
  SCOUT_RESERVE,
  SCOUT_FULL_FUEL,
  SCOUT_BURN_SPREAD,
  PICKUP_MAX_SHIP_SPEED,
  assignSector,
  canLaunchScout,
  stepScout,
  pickupWindow,
  reconnaissanceCapacity,
} = await import(`data:text/javascript,${encodeURIComponent(built.outputFiles[0].text)}`);

const freeze = (x) => Object.freeze(x);

const scout = (over = {}) => ({
  id: "s1",
  homeShipId: "tone",
  state: "aboard",
  sectorId: null,
  fuel: SCOUT_FULL_FUEL,
  launchedAt: null,
  recoveredAt: null,
  ...over,
});

const sector = (over = {}) => ({
  id: "a",
  origin: { x: 0, z: 0 },
  fromBearing: 0,
  toBearing: Math.PI / 2,
  depth: 12000,
  lastSearchedAt: null,
  ...over,
});

const ship = (over = {}) => ({ id: "tone", kind: "cruiser", aviation: 1, speed: 0, ...over });

const limits = (over = {}) => ({
  burn: 2,
  outboundFuel: 2000,
  searchFuel: 1200,
  reserve: SCOUT_RESERVE,
  pickupFuel: 200,
  ...over,
});

// 0 — the seven states are exactly what the sortie record promises.
assert.deepEqual(
  [...SCOUT_STATES],
  ["aboard", "catapult", "outbound", "searching", "returning", "alongside", "lost"],
  "a scout must have exactly the seven named states",
);

// 1 — a scout still airborne cannot launch again, with the reason naming the state.
{
  const capable = freeze(ship());
  const airborne = canLaunchScout(capable, freeze(scout({ state: "searching" })), 0);
  assert.equal(airborne.ok, false, "an airborne scout must not launch again");
  assert.match(airborne.reason, /airborne/i, "the refusal must say the scout is airborne");
  assert.equal(canLaunchScout(capable, freeze(scout({ state: "aboard" })), 0).ok, true, "an aboard scout may launch");
  assert.equal(canLaunchScout(capable, freeze(scout({ state: "alongside" })), 0).ok, false, "alongside is not yet aboard");
  assert.equal(canLaunchScout(capable, freeze(scout({ state: "lost" })), 0).ok, false, "a lost scout never launches");
}

// 2 — no aviation fitting, and a damaged fitting, both keep a scout on deck.
{
  const bare = canLaunchScout(freeze({ id: "x" }), freeze(scout()), 0);
  assert.equal(bare.ok, false, "a hull with no aviation must not launch");
  assert.match(bare.reason, /no aviation/i, "the refusal must name the missing capability");
  const zero = canLaunchScout(freeze({ id: "x", aviation: 0 }), freeze(scout()), 0);
  assert.equal(zero.ok, false, "zero capability must not launch");
  const damaged = canLaunchScout(freeze(ship({ aviationDamage: true })), freeze(scout()), 0);
  assert.equal(damaged.ok, false, "a damaged aviation fitting must not launch");
  assert.match(damaged.reason, /damag/i, "the refusal must name the damage");
}

// 3 — the longest-unsearched sector wins; a fresher one loses; a never-searched one is oldest.
{
  const now = 1000;
  const never = freeze(sector({ id: "never" }));
  const old = freeze(sector({ id: "old", lastSearchedAt: 0 }));
  const fresh = freeze(sector({ id: "fresh", lastSearchedAt: now - 10 }));
  assert.equal(assignSector(freeze([fresh, old, never]), now, 100).id, "never", "a never-searched sector is oldest");
  assert.equal(assignSector(freeze([fresh, old]), now, 100).id, "old", "the longest unsearched must win");
  assert.equal(assignSector(freeze([fresh]), now, 100), null, "a fresh sector is not worth a sortie");
  const t1 = freeze(sector({ id: "t1", lastSearchedAt: 500 }));
  const t2 = freeze(sector({ id: "t2", lastSearchedAt: 500 }));
  assert.equal(assignSector(freeze([t1, t2]), now, 100).id, "t1", "a tie must keep the caller's order");
}

// 4 — fuel drives the legs: outbound to search, the reserve turns it home before empty, dry is lost.
{
  const L = freeze(limits());
  assert.equal(
    stepScout(freeze(scout({ state: "catapult", fuel: 3000 })), 1, L, 0.5).state,
    "outbound",
    "the catapult shot must become the outbound leg",
  );
  assert.equal(
    stepScout(freeze(scout({ state: "outbound", fuel: 2001 })), 1, L, 0.5).state,
    "searching",
    "crossing the outbound fuel level must start the search",
  );

  const search = freeze(scout({ state: "searching", fuel: L.reserve + 10 }));
  const home = stepScout(search, 5, L, 0.5); // 0.5 makes the burn exactly limits.burn, 2/s
  assert.equal(home.state, "returning", "the reserve must force a return before the tank is empty");
  assert.equal(home.fuel, L.reserve, "the scout must still have fuel on turning home");
  assert.ok(home.fuel > 0, "the reserve must leave something in the tank");
  assert.equal(search.state, "searching", "stepScout must not mutate its input state");
  assert.equal(search.fuel, L.reserve + 10, "stepScout must not mutate its input fuel");

  const dry = stepScout(freeze(scout({ state: "returning", fuel: 5 })), 10, L, 0.5);
  assert.equal(dry.state, "lost", "a scout that runs dry must be lost");
  assert.equal(dry.fuel, 0, "a lost scout must have no fuel left");

  const picked = stepScout(freeze(scout({ state: "returning", fuel: 201 })), 1, L, 0.5);
  assert.equal(picked.state, "alongside", "reaching the pickup fuel must put the scout alongside");

  const calm = stepScout(freeze(scout({ state: "searching", fuel: 3000 })), 1, L, 0);
  const rough = stepScout(freeze(scout({ state: "searching", fuel: 3000 })), 1, L, 1);
  assert.ok(Math.abs(calm.fuel - (3000 - L.burn * (1 - SCOUT_BURN_SPREAD / 2))) < 1e-9, "a low draw must ease the burn");
  assert.ok(Math.abs(rough.fuel - (3000 - L.burn * (1 + SCOUT_BURN_SPREAD / 2))) < 1e-9, "a high draw must raise the burn");
}

// 5 — the pickup envelope refuses a fast ship and accepts a stopped or slowed one.
{
  const returning = freeze(scout({ state: "returning" }));
  const fast = pickupWindow(returning, freeze(ship({ speed: PICKUP_MAX_SHIP_SPEED + 5 })));
  assert.equal(fast.ok, false, "a fast ship must refuse the water pickup");
  assert.match(fast.reason, /fast/i, "the refusal must name the speed");
  assert.equal(pickupWindow(returning, freeze(ship({ speed: 0 }))).ok, true, "a stopped ship must accept the pickup");
  assert.equal(pickupWindow(returning, freeze(ship({ speed: PICKUP_MAX_SHIP_SPEED - 1 }))).ok, true, "a slowed ship must accept");
  assert.equal(pickupWindow(freeze(scout({ state: "searching" })), freeze(ship())).ok, false, "a searching scout is not recoverable");
}

// 6 — losing a scout shrinks capacity and leaves a contact list, already filed, untouched.
{
  const contacts = freeze([
    { id: "c1", targetId: "kaga", time: 100, x: 10, z: 20 },
    { id: "c2", targetId: "akagi", time: 200, x: 30, z: 40 },
  ]);
  const filed = JSON.stringify(contacts);

  const scouts = freeze([
    scout({ id: "s1", state: "searching", fuel: SCOUT_FULL_FUEL / 2 }),
    scout({ id: "s2", state: "aboard" }),
  ]);
  const before = reconnaissanceCapacity(scouts);
  assert.equal(before, 1.5, "a half-full searching scout plus a full one must count 1.5");

  const after = reconnaissanceCapacity(freeze([scouts[0], scout({ id: "s2", state: "lost", fuel: 0 })]));
  assert.ok(after < before, "losing a scout must lower reconnaissance capacity");
  assert.equal(after, 0.5, "a lost scout must contribute nothing");

  assert.equal(JSON.stringify(contacts), filed, "a scout loss must not touch reports already received");
  assert.equal(contacts.length, 2, "the filed contacts must all remain");
}

// 7 — every function accepts frozen inputs and leaves them untouched.
{
  const s = freeze(scout({ state: "outbound", fuel: 1500 }));
  const sh = freeze(ship({ speed: 4 }));
  const L = freeze(limits());
  const sectors = freeze([freeze(sector({ id: "a", lastSearchedAt: 0 })), freeze(sector({ id: "b" }))]);
  assert.doesNotThrow(() => assignSector(sectors, 5000, 100), "assignSector must accept frozen sectors");
  assert.doesNotThrow(() => canLaunchScout(sh, s, 0), "canLaunchScout must accept frozen records");
  assert.doesNotThrow(() => stepScout(s, 1, L, 0.25), "stepScout must accept frozen records");
  assert.doesNotThrow(() => pickupWindow(freeze(scout({ state: "returning" })), sh), "pickupWindow must accept frozen records");
  assert.doesNotThrow(() => reconnaissanceCapacity(freeze([s])), "reconnaissanceCapacity must accept a frozen list");
  assert.equal(s.fuel, 1500, "stepScout must not mutate the frozen scout");
  assert.equal(s.state, "outbound", "stepScout must not move the frozen scout");
  assert.equal(sh.speed, 4, "the frozen ship must be untouched");
}

console.log("check-scouting: 7 checks passed");
