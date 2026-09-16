/**
 * Browser capture for the two parked fixes: a boat that dives from an aircraft, a boat that fires at
 * an observed capital ship, an escort whose sonar hunts a contact and depth-charges it, and the HUD
 * damage flash firing only for the player's own hurt.
 *
 * The ship meshes are built from the live battle's ids, and a fresh battle of the same fleet reuses
 * them, so each scenario reinitialises `scene.battle` in place and steps it by hand while the scene
 * is paused. The renderer still syncs meshes and draws, so a screenshot is of real sim state.
 *
 * Run through the lock wrapper, never on the desktop:
 *   MIDWAY_URL=http://127.0.0.1:5199 bash tools/capture-lock.sh node tools/capture-sub-asw.mjs
 */
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";

const URL = process.env.MIDWAY_URL || "http://127.0.0.1:5199";
const OUT = process.env.MIDWAY_OUT || "screenshots/subfix";
const STEP = 1 / 30;

const report = { tool: "capture-sub-asw", url: URL, scenarios: {} };

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
try {
  const page = await browser.newPage({ viewport: { width: 1672, height: 941 } });
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await page.goto(URL);
  await page.waitForSelector("#loading.hidden", { state: "attached", timeout: 120000 });
  await page.waitForSelector("#briefing:not(.hidden)");
  await page.evaluate(async () => {
    const urls = performance
      .getEntriesByType("resource")
      .map((e) => e.name)
      .filter((n) => /\/src\/game\.ts(?:\?|$)/.test(n));
    for (const url of urls.reverse()) {
      const scene = (await import(url)).default.scene;
      if (scene) {
        window.midway = scene;
        break;
      }
    }
    if (!window.midway) throw new Error("Loaded game has no scene");
  });
  const adapter = await page.evaluate(async () => {
    const a = await navigator.gpu.requestAdapter();
    return { vendor: a.info.vendor, architecture: a.info.architecture };
  });
  assert.ok(adapter.vendor && !/swiftshader|lavapipe/i.test(JSON.stringify(adapter)), `software adapter: ${JSON.stringify(adapter)}`);
  await mkdir(OUT, { recursive: true });

  // A fresh battle over the same fleet reuses the world's meshes by id, so the render stays real.
  // `world.reset` is the engine's own restart path: it re-points the world at the battle and snaps
  // the camera, which a bare `scene.battle = ...` would not.
  const reinit = (seed) =>
    page.evaluate((seed) => {
      const s = window.midway;
      const B = s.battle.constructor;
      const b = new B(seed);
      b.start();
      b.player.mode = "spectator";
      s.battle = b;
      s.world.reset(b);
      s.paused = true;
      s.world.updateCamera = () => {};
      document.getElementById("briefing")?.classList.add("hidden");
      const h = document.getElementById("hud");
      if (h) h.style.visibility = "hidden";
      return true;
    }, seed);
  const hud = (visible) =>
    page.evaluate((visible) => {
      const el = document.getElementById("hud");
      if (el) el.style.visibility = visible ? "" : "hidden";
    }, visible);
  const look = (x, z, dist, height, atY = 6) =>
    page.evaluate(
      ({ x, z, dist, height, atY }) => {
        const w = window.midway.world;
        w.camera.position.set(x + dist, height, z + dist);
        w.camera.lookAt(x, atY, z);
      },
      { x, z, dist, height, atY },
    );
  const shot = async (name) => {
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${OUT}/${name}.png` });
  };

  // 1 — a boat dives when a hostile aircraft comes overhead.
  await reinit(19420604);
  const threat = await page.evaluate(() => {
    const s = window.midway;
    const b = s.battle;
    const sub = b.ships.find((x) => x.name === "I-168");
    sub.x = 0;
    sub.z = 25000;
    sub.sub.depth = 0;
    sub.sub.mode = "surfaced";
    sub.surfaced = true;
    sub.y = 0;
    const plane = b.aircraft.find((a) => a.team === "us" && a.hp > 0);
    const before = { depth: sub.sub.depth, mode: sub.sub.mode, plane: plane && plane.kind };
    return { before, subPos: { x: sub.x, z: sub.z } };
  });
  await look(threat.subPos.x, threat.subPos.z, 105, 42, 4);
  await shot("1a-sub-surfaced");
  const dived = await page.evaluate(() => {
    const s = window.midway;
    const b = s.battle;
    const sub = b.ships.find((x) => x.name === "I-168");
    const plane = b.aircraft.find((a) => a.team === "us" && a.hp > 0);
    for (let i = 0; i < 50 * 30; i += 1) {
      plane.x = sub.x + 200;
      plane.z = sub.z;
      plane.y = 400;
      plane.hp = 500;
      plane.mode = "flight";
      b.step(1 / 30, {});
    }
    return { depth: sub.sub.depth, mode: sub.sub.mode, y: sub.y, surfaced: sub.surfaced };
  });
  await shot("1b-sub-dived");
  report.scenarios.diveOnAirThreat = { ...threat.before, after: dived };
  assert.ok(dived.depth > 30, `boat did not dive from the aircraft: ${JSON.stringify(dived)}`);

  // 2 — a boat fires a torpedo at an observed capital ship.
  await reinit(19420604);
  const torpedo = await page.evaluate(() => {
    const s = window.midway;
    const b = s.battle;
    const sub = b.ships.find((x) => x.name === "I-168");
    const target = b.ships.find((x) => x.name === "USS Enterprise");
    sub.x = target.x + 3000;
    sub.z = target.z;
    sub.torpTimer = 1;
    for (const e of b.ships) if (e.hunt) e.hunt = null;
    const scout = b.aircraft.find((a) => a.team === "jp" && a.hp > 0);
    let fired = 0;
    const real = b.spawnTorpedo.bind(b);
    b.spawnTorpedo = (a, heading, options) => {
      const t = real(a, heading, options);
      if (a === sub) fired += 1;
      return t;
    };
    for (let i = 0; i < 150 * 30 && fired === 0; i += 1) {
      scout.x = target.x + 200;
      scout.z = target.z;
      scout.y = 900;
      scout.hp = 500;
      scout.mode = "flight";
      b.step(1 / 30, {});
    }
    const launchedAt = +b.time.toFixed(1);
    // Let the run develop clear of the boat's own wake so the weapon is visible in the frame.
    for (let i = 0; i < 5 * 30; i += 1) b.step(1 / 30, {});
    const t = b.torpedoes[0];
    return {
      fired,
      at: launchedAt,
      torpedoes: b.torpedoes.length,
      torp: t ? { x: t.x, z: t.z, y: +t.y.toFixed(1), team: t.team } : null,
      sub: { x: sub.x, z: sub.z },
      target: { x: target.x, z: target.z },
    };
  });
  if (torpedo.torp) await look((torpedo.sub.x + torpedo.torp.x) / 2, (torpedo.sub.z + torpedo.torp.z) / 2, 220, 70, 0);
  else await look(torpedo.sub.x, torpedo.sub.z, 150, 60, 8);
  await shot("2-torpedo-away");
  report.scenarios.fireOnObservedCarrier = torpedo;
  assert.ok(torpedo.fired > 0, `boat never fired: ${JSON.stringify(torpedo)}`);

  // 3 — an escort's sonar holds a shallow boat, runs the attack track and drops a depth-charge salvo.
  await reinit(19420604);
  const setup3 = await page.evaluate(() => {
    const s = window.midway;
    const b = s.battle;
    const sub = b.ships.find((x) => x.name === "I-168");
    const escort = b.ships.find((x) => x.name === "USS Hammann");
    // Fly the track: the sonar contact has to be held for the investigation before an attack.
    let attackingAt = null;
    for (let i = 0; i < 120 * 30 && attackingAt === null; i += 1) {
      sub.x = escort.x + 600;
      sub.z = escort.z;
      sub.sub.depth = 0;
      sub.sub.mode = "surfaced";
      sub.surfaced = true;
      sub.y = 0;
      b.step(1 / 30, {});
      if (escort.hunt?.phase === "attacking") attackingAt = +b.time.toFixed(1);
    }
    return { attackingAt, sub: { x: sub.x, z: sub.z }, escort: { x: escort.x, z: escort.z } };
  });
  await page.evaluate(
    ({ ex, ez, sx, sz }) => {
      const w = window.midway.world;
      const dx = sx - ex;
      const dz = sz - ez;
      const len = Math.hypot(dx, dz) || 1;
      // Behind the escort on the far side from the boat, so both hulls lie on the sight line.
      w.camera.position.set(ex - (dx / len) * 260, 70, ez - (dz / len) * 260);
      w.camera.lookAt(sx, 4, sz);
    },
    { ex: setup3.escort.x, ez: setup3.escort.z, sx: setup3.sub.x, sz: setup3.sub.z },
  );
  await shot("3-escort-hunts-contact");
  const asw = await page.evaluate(() => {
    const s = window.midway;
    const b = s.battle;
    const sub = b.ships.find((x) => x.name === "I-168");
    const escort = b.ships.find((x) => x.name === "USS Hammann");
    const charges = () => b.ships.reduce((n, e) => n + (e.hunt?.charges ?? 0), 0);
    const start = charges();
    let droppedAt = null;
    for (let i = 0; i < 60 * 30 && droppedAt === null; i += 1) {
      sub.x = escort.x + 600;
      sub.z = escort.z;
      sub.sub.depth = 0;
      sub.sub.mode = "surfaced";
      sub.surfaced = true;
      sub.y = 0;
      b.step(1 / 30, {});
      if (charges() < start) droppedAt = +b.time.toFixed(1);
    }
    return {
      attackingAt: b.time,
      droppedAt,
      salvoes: escort.hunt?.salvoes ?? 0,
      phase: escort.hunt?.phase ?? null,
      chargesLeft: charges(),
      subHp: +sub.hp.toFixed(0),
      sub: { x: sub.x, z: sub.z },
      escort: { x: escort.x, z: escort.z },
    };
  });
  asw.attackingAt = setup3.attackingAt;
  report.scenarios.escortHuntsContact = asw;
  assert.ok(asw.attackingAt !== null && asw.droppedAt !== null && asw.salvoes > 0, `escort never attacked: ${JSON.stringify(asw)}`);

  // 4 — the HUD flash, through the real consumer Midway.ts:279 uses.
  await reinit(19420604);
  await hud(true);
  const flash = await page.evaluate(() => {
    const s = window.midway;
    const b = s.battle;
    const consume = () => {
      let flashes = 0;
      for (const e of b.events.splice(0)) if (e.type === "damage") flashes += 1;
      return flashes;
    };
    // (a) the player's rounds strafe an enemy hull.
    const ship = b.ships.find((x) => x.team === "jp" && x.kind === "destroyer");
    s.hud.hitFlash = 0;
    b.bullets.push({ x: ship.x, y: ship.deckHeight + 0.1, z: ship.z, vx: 0, vy: -60, vz: 0, ttl: 2, type: "mg", owner: "player", team: "us", damage: 8 });
    b.step(1 / 30, {});
    const enemyFlash = consume();
    s.hud.hitFlash = enemyFlash > 0 ? 1 : 0;
    return { enemy: { flashes: enemyFlash, hitFlash: s.hud.hitFlash } };
  });
  await page.evaluate(() => {
    const s = window.midway;
    s.hud.update = () => {};
    document.getElementById("damage").style.opacity = s.hud.hitFlash > 0 ? "0.7" : "0";
  });
  await shot("4a-enemy-hit-no-flash");
  const playerFlash = await page.evaluate(() => {
    const s = window.midway;
    const b = s.battle;
    s.hud.update = () => {};
    s.hud.hitFlash = 0;
    b.damagePlane(b.player, 5, "jp-ai");
    let flashes = 0;
    for (const e of b.events.splice(0)) if (e.type === "damage") flashes += 1;
    s.hud.hitFlash = flashes > 0 ? 1 : 0;
    document.getElementById("damage").style.opacity = s.hud.hitFlash > 0 ? "0.7" : "0";
    return { flashes, hitFlash: s.hud.hitFlash };
  });
  await shot("4b-player-hit-flash");
  report.scenarios.damageFlash = { enemyHit: flash.enemy, playerHit: playerFlash };
  assert.equal(flash.enemy.flashes, 0, "the player's strafe on an enemy raised a damage flash");
  assert.equal(playerFlash.flashes, 1, "the player's own hit did not raise a damage flash");

  assert.equal(errors.length, 0, `console errors: ${errors.join(" | ")}`);
  report.pass = true;
} finally {
  await browser.close();
}

await writeFile(`${OUT}/report.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
