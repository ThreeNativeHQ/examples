/**
 * Deck-start per-pass cost, read from the engine's own `TN_FRAME_BUDGET` window.
 *
 * Promoted from `docs/perf/deck-probe-20260922.mjs`, which read `renderer.info.render` and so could
 * only ever report main plus every nested pass summed. `info` is reset once per frame and shared by
 * the nested shadow and reflection `render()` calls, so it cannot say which pass a change moved.
 * The frame budget's `passes` block is the split — main, shadow, reflection, nested, by draws and
 * triangles — and the same window carries the GPU and render-phase p50/p95, so the whole report is
 * one instrument's numbers.
 *
 * Sampling starts only after the briefing's `warmUpViews()` resolves, so the compile's texture
 * uploads are not in the window. `MIDWAY_HIDE` names a layer to switch off for attribution; the
 * hide is re-applied after every `World.update`, which otherwise rewrites `visible` each frame.
 *
 *   MIDWAY_URL=http://localhost:5341 node tools/capture-deck-perf.mjs
 *   MIDWAY_HIDE=us-carriers MIDWAY_URL=http://localhost:5341 node tools/capture-deck-perf.mjs
 */
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright";

const URL = process.env.MIDWAY_URL || "http://localhost:5341";
const WIDTH = Number(process.env.MIDWAY_WIDTH || 1920);
const HEIGHT = Number(process.env.MIDWAY_HEIGHT || 1080);
const WARMUP = Number(process.env.MIDWAY_WARMUP || 8);
// The marker the engine prints once per report window (default every 300 presented frames).
const MARKER = "TN_FRAME_BUDGET:";
const HIDDEN = process.env.MIDWAY_HIDE || null;

const budgetWindows = [];
let budgetCursor = 0;

