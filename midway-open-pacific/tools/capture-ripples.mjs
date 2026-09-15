/**
 * The sea reacting, in frames a person can look at.
 *
 * Every other gate here is blind to water: the sortie capture proves a near miss damages a ship,
 * and would pass just as green with a sea that never moved. This drops one heavy bomb alongside a
 * carrier from a low camera and photographs the same patch of water four times — before the burst,
 * as the column breaks the surface, while the ring is running out, and after it has fallen back.
 *
 * It also reads `RippleField`'s own energy through the scene, so the assertions can say the sea
 * moved and then went quiet again rather than trusting a screenshot to show it.
 */
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

const URL = process.env.MIDWAY_URL || "http://127.0.0.1:5199";
const OUT = process.env.MIDWAY_SHOTS || "screenshots/ripples";

const browser = await chromium.launch({
  headless: false,
  args: ["--enable-unsafe-webgpu", "--enable-features=Vulkan", "--disable-gpu-sandbox", "--ignore-gpu-blocklist", "--ozone-platform=x11"],
});
const errors = [];
const log = (stage, detail) => console.log(`${stage.padEnd(22)} ${JSON.stringify(detail)}`);

try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 800 } });
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await page.goto(URL);
  await page.waitForSelector("#loading.hidden", { state: "attached", timeout: 180000 });
  await page.waitForSelector("#briefing:not(.hidden)");
  await page.evaluate(async () => {
    const url = performance.getEntriesByType("resource").map((e) => e.name).findLast((n) => /\/src\/game\.ts(?:\?|$)/.test(n));
    window.midway = (await import(url)).default.scene;
  });
  const adapter = await page.evaluate(async () => {
    const gpu = await navigator.gpu.requestAdapter();
    return gpu ? { vendor: gpu.info.vendor, architecture: gpu.info.architecture } : null;
  });
  assert.ok(adapter && !/swiftshader|llvmpipe|software/i.test(JSON.stringify(adapter)), `hardware WebGPU adapter required: ${JSON.stringify(adapter)}`);
  log("WebGPU adapter", adapter);
  await mkdir(OUT, { recursive: true });

  await page.click("#start-air");
  const seconds = async (n) => {
    const t = await page.evaluate(() => window.midway.battle.time);
    await page.waitForFunction((u) => window.midway.battle.time >= u, t + n, { timeout: Math.max(30000, n * 5000) });
  };
  await seconds(2);

  // Park the aircraft off to one side of open water and hold it there. A disturbance a metre high
  // is only legible at a grazing angle, so the camera sits low and looks along the sea, not down.
  // Fly it level past the spot rather than pinning it: zeroing the velocities puts the aircraft
  // into the sea and the battle clock stops, which reads as a capture hang rather than a crash.
  const place = async () => page.evaluate(() => {
    const b = window.midway.battle;
    const ship = b.ships.find((s) => s.team === "jp" && s.kind === "carrier" && !s.sunk);
    const right = { x: Math.cos(ship.heading), z: Math.sin(ship.heading) };
    const spot = { x: ship.x + right.x * 150, z: ship.z + right.z * 150 };
    const p = b.player;
    b.playerFlight.reset();
    p.x = spot.x + right.x * 220;
    p.z = spot.z + right.z * 220;
    p.y = 70;
    p.heading = Math.atan2(-right.x, right.z) + Math.PI;
    p.pitch = 0;
    p.roll = 0;
    p.attitude = null;
    return { ship: ship.name, spot, status: b.status };
  });
  const aim = await place();
  await seconds(1);
  await place();
  log("camera", aim);

  const energy = () => page.evaluate(() => window.midway.world.ripples.energy());
  const peak = () => page.evaluate(() => {
    const p = window.midway.world.ripples.peak();
    return { high: +p.high.toFixed(2), low: +p.low.toFixed(2) };
  });
  const calm = await energy();
  await page.screenshot({ path: `${OUT}/01-before.png` });

  // One heavy bomb into open water, fused to burst under the surface like a real near miss.
  await page.evaluate((spot) => {
    const b = window.midway.battle;
    b.bombs.push({ id: b.id("bomb"), x: spot.x, y: 30, z: spot.z, vx: 0, vy: -120, vz: 0, team: "us", owner: "player", age: 0, damage: 155, stamp: null });
  }, aim.spot);

  // The burst is fused below the surface, so the sea answers a third of a second after the bomb
  // reaches it. Wait for the water itself to move rather than guessing a delay.
  await page.waitForFunction(() => window.midway.world.ripples.energy() > 0, null, { timeout: 30000 });
  await place();
  const breaking = await energy();
  await page.screenshot({ path: `${OUT}/02-column.png` });

  // Sample the decay so the report says how the sea gave the energy back, not just that it did.
  const curve = [];
  for (const step of [0.5, 1, 1, 2, 4]) {
    await seconds(step);
    // Hold the aircraft in the neighbourhood between samples. The patch follows the camera, so an
    // aeroplane leaving at a hundred metres a second takes the simulated water with it — which
    // costs nothing in play, because a one-metre ring is not resolvable from half a kilometre, but
    // it would photograph here as a sea that forgot instantly.
    await place();
    curve.push({ t: +(curve.reduce((a, c) => a + c.dt, 0) + step).toFixed(2), dt: step, e: +(await energy()).toFixed(3), m: await peak() });
  }
  await page.screenshot({ path: `${OUT}/03-ring.png` });
  const running = curve[2].e;
  const settling = curve[curve.length - 1].e;
  await place();
  await seconds(2.5);
  await page.screenshot({ path: `${OUT}/04-foam.png` });
  log("decay", curve);

  log("energy", { calm, breaking, running, settling });
  assert.equal(calm, 0, "the sea is flat before anything hits it");
  assert.ok(breaking > 0, "the burst disturbs the surface");
  assert.ok(running > 0, "the disturbance is still running out a couple of seconds later");
  assert.ok(settling < running, "the sea gives the energy back up rather than ringing forever");
  assert.deepEqual(errors, [], `console and page errors: ${errors.join(" | ")}`);
  console.log(JSON.stringify({ pass: true, out: OUT }, null, 1));
} finally {
  await browser.close();
}
