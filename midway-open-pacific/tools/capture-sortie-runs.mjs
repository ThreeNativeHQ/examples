/**
 * Original sortie AC-16: two normal-entry airborne sorties, recovered with nothing injected.
 * The strike uses an explicitly ordered wing hit; manual bombing is not proved by this tool.
 *
 * After the briefing click, this harness only presses keys and reads state. No world, HP, weapon,
 * fuel or landing state is written, so what it proves is that the assignments are actually
 * attainable with the assistance the game already offers — not that they are enjoyable.
 */
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

const URL = process.env.MIDWAY_URL || "http://127.0.0.1:5199";
const OUT = process.env.MIDWAY_SHOTS || "screenshots/sortie";
const LIMIT = 12 * 60;
// A smaller window raises the frame rate on the virtual display, so the same simulated sortie takes
// less wall time. It changes nothing the run asserts, all of which is simulation state.
const WIDTH = Number(process.env.MIDWAY_WIDTH || 960);
const HEIGHT = Number(process.env.MIDWAY_HEIGHT || 560);

const browser = await chromium.launch({
  headless: false,
  args: ["--enable-unsafe-webgpu", "--enable-features=Vulkan", "--disable-gpu-sandbox", "--ignore-gpu-blocklist", "--ozone-platform=x11"],
});
const errors = [];
const log = (stage, detail) => console.log(`${stage.padEnd(24)} ${JSON.stringify(detail)}`);

