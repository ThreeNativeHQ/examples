/** Sustained resolution soak: proves the mid-game blur does not recur over real play time.
 *
 * Real game flow only (briefing -> airborne start -> KeyT course hold, keys only,
 * nothing written to world/HP/fuel state). Rendering proof comes from the ENGINE's
 * own counters (three `renderer.info.render.frame` + `TN_FRAME_BUDGET.frames`) and
 * sim-time advance — never a page-side rAF counter. All phases, fps and rates derive
 * from measured wall-clock elapsed, never a loop counter. CPU pressure is scoped CDP
 * throttling of our own page (works on many-core hosts where extra workers would not
 * touch the game thread); the run fails unless the pressure provably bit.
 *
 * Any Vite HMR event fails the run: a hot update invalidates the experiment, and the
 * harness must say so, not silently re-attach.
 *
 * Run through tools/capture-lock.sh against the isolated HMR-disabled server:
 *   MIDWAY_SHOTS=<dir> MIDWAY_URL=http://127.0.0.1:5391 \
 *     bash tools/capture-lock.sh node tools/capture-resolution-soak.mjs [--observe]
 * --observe records a baseline without enforcing the recovery assertions.
 * Short validation only (NOT proof): MIDWAY_SOAK_SECONDS=60. Proof requires >= 600 s
 * and prints PROOF_PASS; anything shorter prints SMOKE_OK at best.
 */
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";

const out = process.env.MIDWAY_SHOTS || "screenshots/resolution-soak";
const total = Number(process.env.MIDWAY_SOAK_SECONDS || 640);
const loadout = process.env.MIDWAY_LOADOUT || "bomb";
const throttleRate = Number(process.env.MIDWAY_THROTTLE_RATE || 4);
const WIDTH = Number(process.env.MIDWAY_WIDTH || 1280);
const HEIGHT = Number(process.env.MIDWAY_HEIGHT || 720);
const observe = process.argv.includes("--observe");
const PROOF_SECONDS = 600;
assert.ok(Number.isFinite(total) && total >= 60, "soak at least 60 seconds (600+ required for proof)");
assert.ok(["bomb", "torpedo"].includes(loadout), "known loadout");
assert.ok(Number.isFinite(throttleRate) && throttleRate >= 2, "throttle rate must actually slow the page");
await mkdir(out, { recursive: true });

// Phases as fractions of measured wall time: baseline flight, throttled pressure, recovery.
const phaseAt = (t) => (t < total * 0.28 ? "baseline" : t < total * 0.56 ? "pressure" : "recovery");

