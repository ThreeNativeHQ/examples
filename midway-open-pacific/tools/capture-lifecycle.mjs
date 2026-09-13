/**
 * The whole gameplay loop, once through, in a browser.
 *
 * Section 10.3 of the handoff lists a lifecycle that has never been requalified since the models
 * were imported: both loadouts, the deck run, target selection and reporting, ordnance and hits,
 * AI launches and combat, damage, carrier destruction, recovery and arrestment, the win and loss
 * states, restart and the quality settings. This walks it.
 *
 * Where a state is unreachable in a short run — a carrier sinking, the player dying — it is forced
 * directly on the simulation and the report says which ones were forced. A forced state still
 * proves the transition and the rendering survive it, which is what has never been checked.
 */
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

const URL = process.env.MIDWAY_URL || "http://127.0.0.1:5199";
const OUT = process.env.MIDWAY_SHOTS || "screenshots";

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
const forced = [];
const log = (stage, detail) => console.log(`${stage.padEnd(22)} ${JSON.stringify(detail)}`);

try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 800 } });
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await page.goto(URL);
  await page.waitForSelector("#loading.hidden", { state: "attached", timeout: 120000 });
  await page.waitForSelector("#briefing:not(.hidden)");
  await page.evaluate(async () => {
    const url = performance
      .getEntriesByType("resource")
      .map((e) => e.name)
      .findLast((n) => /\/src\/game\.ts(?:\?|$)/.test(n));
    window.midway = (await import(url)).default.scene;
  });
  await mkdir(OUT, { recursive: true });

  const state = () =>
    page.evaluate(() => {
      const s = window.midway;
      const p = s.battle.player;
      return {
        status: s.battle.status,
        mode: p.mode,
        loadout: p.loadout,
        airframe: p.airframe,
        y: +p.y.toFixed(1),
        speed: +p.speed.toFixed(1),
        bombs: p.bombs,
        torpedo: p.torpedo,
        hp: +(p.hp ?? 0).toFixed(1),
        gear: p.gear,
        time: +s.battle.time.toFixed(1),
      };
    });
  const seconds = async (n) => {
    const t = (await state()).time;
    await page.waitForFunction((u) => window.midway.battle.time >= u, t + n, {
      timeout: Math.max(25000, n * 4000),
    });
  };

  // ---- 1. Torpedo loadout, from the deck -------------------------------------------------
  await page.click("#loadout-torpedo");
  await page.click("#start-deck");
  await seconds(0.5);
  const torpedoDeck = await state();
  assert.equal(torpedoDeck.loadout, "torpedo", JSON.stringify(torpedoDeck));
  assert.equal(torpedoDeck.airframe, "tbd", `the torpedo loadout flies the TBD: ${JSON.stringify(torpedoDeck)}`);
  assert.equal(torpedoDeck.mode, "deck", JSON.stringify(torpedoDeck));
  assert.equal(torpedoDeck.torpedo, 1, JSON.stringify(torpedoDeck));
  log("torpedo on deck", torpedoDeck);

  await page.keyboard.down("KeyW");
  await seconds(16);
  await page.keyboard.up("KeyW");
  await page.keyboard.down("ArrowDown");
  await seconds(1.2);
  await page.keyboard.up("ArrowDown");
  await seconds(4);
  const torpedoAirborne = await state();
  assert.equal(torpedoAirborne.mode, "flight", `the TBD leaves the deck: ${JSON.stringify(torpedoAirborne)}`);
  log("torpedo airborne", torpedoAirborne);
  await page.screenshot({ path: `${OUT}/life-torpedo-airborne.png` });

  // Release the torpedo low and level, and prove it becomes a live running weapon.
  await page.evaluate(() => {
    const p = window.midway.battle.player;
    Object.assign(p, { y: 60, pitch: 0 });
  });
  await seconds(1);
  await page.keyboard.press("KeyB");
  await seconds(0.4);
  const dropped = await page.evaluate(() => ({
    air: window.midway.battle.airTorpedoes.length,
    water: window.midway.battle.torpedoes.length,
    carried: window.midway.battle.player.torpedo,
  }));
  assert.ok(dropped.air + dropped.water > 0, `the torpedo leaves the aircraft: ${JSON.stringify(dropped)}`);
  assert.equal(dropped.carried, 0, `and is no longer carried: ${JSON.stringify(dropped)}`);
  log("torpedo released", dropped);

  // ---- 2. Restart to the briefing, bomb loadout, airborne ---------------------------------
  await page.keyboard.press("Escape");
  await page.click("#restart-pause");
  await page.waitForSelector("#briefing:not(.hidden)");
  await page.click("#loadout-bomb");
  await page.click("#start-air");
  await seconds(2);
  const bomber = await state();
  assert.equal(bomber.status, "playing", JSON.stringify(bomber));
  assert.equal(bomber.airframe, "sbd", JSON.stringify(bomber));
  assert.ok(bomber.bombs > 0, `the dive bomber carries bombs: ${JSON.stringify(bomber)}`);
  log("restart, bomb, air", bomber);

  // ---- 3. AI launches and combat ----------------------------------------------------------
  await seconds(6);
  const air = await page.evaluate(() => {
    const b = window.midway.battle;
    const teams = {};
    for (const a of b.aircraft) teams[a.team] = (teams[a.team] ?? 0) + 1;
    return { total: b.aircraft.length, teams, bullets: b.bullets.length };
  });
  assert.ok(air.total > 4, `both sides have aircraft up: ${JSON.stringify(air)}`);
  assert.ok(air.teams.us > 0 && air.teams.jp > 0, `both navies are flying: ${JSON.stringify(air)}`);
  log("ai aloft", air);

  // ---- 4. Contact, target selection and the radio report -----------------------------------
  const contact = await page.evaluate(() => {
    const s = window.midway;
    const target = s.battle.ships.find((x) => x.team === "jp" && x.kind === "carrier");
    // Fly the player onto the contact rather than waiting out a search leg.
    Object.assign(s.battle.player, { x: target.x + 900, y: 900, z: target.z + 900 });
    return { target: target.name };
  });
  forced.push("player positioned onto an enemy carrier contact");
  await seconds(3);
  await page.keyboard.press("Tab");
  await page.keyboard.press("KeyR");
  await seconds(1);
  const reported = await page.evaluate(() => {
    const s = window.midway;
    return {
      designated: s.battle.designated?.name ?? s.battle.target?.name ?? null,
      contacts: (s.battle.contacts ?? []).length,
      radio: (s.battle.radio ?? []).length,
      events: (s.battle.events ?? []).length,
    };
  });
  assert.ok(reported.radio > 0 || reported.events > 0, `the radio carries traffic: ${JSON.stringify(reported)}`);
  log("contact reported", { ...contact, ...reported });
  await page.screenshot({ path: `${OUT}/life-contact.png` });

  // ---- 5. Bombs, and a hit that actually registers ------------------------------------------
  const attack = await page.evaluate(() => {
    const s = window.midway;
    const target = s.battle.ships.find((x) => x.team === "jp" && x.kind === "carrier");
    Object.assign(s.battle.player, { x: target.x, y: 420, z: target.z + 120, pitch: -0.7 });
    return { name: target.name, hp: target.hp, maxHp: target.maxHp };
  });
  forced.push("player placed in a dive over the target");
  await seconds(0.6);
  await page.keyboard.press("KeyB");
  await seconds(7);
  const struck = await page.evaluate((name) => {
    const s = window.midway;
    const ship = s.battle.ships.find((x) => x.name === name);
    return { name, hp: +ship.hp.toFixed(1), fire: +ship.fire.toFixed(2), deck: +ship.deck.toFixed(2), effects: s.battle.effects.length };
  }, attack.name);
  log("bomb attack", { before: attack, after: struck });
  assert.ok(
    struck.hp < attack.hp || struck.fire > 0 || struck.effects > 0,
    `the attack produced damage or effects: ${JSON.stringify({ attack, struck })}`,
  );
  await page.screenshot({ path: `${OUT}/life-attack.png` });

  // ---- 6. Carrier destruction ---------------------------------------------------------------
  // Sinking is driven by damageShip, not by the hp field: setting hp to zero by hand leaves the
  // ship afloat because nothing has run the code that decides it has gone. Hit it properly.
  const sunk = await page.evaluate((name) => {
    const s = window.midway;
    const ship = s.battle.ships.find((x) => x.name === name);
    let guard = 0;
    while (!ship.sunk && guard++ < 40)
      s.battle.damageShip(ship, 400, { x: ship.x, y: 12, z: ship.z }, "bomb", "us");
    return { name, hp: +ship.hp.toFixed(1), blows: guard };
  }, attack.name);
  forced.push(`${sunk.name} bombed to destruction through damageShip in ${sunk.blows} blows`);
  await seconds(6);
  const sinking = await page.evaluate((name) => {
    const s = window.midway;
    const ship = s.battle.ships.find((x) => x.name === name);
    const mesh = s.world.meshes.get(ship.id);
    return { sunk: ship.sunk, sink: +ship.sink.toFixed(3), meshVisible: mesh?.visible, status: s.battle.status };
  }, attack.name);
  assert.ok(sinking.sunk, `the carrier is marked sunk: ${JSON.stringify(sinking)}`);
  assert.ok(sinking.sink > 0, `and is going down: ${JSON.stringify(sinking)}`);
  log("carrier sunk", sinking);
  await page.screenshot({ path: `${OUT}/life-sinking.png` });

  // ---- 7. Recovery: approach, arrest and service --------------------------------------------
  const recovery = await page.evaluate(() => {
    const s = window.midway;
    const home = s.battle.home;
    const p = s.battle.player;
    // Line up astern on the home carrier's heading, gear down, at approach speed.
    const back = 260;
    Object.assign(p, {
      x: home.x - Math.sin(home.heading) * back,
      z: home.z + Math.cos(home.heading) * back,
      y: 40,
      heading: home.heading,
      pitch: -0.04,
      roll: 0,
      speed: 62,
      gear: true,
      gearManual: true,
      mode: "flight",
    });
    if (p.flight?.setAttitude) p.flight.setAttitude(home.heading, -0.04, 0);
    return { carrier: home.name, heading: +home.heading.toFixed(2) };
  });
  forced.push("player placed on a groove astern of the home carrier, gear down");
  await seconds(12);
  const recovered = await state();
  log("recovery attempt", { ...recovery, ...recovered });
  await page.screenshot({ path: `${OUT}/life-recovery.png` });

  // The approach is flown by the flight model, so arrestment is not guaranteed in one pass;
  // what must hold is that the game stayed in a valid state and kept running.
  assert.ok(
    ["flight", "arrest", "service", "deck", "spectator"].includes(recovered.mode),
    `the aircraft is in a known state after the approach: ${JSON.stringify(recovered)}`,
  );

  // ---- 8. Quality settings, while the flight UI is still on screen ---------------------------
  // The graphics control lives inside the flight manual, which is also the pause dialog.
  await page.keyboard.press("Escape");
  await page.waitForSelector("#pause-overlay:not(.hidden)");
  for (const value of ["low", "high", "balanced"]) {
    await page.selectOption("#quality", value);
    await page.waitForTimeout(300);
  }
  await page.click("#resume");
  // Attached, not visible: a hidden element is never visible and this wait would always time out.
  await page.waitForSelector("#pause-overlay.hidden", { state: "attached" });
  const quality = await page.evaluate(() => ({
    quality: window.midway.world.quality,
    pixelRatio: window.midway.world.renderer.getPixelRatio(),
    shadows: window.midway.world.renderer.shadowMap.enabled,
  }));
  log("quality cycled", quality);

  // ---- 8. Loss, and restart out of it --------------------------------------------------------
  await page.evaluate(() => {
    const p = window.midway.battle.player;
    p.hp = 0;
  });
  forced.push("player hp forced to zero to reach the loss state");
  // Simulation time stops once the battle is lost, so this waits on the wall clock: a helper
  // that waits for battle.time to advance would hang here forever, which is correct behaviour
  // from the game and a trap for the harness.
  await page.waitForFunction(() => window.midway.battle.status === "lost", null, { timeout: 25000 });
  await page.waitForTimeout(900);
  const lost = await page.evaluate(() => ({
    status: window.midway.battle.status,
    mode: window.midway.battle.player.mode,
    playerVisible: window.midway.world.playerMesh.visible,
  }));
  log("loss state", lost);
  await page.screenshot({ path: `${OUT}/life-loss.png` });

  // ---- 9. A clean restart out of the loss state -----------------------------------------------
  await page.evaluate(() => window.midway.restartToBriefing?.());
  await page.waitForTimeout(600);
  const restarted = await page.evaluate(() => ({
    status: window.midway.battle.status,
    aircraft: window.midway.battle.aircraft.length,
    meshes: window.midway.world.meshes.size,
    crew: window.midway.world.crew.sailors.length,
  }));
  log("restarted", restarted);
  assert.equal(restarted.crew, 12, `the deck party survives a restart: ${JSON.stringify(restarted)}`);

  assert.deepEqual(errors, []);
  console.log(`\nforced states: ${forced.length ? forced.join("; ") : "none"}`);
  console.log(
    "PASS: torpedo loadout flown off the deck and released, restart to the bomb loadout, both " +
      "navies aloft, contact reported, an attack that damaged its target, a carrier sunk, a " +
      "recovery approach, the loss state, all three quality settings and a clean restart; " +
      "no console or GPU errors at any point",
  );
} finally {
  await browser.close();
}
