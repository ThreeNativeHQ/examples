/** Live resolution regression: real flight and C-key camera switches, no injected frame timings.
 * Run through tools/capture-lock.sh against an HMR-disabled Vite server.
 * --observe records a pre-fix baseline without requiring full resolution.
 */
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";

const out = process.env.MIDWAY_SHOTS || "screenshots/resolution";
const duration = Number(process.env.MIDWAY_SECONDS || 90);
const loadout = process.env.MIDWAY_LOADOUT || "bomb";
assert.ok(Number.isFinite(duration) && duration >= 60, "observe at least 60 seconds");
assert.ok(["bomb", "torpedo"].includes(loadout), "known loadout");
await mkdir(out, { recursive: true });
const browser = await chromium.launch({
  headless: false,
  args: ["--enable-unsafe-webgpu", "--enable-features=Vulkan", "--disable-gpu-sandbox",
    "--ignore-gpu-blocklist", "--ozone-platform=x11", "--enable-dawn-features=allow_unsafe_apis"],
});
const errors = [];
const samples = [];
let budget;
let page;
const messages = [];
try {
  page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  page.on("pageerror", e => errors.push(String(e)));
  page.on("console", m => {
    messages.push(m.text());
    if (messages.length > 12) messages.shift();
    if (m.type() === "error") errors.push(m.text());
    if (m.text().startsWith("TN_FRAME_BUDGET:")) budget = JSON.parse(m.text().slice("TN_FRAME_BUDGET:".length));
  });
  await page.goto(process.env.MIDWAY_URL || "http://127.0.0.1:5391");
  await page.waitForSelector("#loading.hidden", { state: "attached", timeout: 120000 });
  await page.waitForSelector("#briefing:not(.hidden)");
  const adapter = await page.evaluate(async () => {
    const url = performance.getEntriesByType("resource").map(e => e.name)
      .findLast(n => /\/src\/game\.ts(?:\?|$)/.test(n));
    window.midway = (await import(url)).default.scene;
    const a = await navigator.gpu.requestAdapter();
    return { vendor: a?.info.vendor, architecture: a?.info.architecture, description: a?.info.description };
  });
  assert.ok(adapter.vendor && !/swiftshader|lavapipe|llvmpipe/i.test(JSON.stringify(adapter)),
    `real GPU required: ${JSON.stringify(adapter)}`);
  console.log("adapter", JSON.stringify(adapter));
  await page.click(`#loadout-${loadout}`);
  await page.click("#start-air");
  const sample = async (label) => {
    const s = await page.evaluate(() => {
      const m = window.midway;
      const canvas = m.world.renderer.domElement;
      const rect = canvas.getBoundingClientRect();
      return { time: m.battle.time, camera: m.world.cameraMode, mode: m.battle.player.mode,
        surface: m.ctx.renderer.surface(),
        canvas: { width: canvas.width, height: canvas.height, cssWidth: rect.width, cssHeight: rect.height },
        pixelRatio: m.world.renderer.getPixelRatio() };
    });
    s.budget = budget;
    samples.push({ label, ...s });
    console.log(label, JSON.stringify({ time: s.time, camera: s.camera, surface: s.surface,
      fps: s.budget?.fps, gpuMs: s.budget?.gpuMs, presented: s.budget?.presented }));
  };
  await sample("start");
  await page.screenshot({ path: `${out}/start.png` });
  for (let seconds = 5; seconds <= duration; seconds += 5) {
    await page.waitForTimeout(5000);
    // One full chase → cockpit → wide → overhead → chase cycle every 30 seconds.
    if (seconds % 10 === 0) {
      const before = await page.evaluate(() => window.midway.world.cameraMode);
      await page.keyboard.press("KeyC");
      await page.waitForFunction(mode => window.midway.world.cameraMode === mode, (before + 1) % 4);
    }
    await sample(`${seconds}s`);
    if (seconds === 10 || seconds === 30) await page.screenshot({ path: `${out}/${seconds}s.png` });
  }
  await page.screenshot({ path: `${out}/end.png` });
  await writeFile(`${out}/samples.json`, JSON.stringify({ adapter, loadout, errors, samples }, null, 2));
  assert.deepEqual(errors, [], "no browser errors");
  assert.ok(samples.at(-1).time - samples[0].time >= 30, "simulation advanced during observation");
  assert.deepEqual([...new Set(samples.map(s => s.camera))].sort(), [0, 1, 2], "all three cameras exercised");
  assert.ok(samples.some(s => Number.isFinite(s.budget?.fps)), "frame budgets remain available");
  if (!process.argv.includes("--observe")) {
    assert.equal(Math.min(...samples.map(s => s.surface.resolutionScale)), 1, "full resolution throughout");
    for (const s of samples) {
      assert.equal(s.surface.scaleSource, "auto", `${s.label}: automatic policy remains active`);
      assert.equal(s.canvas.width, Math.round(s.canvas.cssWidth * s.pixelRatio), `${s.label}: actual width`);
      assert.equal(s.canvas.height, Math.round(s.canvas.cssHeight * s.pixelRatio), `${s.label}: actual height`);
    }
  }
  console.log(process.argv.includes("--observe") ? "OBSERVED" : "PASS: resolution stayed full through flight and camera switches");
} catch (error) {
  console.error("last browser messages", JSON.stringify(messages));
  if (page) await page.screenshot({ path: `${out}/failure.png`, timeout: 5000 }).catch(() => {});
  throw error;
} finally {
  if (errors.length) console.error("browser errors", JSON.stringify(errors));
  await browser.close();
}
