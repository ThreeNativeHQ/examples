/**
 * Flak-freeze / tracer-line diagnostic probe (diagnostic only; edits no game source).
 *
 * The report under investigation: a multi-second freeze, then "enormous thin tracer lines" and
 * slowdown during flak bursts. `src/render/world.ts::updateProjectiles` writes one LineSegments
 * vertex pair per `battle.bullets` entry with a segment length of `|v| * 0.012` (0.02 for flak),
 * so an anomalous tracer length means either a non-finite/huge velocity on a projectile or a
 * stale/overrun tracer buffer. This probe measures both sides plus the CPU and GPU cost of the
 * phases around them.
 *
 * Phases, each a warm-up then a wall sample (env-tunable), on the airborne battle with the cockpit
 * vantage the report comes from:
 *   A quiet-natural       the live battle, nothing injected.
 *   B flak-fixture        controlled repeated flak bursts via `battle.fx("flak", …)` plus real
 *                         `type:"flak"` projectiles pushed through the same fields gunnery.ts uses.
 *   C flak-no-particles   the same injection with the particle batches hidden, separating particle
 *                         pixel cost from tracer/CPU cost.
 *   D stall               a deliberate main-thread stall, a screenshot immediately after, and the
 *                         tracer/projectile buffer sanity snapshot before and after.
 *
 * This is a FIXTURE probe, not an AC-23 measurement: B/C inject synthetic projectiles and effects,
 * and the player is held alive by a labelled safety hook. The percentile here is diagnostic only.
 * Run it behind the game's capture wrapper:
 *
 *   MIDWAY_URL=http://127.0.0.1:5396 bash tools/capture-lock.sh \
 *     node tools/capture-flak-hunt.mjs
 *
 * Env: MIDWAY_URL, MIDWAY_OUT (/tmp/midway-flak-hunt), MIDWAY_WARM_MS (5000),
 *      MIDWAY_SAMPLE_MS (12000), MIDWAY_CAMERA (1 cockpit), MIDWAY_FLAK_INTERVAL (0.2 sim s),
 *      MIDWAY_FLAK_COUNT (5 per burst), MIDWAY_STALL_MS (2500), MIDWAY_WIDTH/HEIGHT.
 *      MIDWAY_MATRIX_COMPARE=1 runs the frozen static matched fixture through ABBA
 *      current/once/once/current matrices stages (diagnostic prototype, not shipped engine
 *      semantics; onBeforeRender/onAfterRender compatibility is unresolved).
 */
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright";

const URL = process.env.MIDWAY_URL || "http://127.0.0.1:5396";
const OUT = process.env.MIDWAY_OUT || "/tmp/midway-flak-hunt";
const WARM_MS = Number(process.env.MIDWAY_WARM_MS || 5000);
const SAMPLE_MS = Number(process.env.MIDWAY_SAMPLE_MS || 12000);
const CAMERA = Number(process.env.MIDWAY_CAMERA || 1);
const FLAK_INTERVAL = Number(process.env.MIDWAY_FLAK_INTERVAL || 0.2);
const FLAK_COUNT = Number(process.env.MIDWAY_FLAK_COUNT || 5);
const STALL_MS = Number(process.env.MIDWAY_STALL_MS || 2500);
const WIDTH = Number(process.env.MIDWAY_WIDTH || 1600);
const HEIGHT = Number(process.env.MIDWAY_HEIGHT || 900);

/** Diagnostic nearest-rank percentile; not the perf harness rule and labelled as such. */
const stats = (arr) => {
  const raw = (arr || []).map(Number);
  const a = raw.filter(Number.isFinite).sort((x, y) => x - y);
  if (!a.length) return { samples: raw.length, nonFinite: raw.length };
  const q = (p) => a[Math.min(a.length - 1, Math.max(0, Math.round((a.length - 1) * p)))];
  return {
    samples: raw.length,
    finite: a.length,
    nonFinite: raw.length - a.length,
    min: +a[0].toFixed(3),
    p50: +q(0.5).toFixed(3),
    p95: +q(0.95).toFixed(3),
    p99: +q(0.99).toFixed(3),
    max: +a[a.length - 1].toFixed(3),
  };
};
const fmt = (s) => (s && s.samples ? s.p95 : "n/a");

