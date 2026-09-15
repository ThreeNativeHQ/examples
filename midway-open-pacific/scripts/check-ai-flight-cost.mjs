/**
 * AI-flight cost measurement (PRD requirement after the tactical aircraft migration onto the
 * engine's `FlightModel`). The move to one `AircraftFlight` per airborne aircraft was reported to
 * turn `check-flight` and `check-carrier-cycle` from seconds into minutes; this is the honest
 * number behind that report, not a fix.
 *
 * It builds a real `Battle`, steps it at a fixed timestep and times `Battle.step` itself with
 * `performance.now()`. Three populations are grown through the game's own launch entry
 * (`Battle.launch`, the same path `start` and `updateCarrier` use) and then frozen so the timed
 * window measures the aircraft already up, not the next carrier cycle. The population is
 * `Battle.activeAircraft`, the same count the 68 cap is measured against; at the cap many of those
 * are still in launch mode on deck, and the step cost of carrying them is included. Percentiles
 * come from `src/sim/perf.ts`, the one documented interpolation rule AC-23 already names.
 *
 * The only assertion is AC-23's own ceiling: fixed-step CPU p95 <= 4 ms at the supported
 * population. If the migration is expensive, this fails with the measured number. That failure is
 * the deliverable.
 *
 * Run: node scripts/check-ai-flight-cost.mjs
 */
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import assert from "node:assert/strict";
import { build } from "esbuild";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const built = await build({
  stdin: {
    contents: `
      export { Battle, ACTIVE_CAP } from "./src/sim/battle.ts";
      export { percentile } from "./src/sim/perf.ts";
    `,
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
const { Battle, ACTIVE_CAP, percentile } = await import(
  `data:text/javascript,${encodeURIComponent(built.outputFiles[0].text)}`
);

/** AC-23's own fixed-step CPU ceiling, in milliseconds. Not tuned to pass. */
const CPU_P95_CEILING_MS = 4;

/** The game's fixed step (`src/game.ts`: `step: 1 / 60`), the rate AC-23's budget is written for. */
const STEP = 1 / 60;
const ROLES = ["fighter", "bomber", "torpedo"];
/** Build stops here rather than looping forever if normal entry cannot reach the target. */
const BUILD_STEPS_MAX = Math.round(300 / STEP);
const WARMUP_STEPS = 120;
const SAMPLE_STEPS = 240;

const mean = (xs) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);

/**
 * Hold the airborne population steady for the timed window. Missions are pinned past the end of
 * time so `updateCarrier` adds nothing mid-measurement, and the one scripted recon launch is
 * suppressed. The aircraft already flying are untouched; only the next cycle is held back.
 */
function freezeLaunches(b) {
  b.reconLaunched = true;
  for (const s of b.ships)
    if (s.kind === "carrier") s.mission = { kind: "none", target: null, want: {}, until: Number.POSITIVE_INFINITY };
}

/**
 * Grow a real battle to `target` live aircraft through `Battle.launch` only: each step tries every
 * carrier's real inventory and waits out the deck interval like the game does. Returns whatever was
 * actually reached, which may be short of `target`.
 */
function buildTo(target, seed) {
  const b = new Battle(seed);
  b.start(false);
  let attempt = 0;
  let steps = 0;
  while (b.activeAircraft < target && steps < BUILD_STEPS_MAX) {
    for (const s of b.ships) {
      if (b.activeAircraft >= target) break;
      if (s.kind !== "carrier" || s.sunk || !s.air) continue;
      for (let k = 0; k < ROLES.length; k += 1) {
        if (b.launch(s, ROLES[(attempt + k) % ROLES.length])) break;
      }
      attempt += 1;
    }
    b.step(STEP, {});
    steps += 1;
  }
  // The build can overshoot by a step's worth of parallel launches; keep the timed population exact.
  if (b.aircraft.length > target) b.aircraft.length = target;
  freezeLaunches(b);
  return { b, buildSteps: steps };
}

/** The one-aircraft anchor. `start` stands up the whole fleet; only one launch is left airborne. */
function isolateOne(seed) {
  const b = new Battle(seed);
  b.start(false);
  b.aircraft.length = 1;
  freezeLaunches(b);
  return { b, buildSteps: 0 };
}

/** Warm up past JIT and first-use wrapper construction, then time `SAMPLE_STEPS` leaf steps. */
function measure(b) {
  for (let i = 0; i < WARMUP_STEPS; i += 1) b.step(STEP, {});
  const before = b.activeAircraft;
  const times = [];
  for (let i = 0; i < SAMPLE_STEPS; i += 1) {
    const t0 = performance.now();
    b.step(STEP, {});
    times.push(performance.now() - t0);
  }
  const after = b.activeAircraft;
  const population = (before + after) / 2;
  const avg = mean(times);
  return { before, after, population, samples: times.length, mean: avg, p95: percentile(times, 0.95) };
}

/** The marginal cost between two population measurements, in microseconds per aircraft per step. */
function marginal(lo, hi) {
  return ((hi.mean - lo.mean) * 1000) / (hi.population - lo.population);
}

const scenarios = [
  { label: "~1", intended: 1, run: () => isolateOne(19420601) },
  { label: "~10", intended: 10, run: () => buildTo(10, 19420602) },
  { label: "cap", intended: ACTIVE_CAP, run: () => buildTo(ACTIVE_CAP, 19420603) },
];

const rows = [];
for (const scenario of scenarios) {
  const { b, buildSteps } = scenario.run();
  assert.equal(b.status, "playing", `${scenario.label}: the battle must be running to be measured`);
  const r = measure(b);
  assert.ok(Number.isFinite(r.p95) && r.p95 >= 0, `${scenario.label}: p95 must be a finite duration`);
  rows.push({ ...scenario, ...r, buildSteps });
}

console.log(
  `check-ai-flight-cost: fixed step ${(STEP * 1000).toFixed(1)} ms, ${WARMUP_STEPS} warm-up then ${SAMPLE_STEPS} timed steps`,
);
const cols = [10, 9, 12, 10, 9, 18];
const cell = (s, i) => String(s).padStart(cols[i]);
console.log(["pop", "intended", "achieved", "mean ms", "p95 ms", "us/aircraft/step"].map(cell).join(" "));
console.log(cols.map((w) => "-".repeat(w)).join(" "));
for (const r of rows) {
  const perAircraftUs = (r.mean * 1000) / r.population;
  console.log(
    [
      r.label,
      r.intended,
      `${r.before}->${r.after}`,
      r.mean.toFixed(3),
      r.p95.toFixed(3),
      perAircraftUs.toFixed(1),
    ]
      .map(cell)
      .join(" "),
  );
}

const low = rows[0];
const high = rows[rows.length - 1];
const m1 = marginal(low, rows[1]);
const m2 = marginal(rows[1], high);
const shape = m2 > m1 * 1.2 ? "worse than linear" : m2 < m1 * 0.8 ? "sublinear" : "linear";
console.log(
  `check-ai-flight-cost: marginal cost ${m1.toFixed(1)} us/aircraft (${low.population}->${rows[1].population}) then ` +
    `${m2.toFixed(1)} us/aircraft (${rows[1].population}->${Math.round(high.population)}) — ${shape} in this range`,
);

const pass = high.p95 <= CPU_P95_CEILING_MS;
const highPop = Math.round(high.population);
console.log(
  `check-ai-flight-cost: ${pass ? "PASS" : "FAIL"} — fixed-step CPU p95 ${high.p95.toFixed(3)} ms at ${highPop} airborne ` +
    `(AC-23 ceiling ${CPU_P95_CEILING_MS} ms)`,
);
assert.ok(
  pass,
  `fixed-step CPU p95 is ${high.p95.toFixed(3)} ms at ${highPop} airborne aircraft, over AC-23's ${CPU_P95_CEILING_MS} ms ceiling`,
);
