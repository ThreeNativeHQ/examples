/**
 * AC-23 measurement check. The pure `src/sim/perf.ts` reductions are bundled with esbuild and
 * exercised with node:assert, no test framework. This proves the statistics, the absolute-vs-relative
 * separation and the purity of the records -- not any actual frame budget.
 * Run: node scripts/check-perf.mjs
 */
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { build } from "esbuild";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const built = await build({
  stdin: { contents: 'export * from "./src/sim/perf.ts";', loader: "ts", resolveDir: root },
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node20",
  write: false,
  logLevel: "silent",
});
const { sample, percentile, verdict, regression, format, REGRESSION_LIMIT_PCT } = await import(
  `data:text/javascript,${encodeURIComponent(built.outputFiles[0].text)}`
);

const freeze = (o) => Object.freeze(o);
const TARGETS = freeze({ gpuP95: 16.7, fixedStepCpuP95: 4 });
const measurement = (over = {}) =>
  freeze({
    fixedStepCpuP95: 3.1,
    gpuP95: 12.4,
    wallFrameP95: 15.2,
    triangles: 1_200_000,
    drawCalls: 840,
    memoryMB: 512.3,
    activeAircraft: 24,
    activeShips: 14,
    adapterName: "Test Adapter",
    width: 1920,
    height: 1080,
    sampleSeconds: 60,
    ...over,
  });

// 1 -- percentile follows the documented linear-interpolation rule, and an empty sampler is NaN.
assert.equal(percentile([1, 2, 3, 4], 0.5), 2.5, "median lerps between the two middle samples");
assert.equal(percentile([5], 0.95), 5, "a single sample is its own p95");
const oneToHundred = Array.from({ length: 100 }, (_, i) => i + 1);
assert.equal(percentile(oneToHundred, 0.95), 95.05, "p95 of 1..100 is the documented 95.05");
assert.ok(Number.isNaN(percentile([], 0.95)), "no samples is NaN, never a passing zero");

// 2 -- a sample inside both absolute targets passes.
const good = measurement();
const goodVerdict = verdict(good, TARGETS);
assert.equal(goodVerdict.pass, true, "12.4 ms gpu / 3.1 ms cpu is inside the envelope");
assert.deepEqual(goodVerdict.failures, [], "a passing run names no failures");

// 3 -- over the GPU target fails and the metric is named.
const gpuOver = verdict(measurement({ gpuP95: 16.8 }), TARGETS);
assert.equal(gpuOver.pass, false, "16.8 ms gpu is over 16.7");
assert.ok(gpuOver.failures.includes("gpuP95"), "the gpu metric is named");

// 4 -- over the fixed-step CPU target fails and the metric is named.
const cpuOver = verdict(measurement({ fixedStepCpuP95: 4.1 }), TARGETS);
assert.equal(cpuOver.pass, false, "4.1 ms cpu is over 4");
assert.ok(cpuOver.failures.includes("fixedStepCpuP95"), "the cpu metric is named");

// 5 -- THE KEY ONE: an absolute failure with NO regression against baseline still fails. 16.9 ms is
// +5.6% over a 16.0 ms baseline, inside the 10% budget, yet over the 16.7 ms absolute target.
const absFail = measurement({ gpuP95: 16.9 });
const rel = regression(absFail.gpuP95, 16.0);
assert.equal(rel.regressed, false, "+5.63% is within the 10% relative budget");
assert.equal(verdict(absFail, TARGETS).pass, false, "the absolute failure is a gap even with no regression");
assert.ok(verdict(absFail, TARGETS).failures.includes("gpuP95"), "and it is still named");

// 6 -- regression computes the percentage and flags only what is over 10%.
assert.ok(Math.abs(regression(110, 100).pct - 10) < 1e-9, "110 over 100 is +10%");
assert.equal(regression(110, 100).regressed, false, "exactly 10% is not over 10%");
assert.equal(regression(110.1, 100).regressed, true, "10.1% is over 10%");
assert.ok(Math.abs(regression(90, 100).pct + 10) < 1e-9, "improvement is negative");
assert.equal(regression(90, 100).regressed, false, "an improvement never regresses");
assert.equal(regression(5, 0).pct, Number.POSITIVE_INFINITY, "a zero baseline with a nonzero current cannot be a percentage");
assert.equal(REGRESSION_LIMIT_PCT, 10, "the budget is the PRD's 10%");

// 7 -- wallFrameP95 is carried on the record but cannot move the verdict.
const lowWall = measurement({ wallFrameP95: 1 });
const highWall = measurement({ wallFrameP95: 9999 });
assert.equal(lowWall.wallFrameP95, 1, "the wall figure is carried on the record");
assert.deepEqual(verdict(lowWall, TARGETS), verdict(highWall, TARGETS), "changing wallFrameP95 alone cannot change the verdict");
assert.equal(verdict(highWall, TARGETS).pass, true, "an outrageous wall figure is not an absolute failure");
assert.ok(format(highWall, verdict(highWall, TARGETS)).includes("not presentation proof"), "the report labels the wall figure honestly");

// 8 -- purity: every input frozen, nothing mutates, nothing throws.
const frozenSampler = freeze({ samples: freeze([1, 2, 3]) });
const grown = sample(frozenSampler, 4);
assert.notEqual(grown, frozenSampler, "sample returns a new record");
assert.deepEqual(frozenSampler.samples, [1, 2, 3], "sample did not mutate its input");
assert.deepEqual(grown.samples, [1, 2, 3, 4], "the new record holds the accumulation");
assert.doesNotThrow(() => percentile(freeze([9, 1, 8, 2, 7]), 0.95));
assert.doesNotThrow(() => verdict(good, TARGETS));
assert.doesNotThrow(() => regression(1, 2));
assert.doesNotThrow(() => format(good, goodVerdict));
const report = format(measurement({ gpuP95: 16.9 }), verdict(measurement({ gpuP95: 16.9 }), TARGETS));
assert.equal(typeof report, "string", "format returns a string");
assert.ok(report.includes("FAIL") && report.includes("gpuP95"), "the report shows the failure");

console.log(JSON.stringify({ pass: true, p95Of1to100: percentile(oneToHundred, 0.95), checks: 8 }));
