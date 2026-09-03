/**
 * Screenshot the valley WITH its detail tier attached, and measure the frame rate it costs:
 *
 *   tools/capture-lock.sh node tools/foliage-shot.mjs <url> <outdir> [spawns...]
 *
 * Why this exists alongside `tools/shot.mjs`: that tool waits on `__TN_STARTUP_READY__`, which
 * the engine flips once the *critical* tier is on screen — before the ~70 flora GLBs of the
 * detail tier have loaded. Every capture of a foliage change through it screenshots the loading
 * layer at ~70%, which grades the loader, not the wood. This one waits for the scene's own
 * `TN_VALLEY_DETAIL_DONE` marker, then holds long enough to measure a steady frame rate.
 *
 * The frame rate is counted in the page with `requestAnimationFrame`, not read off the engine's
 * `TN_FRAME_BUDGET` window, because the budget window reports the scale the engine settled on
 * and its own phase timings — useful, and printed too, but a density change has to be graded on
 * frames actually presented.
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const url = process.argv[2] ?? "http://127.0.0.1:5301/";
const out = process.argv[3] ?? "/tmp/lane-b-shots";
const spawns = process.argv.slice(4);
const settleMs = Number(process.env.FOLIAGE_SHOT_SETTLE_MS ?? 6000);
const measureMs = Number(process.env.FOLIAGE_SHOT_MEASURE_MS ?? 6000);
mkdirSync(out, { recursive: true });

// Headed, WebGPU on. Headless Chromium serves WebGPU from SwiftShader and hands back a black
// canvas, so a headless capture of a shader-lit wood proves nothing. `capture-lock.sh` puts this
// on a private Xvfb, so headed does not mean "on your desktop".
const browser = await chromium.launch({
  headless: false,
  args: [
    "--enable-unsafe-webgpu",
    "--enable-features=Vulkan,VulkanFromANGLE,DefaultANGLEVulkan",
    "--use-angle=vulkan",
  ],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errors = [];
const logs = [];
let detailDone = "";
let budget = "";
page.on("pageerror", (e) => errors.push(((e && e.stack) || (e && e.message) || String(e)).slice(0, 900)));
page.on("console", (m) => {
  const t = m.text();
  if (t.startsWith("TN_VALLEY_DETAIL_DONE")) detailDone = t;
  if (t.startsWith("TN_FRAME_BUDGET")) budget = t.slice(0, 600);
  if (/TN_VALLEY|TN_FLORA|TN_FOLIAGE|error|Error|WARN|fail/i.test(t)) logs.push(t.slice(0, 400));
});

/** Count presented frames in the page over a window, so the number is frames, not phase timings. */
const measureFps = async (ms) =>
  page.evaluate(async (window_) => {
    let frames = 0;
    const start = performance.now();
    await new Promise((resolve) => {
      const tick = () => {
        frames += 1;
        if (performance.now() - start >= window_) resolve(undefined);
        else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    return Math.round((frames / (performance.now() - start)) * 10_000) / 10;
  }, ms);

const shoot = async (name, at) => {
  detailDone = "";
  const target = at === undefined ? url : `${url}${url.includes("?") ? "&" : "?"}spawn=${at}`;
  await page.goto(target, { waitUntil: "networkidle", timeout: 180_000 });
  const ready = await page
    .waitForFunction(() => globalThis.__TN_STARTUP_READY__ === true, undefined, {
      timeout: 180_000,
      polling: 500,
    })
    .then(() => true, () => false);
  if (!ready) console.log("WARN __TN_STARTUP_READY__ never flipped");
  // The detail tier attaches one mesh family per presented frame after readiness. Poll the marker
  // the scene prints when the last of them is in; only then is there a wood to photograph.
  const deadline = Date.now() + 240_000;
  while (detailDone === "" && Date.now() < deadline) await page.waitForTimeout(500);
  if (detailDone === "") console.log("WARN TN_VALLEY_DETAIL_DONE never arrived — shooting anyway");
  await page.waitForTimeout(settleMs);
  const fps = await measureFps(measureMs);
  await page.screenshot({ path: `${out}/${name}.png` });
  console.log(`shot ${name} fps=${String(fps)} ${detailDone}`);
};

if (spawns.length === 0) await shoot("spawn");
else for (const [index, at] of spawns.entries()) await shoot(`view-${String(index)}`, at);

if (budget !== "") console.log(`\n${budget}`);
console.log("\n=== console ===");
for (const line of logs.slice(-30)) console.log(line);
if (errors.length > 0) {
  console.log("\n=== PAGE ERRORS ===");
  for (const line of errors.slice(0, 10)) console.log(line);
}
await browser.close();
