/**
 * Steady-state frame timing, on a named adapter, at a fixed resolution, under a real workload.
 *
 * No trustworthy figure existed for this game: previous numbers were taken during loading or
 * shader compilation, which measures the wrong thing. This waits for the startup gate, then flies
 * and burns a warm-up before it records anything, and reports the distribution rather than an
 * average — a mean hides exactly the stutters a player notices. It names the GPU it ran on and
 * says what else was drawing at the time, because a benchmark that does not is not evidence.
 *
 * It reports whether the run actually qualifies for AC-23, rather than announcing a pass for any
 * run: the approved workload, the declared population envelope, finite observations, the absolute
 * budgets and a matched baseline are all required before "PASS" is printed. An attribution run
 * (reduced resolution/time, a hidden layer) reports its metrics but is explicitly non-qualifying.
 *
 * Capture against an HMR-disabled server on the same primary source: a hot update mid-sample
 * disposes the renderer and zeroes its metrics. Start one with Vite's JS API, `server.hmr: false`,
 * on a free port, and point MIDWAY_URL at it; never copy the source tree or create a worktree.
 */
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright";

const URL = process.env.MIDWAY_URL || "http://127.0.0.1:5198";
// AC-23 fixes the workload at 1920x1080 for a 60-second sample; the env overrides stay for
// attribution runs, which are reported but never qualify.
const WIDTH = Number(process.env.MIDWAY_WIDTH || 1920);
const HEIGHT = Number(process.env.MIDWAY_HEIGHT || 1080);
const WARMUP = Number(process.env.MIDWAY_WARMUP || 8);
const SAMPLE = Number(process.env.MIDWAY_SAMPLE || 60);
// The crowd fixture fills the battle to ACTIVE_CAP through Battle.launch only, so the sample runs
// at the declared supported population instead of the natural plateau. It is labelled a fixture,
// never a natural battle; no AI/task field, inventory or cap is touched to make it pass.
const CROWD = !!process.env.MIDWAY_CROWD;
// AC-23's approved envelope: the live-aircraft ceiling Battle enforces (`ACTIVE_CAP` in
// src/sim/battle.ts). It is fixed and never env-overridable, because an override could only lower
// the bar. A 30-minute natural run was measured to plateau at 22, so the current natural battle
// does not reach 68 and the run is labelled non-qualifying rather than faked up.
const REQUIRED_AIRCRAFT = 68;
// The warm-up and quality the approved run is defined at. An attribution run may use another, and
// then cannot qualify.
const REQUIRED_WARMUP = 8;
const REQUIRED_QUALITY = "balanced";

/** Fields that must match for a baseline to be a matched baseline. */
const BASELINE_FIELDS = [
  "width",
  "height",
  "pixelRatio",
  "quality",
  "warmup",
  "sample",
  "seed",
  "damage",
  "input",
  "requiredAircraft",
  "hidden",
  "workload",
];

/** The candidate's source identity, so a recorded baseline names the bytes it measured. */
function sourceDigest() {
  const cwd = join(import.meta.dirname, "..");
  try {
    const head = execSync("git rev-parse HEAD", { cwd }).toString().trim();
    const diff = execSync("git diff HEAD -- . ; git ls-files --others --exclude-standard -- .", { cwd }).toString();
    return { head, diffDigest: createHash("sha256").update(diff).digest("hex").slice(0, 12) };
  } catch {
    return { head: null, diffDigest: null };
  }
}

/** A timing series is an observation only if it has samples and a finite p95. */
function isFiniteTiming(s) {
  return !!s && Number.isInteger(s.samples) && s.samples > 0 && Number.isFinite(s.p95);
}

/** Every way `base` fails to match the current run's workload metadata, including missing keys. */
function baselineMismatches(base, current) {
  if (!base || typeof base !== "object") return ["baseline is not an object"];
  const out = [];
  if (JSON.stringify(base.adapter) !== JSON.stringify(current.adapter))
    out.push(`adapter ${JSON.stringify(base.adapter)} != ${JSON.stringify(current.adapter)}`);
  for (const f of BASELINE_FIELDS) {
    if (base[f] === undefined) out.push(`baseline missing ${f}`);
    else if (base[f] !== current[f]) out.push(`${f} ${JSON.stringify(base[f])} != ${JSON.stringify(current[f])}`);
  }
  for (const f of ["gpuP95", "cpuP95"]) if (!Number.isFinite(base[f])) out.push(`baseline ${f} is not finite`);
  // A baseline only matches the qualified workload if it, too, observed the declared population
  // envelope. A baseline recorded at 22 aircraft cannot stand in for a 68-aircraft requirement.
  if (!base.population || !Number.isFinite(base.population.min) || !Number.isFinite(base.population.max))
    out.push("baseline missing population envelope");
  else if (base.population.min < current.requiredAircraft)
    out.push(`baseline observed population ${base.population.min}/${base.population.max} below declared envelope ${current.requiredAircraft}`);
  return out;
}

