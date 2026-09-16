/**
 * Steady-state frame timing, on a named adapter, at a fixed resolution, under a real workload.
 *
 * No trustworthy figure existed for this game: previous numbers were taken during loading or
 * shader compilation, which measures the wrong thing. This waits for the startup gate, then flies
 * and burns a warm-up before it records anything, and reports the distribution rather than an
 * average — a mean hides exactly the stutters a player notices. It names the GPU it ran on and
 * says what else was drawing at the time, because a benchmark that does not is not evidence.
 *
 * It reports whether the run actually qualifies for AC-23, rather than announcing a pass for any
 * run: the approved workload, the declared population envelope, finite observations, the absolute
 * budgets and a matched baseline are all required before "PASS" is printed. An attribution run
 * (reduced resolution/time, a hidden layer) reports its metrics but is explicitly non-qualifying.
 *
 * Capture against an HMR-disabled server on the same primary source: a hot update mid-sample
 * disposes the renderer and zeroes its metrics. Start one with Vite's JS API, `server.hmr: false`,
 * on a free port, and point MIDWAY_URL at it; never copy the source tree or create a worktree.
 */
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { build } from "esbuild";
import { chromium } from "playwright";

const URL = process.env.MIDWAY_URL || "http://127.0.0.1:5198";
// AC-23 fixes the workload at 1920x1080 for a 60-second sample; the env overrides stay for
// attribution runs, which are reported but never qualify.
const WIDTH = Number(process.env.MIDWAY_WIDTH || 1920);
const HEIGHT = Number(process.env.MIDWAY_HEIGHT || 1080);
const WARMUP = Number(process.env.MIDWAY_WARMUP || 8);
const SAMPLE = Number(process.env.MIDWAY_SAMPLE || 60);
// The crowd fixture fills the battle to ACTIVE_CAP through Battle.launch only, so the sample runs
// at the declared supported population instead of the natural plateau. It is labelled a fixture,
// never a natural battle; no AI/task field, inventory or cap is touched to make it pass.
const CROWD = !!process.env.MIDWAY_CROWD;
// The two fixtures PRD-midway-trace-20260914-performance adds, for AC-6. They are deliberately not
// AC-23 workloads and can never print its verdict: they exist to expose the CPU the old leaf
// `Battle.step` timer never saw. `cockpit` is real flight seen from the pilot's seat; `water-impact`
// is a carrier under repeated water events, which is where the wave/hull queries actually cost.
const WORKLOAD = process.env.MIDWAY_WORKLOAD || null;
if (WORKLOAD !== null && WORKLOAD !== "cockpit" && WORKLOAD !== "water-impact")
  throw new Error(`MIDWAY_WORKLOAD must be cockpit or water-impact, got ${JSON.stringify(WORKLOAD)}`);
if (WORKLOAD && CROWD) throw new Error("MIDWAY_WORKLOAD and MIDWAY_CROWD are different workloads; set one");
// Both fixtures start their sample at the same predeclared battle-time tick, after the wall-clock
// warm-up, so a candidate is never credited for a quieter section of the same battle.
const START_TICK = Number(process.env.MIDWAY_START_TICK || 12);
// One scheduled water event every four battle seconds. A wall-clock timer would fire a different
// number of events on a slower build, which is the comparison quietly measuring itself.
const IMPACT_PERIOD = 4;
// The two fixtures sample a fixed window of BATTLE time, not of wall time.
//
// The PRD asked for a sixty wall-second sample and a simulated duration matched to 0.1 s. On a
// machine whose fixed-step loop is clamping its catch-up those two cannot both hold: battle seconds
// per wall second is exactly what varies with load and with the change under test, so a wall-clock
// window hands each side a different slice of the battle and then compares them. Sampling a fixed
// battle window instead makes both sides cover the *same* section of the same battle — which is
// what the matching rule exists to guarantee — and a faster build simply finishes it sooner.
// MIDWAY_WALL_CAP bounds the wall time so a stalled run fails instead of hanging.
const SAMPLE_TICKS = Number(process.env.MIDWAY_SAMPLE_TICKS || 30);
const WALL_CAP = Number(process.env.MIDWAY_WALL_CAP || 240);
// Opt-in CDP CPU profile, off unless a path is given, so the default run opens no CDP session and
// measures exactly as before. The warm-up is never profiled.
const CPU_PROFILE = process.env.MIDWAY_CPU_PROFILE_OUT || null;
// AC-23's approved envelope: the live-aircraft ceiling Battle enforces (`ACTIVE_CAP` in
// src/sim/battle.ts). It is fixed and never env-overridable, because an override could only lower
// the bar. A 30-minute natural run was measured to plateau at 22, so the current natural battle
// does not reach 68 and the run is labelled non-qualifying rather than faked up.
const REQUIRED_AIRCRAFT = 68;
// The warm-up and quality the approved run is defined at. An attribution run may use another, and
// then cannot qualify.
const REQUIRED_WARMUP = 8;
const REQUIRED_QUALITY = "balanced";

/**
 * Baseline schema. Bumped when the recorded fields change, so a comparison can never silently read
 * an old record that has no full-CPU series in it at all and call the missing data a match.
 */
const SCHEMA_VERSION = 2;

/** Fields that must match for a baseline to be a matched baseline. */
const BASELINE_FIELDS = [
  "width",
  "height",
  "pixelRatio",
  "quality",
  "warmup",
  "sample",
  "seed",
  "damage",
  "input",
  "requiredAircraft",
  "hidden",
  "workload",
  "startTick",
  "sampleTicks",
];

/**
 * The CPU series the trace analysis showed were missing. `updateRenderCpu` is the presented-work
 * total — scene update since the previous outer render, plus that render — and the others are its
 * named components, reported separately so a win in one is never spread across the rest. None of
 * them is whole-callback time: engine work outside these wrappers is not in here.
 */
const CPU_SERIES = ["updateRenderCpu", "sceneUpdateCpu", "worldUpdateCpu", "rippleUpdateCpu", "renderCpu"];

/** The candidate's source identity, so a recorded baseline names the bytes it measured. */
function sourceDigest() {
  const cwd = join(import.meta.dirname, "..");
  try {
    const head = execSync("git rev-parse HEAD", { cwd }).toString().trim();
    const diff = execSync("git diff HEAD -- . ; git ls-files --others --exclude-standard -- .", { cwd }).toString();
    return { head, diffDigest: createHash("sha256").update(diff).digest("hex").slice(0, 12) };
  } catch {
    return { head: null, diffDigest: null };
  }
}

/** A timing series is an observation only if it has samples and a finite p95. */
function isFiniteTiming(s) {
  return !!s && Number.isInteger(s.samples) && s.samples > 0 && Number.isFinite(s.p95);
}

/** Every way `base` fails to match the current run's workload metadata, including missing keys. */
function baselineMismatches(base, current) {
  if (!base || typeof base !== "object") return ["baseline is not an object"];
  const out = [];
  // A record written before the full-CPU series existed describes a different measurement. Reject
  // it by schema rather than letting `undefined` metrics compare as absent-and-therefore-fine.
  if (base.schema !== SCHEMA_VERSION) out.push(`baseline schema ${JSON.stringify(base.schema)} != ${SCHEMA_VERSION}`);
  for (const metric of CPU_SERIES)
    if (!Number.isFinite(base[`${metric}P95`])) out.push(`baseline ${metric}P95 is not finite`);
  if (JSON.stringify(base.adapter) !== JSON.stringify(current.adapter))
    out.push(`adapter ${JSON.stringify(base.adapter)} != ${JSON.stringify(current.adapter)}`);
  for (const f of BASELINE_FIELDS) {
    if (base[f] === undefined) out.push(`baseline missing ${f}`);
    else if (base[f] !== current[f]) out.push(`${f} ${JSON.stringify(base[f])} != ${JSON.stringify(current[f])}`);
  }
  for (const f of ["gpuP95", "cpuP95"]) if (!Number.isFinite(base[f])) out.push(`baseline ${f} is not finite`);
  // A baseline only matches the qualified workload if it, too, observed the declared population
  // envelope. A baseline recorded at 22 aircraft cannot stand in for a 68-aircraft requirement.
  if (!base.population || !Number.isFinite(base.population.min) || !Number.isFinite(base.population.max))
    out.push("baseline missing population envelope");
  else if (base.population.min < current.requiredAircraft)
    out.push(`baseline observed population ${base.population.min}/${base.population.max} below declared envelope ${current.requiredAircraft}`);
  return out;
}

/**
 * Why a run does not qualify for AC-23, using the fixed approved bar — never the env overrides used
 * for attribution. The population check is on the observed minimum, so one crowded frame cannot
 * qualify a mostly empty sample.
 */
