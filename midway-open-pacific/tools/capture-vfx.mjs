/**
 * The reference-photo composition: an oblique aerial view of a burning ship ringed by
 * near-miss water columns, plus a close side view of the fire itself.
 *
 * No automated gate can tell a convincing water column from a grey puff, so this forces the
 * state and leaves frames a person has to look at. Forced states are listed in the report.
 */
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

const URL = process.env.MIDWAY_URL || "http://localhost:5199";
const OUT = process.env.MIDWAY_SHOTS || "screenshots/vfx";

const browser = await chromium.launch({
  headless: false,
  args: ["--enable-unsafe-webgpu", "--enable-features=Vulkan", "--disable-gpu-sandbox", "--ignore-gpu-blocklist", "--ozone-platform=x11"],
});
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
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

  await page.click("#start-air");
  await seconds(2);

  // Burn a destroyer amidships, exactly as the photograph shows: a single ship under way,
  // fire on the after deck, the rest of the force steaming clear.
  const target = await page.evaluate(() => {
    const b = window.midway.battle;
    const ship = b.ships.find((s) => s.team === "jp" && s.kind === "destroyer" && !s.sunk)
      || b.ships.find((s) => s.team === "jp" && !s.sunk);
    const f = { x: Math.sin(ship.heading), z: -Math.cos(ship.heading) };
    for (const along of [-12, 6]) {
      b.bombs.push({ id: b.id("bomb"), x: ship.x + f.x * along, y: 40, z: ship.z + f.z * along,
        vx: 0, vy: -120, vz: 0, team: "us", owner: "player", age: 0, damage: 90, stamp: null });
    }
    return { name: ship.name, id: ship.id, kind: ship.kind };
  });
  await seconds(6);

  // A stick of near misses walking past her, the way the photo's bracket does.
  await page.evaluate((name) => {
    const b = window.midway.battle;
    const s = b.ships.find((x) => x.name === name);
    const f = { x: Math.sin(s.heading), z: -Math.cos(s.heading) };
    const r = { x: Math.cos(s.heading), z: Math.sin(s.heading) };
    window.__splash = () => {
      for (const [along, beam, size] of [[-90, 40, 3.2], [-40, -55, 2.6], [30, 70, 3.5], [95, -30, 2.9], [140, 55, 3.1]]) {
        b.fx("splash", { x: s.x + f.x * along + r.x * beam, y: 0, z: s.z + f.z * along + r.z * beam }, size);
      }
    };
    window.__splash();
  }, target.name);
  await seconds(1.1);

  // The photograph's own camera: high, oblique, looking down the ship's quarter.
  await page.evaluate((name) => {
    const m = window.midway;
    const s = m.battle.ships.find((x) => x.name === name);
    const f = { x: Math.sin(s.heading), z: -Math.cos(s.heading) };
    const r = { x: Math.cos(s.heading), z: Math.sin(s.heading) };
    m.world.updateCamera = () => {
      const c = m.world.camera;
      c.position.set(s.x - f.x * 420 + r.x * 300, 430, s.z - f.z * 420 + r.z * 300);
      c.up.set(0, 1, 0); c.fov = 50;
      c.lookAt(s.x, 10, s.z);
      c.updateProjectionMatrix(); c.updateMatrixWorld();
      m.world.playerMesh.visible = false;
    };
  }, target.name);
  await seconds(0.6);
  await page.screenshot({ path: `${OUT}/01-aerial.png` });

  // Beam-on and low, where the flame column and the smoke column separate.
  await page.evaluate((name) => {
    const m = window.midway;
    const s = m.battle.ships.find((x) => x.name === name);
    const r = { x: Math.cos(s.heading), z: Math.sin(s.heading) };
    m.world.updateCamera = () => {
      const c = m.world.camera;
      c.position.set(s.x + r.x * 260, 55, s.z + r.z * 260);
      c.up.set(0, 1, 0); c.fov = 46;
      c.lookAt(s.x, 45, s.z);
      c.updateProjectionMatrix(); c.updateMatrixWorld();
      m.world.playerMesh.visible = false;
    };
  }, target.name);
  await seconds(1.2);
  await page.screenshot({ path: `${OUT}/02-fire-beam.png` });

  // One fresh column, close, at the moment it is still rising.
  await page.evaluate((name) => {
    const m = window.midway, b = m.battle;
    const s = b.ships.find((x) => x.name === name);
    const r = { x: Math.cos(s.heading), z: Math.sin(s.heading) };
    const f = { x: Math.sin(s.heading), z: -Math.cos(s.heading) };
    const at = { x: s.x + r.x * 90 + f.x * 40, y: 0, z: s.z + r.z * 90 + f.z * 40 };
    b.fx("splash", at, 3.4);
    window.__at = at;
    m.world.updateCamera = () => {
      const c = m.world.camera;
      c.position.set(at.x + r.x * 210, 45, at.z + r.z * 210);
      c.up.set(0, 1, 0); c.fov = 46;
      c.lookAt(at.x, 40, at.z);
      c.updateProjectionMatrix(); c.updateMatrixWorld();
      m.world.playerMesh.visible = false;
    };
  }, target.name);
  await seconds(0.9);
  await page.screenshot({ path: `${OUT}/03-splash-rising.png` });
  await seconds(1.6);
  await page.screenshot({ path: `${OUT}/04-splash-falling.png` });

  // The column's real extent, from the particles themselves: a screenshot cannot say whether a
  // near miss threw forty metres of water or four hundred, and that was the original defect.
  // It is thrown in open water, well clear of the ship and of the earlier bracket, because
  // every other column and the ship's own steam plume land inside a radius test near the hull.
  await page.evaluate(() => {
    const b = window.midway.battle;
    const at = { x: window.__at.x + 900, y: 0, z: window.__at.z + 900 };
    b.fx("splash", at, 3.4);
    window.__at = at;
  });
  await seconds(1.3);
  const column = await page.evaluate(() => {
    const at = window.__at, fx = window.midway.world.particles;
    // Colour separates the water from the ship's steam plume, which is also kind 4 and is
    // close enough to this column to be swept up by a radius test alone.
    const near = fx.smoke.items.filter((p) => (p.x - at.x) ** 2 + (p.z - at.z) ** 2 < 70 ** 2 && p.kind === 4 && p.color[2] > 0.8);
    const foam = fx.smoke.items.filter((p) => p.kind === 6 && (p.x - at.x) ** 2 + (p.z - at.z) ** 2 < 70 ** 2);
    const spray = fx.smoke.items.filter((p) => (p.x - at.x) ** 2 + (p.z - at.z) ** 2 < 70 ** 2 && p.kind === 2);
    // `size` is the quad's width, so a particle reaches half of it either side of its centre.
    const half = (p) => (p.size + p.growth * p.age) / 2;
    // The stem is measured clear of the collar: the broad low ring of thrown water is meant to
    // be wide, and including it would score every column as a bloom no matter how narrow.
    const stem = near.filter((p) => p.y > 15);
    const radius = Math.max(...stem.map((p) => Math.hypot(p.x - at.x, p.z - at.z) + half(p)));
    return {
      particles: near.length,
      top: +Math.max(...near.map((p) => p.y + half(p))).toFixed(1),
      sprayTop: spray.length ? +Math.max(...spray.map((p) => p.y)).toFixed(1) : null,
      collarAcross: +(2 * Math.max(...near.map((p) => Math.hypot(p.x - at.x, p.z - at.z) + half(p)))).toFixed(1),
      stemAcross: +(radius * 2).toFixed(1),
      foamAcross: +(2 * Math.max(...foam.map((p) => half(p)))).toFixed(1),
    };
  });
  // Cited ranges for a 1000 lb near miss: 30-60 m of water in a stem narrower than it is tall,
  // spray above that, and a foam patch of the order of twenty metres. The numbers are read a
  // second after the peak, so the column is already falling when they are taken.
  assert.ok(column.top > 25 && column.top < 62, `column height: ${JSON.stringify(column)}`);
  assert.ok(column.stemAcross < column.top * 0.75, `column is a stem, not a bloom: ${JSON.stringify(column)}`);
  assert.ok(column.foamAcross > 8 && column.foamAcross < 30, `foam patch: ${JSON.stringify(column)}`);

  // Looking straight down at the isolated column once the water has fallen back: what is left
  // is the foam patch, and this is the only frame that shows whether it renders at all.
  await page.evaluate(() => {
    const m = window.midway, at = window.__at;
    m.world.updateCamera = () => {
      const c = m.world.camera;
      c.position.set(at.x, 190, at.z + 1);
      c.up.set(0, 1, 0); c.fov = 50;
      c.lookAt(at.x, 0, at.z);
      c.updateProjectionMatrix(); c.updateMatrixWorld();
      m.world.playerMesh.visible = false;
    };
  });
  // Three seconds after release: the column is down, the patch is at a third of its life and
  // has not begun to fade. Waiting longer photographs the fade-out, not the foam.
  await seconds(1.8);
  await page.screenshot({ path: `${OUT}/05-foam.png` });

  const adapter = await page.evaluate(async () => {
    const a = await navigator.gpu.requestAdapter();
    return { vendor: a.info.vendor, fallback: a.info.isFallbackAdapter };
  });
  assert.ok(adapter.vendor && !adapter.fallback, JSON.stringify(adapter));
  const particles = await page.evaluate(() => {
    const fx = window.midway.world.particles;
    return { smoke: fx.smoke.items.length, glow: fx.glow.items.length, flames: fx.smoke.items.filter((p) => p.kind === 5).length };
  });
  assert.deepEqual(errors, [], JSON.stringify(errors));
  console.log("vfx", JSON.stringify({ target, adapter, particles, column }));
} finally {
  await browser.close();
}
