/**
 * Contact-intel check. Exercises the pure `src/sim/intel.ts` estimates without a browser: delivery
 * timing, dead-reckoning, uncertainty growth, the observation gate, classification decay and merge.
 * The module owns no randomness, so every assertion here is exact.
 *
 * Uses the esbuild vite already installs. Run: node scripts/check-intel.mjs
 */
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { build } from "esbuild";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const built = await build({
  stdin: { contents: 'export * from "./src/sim/intel.ts";', loader: "ts", resolveDir: root },
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node20",
  write: false,
  logLevel: "silent",
});
const {
  makeContact,
  contactAge,
  isDelivered,
  estimatePosition,
  isStale,
  canObserve,
  classify,
  mergeContact,
  STALE_SECONDS,
  DRIFT_RATE,
} = await import(`data:text/javascript,${encodeURIComponent(built.outputFiles[0].text)}`);

const base = (over = {}) =>
  makeContact({
    id: "c1",
    team: "us",
    observerId: "pby-5",
    targetId: "akagi",
    observedAt: 100,
    delay: 20,
    x: 0,
    z: 0,
    heading: 0,
    speed: 40,
    errorRadius: 0,
    classification: "carrier",
    confidence: 1,
    ...over,
  });

// 1 — delivery is stamped at sighting plus the delay.
{
  const c = base();
  assert.equal(c.deliveredAt, 120, `deliveredAt should be observedAt + delay, got ${c.deliveredAt}`);
  const d = base({ observedAt: 300, delay: 7 });
  assert.equal(d.deliveredAt, 307, "deliveredAt must track both observedAt and delay");
}

// 2 — a report is undelivered before its time and delivered at and after it.
{
  const c = base();
  assert.equal(isDelivered(c, 119.999), false, "must be undelivered just before deliveredAt");
  assert.equal(isDelivered(c, 120), true, "must be delivered exactly at deliveredAt");
  assert.equal(isDelivered(c, 121), true, "must stay delivered after deliveredAt");
}

// 3 — dead-reckoning advances along heading at speed.
{
  const c = base({ observedAt: 10, x: 0, z: 0, heading: 0, speed: 40 });
  const p = estimatePosition(c, 12);
  assert.ok(Math.abs(p.x - 0) < 1e-9, `heading 0 should not move x, got ${p.x}`);
  assert.ok(Math.abs(p.z - -80) < 1e-9, `heading 0 at 40 m/s for 2 s should put z at -80, got ${p.z}`);
  const e = base({ observedAt: 10, x: 0, z: 0, heading: Math.PI / 2, speed: 40 });
  const q = estimatePosition(e, 12);
  assert.ok(Math.abs(q.x - 80) < 1e-9 && Math.abs(q.z) < 1e-9, `east heading should move x to 80, got (${q.x}, ${q.z})`);
  assert.equal(contactAge(c, 12), 2, "contactAge is now minus observedAt");
}

// 4 — uncertainty grows with age and three times as fast once the contact is lost.
{
  const c = base({ errorRadius: 10 });
  const fresh = estimatePosition(c, 110);
  const older = estimatePosition(c, 150);
  assert.ok(older.radius > fresh.radius, "radius must grow with age");
  assert.equal(fresh.radius, 10 + DRIFT_RATE * 10, `radius should be errorRadius + drift * age, got ${fresh.radius}`);
  const lost = base({ errorRadius: 10, lost: true });
  const l = estimatePosition(lost, 150);
  assert.equal(l.radius, 10 + DRIFT_RATE * 50 * 3, `a lost contact should drift three times as fast, got ${l.radius}`);
}

// 5 — staleness is the 240-second window from the existing code.
{
  const c = base({ observedAt: 0 });
  assert.equal(STALE_SECONDS, 240, "STALE_SECONDS must remain 240");
  assert.equal(isStale(c, 239, STALE_SECONDS), false, "239 s is not stale");
  assert.equal(isStale(c, 241, STALE_SECONDS), true, "241 s is stale");
}

// 6 — the horizon, not the range limit, separates a low observer from a high one.
{
  const observer = { x: 0, z: 0 };
  const target = { x: 8000, z: 0 };
  const low = { observer, target, observerAltitude: 2, targetAltitude: 0, rangeLimit: 30000, visibility: 1, sightDepth: 20 };
  const high = { ...low, observerAltitude: 30 };
  assert.equal(canObserve(low), false, "a 2 m observer cannot see 8 km to the horizon");
  assert.equal(canObserve(high), true, "a 30 m observer can see the same 8 km");
}

// 7 — a submarine below the sight depth is unobservable; shallower than it is visible.
{
  const args = {
    observer: { x: 0, z: 0 },
    target: { x: 500, z: 0 },
    observerAltitude: 30,
    targetAltitude: -50,
    rangeLimit: 30000,
    visibility: 1,
    sightDepth: 20,
  };
  assert.equal(canObserve(args), false, "a target below sightDepth must not be observed");
  assert.equal(canObserve({ ...args, targetAltitude: -5 }), true, "a target above sightDepth is observable");
}