function qualificationReasons(meta, pop, relativePass) {
  const reasons = [];
  if (meta.width !== 1920 || meta.height !== 1080) reasons.push(`resolution ${meta.width}x${meta.height} is not 1920x1080`);
  if (meta.sample !== 60) reasons.push(`sample ${meta.sample}s is not 60s`);
  if (meta.warmup !== REQUIRED_WARMUP) reasons.push(`warm-up ${meta.warmup}s is not the required ${REQUIRED_WARMUP}s`);
  if (meta.quality !== REQUIRED_QUALITY) reasons.push(`quality ${meta.quality} is not the required ${REQUIRED_QUALITY}`);
  if (meta.pixelRatio !== 1) reasons.push(`pixel ratio ${meta.pixelRatio} is not 1`);
  if (meta.hidden) reasons.push(`MIDWAY_HIDE=${meta.hidden} disables a layer`);
  if (!(pop.aircraftMin >= REQUIRED_AIRCRAFT))
    reasons.push(`observed minimum ${pop.aircraftMin} active aircraft below declared envelope ${REQUIRED_AIRCRAFT} across the sample`);
  if (!relativePass) reasons.push("relative \u226410% clause UNVERIFIED");
  return reasons;
}

/**
 * Every way a fixture failed to be the thing it claims to measure. A cockpit sample that left the
 * cockpit, or a water sample whose water never moved, is a missing observation: reporting its
 * timings as if the workload had run is how a benchmark measures the wrong scene and calls it fast.
 */
function workloadEvidenceFailures(workload, evidence, sampleSeconds) {
  const out = [];
  if (evidence.status !== "playing") out.push(`battle status ${evidence.status} is not a running battle`);
  // Relative to the sample, not an absolute number of seconds: the fixed-step loop clamps its
  // catch-up, so a heavily loaded machine advances less battle time per wall second, and an
  // absolute floor would reject a short attribution run that ran perfectly well.
  const wanted = evidence.sampleTicks ?? sampleSeconds;
  if (!(evidence.simSeconds >= wanted * (evidence.sampleTicks ? 0.999 : 0.5)))
    out.push(`the battle clock did not advance across the sample: ${evidence.simSeconds}s of ${wanted}s`);
  if (workload === "cockpit") {
    if (evidence.cameraMode !== 1) out.push(`camera mode ${evidence.cameraMode} is not the cockpit`);
    if (!(evidence.playerHp > 0)) out.push("the player crashed during the sample");
  }
  if (workload === "water-impact") {
    if (!(evidence.acceptedImpacts > 0)) out.push(`the water accepted ${evidence.acceptedImpacts} impacts`);
    if (!(evidence.whitewaterMax > 0)) out.push("no active whitewater was observed");
    if (!(evidence.energyMax > 0)) out.push("wave energy never became positive");
  }
  return out;
}

/**
 * Time every outermost call of `owner[key]`, preserving `this`, the arguments, the return value and
 * any exception, and return the undo. A re-entrant call — the water's reflection pass and the
 * shadow passes both re-enter `renderer.render` — is charged once, to the outer call that contains
 * it, so the same milliseconds are never counted twice.
 *
 * This is the one definition. `--self-check` exercises it in node against a controlled recursive
 * fixture, and the sample below rehydrates this exact source inside the page.
 */
function wrapCalls(owner, key, record) {
  const original = owner[key];
  let depth = 0;
  owner[key] = function (...args) {
    depth += 1;
    const outer = depth === 1;
    const started = outer ? performance.now() : 0;
    try {
      return original.apply(this, args);
    } finally {
      depth -= 1;
      if (outer) record(performance.now() - started);
    }
  };
  return () => {
    owner[key] = original;
  };
}

/** Median of a run's p95 values. Defined here so `--self-check` needs no bundling step. */
function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const k = (sorted.length - 1) / 2;
  return sorted.length % 2 === 1 ? sorted[k] : (sorted[k - 0.5] + sorted[k + 0.5]) / 2;
}

/** AC-6's improvement target and the per-component regression limit, in one place. */
const IMPROVEMENT_RATIO = 0.8;
const COMPONENT_RATIO = 1.1;

/**
 * AC-6's arithmetic: the median of the per-run p95s on each side, then one ratio per metric.
 * Independently calculated p95 values are never added together, and a zero or missing baseline is
 * reported as an absolute figure rather than divided into. Every fixture-matching rule the PRD
 * names is applied first: a faster candidate measured over a different slice of the same battle,
 * a different number of accepted impacts or a different population is not a comparison at all.
 */
function compareWorkload(before, after) {
  const failures = [];
  const lines = [];
  if (!before.length || !after.length) return { failures: ["both sides need at least one run"], lines };
  const reference = before[0];
  for (const run of [...before, ...after]) {
    const at = run.file ?? "run";
    if (run.schema !== SCHEMA_VERSION) failures.push(`${at}: schema ${JSON.stringify(run.schema)} != ${SCHEMA_VERSION}`);
    if (run.source?.concurrentChange) failures.push(`${at}: source changed during the sample`);
    if (JSON.stringify(run.adapter) !== JSON.stringify(reference.adapter)) failures.push(`${at}: different adapter`);
    for (const field of BASELINE_FIELDS)
      if (run[field] !== reference[field])
        failures.push(`${at}: ${field} ${JSON.stringify(run[field])} != ${JSON.stringify(reference[field])}`);
    for (const field of ["aircraftMin", "aircraftMax", "shipsMin", "shipsMax"])
      if (run.fixture?.[field] !== reference.fixture?.[field])
        failures.push(`${at}: fixture ${field} ${JSON.stringify(run.fixture?.[field])} != ${JSON.stringify(reference.fixture?.[field])}`);
    if (run.fixture?.acceptedImpacts !== reference.fixture?.acceptedImpacts)
      failures.push(`${at}: accepted impacts ${run.fixture?.acceptedImpacts} != ${reference.fixture?.acceptedImpacts}`);
    if (!(Math.abs((run.fixture?.simStart ?? NaN) - (reference.fixture?.simStart ?? NaN)) <= 1 / 60))
      failures.push(`${at}: sample starts at battle time ${run.fixture?.simStart} not ${reference.fixture?.simStart} (limit 1/60 s)`);
    if (!(Math.abs((run.fixture?.simSeconds ?? NaN) - (reference.fixture?.simSeconds ?? NaN)) <= 0.1))
      failures.push(`${at}: sample covers ${run.fixture?.simSeconds}s of battle not ${reference.fixture?.simSeconds}s (limit 0.1 s)`);
  }
  for (const metric of [...CPU_SERIES, "gpu"]) {
    const key = `${metric}P95`;
    const baseline = median(before.map((r) => r[key]));
    const candidate = median(after.map((r) => r[key]));
    const target = metric === "updateRenderCpu" ? IMPROVEMENT_RATIO : COMPONENT_RATIO;
    if (!Number.isFinite(baseline) || !Number.isFinite(candidate)) {
      failures.push(`${metric}: nonfinite median (${baseline} -> ${candidate})`);
      continue;
    }
    if (!(baseline > 0)) {
      // No percentage exists. Report both absolutely and decide on the candidate alone.
      lines.push(`${metric}: baseline median ${baseline} ms, candidate median ${candidate.toFixed(3)} ms — no ratio taken`);
      if (candidate > 0) failures.push(`${metric}: baseline median is ${baseline} ms, so the ${target} ratio is undefined`);
      continue;
    }
    const ratio = candidate / baseline;
    const ok = metric === "updateRenderCpu" ? ratio <= target : ratio <= target;
    lines.push(
      `${metric}: ${baseline.toFixed(3)} -> ${candidate.toFixed(3)} ms p95 median (${((ratio - 1) * 100).toFixed(1)}%) ${ok ? "ok" : "FAIL"} vs ${target}x`,
    );
    if (!ok)
      failures.push(
        metric === "updateRenderCpu"
          ? `AC-6 improvement target missed: ${(ratio * 100).toFixed(1)}% of baseline, needs <= ${IMPROVEMENT_RATIO * 100}%`
          : `${metric} regressed to ${(ratio * 100).toFixed(1)}% of baseline, limit ${COMPONENT_RATIO * 100}%`,
      );
  }
  return { failures, lines };
}