/**
 * Why a run does not qualify for AC-23, using the fixed approved bar — never the env overrides used
 * for attribution. The population check is on the observed minimum, so one crowded frame cannot
 * qualify a mostly empty sample.
 */
function qualificationReasons(meta, pop, relativePass) {
  const reasons = [];
  if (meta.width !== 1920 || meta.height !== 1080) reasons.push(`resolution ${meta.width}x${meta.height} is not 1920x1080`);
  if (meta.sample !== 60) reasons.push(`sample ${meta.sample}s is not 60s`);
  if (meta.warmup !== REQUIRED_WARMUP) reasons.push(`warm-up ${meta.warmup}s is not the required ${REQUIRED_WARMUP}s`);
  if (meta.quality !== REQUIRED_QUALITY) reasons.push(`quality ${meta.quality} is not the required ${REQUIRED_QUALITY}`);
  if (meta.pixelRatio !== 1) reasons.push(`pixel ratio ${meta.pixelRatio} is not 1`);
  if (meta.hidden) reasons.push(`MIDWAY_HIDE=${meta.hidden} disables a layer`);
  if (!(pop.aircraftMin >= REQUIRED_AIRCRAFT))
    reasons.push(`observed minimum ${pop.aircraftMin} active aircraft below declared envelope ${REQUIRED_AIRCRAFT} across the sample`);
  if (!relativePass) reasons.push("relative \u226410% clause UNVERIFIED");
  return reasons;
}

// A framework-free provable check that the fail-closed decisions above actually reject the
// false-pass cases, including the two qualification loopholes. `--self-check`.
if (process.argv.includes("--self-check")) {
  const cur = {
    adapter: { vendor: "nvidia", architecture: "turing" },
    width: 1920,
    height: 1080,
    pixelRatio: 1,
    quality: "balanced",
    warmup: 8,
    sample: 60,
    seed: 19420604,
    damage: false,
    input: "turn-right + fire",
    requiredAircraft: 68,
    hidden: null,
    workload: "crowd68-fixture",
    population: { min: 68, max: 70 },
    gpuP95: 6.8,
    cpuP95: 0.7,
  };
  assert.deepEqual(baselineMismatches(cur, cur), [], "an identical baseline matches");
  assert.ok(
    baselineMismatches({ ...cur, width: 1280 }, cur).some((r) => r.includes("width")),
    "a different width is rejected",
  );
  const { width: _drop, ...noWidth } = cur;
  assert.ok(
    baselineMismatches(noWidth, cur).some((r) => r.includes("missing width")),
    "a missing width is rejected",
  );
  assert.ok(
    baselineMismatches({ ...cur, cpuP95: NaN }, cur).some((r) => r.includes("cpuP95")),
    "a nonfinite baseline timing is rejected",
  );
  assert.ok(
    baselineMismatches({ ...cur, population: { min: 22, max: 22 } }, cur).some((r) => r.includes("population")),
    "a baseline observed below the declared envelope is rejected",
  );
  assert.ok(
    baselineMismatches({ ...cur, population: undefined }, cur).some((r) => r.includes("missing population")),
    "a baseline with no observed population is rejected",
  );
  assert.ok(
    baselineMismatches({ ...cur, requiredAircraft: 1 }, cur).some((r) => r.includes("requiredAircraft")),
    "a baseline declaring a lowered envelope is rejected",
  );
  assert.ok(
    !isFiniteTiming(null) && !isFiniteTiming({ samples: 0, p95: 1 }) && !isFiniteTiming({ samples: 3, p95: NaN }),
    "missing or nonfinite observations are rejected",
  );
  assert.ok(isFiniteTiming({ samples: 3, p95: 1 }), "a finite observation is accepted");

  const qualMeta = { width: 1920, height: 1080, sample: 60, warmup: 8, quality: "balanced", pixelRatio: 1, hidden: null };
  assert.deepEqual(qualificationReasons(qualMeta, { aircraftMin: 68, aircraftMax: 70 }, true), [], "a fully qualified run passes");
  assert.ok(
    qualificationReasons(qualMeta, { aircraftMin: 3, aircraftMax: 70 }, true).some((r) => r.includes("minimum")),
    "one full-population frame does not qualify a mostly empty sample",
  );
  assert.ok(
    qualificationReasons({ ...qualMeta, warmup: 2 }, { aircraftMin: 68 }, true).some((r) => r.includes("warm-up")),
    "a lowered warm-up does not qualify",
  );
  assert.ok(
    qualificationReasons({ ...qualMeta, quality: "low" }, { aircraftMin: 68 }, true).some((r) => r.includes("quality")),
    "a lowered quality does not qualify",
  );
  assert.ok(
    qualificationReasons(qualMeta, { aircraftMin: 68 }, false).some((r) => r.includes("relative")),
    "a missing relative comparison does not qualify",
  );
  console.log("self-check PASS");
  process.exit(0);
}