const browser = await chromium.launch({
  headless: false,
  args: [
    "--enable-unsafe-webgpu",
    "--enable-features=Vulkan",
    "--disable-gpu-sandbox",
    "--ignore-gpu-blocklist",
    "--ozone-platform=x11",
    "--enable-dawn-features=allow_unsafe_apis",
  ],
});
const errors = [];
const report = { tool: "capture-flak-hunt", fixture: true, url: URL, phases: {} };

try {
  await mkdir(OUT, { recursive: true });
  const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT } });
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });

  await page.goto(URL);
  await page.waitForSelector("#loading.hidden", { state: "attached", timeout: 180000 });
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
    return a ? { vendor: a.info.vendor, architecture: a.info.architecture, device: a.info.device, description: a.info.description } : null;
  });
  assert.ok(
    adapter && !/swiftshader|lavapipe|llvmpipe|software/i.test(JSON.stringify(adapter)),
    `hardware WebGPU adapter required: ${JSON.stringify(adapter)}`,
  );
  report.adapter = adapter;
  report.pixelRatio = await page.evaluate(() => window.devicePixelRatio);
  console.log(`adapter ${JSON.stringify(adapter)}, viewport ${WIDTH}x${HEIGHT} dpr ${report.pixelRatio}`);

  // Airborne start, then the cockpit vantage the report comes from. The game's own updateCamera
  // keeps running; nothing replaces it.
  await page.click("#start-air");
  await page.waitForFunction(() => window.midway.battle.status !== "briefing", null, { timeout: 60000 });
  await page.evaluate((mode) => window.midway.world.setCamera(mode), CAMERA);
  await page.keyboard.press("KeyT");

  // One persistent instrumentation pass. Timing wrappers are outermost-call charged, exactly as
  // capture-performance.mjs does, so a re-entrant renderer.render is counted once.
  const installed = await page.evaluate(() => {
    const s = window.midway;
    const b = s.battle;
    const w = s.world;
    const r = w.renderer;

    const P = {
      phase: "boot",
      series: {},
      ring: {},
      longTasks: {},
      gpu: {},
      fixture: { label: "synthetic-flak-bursts", injections: 0, syntheticBullets: 0, fxBursts: 0, hidden: false },
    };
    window.__probe = P;

    // A small RAF ring, kept so a transient stall shows as one huge interval beside its cause.
    let prev = performance.now();
    const rAF = () => {
      const now = performance.now();
      const arr = P.ring[P.phase];
      if (arr) {
        arr.push(+(now - prev).toFixed(2));
        if (arr.length > 900) arr.shift();
      }
      prev = now;
      requestAnimationFrame(rAF);
    };
    requestAnimationFrame(rAF);
    try {
      new PerformanceObserver((list) => {
        const arr = (P.longTasks[P.phase] ||= []);
        for (const e of list.getEntries()) arr.push({ start: +e.startTime.toFixed(1), dur: +e.duration.toFixed(1) });
      }).observe({ entryTypes: ["longtask"] });
    } catch {
      // longtask is not universally supported; the RAF ring still catches the gap.
    }

    const wrap = (owner, key, name) => {
      const original = owner[key];
      let depth = 0;
      owner[key] = function (...args) {
        depth += 1;
        const outer = depth === 1;
        const t0 = outer ? performance.now() : 0;
        try {
          return original.apply(this, args);
        } finally {
          depth -= 1;
          const rec = P.series[P.phase];
          if (outer && rec && rec[name]) {
            const elapsed = performance.now() - t0;
            rec[name].push(+elapsed.toFixed(3));
            if (name === "sceneUpdate") P.pendingScene += elapsed;
            if (name === "render") {
              rec.frameCpu.push(+(P.pendingScene + elapsed).toFixed(3));
              P.pendingScene = 0;
            }
          }
        }
      };
      return () => {
        owner[key] = original;
      };
    };

    P.installSafety = () => {
      b.player.hp = 100000;
      const orig = b.step;
      b.step = function (dt, input) {
        const out = orig.call(this, dt, input);
        const p = this.player;
        if (p) {
          if (!(p.hp >= 50000)) p.hp = 100000;
          if (p.mode === "flight" && Number.isFinite(p.y) && p.y < 250) {
            p.y = 250;
            p.vy = 0;
          }
        }
        return out;
      };
      return () => {
        b.step = orig;
      };
    };

    P.installFixture = (opts) => {
      const interval = opts.interval;
      const count = opts.count;
      const orig = b.step;
      let next = Math.ceil(b.time / interval) * interval;
      b.step = function (dt, input) {
        const out = orig.call(this, dt, input);
        if (this.time >= next) {
          next += interval;
          const p = this.player;
          const h = Number.isFinite(p.heading) ? p.heading : 0;
          const f = { x: Math.sin(h), z: -Math.cos(h) };
          const py = Number.isFinite(p.y) ? p.y : 300;
          for (let i = 0; i < count; i += 1) {
            const ahead = 500 + this.random() * 900;
            const side = (this.random() - 0.5) * 700;
            const burst = {
              x: p.x + f.x * ahead - f.z * side,
              y: py + (this.random() - 0.5) * 300,
              z: p.z + f.z * ahead + f.x * side,
            };
            const dx = burst.x - p.x;
            const dy = burst.y - (py - 100);
            const dz = burst.z - p.z;
            const len = Math.hypot(dx, dy, dz) || 1;
            // The exact flak projectile gunnery.ts pushes: type "flak", 680 m/s, ttl = range/speed.
            this.bullets.push({
              id: this.id("flak"),
              x: p.x,
              y: py - 100,
              z: p.z,
              vx: (dx / len) * 680,
              vy: (dy / len) * 680,
              vz: (dz / len) * 680,
              team: "jp",
              owner: "fixture",
              ttl: len / 680,
              type: "flak",
            });
            P.fixture.syntheticBullets += 1;
          }
          this.fx("flak", { x: p.x + f.x * 700, y: py, z: p.z + f.z * 700 }, 1.5);
          P.fixture.injections += 1;
          P.fixture.fxBursts += 1;
        }
        return out;
      };
      return () => {
        b.step = orig;
      };
    };

    P.setParticles = (visible) => {
      w.particles.smokeBatch.mesh.visible = visible;
      w.particles.glowBatch.mesh.visible = visible;
      P.fixture.hidden = !visible;
    };

    P.start = (name) => {
      P.phase = name;
      P.pendingScene = 0;
      P.series[name] = { frameCpu: [], sceneUpdate: [], worldUpdate: [], render: [], battleStep: [], updateProjectiles: [], particlesUpdate: [], sceneMatrix: [], keptUpdate: [] };
      P.ring[name] = [];
      P.longTasks[name] = [];
      P.gpu[name] = [];
    };

    P.renderSnapshot = () => ({
      draws: r.info.render.drawCalls,
      triangles: r.info.render.triangles,
      memory: { ...r.info.memory },
      pixelRatio: r.getPixelRatio(),
      backend: r.backend?.constructor?.name ?? r.constructor.name,
      cameraMode: s.world.cameraMode,
      status: b.status,
      time: +b.time.toFixed(2),
      aircraft: b.activeAircraft,
      bullets: b.bullets.length,
      effects: b.effects.length,
      particles: { smoke: w.particles.smokeBatch.geometry.instanceCount, glow: w.particles.glowBatch.geometry.instanceCount },
      player: { hp: b.player.hp, y: +b.player.y.toFixed(1), mode: b.player.mode },
    });

    // The sanity check the report needs: what the tracer buffer actually holds, and what the
    // projectile velocities imply for the next write. Segment length comes from the CPU Float32Array
    // the LineSegments geometry owns, not from a render.
    P.tracerSnapshot = () => {
      const g = w.tracers.geometry;
      const pos = g.attributes.position.array;
      const segs = Math.floor((g.drawRange.count || 0) / 2);
      let finite = 0;
      let nonFinite = 0;
      let degenerate = 0;
      let maxLen = 0;
      let minLen = Infinity;
      let sumLen = 0;
      for (let i = 0; i < segs; i += 1) {
        const k = i * 6;
        const v = [pos[k], pos[k + 1], pos[k + 2], pos[k + 3], pos[k + 4], pos[k + 5]];
        if (!v.every(Number.isFinite)) {
          nonFinite += 1;
          continue;
        }
        finite += 1;
        const L = Math.hypot(v[0] - v[3], v[1] - v[4], v[2] - v[5]);
        if (L < 1e-6) degenerate += 1;
        if (L > maxLen) maxLen = L;
        if (L < minLen) minLen = L;
        sumLen += L;
      }
      let bulletsNonFinite = 0;
      let maxSpeed = 0;
      let maxExpected = 0;
      let flakBullets = 0;
      for (const a of b.bullets) {
        const v = Math.hypot(a.vx, a.vy, a.vz);
        if (![a.x, a.y, a.z, a.vx, a.vy, a.vz].every(Number.isFinite)) bulletsNonFinite += 1;
        if (a.type === "flak") flakBullets += 1;
        if (v > maxSpeed) maxSpeed = v;
        const L = v * (a.type === "flak" ? 0.02 : 0.012);
        if (L > maxExpected) maxExpected = L;
      }
      return {
        geometry: g.type,
        drawRange: { start: g.drawRange.start, count: g.drawRange.count },
        attributeVertices: g.attributes.position.count,
        arrayFloats: pos.length,
        capacitySegments: pos.length / 6,
        segmentsDrawn: segs,
        finiteSegments: finite,
        nonFiniteSegments: nonFinite,
        degenerateSegments: degenerate,
        maxSegmentLength: +maxLen.toFixed(3),
        minSegmentLength: finite ? +minLen.toFixed(3) : null,
        meanSegmentLength: finite ? +(sumLen / finite).toFixed(3) : null,
        bullets: b.bullets.length,
        flakBullets,
        bulletsNonFinite,
        maxBulletSpeed: +maxSpeed.toFixed(3),
        maxExpectedTracerLength: +maxExpected.toFixed(3),
        effects: b.effects.length,
      };
    };

    // Diagnostic prototype for MIDWAY_MATRIX_COMPARE: one root world update per presented frame.
    // Installed BEFORE the render timer below so the timer is outermost and the KEPT update's cost
    // is inside it. Gated on enabled and on the scene still wanting auto-update; the saved flag is
    // restored in finally so a nested pass or a throw can never see a false it did not receive.
    P.matrixOnce = false;
    const engineRender = r.render;
    r.render = function (scene, camera) {
      if (!P.matrixOnce || !scene || scene.matrixWorldAutoUpdate !== true) return engineRender.call(this, scene, camera);
      const saved = scene.matrixWorldAutoUpdate;
      const t0 = performance.now();
      scene.updateMatrixWorld();
      const rec = P.series[P.phase];
      if (rec) rec.keptUpdate.push(+(performance.now() - t0).toFixed(3));
      scene.matrixWorldAutoUpdate = false;
      try {
        return engineRender.call(this, scene, camera);
      } finally {
        scene.matrixWorldAutoUpdate = saved;
      }
    };

    // Wrap the leaf renderer writers the report names, plus the outer scene/step costs.
    P.undo = [
      wrap(s, "update", "sceneUpdate"),
      wrap(w, "update", "worldUpdate"),
      wrap(w.scene, "updateMatrixWorld", "sceneMatrix"),
      wrap(r, "render", "render"),
      wrap(w, "updateProjectiles", "updateProjectiles"),
      wrap(w.particles, "update", "particlesUpdate"),
      wrap(b, "step", "battleStep"),
    ];

    return true;
  });
  assert.ok(installed, "instrumentation installed");

  // Safety first, so the fixture and the timing wrapper nest around a live player. A block body so
  // Playwright never tries to serialise the undo function back across the CDP boundary.
  await page.evaluate(() => {
    window.__probe.installSafety();
  });

  // GPU timing only if this renderer answers timestamp queries; otherwise the series stays empty
  // and is reported as unavailable rather than as a zero.
  const gpuSupported = await page.evaluate(async () => {
    const r = window.midway.world.renderer;
    try {
      r.trackTimestamp = true;
      await r.resolveTimestampsAsync("render");
      return true;
    } catch {
      return false;
    }
  });
  report.gpuTimestamps = gpuSupported;
  console.log(`gpu timestamp queries: ${gpuSupported ? "available" : "unavailable"}`);

  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Profiler.enable");
  await cdp.send("Profiler.setSamplingInterval", { interval: 1000 });

  /**
   * One phase: warm, optional fixture + particle visibility, a CDP-profiled wall sample that also
   * records per-frame GPU timestamps, then the reduced metrics plus a before/after tracer snapshot.
   */
  const runPhase = async (name, { fixture = null, hideParticles = false, sampleMs = SAMPLE_MS, profile = true } = {}) => {
    await page.evaluate((hide) => window.__probe.setParticles(!hide), hideParticles);
    if (fixture)
      await page.evaluate((opts) => {
        window.__probe.__fixtureUndo = window.__probe.installFixture(opts);
      }, fixture);
    await page.waitForTimeout(WARM_MS);
    await page.evaluate((p) => window.__probe.start(p), name);
    if (profile) await cdp.send("Profiler.start");
    await page.evaluate(async (ms) => {
      const r = window.midway.world.renderer;
      const t0 = performance.now();
      await new Promise((resolve) => {
        const tick = async (now) => {
          try {
            await r.resolveTimestampsAsync("render");
            const t = r.info.render.timestamp;
            if (t > 0) window.__probe.gpu[window.__probe.phase].push(t);
          } catch {
            // no timestamp support, series stays empty
          }
          if (now - t0 < ms) requestAnimationFrame(tick);
          else resolve();
        };
        requestAnimationFrame(tick);
      });
    }, sampleMs);
    const profileOut = profile ? await cdp.send("Profiler.stop") : null;
    if (profileOut) await writeFile(join(OUT, `${name}.cpuprofile`), JSON.stringify(profileOut.profile ?? profileOut));
    const snap = await page.evaluate((p) => {
      const P = window.__probe;
      const out = { series: P.series[p], ring: P.ring[p], longTasks: P.longTasks[p], gpu: P.gpu[p], render: P.renderSnapshot(), tracer: P.tracerSnapshot() };
      if (P.__fixtureUndo) {
        P.__fixtureUndo();
        P.__fixtureUndo = null;
      }
      return out;
    }, name);
    const metrics = {
      label: name,
      raw: snap,
      synthetic: !!fixture,
      hideParticles,
      cpu: Object.fromEntries(Object.entries(snap.series).map(([k, v]) => [k, stats(v)])),
      ring: stats(snap.ring),
      gpu: stats(snap.gpu),
      longTasks: snap.longTasks,
      render: snap.render,
      tracer: snap.tracer,
    };
    metrics.ringWorst = snap.ring.length ? snap.ring.filter(Number.isFinite).reduce((m, x) => Math.max(m, x), 0) : null;
    report.phases[name] = metrics;
    await page.screenshot({ path: join(OUT, `${name}.png`) });
    console.log(
      `${name.padEnd(20)} frame CPU p95 ${fmt(metrics.cpu.frameCpu)} | render p95 ${fmt(metrics.cpu.render)} | worldUpdate p95 ${fmt(metrics.cpu.worldUpdate)} | projectiles p95 ${fmt(metrics.cpu.updateProjectiles)} | particles p95 ${fmt(metrics.cpu.particlesUpdate)} | step p95 ${fmt(metrics.cpu.battleStep)} | gpu p95 ${fmt(metrics.gpu)} ms | draws ${snap.render.draws} tri ${snap.render.triangles} | bullets ${snap.tracer.bullets} (flak ${snap.tracer.flakBullets}) | tracer maxLen ${snap.tracer.maxSegmentLength} nonFinite ${snap.tracer.nonFiniteSegments} | ring worst ${metrics.ringWorst}`,
    );
    return metrics;
  };

  report.fixtureNote = {
    synthetic: true,
    interval: FLAK_INTERVAL,
    count: FLAK_COUNT,
    note: "A is the live natural battle; B/C inject labelled flak projectiles and battle.fx bursts",
  };

  if (process.env.MIDWAY_MATRIX_COMPARE) {
    // Static matched fixture: identical frozen clock, camera and particle population across ABBA.
    // This mode only prototypes the once-per-frame world update; it is not shipped engine semantics
    // and does not resolve onBeforeRender/onAfterRender compatibility.
    await runPhase("fill-flak", { fixture: { interval: FLAK_INTERVAL, count: FLAK_COUNT } });
    report.matchedFixture = await page.evaluate(() => {
      const s = window.midway;
      s.battle.step = () => {};
      s.world.updateCamera = () => {};
      return window.__probe.renderSnapshot();
    });
    const stages = [["current-matrices-1", false], ["once-matrices-1", true], ["once-matrices-2", true], ["current-matrices-2", false]];
    for (const [name, once] of stages) {
      await page.evaluate((value) => {
        window.__probe.matrixOnce = value;
      }, once);
      await runPhase(name);
      const phase = report.phases[name];
      const snap = phase.render;
      assert.equal(snap.time, report.matchedFixture.time, "fixed battle time");
      assert.equal(snap.aircraft, report.matchedFixture.aircraft, "fixed aircraft population");
      assert.deepEqual(snap.particles, report.matchedFixture.particles, "fixed particle population");
      const root = phase.cpu.sceneMatrix;
      assert.ok(root && root.samples > 0, "root scene matrix traversals observed");
      phase.matrixOnce = once;
      phase.rootTraversalsPerRender = +(root.samples / Math.max(1, phase.cpu.render.samples)).toFixed(3);
      console.log(`  ${name}: matrixOnce=${once} rootTraversals/render=${phase.rootTraversalsPerRender} frameCpu p95 ${fmt(phase.cpu.frameCpu)} render p95 ${fmt(phase.cpu.render)} keptUpdate p95 ${fmt(phase.cpu.keptUpdate)}`);
    }
  } else if (process.env.MIDWAY_MATCHED || process.env.MIDWAY_COMPARE_PARTICLE_PREP) {
    await runPhase("fill-flak", { fixture: { interval: FLAK_INTERVAL, count: FLAK_COUNT } });
    report.matchedFixture = await page.evaluate(() => {
      const s = window.midway;
      // Attribution fixture: retain identical scene, clock, camera, and particle population.
      // World/particle packing and the renderer still run; this is not live-flight performance.
      s.battle.step = () => {};
      s.world.updateCamera = () => {};
      return window.__probe.renderSnapshot();
    });
    if (process.env.MIDWAY_COMPARE_PARTICLE_PREP) await page.evaluate(() => {
      const w = window.midway.world, p = w.particles;
      const update = p.update;
      const smoke = p.smokeBatch.mesh.onBeforeRender, glow = p.glowBatch.mesh.onBeforeRender;
      window.__setLegacyPrep = (legacy) => {
        p.update = legacy ? function (...args) {
          update.apply(this, args);
          this.writeBatch(this.smoke, this.smokeBatch, args[1], true);
          this.writeBatch(this.glow, this.glowBatch, args[1], false);
        } : update;
        p.smokeBatch.mesh.onBeforeRender = legacy ? () => {} : smoke;
        p.glowBatch.mesh.onBeforeRender = legacy ? () => {} : glow;
      };
    });
    const modes = process.env.MIDWAY_COMPARE_PARTICLE_PREP
      ? [["legacy-prep-1", false], ["draw-prep-1", false], ["draw-prep-2", false], ["legacy-prep-2", false]]
      : [["matched-visible-1", false], ["matched-hidden-1", true], ["matched-hidden-2", true], ["matched-visible-2", false]];
    for (const [name, hide] of modes) {
      if (process.env.MIDWAY_COMPARE_PARTICLE_PREP)
        await page.evaluate(legacy => window.__setLegacyPrep(legacy), name.startsWith("legacy"));
      await runPhase(name, { hideParticles: hide });
      const snap = report.phases[name].render;
      assert.equal(snap.time, report.matchedFixture.time, "fixed battle time");
      assert.equal(snap.aircraft, report.matchedFixture.aircraft, "fixed aircraft population");
      assert.deepEqual(snap.particles, report.matchedFixture.particles, "fixed particle population");
    }
  } else {
  await runPhase("A-quiet-natural");
  await runPhase("B-flak-fixture", { fixture: { interval: FLAK_INTERVAL, count: FLAK_COUNT } });
  await runPhase("C-flak-no-particles", { fixture: { interval: FLAK_INTERVAL, count: FLAK_COUNT }, hideParticles: true });
  await page.evaluate(() => window.__probe.setParticles(true));

  // D: the deliberate stall. Draw the baseline buffer, block the main thread, screenshot at once,
  // then re-read the same buffers to separate "the stall broke the data" from "it only delayed it".
  const before = await page.evaluate(() => window.__probe.tracerSnapshot());
  await page.evaluate((p) => window.__probe.start(p), "D-stall");
  await cdp.send("Profiler.start");
  await page.evaluate((ms) => {
    const end = performance.now() + ms;
    // Deliberate main-thread stall: this is the freeze under investigation.
    while (performance.now() < end) {
      /* spin */
    }
  }, STALL_MS);
  await page.screenshot({ path: join(OUT, "D-stall-immediate.png") });
  const after = await page.evaluate(() => window.__probe.tracerSnapshot());
  await page.waitForTimeout(3000);
  const stallProfile = await cdp.send("Profiler.stop");
  await writeFile(join(OUT, "D-stall.cpuprofile"), JSON.stringify(stallProfile.profile ?? stallProfile));
  const dSnap = await page.evaluate(() => {
    const P = window.__probe;
    return { ring: P.ring["D-stall"], longTasks: P.longTasks["D-stall"], render: P.renderSnapshot(), tracer: P.tracerSnapshot() };
  });
  report.phases["D-stall"] = {
    label: "D-stall",
    stallMs: STALL_MS,
    before,
    after,
    ring: stats(dSnap.ring),
    ringWorst: dSnap.ring.filter(Number.isFinite).reduce((m, x) => Math.max(m, x), 0),
    longTasks: dSnap.longTasks,
    render: dSnap.render,
    tracer: dSnap.tracer,
  };
  await page.screenshot({ path: join(OUT, "final.png") });
  console.log(
    `D-stall${" ".repeat(13)} before maxLen ${before.maxSegmentLength}m nonFinite seg ${before.nonFiniteSegments} bulletNonFinite ${before.bulletsNonFinite} -> after maxLen ${after.maxSegmentLength}m nonFinite seg ${after.nonFiniteSegments} bulletNonFinite ${after.bulletsNonFinite} | ring worst ${report.phases["D-stall"].ringWorst} | longTasks ${dSnap.longTasks.map((t) => t.dur).join(",") || "none"} | screenshot D-stall-immediate.png`,
  );
  }
} finally {
  report.consoleErrors = errors;
  await writeFile(join(OUT, "probe.json"), JSON.stringify(report, null, 2));
  console.log(`report written to ${join(OUT, "probe.json")}${errors.length ? ` (${errors.length} console/page errors)` : ""}`);
  await browser.close();
}

assert.deepEqual(errors, [], "no browser errors during the diagnostic capture");
