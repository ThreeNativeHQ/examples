/**
 * The sortie slice, in a browser, with the frames a person has to look at.
 *
 * The automated gates cannot see a scorch mark or tell a deck hit from a splash, so this walks the
 * briefing choice, a real attack on a designated carrier, the approach guidance and the short
 * debrief, and leaves a screenshot of each. Forced states are listed in the report.
 */
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

const URL = process.env.MIDWAY_URL || "http://127.0.0.1:5199";
const OUT = process.env.MIDWAY_SHOTS || "screenshots/sortie";

const browser = await chromium.launch({
  headless: false,
  args: ["--enable-unsafe-webgpu", "--enable-features=Vulkan", "--disable-gpu-sandbox", "--ignore-gpu-blocklist", "--ozone-platform=x11"],
});
const errors = [];
const forced = [];
const log = (stage, detail) => console.log(`${stage.padEnd(24)} ${JSON.stringify(detail)}`);

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
  await mkdir(OUT, { recursive: true });
  const seconds = async (n) => {
    const t = await page.evaluate(() => window.midway.battle.time);
    await page.waitForFunction((u) => window.midway.battle.time >= u, t + n, { timeout: Math.max(30000, n * 5000) });
  };

  // ---- 1. The briefing offers the assignment ----------------------------------------------
  await page.screenshot({ path: `${OUT}/01-briefing.png` });
  await page.selectOption("#assignment-select", "strike");
  const chosen = await page.evaluate(() => window.midway.battle.sortie.assignment);
  assert.equal(chosen, "strike", "the briefing selection reaches the simulation");
  log("assignment", { chosen, note: await page.textContent("#assignment-note") });

  await page.click("#start-air");
  await seconds(3);

  // ---- 2. Designate a carrier and put three bombs into its deck ----------------------------
  const target = await page.evaluate(() => {
    const b = window.midway.battle;
    const ship = b.ships.find((s) => s.team === "jp" && s.kind === "carrier" && !s.sunk);
    b.recordContact(ship);
    b.target = ship.id;
    b.updateSortie();
    return { name: ship.name, id: ship.id, sortieTarget: b.sortie.target };
  });
  assert.equal(target.sortieTarget, target.id, "the designated carrier becomes the sortie target");
  forced.push("enemy carrier contact recorded and designated directly on the simulation");
  log("designated", target);

  // Three separated deck hits, so the fires and scars have to sit where the weapons landed.
  for (const offset of [-70, 0, 65]) {
    await page.evaluate(([name, along]) => {
      const b = window.midway.battle;
      const ship = b.ships.find((s) => s.name === name);
      const f = { x: Math.sin(ship.heading), z: -Math.cos(ship.heading) };
      const point = { x: ship.x + f.x * along, y: 20, z: ship.z + f.z * along };
      b.bombs.push({ id: b.id("bomb"), x: point.x, y: 42, z: point.z, vx: 0, vy: -120, vz: 0, team: "us", owner: "player", age: 0, damage: 95, stamp: { sortie: b.sortie.id, target: ship.id, ordered: false } });
    }, [target.name, offset]);
    await seconds(0.6);
  }
  // One near miss alongside: it must make sea effects, never a deck scar.
  await page.evaluate((name) => {
    const b = window.midway.battle;
    const ship = b.ships.find((s) => s.name === name);
    b.bombs.push({ id: b.id("bomb"), x: ship.x + Math.cos(ship.heading) * 45, y: 6, z: ship.z + Math.sin(ship.heading) * 45, vx: 0, vy: -120, vz: 0, team: "us", owner: "player", age: 0, damage: 95, stamp: null });
  }, target.name);
  forced.push("four weapons spawned on the simulation at chosen impact points, three on deck and one alongside");
  await seconds(1.5);

  const damage = await page.evaluate((name) => {
    const b = window.midway.battle;
    const ship = b.ships.find((s) => s.name === name);
    b.playerFlight.reset();
    const mesh = window.midway.world.meshes.get(ship.id);
    const scars = (mesh?.userData?.shipScars ?? []).filter((m) => m.visible);
    return {
      hp: +ship.hp.toFixed(1),
      fire: +ship.fire.toFixed(2),
      deck: +ship.deck.toFixed(2),
      impacts: (ship.impacts ?? []).map((m) => ({ forward: +m.forward.toFixed(1), right: +m.right.toFixed(1), height: +m.height.toFixed(1), nearMiss: m.nearMiss })),
      visibleScars: scars.length,
      scarPositions: scars.map((m) => [+m.position.x.toFixed(1), +m.position.y.toFixed(1), +m.position.z.toFixed(1)]),
      objective: b.sortie.objective,
      personalHits: b.sortie.personalHits,
      score: b.score,
      shipHits: b.stats.shipHits,
      nearMisses: b.stats.nearMisses,
    };
  }, target.name);
  log("attack", damage);
  assert.equal(damage.objective, "achieved", `an observed hit on the designated carrier completes the strike: ${JSON.stringify(damage)}`);
  assert.equal(damage.shipHits, 3, `three direct hits are credited, the near miss is not: ${JSON.stringify(damage)}`);
  assert.equal(damage.nearMisses, 1, `and the near miss is counted as one: ${JSON.stringify(damage)}`);
  assert.equal(damage.visibleScars, 3, `three deck scars, none for the near miss: ${JSON.stringify(damage)}`);
  assert.ok(
    new Set(damage.scarPositions.map((p) => p[2])).size === 3,
    `the scars sit at three different points along the hull: ${JSON.stringify(damage.scarPositions)}`,
  );

  // Look at the burning ship from astern, in the chase view.
  await page.evaluate((name) => {
    const b = window.midway.battle;
    const ship = b.ships.find((s) => s.name === name);
    const f = { x: Math.sin(ship.heading), z: -Math.cos(ship.heading) };
    const p = b.player;
    Object.assign(p, {
      x: ship.x - f.x * 900, y: 300, z: ship.z - f.z * 900,
      heading: ship.heading, pitch: 0.02, roll: 0,
      vx: f.x * 90, vy: 0, vz: f.z * 90, speed: 90, autopilot: false,
    });
    b.playerFlight.reset();
  }, target.name);
  forced.push("player placed astern of the burning carrier so the damage is in frame");
  await page.keyboard.press("F2");
  await seconds(2.5);
  await page.screenshot({ path: `${OUT}/02-burning-carrier.png` });

  // Close over the deck, so the scorch marks themselves are big enough to judge.
  const close = await page.evaluate((name) => {
    const b = window.midway.battle;
    const ship = b.ships.find((s) => s.name === name);
    const f = { x: Math.sin(ship.heading), z: -Math.cos(ship.heading) };
    const p = b.player;
    Object.assign(p, {
      x: ship.x - f.x * 250, y: 105, z: ship.z - f.z * 250,
      heading: ship.heading, pitch: -0.3, roll: 0,
      vx: f.x * 70, vy: 0, vz: f.z * 70, speed: 70, autopilot: false,
    });
    b.playerFlight.reset();
    const mesh = window.midway.world.meshes.get(ship.id);
    const scars = (mesh?.userData?.shipScars ?? []).filter((m) => m.visible);
    return { scars: scars.length, y: scars.map((m) => +m.position.y.toFixed(2)) };
  }, target.name);
  forced.push("player placed low over the deck so the scorch marks are legible");
  await seconds(1.2);
  await page.screenshot({ path: `${OUT}/02b-deck-scars.png` });
  log("deck scars", close);
  assert.ok(close.y.every((y) => y > 20), `scorch marks sit on the deck, not inside the hull: ${JSON.stringify(close)}`);

  // ---- 3. The approach guidance -------------------------------------------------------------
  await page.keyboard.press("KeyH");
  await seconds(2);
  const approach = await page.evaluate(() => ({
    cues: document.getElementById("approach-cues")?.textContent ?? "",
    wing: document.getElementById("wing-status")?.textContent ?? "",
    phase: window.midway.battle.approach().phase,
    reserve: window.midway.battle.returnReserve(),
  }));
  log("approach", approach);
  assert.ok(approach.cues.includes("KT AIRSPEED"), `the approach line reports real numbers: ${JSON.stringify(approach)}`);
  assert.ok(approach.wing.length > 0, `the wing line reports what the wing is doing: ${JSON.stringify(approach)}`);
  await page.keyboard.press("F1");
  await seconds(1);
  await page.screenshot({ path: `${OUT}/03-approach.png` });

  // Long return/contact cues must push radio messages down instead of painting over them.
  for (const viewport of [{ width: 960, height: 560 }, { width: 1400, height: 800 }]) {
    await page.setViewportSize(viewport);
    await page.waitForTimeout(300);
    const layout = await page.evaluate(() => {
      const bounds = (selector) => document.querySelector(selector).getBoundingClientRect().toJSON();
      return { mission: bounds('.mission'), radio: bounds('#radio-log'), instruments: bounds('.instruments') };
    });
    assert.ok(layout.radio.y >= layout.mission.bottom + 8, `radio clears mission at ${viewport.width}px: ${JSON.stringify(layout)}`);
    assert.ok(layout.radio.height >= 36, `latest radio message has readable space: ${JSON.stringify(layout)}`);
    assert.ok(layout.radio.bottom <= layout.instruments.y - 8, `radio clears instruments: ${JSON.stringify(layout)}`);
    await page.screenshot({ path: `${OUT}/03-hud-${viewport.width}.png` });
    log("HUD layout", { viewport, ...layout });
  }

  // ---- 4. The short-sortie debrief ------------------------------------------------------------
  const arrival = await page.evaluate(() => {
    const b = window.midway.battle;
    Object.assign(b.player, { fuel: 41, hp: 68 });
    b.recover(b.ships.find((s) => s.id === b.player.home));
    return { status: b.status, result: b.sortie.result };
  });
  forced.push("recovery called directly on the simulation instead of flying the final");
  await page.waitForTimeout(600);
  assert.equal(arrival.status, "debrief", `a short sortie ends in its own state: ${JSON.stringify(arrival)}`);
  assert.equal(arrival.result.outcome, "recovered", JSON.stringify(arrival));
  assert.equal(arrival.result.objective, true, JSON.stringify(arrival));
  assert.equal(arrival.result.fuel, 41, `arrival fuel is captured before repair: ${JSON.stringify(arrival)}`);
  const shown = await page.evaluate(() => ({
    hidden: document.getElementById("debrief").classList.contains("hidden"),
    phase: document.getElementById("debrief-phase").textContent,
    title: document.getElementById("debrief-title").textContent,
    reason: document.getElementById("debrief-reason").textContent,
  }));
  assert.equal(shown.hidden, false, "the debrief is on screen");
  assert.ok(/objective/i.test(shown.title), `the outcome names the assignment result: ${JSON.stringify(shown)}`);
  log("debrief", shown);
  await page.screenshot({ path: `${OUT}/04-debrief.png` });

  // Pause must be usable over a terminal debrief, and closing it must restore that frozen result.
  await page.keyboard.press("Escape");
  assert.equal(await page.locator("#debrief").isVisible(), false, "debrief must not intercept pause controls");
  assert.equal(await page.locator("#pause-overlay").isVisible(), true);
  await page.keyboard.press("Escape");
  assert.equal(await page.locator("#debrief").isVisible(), true, "closing pause restores the debrief");
  assert.deepEqual(await page.evaluate(() => window.midway.battle.sortie.result), arrival.result);
  await page.keyboard.press("Escape");
  await page.click("#restart-pause");
  await page.waitForSelector("#briefing:not(.hidden)");

  // Empty fuel and weapon racks are a feasible initial condition; service and loadout selection
  // still run through Battle and the actual UI. The recovery approach itself is not under test.
  await page.selectOption("#assignment-select", "operation");
  await page.click("#start-deck");
  await page.evaluate(() => {
    const b = window.midway.battle;
    Object.assign(b.player, { fuel: 10, bombs: 0, ammo: 12, rearAmmo: 7 });
    b.home.air.fuel = 0;
    Object.assign(b.home.air.stores, { bomb: 0, torpedo: 0, ammo: 0 });
    b.recover(b.home);
  });
  forced.push("player recovered with 10% fuel and empty carrier fuel/weapon racks to isolate service accounting");
  await page.waitForFunction(() => window.midway.battle.player.mode === "deck", null, { timeout: 90000 });
  await page.keyboard.press("Escape");
  await page.selectOption("#deck-loadout", "torpedo");
  const limited = await page.evaluate(() => ({
    fuel: window.midway.battle.player.fuel,
    bombs: window.midway.battle.player.bombs,
    loadout: window.midway.battle.player.loadout,
    selection: document.getElementById("deck-loadout").value,
    message: document.getElementById("deck-loadout-note").textContent,
  }));
  assert.ok(limited.fuel <= 10, "empty carrier fuel must not refill the player");
  assert.equal(limited.bombs, 0);
  assert.equal(limited.loadout, "bomb");
  assert.equal(limited.selection, "bomb", "a refused swap restores the real selection");
  assert.match(limited.message, /NO TORPEDOES ABOARD/);
  log("limited service", limited);
  await page.screenshot({ path: `${OUT}/05-limited-service.png` });

  assert.deepEqual(errors, [], `no console or page errors: ${JSON.stringify(errors)}`);
  console.log(JSON.stringify({ pass: true, out: OUT, forced }, null, 1));
} finally {
  await browser.close();
}
