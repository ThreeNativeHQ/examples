/**
 * Performance measurement records and pure statistics for PRD AC-23. Nothing here runs a frame,
 * reads a clock or touches a browser: the capture harness collects raw durations and these functions
 * only reduce them, so a run and its baseline are judged by the same arithmetic.
 */

/** One accumulator of raw millisecond durations. `sample` appends by copying, never in place. */
export interface Sampler {
  readonly samples: readonly number[];
}

export function sample(sampler: Sampler, durationMs: number): Sampler {
  return { samples: [...sampler.samples, durationMs] };
}

/**
 * The interpolation rule is fixed here once, because a p95 computed two different ways is how
 * performance claims drift: linear interpolation between the two closest ranks, the rule the common
 * scientific stacks default to. For n samples rank = (n - 1) * p, and a fractional rank lerps between
 * floor(rank) and ceil(rank). p95 of 1..100 is therefore 95.05, not the nearest-rank 95.
 */
export function percentile(samples: readonly number[], p: number): number {
  const n = samples.length;
  // A missing p95 must not read as a passing zero; NaN fails every comparison in `verdict`.
  if (n === 0) return Number.NaN;
  const sorted = [...samples].sort((a, b) => a - b);
  const rank = (n - 1) * p;
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (rank - lo) * (sorted[hi] - sorted[lo]);
}

/** The two absolute gates AC-23 names, in milliseconds. */
export interface PerformanceTargets {
  gpuP95: number;
  fixedStepCpuP95: number;
}

/** The absolute measurements `verdict` checks. A `Measurement` satisfies this structurally. */
export interface PerformanceStats {
  gpuP95: number;
  fixedStepCpuP95: number;
}

export interface PerformanceVerdict {
  pass: boolean;
  failures: string[];
}

/**
 * Check only the absolute targets. This function never sees a baseline, so a relative comparison
 * cannot launder an absolute failure into a pass: a run over 16.7 ms GPU fails here however good the
 * baseline was. NaN fails closed, because a missing p95 is not a passing p95.
 */
export function verdict(stats: PerformanceStats, targets: PerformanceTargets): PerformanceVerdict {
  const failures: string[] = [];
  if (!(stats.gpuP95 <= targets.gpuP95)) failures.push("gpuP95");
  if (!(stats.fixedStepCpuP95 <= targets.fixedStepCpuP95)) failures.push("fixedStepCpuP95");
  return { pass: failures.length === 0, failures };
}

/** The relative budget the PRD names: a matched run may not regress more than 10%. */
export const REGRESSION_LIMIT_PCT = 10;

export interface Regression {
  pct: number;
  regressed: boolean;
}

/**
 * The relative comparison, deliberately separate from `verdict` so the two can never be confused. A
 * 5% drift against a baseline already inside the envelope is fine, and a run that is still under
 * 16.7 ms is not an absolute failure however far above its baseline it sits.
 */
export function regression(current: number, baseline: number): Regression {
  // A zero baseline has no percentage to take; only a nonzero current is an actual regression.
  const pct = baseline > 0 ? ((current - baseline) / baseline) * 100 : current > 0 ? Number.POSITIVE_INFINITY : 0;
  return { pct, regressed: pct > REGRESSION_LIMIT_PCT };
}

/**
 * Everything AC-23 requires be recorded for one fixed 1920x1080 sample. `adapterName` is carried so
 * the baseline is only ever matched against the same named non-software adapter.
 */
export interface Measurement {
  fixedStepCpuP95: number;
  gpuP95: number;
  /** Recorded, and explicitly NOT presentation proof: the virtual display's wall timing is not physical. */
  wallFrameP95: number;
  triangles: number;
  drawCalls: number;
  memoryMB: number;
  activeAircraft: number;
  activeShips: number;
  adapterName: string;
  width: number;
  height: number;
  sampleSeconds: number;
}

/** A compact report a human can read in a log line. It never decides pass or fail; `verdict` does. */
export function format(measurement: Measurement, result: PerformanceVerdict): string {
  const failed = new Set(result.failures);
  const metric = (label: string, value: number, key: string) =>
    `  ${label.padEnd(18)} ${value.toFixed(2).padStart(8)} ms  ${failed.has(key) ? "FAIL" : "ok"}`;
  const lines = [
    `performance ${result.pass ? "PASS" : "FAIL"}  ${measurement.adapterName} ${measurement.width}x${measurement.height} ${measurement.sampleSeconds.toFixed(1)}s`,
    metric("gpu p95", measurement.gpuP95, "gpuP95"),
    metric("fixed-step cpu p95", measurement.fixedStepCpuP95, "fixedStepCpuP95"),
    `  ${"wall frame p95".padEnd(18)} ${measurement.wallFrameP95.toFixed(2).padStart(8)} ms  (not presentation proof)`,
    `  ${(measurement.triangles / 1e6).toFixed(2)}M tri  ${measurement.drawCalls} draws  ${measurement.memoryMB.toFixed(1)} MB  aircraft ${measurement.activeAircraft}  ships ${measurement.activeShips}`,
  ];
  if (result.failures.length) lines.push(`  failures: ${result.failures.join(", ")}`);
  return lines.join("\n");
}
