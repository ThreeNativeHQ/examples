/**
 * Frames of one worker, spaced by GAME seconds rather than by wall seconds.
 *
 * `tools/capture-lock.sh node tools/shot-poses.mjs <url> <outdir> [--state working] [--gap 1]`
 *
 * `shot-worker.mjs` spaces its burst half a wall-second apart, which is the right unit when the
 * host runs the world at real time. This capture host does not: the office is a fixed 1/60 s step
 * with no catch-up and renders at about ten frames a second, so half a wall-second is eight
 * hundredths of a game-second and four frames of an animation land on top of each other whatever
 * the animation is doing. Spacing on the game's own frame counter asks the question a player would
 * ask instead — *how much does this pose change in one second of play?*
 *
 * Prints the clip and the clip-time actually elapsed beside each frame, so a burst that all looks
 * the same can be told apart from a burst that was taken too close together.
 */
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const positional = args.filter((a) => !a.startsWith("--") && !/^\d+(\.\d+)?$/.test(a) || args[args.indexOf(a) - 1]?.startsWith("--") === false);
const url = args[0] ?? "http://localhost:5174/";
const out = args[1] ?? "/tmp/hq-shot-poses";
const flag = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? fallback : args[index + 1];
};
const wantState = flag("state", "working");
/** Game seconds between frames. One second of play is what a player judges a loop by. */
const gap = Number.parseFloat(flag("gap", "1"));
const count = Number.parseInt(flag("count", "5"), 10);
void positional;
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ headless: false });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on("pageerror", (error) => errors.push(String(error).slice(0, 300)));
await page.goto(url, { waitUntil: "load" });
for (let attempt = 0; attempt < 60; attempt += 1) {
  if (await page.evaluate(() => typeof globalThis.__hq === "function")) break;
  await page.waitForTimeout(1000);
}

/** Wait until a worker in the wanted state has been settled long enough to be worth framing. */
async function findSubject() {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const actor = await page.evaluate((state) => {
      const read = globalThis.__hq?.() ?? {};
      return (
        (read.actors ?? []).find(
          (a) => a.state === state && (a.phase === "seated" || a.phase === "atActivity") && a.settled,
        ) ?? null
      );
    }, wantState);
    if (actor !== null) return actor;
    await page.waitForTimeout(1000);
  }
  return null;
}

const subject = await findSubject();
if (subject === null) {
  await browser.close();
  console.error(`NOT_OBSERVED: no settled worker in state "${wantState}".`);
  process.exit(2);
}

// Stand a metre and a half in front of the worker, on the side its keyboard is, looking back.
const [wx, , wz] = subject.position;
// Which way the worker faces, taken from its own hand rather than from the desk's keyboard: the
// keyboard only slides under the hands once the alignment has run, and until then it sits wherever
// the desk was built, which put the camera behind the worker's head.
const front = subject.hand ?? [wx, 0, wz + 1];
const dx = front[0] - wx;
const dz = front[2] - wz;
const length = Math.hypot(dx, dz) || 1;
const distance = Number.parseFloat(flag("distance", "2.2"));
// Straight in front puts the worker's own desk and monitor between the lens and its hands, and
// the hands are the whole question. Swing round the chair by `--offsetDeg` for a three-quarter
// view over the desk edge instead.
const offset = (Number.parseFloat(flag("offsetDeg", "0")) * Math.PI) / 180;
const ux = (dx / length) * Math.cos(offset) - (dz / length) * Math.sin(offset);
const uz = (dx / length) * Math.sin(offset) + (dz / length) * Math.cos(offset);
const spawnX = wx + ux * distance;
const spawnZ = wz + uz * distance;
// The visitor's camera looks along (-sin yaw, -cos yaw) — `Visitor.update` sets
// `camera.rotation.set(pitch, yaw, 0)` on a YXZ camera, and drives W along the same vector. So
// facing a point is atan2 of the vector FROM it, not TO it. `tools/shot-worker.mjs` has the two
// the other way round and frames the wall behind the camera.
const yaw = Math.atan2(spawnX - wx, spawnZ - wz);
const separator = url.includes("?") ? "&" : "?";
const framed = `${url}${separator}spawn=${spawnX.toFixed(2)},${spawnZ.toFixed(2)},${yaw.toFixed(2)}`;
process.stderr.write(`subject ${subject.id} (${subject.clip}) -> ${framed}\n`);

await page.goto(framed, { waitUntil: "load" });
for (let attempt = 0; attempt < 60; attempt += 1) {
  if (await page.evaluate(() => typeof globalThis.__hq === "function")) break;
  await page.waitForTimeout(1000);
}
if ((await findSubject()) === null) {
  await browser.close();
  console.error("NOT_OBSERVED: the framed reload never produced a settled worker.");
  process.exit(2);
}

const log = [];
let previous;
for (let index = 0; index < count; index += 1) {
  if (index > 0) {
    // Advance by game frames, not by milliseconds: this host renders the world in slow motion and
    // a wall-clock gap would sample the same instant of the clip five times.
    const target = previous.frames + Math.round(gap * 60);
    for (let wait = 0; wait < 600; wait += 1) {
      const now = await page.evaluate(() => globalThis.__hq?.().frames ?? 0);
      if (now >= target) break;
      await page.waitForTimeout(250);
    }
  }
  const now = await page.evaluate((id) => {
    const read = globalThis.__hq?.() ?? {};
    const actor = (read.actors ?? []).find((a) => a.id === id);
    return { frames: read.frames, clip: actor?.clip, clipAge: actor?.clipAge, hand: actor?.hand, state: actor?.state };
  }, subject.id);
  const path = `${out}/${wantState}-${String(index)}.png`;
  await page.screenshot({ path });
  const entry = {
    path,
    frames: now.frames,
    clip: now.clip,
    clipAge: now.clipAge,
    gameSecondsSincePrevious: previous === undefined ? 0 : Number(((now.frames - previous.frames) / 60).toFixed(2)),
    hand: now.hand,
  };
  log.push(entry);
  process.stdout.write(
    `${path}  frame ${String(now.frames)}  ${String(now.clip)}  clipAge ${String(now.clipAge)}  (+${String(entry.gameSecondsSincePrevious)} game-s)  hand ${JSON.stringify(now.hand)}\n`,
  );
  previous = now;
}
writeFileSync(`${out}/frames.json`, JSON.stringify({ subject: subject.id, url: framed, log }, null, 1));
await browser.close();
if (errors.length > 0) console.log(`page errors:\n${errors.join("\n")}`);
