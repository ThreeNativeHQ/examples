/**
 * The death dive, in a browser, with the frames a person has to look at.
 *
 * The sim gate proves the aircraft falls and the debrief waits; it cannot see whether the wreck
 * burns, spins and goes into the sea like the ones the player shoots down. This kills the player's
 * aircraft in the air and captures the fall from the chase camera, the impact and the debrief.
 */
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

const URL = process.env.MIDWAY_URL || "http://127.0.0.1:5199";
const OUT = process.env.MIDWAY_SHOTS || "screenshots/crash";

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
  const seconds = async (n) => {
    const t = await page.evaluate(() => window.midway.battle.time);
    await page.waitForFunction((u) => window.midway.battle.time >= u, t + n, { timeout: Math.max(30000, n * 5000) });
  };

  await page.click("#start-air");
  await seconds(3);
  // Chase view, so the aircraft itself is in frame all the way down.
  await page.keyboard.press("F1"); // start in the cockpit: the crash must pull the view outside itself
  await page.evaluate(() => {
    const b = window.midway.battle;
    Object.assign(b.player, { y: 1200, autopilot: false });
    b.playerFlight.reset();
  });
  await seconds(1.5);
  await page.screenshot({ path: `${OUT}/01-before.png` });

  // ---- Battle damage the wingman can see: engine smoke, then a streaming tank -------------
  // The airborne start puts the squadron ten kilometres astern, still climbing off the deck, so
  // one escort is placed on the wing where it would be by the time it matters. Forced state.
  const escort = await page.evaluate(() => {
    const b = window.midway.battle;
    const a = b.aircraft.filter((q) => q.team === "us" && q.wing === true && q.hp > 0).sort((q, r) => (q.mode === "flight" ? -1 : 1) - (r.mode === "flight" ? -1 : 1))[0];
    if (!a) return null;
    Object.assign(a, { mode: "flight", tactic: "escort", x: b.player.x + 70, y: b.player.y - 6, z: b.player.z + 45 });
    return { id: a.id, near: b.wingmanNear() };
  });
  log("escort placed", escort);
  assert.ok(escort?.near, "a wingman has to be on the wing to see anything");
  // Damage is judged from outside, where the wingman is looking.
  await page.keyboard.press("F2");
  const hurt = await page.evaluate(() => {
    const b = window.midway.battle;
    b.player.damage.engine.integrity = 0.45;
    return { engine: b.player.damage.engine.integrity };
  });
  log("engine damaged", hurt);
  // Orbit the chase camera onto the beam: a trail that streams straight astern is invisible from
  // directly behind it — this is the wingman's angle, and the angle the effect has to read from.
  await page.evaluate(() => {
    window.midway.world.lookActive = true;
    window.midway.world.lookYaw = 1.15;
    window.midway.world.lookPitch = 0.12;
  });
  await seconds(3);
  await page.screenshot({ path: `${OUT}/01b-engine-smoke.png` });
  const leak = await page.evaluate(() => {
    const b = window.midway.battle;
    b.player.damage.leftWing.leak = 0.75;
    b.player.damage.leftWing.integrity = 0.6;
    return { leak: b.player.damage.leftWing.leak };
  });
  log("tank holed", leak);
  await seconds(3);
  await page.screenshot({ path: `${OUT}/01c-fuel-stream.png` });
  const heard = await page.evaluate(() => window.midway.battle.radio.filter((r) => r.from === "SCOUT THREE").map((r) => r.text));
  log("wingman", heard);
  assert.ok(heard.some((t) => /engine/i.test(t)), `the wingman calls the engine smoke he can see: ${JSON.stringify(heard)}`);

  await page.evaluate(() => {
    window.midway.world.lookActive = false;
    window.midway.world.lookYaw = 0;
    window.midway.world.lookPitch = 0;
  });
  // Back in the cockpit, so the crash has to take the view outside on its own.
  await page.keyboard.press("F1");
  await seconds(0.5);
  const hit = await page.evaluate(() => {
    const b = window.midway.battle;
    b.damagePlane(b.player, 9999, "jp", "fuselage");
    return { mode: b.player.mode, hp: b.player.hp, status: b.status, y: +b.player.y.toFixed(0) };
  });
  log("destroyed", hit);
  await seconds(0.3);
  const view = await page.evaluate(() => window.midway.world.cameraMode);
  assert.equal(view, 0, "the crash must take the view out of the cockpit so the player sees the aircraft go in");
  assert.equal(hit.mode, "crashing", "the aircraft must enter the dive, not the debrief");
  assert.equal(hit.status, "playing", "no modal before the ground");

  for (const [n, name] of [[1, "02-dive-1s"], [2, "03-dive-3s"], [3, "04-dive-6s"]]) {
    await seconds(n);
    await page.screenshot({ path: `${OUT}/${name}.png` });
    const s = await page.evaluate(() => {
      const b = window.midway.battle;
      return { t: +b.player.crashAge.toFixed(1), y: +b.player.y.toFixed(0), vy: +b.player.vy.toFixed(0), roll: +b.player.roll.toFixed(2), fire: +b.player.damage.engine.fire.toFixed(2), status: b.status };
    });
    log(name, s);
    assert.equal(s.status, "playing", `the debrief opened at ${s.y} m, in the air`);
    assert.ok(s.fire > 0.5, `a destroyed aircraft burns on the way down: ${JSON.stringify(s)}`);
  }
  // The splash itself, before the report: the aircraft is in the water and the debrief is not up.
  await page.waitForFunction(() => window.midway.battle.player.mode === "wreck", null, { timeout: 60000 });
  await page.waitForTimeout(400);
  const impact = await page.evaluate(() => ({ y: +window.midway.battle.player.y.toFixed(2), status: window.midway.battle.status, debriefOpen: !document.getElementById("debrief").classList.contains("hidden") }));
  log("impact", impact);
  assert.equal(impact.status, "playing", "the sea takes the aircraft before the report opens");
  assert.equal(impact.debriefOpen, false, "the debrief must not be up over the splash");
  await page.screenshot({ path: `${OUT}/05-impact.png` });
  // The wreck settles into a downed pilot, not a defeat: the battle keeps running and a
  // replacement is offered on a friendly deck.
  await page.waitForFunction(() => window.midway.battle.player.mode === "downed", null, { timeout: 60000 });
  await page.waitForTimeout(400);
  const downed = await page.evaluate(() => {
    const b = window.midway.battle;
    return {
      mode: b.player.mode,
      status: b.status,
      sortie: b.sortie.id,
      frozen: b.sortie.result ? b.sortie.result.outcome : null,
      debriefOpen: !document.getElementById("debrief").classList.contains("hidden"),
      button: !document.getElementById("downed").classList.contains("hidden"),
    };
  });
  log("downed", downed);
  assert.equal(downed.status, "playing", "a shoot-down must not end the battle while a deck is afloat");
  assert.equal(downed.mode, "downed");
  assert.equal(downed.debriefOpen, false, "no debrief opens while the pilot is downed");
  assert.equal(downed.frozen, "lost", "the lost sortie is frozen before a replacement");
  assert.equal(downed.button, true, "the replacement button is offered while downed");
  // The panel and its button must be truly laid out inside the viewport, not just un-hidden: a
  // pointer-events:none ancestor would leave a visible button no click could ever reach.
  const downedBox = await page.locator("#downed").boundingBox();
  assert.ok(downedBox && downedBox.width > 0 && downedBox.height > 0, `the downed panel must be laid out: ${JSON.stringify(downedBox)}`);
  const buttonBox = await page.locator("#take-aircraft").boundingBox();
  assert.ok(buttonBox && buttonBox.width > 0 && buttonBox.height > 0, `the replacement button must be laid out inside the viewport: ${JSON.stringify(buttonBox)}`);
  const downedText = await page.locator("#downed-reason").textContent();
  assert.ok(/aircraft lost/i.test(downedText), `the downed panel names the flight loss, not a generic game-over: ${downedText}`);
  await page.screenshot({ path: `${OUT}/06-downed.png` });

  // The clock keeps running through the downed wait and the AI is still fighting.
  const beforeTime = await page.evaluate(() => window.midway.battle.time);
  await page.waitForFunction((t) => window.midway.battle.time >= t + 2, beforeTime, { timeout: 20000 });

  // The button really works: a new sortie id, the old result preserved, the pilot back on a deck.
  const oldId = downed.sortie;
  await page.click("#take-aircraft");
  const replaced = await page.evaluate(() => {
    const b = window.midway.battle;
    return { mode: b.player.mode, status: b.status, sortie: b.sortie.id, home: b.home?.name ?? "", last: b.lastResult?.outcome ?? null };
  });
  log("replaced", replaced);
  assert.equal(replaced.mode, "deck", "the replacement puts the pilot on a deck");
  assert.equal(replaced.status, "playing");
  assert.equal(replaced.sortie, oldId + 1, "the replacement opens a new sortie id");
  assert.equal(replaced.last, "lost", "the lost sortie's frozen result survives the replacement");
  await page.screenshot({ path: `${OUT}/07-replacement-deck.png` });

  // And it really flies: hold the throttle until it lifts off.
  await page.keyboard.down("KeyW");
  await page.waitForFunction(() => window.midway.battle.player.mode === "flight", null, { timeout: 45000 });
  await page.keyboard.up("KeyW");
  await page.screenshot({ path: `${OUT}/08-relaunch.png` });

  // The map's battle appraisal, with the fleet still fighting.
  await page.keyboard.press("KeyM");
  await page.waitForTimeout(500);
  const intel = await page.evaluate(() => ({
    appraisal: document.getElementById("battle-appraisal").textContent,
    line: document.getElementById("battle-line").textContent,
    basis: document.getElementById("battle-basis").textContent,
    mapOpen: !document.getElementById("map-overlay").classList.contains("hidden"),
  }));
  log("battle status", intel);
  assert.equal(intel.mapOpen, true, "the map opens");
  assert.ok(intel.appraisal.length > 0, "the map must carry an appraisal");
  assert.ok(/DECK|REPORTED/.test(intel.line), `the supporting line names decks and reports: ${intel.line}`);
  assert.ok(/BASIS:/.test(intel.basis), `the appraisal must state its basis: ${intel.basis}`);
  const statusBox = await page.locator("#battle-status").boundingBox();
  assert.ok(statusBox && statusBox.width > 0 && statusBox.height > 0, `the battle status block must be visibly laid out: ${JSON.stringify(statusBox)}`);
  await page.screenshot({ path: `${OUT}/09-battle-status.png` });
  await page.keyboard.press("KeyM");

  assert.equal(errors.length, 0, `console/page errors: ${errors.join(" | ")}`);
  console.log(`capture-crash: 9 frames in ${OUT}`);
} finally {
  await browser.close();
}
