/**
 * Steady-state frame timing, on a named adapter, at a fixed resolution, under a real workload.
 *
 * No trustworthy figure existed for this game: previous numbers were taken during loading or
 * shader compilation, which measures the wrong thing. This waits for the startup gate, then flies
 * and burns a warm-up before it records anything, and reports the distribution rather than an
 * average — a mean hides exactly the stutters a player notices. It names the GPU it ran on and
 * says what else was drawing at the time, because a benchmark that does not is not evidence.
 */
import assert from "node:assert/strict";
import { chromium } from "playwright";

const URL = process.env.MIDWAY_URL || "http://127.0.0.1:5198";
const WIDTH = Number(process.env.MIDWAY_WIDTH || 1672);
const HEIGHT = Number(process.env.MIDWAY_HEIGHT || 941);
const WARMUP = Number(process.env.MIDWAY_WARMUP || 8);
const SAMPLE = Number(process.env.MIDWAY_SAMPLE || 20);

const browser = await chromium.launch({
  headless: false,
  args: [
    "--enable-unsafe-webgpu",
    "--enable-features=Vulkan",
    "--disable-gpu-sandbox",
    "--ignore-gpu-blocklist",
    "--ozone-platform=x11",
    // Timestamp queries are behind Dawn's unsafe-API flag; without them the only clock available
    // is wall time, and wall time here measures the virtual display, not the game.
    "--enable-dawn-features=allow_unsafe_apis",
  ],
});
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT } });
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await page.goto(URL);
  await page.waitForSelector("#loading.hidden", { state: "attached", timeout: 120000 });
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
    return {
      vendor: a.info.vendor,
      architecture: a.info.architecture,
      device: a.info.device,
      description: a.info.description,
    };
  });
  assert.ok(
    !/swiftshader|lavapipe|llvmpipe/i.test(JSON.stringify(adapter)),
    `software adapter, the figure would be meaningless: ${JSON.stringify(adapter)}`,
  );

  // Airborne start puts the battle in progress: aircraft aloft, AI flying, ships under way.
  await page.click("#start-air");
  const seconds = async (n) => {
    const t = await page.evaluate(() => window.midway.battle.time);
    await page.waitForFunction((u) => window.midway.battle.time >= u, t + n, {
      timeout: Math.max(30000, n * 4000),
    });
  };

  // MIDWAY_HIDE names a layer to switch off, so the cost of one can be attributed rather than
  // guessed at. It changes what is measured and is never how a reported figure is produced.
  if (process.env.MIDWAY_HIDE)
    await page.evaluate((what) => {
      const w = window.midway.world;
      if (what === "sea") w.sea.visible = false;
      if (what === "ships") for (const [id, m] of w.meshes) if (!id.startsWith("air-")) m.visible = false;
      if (what === "crew") w.crew.group.visible = false;
      if (what === "sky") w.scene.background = null;
    }, process.env.MIDWAY_HIDE);

  // MIDWAY_RATIO shrinks the render target while the window stays the same size, which separates
  // what the GPU is drawing from what the display path costs to present.
  if (process.env.MIDWAY_RATIO)
    await page.evaluate((r) => {
      window.midway.world.renderer.setPixelRatio(Number(r));
    }, process.env.MIDWAY_RATIO);

  // MIDWAY_BURN is the damage workload: every carrier is hit at four real deck points and the
  // player is flown up the wake of the nearest one, so persistent fires and scorch marks are
  // actually on screen while the frame is timed. Benchmarking a clean sky proves nothing about
  // damage rendering. The hits are forced through damageShip, and this is always reported.
  const burning = !!process.env.MIDWAY_BURN;
  if (burning) {
    await page.evaluate(() => {
      const b = window.midway.battle;
      const carriers = b.ships.filter((s) => s.kind === "carrier" && !s.sunk);
      for (const ship of carriers) {
        const f = { x: Math.sin(ship.heading), z: -Math.cos(ship.heading) };
        for (const along of [-80, -25, 30, 75])
          b.damageShip(
            ship,
            55,
            { x: ship.x + f.x * along, y: 20, z: ship.z + f.z * along },
            "bomb",
            ship.team === "us" ? "jp" : "us",
            { owner: "benchmark" },
          );
      }
      const target = carriers.find((s) => s.team === "jp") ?? carriers[0];
      const f = { x: Math.sin(target.heading), z: -Math.cos(target.heading) };
      Object.assign(b.player, {
        x: target.x - f.x * 950,
        y: 320,
        z: target.z - f.z * 950,
        heading: target.heading,
        pitch: 0.02,
        roll: 0,
        vx: f.x * 95,
        vy: 0,
        vz: f.z * 95,
        speed: 95,
        autopilot: false,
      });
      if (b.player.flight?.setAttitude) b.player.flight.setAttitude(target.heading, 0.02, 0);
    });
  }

  // A representative workload: turning, firing, tracers and impacts, not a static camera. The
  // damage workload holds its course instead, so the burning ship stays in frame for both runs.
  await page.keyboard.down("Space");
  if (!burning) await page.keyboard.down("ArrowLeft");
  await seconds(WARMUP);
  if (!burning) {
    await page.keyboard.up("ArrowLeft");
    await page.keyboard.down("ArrowRight");
  }

  const result = await page.evaluate(async (sample) => {
    const s = window.midway;
    const renderer = s.world.renderer;
    // GPU time is the figure that describes the game. Wall time is collected alongside it, but
    // on a virtual display it measures how fast the window can be presented, which is a property
    // of the capture rig and not of the game.
    renderer.trackTimestamp = true;
    const wall = [];
    const gpu = [];
    await new Promise((resolve) => {
      let last = performance.now();
      const stop = last + sample * 1000;
      const tick = async (now) => {
        wall.push(now - last);
        last = now;
        try {
          await renderer.resolveTimestampsAsync("render");
          const t = renderer.info.render.timestamp;
          if (t > 0) gpu.push(t);
        } catch {
          // No timestamp-query support; the gpu series stays empty and is reported as such.
        }
        if (now < stop) requestAnimationFrame(tick);
        else resolve();
      };
      requestAnimationFrame(tick);
    });
    wall.shift();
    const stats = (series) => {
      if (!series.length) return null;
      const sorted = [...series].sort((a, b) => a - b);
      const at = (q) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))];
      return {
        samples: sorted.length,
        p50: +at(0.5).toFixed(2),
        p95: +at(0.95).toFixed(2),
        p99: +at(0.99).toFixed(2),
        worst: +sorted[sorted.length - 1].toFixed(2),
      };
    };
    return {
      wall: stats(wall),
      gpu: stats(gpu),
      draws: renderer.info.render.drawCalls,
      triangles: renderer.info.render.triangles,
      scene: {
        aircraft: s.battle.aircraft.length,
        ships: s.battle.ships.filter((x) => !x.sunk).length,
        bullets: s.battle.bullets.length,
        meshes: s.world.meshes.size,
        quality: s.world.quality,
        pixelRatio: renderer.getPixelRatio(),
      },
    };
  }, SAMPLE);
  await page.keyboard.up("Space");
  if (!burning) await page.keyboard.up("ArrowRight");
  const damage = await page.evaluate(() => {
    const b = window.midway.battle;
    let impacts = 0;
    let scars = 0;
    let fires = 0;
    for (const ship of b.ships) {
      impacts += (ship.impacts ?? []).length;
      if (ship.fire > 0.06) fires += 1;
      scars += (window.midway.world.meshes.get(ship.id)?.userData?.shipScars ?? []).filter((m) => m.visible).length;
    }
    return { impacts, scars, burningShips: fires };
  });

  const fps = (ms) => +(1000 / ms).toFixed(1);
  console.log(`workload: ${burning ? "burning carriers, course held" : "clean sky, turning"} ${JSON.stringify(damage)}`);
  console.log(
    "adapter " + JSON.stringify(adapter) + "\n" +
      `resolution ${WIDTH}x${HEIGHT} at pixel ratio ${result.scene.pixelRatio}, quality ${result.scene.quality}\n` +
      `scene ${JSON.stringify(result.scene)}\n` +
      `draw calls ${result.draws}, triangles ${result.triangles}\n` +
      `gpu ${result.gpu ? `median ${result.gpu.p50}ms (${fps(result.gpu.p50)} fps) | p95 ${result.gpu.p95}ms | worst ${result.gpu.worst}ms over ${result.gpu.samples} frames` : "unavailable: this build has no timestamp-query support"}\n` +
      `wall median ${result.wall.p50}ms | p95 ${result.wall.p95}ms  ` +
      "(presentation-bound on a virtual display; not a statement about the game)",
  );
  assert.deepEqual(errors, []);
  assert.ok(result.gpu, "GPU timestamps resolved; wall time alone cannot measure this");
  // A floor, not a target: this only fails if the game's own GPU work has become unplayable.
  assert.ok(result.gpu.p50 < 16.7, `median GPU frame under 16.7ms: ${result.gpu.p50}ms`);
  console.log("PASS: steady-state GPU frame timing recorded on a named hardware adapter");
} finally {
  await browser.close();
}
