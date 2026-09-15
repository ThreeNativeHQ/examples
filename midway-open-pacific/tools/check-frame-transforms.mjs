/**
 * Browser regression for the Midway frame scheduling fix: exactly one root scene world-matrix
 * traversal per presented frame, on the real renderer, with correct world transforms after draw.
 *
 * No mocked render: it launches the game, wraps the root `world.scene.updateMatrixWorld` (count +
 * time) and the OUTER `world.renderer.render` (presented frames; nested reflection calls are
 * not counted), then after each outer draw independently recomputes each sampled object's world
 * matrix by walking its ancestors (compose local pose when `matrixAutoUpdate`, else use `matrix`)
 * and compares it with the renderer-updated `matrixWorld`. Sample objects: a ship, the player, an
 * aircraft and one animated bone. Fails if the root-walk-per-frame ratio exceeds 1.1, if a world
 * matrix is non-finite or disagrees with the independent multiply, or on any console/page error.
 *
 * Baseline run (before the fix) is expected to FAIL with ratio ~2-3; that is the regression it
 * guards. Parent runs it behind the game's wrapper:
 *
 *   MIDWAY_URL=http://127.0.0.1:5396 bash tools/capture-lock.sh \
 *     node tools/check-frame-transforms.mjs
 *
 * Env: MIDWAY_URL, MIDWAY_FRAME_OUT (/tmp/midway-flak-hunt/frame), MIDWAY_WARM_MS (3000),
 *      MIDWAY_SAMPLE_MS (3000), MIDWAY_WIDTH/HEIGHT (1400x800).
 */
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright";

const URL = process.env.MIDWAY_URL || "http://127.0.0.1:5396";
const OUT = process.env.MIDWAY_FRAME_OUT || "/tmp/midway-flak-hunt/frame";
const WARM_MS = Number(process.env.MIDWAY_WARM_MS || 3000);
const SAMPLE_MS = Number(process.env.MIDWAY_SAMPLE_MS || 3000);
const WIDTH = Number(process.env.MIDWAY_WIDTH || 1400);
const HEIGHT = Number(process.env.MIDWAY_HEIGHT || 800);
const WALL_CAP_MS = Number(process.env.MIDWAY_FRAME_CAP_MS || 110000);

const browser = await chromium.launch({
  headless: false,
  args: ["--enable-unsafe-webgpu", "--enable-features=Vulkan", "--disable-gpu-sandbox", "--ignore-gpu-blocklist", "--ozone-platform=x11"],
});
const errors = [];
const report = { tool: "check-frame-transforms", url: URL, phases: {} };

