/**
 * Read the running office in numbers: `node tools/inspect.mjs [url]`.
 *
 * Pairs with `threenative-playtest doctor --url <url> --text`, which answers "is anything on
 * screen and which clip is playing". This answers "where is everything, relative to what it should
 * be touching" — the question every layout bug turns out to be. Reach for both before a
 * screenshot; looking at a picture is the slowest way to learn a number.
 */
import { chromium } from "playwright";

const url = process.argv[2] ?? "http://127.0.0.1:5173/";
/**
 * Wait for frames, not for seconds.
 *
 * Headless Chromium has no WebGPU and renders this office at about seven frames a second, so
 * sixteen seconds of waiting buys the scene two seconds of simulated time — long enough for
 * nothing to have settled and for every measurement to be a lie about a transient.
 */
const wantFrames = Number.parseInt(process.env.HQ_FRAMES ?? "600", 10);
const timeoutMs = Number.parseInt(process.env.HQ_TIMEOUT_MS ?? "120000", 10);

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on("pageerror", (error) => errors.push(String(error).slice(0, 200)));
await page.goto(url, { waitUntil: "load" });

const startedAt = Date.now();
let probe;
for (;;) {
  probe = await page.evaluate(() => {
    const read = globalThis.__hq;
    return typeof read === "function" ? read() : undefined;
  });
  if (probe !== undefined && probe.frames >= wantFrames) break;
  if (Date.now() - startedAt > timeoutMs) {
    process.stderr.write(
      `only ${String(probe?.frames ?? 0)} of ${String(wantFrames)} frames in ${String(Math.round((Date.now() - startedAt) / 1000))} s; reporting anyway\n`,
    );
    break;
  }
  await page.waitForTimeout(1000);
}
await browser.close();

if (probe === undefined) {
  process.stderr.write("The office published no inspector. Is the scene running?\n");
  process.exit(2);
}

process.stdout.write(`frames ${String(probe.frames)} · dt ${String(probe.dt)} s\n`);
process.stdout.write(
  `camera  x ${probe.camera.x} y ${probe.camera.y} z ${probe.camera.z} · yaw ${probe.camera.yaw} pitch ${probe.camera.pitch}\n\n`,
);
process.stdout.write("id                              phase       state     clip                   adv  settled\n");
for (const actor of probe.actors) {
  process.stdout.write(
    `${actor.id.padEnd(31)} ${actor.phase.padEnd(11)} ${actor.state.padEnd(9)} ${actor.clip.padEnd(22)} ${String(actor.advancedFrames).padStart(4)}  ${actor.settled ? "yes" : "NO"}  age ${String(actor.clipAge).padStart(6)} changes ${String(actor.stateChanges).padStart(4)}  desk ${String(actor.deskIndex).padStart(2)} board ${(actor.boardLocal ?? []).join(",")}\n`,
  );
}
process.stdout.write("\nhand vs keyboard (world)\n");
for (const actor of probe.actors.filter((a) => a.hand && a.keyboard).slice(0, 3)) {
  process.stdout.write(
    `  ${actor.id.padEnd(20)} hand ${actor.hand.join(",")}  board ${actor.keyboard.join(",")}\n`,
  );
}

if (probe.alignSkips !== undefined)
  process.stdout.write(
    `\nkeyboard alignment: ${String(probe.alignAttempts)} runs · ${JSON.stringify(probe.alignSkips)}\n`,
  );

process.stdout.write("\nchecks\n");
let failed = 0;
for (const check of probe.checks) {
  if (!check.ok) failed += 1;
  process.stdout.write(`  ${check.ok ? "ok  " : "FAIL"} ${check.name.padEnd(22)} ${check.detail}\n`);
}
if (errors.length > 0) process.stdout.write(`\npage errors\n${errors.map((e) => `  ${e}`).join("\n")}\n`);
process.exit(failed === 0 ? 0 : 1);
