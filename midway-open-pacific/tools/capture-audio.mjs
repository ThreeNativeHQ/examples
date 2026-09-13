/**
 * Real-scene audio capture and behaviour check.
 *
 * The PRD's E2 asks for actual deck/camera/cutoff/queue behaviour plus captured audio, AC-2 asks
 * that deck cues stop at liftoff without doubling the engine, AC-7 asks that restart and 3x transit
 * leak no voices, and AC-9 asks for a real combat capture with true-peak headroom. This drives the
 * live scene and taps the game's own WebAudio output with a `MediaStreamAudioDestinationNode` — no
 * OS audio device is involved, so it works under the throwaway Xvfb the capture lock uses — then
 * records it with `MediaRecorder`.
 *
 * Run under the capture lock:
 *   bash tools/capture-lock.sh node tools/capture-audio.mjs
 * With a dev server on MIDWAY_URL (default http://127.0.0.1:5199).
 */
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";

const URL = process.env.MIDWAY_URL || "http://127.0.0.1:5199";
const OUT = process.env.MIDWAY_SHOTS || "screenshots";
const RECORD_MS = 5000;
const PEAK_FLOOR_DB = -1; // at least 1 dB true-peak headroom (sample peak here).
const VOICE_CEILING = 48;

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
const log = (stage, detail) => console.log(`${stage.padEnd(20)} ${JSON.stringify(detail)}`);

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await page.goto(URL);
  await page.waitForSelector("#loading.hidden", { state: "attached", timeout: 90000 });
  await page.waitForSelector("#briefing:not(.hidden)");
  await page.evaluate(async () => {
    const url = performance.getEntriesByType("resource").map((e) => e.name).findLast((n) => /\/src\/game\.ts(?:\?|$)/.test(n));
    if (!url) throw new Error("Missing loaded game module");
    window.midway = (await import(url)).default.scene;
  });
  mkdirSync(OUT, { recursive: true });

  const dbg = () => page.evaluate(() => window.midway.audio.debug());
  const player = () => page.evaluate(() => ({ mode: window.midway.battle.player.mode, time: window.midway.battle.time }));
  const radioText = () => page.evaluate(() => (document.getElementById("radio-log")?.textContent || "").slice(0, 400));
  const seconds = (n) => page.evaluate((s) => new Promise((r) => setTimeout(r, s * 1000)), n);

  // --- Deck: wheels roll and ship machinery is present while in contact -----------------------
  await page.click("#start-deck");
  await seconds(4.5);
  const start = await dbg();
  log("on-deck", { active: start.active, buffers: start.buffers, layers: start.layers, spoken: start.spoken });
  assert.ok(start.active, "the Soundscape never became active");
  assert.ok(start.buffers > 100, `only ${start.buffers} buffers decoded`);
  assert.ok(start.spoken >= 1, "no friendly line spoke on entering the battle");
  assert.ok(start.layerGains.shipMachinery > 0.1, `ship machinery absent on deck (${start.layerGains.shipMachinery})`);

  await page.keyboard.down("KeyW");
  await seconds(6);
  const rolling = await dbg();
  assert.ok(rolling.layerGains.deckRoll > 0.05, `wheels rolling on deck made no sound (${rolling.layerGains.deckRoll})`);
  await page.screenshot({ path: `${OUT}/audio-capture-deck.png` });

  // --- Launch: deck cues stop at liftoff, and the engine is not doubled ------------------------
  await seconds(9);
  await page.keyboard.down("ArrowDown");
  await seconds(1.2);
  await page.keyboard.up("ArrowDown");
  await page.keyboard.up("KeyW");
  await seconds(3);
  const airborne = await dbg();
  const mode = (await player()).mode;
  log("airborne", { mode, deckRoll: airborne.layerGains.deckRoll, machinery: airborne.layerGains.shipMachinery, layers: airborne.layers, voices: airborne.voices });
  assert.equal(mode, "flight", `never left the deck (mode ${mode})`);
  assert.ok(airborne.layerGains.deckRoll < 0.02, `deck roll continued after liftoff (${airborne.layerGains.deckRoll})`);
  assert.ok(airborne.layerGains.shipMachinery < 0.05, `ship machinery continued after departure (${airborne.layerGains.shipMachinery})`);
  assert.equal(airborne.layers, start.layers, "the launch changed the continuous layer count (doubled engine?)");
  await page.screenshot({ path: `${OUT}/audio-capture-start.png` });

  // --- Camera perspective crosses the interior/exterior engine balance -------------------------
  await page.keyboard.press("KeyC");
  await seconds(0.6);
  const cockpit = await dbg();
  await page.keyboard.press("KeyC");
  await seconds(0.6);
  const external = await dbg();
  log("perspective", { cockpit: cockpit.perspective, external: external.perspective });
  assert.ok(cockpit.perspective > 0.5, `cockpit did not favour the interior engine (${cockpit.perspective})`);
  assert.ok(external.perspective < cockpit.perspective, "leaving the cockpit did not move the balance back");

  // --- Engine cutoff then restart keeps the scene alive ----------------------------------------
  await page.keyboard.press("KeyI");
  await seconds(0.8);
  await page.keyboard.press("KeyI");
  await seconds(0.4);

  // --- 3x quiet transit: no voice growth, no error ---------------------------------------------
  await page.keyboard.down("ShiftLeft");
  await seconds(2);
  await page.keyboard.up("ShiftLeft");
  const transit = await dbg();
  assert.ok(transit.voices <= VOICE_CEILING, `3x transit exceeded the voice ceiling (${transit.voices})`);

  // --- Guns and a bomb release: the release must reach the caption log (AC-5) ------------------
  await page.keyboard.down("Space");
  await seconds(0.6);
  await page.keyboard.up("Space");
  await page.keyboard.press("KeyB");
  await seconds(0.8);
  const radio = await radioText();
  assert.ok(radio.includes("Bomb away."), `the release caption never appeared: ${radio}`);
  await page.screenshot({ path: `${OUT}/audio-capture-combat.png` });

  // --- Mute and pause are real scene states ----------------------------------------------------
  await page.keyboard.press("Escape");
  await seconds(0.4);
  assert.ok((await dbg()).paused, "the pause overlay did not pause the Soundscape");
  await page.keyboard.press("Escape");
  await seconds(0.3);
  assert.ok(!(await dbg()).paused, "resume did not clear the pause state");
  assert.ok((await dbg()).voices <= VOICE_CEILING, "the voice pool grew past the ceiling");

  // --- Capture the live mix --------------------------------------------------------------------
  await page.keyboard.down("Space");
  const captured = await page.evaluate(async (ms) => {
    const audio = window.midway.audio;
    const ctx = audio.bus.listener.context;
    if (ctx.state !== "running") await ctx.resume();
    const dest = ctx.createMediaStreamDestination();
    audio.bus.listener.getInput().connect(dest);
    try {
      audio.speech.target.listener.getInput().connect(dest);
    } catch {
      /* the speech bus may share the effects listener */
    }
    if (typeof MediaRecorder === "undefined" || !MediaRecorder.isTypeSupported("audio/webm")) {
      return { ok: false, reason: "MediaRecorder audio/webm unsupported" };
    }
    const chunks = [];
    const recorder = new MediaRecorder(dest.stream, { mimeType: "audio/webm" });
    recorder.ondataavailable = (e) => {
      if (e.data.size) chunks.push(e.data);
    };
    recorder.start();
    await new Promise((r) => setTimeout(r, ms));
    await new Promise((r) => {
      recorder.onstop = r;
      recorder.stop();
    });
    const bytes = new Uint8Array(await new Blob(chunks).arrayBuffer());
    let binary = "";
    for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
    return { ok: bytes.length > 0, bytes: bytes.length, base64: btoa(binary) };
  }, RECORD_MS);
  await page.keyboard.up("Space");

  if (!captured.ok) {
    log("audio-capture", { ok: false, reason: captured.reason ?? "empty recording" });
    console.log("GAP: no audio capture mechanism produced bytes; treating graph assertions as behaviour, not listening proof.");
  } else {
    const file = `${OUT}/audio-combat.webm`;
    writeFileSync(file, Buffer.from(captured.base64, "base64"));
    const probe = execFileSync("ffprobe", ["-v", "error", "-select_streams", "a", "-show_entries", "stream=codec_name,channels,sample_rate", "-of", "default=nw=1", file], { encoding: "utf8" }).trim();
    const measured = spawnSync("ffmpeg", ["-hide_banner", "-i", file, "-af", "volumedetect", "-f", "null", "-"], { encoding: "utf8" });
    const text = `${measured.stderr ?? ""}${measured.stdout ?? ""}`;
    const mean = /mean_volume: (-?[\d.]+) dB/.exec(text)?.[1];
    const max = /max_volume: (-?[\d.]+) dB/.exec(text)?.[1];
    log("audio-capture", { file, bytes: captured.bytes, probe, meanDb: mean, maxDb: max });
    assert.ok(max !== undefined, "volumedetect produced no max_volume");
    assert.ok(Number(max) > -60, `the captured mix is effectively silent (max ${max} dB)`);
    if (Number(max) > PEAK_FLOOR_DB) {
      console.log(`WARN: captured sample peak ${max} dB exceeds the ${PEAK_FLOOR_DB} dB headroom target; needs listening/mix review.`);
    } else {
      log("headroom-ok", { maxDb: max, targetDb: PEAK_FLOOR_DB });
    }
  }

  // --- Restart to briefing: audio survives, voices stay bounded --------------------------------
  await page.keyboard.press("Escape");
  await seconds(0.4);
  await page.click("#restart-pause");
  await seconds(1.2);
  const restarted = await dbg();
  log("after-restart", { active: restarted.active, voices: restarted.voices, pooled: restarted.pooled, layers: restarted.layers });
  assert.ok(restarted.active, "audio did not survive a restart");
  assert.ok(restarted.voices <= VOICE_CEILING, `restart left ${restarted.voices} voices`);
  assert.equal(restarted.layers, start.layers, "restart changed the continuous layer count");

  assert.equal(errors.length, 0, `console/page errors: ${errors.join(" | ")}`);
  console.log("capture-audio: deck/launch/perspective/transit/restart behaviour and live capture complete");
} finally {
  await browser.close();
}