try {
  await mkdir(OUT, { recursive: true });
  const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT } });
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });

  let loadedAt;
  await page.goto(URL);
  await page.waitForSelector("#loading.hidden", { state: "attached", timeout: 120000 });
  await page.waitForSelector("#briefing:not(.hidden)");
  loadedAt = Date.now();
  await page.evaluate(async () => {
    const url = performance.getEntriesByType("resource").map((e) => e.name).findLast((n) => /\/src\/game\.ts(?:\?|$)/.test(n));
    window.midway = (await import(url)).default.scene;
  });
  const adapter = await page.evaluate(async () => {
    const a = await navigator.gpu.requestAdapter();
    return a ? { vendor: a.info.vendor, architecture: a.info.architecture } : null;
  });
  assert.ok(adapter && !/swiftshader|lavapipe|llvmpipe|software/i.test(JSON.stringify(adapter)), `hardware WebGPU adapter required: ${JSON.stringify(adapter)}`);
  report.adapter = adapter;
  console.log(`adapter ${JSON.stringify(adapter)}`);

  report.deckReflection = await page.evaluate(async () => {
    const { REFLECTED_LAYER } = await import("/src/render/ocean.ts");
    let nodes = 0, reflected = 0, missingMainLayer = 0, reflectedHulls = 0;
    for (const ship of window.midway.world.meshes.values()) {
      if (ship.layers.isEnabled(REFLECTED_LAYER)) reflectedHulls++;
      for (const planes of [ship.userData.parked ?? [], ship.userData.decor ?? []])
        for (const plane of planes) plane.traverse((o) => {
          nodes++;
          if (o.layers.isEnabled(REFLECTED_LAYER)) reflected++;
          if (!o.layers.isEnabled(0)) missingMainLayer++;
        });
    }
    return { nodes, reflected, missingMainLayer, reflectedHulls };
  });
  assert.ok(report.deckReflection.nodes > 0 && report.deckReflection.reflectedHulls > 0, "deck load and reflected hulls observed");
  assert.equal(report.deckReflection.reflected, 0, "parked/decorative aircraft excluded from the water reflection");
  assert.equal(report.deckReflection.missingMainLayer, 0, "deck load retains the main camera layer");
  console.log(`deck reflection ${JSON.stringify(report.deckReflection)}`);

  await page.evaluate(() => {
    const s = window.midway;
    const w = s.world;
    const scene = w.scene;
    const raw = w.renderer;
    const P = { phase: "boot", phase_: {}, rootWalks: 0, frames: 0, rootMs: [], samples: [], depth: 0 };
    window.__frameCheck = P;

    const origUmw = scene.updateMatrixWorld;
    scene.updateMatrixWorld = function (...args) {
      const t0 = performance.now();
      try {
        return origUmw.apply(this, args);
      } finally {
        P.rootWalks += 1;
        P.rootMs.push(+(performance.now() - t0).toFixed(3));
      }
    };

    P.sampleWorld = () => {
      const M = scene.matrixWorld.constructor;
      const expected = (o) => {
        const chain = [];
        for (let c = o; c; c = c.parent) chain.push(c);
        chain.reverse();
        let e = null;
        for (const n of chain) {
          const local = n.matrixAutoUpdate ? new M().compose(n.position, n.quaternion, n.scale) : n.matrix;
          e = e ? new M().multiplyMatrices(e, local) : local.clone();
        }
        return e;
      };
      const probe = (label, o) => {
        if (!o) return { label, present: false };
        const e = expected(o);
        const a = o.matrixWorld.elements;
        const b = e.elements;
        let diff = 0;
        let finite = true;
        for (let i = 0; i < 16; i += 1) {
          if (!Number.isFinite(a[i]) || !Number.isFinite(b[i])) finite = false;
          diff = Math.max(diff, Math.abs(a[i] - b[i]));
        }
        return { label, present: true, diff: +diff.toFixed(6), finite, m: Array.from(a, (v) => +v.toFixed(4)) };
      };
      const ship = s.battle.ships.find((x) => !x.sunk);
      const air = s.battle.aircraft.find((x) => x.hp > 0);
      const shipMesh = ship && w.meshes.get(ship.id);
      const airMesh = air && w.meshes.get(air.id);
      let bone = null;
      for (const root of [w.crew.group, w.playerMesh, shipMesh, airMesh]) {
        root?.traverse?.((o) => {
          if (!bone && o.isBone) bone = o;
        });
        if (bone) break;
      }
      return {
        t: +s.battle.time.toFixed(2),
        objects: [probe("ship", shipMesh), probe("player", w.playerMesh), probe("aircraft", airMesh), probe("bone", bone)],
      };
    };

    // OUTERMOST raw render only: a nested reflection call returns at depth 1, so `frames` counts
    // presented frames and the post-draw sample runs exactly once per frame.
    const origRender = raw.render;
    raw.render = function (...args) {
      P.depth += 1;
      try {
        return origRender.apply(this, args);
      } finally {
        P.depth -= 1;
        if (P.depth === 0) {
          P.frames += 1;
          P.samples.push(P.sampleWorld());
        }
      }
    };

    P.start = (name) => {
      P.phase = name;
      const rec = (P.phase_ = { name, rootWalks: 0, frames: 0, rootMs: [], samples: [] });
      P.rootWalks = 0;
      P.frames = 0;
      P.rootMs = [];
      P.samples = [];
      return rec;
    };
    P.stop = () => {
      const samples = P.samples;
      const first = samples[0];
      const last = samples[samples.length - 1];
      const changed = first && last ? first.objects.some((o, i) => o.present && last.objects[i].present && o.m.join(",") !== last.objects[i].m.join(",")) : false;
      const maxDiff = samples.reduce((m, s) => s.objects.reduce((n, o) => (o.present ? Math.max(n, o.diff) : n), m), 0);
      const allFinite = samples.every((s) => s.objects.every((o) => !o.present || o.finite));
      return { name: P.phase, rootWalks: P.rootWalks, frames: P.frames, ratio: +(P.rootWalks / Math.max(1, P.frames)).toFixed(4), rootMs: P.rootMs, maxDiff: +maxDiff.toFixed(6), allFinite, changed, samples, objects: first ? first.objects.map((o) => o.label) : [] };
    };
  });

  const measure = async (name) => {
    await page.waitForTimeout(WARM_MS);
    await page.evaluate((n) => window.__frameCheck.start(n), name);
    await page.waitForTimeout(SAMPLE_MS);
    const result = await page.evaluate(() => window.__frameCheck.stop());
    await page.screenshot({ path: join(OUT, `${name}.png`) });
    report.phases[name] = result;
    console.log(
      `${name.padEnd(18)} rootWalks ${result.rootWalks} frames ${result.frames} ratio ${result.ratio} | root walk p95 ${result.rootMs.length ? result.rootMs.slice().sort((a, b) => a - b)[Math.floor(result.rootMs.length * 0.95)] : "n/a"}ms | maxWorldDiff ${result.maxDiff} finite ${result.allFinite} changed ${result.changed}`,
    );
    return result;
  };

  const phases = [];
  phases.push(["briefing", await measure("briefing")]);
  await page.click("#start-deck");
  await page.waitForFunction(() => window.midway.battle.player.mode === "deck", null, { timeout: 60000 });
  phases.push(["deck", await measure("deck")]);
  await page.keyboard.press("Escape");
  await page.click("#restart-pause");
  await page.waitForSelector("#briefing:not(.hidden)");
  await page.click("#start-air");
  await page.keyboard.press("KeyT");
  await page.waitForFunction(() => window.midway.battle.player.mode === "flight", null, { timeout: 30000 });
  for (const [mode, name] of [[1, "airborne-cockpit"], [0, "airborne-chase"], [2, "airborne-wide"]]) {
    await page.evaluate((m) => window.midway.world.setCamera(m), mode);
    phases.push([name, await measure(name)]);
  }

  const elapsed = Date.now() - loadedAt;
  report.elapsedMs = elapsed;
  assert.ok(elapsed < WALL_CAP_MS, `bounded run: ${elapsed}ms exceeds ${WALL_CAP_MS}ms`);

  for (const [name, r] of phases) {
    assert.ok(r.frames > 0, `${name}: rendered frames observed`);
    assert.ok(r.ratio <= 1.1, `${name}: ${r.ratio} root world traversals per presented frame (want <= 1.1)`);
    const required = name === "briefing" ? ["ship", "player", "bone"] : ["ship", "player", "aircraft", "bone"];
    assert.ok(r.samples.every(s => required.every(label => s.objects.some(o => o.label === label && o.present))), `${name}: required probe objects present`);
    assert.ok(r.allFinite, `${name}: every sampled world matrix is finite`);
    assert.ok(r.maxDiff < 1e-3, `${name}: world matrices match the independent ancestor multiply (max diff ${r.maxDiff})`);
  }
  // At least one airborne phase must show motion, so the check cannot pass on a frozen scene.
  assert.ok(phases.some(([name, r]) => name.startsWith("airborne") && r.changed), "airborne transforms change across time");

  assert.deepEqual(errors, [], `browser errors: ${JSON.stringify(errors)}`);
  console.log("PASS: one root world traversal per presented frame, transforms finite and correct, no errors");
} catch (e) {
  errors.push(`FAIL: ${e.message}`);
  throw e;
} finally {
  report.errors = errors;
  await writeFile(join(OUT, "frame-check.json"), JSON.stringify(report, null, 2));
  console.log(`report written to ${join(OUT, "frame-check.json")}`);
  await browser.close();
}