// A framework-free provable check that the fail-closed decisions above actually reject the
// false-pass cases, including the two qualification loopholes. `--self-check`.
if (process.argv.includes("--self-check")) {
  const cur = {
    schema: SCHEMA_VERSION,
    updateRenderCpuP95: 40,
    sceneUpdateCpuP95: 20,
    worldUpdateCpuP95: 18,
    rippleUpdateCpuP95: 7,
    renderCpuP95: 21,
    adapter: { vendor: "nvidia", architecture: "turing" },
    width: 1920,
    height: 1080,
    pixelRatio: 1,
    quality: "balanced",
    warmup: 8,
    sample: 60,
    seed: 19420604,
    damage: false,
    input: "turn-right + fire",
    requiredAircraft: 68,
    hidden: null,
    workload: "crowd68-fixture",
    startTick: null,
    sampleTicks: null,
    population: { min: 68, max: 70 },
    gpuP95: 6.8,
    cpuP95: 0.7,
  };
  assert.deepEqual(baselineMismatches(cur, cur), [], "an identical baseline matches");
  assert.ok(
    baselineMismatches({ ...cur, width: 1280 }, cur).some((r) => r.includes("width")),
    "a different width is rejected",
  );
  const { width: _drop, ...noWidth } = cur;
  assert.ok(
    baselineMismatches(noWidth, cur).some((r) => r.includes("missing width")),
    "a missing width is rejected",
  );
  assert.ok(
    baselineMismatches({ ...cur, cpuP95: NaN }, cur).some((r) => r.includes("cpuP95")),
    "a nonfinite baseline timing is rejected",
  );
  assert.ok(
    baselineMismatches({ ...cur, population: { min: 22, max: 22 } }, cur).some((r) => r.includes("population")),
    "a baseline observed below the declared envelope is rejected",
  );
  assert.ok(
    baselineMismatches({ ...cur, population: undefined }, cur).some((r) => r.includes("missing population")),
    "a baseline with no observed population is rejected",
  );
  assert.ok(
    baselineMismatches({ ...cur, requiredAircraft: 1 }, cur).some((r) => r.includes("requiredAircraft")),
    "a baseline declaring a lowered envelope is rejected",
  );
  assert.ok(
    !isFiniteTiming(null) && !isFiniteTiming({ samples: 0, p95: 1 }) && !isFiniteTiming({ samples: 3, p95: NaN }),
    "missing or nonfinite observations are rejected",
  );
  assert.ok(isFiniteTiming({ samples: 3, p95: 1 }), "a finite observation is accepted");

  const qualMeta = { width: 1920, height: 1080, sample: 60, warmup: 8, quality: "balanced", pixelRatio: 1, hidden: null };
  assert.deepEqual(qualificationReasons(qualMeta, { aircraftMin: 68, aircraftMax: 70 }, true), [], "a fully qualified run passes");
  assert.ok(
    qualificationReasons(qualMeta, { aircraftMin: 3, aircraftMax: 70 }, true).some((r) => r.includes("minimum")),
    "one full-population frame does not qualify a mostly empty sample",
  );
  assert.ok(
    qualificationReasons({ ...qualMeta, warmup: 2 }, { aircraftMin: 68 }, true).some((r) => r.includes("warm-up")),
    "a lowered warm-up does not qualify",
  );
  assert.ok(
    qualificationReasons({ ...qualMeta, quality: "low" }, { aircraftMin: 68 }, true).some((r) => r.includes("quality")),
    "a lowered quality does not qualify",
  );
  assert.ok(
    qualificationReasons(qualMeta, { aircraftMin: 68 }, false).some((r) => r.includes("relative")),
    "a missing relative comparison does not qualify",
  );

  // The schema gate and the missing full-CPU series: a record from before this PRD is not a
  // baseline for it, however well its old fields match.
  const { schema: _noSchema, ...oldRecord } = cur;
  assert.ok(
    baselineMismatches(oldRecord, cur).some((r) => r.includes("schema")),
    "a pre-schema baseline is rejected",
  );
  assert.ok(
    baselineMismatches({ ...cur, updateRenderCpuP95: undefined }, cur).some((r) => r.includes("updateRenderCpuP95")),
    "a baseline with no full update+render CPU series is rejected",
  );
  assert.ok(
    baselineMismatches({ ...cur, renderCpuP95: NaN }, cur).some((r) => r.includes("renderCpuP95")),
    "a nonfinite full-CPU series is rejected",
  );

  // The nested-timer rule, on a controlled fixture: a render that re-enters itself twice is one
  // outer call and must produce exactly one observation.
  const fixtureOwner = {
    calls: 0,
    render(depth) {
      this.calls += 1;
      if (depth > 0) this.render(depth - 1);
      return `depth ${depth}`;
    },
    fail() {
      throw new Error("render failed");
    },
  };
  const observed = [];
  const undoRender = wrapCalls(fixtureOwner, "render", (ms) => observed.push(ms));
  assert.equal(fixtureOwner.render(2), "depth 2", "the wrapper returns the original result");
  assert.equal(fixtureOwner.calls, 3, "the nested calls really happened, and `this` was preserved");
  assert.equal(observed.length, 1, "a re-entrant render is charged once, to the outer call");
  assert.ok(Number.isFinite(observed[0]) && observed[0] >= 0, "the observation is a finite duration");
  fixtureOwner.render(0);
  assert.equal(observed.length, 2, "a later outer call is its own observation");
  undoRender();
  fixtureOwner.render(0);
  assert.equal(observed.length, 2, "the undo removes the wrapper");
  const failures = [];
  const undoFail = wrapCalls(fixtureOwner, "fail", (ms) => failures.push(ms));
  assert.throws(() => fixtureOwner.fail(), /render failed/, "an exception still propagates");
  assert.equal(failures.length, 1, "a throwing call is still observed, through the finally");
  undoFail();

  // AC-6's arithmetic.
  assert.equal(median([3, 1, 2]), 2, "median of three is the middle value");
  assert.equal(median([1, 3]), 2, "median of two interpolates");
  const fixture = { aircraftMin: 12, aircraftMax: 14, shipsMin: 20, shipsMax: 20, acceptedImpacts: 14, startTick: 75, sampleTicks: 30, simStart: 75, simSeconds: 30 };
  const run = (over, fx = {}) => ({ ...cur, workload: "water-impact-fixture", requiredAircraft: 0, startTick: 75, sampleTicks: 30, file: "run", fixture: { ...fixture, ...fx }, ...over });
  const before3 = [run({ updateRenderCpuP95: 50 }), run({ updateRenderCpuP95: 52 }), run({ updateRenderCpuP95: 54 })];
  const good = [run({ updateRenderCpuP95: 39 }), run({ updateRenderCpuP95: 40 }), run({ updateRenderCpuP95: 41 })];
  assert.deepEqual(compareWorkload(before3, good).failures, [], "a 23% improvement with matched components passes");
  const weak = [run({ updateRenderCpuP95: 45 }), run({ updateRenderCpuP95: 46 }), run({ updateRenderCpuP95: 47 })];
  assert.ok(
    compareWorkload(before3, weak).failures.some((r) => r.includes("AC-6 improvement target")),
    "a 12% improvement does not reach the 20% target",
  );
  assert.ok(
    compareWorkload(before3, good.map((r) => ({ ...r, renderCpuP95: 40 }))).failures.some((r) => r.includes("renderCpu regressed")),
    "a component regression beyond 10% fails even when the total improved",
  );
  assert.ok(
    compareWorkload(before3, good.map((r) => ({ ...r, fixture: { ...fixture, acceptedImpacts: 13 } }))).failures.some((r) =>
      r.includes("accepted impacts"),
    ),
    "a different accepted-impact count is not a matched comparison",
  );
  assert.ok(
    compareWorkload(before3, good.map((r) => ({ ...r, fixture: { ...fixture, simStart: 75.5 } }))).failures.some((r) =>
      r.includes("starts at battle time"),
    ),
    "a candidate measured over a later slice of the battle is rejected",
  );
  assert.ok(
    compareWorkload(before3, good.map((r) => ({ ...r, fixture: { ...fixture, simSeconds: 29 } }))).failures.some((r) =>
      r.includes("covers"),
    ),
    "a candidate covering a different simulated duration is rejected",
  );
  assert.ok(
    compareWorkload(before3, good.map((r) => ({ ...r, fixture: { ...fixture, aircraftMax: 20 } }))).failures.some((r) =>
      r.includes("aircraftMax"),
    ),
    "a different observed population is rejected",
  );
  assert.ok(
    compareWorkload(before3, good.map((r) => ({ ...r, source: { concurrentChange: true } }))).failures.some((r) =>
      r.includes("source changed"),
    ),
    "a sample taken while the source changed is rejected",
  );
  assert.ok(
    compareWorkload(before3.map((r) => ({ ...r, updateRenderCpuP95: 0 })), good).failures.some((r) => r.includes("undefined")),
    "a zero baseline is reported absolutely, never divided into",
  );
  assert.ok(
    compareWorkload(before3, good.map((r) => ({ ...r, updateRenderCpuP95: NaN }))).failures.some((r) => r.includes("nonfinite")),
    "a nonfinite candidate median fails closed",
  );

  // A fixture whose water never actually ran is a missing observation, not a fast frame.
  assert.ok(
    workloadEvidenceFailures("water-impact", { acceptedImpacts: 0, whitewaterMax: 400, energyMax: 3, sampleTicks: 30, simSeconds: 30, status: "playing" }, 60).some((r) =>
      r.includes("accepted"),
    ),
    "a water fixture that accepted no impacts is rejected",
  );
  assert.ok(
    workloadEvidenceFailures("water-impact", { acceptedImpacts: 14, whitewaterMax: 0, energyMax: 3, sampleTicks: 30, simSeconds: 30, status: "playing" }, 60).some((r) =>
      r.includes("whitewater"),
    ),
    "a water fixture with no active whitewater is rejected",
  );
  assert.ok(
    workloadEvidenceFailures("water-impact", { acceptedImpacts: 14, whitewaterMax: 400, energyMax: 0, sampleTicks: 30, simSeconds: 30, status: "playing" }, 60).some((r) =>
      r.includes("energy"),
    ),
    "a water fixture whose wave energy never rose is rejected",
  );
  assert.deepEqual(
    workloadEvidenceFailures("water-impact", { acceptedImpacts: 14, whitewaterMax: 400, energyMax: 3, sampleTicks: 30, simSeconds: 30, status: "playing" }, 60),
    [],
    "a real water fixture passes",
  );
  assert.ok(
    workloadEvidenceFailures("cockpit", { cameraMode: 2, playerHp: 3, status: "playing", simSeconds: 60 }, 60).some((r) => r.includes("camera")),
    "a cockpit fixture that left the cockpit is rejected",
  );
  assert.ok(
    workloadEvidenceFailures("cockpit", { cameraMode: 1, playerHp: 3, status: "debrief", simSeconds: 60 }, 60).some((r) => r.includes("status")),
    "a cockpit fixture that ended in debrief is rejected",
  );
  assert.ok(
    workloadEvidenceFailures("cockpit", { cameraMode: 1, playerHp: 0, status: "playing", simSeconds: 60 }, 60).some((r) => r.includes("crashed")),
    "a cockpit fixture whose player crashed is rejected",
  );
  assert.ok(
    workloadEvidenceFailures("cockpit", { cameraMode: 1, playerHp: 3, status: "playing", simSeconds: 1 }, 60).some((r) => r.includes("advance")),
    "a cockpit fixture whose battle clock stalled is rejected",
  );
  console.log("self-check PASS");
  process.exit(0);
}

