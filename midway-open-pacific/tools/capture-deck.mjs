/**
 * The deck-scale question, answered in the view rather than in a table.
 *
 * The recurring complaint is that the flight deck looks too narrow beside the aircraft, and a
 * dimensions table cannot settle that. This raycasts the carrier's own geometry across the beam
 * at the stations the aircraft actually occupies, reports the width it finds in Douglas
 * wingspans, and captures the briefing, the launch point, the deck run and the moment after
 * liftoff from the player's own camera so the framing can be judged.
 */
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

const URL = process.env.MIDWAY_URL || "http://127.0.0.1:5198";
const OUT = process.env.MIDWAY_SHOTS || "screenshots";
const SPAN = 12.66;

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
    const url = performance
      .getEntriesByType("resource")
      .map((e) => e.name)
      .findLast((n) => /\/src\/game\.ts(?:\?|$)/.test(n));
    if (!url) throw new Error("Missing loaded game module");
    window.midway = (await import(url)).default.scene;
  });
  await mkdir(OUT, { recursive: true });

  // Borrow Three from the bundle the page already loaded; a second copy would not share classes.
  const three = await page.evaluate(async () => {
    // Names vary with Vite's dep pre-bundling, so pick by what a module exports, not what it is
    // called: the first already-loaded module that actually has Raycaster is Three itself.
    const urls = performance
      .getEntriesByType("resource")
      .map((e) => e.name)
      .filter((n) => /\.js(\?|$)/.test(n) && /three/i.test(n));
    for (const url of urls) {
      try {
        const mod = await import(url);
        if (mod.Raycaster && mod.Vector3) {
          window.__T = mod;
          return url;
        }
      } catch {
        // A module that will not re-import is simply not the one we need.
      }
    }
    throw new Error(`No loaded module exports Raycaster; tried ${urls.length}: ${urls.join(", ")}`);
  });
  console.log("three module", three);

  // Walk inboard from well outboard until the ray lands on the flight deck surface.
  const report = await page.evaluate((span) => {
    const s = window.midway;
    const T = window.__T;
    const home = s.battle.home;
    const mesh = s.world.meshes.get(home.id);
    const lod = mesh.children[0];
    const detailed = lod.levels ? lod.levels[0].object : lod;
    detailed.updateMatrixWorld(true);
    // Rays are cast in world space, but the stations are named in the ship's own frame and the
    // ship is kilometres away under a heading, so both ends of the ray go through its matrix.
    const down = new T.Vector3(0, -1, 0).transformDirection(mesh.matrixWorld).normalize();
    const deckAt = (probeZ) => {
      const edges = [];
      for (const sign of [-1, 1]) {
        let edge = null;
        for (let x = sign * 40; Math.abs(x) > 0.4; x -= sign * 0.2) {
          const from = new T.Vector3(x, 70, probeZ).applyMatrix4(mesh.matrixWorld);
          const hit = new T.Raycaster(from, down).intersectObject(detailed, true)[0];
          if (!hit) continue;
          // The flight deck sits at 20.06 in the ship's frame; above is the island, below is
          // the hangar deck and the sponsons.
          const local = mesh.worldToLocal(hit.point.clone());
          if (local.y > 19 && local.y < 21.5) {
            edge = +x.toFixed(2);
            break;
          }
        }
        edges.push(edge);
      }
      const [port, starboard] = edges;
      const width = port !== null && starboard !== null ? starboard - port : null;
      return {
        localZ: probeZ,
        port,
        starboard,
        width: width === null ? null : +width.toFixed(2),
        spans: width === null ? null : +(width / span).toFixed(2),
      };
    };
    // Briefing pose, the launch start, mid deck run and the bow.
    return [15, -20, -55, -90].map(deckAt);
  }, SPAN);
  console.log("deck width by station", JSON.stringify(report));
  const usable = report.filter((r) => r.width !== null);
  assert.ok(usable.length >= 3, `the deck was found at most stations: ${JSON.stringify(report)}`);
  for (const row of usable)
    assert.ok(
      row.spans > 1.6,
      `the deck is at least 1.6 Douglas spans wide at z=${row.localZ}: ${JSON.stringify(row)}`,
    );

  // Where the aircraft and the parked deck park actually sit across that width.
  const layout = await page.evaluate(() => {
    const s = window.midway;
    const mesh = s.world.meshes.get(s.battle.home.id);
    const parked = (mesh.userData.parked ?? []).map((p) => ({
      x: +p.position.x.toFixed(2),
      z: +p.position.z.toFixed(2),
      visible: p.visible,
    }));
    return {
      player: {
        x: +s.world.playerMesh.position.x.toFixed(2),
        z: +s.world.playerMesh.position.z.toFixed(2),
      },
      crewAnchor: +s.world.crewAnchor.toFixed(2),
      parked,
    };
  });
  console.log("deck layout", JSON.stringify(layout));

  await page.screenshot({ path: `${OUT}/deck-briefing.png` });
  await page.click("#start-deck");
  const seconds = async (n) => {
    const t = await page.evaluate(() => window.midway.battle.time);
    await page.waitForFunction((u) => window.midway.battle.time >= u, t + n, {
      timeout: Math.max(20000, n * 4000),
    });
  };
  await seconds(0.6);
  await page.screenshot({ path: `${OUT}/deck-launchpoint.png` });

  await page.keyboard.down("KeyW");
  await seconds(7);
  await page.screenshot({ path: `${OUT}/deck-run.png` });
  await seconds(8);
  await page.keyboard.up("KeyW");
  await page.keyboard.down("ArrowDown");
  await seconds(1);
  await page.keyboard.up("ArrowDown");
  await seconds(2.5);
  await page.screenshot({ path: `${OUT}/deck-liftoff.png` });
  const off = await page.evaluate(() => {
    const p = window.midway.battle.player;
    return {
      mode: p.mode,
      y: +p.y.toFixed(2),
      speed: +p.speed.toFixed(1),
      stall: +p.stall.toFixed(3),
    };
  });
  console.log("launch", JSON.stringify(off));
  assert.equal(off.mode, "flight", `the aircraft leaves the deck: ${JSON.stringify(off)}`);
  assert.ok(off.y > 22, `and climbs away rather than settling back: ${JSON.stringify(off)}`);

  // A low pass, which is the altitude the exterior water reference was shot at.
  await page.evaluate(() => {
    const p = window.midway.battle.player;
    Object.assign(p, { y: 92 });
  });
  await seconds(2);
  await page.screenshot({ path: `${OUT}/deck-lowwater.png` });
  const low = await page.evaluate(() => ({
    y: +window.midway.battle.player.y.toFixed(1),
    speed: +window.midway.battle.player.speed.toFixed(1),
  }));
  console.log("low pass", JSON.stringify(low));

  assert.deepEqual(errors, []);
  console.log(
    "PASS: deck width measured from the carrier's own geometry at four stations, deck run and " +
      "liftoff captured, low-altitude water captured, no console errors",
  );
} finally {
  await browser.close();
}
