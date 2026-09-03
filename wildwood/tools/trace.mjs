/**
 * Record and read a Chrome performance trace, without a person in the loop.
 *
 *   CAPTURE_ON_DESKTOP=1 tools/capture-lock.sh node tools/trace.mjs <url> [seconds] [out.json]
 *
 * This exists because a 63-second trace the owner recorded by hand overturned two of my
 * hypotheses in one pass, and neither `tools/fps.mjs` nor the engine's own `TN_FRAME_BUDGET`
 * could have. Percentiles say a frame is slow; a trace says *which function*.
 *
 * What it answered that nothing else did:
 *  - 96 fps average with frame interval p50 8.2 ms — the game was never slow on average, and
 *    every summary statistic that reports a mean was hiding the actual complaint.
 *  - p99 50.3 ms, max 267.9 ms, 28 main-thread tasks over 40 ms — the pain is entirely tail.
 *  - GPUTask 31.5% busy, CPU 46.9% idle — not triangle-bound, not CPU-saturated. A whole day of
 *    work aimed at draw-call and triangle reduction would have moved nothing.
 *  - Sampling *inside* the worst tasks: TSL graph `build`/`analyze`/`_getChildren`, and two stalls
 *    at 86% and 97% idle where the main thread sat waiting on GPU pipeline creation. Shader
 *    compilation, arriving during play, because the startup warm-up had only seen 8 pipelines.
 *
 * **Run it with `CAPTURE_ON_DESKTOP=1`.** Under the private virtual display there is no vsync and
 * the present wait lands inside the engine's `update` phase, so a trace taken there attributes GPU
 * waiting to game CPU. `tools/fps.mjs` documents that trap with the numbers.
 *
 * The raw trace is large — 63 s came to 266 MB and 1.18 M events — so it is written to disk and
 * summarised rather than held in memory twice. Read the summary first; open the JSON in DevTools
 * only when the summary points somewhere specific.
 */
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";

const url = process.argv[2] ?? "http://127.0.0.1:5174/";
const seconds = Number(process.argv[3] ?? 30);
const out = process.argv[4] ?? "/tmp/wildwood-trace.json";

const browser = await chromium.launch({
  headless: false,
  args: [
    "--enable-unsafe-webgpu",
    "--enable-features=Vulkan,VulkanFromANGLE,DefaultANGLEVulkan",
    "--use-angle=vulkan",
  ],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
await page.goto(url, { waitUntil: "commit", timeout: 180_000 });
// Trace the *game*, not the load. Waiting for the reveal keeps the loading tier's compiles out of
// the sample, which would otherwise swamp exactly the stalls this is looking for.
await page
  .waitForFunction(() => globalThis.__TN_WORLD_REVEALED__ === true, undefined, {
    timeout: 180_000,
    polling: 250,
  })
  .catch(() => console.log("WARN world never reported a reveal; tracing anyway"));
await page.waitForTimeout(4_000);

const cdp = await page.context().newCDPSession(page);
const chunks = [];
cdp.on("Tracing.dataCollected", (event) => {
  for (const e of event.value) chunks.push(e);
});
const done = new Promise((resolve) => cdp.once("Tracing.tracingComplete", resolve));
await cdp.send("Tracing.start", {
  transferMode: "ReportEvents",
  traceConfig: {
    // `disabled-by-default-v8.cpu_profiler` is the one that matters: without it there are no
    // ProfileChunk events and the trace can say a task was slow but never which function.
    includedCategories: [
      "devtools.timeline",
      "disabled-by-default-devtools.timeline",
      "disabled-by-default-devtools.timeline.frame",
      "disabled-by-default-v8.cpu_profiler",
      "v8.execute",
      "blink.user_timing",
      "gpu",
    ],
  },
});

// Walk while tracing. A standing camera re-uses everything it drew last frame, which is how the
// first fps measurement in this project came back nearly twice the truth.
await page.keyboard.down("KeyW");
await page.waitForTimeout(seconds * 1000);
await page.keyboard.up("KeyW");

await cdp.send("Tracing.end");
await done;
writeFileSync(out, JSON.stringify({ traceEvents: chunks }));
console.log(`trace: ${chunks.length} events -> ${out}`);
await browser.close();

// ---- summary -------------------------------------------------------------------------------

const raf = chunks.filter((e) => e.name === "FireAnimationFrame" && e.dur).sort((a, b) => a.ts - b.ts);
const quantile = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
if (raf.length > 1) {
  const span = (raf.at(-1).ts - raf[0].ts) / 1e6;
  const gaps = [];
  for (let i = 1; i < raf.length; i += 1) gaps.push((raf[i].ts - raf[i - 1].ts) / 1000);
  gaps.sort((a, b) => a - b);
  console.log(`\nrAF ${raf.length} over ${span.toFixed(1)}s -> ${(raf.length / span).toFixed(1)} fps`);
  console.log(
    `frame interval ms  p50=${quantile(gaps, 0.5).toFixed(1)} p90=${quantile(gaps, 0.9).toFixed(1)} p99=${quantile(gaps, 0.99).toFixed(1)} max=${gaps.at(-1).toFixed(1)}`,
  );
}
const gpu = chunks.filter((e) => e.name === "GPUTask" && e.dur);
if (gpu.length > 0 && raf.length > 1) {
  const busy = gpu.reduce((s, e) => s + e.dur, 0) / 1e6;
  const span = (raf.at(-1).ts - raf[0].ts) / 1e6;
  console.log(`GPU busy ${((busy / span) * 100).toFixed(1)}%  (idle GPU means the CPU is the wall)`);
}

// The number that matters most here: how many frames blew the budget, and how badly.
const stalls = chunks.filter((e) => e.name === "RunTask" && e.dur > 40_000).sort((a, b) => b.dur - a.dur);
console.log(`\nmain-thread tasks over 40ms: ${stalls.length}`);
for (const s of stalls.slice(0, 6)) console.log(`  ${(s.dur / 1000).toFixed(0)}ms`);

// Self time per function, from the sampled profile.
const nodes = new Map();
const samples = [];
const deltas = [];
for (const c of chunks.filter((e) => e.name === "ProfileChunk")) {
  const d = c.args?.data;
  if (!d) continue;
  for (const n of d.cpuProfile?.nodes ?? []) nodes.set(n.id, n);
  for (const s of d.cpuProfile?.samples ?? []) samples.push(s);
  for (const t of d.timeDeltas ?? []) deltas.push(t);
}
if (samples.length > 0) {
  const self = new Map();
  let total = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const dt = Math.max(0, deltas[i] ?? 0);
    total += dt;
    const f = nodes.get(samples[i])?.callFrame ?? {};
    const key = `${f.functionName || "(anon)"} ${(f.url || "").split("/").slice(-1)[0]}:${(f.lineNumber ?? -1) + 1}`;
    self.set(key, (self.get(key) ?? 0) + dt);
  }
  console.log(`\nsampled CPU ${(total / 1000).toFixed(0)}ms — top self time`);
  for (const [k, v] of [...self].sort((a, b) => b[1] - a[1]).slice(0, 14)) {
    console.log(`  ${((v / total) * 100).toFixed(1).padStart(5)}%  ${(v / 1000).toFixed(0).padStart(6)}ms  ${k}`);
  }
}