// `--compare <before,before,before> <after,after,after>`: AC-6 from recorded runs, never from a
// single sample. It reads only files this tool wrote.
if (process.argv.includes("--compare")) {
  const at = process.argv.indexOf("--compare");
  const [beforeList, afterList] = process.argv.slice(at + 1, at + 3);
  if (!beforeList || !afterList)
    throw new Error("--compare needs two comma-separated lists of baseline files: before and after");
  const load = async (list) =>
    Promise.all(
      list
        .split(",")
        .filter(Boolean)
        .map(async (file) => ({ ...JSON.parse(await readFile(file, "utf8")), file })),
    );
  const { failures, lines } = compareWorkload(await load(beforeList), await load(afterList));
  console.log(lines.join("\n"));
  if (failures.length) {
    console.log(`AC-6 FAIL:\n  ${failures.join("\n  ")}`);
    process.exit(1);
  }
  console.log("AC-6 PASS: full update+render CPU p95 median improved at least 20% with no component regression beyond 10%");
  process.exit(0);
}

// AC-23's statistics and absolute verdict live in src/sim/perf.ts and are used from there, never
// re-derived here: a p95 computed two ways is how a performance claim drifts. Node cannot import
// TypeScript directly, so bundle the pure module the way scripts/check-perf.mjs does. The dynamic
// import is an expression, so it runs only after the `--self-check` fast path above has exited.
const { percentile, verdict, regression, format, REGRESSION_LIMIT_PCT } = await import(
  `data:text/javascript,${encodeURIComponent(
    (
      await build({
        stdin: {
          contents: 'export * from "./src/sim/perf.ts";',
          loader: "ts",
          resolveDir: join(import.meta.dirname, ".."),
        },
        bundle: true,
        format: "esm",
        platform: "node",
        target: "node20",
        write: false,
        logLevel: "silent",
      })
    ).outputFiles[0].text,
  )}`
);

// `--trace <file.json.gz> [--against a.json,b.json,...]`: recompute the supplied recording's own
// figures from its bytes and put them beside this change's measured ones.
//
// What this is: the diagnostic recording PRD-midway-trace-20260914-performance was written from,
// recomputed here in node with the SAME percentile rule as everything else (src/sim/perf.ts), so
// the numbers quoted in that document can be re-derived rather than trusted.
//
// What this is NOT: a matched baseline. The recording was taken on a normal desktop session with
// DevTools attached, at an unknown drawing-buffer size, over an uncontrolled slice of play; these
// captures run headed on a virtual display under whatever else this machine is doing. Two named
// biases, in opposite directions, and neither is quantified:
//
//   - `FixedStepLoop.#frameCallback` is the WHOLE game callback. `updateRenderCpu` is a subset of
//     it: scene update since the previous outer render, plus that render. Engine work inside the
//     callback but outside those wrappers — clustered reconciliation, and whatever else the loop
//     does — is in the trace's number and not in ours. This flatters us.
//   - The trace ran with a profiler attached, which inflates it; and these runs share a loaded
//     machine with other work, which inflates us.
//
// So a win here is corroboration, not proof. AC-6's matched before/after captures are the proof.
if (process.argv.includes("--trace")) {
  const at = process.argv.indexOf("--trace");
  const file = process.argv[at + 1];
  if (!file) throw new Error("--trace needs a path to a DevTools .json.gz recording");
  const againstAt = process.argv.indexOf("--against");
  const against = againstAt === -1 ? [] : (process.argv[againstAt + 1] ?? "").split(",").filter(Boolean);

  const bytes = await readFile(file);
  const digest = createHash("sha256").update(bytes).digest("hex");
  const { gunzipSync } = await import("node:zlib");
  const trace = JSON.parse(gunzipSync(bytes).toString("utf8"));
  const events = trace.traceEvents ?? trace;

  // The recording names its own renderer process and main thread; find them rather than hardcoding
  // the pid from the document, so this still works on a different recording of the same game.
  const callbacksBy = new Map();
  for (const e of events)
    if (
      e.ph === "X" &&
      e.name === "FunctionCall" &&
      e.args?.data?.functionName === "FixedStepLoop.#frameCallback"
    ) {
      const key = `${e.pid}/${e.tid}`;
      if (!callbacksBy.has(key)) callbacksBy.set(key, []);
      callbacksBy.get(key).push(e);
    }
  const [key, callbacks] = [...callbacksBy.entries()].sort((a, b) => b[1].length - a[1].length)[0] ?? [];
  assert.ok(callbacks?.length, "the recording contains no FixedStepLoop.#frameCallback events");
  const [pid, tid] = key.split("/").map(Number);

  // The selected window is the span the callbacks themselves cover, and only complete events
  // wholly inside it are counted — the rule the PRD's own snippet uses.
  const starts = callbacks.map((e) => e.ts).sort((a, b) => a - b);
  const lo = starts[0];
  const hi = Math.max(...callbacks.map((e) => e.ts + (e.dur ?? 0)));
  const durations = callbacks.map((e) => e.dur / 1000);
  const tasks = events.filter(
    (e) => e.pid === pid && e.tid === tid && e.ph === "X" && e.name === "RunTask" && e.ts >= lo && e.ts + (e.dur ?? 0) <= hi,
  );
  const window = (hi - lo) / 1e6;
  const recording = {
    file,
    sha256: digest,
    process: key,
    callbacks: callbacks.length,
    windowSeconds: +window.toFixed(6),
    cadencePerSecond: +(((starts.length - 1) * 1e6) / (starts[starts.length - 1] - starts[0])).toFixed(4),
    callbackP50: percentile(durations, 0.5),
    callbackP95: percentile(durations, 0.95),
    callbackP99: percentile(durations, 0.99),
    callbackWorst: durations.reduce((m, x) => (x > m ? x : m), 0),
    mainBusyPct: +((100 * tasks.reduce((n, e) => n + e.dur, 0)) / (hi - lo)).toFixed(2),
    longTasks: tasks.filter((e) => e.dur > 50000).length,
  };
  console.log(`recording ${JSON.stringify(recording, null, 2)}`);

  if (!against.length) {
    console.log("no --against records supplied; nothing compared");
    process.exit(0);
  }
  const records = await Promise.all(
    against.map(async (f) => ({ ...JSON.parse(await readFile(f, "utf8")), file: f })),
  );
  for (const r of records)
    assert.ok(Number.isFinite(r.updateRenderCpuP95), `${r.file} has no finite updateRenderCpuP95`);
  const mine = median(records.map((r) => r.updateRenderCpuP95));
  const ratio = mine / recording.callbackP95;
  console.log(
    [
      "",
      `recording  FixedStepLoop.#frameCallback p95   ${recording.callbackP95.toFixed(2)} ms  (whole callback, ${recording.callbacks} calls, ${recording.mainBusyPct}% main-thread busy)`,
      `candidate  updateRenderCpu p95 median         ${mine.toFixed(2)} ms  (subset: scene update + outer render, ${records.length} runs on ${records[0].workload})`,
      `           ${((1 - ratio) * 100).toFixed(1)}% of the recorded p95 removed — corroboration, not proof; see the two biases above`,
      "",
    ].join("\n"),
  );
  assert.ok(
    mine < recording.callbackP95,
    `the measured update+render p95 (${mine.toFixed(2)} ms) does not beat the recorded callback p95 (${recording.callbackP95.toFixed(2)} ms)`,
  );
  console.log("PASS: every supplied run's update+render p95 median is below the recorded callback p95");
  process.exit(0);
}

// Checkout refs at the start of the run; the digest is not an exact fingerprint of the loaded
// module bytes (a dev server may transform them), and concurrent edits are disclosed below.
const checkoutBefore = sourceDigest();

