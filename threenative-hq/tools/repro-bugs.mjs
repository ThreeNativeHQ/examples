/**
 * Reproduce the two reported bugs with real frames.
 *
 * `node tools/repro-bugs.mjs <url> <outdir>`
 *
 * Burst A: stand at spawn and shoot frames ~0.6 s apart — proves whether seated workers'
 *          poses actually move on screen (the "stuck typing" report).
 * Burst B: walk forward from the door through the floor — walking is how a body ends up
 *          against the lens (the "part of my body" report).
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const url = process.argv[2] ?? "http://localhost:5173/";
const out = process.argv[3] ?? "/tmp/hq-repro";
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ headless: false });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on("pageerror", (error) => errors.push(String(error).slice(0, 300)));
await page.goto(url, { waitUntil: "load" });

// Wait for the office to publish its inspector, then a few more seconds of scene time.
for (let i = 0; i < 60; i += 1) {
  const ready = await page.evaluate(() => typeof globalThis.__hq === "function");
  if (ready) break;
  await page.waitForTimeout(1000);
}
await page.waitForTimeout(6000);

const shot = (name) => page.screenshot({ path: `${out}/${name}.png` });
const report = () =>
  page.evaluate(() => {
    const probe = globalThis.__hq?.() ?? {};
    return {
      camera: probe.camera,
      frames: probe.frames,
      actors: (probe.actors ?? []).map((a) => `${a.id} ${a.state} ${a.clip} adv ${a.advancedFrames} age ${a.clipAge} ch ${a.stateChanges}`),
    };
  });

// Click the canvas so the pointer locks and look/walk are live.
await page.mouse.click(640, 360);
await page.waitForTimeout(1000);

// Burst A: standing still, frames over time.
for (let i = 0; i < 4; i += 1) {
  await shot(`A-stand-${String(i)}`);
  const r = await report();
  console.log(`A${String(i)}`, JSON.stringify(r));
  await page.waitForTimeout(700);
}

// Burst B: walk forward through the floor, shooting as we go.
await page.keyboard.down("KeyW");
for (let i = 0; i < 14; i += 1) {
  await page.waitForTimeout(450);
  await shot(`B-walk-${String(i)}`);
  const r = await report();
  console.log(`B${String(i)}`, JSON.stringify(r));
}
await page.keyboard.up("KeyW");

// Burst C: turn right ~90° in two steps and walk again, in case the first row misses.
await page.mouse.move(640, 360);
await page.mouse.down();
await page.mouse.move(940, 360, { steps: 10 });
await page.mouse.up();
await page.keyboard.down("KeyW");
for (let i = 0; i < 12; i += 1) {
  await page.waitForTimeout(450);
  await shot(`C-turn-walk-${String(i)}`);
  const r = await report();
  console.log(`C${String(i)}`, JSON.stringify(r));
}
await page.keyboard.up("KeyW");

await browser.close();
if (errors.length > 0) console.log("page errors:\n" + errors.join("\n"));