try {
  const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT } });
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await page.goto(URL);
  await page.waitForSelector("#loading.hidden", { state: "attached", timeout: 180000 });
  await page.waitForSelector("#briefing:not(.hidden)");
  await page.evaluate(async () => {
    const resource = (re) => performance.getEntriesByType("resource").map((e) => e.name).findLast((n) => re.test(n));
    window.midway = (await import(resource(/\/src\/game\.ts(?:\?|$)/))).default.scene;
  });
  const adapter = await page.evaluate(async () => {
    const a = await navigator.gpu.requestAdapter();
    return a ? { vendor: a.info.vendor, architecture: a.info.architecture } : null;
  });
  assert.ok(adapter?.vendor && !/swiftshader|lavapipe|llvmpipe/i.test(JSON.stringify(adapter)), `hardware WebGPU adapter required: ${JSON.stringify(adapter)}`);
  log("adapter", adapter);
  await mkdir(OUT, { recursive: true });

  /** Read-only snapshot of everything the two runs steer by. */
  const look = () =>
    page.evaluate(() => {
      const b = window.midway.battle;
      const p = b.player;
      const contacts = [...b.contacts.values()].filter((c) => c.kind === "carrier");
      return {
        status: b.status,
        time: b.time,
        elapsed: b.time - b.sortie.startTime,
        mode: p.mode,
        y: p.y,
        speed: p.speed,
        fuel: p.fuel,
        hp: p.hp,
        bombs: p.bombs,
        autopilot: p.autopilot,
        nav: p.nav,
        assignment: b.sortie.assignment,
        objective: b.sortie.objective,
        target: b.sortie.target,
        carrierContacts: contacts.length,
        freshCarrier: contacts.some((c) => b.time - c.time < 3 && !c.reported),
        phase: b.approach().phase,
        ready: b.approach().ready,
        cues: b.approach().cues,
        canAccelerate: b.canAccelerate(),
        wing: b.wingStatus(),
      };
    });

  const keys = [];
  const press = async (key) => {
    keys.push(key);
    await page.keyboard.press(key);
  };
  /** Advance real time in small slices, watching for the run going wrong. */
  const until = async (label, predicate, seconds, onTick = async () => {}) => {
    log(label, { waiting: true });
    const deadline = Date.now() + seconds * 1000;
    for (;;) {
      const s = await look();
      if (s.status === "lost") throw new Error(`${label}: the aircraft was lost — ${JSON.stringify(s)}`);
      if (s.elapsed > LIMIT) throw new Error(`${label}: exceeded ${LIMIT} simulated seconds — ${JSON.stringify(s)}`);
      if (predicate(s)) return s;
      if (Date.now() > deadline) throw new Error(`${label}: gave up after ${seconds}s — ${JSON.stringify(s)}`);
      await onTick(s);
      await page.waitForTimeout(250);
    }
  };
  /** Transit acceleration is an existing assist: hold it only where the game allows it. */
  let shifting = false;
  const transit = async (s) => {
    if (s.canAccelerate && !shifting) {
      shifting = true;
      await page.keyboard.down("Shift");
    } else if (!s.canAccelerate && shifting) {
      shifting = false;
      await page.keyboard.up("Shift");
    }
  };
  const releaseShift = async () => {
    if (shifting) {
      shifting = false;
      await page.keyboard.up("Shift");
    }
  };

  const recover = async (label) => {
    if ((await look()).nav !== "home") await press("KeyH");
    await until(`${label}: groove`, (s) => s.phase === "groove" || s.ready, 1500, transit);
    await releaseShift();
    const ready = await until(`${label}: ready for L`, (s) => s.ready, 900);
    await press("KeyL");
    return until(`${label}: debrief`, (s) => s.status === "debrief", 600).then((end) => ({ ready, end }));
  };

  const runs = {};

  // ---- Run 1: scout and report ---------------------------------------------------------------
  await page.selectOption("#assignment-select", "recon");
  await page.click("#start-air");
  keys.length = 0;
  await press("KeyT");
  await until("recon: find a carrier", (s) => s.freshCarrier, 1500, transit);
  await releaseShift();
  await press("KeyR");
  const reported = await until("recon: objective", (s) => s.objective === "achieved", 30);
  log("recon objective", { elapsed: +reported.elapsed.toFixed(1), contacts: reported.carrierContacts });
  const reconEnd = await recover("recon");
  await page.screenshot({ path: `${OUT}/05-recon-debrief.png` });
  runs.recon = await page.evaluate(() => window.midway.battle.sortie.result);
  runs.reconKeys = [...keys];
  log("recon run", { ...runs.recon, keys: runs.reconKeys.join(" "), readyCues: reconEnd.ready.cues });

  // ---- Run 2: carrier strike -----------------------------------------------------------------
  await page.keyboard.press("Escape");
  await page.click("#restart-pause");
  await page.waitForSelector("#briefing:not(.hidden)");
  await page.selectOption("#assignment-select", "strike");
  await page.click("#start-air");
  keys.length = 0;
  await press("KeyT");
  await until("strike: find a carrier", (s) => s.freshCarrier, 1500, transit);
  await releaseShift();
  // Order the designated strike and return under course hold while the fleet's scouts report.
  // Initial wing aircraft are unarmed scouts/fighters; the carrier launches armed aircraft later.
  if (!(await look()).target) await press("Tab");
  await until("strike: designated", (s) => !!s.target, 30);
  await press("Digit2");
  await press("KeyH");
  const hit = await until("strike: confirmed wing hit", (s) => s.objective === "achieved", 1500, transit);
  await releaseShift();
  log("ordered-wing objective", { elapsed: +hit.elapsed.toFixed(1), wing: hit.wing });
  await page.screenshot({ path: `${OUT}/06-strike-hit.png` });
  const strikeEnd = await recover("strike");
  await page.screenshot({ path: `${OUT}/07-strike-debrief.png` });
  runs.strike = await page.evaluate(() => window.midway.battle.sortie.result);
  assert.ok(runs.strike.wingHits > 0, "the explicitly ordered wing landed a credited hit");
  assert.equal(runs.strike.personalHits, 0, "this run proves ordered-wing credit, not manual bombing");
  runs.strikeKeys = [...keys];
  log("strike run", { ...runs.strike, keys: runs.strikeKeys.join(" "), readyCues: strikeEnd.ready.cues });

  for (const [name, result] of [["recon", runs.recon], ["strike", runs.strike]]) {
    assert.equal(result.outcome, "recovered", `${name} reached a recovered debrief: ${JSON.stringify(result)}`);
    assert.equal(result.objective, true, `${name} completed its assignment: ${JSON.stringify(result)}`);
    assert.ok(result.elapsed <= LIMIT, `${name} finished within ${LIMIT}s: ${JSON.stringify(result)}`);
  }
  assert.deepEqual(errors, [], `no console or page errors: ${JSON.stringify(errors)}`);
  console.log(JSON.stringify({ pass: true, limit: LIMIT, runs }, null, 1));
} finally {
  await browser.close();
}
