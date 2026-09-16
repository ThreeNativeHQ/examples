/**
 * Focused own-tracer capture: the player's wing guns from the cockpit must draw as the pooled
 * instanced ellipsoid rounds (the recovered rear-gunner lane), never the old LineSegments
 * camera-facing cross that read as a plus sign in the gunsight.
 *
 * One airborne start, cockpit view, a held trigger. Frames are left for a person to look at; the
 * assertion reads the live tracer object and the instance count, not the screenshot.
 *
 *   MIDWAY_URL=http://127.0.0.1:5393 bash tools/capture-lock.sh node tools/capture-tracers.mjs
 */
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

const URL = process.env.MIDWAY_URL || "http://127.0.0.1:5393";
const OUT = process.env.MIDWAY_SHOTS || "screenshots";

const browser = await chromium.launch({
  headless: false,
  args: ["--enable-unsafe-webgpu", "--enable-features=Vulkan", "--disable-gpu-sandbox", "--ignore-gpu-blocklist", "--ozone-platform=x11"],
});
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.addInitScript(() => {
    class SilentSocket {
      readyState = 0;
      addEventListener() {}
      removeEventListener() {}
      send() {}
      close() {}
    }
    window.WebSocket = SilentSocket;
  });
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  await mkdir(OUT, { recursive: true });

  await page.goto(URL);
  await page.waitForSelector("#loading.hidden", { state: "attached", timeout: 120000 });
  await page.waitForSelector("#briefing:not(.hidden)");
  await page.evaluate(async () => {
    const deadline = Date.now() + 25000;
    while (Date.now() < deadline) {
      const urls = performance.getEntriesByType("resource").map((e) => e.name).filter((n) => /\/src\/game\.ts(?:\?|$)/.test(n)).reverse();
      for (const url of urls) {
        try {
          const scene = (await import(url)).default.scene;
          if (scene?.battle) { window.midway = scene; return; }
        } catch { /* mid-reload */ }
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error("No loaded game module holds a running scene.");
  });

  await page.click("#start-air");
  await page.waitForFunction(() => {
    const b = window.midway.battle;
    return b.status === "playing" && b.player.mode === "flight" && b.player.y > 40;
  });
  await page.keyboard.press("F1");
  await page.waitForTimeout(300);

  const tracer = await page.evaluate(() => {
    const t = window.midway.world.tracers;
    return {
      instanced: t.isInstancedMesh === true,
      geometry: t.geometry?.type ?? null,
      lineSegments: t.isLineSegments === true,
    };
  });
  assert.equal(tracer.instanced, true, `own tracers are the pooled InstancedMesh, not a LineSegments cross (${JSON.stringify(tracer)})`);
  assert.equal(tracer.lineSegments, false, "the old LineSegments cross path is gone");
  assert.match(tracer.geometry, /Sphere/, "each round is an ellipsoid head (stretched sphere), not a flat cross");

  await page.keyboard.down("Space");
  let live = 0;
  for (let i = 0; i < 3; i += 1) {
    await page.waitForTimeout(160);
    live = await page.evaluate(() => window.midway.world.tracers.count);
    await page.screenshot({ path: `${OUT}/tracers-cockpit-${i}.png` });
  }
  await page.keyboard.up("Space");
  assert.ok(live > 0, `a held cockpit burst draws instanced rounds (count ${live})`);

  const ammo = await page.evaluate(() => window.midway.battle.player.ammo);
  assert.ok(ammo < 1400, `the burst really spent forward ammunition (${ammo})`);

  assert.deepEqual(errors, [], `no console/page errors: ${errors.join(" | ")}`);
  console.log(`PASS: own tracers are instanced ellipsoids (live rounds ${live}); captures: tracers-cockpit-*`);
} finally {
  await browser.close();
}
