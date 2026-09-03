/**
 * Where the frame actually goes: `CAPTURE_ON_DESKTOP=1 tools/capture-lock.sh node tools/perf-probe.mjs <url> [width] [height]`
 *
 * Two things `tools/fps.mjs` does not do, both of which flattered the last result:
 *  - it measures with the camera STANDING STILL, and a static frustum re-uses everything;
 *  - it measures at 1600x900, which is not necessarily the window a person plays in.
 *
 * This drives the walker with real key events while sampling, and reports the engine's own phase
 * breakdown for the moving window rather than the idle one.
 */
import { chromium } from "playwright";
const url = process.argv[2];
const width = Number(process.argv[3] ?? 1600);
const height = Number(process.argv[4] ?? 900);
const browser = await chromium.launch({
  headless: false,
  args: ["--enable-unsafe-webgpu", "--enable-features=Vulkan,VulkanFromANGLE,DefaultANGLEVulkan", "--use-angle=vulkan"],
});
const page = await browser.newPage({ viewport: { width, height } });
const budgets = [];
page.on("console", (m) => { const t = m.text(); if (t.startsWith("TN_FRAME_BUDGET")) budgets.push(t); });
await page.goto(url, { waitUntil: "commit", timeout: 180_000 });
await page.waitForFunction(() => globalThis.__TN_WORLD_REVEALED__ === true, undefined, { timeout: 180_000, polling: 250 });
await page.waitForTimeout(12_000); // late pipeline compiles land in the first seconds

const adapter = await page.evaluate(async () => {
  const a = await navigator.gpu?.requestAdapter();
  const c = document.querySelector("canvas");
  return {
    adapter: a?.info ? `${a.info.architecture} / ${a.info.vendor}` : "unknown",
    css: c ? [c.clientWidth, c.clientHeight] : null,
    buffer: c ? [c.width, c.height] : null,
    dpr: devicePixelRatio,
  };
});
console.log(`viewport=${width}x${height} ${JSON.stringify(adapter)}`);

const sample = async (label, moving) => {
  budgets.length = 0;
  if (moving) await page.keyboard.down("KeyW");
  const fps = await page.evaluate(async () => {
    let n = 0; const t0 = performance.now();
    await new Promise((done) => {
      const tick = () => { n += 1; if (performance.now() - t0 < 10_000) requestAnimationFrame(tick); else done(); };
      requestAnimationFrame(tick);
    });
    return { frames: n, ms: performance.now() - t0 };
  });
  if (moving) await page.keyboard.up("KeyW");
  const line = budgets.at(-1);
  console.log(`\n=== ${label} === rAF ${(fps.frames / (fps.ms / 1000)).toFixed(1)} fps`);
  if (line) {
    const j = JSON.parse(line.replace("TN_FRAME_BUDGET:", ""));
    // The scale is part of every result. A frame rate quoted without the drawing buffer it was
    // held at is not a measurement — `resolutionScale: "auto"` buys fps with pixels, so two runs
    // that both say 60 can be rendering a quarter of an image apart.
    const s = j.surface ?? {};
    console.log(
      `  surface scale=${String(s.resolutionScale)} buffer=${String(s.drawingBufferWidth)}x${String(s.drawingBufferHeight)} atFloor=${String(s.atFloor)} source=${String(s.scaleSource)}`,
    );
    console.log(`  engine fps=${j.fps} frame p50=${j.frame.p50} p95=${j.frame.p95} max=${j.frame.max} hitches=${j.hitches} gpuMs=${String(j.gpuMs ?? "-")}`);
    for (const [name, v] of Object.entries(j.phases)) {
      console.log(`  ${name.padEnd(11)} p50=${String(v.p50).padStart(7)} p95=${String(v.p95).padStart(7)} max=${String(v.max).padStart(7)}`);
    }
  }
};

await sample("STANDING STILL", false);
await sample("WALKING", true);
await browser.close();
