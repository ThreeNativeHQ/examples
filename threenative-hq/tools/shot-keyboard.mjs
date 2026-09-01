/**
 * Frame the keyboard on a working worker's desk: `node tools/shot-keyboard.mjs <url> <outdir>`.
 *
 * shot-any.mjs stands 1.7 m from the worker and shoots forward, which puts the desk top at the
 * very bottom of the frame — the visitor's pitch is fixed and there is no camera handle on the
 * debug bridge, so the only way to get a keyboard into shot is to choose where to stand. This
 * walks the `?spawn=x,z,yaw` pin round one desk: front, two obliques and both sides, at 2560x1440
 * so the board survives a crop. Run under tools/capture-lock.sh; headed, WebGPU.
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const url = process.argv[2] ?? "http://localhost:5175/";
const out = process.argv[3] ?? "/tmp/hq-keyboard";
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ headless: false });
const page = await browser.newPage({ viewport: { width: 2560, height: 1440 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e).slice(0, 300)));

const settle = async () => {
  for (let i = 0; i < 60; i += 1) {
    if (await page.evaluate(() => typeof globalThis.__hq === "function")) break;
    await page.waitForTimeout(1000);
  }
  await page.waitForTimeout(16000);
};

await page.goto(url, { waitUntil: "load" });
await settle();

const readActors = () => page.evaluate(() => {
  const read = globalThis.__hq?.() ?? {};
  return (read.actors ?? []).map((a) => ({
    state: a.state, phase: a.phase, clip: a.clip, position: a.position, keyboard: a.keyboard,
  }));
});
// Sessions come and go, so a single sample can catch a floor with nobody typing. Wait for one.
let probe = await readActors();
for (let i = 0; i < 20; i += 1) {
  if (probe.some((a) => a.phase === "seated" && a.state === "working" && a.keyboard)) break;
  await page.waitForTimeout(3000);
  probe = await readActors();
}
const seated = probe.filter((a) => a.phase === "seated" && a.state === "working" && a.keyboard);
// Nearest the middle of the room: an edge desk has a wall where a camera wants to stand.
seated.sort((a, b) => Math.abs(a.position[0]) - Math.abs(b.position[0]));
const target = seated[0] ?? probe.find((a) => a.keyboard);
console.log("chosen:", JSON.stringify(target));
if (target === undefined) { await browser.close(); process.exit(1); }

const [bx, , bz] = target.keyboard;
const [wx, , wz] = target.position;
// The desk's front is the direction from the worker to its own keyboard, extended past it.
const fx = bx - wx, fz = bz - wz, len = Math.hypot(fx, fz) || 1;
const ux = fx / len, uz = fz / len;         // out of the desk, toward the room
const rx = -uz, rz = ux;                     // along the desk, to the right

const vantages = [
  { id: "front", out: 2.2, side: 0 },
  { id: "oblique-right", out: 1.7, side: 1.3 },
  { id: "oblique-left", out: 1.7, side: -1.3 },
  { id: "side-right", out: 0.5, side: 2.0 },
  { id: "side-left", out: 0.5, side: -2.0 },
];

for (const v of vantages) {
  const sx = bx + ux * v.out + rx * v.side;
  const sz = bz + uz * v.out + rz * v.side;
  // The camera looks down its own -Z, so a yaw that points AT the board is the reverse of the
  // visitor's walk-forward vector: atan2 of the vector from the board to the camera, not to it.
  const yaw = Math.atan2(sx - bx, sz - bz);
  const pin = `${url}${url.includes("?") ? "&" : "?"}spawn=${sx.toFixed(2)},${sz.toFixed(2)},${yaw.toFixed(3)}`;
  console.log(v.id, pin);
  await page.goto(pin, { waitUntil: "load" });
  await settle();
  await page.screenshot({ path: `${out}/${v.id}.png` });
}
await browser.close();
if (errors.length > 0) console.log("page errors:\n" + errors.join("\n"));