// Checkout refs at the start of the run; the digest is not an exact fingerprint of the loaded
// module bytes (a dev server may transform them), and concurrent edits are disclosed below.
const checkoutBefore = sourceDigest();

const browser = await chromium.launch({
  headless: false,
  args: [
    "--enable-unsafe-webgpu",
    "--enable-features=Vulkan",
    "--disable-gpu-sandbox",
    "--ignore-gpu-blocklist",
    "--ozone-platform=x11",
    // Timestamp queries are behind Dawn's unsafe-API flag; without them the only clock available
    // is wall time, and wall time here measures the virtual display, not the game.
    "--enable-dawn-features=allow_unsafe_apis",
  ],
});
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT } });
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

  const adapter = await page.evaluate(async () => {
    const a = await navigator.gpu.requestAdapter();
    return {
      vendor: a.info.vendor,
      architecture: a.info.architecture,
      device: a.info.device,
      description: a.info.description,
    };
  });
  assert.ok(
    !/swiftshader|lavapipe|llvmpipe/i.test(JSON.stringify(adapter)),
    `software adapter, the figure would be meaningless: ${JSON.stringify(adapter)}`,
  );

  // Airborne start puts the battle in progress: aircraft aloft, AI flying, ships under way.
  await page.click("#start-air");
  const seconds = async (n) => {
    const t = await page.evaluate(() => window.midway.battle.time);
    await page.waitForFunction((u) => window.midway.battle.time >= u, t + n, {
      timeout: Math.max(30000, n * 4000),
    });
  };

  // MIDWAY_CROWD is the explicitly labelled population fixture, not a natural battle. It fills to
  // ACTIVE_CAP through the public Battle.launch entry, consuming each carrier's real finite
  // inventory; no aircraft record, task/AI field, inventory count or cap is synthesised, no layer
  // is hidden, and the player keeps its normal flight state and normal input. Only camera framing
  // is decoupled: the game's own `updateCamera` still runs for its side effects, then a fixed
  // observation vantage is applied. Mesh LOD/range visibility stays the game's player-relative
  // decision, so the render counts below are measured from real scene meshes, not positions.
  if (CROWD)
    await page.evaluate((cap) => {
      const b = window.midway.battle;
      const w = window.midway.world;
      const carriers = b.ships.filter((s) => s.kind === "carrier" && !s.sunk && s.air);
      const roles = ["fighter", "bomber", "torpedo"];
      let guard = 0;
      while (b.activeAircraft < cap && guard < 40000) {
        for (const s of carriers) {
          if (b.activeAircraft >= cap) break;
          for (const role of roles) {
            const before = b.activeAircraft;
            b.launch(s, role);
            if (b.activeAircraft > before) break;
          }
        }
        b.step(1 / 60, {});
        guard += 1;
      }
      const air = b.aircraft.filter((a) => a.hp > 0);
      const cx = air.reduce((n, a) => n + a.x, 0) / Math.max(1, air.length);
      const cz = air.reduce((n, a) => n + a.z, 0) / Math.max(1, air.length);
      const orig = w.updateCamera.bind(w);
      w.updateCamera = function (dt, briefing, time) {
        orig(dt, briefing, time);
        this.camera.position.set(cx, 5000, cz + 8000);
        this.camera.up.set(0, 1, 0);
        this.camera.fov = 60;
        this.camera.lookAt(cx, 100, cz);
        this.camera.updateProjectionMatrix();
        this.camera.updateMatrixWorld();
      };
      w.setCamera(2);
    }, REQUIRED_AIRCRAFT);

  // MIDWAY_HIDE names a layer to switch off, so the cost of one can be attributed rather than
  // guessed at. It changes what is measured; a run that uses it is non-qualifying.
  if (process.env.MIDWAY_HIDE)
    await page.evaluate((what) => {
      const w = window.midway.world;
      if (what === "sea") w.sea.visible = false;
      if (what === "ships") for (const [id, m] of w.meshes) if (!id.startsWith("air-")) m.visible = false;
      if (what === "crew") w.crew.group.visible = false;
      if (what === "sky") w.scene.background = null;
    }, process.env.MIDWAY_HIDE);

  // MIDWAY_RATIO shrinks the render target while the window stays the same size, which separates
  // what the GPU is drawing from what the display path costs to present.
  if (process.env.MIDWAY_RATIO)
    await page.evaluate((r) => {
      window.midway.world.renderer.setPixelRatio(Number(r));
    }, process.env.MIDWAY_RATIO);

  // MIDWAY_BURN is the damage workload: every carrier is hit at four real deck points and the
  // player is flown up the wake of the nearest one, so persistent fires and scorch marks are
  // actually on screen while the frame is timed. Benchmarking a clean sky proves nothing about
  // damage rendering. The hits are forced through damageShip, and this is always reported.
  const burning = !!process.env.MIDWAY_BURN;
  if (burning) {
    await page.evaluate(() => {
      const b = window.midway.battle;
      const carriers = b.ships.filter((s) => s.kind === "carrier" && !s.sunk);
      for (const ship of carriers) {
        const f = { x: Math.sin(ship.heading), z: -Math.cos(ship.heading) };
        for (const along of [-80, -25, 30, 75])
          b.damageShip(
            ship,
            55,
            { x: ship.x + f.x * along, y: 20, z: ship.z + f.z * along },
            "bomb",
            ship.team === "us" ? "jp" : "us",
            { owner: "benchmark" },
          );
      }
      const target = carriers.find((s) => s.team === "jp") ?? carriers[0];
      const f = { x: Math.sin(target.heading), z: -Math.cos(target.heading) };
      Object.assign(b.player, {
        x: target.x - f.x * 950,
        y: 320,
        z: target.z - f.z * 950,
        heading: target.heading,
        pitch: 0.02,
        roll: 0,
        vx: f.x * 95,
        vy: 0,
        vz: f.z * 95,
        speed: 95,
        autopilot: false,
      });
      if (b.player.flight?.setAttitude) b.player.flight.setAttitude(target.heading, 0.02, 0);
    });
  }

  // A representative workload: turning, firing, tracers and impacts, not a static camera. The
  // damage workload holds its course instead, so the burning ship stays in frame for both runs.
  await page.keyboard.down("Space");
  if (!burning) await page.keyboard.down("ArrowLeft");
  await seconds(WARMUP);
  if (!burning) {
    await page.keyboard.up("ArrowLeft");
    await page.keyboard.down("ArrowRight");
  }

  const result = await page.evaluate(async (sample) => {
    const s = window.midway;
    const renderer = s.world.renderer;
    // GPU time is the figure that describes the game. Wall time is collected alongside it, but
    // on a virtual display it measures how fast the window can be presented, which is a property
    // of the capture rig and not of the game.
    renderer.trackTimestamp = true;
    // The CPU gate is the cost of one Battle fixed step, not of a frame or of rAF wall spacing.
    // Nothing in the engine reports per-substep Battle time, and extracting it from a frame delta
    // would fold render/update/overlay into it, so time the method itself. A call's exclusive cost
    // is pushed only when it made no recursive call, so each leaf fixed step is measured once and
    // a subdividing parent's aggregate is never charged (it is counted in `substeps` instead).
    const b = s.battle;
    const cpu = [];
    const stack = [];
    let substeps = 0;
    const origStep = b.step;
    b.step = function (dt, input) {
      const frame = { children: 0 };
      if (stack.length) stack[stack.length - 1].children += 1;
      stack.push(frame);
      const t0 = performance.now();
      try {
        return origStep.call(this, dt, input);
      } finally {
        stack.pop();
        const ms = performance.now() - t0;
        if (frame.children === 0) cpu.push(ms);
        else substeps += frame.children;
      }
    };
    const wall = [];
    const gpu = [];
    const pop = {
      aircraftMin: Infinity, aircraftMax: -Infinity, shipsMin: Infinity, shipsMax: -Infinity,
      renderableMin: Infinity, renderableMax: -Infinity, visibleMin: Infinity, visibleMax: -Infinity,
      bulletMax: 0,
    };
    // Honest render evidence, from real scene meshes: `renderable` is the game's own
    // player-relative visibility decision (mesh exists, its whole ancestor chain is visible — the
    // same `range < 18000` rule WorldView applies); `visible` additionally requires the mesh to
    // project inside the camera frustum via Three's own `Vector3.project`. A position-based count
    // would overstate both.
    const cam = s.world.camera;
    const tmp = cam.position.clone();
    const renderable = (a) => {
      const m = s.world.meshes.get(a.id);
      if (!m || !m.visible) return null;
      for (let o = m.parent; o; o = o.parent) if (!o.visible) return null;
      return m;
    };
    const inFrustum = (m) => {
      m.getWorldPosition(tmp);
      tmp.project(cam);
      return tmp.x >= -1 && tmp.x <= 1 && tmp.y >= -1 && tmp.y <= 1 && tmp.z >= -1 && tmp.z <= 1;
    };
    const timeStart = b.time;
    const ammoStart = b.player.ammo ?? null;
    const positions = new Map(b.aircraft.map((a) => [a.id, { x: a.x, y: a.y, z: a.z }]));
    await new Promise((resolve) => {
      let last = performance.now();
      const stop = last + sample * 1000;
      const tick = async (now) => {
        wall.push(now - last);
        last = now;
        const liveAircraft = b.activeAircraft;
        const liveShips = b.ships.reduce((n, x) => n + (!x.sunk ? 1 : 0), 0);
        let renderableNow = 0;
        let visibleNow = 0;
        for (const a of b.aircraft) {
          if (a.hp <= 0) continue;
          const m = renderable(a);
          if (!m) continue;
          renderableNow += 1;
          if (inFrustum(m)) visibleNow += 1;
        }
        pop.aircraftMin = Math.min(pop.aircraftMin, liveAircraft);
        pop.aircraftMax = Math.max(pop.aircraftMax, liveAircraft);
        pop.shipsMin = Math.min(pop.shipsMin, liveShips);
        pop.shipsMax = Math.max(pop.shipsMax, liveShips);
        pop.renderableMin = Math.min(pop.renderableMin, renderableNow);
        pop.renderableMax = Math.max(pop.renderableMax, renderableNow);
        pop.visibleMin = Math.min(pop.visibleMin, visibleNow);
        pop.visibleMax = Math.max(pop.visibleMax, visibleNow);
        pop.bulletMax = Math.max(pop.bulletMax, b.bullets.length);
        try {
          await renderer.resolveTimestampsAsync("render");
          const t = renderer.info.render.timestamp;
          if (t > 0) gpu.push(t);
        } catch {
          // No timestamp-query support; the gpu series stays empty and is reported as such.
        }
        if (now < stop) requestAnimationFrame(tick);
        else resolve();
      };
      requestAnimationFrame(tick);
    });
    wall.shift();
    b.step = origStep;
    let moved = 0;
    for (const a of b.aircraft) {
      const p0 = positions.get(a.id);
      if (p0 && Math.hypot(a.x - p0.x, a.y - p0.y, a.z - p0.z) > 100) moved += 1;
    }
    const advance = { seconds: +(b.time - timeStart).toFixed(1), moved, ammoStart, ammoEnd: b.player.ammo ?? null };
    const stats = (series) => {
      if (!series.length) return null;
      const sorted = [...series].sort((a, b) => a - b);
      const at = (q) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))];
      return {
        samples: sorted.length,
        p50: +at(0.5).toFixed(2),
        p95: +at(0.95).toFixed(2),
        p99: +at(0.99).toFixed(2),
        worst: +sorted[sorted.length - 1].toFixed(2),
      };
    };
    return {
      wall: stats(wall),
      gpu: stats(gpu),
      cpu: stats(cpu),
      substeps,
      draws: renderer.info.render.drawCalls,
      triangles: renderer.info.render.triangles,
      memory: { ...renderer.info.memory },
      heap: performance.memory?.usedJSHeapSize ?? null,
      pop,
      advance,
      seed: b.seed,
      scene: {
        aircraft: b.aircraft.length,
        airborne: b.aircraft.filter((a) => a.mode !== "launch").length,
        ships: b.ships.filter((x) => !x.sunk).length,
        bullets: b.bullets.length,
        meshes: s.world.meshes.size,
        quality: s.world.quality,
        pixelRatio: renderer.getPixelRatio(),
      },
    };
  }, SAMPLE);
  await page.keyboard.up("Space");
  if (!burning) await page.keyboard.up("ArrowRight");
  if (process.env.MIDWAY_FRAME) {
    await page.screenshot({ path: process.env.MIDWAY_FRAME });
    console.log(`frame saved to ${process.env.MIDWAY_FRAME}`);
  }
  const damage = await page.evaluate(() => {
    const b = window.midway.battle;
    let impacts = 0;
    let scars = 0;
    let fires = 0;
    for (const ship of b.ships) {
      impacts += (ship.impacts ?? []).length;
      if (ship.fire > 0.06) fires += 1;
      scars += (window.midway.world.meshes.get(ship.id)?.userData?.shipScars ?? []).filter((m) => m.visible).length;
    }
    return { impacts, scars, burningShips: fires };
  });

  const meta = {
    adapter,
    width: WIDTH,
    height: HEIGHT,
    pixelRatio: result.scene.pixelRatio,
    quality: result.scene.quality,
    warmup: WARMUP,
    sample: SAMPLE,
    seed: result.seed,
    damage: burning,
    input: burning ? "course-held + fire" : "turn-right + fire",
    requiredAircraft: REQUIRED_AIRCRAFT,
    hidden: process.env.MIDWAY_HIDE || null,
    workload: CROWD ? "crowd68-fixture" : "natural",
    source: (() => {
      const after = sourceDigest();
      return {
        headBefore: checkoutBefore.head,
        headAfter: after.head,
        diffBefore: checkoutBefore.diffDigest,
        diffAfter: after.diffDigest,
        concurrentChange: checkoutBefore.head !== after.head || checkoutBefore.diffDigest !== after.diffDigest,
      };
    })(),
  };

  const fps = (ms) => +(1000 / ms).toFixed(1);
  console.log(`workload: ${CROWD ? "crowd68 fixture (Battle.launch to cap)" : burning ? "burning carriers, course held" : "crowded battle, turning"} ${JSON.stringify(damage)}`);
  console.log(`workload metadata: ${JSON.stringify(meta)}`);
  console.log(
    "adapter " + JSON.stringify(adapter) + "\n" +
      `resolution ${WIDTH}x${HEIGHT} at pixel ratio ${result.scene.pixelRatio}, quality ${result.scene.quality}\n` +
      `scene ${JSON.stringify(result.scene)}\n` +
      `active aircraft min/max ${result.pop.aircraftMin}/${result.pop.aircraftMax}, renderable meshes ${result.pop.renderableMin}/${result.pop.renderableMax}, in-frustum ${result.pop.visibleMin}/${result.pop.visibleMax}, ships ${result.pop.shipsMin}/${result.pop.shipsMax}\n` +
      `advancing ${result.advance.seconds}s of sim, ${result.advance.moved}/${result.pop.aircraftMax} actors moved >100m, bullets seen ${result.pop.bulletMax}, ammo ${result.advance.ammoStart}->${result.advance.ammoEnd}\n` +
      `draw calls ${result.draws}, triangles ${result.triangles}, memory ${JSON.stringify(result.memory)}, jsHeap ${result.heap}\n` +
      `gpu ${result.gpu ? `median ${result.gpu.p50}ms (${fps(result.gpu.p50)} fps) | p95 ${result.gpu.p95}ms | p99 ${result.gpu.p99}ms | worst ${result.gpu.worst}ms over ${result.gpu.samples} frames` : "unavailable: this build has no timestamp-query support"}\n` +
      `battle fixed-step cpu (leaf steps) ${result.cpu ? `p50 ${result.cpu.p50}ms | p95 ${result.cpu.p95}ms | p99 ${result.cpu.p99}ms | worst ${result.cpu.worst}ms over ${result.cpu.samples} steps; ${result.substeps} subdivided child calls` : "unavailable: no Battle.step observations"}\n` +
      `wall median ${result.wall.p50}ms | p95 ${result.wall.p95}ms  ` +
      "(presentation-bound on a virtual display; not a statement about the game)",
  );
  assert.deepEqual(errors, []);
  // Missing or nonfinite observations are failures, not zeroes.
  assert.ok(isFiniteTiming(result.gpu), `GPU observations resolved and finite: ${JSON.stringify(result.gpu)}`);
  assert.ok(isFiniteTiming(result.cpu), `Battle fixed-step CPU observations resolved and finite: ${JSON.stringify(result.cpu)}`);
  assert.ok(
    result.scene.aircraft > 0 && result.scene.ships > 0,
    `the sample has a live population: ${JSON.stringify(result.scene)}`,
  );
  // A disposed or torn-down renderer reports zero draws and zero memory; that is a missing
  // observation, not a fast frame, and it must not be reported as a result.
  assert.ok(
    result.draws > 0 && result.triangles > 0,
    `render observations present: ${result.draws} draws, ${result.triangles} triangles`,
  );
  assert.ok(result.memory.total > 0, `memory observation present: ${JSON.stringify(result.memory)}`);
  // The sample must be a running battle, not a frozen frame: the simulation clock advanced and
  // live actors changed position. This fails if a fixture ever disables gameplay to look calm.
  assert.ok(result.advance.seconds > SAMPLE * 0.5, `simulation advanced across the sample: ${result.advance.seconds}s`);
  assert.ok(result.advance.moved > 0, `live actors advanced across the sample: ${result.advance.moved} moved`);
  // The AC-23 absolute budgets are checked on the distributions, not on an average. A failing
  // absolute target is an explicit performance gap; it cannot be excused by a relative pass.
  assert.ok(result.gpu.p95 <= 16.7, `GPU p95 at or under 16.7ms: ${result.gpu.p95}ms`);
  assert.ok(result.cpu.p95 <= 4, `Battle fixed-step CPU p95 at or under 4ms: ${result.cpu.p95}ms`);

  // The relative clause of AC-23 compares a matched run on the same named adapter. The baseline is
  // a recorded figure, never an empty workspace: MIDWAY_BASELINE points at a JSON file this tool
  // wrote, and every workload field must match before its timings are compared. MIDWAY_BASELINE_OUT
  // writes this run out for the next comparison.
  let relative = "UNVERIFIED";
  if (process.env.MIDWAY_BASELINE) {
    const base = JSON.parse(await readFile(process.env.MIDWAY_BASELINE, "utf8"));
    const mismatches = baselineMismatches(base, meta);
    assert.deepEqual(mismatches, [], `matched baseline required: ${mismatches.join("; ")}`);
    for (const [metric, value] of [["gpuP95", result.gpu.p95], ["cpuP95", result.cpu.p95]])
      assert.ok(
        value <= base[metric] * 1.1,
        `${metric} regression over 10% against matched baseline: ${value}ms vs ${base[metric]}ms`,
      );
    relative = "PASS";
  }
  console.log(`relative: ${relative}${relative === "PASS" ? " (within 10% of the matched baseline)" : " (no matched baseline supplied via MIDWAY_BASELINE)"}`);
  if (process.env.MIDWAY_BASELINE_OUT) {
    await writeFile(
      process.env.MIDWAY_BASELINE_OUT,
      JSON.stringify({ ...meta, gpuP95: result.gpu.p95, cpuP95: result.cpu.p95, population: { min: result.pop.aircraftMin, max: result.pop.aircraftMax } }, null, 2),
    );
    console.log(`baseline written to ${process.env.MIDWAY_BASELINE_OUT}`);
  }

  const reasons = qualificationReasons(meta, result.pop, relative === "PASS");
  if (reasons.length) {
    console.log(`AC-23 NON-QUALIFYING: ${reasons.join("; ")}`);
    if (process.env.MIDWAY_REQUIRE_QUALIFIED) assert.fail(`AC-23 not qualified: ${reasons.join("; ")}`);
  } else {
    console.log("PASS: AC-23 workload, declared population, absolute budgets and matched-baseline comparison all met");
  }
} finally {
  await browser.close();
}
