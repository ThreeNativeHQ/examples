/**
 * Steady-state frame rate: `node tools/fps.mjs <url>`
 *
 * **Run it with `CAPTURE_ON_DESKTOP=1`.** This is the one measurement in this project that the
 * private virtual display cannot make, and the way it fails is not "no answer" — it is a confident
 * wrong answer that points at the wrong file.
 *
 * Measured on this valley, same build, same 12 s window, only DISPLAY differing:
 *
 *              Xvfb        real display
 *   fps        13.3        57.7
 *   frame p50  68.5 ms      8.5 ms
 *   update p50 66.1 ms      1.0 ms   <-- the trap
 *   render p50  2.0 ms      7.3 ms
 *
 * Under Xvfb there is no vsync and no compositor, and the present wait lands inside the engine's
 * **`update`** phase. So the report reads as 66 ms of game CPU per frame — which sends you looking
 * for an expensive loop in the scene's frame callback. There isn't one: a CDP CPU profile over the
 * same window came back **84% idle**. The main thread was doing nothing at all.
 *
 * So: read `render.p50` for a GPU A/B on the virtual display, and never quote an fps from it.
 *
 * Also prints `adapter.info`. Chromium serves WebGPU from SwiftShader without the Vulkan flags
 * below, with healthy-looking limits and no error, so a run that does not say `nvidia` is
 * measuring a CPU rasteriser.
 *
 * Settles 12 s before counting: late pipeline compiles land in the first seconds and a 6 s window
 * started too early reported 30.8 fps on a build that holds 57.7.
 */
import { chromium } from "playwright";
const url = process.argv[2];
const browser = await chromium.launch({ headless: false, args: ["--enable-unsafe-webgpu","--enable-features=Vulkan,VulkanFromANGLE,DefaultANGLEVulkan","--use-angle=vulkan"] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const budgets = [];
page.on("console", (m) => { const t = m.text(); if (t.startsWith("TN_FRAME_BUDGET")) budgets.push(t); });
await page.goto(url, { waitUntil: "commit", timeout: 180_000 });
await page.waitForFunction(() => globalThis.__TN_WORLD_REVEALED__ === true, undefined, { timeout: 180_000, polling: 250 });
await page.waitForTimeout(12000); // settle: late pipeline compiles land in the first seconds
const adapter = await page.evaluate(async () => {
  const a = await navigator.gpu?.requestAdapter();
  return a?.info ? { arch: a.info.architecture, vendor: a.info.vendor } : null;
});
console.log("adapter:", JSON.stringify(adapter));
// Count presented frames in-page over a fixed window. rAF is throttled under Xvfb, so this is
// reported alongside the engine's own GPU/CPU meters rather than instead of them.
const fps = await page.evaluate(async () => {
  let n = 0;
  const t0 = performance.now();
  await new Promise((done) => {
    const tick = () => { n += 1; if (performance.now() - t0 < 12000) requestAnimationFrame(tick); else done(); };
    requestAnimationFrame(tick);
  });
  return { frames: n, ms: performance.now() - t0 };
});
console.log(`rAF frames=${fps.frames} over ${Math.round(fps.ms)}ms -> ${(fps.frames / (fps.ms / 1000)).toFixed(1)} fps`);
console.log("--- engine frame budget lines (last 3) ---");
for (const line of budgets.slice(-2)) {
  const j = JSON.parse(line.replace("TN_FRAME_BUDGET:", ""));
  console.log(`fps=${j.fps} frame p50=${j.frame.p50} mean=${j.frame.mean} hitches=${j.hitches}`);
  for (const [name, v] of Object.entries(j.phases)) {
    console.log(`  ${name.padEnd(12)} p50=${String(v.p50).padStart(7)} mean=${String(v.mean).padStart(7)} p95=${String(v.p95).padStart(7)} max=${String(v.max).padStart(7)}`);
  }
}
await browser.close();