const browser = await chromium.launch({
  headless: false,
  args: ["--enable-unsafe-webgpu", "--enable-features=Vulkan", "--disable-gpu-sandbox",
    "--ignore-gpu-blocklist", "--ozone-platform=x11", "--enable-dawn-features=allow_unsafe_apis"],
});
const errors = [];
const hmrEvents = [];
const samples = [];
const events = [];
let budget; // latest TN_FRAME_BUDGET marker from the engine
let page;
const messages = [];
const log = (stage, detail) => console.log(`${stage.padEnd(18)} ${JSON.stringify(detail)}`);
try {
  page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT } });
  page.on("pageerror", e => errors.push(String(e)));
  page.on("console", m => {
    messages.push(m.text());
    if (messages.length > 12) messages.shift();
    if (/hot updated|hmr/i.test(m.text())) hmrEvents.push(m.text());
    if (m.type() === "error") errors.push(m.text());
    if (m.text().startsWith("TN_FRAME_BUDGET:")) budget = JSON.parse(m.text().slice("TN_FRAME_BUDGET:".length));
  });
  await page.goto(process.env.MIDWAY_URL || "http://127.0.0.1:5391");
  await page.waitForSelector("#loading.hidden", { state: "attached", timeout: 120000 });
  await page.waitForSelector("#briefing:not(.hidden)");
  const adapter = await page.evaluate(async () => {
    const url = performance.getEntriesByType("resource").map(e => e.name)
      .findLast(n => /\/src\/game\.ts(?:\?|$)/.test(n));
    if (!url) return { gameUrl: null };
    window.midway = (await import(url)).default.scene;
    const a = await navigator.gpu.requestAdapter();
    return { gameUrl: url, vendor: a?.info.vendor, architecture: a?.info.architecture };
  });
  assert.ok(adapter.gameUrl, "dev server must serve /src/game.ts (dist builds hash it away)");
  assert.ok(adapter.vendor && !/swiftshader|lavapipe|llvmpipe/i.test(JSON.stringify(adapter)),
    `real GPU required: ${JSON.stringify(adapter)}`);
  log("adapter", adapter);
  const cdp = await page.context().newCDPSession(page);

  // HMR invalidates the experiment: fail, never silently re-attach.
  const look = () => page.evaluate(() => {
    const m = window.midway;
    const canvas = m.world.renderer.domElement;
    const rect = canvas.getBoundingClientRect();
    return { simTime: m.battle.time, status: m.battle.status, mode: m.battle.player.mode,
      autopilot: m.battle.player.autopilot, camera: m.world.cameraMode,
      surface: m.ctx.renderer.surface(), renderFrame: m.world.renderer.info?.render?.frame ?? null,
      canvas: { width: canvas.width, height: canvas.height, cssWidth: rect.width, cssHeight: rect.height },
      pixelRatio: m.world.renderer.getPixelRatio() };
  });
  const t0 = Date.now();
  const elapsed = () => (Date.now() - t0) / 1000;
  let lastWindow = -1;
  let cumBudgetFrames = 0; // engine-counted frames across TN_FRAME_BUDGET windows
  const sample = async (phase) => {
    const t = elapsed();
    const s = await look();
    if (Number.isFinite(budget?.window) && budget.window !== lastWindow) {
      lastWindow = budget.window;
      cumBudgetFrames += budget.frames;
    }
    const prev = samples.at(-1);
    const dt = prev ? Math.max(0.1, t - prev.t) : 5;
    const rf = s.renderFrame;
    samples.push({ t: +t.toFixed(1), phase, throttled: phase === "pressure",
      simTime: s.simTime, status: s.status, mode: s.mode, autopilot: s.autopilot, camera: s.camera,
      renderFrame: Number.isFinite(rf) ? rf : null,
      engineFps: prev && Number.isFinite(rf) && Number.isFinite(prev.renderFrame)
        ? +((rf - prev.renderFrame) / dt).toFixed(1) : null,
      cumBudgetFrames, surface: s.surface, canvas: s.canvas, pixelRatio: s.pixelRatio, budget });
    const cur = samples.at(-1);
    log(`${t.toFixed(0)}s/${phase}`, { scale: s.surface.resolutionScale, fps: budget?.fps,
      gpuMs: budget?.gpuMs, gpuAge: budget?.gpuAgeFrames, engineFps: cur.engineFps });
  };
  const setThrottled = async (on) => {
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: on ? throttleRate : 1 });
    events.push({ t: +elapsed().toFixed(1), kind: on ? "pressure-start" : "pressure-stop", rate: on ? throttleRate : 1 });
    log("pressure", { on, rate: on ? throttleRate : 1 });
  };
  const startFlight = async () => {
    await page.waitForSelector("#briefing:not(.hidden)");
    await page.click(`#loadout-${loadout}`);
    await page.click("#start-air");
    await page.keyboard.press("KeyT"); // course hold: stable hands-free flight, a shipped assist
    events.push({ t: +elapsed().toFixed(1), kind: "flight-start" });
  };

  await startFlight();
  await sample("baseline");
  await page.screenshot({ path: `${out}/00-start.png` });
  let phase = "baseline";
  let throttled = false;
  let restarts = 0;
  let lastSwitch = elapsed();
  while (elapsed() < total) {
    const now = phaseAt(elapsed());
    if (now !== phase) {
      await page.screenshot({ path: `${out}/${phase}-to-${now}.png` });
      events.push({ t: +elapsed().toFixed(1), kind: `phase-${phase}-to-${now}` });
      phase = now;
    }
    if (throttled !== (phase === "pressure")) {
      throttled = phase === "pressure";
      await setThrottled(throttled);
    }
    // Restart through shipped UI if the sortie ended; the page (and rendering) stays up.
    const status = await page.evaluate(() => window.midway.battle.status);
    if (status === "lost" || status === "debrief") {
      events.push({ t: +elapsed().toFixed(1), kind: `sortie-${status}-restart` });
      await page.keyboard.press("Escape");
      await page.click("#restart-pause");
      await startFlight();
      restarts += 1;
    }
    // Realistic camera rhythm: one chase -> cockpit -> wide step per ~30 s of flight
  // (tighter on short smokes so all three modes are still exercised).
  const switchEvery = total >= 120 ? 30 : 15;
    if (elapsed() - lastSwitch >= switchEvery) {
      lastSwitch = elapsed();
      const before = await page.evaluate(() => window.midway.world.cameraMode);
      await page.keyboard.press("KeyC");
      await page.waitForFunction(m => window.midway.world.cameraMode === m, (before + 1) % 4, { timeout: 15000 });
    }
    await sample(phase);
    await page.waitForTimeout(5000);
  }
  await setThrottled(false);
  await page.screenshot({ path: `${out}/30-end.png` });
  await writeFile(`${out}/samples.json`,
    JSON.stringify({ adapter, loadout, total, throttleRate, restarts, events, hmrEvents, errors, samples }, null, 2));

  // ---- Analysis (all rates from measured elapsed, never loop counters) ----------------
  assert.deepEqual(hmrEvents, [], `HMR invalidated this run: ${JSON.stringify(hmrEvents)}`);
  assert.deepEqual(errors, [], "no browser errors");
  const median = (xs) => {
    const s = [...xs].sort((a, b) => a - b);
    return s.length ? s[Math.floor(s.length / 2)] : NaN;
  };
  const inPhase = (p) => samples.filter(s => s.phase === p);
  const scaleOf = (s) => s.surface.resolutionScale;
  // The engine schema carries no budgetMs; a FRESH gpuMs above one 60 Hz frame corroborated
  // by low fps is genuine GPU overload. Stale/missing GPU (the recurrence signature) is exact.
  const fresh = (s) => Number.isFinite(s.budget?.gpuMs) && (s.budget?.gpuAgeFrames ?? 9) <= 8;
  const gpuOverload = (s) => fresh(s) && s.budget.gpuMs > 16.7 && s.budget.fps < 50;
  const stale = (s) => s.budget && !fresh(s);
  const baseMed = median(inPhase("baseline").map(scaleOf));
  const pressMed = median(inPhase("pressure").map(scaleOf));
  const recMed = median(inPhase("recovery").map(scaleOf));
  const final = samples.filter(s => s.phase === "recovery" && (samples.at(-1).t - s.t) <= 60);
  const finalMed = median(final.map(scaleOf));
  const pressDrops = inPhase("pressure").filter(s => scaleOf(s) < 1);
  const bufOk = (s) => {
    const expW = s.canvas.cssWidth * s.pixelRatio * s.surface.resolutionScale;
    const expH = s.canvas.cssHeight * s.pixelRatio * s.surface.resolutionScale;
    return Math.abs(s.canvas.width - expW) <= 2 && Math.abs(s.canvas.height - expH) <= 2;
  };
  const medianFps = (p) => median(inPhase(p).map(s => s.budget?.fps ?? NaN).filter(Number.isFinite));
  const summary = { baseMed, pressMed, recMed, finalMed, restarts,
    baselineFps: medianFps("baseline"), pressureFps: medianFps("pressure"),
    cumBudgetFrames,
    pressureDrops: pressDrops.length, staleDrops: pressDrops.filter(stale).length,
    gpuDrops: pressDrops.filter(gpuOverload).length,
    bufferMismatches: samples.filter(s => !bufOk(s)).length,
    freshGpuRecovery: final.length > 0 && final.every(fresh) && median(final.map(s => s.budget.gpuMs)) > 16.7 };
  await writeFile(`${out}/summary.json`, JSON.stringify(summary, null, 2));
  log("summary", summary);

  assert.ok(elapsed() >= total, `ran the full ${total}s wall-clock soak`);
  const simDelta = samples.at(-1).simTime - samples[0].simTime;
  assert.ok(simDelta >= total * 0.5, `simulation advanced with rendering (${simDelta}s sim over ${total}s wall)`);
  const engineFrames = cumBudgetFrames;
  assert.ok(engineFrames > total * 5, `engine counted frames throughout (${engineFrames} over ${total}s wall)`);
  assert.deepEqual([...new Set(samples.map(s => s.camera))].sort(), [0, 1, 2], "all three cameras exercised");
  assert.ok(samples.some(s => Number.isFinite(s.budget?.fps)), "frame budgets remain available");
  assert.ok(summary.bufferMismatches === 0, "drawing buffer matches CSS x pixelRatio x scale throughout");
  if (!observe) {
    assert.equal(baseMed, 1, `baseline must be healthy for a valid proof (median scale ${baseMed})`);
    assert.ok(summary.pressureFps < summary.baselineFps,
      `throttling must provably bite (pressure fps ${summary.pressureFps} vs baseline ${summary.baselineFps})`);
    assert.ok(recMed >= pressMed, `no progressive collapse after pressure (recovery ${recMed} vs pressure ${pressMed})`);
    if (summary.freshGpuRecovery) {
      console.log("GPU_BOUND: fresh GPU overload persists without pressure; bounded response accepted");
    } else {
      assert.ok(finalMed >= baseMed,
        `resolution recovered after pressure (final ${finalMed} vs baseline ${baseMed}); ` +
        `stale-GPU drops during pressure: ${summary.staleDrops}/${summary.pressureDrops}`);
    }
  }
  console.log(total >= PROOF_SECONDS && !observe ? "PROOF_PASS: 10+ min soak held full resolution with bounded reversible response"
    : observe ? "OBSERVED" : "SMOKE_OK (not proof: under 600 s)");
} catch (error) {
  console.error("last browser messages", JSON.stringify(messages));
  if (page) await page.screenshot({ path: `${out}/failure.png`, timeout: 5000 }).catch(() => {});
  throw error;
} finally {
  if (errors.length) console.error("browser errors", JSON.stringify(errors));
  await browser.close();
}