const browser = await chromium.launch({
  headless: false,
  args: [
    "--enable-unsafe-webgpu",
    "--enable-features=Vulkan",
    "--disable-gpu-sandbox",
    "--ignore-gpu-blocklist",
    "--ozone-platform=x11",
    // Timestamp queries are behind Dawn's unsafe-API flag; without them the only clock available
    // is wall time, and wall time here measures the virtual display, not the game.
    "--enable-dawn-features=allow_unsafe_apis",
  ],
});
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT } });
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await page.goto(URL);
  await page.waitForSelector("#loading.hidden", { state: "attached", timeout: 120000 });
  await page.waitForSelector("#briefing:not(.hidden)");
  await page.evaluate(async () => {
    const url = performance
      .getEntriesByType("resource")
      .map((e) => e.name)
      .findLast((n) => /\/src\/game\.ts(?:\?|$)/.test(n));
    window.midway = (await import(url)).default.scene;
  });

  const adapter = await page.evaluate(async () => {
    const a = await navigator.gpu.requestAdapter();
    return {
      vendor: a.info.vendor,
      architecture: a.info.architecture,
      device: a.info.device,
      description: a.info.description,
    };
  });
  assert.ok(
    !/swiftshader|lavapipe|llvmpipe/i.test(JSON.stringify(adapter)),
    `software adapter, the figure would be meaningless: ${JSON.stringify(adapter)}`,
  );

  // Airborne start puts the battle in progress: aircraft aloft, AI flying, ships under way.
  await page.click("#start-air");
  const seconds = async (n) => {
    const t = await page.evaluate(() => window.midway.battle.time);
    await page.waitForFunction((u) => window.midway.battle.time >= u, t + n, {
      timeout: Math.max(30000, n * 4000),
    });
  };

  // MIDWAY_CROWD is the explicitly labelled population fixture, not a natural battle. It fills to
  // ACTIVE_CAP through the public Battle.launch entry, consuming each carrier's real finite
  // inventory; no aircraft record, task/AI field, inventory count or cap is synthesised, no layer
  // is hidden, and the player keeps its normal flight state and normal input. Only camera framing
  // is decoupled: the game's own `updateCamera` still runs for its side effects, then a fixed
  // observation vantage is applied. Mesh LOD/range visibility stays the game's player-relative
  // decision, so the render counts below are measured from real scene meshes, not positions.
  if (CROWD)
    await page.evaluate((cap) => {
      const b = window.midway.battle;
      const w = window.midway.world;
      const carriers = b.ships.filter((s) => s.kind === "carrier" && !s.sunk && s.air);
      const roles = ["fighter", "bomber", "torpedo"];
      let guard = 0;
      while (b.activeAircraft < cap && guard < 40000) {
        for (const s of carriers) {
          if (b.activeAircraft >= cap) break;
          for (const role of roles) {
            const before = b.activeAircraft;
            b.launch(s, role);
            if (b.activeAircraft > before) break;
          }
        }
        b.step(1 / 60, {});
        guard += 1;
      }
      const air = b.aircraft.filter((a) => a.hp > 0);
      const cx = air.reduce((n, a) => n + a.x, 0) / Math.max(1, air.length);
      const cz = air.reduce((n, a) => n + a.z, 0) / Math.max(1, air.length);
      const orig = w.updateCamera.bind(w);
      w.updateCamera = function (dt, briefing, time) {
        orig(dt, briefing, time);
        this.camera.position.set(cx, 5000, cz + 8000);
        this.camera.up.set(0, 1, 0);
        this.camera.fov = 60;
        this.camera.lookAt(cx, 100, cz);
        this.camera.updateProjectionMatrix();
        this.camera.updateMatrixWorld();
      };
      w.setCamera(2);
    }, REQUIRED_AIRCRAFT);

  // The cockpit fixture is the ordinary game seen from the pilot's seat: the interior, its
  // instruments and the canopy are all drawn, which is the scene the trace was recorded in. Nothing
  // is hidden, no invulnerability is invented, and the aircraft flies on real input.
  if (WORKLOAD === "cockpit") await page.evaluate(() => window.midway.world.setCamera(1));

  // The water fixture holds a carrier under repeated water events. The first one is a real
  // `damageShip` torpedo hit at the hull side, exactly as capture-fluid-lab.mjs makes it; every
  // later one is the equivalent `fx('splash')` water event, so the sample keeps producing water
  // work without sinking the same ship fifteen times to manufacture a workload. This is a fixture,
  // not a player sortie. The schedule fires on the first fixed update to reach each four-second
  // battle-time boundary, never on a wall-clock timer, so a slower build sees the same events.
  //
  // It is installed on `Battle.step` before the warm-up, so the water is already active when the
  // sample starts. The leaf-step CPU timer installed later therefore wraps it: the injection cost
  // lands inside about fifteen of some three thousand timed steps, identically on both sides of a
  // comparison, and is far below the p95 rank.
  if (WORKLOAD === "water-impact")
    await page.evaluate((period) => {
      const s = window.midway;
      const b = s.battle;
      const w = s.world;
      const ship = b.ships.find((x) => x.team === "jp" && x.kind === "carrier" && !x.sunk);
      if (!ship) throw new Error("the water fixture needs a live carrier to hit");
      window.midwayFixture = { accepted: 0, events: 0, whitewaterMax: 0, energyMax: 0 };
      // Only the observation camera is fixed, the same carrier-relative surface vantage the fluid
      // lab uses. The game's own updateCamera still runs first, for its cost and side effects.
      const original = w.updateCamera.bind(w);
      w.updateCamera = function (dt, briefing, time) {
        original(dt, briefing, time);
        const c = Math.cos(ship.heading);
        const sn = Math.sin(ship.heading);
        this.camera.position.set(ship.x + c * 285 + sn * 100, 75, ship.z + sn * 285 - c * 100);
        this.camera.up.set(0, 1, 0);
        this.camera.fov = 48;
        this.camera.lookAt(ship.x + c * 12, 6, ship.z + sn * 12);
        this.camera.updateProjectionMatrix();
        this.camera.updateMatrixWorld();
      };
      let next = Math.ceil(b.time / period) * period;
      let blasted = false;
      const origStep = b.step;
      b.step = function (dt, input) {
        const out = origStep.call(this, dt, input);
        if (this.time >= next) {
          next += period;
          const c = Math.cos(ship.heading);
          const sn = Math.sin(ship.heading);
          const at = { x: ship.x + c * ship.hullBeam * 0.5, y: -3, z: ship.z + sn * ship.hullBeam * 0.5 };
          if (!blasted && !ship.sunk) {
            this.damageShip(ship, 120, at, "torpedo", "us", { owner: "player" });
            blasted = true;
          } else {
            this.fx("splash", { ...at, waterKind: "torpedo", waterDepth: 3 }, 1.6, true);
          }
          window.midwayFixture.events += 1;
        }
        return out;
      };
    }, IMPACT_PERIOD);

  // MIDWAY_HIDE names a layer to switch off, so the cost of one can be attributed rather than
  // guessed at. It changes what is measured; a run that uses it is non-qualifying.
  if (process.env.MIDWAY_HIDE)
    await page.evaluate((what) => {
      const w = window.midway.world;
      if (what === "sea") w.sea.visible = false;
      if (what === "ships") for (const [id, m] of w.meshes) if (!id.startsWith("air-")) m.visible = false;
      if (what === "crew") w.crew.group.visible = false;
      if (what === "sky") w.scene.background = null;
    }, process.env.MIDWAY_HIDE);

  // MIDWAY_RATIO shrinks the render target while the window stays the same size, which separates
  // what the GPU is drawing from what the display path costs to present.
  if (process.env.MIDWAY_RATIO)
    await page.evaluate((r) => {
      window.midway.world.renderer.setPixelRatio(Number(r));
    }, process.env.MIDWAY_RATIO);

  // MIDWAY_BURN is the damage workload: every carrier is hit at four real deck points and the
  // player is flown up the wake of the nearest one, so persistent fires and scorch marks are
  // actually on screen while the frame is timed. Benchmarking a clean sky proves nothing about
  // damage rendering. The hits are forced through damageShip, and this is always reported.
  const burning = !!process.env.MIDWAY_BURN;
  if (burning) {
    await page.evaluate(() => {
      const b = window.midway.battle;
      const carriers = b.ships.filter((s) => s.kind === "carrier" && !s.sunk);
      for (const ship of carriers) {
        const f = { x: Math.sin(ship.heading), z: -Math.cos(ship.heading) };
        for (const along of [-80, -25, 30, 75])
          b.damageShip(
            ship,
            55,
            { x: ship.x + f.x * along, y: 20, z: ship.z + f.z * along },
            "bomb",
            ship.team === "us" ? "jp" : "us",
            { owner: "benchmark" },
          );
      }
      const target = carriers.find((s) => s.team === "jp") ?? carriers[0];
      const f = { x: Math.sin(target.heading), z: -Math.cos(target.heading) };
      Object.assign(b.player, {
        x: target.x - f.x * 950,
        y: 320,
        z: target.z - f.z * 950,
        heading: target.heading,
        pitch: 0.02,
        roll: 0,
        vx: f.x * 95,
        vy: 0,
        vz: f.z * 95,
        speed: 95,
        autopilot: false,
      });
      if (b.player.flight?.setAttitude) b.player.flight.setAttitude(target.heading, 0.02, 0);
    });
  }

  // A representative workload: turning, firing, tracers and impacts, not a static camera. The
  // damage workload holds its course instead, so the burning ship stays in frame for both runs.
  if (WORKLOAD) {
    // The two new fixtures burn a wall-clock warm-up — shader compilation and texture upload are
    // wall-clock events, and a battle-time warm-up on a slow build burns a different amount of
    // them — and then wait for the predeclared battle tick, so both sides of a comparison sample
    // the same section of the same battle.
    if (WORKLOAD === "cockpit") {
      await page.keyboard.down("Space");
      await page.keyboard.down("ArrowRight");
    }
    await page.waitForTimeout(WARMUP * 1000);
    // The battle tick is waited for INSIDE the sample, by the step wrapper, so that the first step
    // to reach it is observed. Waiting for it out here would consume it during setup and leave the
    // wrapper to latch whatever tick happened to run first after installation — which is a
    // load-dependent number, and the one thing this gate exists to remove.
  } else {
    await page.keyboard.down("Space");
    if (!burning) await page.keyboard.down("ArrowLeft");
    await seconds(WARMUP);
    if (!burning) {
      await page.keyboard.up("ArrowLeft");
      await page.keyboard.down("ArrowRight");
    }
  }

  // Optional attribution run: a CDP CPU profile of the sampled window, written for a flame graph.
  // The warm-up above is deliberately outside it; when unset no session is opened at all.
  const cdp = CPU_PROFILE ? await page.context().newCDPSession(page) : null;
  if (cdp) {
    await cdp.send("Profiler.enable");
    await cdp.send("Profiler.setSamplingInterval", { interval: 1000 });
    await cdp.send("Profiler.start");
  }
  const result = await page.evaluate(async ({ sample, workload, startTick, sampleTicks, wallCap, wrapSource }) => {
    const s = window.midway;
    const renderer = s.world.renderer;
    // GPU time is the figure that describes the game. Wall time is collected alongside it, but
    // on a virtual display it measures how fast the window can be presented, which is a property
    // of the capture rig and not of the game.
    renderer.trackTimestamp = true;
    // The CPU gate is the cost of one Battle fixed step, not of a frame or of rAF wall spacing.
    // Nothing in the engine reports per-substep Battle time, and extracting it from a frame delta
    // would fold render/update/overlay into it, so time the method itself. A call's exclusive cost
    // is pushed only when it made no recursive call, so each leaf fixed step is measured once and
    // a subdividing parent's aggregate is never charged (it is counted in `substeps` instead).
    const b = s.battle;
    const cpu = [];
    const stack = [];
    let substeps = 0;
    // The first fixed step to reach the predeclared tick, observed inside the step itself. Battle
    // time is a whole number of fixed steps, so this lands on exactly the same tick in every run
    // however many steps a frame had to catch up — which a between-frames check cannot promise, and
    // a wall-clock warm-up cannot promise at all.
    let startedAt = null;
    let endedAt = null;
    const origStep = b.step;
    b.step = function (dt, input) {
      const frame = { children: 0 };
      if (stack.length) stack[stack.length - 1].children += 1;
      stack.push(frame);
      const t0 = performance.now();
      try {
        return origStep.call(this, dt, input);
      } finally {
        stack.pop();
        const ms = performance.now() - t0;
        if (frame.children === 0) cpu.push(ms);
        else substeps += frame.children;
        if (startedAt === null && startTick !== null && this.time >= startTick) startedAt = this.time;
        // And the end of the window, latched the same way and for the same reason: checking
        // `b.time` between frames ends the sample wherever the last catch-up burst happened to
        // land, which is a load-dependent number, and two runs then cover slightly different
        // battle windows. Latched here, both cover exactly `sampleTicks` of battle.
        else if (startedAt !== null && endedAt === null && sampleTicks !== null && this.time - startedAt >= sampleTicks)
          endedAt = this.time;
      }
    };
    // The CPU the leaf `Battle.step` timer above cannot see, which is most of it: the trace put
    // 32.0 s in `WorldView.update` and 86.2 s in the render wrapper across the same window that
    // fixed steps barely appear in. Each wrapper preserves `this`, its arguments, its return value
    // and its exceptions, and is removed again below. A nested call — the water's reflection pass
    // and the shadow passes both re-enter `renderer.render` — is charged once, to the outer call
    // that contains it, so a total is never double counted.
    const series = { updateRenderCpu: [], sceneUpdateCpu: [], worldUpdateCpu: [], rippleUpdateCpu: [], renderCpu: [] };
    const restore = [];
    let pendingUpdate = 0;
    // The same `wrapCalls` node just proved correct against a recursive fixture in `--self-check`,
    // rehydrated here rather than written a second time.
    const wrapCalls = (0, eval)(`(${wrapSource})`);
    const wrap = (owner, key, record) => restore.push(wrapCalls(owner, key, record));
    wrap(s, "update", (ms) => {
      series.sceneUpdateCpu.push(ms);
      pendingUpdate += ms;
    });
    wrap(s.world, "update", (ms) => series.worldUpdateCpu.push(ms));
    wrap(s.world.ripples, "update", (ms) => series.rippleUpdateCpu.push(ms));
    wrap(renderer, "render", (ms) => {
      series.renderCpu.push(ms);
      // One presented-work attempt: everything the scene updated since the last outer render, plus
      // this render. The component series are reported beside it and never added to it.
      series.updateRenderCpu.push(pendingUpdate + ms);
      pendingUpdate = 0;
    });

    // One traversal, once, to name what is on the scene and which textures are being rewritten —
    // the trace's 8.6 s of external-image uploads had no owner in it. No prototype patch, no
    // per-frame walk and nothing left behind in the product.
    const census = { objects: 0, meshes: 0, instanced: 0, batched: 0, clustered: 0, textures: 0 };
    const watched = [];
    const seenTexture = new Set();
    s.world.scene.traverse((o) => {
      census.objects += 1;
      if (o.isMesh) census.meshes += 1;
      if (o.isInstancedMesh) census.instanced += 1;
      if (o.isBatchedMesh) census.batched += 1;
      if (o.isClusteredMesh || o.constructor?.name === "ClusteredMesh") census.clustered += 1;
      const materials = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
      for (const material of materials)
        for (const [slot, value] of Object.entries(material))
          if (value && value.isTexture && !seenTexture.has(value)) {
            seenTexture.add(value);
            census.textures += 1;
            watched.push({
              texture: value,
              slot,
              version: value.version,
              kind: value.isCanvasTexture ? "canvas" : value.isDataTexture ? "data" : "image",
              material: material.name || material.type,
              object: o.name || o.type,
            });
          }
    });

    const wall = [];
    const gpu = [];
    const water = { acceptedStart: s.world.ripples.effects?.accepted ?? 0, accepted: 0, whitewaterMax: 0, energyMax: 0 };
    const pop = {
      aircraftMin: Infinity, aircraftMax: -Infinity, shipsMin: Infinity, shipsMax: -Infinity,
      renderableMin: Infinity, renderableMax: -Infinity, visibleMin: Infinity, visibleMax: -Infinity,
      bulletMax: 0,
    };
    // Honest render evidence, from real scene meshes: `renderable` is the game's own
    // player-relative visibility decision (mesh exists, its whole ancestor chain is visible — the
    // same `range < 18000` rule WorldView applies); `visible` additionally requires the mesh to
    // project inside the camera frustum via Three's own `Vector3.project`. A position-based count
    // would overstate both.
    const cam = s.world.camera;
    const tmp = cam.position.clone();
    const renderable = (a) => {
      const m = s.world.meshes.get(a.id);
      if (!m || !m.visible) return null;
      for (let o = m.parent; o; o = o.parent) if (!o.visible) return null;
      return m;
    };
    const inFrustum = (m) => {
      m.getWorldPosition(tmp);
      tmp.project(cam);
      return tmp.x >= -1 && tmp.x <= 1 && tmp.y >= -1 && tmp.y <= 1 && tmp.z >= -1 && tmp.z <= 1;
    };
    if (startTick !== null)
      await new Promise((resolve) => {
        const poll = () => (startedAt === null ? requestAnimationFrame(poll) : resolve());
        requestAnimationFrame(poll);
      });
    const timeStart = startedAt ?? b.time;
    const ammoStart = b.player.ammo ?? null;
    const positions = new Map(b.aircraft.map((a) => [a.id, { x: a.x, y: a.y, z: a.z }]));
    let ticks = 0;
    await new Promise((resolve) => {
      let last = performance.now();
      const stop = last + sample * 1000;
      const hardStop = last + wallCap * 1000;
      const tick = async (now) => {
        wall.push(now - last);
        last = now;
        const liveAircraft = b.activeAircraft;
        const liveShips = b.ships.reduce((n, x) => n + (!x.sunk ? 1 : 0), 0);
        let renderableNow = 0;
        let visibleNow = 0;
        for (const a of b.aircraft) {
          if (a.hp <= 0) continue;
          const m = renderable(a);
          if (!m) continue;
          renderableNow += 1;
          if (inFrustum(m)) visibleNow += 1;
        }
        pop.aircraftMin = Math.min(pop.aircraftMin, liveAircraft);
        pop.aircraftMax = Math.max(pop.aircraftMax, liveAircraft);
        pop.shipsMin = Math.min(pop.shipsMin, liveShips);
        pop.shipsMax = Math.max(pop.shipsMax, liveShips);
        pop.renderableMin = Math.min(pop.renderableMin, renderableNow);
        pop.renderableMax = Math.max(pop.renderableMax, renderableNow);
        pop.visibleMin = Math.min(pop.visibleMin, visibleNow);
        pop.visibleMax = Math.max(pop.visibleMax, visibleNow);
        pop.bulletMax = Math.max(pop.bulletMax, b.bullets.length);
        // Evidence that the water fixture's water actually moved. Sampled every thirtieth frame
        // because `energy()` walks all 36,864 cells: reading it every frame would be the harness
        // adding the cost it is here to measure.
        if (workload === "water-impact" && ticks % 30 === 0) {
          const fx = s.world.ripples.effects;
          water.whitewaterMax = Math.max(water.whitewaterMax, fx?.whitewater?.activeCount?.() ?? 0);
          water.energyMax = Math.max(water.energyMax, s.world.ripples.energy());
        }
        ticks += 1;
        try {
          await renderer.resolveTimestampsAsync("render");
          const t = renderer.info.render.timestamp;
          if (t > 0) gpu.push(t);
        } catch {
          // No timestamp-query support; the gpu series stays empty and is reported as such.
        }
        const done = sampleTicks === null ? now >= stop : endedAt !== null || now >= hardStop;
        if (!done) requestAnimationFrame(tick);
        else resolve();
      };
      requestAnimationFrame(tick);
    });
    wall.shift();
    b.step = origStep;
    for (const undo of restore) undo();
    // The first attempt has no scene update behind it — the sample began mid-frame — so it is not a
    // presented-work total and is dropped rather than reported as a very cheap frame.
    series.updateRenderCpu.shift();
    water.accepted = (s.world.ripples.effects?.accepted ?? 0) - water.acceptedStart;
    const textureChanges = watched
      .filter((w) => w.texture.version !== w.version)
      .map((w) => ({ kind: w.kind, slot: w.slot, material: w.material, object: w.object, versions: w.texture.version - w.version }));
    const evidence = {
      status: b.status,
      cameraMode: s.world.cameraMode,
      playerHp: b.player.hp ?? 1,
      acceptedImpacts: water.accepted,
      scheduledEvents: window.midwayFixture?.events ?? 0,
      whitewaterMax: water.whitewaterMax,
      energyMax: water.energyMax,
    };
    let moved = 0;
    for (const a of b.aircraft) {
      const p0 = positions.get(a.id);
      if (p0 && Math.hypot(a.x - p0.x, a.y - p0.y, a.z - p0.z) > 100) moved += 1;
    }
    const advance = { seconds: +(b.time - timeStart).toFixed(1), moved, ammoStart, ammoEnd: b.player.ammo ?? null };
    // The exact battle-time window this sample covers. A comparison that does not match these is
    // measuring two different sections of the same battle and crediting the difference to code.
    const windowEnd = endedAt ?? b.time;
    const fixture = { ...evidence, startTick, sampleTicks, simStart: +timeStart.toFixed(3), simEnd: +windowEnd.toFixed(3), simSeconds: +(windowEnd - timeStart).toFixed(3) };
    // Raw durations, not summaries: AC-23's percentiles are computed once, in node, by
    // src/sim/perf.ts. Deriving a p95 here as well would be the second implementation the
    // repository forbids.
    return {
      wall,
      gpu,
      cpu,
      series,
      census,
      textureChanges,
      fixture,
      drawingBuffer: { width: renderer.domElement.width, height: renderer.domElement.height },
      backend: renderer.backend?.constructor?.name ?? null,
      substeps,
      draws: renderer.info.render.drawCalls,
      triangles: renderer.info.render.triangles,
      memory: { ...renderer.info.memory },
      heap: performance.memory?.usedJSHeapSize ?? null,
      pop,
      advance,
      seed: b.seed,
      scene: {
        aircraft: b.aircraft.length,
        airborne: b.aircraft.filter((a) => a.mode !== "launch").length,
        ships: b.ships.filter((x) => !x.sunk).length,
        bullets: b.bullets.length,
        meshes: s.world.meshes.size,
        quality: s.world.quality,
        pixelRatio: renderer.getPixelRatio(),
      },
    };
  }, {
    sample: SAMPLE,
    workload: WORKLOAD,
    startTick: WORKLOAD ? START_TICK : null,
    sampleTicks: WORKLOAD ? SAMPLE_TICKS : null,
    wallCap: WALL_CAP,
    wrapSource: wrapCalls.toString(),
  });
  if (cdp) {
    const profile = await cdp.send("Profiler.stop");
    await writeFile(CPU_PROFILE, JSON.stringify(profile.profile ?? profile));
    console.log(`cpu profile written to ${CPU_PROFILE}`);
  }
  if (WORKLOAD !== "water-impact") await page.keyboard.up("Space");
  if (!burning && WORKLOAD !== "water-impact") await page.keyboard.up("ArrowRight");

  // AC-23's percentiles come from src/sim/perf.ts, the one documented interpolation rule; the raw
  // page series are reduced here so p50/p95/p99 and the verdict share the same arithmetic.
  const seriesStats = (series) => {
    const n = series.length;
    return {
      samples: n,
      p50: percentile(series, 0.5),
      p95: percentile(series, 0.95),
      p99: percentile(series, 0.99),
      worst: n ? series.reduce((m, x) => (x > m ? x : m), Number.NEGATIVE_INFINITY) : Number.NaN,
    };
  };
  const gpu = seriesStats(result.gpu);
  const cpu = seriesStats(result.cpu);
  const wall = seriesStats(result.wall);
  // The full-CPU series, reduced by the same arithmetic as everything else.
  const cpuStats = Object.fromEntries(CPU_SERIES.map((name) => [name, seriesStats(result.series[name] ?? [])]));
  if (process.env.MIDWAY_FRAME) {
    await page.screenshot({ path: process.env.MIDWAY_FRAME });
    console.log(`frame saved to ${process.env.MIDWAY_FRAME}`);
  }
  const damage = await page.evaluate(() => {
    const b = window.midway.battle;
    let impacts = 0;
    let scars = 0;
    let fires = 0;
    for (const ship of b.ships) {
      impacts += (ship.impacts ?? []).length;
      if (ship.fire > 0.06) fires += 1;
      scars += (window.midway.world.meshes.get(ship.id)?.userData?.shipScars ?? []).filter((m) => m.visible).length;
    }
    return { impacts, scars, burningShips: fires };
  });

  const meta = {
    schema: SCHEMA_VERSION,
    adapter,
    backend: result.backend,
    browser: browser.version(),
    // Screenshot size and the window's CSS size are not the drawing buffer; record the buffer.
    drawingBuffer: result.drawingBuffer,
    engineArtifact:
      JSON.parse(await readFile(join(import.meta.dirname, "..", "package.json"), "utf8")).dependencies?.[
        "@threenative/core"
      ] ?? null,
    width: WIDTH,
    height: HEIGHT,
    pixelRatio: result.scene.pixelRatio,
    quality: result.scene.quality,
    warmup: WARMUP,
    sample: SAMPLE,
    startTick: WORKLOAD ? START_TICK : null,
    sampleTicks: WORKLOAD ? SAMPLE_TICKS : null,
    seed: result.seed,
    damage: burning,
    input:
      WORKLOAD === "cockpit" ? "cockpit + turn-right + fire"
      : WORKLOAD === "water-impact" ? "none (scheduled water events)"
      : burning ? "course-held + fire"
      : "turn-right + fire",
    // AC-23's declared population envelope belongs to AC-23's workload. The two fixtures added here
    // are not that workload and do not borrow its envelope; they match on observed population
    // instead, which `compareWorkload` requires be identical on both sides.
    requiredAircraft: WORKLOAD ? 0 : REQUIRED_AIRCRAFT,
    hidden: process.env.MIDWAY_HIDE || null,
    workload:
      WORKLOAD === "cockpit" ? "cockpit-flight"
      : WORKLOAD === "water-impact" ? "water-impact-fixture"
      : CROWD ? "crowd68-fixture"
      : "natural",
    source: (() => {
      const after = sourceDigest();
      return {
        headBefore: checkoutBefore.head,
        headAfter: after.head,
        diffBefore: checkoutBefore.diffDigest,
        diffAfter: after.diffDigest,
        concurrentChange: checkoutBefore.head !== after.head || checkoutBefore.diffDigest !== after.diffDigest,
      };
    })(),
  };

  const fps = (ms) => +(1000 / ms).toFixed(1);
  console.log(`workload: ${CROWD ? "crowd68 fixture (Battle.launch to cap)" : burning ? "burning carriers, course held" : "crowded battle, turning"} ${JSON.stringify(damage)}`);
  console.log(`workload metadata: ${JSON.stringify(meta)}`);
  console.log(
    "adapter " + JSON.stringify(adapter) + "\n" +
      `resolution ${WIDTH}x${HEIGHT} at pixel ratio ${result.scene.pixelRatio}, quality ${result.scene.quality}\n` +
      `scene ${JSON.stringify(result.scene)}\n` +
      `active aircraft min/max ${result.pop.aircraftMin}/${result.pop.aircraftMax}, renderable meshes ${result.pop.renderableMin}/${result.pop.renderableMax}, in-frustum ${result.pop.visibleMin}/${result.pop.visibleMax}, ships ${result.pop.shipsMin}/${result.pop.shipsMax}\n` +
      `advancing ${result.advance.seconds}s of sim, ${result.advance.moved}/${result.pop.aircraftMax} actors moved >100m, bullets seen ${result.pop.bulletMax}, ammo ${result.advance.ammoStart}->${result.advance.ammoEnd}\n` +
      `draw calls ${result.draws}, triangles ${result.triangles}, memory ${JSON.stringify(result.memory)}, jsHeap ${result.heap}\n` +
      `gpu ${gpu.samples ? `p50 ${gpu.p50.toFixed(2)}ms (${fps(gpu.p50)} fps) | p95 ${gpu.p95.toFixed(2)}ms | p99 ${gpu.p99.toFixed(2)}ms | worst ${gpu.worst.toFixed(2)}ms over ${gpu.samples} frames` : "unavailable: this build has no timestamp-query support"}\n` +
      `battle fixed-step cpu (leaf steps) ${cpu.samples ? `p50 ${cpu.p50.toFixed(2)}ms | p95 ${cpu.p95.toFixed(2)}ms | p99 ${cpu.p99.toFixed(2)}ms | worst ${cpu.worst.toFixed(2)}ms over ${cpu.samples} steps; ${result.substeps} subdivided child calls` : "unavailable: no Battle.step observations"}\n` +
      `wall ${wall.samples ? `p50 ${wall.p50.toFixed(2)}ms | p95 ${wall.p95.toFixed(2)}ms` : "unavailable"}  ` +
      "(presentation-bound on a virtual display; not a statement about the game)\n" +
      CPU_SERIES.map((name) => {
        const st = cpuStats[name];
        return `${name.padEnd(16)} ${st.samples ? `p50 ${st.p50.toFixed(2)}ms | p95 ${st.p95.toFixed(2)}ms | p99 ${st.p99.toFixed(2)}ms | worst ${st.worst.toFixed(2)}ms over ${st.samples}` : "unavailable: no observations"}`;
      }).join("\n") +
      `\nscene census ${JSON.stringify(result.census)}\n` +
      `textures rewritten during the sample: ${result.textureChanges.length ? JSON.stringify(result.textureChanges) : "none"}\n` +
      `fixture ${JSON.stringify(result.fixture)}`,
  );

  // The record is written before any verdict is reached. A sample that misses a budget is still a
  // measured result, and losing it because it failed is how a baseline quietly becomes a
  // cherry-picked one. `passed` is stamped honestly below, after the gates have actually run.
  const record = {
    ...meta,
    gpuP95: gpu.p95,
    cpuP95: cpu.p95,
    wallP95: wall.p95,
    ...Object.fromEntries(CPU_SERIES.flatMap((name) => [[`${name}P95`, cpuStats[name].p95], [`${name}Samples`, cpuStats[name].samples]])),
    population: { min: result.pop.aircraftMin, max: result.pop.aircraftMax },
    fixture: {
      ...result.fixture,
      aircraftMin: result.pop.aircraftMin,
      aircraftMax: result.pop.aircraftMax,
      shipsMin: result.pop.shipsMin,
      shipsMax: result.pop.shipsMax,
    },
    census: result.census,
    textureChanges: result.textureChanges,
    // Raw durations, kept so a later comparison can re-derive every statistic from the same bytes.
    raw: { gpu: result.gpu, cpu: result.cpu, wall: result.wall, ...result.series },
  };
  if (process.env.MIDWAY_BASELINE_OUT) {
    await writeFile(process.env.MIDWAY_BASELINE_OUT, JSON.stringify(record, null, 2));
    console.log(`baseline written to ${process.env.MIDWAY_BASELINE_OUT}`);
  }

  assert.deepEqual(errors, []);
  // A fixture must have been the thing it claims to measure before its timings mean anything.
  if (WORKLOAD) {
    const evidenceFailures = workloadEvidenceFailures(WORKLOAD, { ...result.fixture }, SAMPLE);
    assert.deepEqual(evidenceFailures, [], `${WORKLOAD} fixture did not run as declared: ${evidenceFailures.join("; ")}`);
  }
  // The new series fail closed exactly as the old ones do: a missing full-CPU observation is a
  // broken wrapper, not a frame that cost nothing.
  for (const name of CPU_SERIES)
    assert.ok(isFiniteTiming(cpuStats[name]), `${name} observations resolved and finite: ${JSON.stringify(cpuStats[name])}`);
  // Missing or nonfinite observations are failures, not zeroes.
  assert.ok(isFiniteTiming(gpu), `GPU observations resolved and finite: ${JSON.stringify(gpu)}`);
  assert.ok(isFiniteTiming(cpu), `Battle fixed-step CPU observations resolved and finite: ${JSON.stringify(cpu)}`);
  assert.ok(
    result.scene.aircraft > 0 && result.scene.ships > 0,
    `the sample has a live population: ${JSON.stringify(result.scene)}`,
  );
  // A disposed or torn-down renderer reports zero draws and zero memory; that is a missing
  // observation, not a fast frame, and it must not be reported as a result.
  assert.ok(
    result.draws > 0 && result.triangles > 0,
    `render observations present: ${result.draws} draws, ${result.triangles} triangles`,
  );
  assert.ok(result.memory.total > 0, `memory observation present: ${JSON.stringify(result.memory)}`);
  // The sample must be a running battle, not a frozen frame: the simulation clock advanced and
  // live actors changed position. This fails if a fixture ever disables gameplay to look calm.
  assert.ok(
    result.advance.seconds > (WORKLOAD ? SAMPLE_TICKS * 0.9 : SAMPLE * 0.5),
    `simulation advanced across the sample: ${result.advance.seconds}s`,
  );
  assert.ok(result.advance.moved > 0, `live actors advanced across the sample: ${result.advance.moved} moved`);

  // Everything AC-23 requires on one record, decided by the single verdict from src/sim/perf.ts. A
  // relative pass can never excuse a failing absolute target here, and a missing/nonfinite p95
  // (NaN) fails closed. This is the only place the absolute budgets are applied.
  const measurement = {
    fixedStepCpuP95: cpu.p95,
    gpuP95: gpu.p95,
    wallFrameP95: wall.p95,
    triangles: result.triangles,
    drawCalls: result.draws,
    memoryMB: result.memory.total / (1024 * 1024),
    activeAircraft: result.pop.aircraftMax,
    activeShips: result.pop.shipsMax,
    adapterName:
      [adapter.vendor, adapter.architecture, adapter.device, adapter.description].filter(Boolean).join("/") ||
      JSON.stringify(adapter),
    width: WIDTH,
    height: HEIGHT,
    sampleSeconds: SAMPLE,
  };
  const absolute = verdict(measurement, { gpuP95: 16.7, fixedStepCpuP95: 4 });
  console.log(format(measurement, absolute));
  assert.ok(
    absolute.pass,
    `AC-23 absolute performance gap: ${absolute.failures.join(", ")} \u2014 ${format(measurement, absolute)}`,
  );

  // The relative clause of AC-23 compares a matched run on the same named adapter. The baseline is
  // a recorded figure, never an empty workspace: MIDWAY_BASELINE points at a JSON file this tool
  // wrote, and every workload field must match before its timings are compared. MIDWAY_BASELINE_OUT
  // writes this run out for the next comparison.
  let relative = "UNVERIFIED";
  if (process.env.MIDWAY_BASELINE) {
    const base = JSON.parse(await readFile(process.env.MIDWAY_BASELINE, "utf8"));
    const mismatches = baselineMismatches(base, meta);
    assert.deepEqual(mismatches, [], `matched baseline required: ${mismatches.join("; ")}`);
    for (const [metric, value] of [["gpuP95", gpu.p95], ["cpuP95", cpu.p95]]) {
      const drift = regression(value, base[metric]);
      assert.ok(
        !drift.regressed,
        `${metric} regressed ${drift.pct.toFixed(1)}% against matched baseline: ${value}ms vs ${base[metric]}ms (limit ${REGRESSION_LIMIT_PCT}%)`,
      );
    }
    relative = "PASS";
  }
  console.log(`relative: ${relative}${relative === "PASS" ? " (within 10% of the matched baseline)" : " (no matched baseline supplied via MIDWAY_BASELINE)"}`);

  // AC-23 is one workload's verdict. The two fixtures added for AC-6 are a different workload and
  // must never print it: their comparison is `--compare`, over three matched runs a side.
  if (WORKLOAD) {
    console.log(
      `AC-23 NOT APPLICABLE: workload ${meta.workload} is an AC-6 fixture. Compare three runs a side with --compare; AC-23 keeps MIDWAY_CROWD=1.`,
    );
  } else {
    const reasons = qualificationReasons(meta, result.pop, relative === "PASS");
    if (reasons.length) {
      console.log(`AC-23 NON-QUALIFYING: ${reasons.join("; ")}`);
      if (process.env.MIDWAY_REQUIRE_QUALIFIED) assert.fail(`AC-23 not qualified: ${reasons.join("; ")}`);
    } else {
      console.log("PASS: AC-23 workload, declared population, absolute budgets and matched-baseline comparison all met");
    }
  }
} finally {
  await browser.close();
}