const browser = await chromium.launch({
  headless: false,
  args: [
    "--enable-unsafe-webgpu",
    "--enable-features=Vulkan",
    "--disable-gpu-sandbox",
    "--ignore-gpu-blocklist",
    "--ozone-platform=x11",
    // Timestamp queries are behind Dawn's unsafe-API flag; without them there is no GPU series.
    "--enable-dawn-features=allow_unsafe_apis",
  ],
});
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT } });
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    const text = m.text();
    if (text.startsWith(MARKER)) {
      try {
        budgetWindows.push(JSON.parse(text.slice(MARKER.length)));
      } catch {
        errors.push(`unparseable ${MARKER} line: ${text.slice(0, 200)}`);
      }
      return;
    }
    if (m.type() === "error") errors.push(text);
  });
  await page.goto(URL);
  await page.waitForSelector("#loading.hidden", { state: "attached", timeout: 180000 });
  await page.waitForSelector("#briefing:not(.hidden)");
  await page.evaluate(async () => {
    const urls = performance
      .getEntriesByType("resource")
      .map((e) => e.name)
      .filter((n) => /\/src\/game\.ts(?:\?|$)/.test(n))
      .reverse();
    for (const url of urls) {
      const s = (await import(url)).default.scene;
      if (s?.battle) {
        window.midway = s;
        return;
      }
    }
    throw new Error("no scene");
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
  if (/swiftshader|lavapipe|llvmpipe/i.test(JSON.stringify(adapter)))
    throw new Error(`software adapter, the figure would be meaningless: ${JSON.stringify(adapter)}`);

  // The briefing's compile is unawaited by the game; sample only once it has settled.
  const warmUp = await page.evaluate(async () => {
    const w = window.midway.world;
    const started = performance.now();
    while (w.warmUpDone === null || w.warmUpDone === undefined)
      await new Promise((r) => setTimeout(r, 20));
    const resolvedAt = await w.warmUpDone;
    return { resolvedAt, waitedMs: performance.now() - started };
  });
  console.log(
    `warm-up resolved at ${warmUp.resolvedAt.toFixed(1)} ms (page clock); the wait began ${warmUp.waitedMs.toFixed(1)} ms before it`,
  );

  // The deck start: the player aboard the home carrier, its full park and crew on screen.
  await page.evaluate(() => window.midway.begin(false));

  // Attribution hide. `World.update` rewrites `visible` on every ship every frame, so re-hide the
  // chosen ids after each update rather than letting the hide be undone.
  if (HIDDEN)
    await page.evaluate((what) => {
      const w = window.midway.world;
      const hidden = new Set();
      if (what === "sea") w.sea.visible = false;
      if (what === "ships") for (const id of w.meshes.keys()) if (!id.startsWith("air-")) hidden.add(id);
      // The three Yorktown-class US carriers are the ships drawn from `hornet.glb`.
      if (what === "us-carriers")
        for (const s of w.battle.ships) if (s.team === "us" && s.kind === "carrier") hidden.add(s.id);
      if (what === "crew") w.crew.group.visible = false;
      if (what === "sky") w.scene.background = null;
      if (hidden.size) {
        const apply = () => {
          for (const id of hidden) {
            const m = w.meshes.get(id);
            if (m) m.visible = false;
          }
        };
        const orig = w.update;
        w.update = function (...args) {
          orig.apply(this, args);
          apply();
        };
        apply();
      }
    }, HIDDEN);

  // Warm-up, then four complete windows. The first windows after the cursor can straddle setup or
  // the tail of the compile, so the last two are taken and both are reported.
  await page.waitForTimeout(WARMUP * 1000);
  const wanted = 4;
  const needed = budgetCursor + wanted;
  const deadline = Date.now() + 240000;
  while (budgetWindows.length < needed) {
    if (Date.now() > deadline)
      throw new Error(
        `no ${MARKER} window in 240 s (have ${budgetWindows.length - budgetCursor} of ${wanted}) — is the frame budget installed?`,
      );
    await page.waitForTimeout(100);
  }
  const measured = budgetWindows.slice(needed - 2, needed);
  budgetCursor = needed;

  const PASS_KINDS = ["main", "shadow", "reflection", "nested"];
  const summarize = (w) => {
    const passes = {};
    let totalDraws = 0;
    let totalTriangles = 0;
    for (const kind of PASS_KINDS) {
      const p = w.passes?.[kind];
      if (!p) continue;
      passes[kind] = {
        frames: p.frames,
        drawsMean: +p.draws.mean.toFixed(1),
        drawsP50: p.draws.p50,
        trianglesMean: Math.round(p.triangles.mean),
      };
      totalDraws += p.draws.mean;
      totalTriangles += p.triangles.mean;
    }
    return {
      frames: w.frames,
      fps: w.fps,
      surface: w.surface
        ? { width: w.surface.drawingBufferWidth, height: w.surface.drawingBufferHeight }
        : null,
      passes,
      totalDrawsMean: +totalDraws.toFixed(1),
      totalTrianglesMean: Math.round(totalTriangles),
      gpuP50: w.gpu?.p50 ?? null,
      gpuP95: w.gpu?.p95 ?? null,
      renderCpuP50: w.phases.render.p50,
      renderCpuP95: w.phases.render.p95,
    };
  };
  const windows = measured.map(summarize);

  const record = {
    tool: "capture-deck-perf",
    schema: 1,
    at: new Date().toISOString(),
    adapter,
    url: URL,
    viewport: { width: WIDTH, height: HEIGHT },
    hidden: HIDDEN,
    warmUpResolvedAtMs: +warmUp.resolvedAt.toFixed(1),
    windows,
  };

  console.log(`adapter ${JSON.stringify(adapter)}`);
  console.log(`viewport ${WIDTH}x${HEIGHT}, MIDWAY_HIDE=${HIDDEN ?? "none"}`);
  for (const [i, w] of windows.entries()) {
    const pass = PASS_KINDS.filter((k) => w.passes[k])
      .map((k) => `${k} ${w.passes[k].drawsMean}d/${w.passes[k].trianglesMean}t`)
      .join("  ");
    console.log(
      `window ${i + 1}: ${w.frames} frames, ${w.fps} fps, surface ${w.surface ? `${w.surface.width}x${w.surface.height}` : "unavailable"}\n` +
        `  passes ${pass || "unavailable: no pass recorder"}\n` +
        `  total ${w.totalDrawsMean} draws, ${w.totalTrianglesMean} triangles\n` +
        `  gpu p50/p95 ${w.gpuP50 ?? "n/a"}/${w.gpuP95 ?? "n/a"} ms, render cpu p50/p95 ${w.renderCpuP50}/${w.renderCpuP95} ms`,
    );
  }
  if (!windows.some((w) => Object.keys(w.passes).length))
    throw new Error("the frame budget reported no per-pass split; nothing to attribute");

  // The stock baseline, written where AC-2 records it. A hidden run is attribution, never a baseline.
  const baselineOut = process.env.MIDWAY_DECK_BASELINE_OUT || (!HIDDEN ? join(import.meta.dirname, "..", "docs/perf/deck-baseline-20260922.json") : null);
  if (baselineOut) {
    await writeFile(baselineOut, JSON.stringify(record, null, 2));
    console.log(`baseline written to ${baselineOut}`);
  }
  if (errors.length) throw new Error(`page errors: ${errors.slice(0, 3).join(" | ")}`);
} finally {
  await browser.close();
}