// 8 — classification is honest up close, unknown far out, and never touches Math.random.
{
  const original = Math.random;
  Math.random = () => {
    throw new Error("classify must not call Math.random");
  };
  try {
    const near = classify({ truth: "carrier", range: 0, random: 0.5 });
    assert.equal(near.classification, "carrier", `a point-blank carrier must read as a carrier, got ${near.classification}`);
    assert.ok(near.confidence > 0.9, `near confidence should be near 1, got ${near.confidence}`);
    const far = classify({ truth: "carrier", range: 60000, random: 0.5 });
    assert.equal(far.classification, "unknown", `a distant carrier must decay to unknown, got ${far.classification}`);
    const mid = classify({ truth: "carrier", range: 4500, random: 0 });
    assert.notEqual(mid.classification, "carrier", "a mid-range carrier should be degraded below its true type");
  } finally {
    Math.random = original;
  }
}

// 9 — merging keeps the fresher observation, and the smaller error on a tie.
{
  const old = base({ observedAt: 100, errorRadius: 200 });
  const fresh = base({ observedAt: 130, errorRadius: 300 });
  assert.equal(mergeContact(old, fresh), fresh, "the fresher observation must win");
  assert.equal(mergeContact(fresh, old), fresh, "order of arguments must not change the winner");
  const tight = base({ observedAt: 100, errorRadius: 50 });
  const loose = base({ observedAt: 100, errorRadius: 150 });
  assert.equal(mergeContact(loose, tight), tight, "on equal times the smaller errorRadius wins");
}

// 10 — identical inputs give identical outputs.
{
  const c = base();
  assert.deepEqual(estimatePosition(c, 140), estimatePosition(c, 140), "estimatePosition must be pure");
  assert.deepEqual(
    classify({ truth: "cruiser", range: 3000, random: 0.25 }),
    classify({ truth: "cruiser", range: 3000, random: 0.25 }),
    "classify must be pure",
  );
}

// 11 — visibility scales the range achieved rather than gating it on and off.
{
  const args = {
    observer: { x: 0, z: 0 },
    target: { x: 8000, z: 0 },
    observerAltitude: 30,
    targetAltitude: 0,
    rangeLimit: 10000,
    visibility: 1,
    sightDepth: 20,
  };
  assert.equal(canObserve(args), true, "visibility 1 sees a target just inside rangeLimit");
  assert.equal(canObserve({ ...args, visibility: 0.5 }), false, "visibility 0.5 halves the range and misses the same target");
  assert.equal(
    canObserve({ ...args, target: { x: 4000, z: 0 }, visibility: 0.5 }),
    true,
    "visibility 0.5 still sees a target at half the range",
  );
}

// 12 — zero visibility observes nothing, even a target at zero range.
{
  const args = {
    observer: { x: 0, z: 0 },
    target: { x: 0, z: 0 },
    observerAltitude: 30,
    targetAltitude: 0,
    rangeLimit: 30000,
    visibility: 0,
    sightDepth: 20,
  };
  assert.equal(canObserve(args), false, "visibility 0 must observe nothing at point-blank range");
  assert.equal(canObserve({ ...args, target: { x: 500, z: 0 } }), false, "visibility 0 must observe nothing at any range");
}

// 13 — the horizon still caps even a full-visibility observer.
{
  const args = {
    observer: { x: 0, z: 0 },
    target: { x: 8000, z: 0 },
    observerAltitude: 2,
    targetAltitude: 0,
    rangeLimit: 30000,
    visibility: 1,
    sightDepth: 20,
  };
  assert.equal(canObserve(args), false, "a low observer cannot see past its horizon at visibility 1");
}

// 14 — the depth gate is independent of visibility.
{
  const args = {
    observer: { x: 0, z: 0 },
    target: { x: 500, z: 0 },
    observerAltitude: 30,
    targetAltitude: -50,
    rangeLimit: 30000,
    visibility: 1,
    sightDepth: 20,
  };
  assert.equal(canObserve(args), false, "a deep submarine stays unseen at full visibility");
}

// 15 — canObserve is pure: identical calls agree and no argument is mutated.
{
  const observer = Object.freeze({ x: 0, z: 0 });
  const target = Object.freeze({ x: 4000, z: 0 });
  const args = Object.freeze({
    observer,
    target,
    observerAltitude: 30,
    targetAltitude: 0,
    rangeLimit: 10000,
    visibility: 0.5,
    sightDepth: 20,
  });
  const first = canObserve(args);
  const second = canObserve(args);
  assert.equal(first, second, "identical calls must return identical results");
  assert.deepEqual(observer, { x: 0, z: 0 }, "canObserve must not mutate the observer");
  assert.deepEqual(target, { x: 4000, z: 0 }, "canObserve must not mutate the target");
}

console.log("check-intel: 15 checks passed");
