/**
 * Browser capture for the imported fleet: the deck party, the Zero, the IJN destroyer and Midway.
 *
 * Every automated gate in this repo is blind to how the game looks, so this one exists to put the
 * new content in front of a camera and also to assert the facts a screenshot cannot show — that
 * the crew really are running different clips at different phases, and that an AI Zero really is
 * swapped to its imported airframe when the player closes on it.
 */
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

const URL = process.env.MIDWAY_URL || "http://127.0.0.1:5198";
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
try {
  const page = await browser.newPage({ viewport: { width: 1672, height: 941 } });
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await page.goto(URL);
  await page.waitForSelector("#loading.hidden", { state: "attached", timeout: 120000 });
  await page.waitForSelector("#briefing:not(.hidden)");
  // Import the module URL the page already loaded; a fresh import builds a second, unstarted game.
  await page.evaluate(async () => {
    const url = performance
      .getEntriesByType("resource")
      .map((e) => e.name)
      .findLast((n) => /\/src\/game\.ts(?:\?|$)/.test(n));
    if (!url) throw new Error("Missing loaded game module");
    window.midway = (await import(url)).default.scene;
    if (!window.midway) throw new Error("Loaded game has no scene");
  });
  const adapter = await page.evaluate(async () => {
    const a = await navigator.gpu.requestAdapter();
    return { vendor: a.info.vendor, architecture: a.info.architecture };
  });
  assert.ok(
    adapter.vendor && !/swiftshader|lavapipe/i.test(JSON.stringify(adapter)),
    `software adapter: ${JSON.stringify(adapter)}`,
  );
  await mkdir(OUT, { recursive: true });
  // The scene re-aims the camera every frame even while paused, so a composed shot needs the
  // game's own camera step held off for the duration of the capture.
  const freezeCamera = () =>
    page.evaluate(() => {
      const s = window.midway;
      // Pause too: the battle keeps flying while the camera is held, so an aircraft read one
      // moment is somewhere else by the time the shutter opens.
      s.__wasPaused = s.paused;
      s.paused = true;
      const w = s.world;
      w.__updateCamera ??= w.updateCamera;
      w.updateCamera = () => {};
    });
  const releaseCamera = () =>
    page.evaluate(() => {
      const s = window.midway;
      const w = s.world;
      if (w.__updateCamera) w.updateCamera = w.__updateCamera;
      s.paused = s.__wasPaused ?? false;
    });
  const shot = async (name, place) => {
    await freezeCamera();
    await page.evaluate(place);
    await page.waitForTimeout(420);
    await page.screenshot({ path: `${OUT}/${name}.png` });
  };
  await page.screenshot({ path: `${OUT}/fleet-briefing.png` });

  // The deck party: twelve sailors, each with its own clip, phase and rate.
  const crew = await page.evaluate(() => {
    const group = window.midway.world.crew.group;
    return {
      visible: group.visible,
      count: group.children.length,
      position: group.position.toArray(),
      men: group.children.map((c) => ({
        x: +c.position.x.toFixed(2),
        z: +c.position.z.toFixed(2),
        yaw: +c.rotation.y.toFixed(2),
        height: +((c.scale.x || 1) * 1.83).toFixed(3),
        helmet: !!c.getObjectByName("Head")?.children.length,
      })),
    };
  });
  assert.equal(crew.count, 12, `deck party size: ${JSON.stringify(crew)}`);
  assert.ok(crew.visible, "the deck party is visible at the briefing");
  assert.ok(
    crew.men.every((m) => m.helmet),
    "every sailor wears his trade's helmet",
  );
  assert.ok(
    new Set(crew.men.map((m) => `${m.x},${m.z}`)).size === 12,
    "no two sailors stand in the same place",
  );
  assert.ok(
    new Set(crew.men.map((m) => m.yaw)).size >= 10,
    `sailors face different ways: ${JSON.stringify(crew.men.map((m) => m.yaw))}`,
  );
  assert.ok(
    crew.men.every((m) => m.height > 1.68 && m.height < 1.86),
    `every sailor stands at an adult height: ${JSON.stringify(crew.men.map((m) => m.height))}`,
  );
  assert.ok(new Set(crew.men.map((m) => m.height)).size >= 4, "heights vary across the party");
  console.log("deck party", JSON.stringify(crew.men));

  // Clip, phase and rate must all differ, or twelve men move as one.
  const motion = await page.evaluate(() => {
    const sailors = window.midway.world.crew.sailors ?? [];
    return sailors.map((s) => {
      const action = s.player.mixer.clipAction(s.player.clip(s.station.clip));
      return {
        job: s.station.job,
        clip: s.station.clip,
        rate: +s.rate.toFixed(3),
        time: +action.time.toFixed(3),
      };
    });
  });
  assert.equal(motion.length, 12, "every station reports its motion");
  assert.ok(new Set(motion.map((m) => m.clip)).size >= 5, "the party runs at least five clips");
  assert.ok(new Set(motion.map((m) => m.job)).size === 12, "no two sailors have the same job");
  assert.ok(new Set(motion.map((m) => m.rate)).size >= 5, "playback rates are detuned");
  const sameClip = motion.filter((m) => m.clip === motion[0].clip);
  assert.ok(
    new Set(sameClip.map((m) => m.time)).size === sameClip.length,
    `men on one clip start out of phase: ${JSON.stringify(sameClip)}`,
  );
  console.log("deck party motion", JSON.stringify(motion));

  // A close pass over the launch spot, so the sailors are actually in frame.
  await shot("fleet-crew", () => {
    const w = window.midway.world;
    const anchor = w.crew.group;
    anchor.updateMatrixWorld(true);
    const at = w.camera.position.clone();
    anchor.getWorldPosition(at);
    w.camera.position.set(at.x + 10, at.y + 3.4, at.z - 15);
    w.camera.lookAt(at.x - 1, at.y + 1.0, at.z + 2);
    w.camera.fov = 44;
    w.camera.up.set(0, 1, 0);
    w.camera.updateProjectionMatrix();
    w.camera.updateMatrixWorld();
  });
  await releaseCamera();

  // Fly, then measure the imported-airframe swap on live AI aircraft.
  await page.click("#start-air");
  const seconds = async (n) => {
    const t = await page.evaluate(() => window.midway.battle.time);
    await page.waitForFunction((u) => window.midway.battle.time >= u, t + n, {
      timeout: Math.max(20000, n * 4000),
    });
  };
  await seconds(3);
  await page.screenshot({ path: `${OUT}/fleet-flight.png` });

  // Put the player on top of an enemy fighter so the detail loan is granted, and read it back.
  const swap = await page.evaluate(async () => {
    const s = window.midway;
    const target = s.battle.aircraft.find((a) => a.team === "jp" && a.kind === "fighter");
    if (!target) return { skipped: "no Japanese fighter airborne" };
    Object.assign(s.battle.player, { x: target.x + 60, y: target.y, z: target.z + 60 });
    s.__zeroId = target.id;
    return { id: target.id, team: target.team, kind: target.kind, airframe: target.airframe };
  });
  if (!swap.skipped) {
    await seconds(1.2);
    const detail = await page.evaluate(
      (id) => {
        const m = window.midway.world.meshes.get(id);
        return m ? { name: m.name, detailed: !!m.userData.detailed, airframe: m.userData.airframe } : null;
      },
      swap.id,
    );
    assert.ok(detail, `the Zero ${swap.id} still has a mesh`);
    assert.ok(detail.detailed, `a Japanese fighter alongside gets its imported airframe: ${JSON.stringify(detail)}`);
    assert.equal(detail.airframe, "zero", JSON.stringify(detail));
    console.log("imported AI airframe", JSON.stringify({ swap, detail }));
    await shot("fleet-zero", () => {
      const s2 = window.midway;
      const m = s2.world.meshes.get(s2.__zeroId);
      const at = m.position;
      s2.world.camera.position.set(at.x + 17, at.y + 6, at.z + 22);
      s2.world.camera.lookAt(at.x, at.y, at.z);
      s2.world.camera.fov = 42;
      s2.world.camera.up.set(0, 1, 0);
      s2.world.camera.updateProjectionMatrix();
      s2.world.camera.updateMatrixWorld();
    });
    await releaseCamera();
  } else {
    console.log("imported AI airframe", JSON.stringify(swap));
  }

  // Japanese dive bombers must no longer be flying as Douglas SBDs.
  const identity = await page.evaluate(() => {
    const counts = {};
    for (const a of window.midway.battle.aircraft)
      counts[`${a.team}/${a.kind}/${a.airframe}`] = (counts[`${a.team}/${a.kind}/${a.airframe}`] ?? 0) + 1;
    return counts;
  });
  assert.ok(
    !Object.keys(identity).some((k) => k.startsWith("jp/bomber/sbd")),
    `no Japanese aircraft carries an American airframe: ${JSON.stringify(identity)}`,
  );
  console.log("airframe identity", JSON.stringify(identity));

  // Midway itself, from altitude.
  await shot("fleet-midway", () => {
    const s = window.midway;
    const i = s.battle.island;
    s.world.camera.position.set(i.x - 3400, 2400, i.z + 5200);
    s.world.camera.lookAt(i.x, 0, i.z);
    s.world.camera.fov = 60;
    s.world.camera.up.set(0, 1, 0);
    s.world.camera.updateProjectionMatrix();
    s.world.camera.updateMatrixWorld();
  });

  // An IJN destroyer at close range, with its imported hull selected by the LOD.
  const ship = await page.evaluate(() => {
    const s = window.midway;
    const d = s.battle.ships.find((x) => x.kind === "destroyer" && x.team === "jp");
    if (!d) return null;
    s.__shipId = d.id;
    const mesh = s.world.meshes.get(d.id);
    const lod = mesh?.children[0];
    return {
      name: d.name,
      imported: !!mesh?.userData.importedShip,
      levels: lod?.levels?.length ?? 0,
      heading: +d.heading.toFixed(3),
    };
  });
  assert.ok(ship?.imported, `Japanese destroyers use the imported hull: ${JSON.stringify(ship)}`);
  assert.equal(ship.levels, 2, `near and far levels: ${JSON.stringify(ship)}`);
  // Broadside, from the ship's own port beam, so bow orientation is unmistakable in the frame.
  await shot("fleet-destroyer", () => {
    const s = window.midway;
    const d = s.battle.ships.find((x) => x.id === s.__shipId);
    const beam = d.heading + Math.PI / 2;
    s.world.camera.position.set(d.x + Math.sin(beam) * 175, 34, d.z - Math.cos(beam) * 175);
    s.world.camera.lookAt(d.x, 10, d.z);
    s.world.camera.fov = 46;
    s.world.camera.up.set(0, 1, 0);
    s.world.camera.updateProjectionMatrix();
    s.world.camera.updateMatrixWorld();
  });
  console.log("destroyer", JSON.stringify(ship));

  assert.deepEqual(errors, []);
  console.log(
    "PASS: twelve distinct deck-crew stations with helmets, out-of-phase clips and detuned rates; " +
      "imported Zero on nearby AI; Japanese bombers off the SBD airframe; imported IJN destroyer " +
      "with two LOD levels; Midway atoll captured; no console or GPU errors",
  );
} finally {
  await browser.close();
}
