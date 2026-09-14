/**
 * Torpedo-run check (PRD AC-17, "Torpedo variants" row and the swept-hull paragraph). Exercises the
 * run itself: the release envelope, arming distance, the depth-versus-draught rule, the swept test
 * that a point sample would miss, escort screening, the release stamp and purity.
 *
 * Uses the esbuild vite already installs. Run: node scripts/check-torpedo-run.mjs
 */
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { build } from "esbuild";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const built = await build({
  stdin: {
    contents: 'export * from "./src/sim/torpedo-run.ts"; export * from "./src/sim/armament.ts";',
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
const T = await import(`data:text/javascript,${encodeURIComponent(built.outputFiles[0].text)}`);

const mk13 = T.torpedoVariant("mk13");
const type91 = T.torpedoVariant("type91");
const type95 = T.torpedoVariant("type95");

const launcher = (o = {}) => ({
  x: 0,
  y: 10,
  z: 0,
  heading: 0,
  speed: 45,
  sortieId: 1,
  designatedTarget: null,
  orderedWing: false,
  ...o,
});
const ship = (o = {}) => ({
  id: "s",
  x: 0,
  z: 0,
  heading: 0,
  speed: 0,
  hullLength: 118.5,
  hullBeam: 10.8,
  draught: 3.8,
  sunk: false,
  ...o,
});
const aim = (x, z = 0) => ({ x, z });

// 1 — a release outside the variant's speed or altitude envelope returns null. Inside it succeeds.
{
  const inside = T.release(mk13, launcher({ y: 10, speed: 45 }), aim(1), 0);
  assert.ok(inside, "a legal Mark 13 release was refused");

  assert.equal(T.release(mk13, launcher({ y: 30, speed: 45 }), aim(1), 0), null, "drop above the ceiling accepted");
  assert.equal(T.release(mk13, launcher({ y: 1, speed: 45 }), aim(1), 0), null, "drop below the floor accepted");
  assert.equal(T.release(mk13, launcher({ y: 10, speed: 100 }), aim(1), 0), null, "drop over the speed limit accepted");
  assert.equal(T.release(mk13, launcher({ y: 10, speed: 10 }), aim(1), 0), null, "drop under the speed floor accepted");

  // A submarine envelope is not the aircraft's: the Type 95 refuses a 10 m aerial drop and accepts a
  // periscope-depth shot.
  assert.equal(T.release(type95, launcher({ y: 10, speed: 2 }), aim(1), 0), null, "a Type 95 was dropped in the air");
  assert.ok(T.release(type95, launcher({ y: -5, speed: 2 }), aim(1), 0), "a periscope-depth Type 95 shot was refused");
}

// 2 — arming only happens at the variant's arming distance, and a hit inside it does not detonate.
{
  const run = T.release(mk13, launcher({ y: 10, speed: 45 }), aim(1), 0);
  assert.equal(run.armedAt, null, "a torpedo was armed at release");

  const justShort = T.stepRun(run, (mk13.armingDistance - 1) / mk13.settings[0].speed);
  assert.ok(justShort.distanceRun < mk13.armingDistance, "the run reached the arming distance early");
  assert.equal(justShort.armedAt, null, "a torpedo armed inside its arming distance");

  const armed = T.stepRun(justShort, 2 / mk13.settings[0].speed);
  assert.ok(armed.distanceRun >= mk13.armingDistance);
  assert.equal(armed.armedAt, mk13.armingDistance, "a torpedo did not arm at its arming distance");

  // A hull 30 m ahead: crossed on the first step, still inside the 230 m arming run, so the roll
  // cannot detonate it even at a certainty.
  const closeShip = ship({ id: "close", x: 30, z: 0, hullLength: 100, hullBeam: 12, draught: 8 });
  const after = T.stepRun(run, 3); // ~51.7 m at 17.23 m/s
  assert.ok(after.distanceRun < mk13.armingDistance, "the arming-distance case did not stay short");
  const hit = T.sweptHit(after, run, closeShip, 3);
  assert.equal(hit.hit, true, "the torpedo did not cross a hull dead ahead");
  assert.equal(after.armedAt, null, "an unarmed run read as armed");
  assert.equal(T.reliabilityRoll(mk13, after, 0).detonated, false, "a hit inside the arming distance detonated");
}

// 3 — a torpedo running deeper than the target's draught passes under it and does not hit.
{
  const run = T.release(type91, launcher({ y: 10, speed: 45, depth: 10 }), aim(1), 0);
  assert.equal(run.runDepth, 10, "the Type 91 did not run at its set depth");
  const destroyer = ship({ id: "dd", x: 30, z: 0, hullBeam: 10.8, hullLength: 118.5, draught: 3.8 });
  const after = T.stepRun(run, 5); // ~108 m, well across the destroyer
  const result = T.sweptHit(after, run, destroyer, 5);
  assert.equal(result.hit, false, "a torpedo deeper than the draught hit");
  assert.equal(result.depthOk, false, "a torpedo deeper than the draught read as depth-ok");
  assert.equal(result.reason, "under", "the too-deep case did not report running under");
}

// 4 — the swept test catches a hit a point sample at each step boundary would miss. A fast Type 95
// crosses a thin destroyer athwartships in one step: both endpoints sit outside the 10.8 m beam, and
// only the segment between them does.
{
  const run = T.release(type95, launcher({ y: -5, speed: 2, x: -6, depth: 1 }), aim(1), 0);
  const thin = ship({ id: "thin", x: 0, z: 0, hullBeam: 10.8, hullLength: 118.5, draught: 3.8 });
  const dt = 12 / type95.settings[0].speed; // step 12 m across a 10.8 m beam
  const after = T.stepRun(run, dt);
  assert.ok(after.x > 6 - 1e-9, "the fast step did not clear the hull");

  const atStart = { ...run, x: -6 };
  assert.equal(T.sweptHit(atStart, { x: -6, z: 0 }, thin, 0).hit, false, "the start point sampled as a hit");
  assert.equal(T.sweptHit(after, { x: 6, z: 0 }, thin, 0).hit, false, "the end point sampled as a hit");
  assert.equal(T.sweptHit(after, { x: -6, z: 0 }, thin, dt).hit, true, "the swept segment missed the thin hull");
}

// 5 — a shallow escort screens a torpedo running at its draught and is run under by a deeper one.
{
  const escort = ship({ id: "escort", x: 0, z: 0, hullBeam: 10.8, hullLength: 118.5, draught: 3.8 });
  const carrier = ship({ id: "carrier", x: 100, z: 0, hullBeam: 25.4, hullLength: 246.7, draught: 7.9 });
  const start = { x: -50, z: 0 };
  const cross = (depth) => {
    const run = T.release(type91, launcher({ y: 10, speed: 45, x: -50, depth }), aim(1), 0);
    const dt = 200 / type91.settings[0].speed;
    const after = T.stepRun(run, dt);
    return { run, after, dt };
  };

  // 6 m: deeper than the escort (3.8 m), shallower than the carrier (7.9 m). It runs under the
  // escort and is stopped by the carrier.
  const deep = cross(6);
  assert.equal(T.sweptHit(deep.after, start, escort, deep.dt).reason, "under", "the deep run hit the shallow escort");
  assert.equal(T.screenIntercept(deep.after, start, [escort], carrier, deep.dt), "carrier", "the deep run did not reach the carrier");

  // 3 m: within the escort's draught, so the escort screens the carrier.
  const shallow = cross(3);
  assert.equal(T.sweptHit(shallow.after, start, escort, shallow.dt).hit, true, "the shallow run failed to hit the escort");
  assert.equal(T.screenIntercept(shallow.after, start, [escort], carrier, shallow.dt), "escort", "the escort did not screen the carrier");
}

// 6 — expiry at the end of the range, and the release stamp survives the whole run unchanged.
{
  const run = T.release(
    type95,
    launcher({ y: -5, speed: 2, x: 0, depth: 1, sortieId: 7, designatedTarget: "cv-3", orderedWing: true }),
    aim(1),
    42,
  );
  const range = type95.settings[0].range;
  const far = T.stepRun(run, range / type95.settings[0].speed);
  assert.equal(far.distanceRun, range, "a run did not expire at the end of its range");
  const beyond = T.stepRun(far, 1000);
  assert.equal(beyond.distanceRun, range, "a run travelled past its range");

  for (const r of [run, far, beyond]) {
    assert.equal(r.sortieId, 7, "the sortie stamp changed during the run");
    assert.equal(r.designatedTarget, "cv-3", "the designated target changed during the run");
    assert.equal(r.orderedWing, true, "the ordered-wing stamp changed during the run");
  }
  assert.equal(run.variantId, type95.id);
  assert.ok(run.id.includes("42"), "the release time did not enter the id");
}

// 7 — purity: every input frozen, no call throws, no input is mutated, and the source uses no
// Math.random and imports nothing outside src/sim/.
{
  const deepFreeze = (o) => {
    if (o && typeof o === "object" && !Object.isFrozen(o)) {
      Object.freeze(o);
      for (const v of Object.values(o)) deepFreeze(v);
    }
    return o;
  };
  const frozenLauncher = deepFreeze(launcher({ x: 0, y: 10, speed: 45, depth: 6 }));
  const frozenAim = deepFreeze(aim(1));
  const frozenShip = deepFreeze(ship({ id: "f", x: 30, z: 0, draught: 7.9 }));
  const frozenEscort = deepFreeze(ship({ id: "e", x: 0, z: 0, draught: 3.8 }));
  const frozenRun = deepFreeze(T.release(type91, frozenLauncher, frozenAim, 1));
  const before = JSON.parse(JSON.stringify({ frozenLauncher, frozenShip, frozenRun }));

  assert.doesNotThrow(() => {
    const stepped = T.stepRun(frozenRun, 2);
    T.sweptHit(stepped, frozenRun, frozenShip, 2);
    T.screenIntercept(stepped, frozenRun, [frozenEscort], frozenShip, 2);
    T.reliabilityRoll(type91, stepped, 0.1);
  }, "a pure call threw on frozen input");

  assert.deepEqual(JSON.parse(JSON.stringify({ frozenLauncher, frozenShip, frozenRun })), before, "an input was mutated");

  const source = readFileSync(resolve(root, "src/sim/torpedo-run.ts"), "utf8");
  assert.ok(!/Math\.random/.test(source), "torpedo-run.ts uses Math.random");
  for (const spec of source.matchAll(/from\s+"([^"]+)"/g)) {
    assert.ok(spec[1].startsWith("./"), `torpedo-run.ts imports outside src/sim/: ${spec[1]}`);
  }
}

console.log("check-torpedo-run: 7 checks passed (release, arming, depth, swept hit, screening, stamp, purity)");
