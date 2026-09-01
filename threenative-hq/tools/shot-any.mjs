/**
 * Screenshot whatever the office is doing: `node tools/shot-any.mjs <url> <outdir>`.
 *
 * shot-worker.mjs refuses unless it finds a seated working worker, which makes it useless when
 * the question is "what does the room look like right now". This one reports every actor's state
 * and shoots four frames half a second apart from in front of the nearest worker. Run under
 * tools/capture-lock.sh; headed, WebGPU.
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const url = process.argv[2] ?? "http://localhost:5175/";
const out = process.argv[3] ?? "/tmp/hq-any";
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ headless: false });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e).slice(0, 300)));
await page.goto(url, { waitUntil: "load" });
for (let i = 0; i < 60; i += 1) {
  if (await page.evaluate(() => typeof globalThis.__hq === "function")) break;
  await page.waitForTimeout(1000);
}
// Every goto reloads the game, so the room is always freshly built: the workers walk in and sit
// down again, and a capture taken too early catches the sit-down one-shot rather than the state
// the session is actually in. SETTLE_MS overrides for the poses that take longest to arrive.
await page.waitForTimeout(Number.parseInt(process.env.SETTLE_MS ?? "15000", 10));
const probe = await page.evaluate(() => {
  const read = globalThis.__hq?.() ?? {};
  return (read.actors ?? []).map((a) => ({
    state: a.state, phase: a.phase, clip: a.clip, position: a.position, keyboard: a.keyboard,
  }));
});
console.log("actors:", JSON.stringify(probe, null, 1));
const target =
  probe.find((a) => a.phase === "seated" && a.state === "working") ??
  probe.find((a) => a.phase === "seated") ??
  probe[0];
console.log("chosen:", JSON.stringify(target));
if (target !== undefined && target.position !== undefined) {
  const [wx, , wz] = target.position;
  const [bx, , bz] = target.keyboard ?? [wx, 0, wz + 1];
  const fx = bx - wx, fz = bz - wz, len = Math.hypot(fx, fz) || 1;
  // FRONT=1 shoots from the far side of the desk, looking back at the worker's hands — the only
  // vantage that answers "is he actually typing".
  const side = process.env.FRONT === "1" ? -1.7 : 1.7;
  const sx = wx + (fx / len) * side, sz = wz + (fz / len) * side;
  // A Three.js camera at yaw looks down (-sin yaw, 0, -cos yaw), so aiming it AT the worker is
  // atan2(spawn - worker), not atan2(worker - spawn). Getting this backwards points the camera at
  // the wall behind you and the frame comes back empty — which reads exactly like a broken scene.
  const yaw = Math.atan2(sx - wx, sz - wz);
  const spawn = `${url}${url.includes("?") ? "&" : "?"}spawn=${sx.toFixed(2)},${sz.toFixed(2)},${yaw.toFixed(2)}`;
  console.log("spawn", spawn);
  await page.goto(spawn, { waitUntil: "load" });
  for (let i = 0; i < 60; i += 1) {
    if (await page.evaluate(() => typeof globalThis.__hq === "function")) break;
    await page.waitForTimeout(1000);
  }
  await page.waitForTimeout(6000);
}
if (process.env.ORBIT === "1" && target !== undefined && target.position !== undefined) {
  // Ring the worker instead of deducing which way it faces. The inspector reports the desk's
  // keyboard, not the worker's facing, and on alternating desk rows those point opposite ways —
  // deducing from it put the camera behind the worker from both sides. Eight frames costs a
  // minute and answers the question outright.
  const [wx, , wz] = target.position;
  const radius = 1.8;
  for (let i = 0; i < 8; i += 1) {
    const angle = (i / 8) * Math.PI * 2;
    const sx = wx + Math.sin(angle) * radius;
    const sz = wz + Math.cos(angle) * radius;
    const yaw = Math.atan2(sx - wx, sz - wz);
    const at = `${url}${url.includes("?") ? "&" : "?"}spawn=${sx.toFixed(2)},${sz.toFixed(2)},${yaw.toFixed(2)}`;
    await page.goto(at, { waitUntil: "load" });
    for (let w = 0; w < 60; w += 1) {
      if (await page.evaluate(() => typeof globalThis.__hq === "function")) break;
      await page.waitForTimeout(1000);
    }
    await page.waitForTimeout(Number.parseInt(process.env.SETTLE_MS ?? "4000", 10));
    const now = await page.evaluate(() => {
      const read = globalThis.__hq?.() ?? {};
      return (read.actors ?? []).filter((a) => a.phase === "seated").map((a) => `${a.state}:${a.clip}`);
    });
    console.log(`orbit-${String(i)} seated:`, now.join(" | "));
    await page.screenshot({ path: `${out}/orbit-${String(i)}.png` });
  }
} else {
  for (let i = 0; i < 4; i += 1) {
    await page.screenshot({ path: `${out}/frame-${String(i)}.png` });
    await page.waitForTimeout(500);
  }
}
await browser.close();
if (errors.length > 0) console.log("page errors:\n" + errors.join("\n"));
