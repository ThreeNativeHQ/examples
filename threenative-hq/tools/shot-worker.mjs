/**
 * Stand in front of a working worker and shoot a frame burst.
 *
 * `node tools/shot-worker.mjs <url> <outdir>`
 *
 * One headless pass reads the inspector for a working worker and the direction its keyboard sits
 * in; the real pass spawns 1.6 m past the desk looking back at the worker (via `?spawn=`), and
 * four frames land half a second apart — a loop that is actually playing shows four different
 * poses. Run under tools/capture-lock.sh; headed, WebGPU.
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const url = process.argv[2] ?? "http://localhost:5173/";
const out = process.argv[3] ?? "/tmp/hq-shot";
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto(url, { waitUntil: "load" });
for (let i = 0; i < 90; i += 1) {
  const ready = await page.evaluate(() => typeof globalThis.__hq === "function");
  if (ready) break;
  await page.waitForTimeout(1000);
}
await page.waitForTimeout(4000);
const probe = await page.evaluate(() => {
  const read = globalThis.__hq?.() ?? {};
  return (read.actors ?? []).find((a) => a.state === "working" && a.phase === "seated") ?? null;
});
await browser.close();
if (probe === null) {
  console.error("No seated working worker found.");
  process.exit(2);
}
const [wx, , wz] = probe.position;
const [bx, , bz] = probe.keyboard;
const forwardX = bx - wx;
const forwardZ = bz - wz;
const length = Math.hypot(forwardX, forwardZ) || 1;
const spawnX = wx + (forwardX / length) * 1.6;
const spawnZ = wz + (forwardZ / length) * 1.6;
const yaw = Math.atan2(wx - spawnX, wz - spawnZ);
const spawnUrl = `${url}${url.includes("?") ? "&" : "?"}spawn=${spawnX.toFixed(2)},${spawnZ.toFixed(2)},${yaw.toFixed(2)}`;
console.log(`spawn ${spawnUrl}`);

const headed = await chromium.launch({ headless: false });
const shot = await headed.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
shot.on("pageerror", (error) => errors.push(String(error).slice(0, 300)));
await shot.goto(spawnUrl, { waitUntil: "load" });
for (let i = 0; i < 90; i += 1) {
  const ready = await shot.evaluate(() => typeof globalThis.__hq === "function");
  if (ready) break;
  await shot.waitForTimeout(1000);
}
await shot.waitForTimeout(6000);
for (let i = 0; i < 4; i += 1) {
  await shot.screenshot({ path: `${out}/typing-${String(i)}.png` });
  await shot.waitForTimeout(500);
}
await headed.close();
if (errors.length > 0) console.log("page errors:\n" + errors.join("\n"));
