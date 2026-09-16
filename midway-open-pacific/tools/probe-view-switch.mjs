/**
 * Time the camera-mode switch, and say whether the hitch is a one-time cost or a per-switch one.
 *
 * A ~1s stall the first time the cockpit is shown and never again is first-draw pipeline creation:
 * the cockpit interior exists from load but is `visible = false`, so WebGPU has never built a
 * render pipeline for any of its materials. A stall that repeats on every switch is work the switch
 * itself is doing. The two want completely different fixes, so measure before choosing one.
 *
 * Reports the worst frame in a window after each switch, and the whole visit sequence, so a second
 * visit to the same view can be compared against the first.
 */
import assert from "node:assert";
import { chromium } from "playwright";

const URL = process.env.MIDWAY_URL || "http://127.0.0.1:5198";
const MODES = ["chase", "cockpit", "wide", "overhead"];
// Each visit watches this many presented frames before moving on; long enough that a stall lands
// inside the window rather than after it.
const WINDOW = Number(process.env.MIDWAY_SWITCH_WINDOW || 90);

const browser = await chromium.launch({
  headless: false,
  args: [
    "--enable-unsafe-webgpu",
    "--enable-features=Vulkan",
    "--disable-gpu-sandbox",
    "--ignore-gpu-blocklist",
    "--ozone-platform=x11",
  ],
});
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await page.goto(URL);
  // The warm-up sits behind the loading layer, so its cost shows up here. A fix that removes a 1s
  // stall by adding 10s to the launch is not a fix.
  const loadStart = Date.now();
  await page.waitForSelector("#loading.hidden", { state: "attached", timeout: 120000 });
  const loadMs = Date.now() - loadStart;
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
    return { vendor: a.info.vendor, architecture: a.info.architecture };
  });
  assert.ok(
    !/swiftshader|lavapipe|llvmpipe/i.test(JSON.stringify(adapter)),
    `software adapter, the figure would be meaningless: ${JSON.stringify(adapter)}`,
  );
  await page.click("#start-air");

  // Settle first: the startup frames are their own cost and would be charged to the first switch.
  await page.waitForFunction(() => window.midway.battle.time >= 6, null, { timeout: 60000 });

  // Visit each view twice, in order, so the second visit to a view is directly comparable to the
  // first with everything else held equal.
  const plan = [1, 0, 1, 0, 2, 0, 2, 0, 3, 0, 3, 0];
  const report = await page.evaluate(
    async ({ plan, WINDOW }) => {
      const world = window.midway.world;
      const frame = () => new Promise((r) => requestAnimationFrame(r));
      const visits = [];
      for (const mode of plan) {
        // Land the switch on a frame boundary so the switch itself is inside the measured window.
        await frame();
        const t0 = performance.now();
        world.setCamera(mode);
        const deltas = [];
        let last = t0;
        for (let i = 0; i < WINDOW; i++) {
          await frame();
          const now = performance.now();
          deltas.push(now - last);
          last = now;
        }
        const sorted = [...deltas].sort((a, b) => a - b);
        visits.push({
          mode,
          first: +deltas[0].toFixed(1),
          worst: +Math.max(...deltas).toFixed(1),
          worstIndex: deltas.indexOf(Math.max(...deltas)),
          median: +sorted[sorted.length >> 1].toFixed(1),
          over100: deltas.filter((d) => d > 100).length,
        });
      }
      return visits;
    },
    { plan, WINDOW },
  );

  console.log(
    `adapter ${adapter.vendor}/${adapter.architecture}  window ${WINDOW} frames  ` +
      `loading layer up for ${loadMs}ms\n`,
  );
  console.log("visit  view      first-frame  worst  at  median  frames>100ms");
  const seen = new Map();
  report.forEach((v, i) => {
    const n = (seen.get(v.mode) ?? 0) + 1;
    seen.set(v.mode, n);
    console.log(
      `${String(i + 1).padStart(4)}   ${MODES[v.mode].padEnd(9)} ${String(v.first).padStart(9)}ms ${String(v.worst).padStart(6)}ms ${String(v.worstIndex).padStart(3)} ${String(v.median).padStart(6)}ms ${String(v.over100).padStart(9)}   ${n === 1 ? "FIRST VISIT" : `visit ${n}`}`,
    );
  });

  // The verdict this tool exists for.
  for (const mode of [1, 2, 3]) {
    const v = report.filter((r) => r.mode === mode);
    if (v.length < 2) continue;
    const [a, b] = v;
    const drop = a.worst - b.worst;
    console.log(
      `\n${MODES[mode]}: first visit worst ${a.worst}ms, second ${b.worst}ms — ` +
        (a.worst > 100 && drop > a.worst * 0.5
          ? `ONE-TIME cost, paid on first draw (${drop.toFixed(1)}ms of it does not recur)`
          : a.worst > 100
            ? "RECURS on every switch — the switch itself is doing the work"
            : "no stall observed"),
    );
  }
  if (errors.length) console.log(`\nconsole/page errors: ${errors.length}\n  ${errors.slice(0, 5).join("\n  ")}`);
} finally {
  await browser.close();
}
