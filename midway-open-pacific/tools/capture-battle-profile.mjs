/**
 * Real-combat battle hotspot diagnostic (diagnostic only; no source edits, no synthetic injection).
 *
 * The expanded question: is the flak slowdown/burst cost JavaScript, ordinary game-devinefficiency,
 * or an engine defect? This runs the ACTUAL battle — real AI, ship gunnery, bullets, damage — with
 * no injected projectiles or particles, no giant hp, no simulation freeze and no suppressed enemies.
 *
 * Setup: airborne cockpit start, mark the player's position astern of a live enemy carrier through
 * the existing capture-sortie repositioning pattern with a real flight attitude, then engage KeyT
 * course hold so the player flies the normal autopilot toward the designated contact. The
 * repositioning is a labelled fixture; everything after it is untouched Battle rules.
 *
 * Sample: 8 s combat warm-up, then a 20 s wall sample. Records the outer
 * `Battle.step` and each Battle method actually called by `step`, plus world/particles/ripples/
 * render, as separate raw series (they nest, so they are reported separately, never summed), and
 * per-fixed-step counts. If the player is lost before the sample ends, the end is reported, never
 * revived. Browser console/page errors fail the run.
 *
 *   MIDWAY_URL=http://127.0.0.1:5396 bash tools/capture-lock.sh \
 *     node tools/capture-battle-profile.mjs
 *
 * Env: MIDWAY_URL, MIDWAY_BATTLE_OUT (/tmp/midway-flak-hunt/battle), MIDWAY_WARM_MS (8000),
 *      MIDWAY_SAMPLE_MS (20000), MIDWAY_CAMERA (1 cockpit), MIDWAY_WIDTH/HEIGHT (1600x900),
 *      MIDWAY_BATTLE_ALTITUDE (1800 m), MIDWAY_BATTLE_STANDOFF (2400 m), MIDWAY_UNCAPPED=1 for the
 *      Chromium frame-rate/vsync flags, MIDWAY_CPU_PROFILE=0 to skip CDP CPU sampling (throughput).
 *
 *      MIDWAY_REFLECTION_COMPARE=1 runs the reflection ABBA compare instead of the combat sample:
 *      the real close battle (alt 350 m, standoff 1500 m), frozen after warm-up, four phases of
 *      unchanged / parked+decor reflected-layer excluded / excluded / unchanged. Extra env:
 *      MIDWAY_REFLECTION_OUT (screenshots), MIDWAY_REFLECTION_CAP_MS (90000 wall cap per phase),
 *      MIDWAY_REFLECTION_MIN_MS (2500), MIDWAY_REFLECTION_FRAMES (30 minimum outer frames),
 *      MIDWAY_REFLECTION_READY (/tmp/midway-flak-hunt/reflection-probe-ready probe gate).
 */
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright";

const URL = process.env.MIDWAY_URL || "http://127.0.0.1:5396";
const OUT = process.env.MIDWAY_BATTLE_OUT || "/tmp/midway-flak-hunt/battle";
const WARM_MS = Number(process.env.MIDWAY_WARM_MS || 8000);
const SAMPLE_MS = Number(process.env.MIDWAY_SAMPLE_MS || 20000);
const CAMERA = Number(process.env.MIDWAY_CAMERA || 1);
const WIDTH = Number(process.env.MIDWAY_WIDTH || 1600);
const HEIGHT = Number(process.env.MIDWAY_HEIGHT || 900);
// MIDWAY_REFLECTION_COMPARE runs the parent's real close battle (alt 350 m, standoff 1500 m)
// unless the caller states its own figures; the ordinary battle tool keeps its old defaults.
const REFLECTION_COMPARE = process.env.MIDWAY_REFLECTION_COMPARE === "1";
const ALTITUDE = Number(process.env.MIDWAY_BATTLE_ALTITUDE || (REFLECTION_COMPARE ? 350 : 1800));
const STANDOFF = Number(process.env.MIDWAY_BATTLE_STANDOFF || (REFLECTION_COMPARE ? 1500 : 2400));
const UNCAPPED = process.env.MIDWAY_UNCAPPED === "1";
const CPU_PROFILE = process.env.MIDWAY_CPU_PROFILE !== "0";
assert.ok(Number.isFinite(ALTITUDE) && ALTITUDE > 0, `MIDWAY_BATTLE_ALTITUDE must be positive, got ${process.env.MIDWAY_BATTLE_ALTITUDE}`);
assert.ok(Number.isFinite(STANDOFF) && STANDOFF > 0, `MIDWAY_BATTLE_STANDOFF must be positive, got ${process.env.MIDWAY_BATTLE_STANDOFF}`);

/** Diagnostic nearest-rank reduction; not the perf harness rule. */
const stats = (arr) => {
  const raw = (arr || []).map(Number);
  const a = raw.filter(Number.isFinite).sort((x, y) => x - y);
  if (!a.length) return { samples: raw.length, nonFinite: raw.length };
  const q = (p) => a[Math.min(a.length - 1, Math.max(0, Math.round((a.length - 1) * p)))];
  return { samples: raw.length, finite: a.length, nonFinite: raw.length - a.length, min: +a[0].toFixed(3), p50: +q(0.5).toFixed(3), p95: +q(0.95).toFixed(3), p99: +q(0.99).toFixed(3), max: +a[a.length - 1].toFixed(3) };
};

const browserArgs = ["--enable-unsafe-webgpu", "--enable-features=Vulkan", "--disable-gpu-sandbox", "--ignore-gpu-blocklist", "--ozone-platform=x11"];
if (UNCAPPED) browserArgs.push("--disable-frame-rate-limit", "--disable-gpu-vsync");
// The reflection probe must not launch until the concurrent projection audit releases the gate.
// No browser (and so no WebGPU device) is created before the marker exists. Fail closed on timeout.
if (REFLECTION_COMPARE) {
  const ready = process.env.MIDWAY_REFLECTION_READY || "/tmp/midway-flak-hunt/reflection-probe-ready";
  const deadline = Date.now() + Number(process.env.MIDWAY_REFLECTION_READY_TIMEOUT_MS || 300000);
  while (!existsSync(ready)) {
    if (Date.now() > deadline) throw new Error(`reflection probe gate was never released: ${ready}`);
    await new Promise((r) => setTimeout(r, 1000));
  }
  console.log(`reflection probe gate released: ${ready}`);
}
const browser = await chromium.launch({
  headless: false,
  args: browserArgs,
});
const errors = [];
const frameBudgetWindows = [];
const frameHitches = [];
let frameBudgetLatest = null;
const projectionReports = [];
const report = {
  tool: "capture-battle-profile",
  realCombat: true,
  url: URL,
  fixture: null,
  uncapped: UNCAPPED,
  browserArgs,
  cpuProfile: CPU_PROFILE,
  qualified: null,
  unqualifiedReasons: [],
  limits: [
    "wall/rAF ring and per-method series measure CPU wall time, not GPU execution time",
    "the engine `TN_FRAME_BUDGET` window is the whole presented frame (update + render + overlay + hostGap + residual) and includes engine projection/overlay work the custom wraps omit",
    "a 1000 us CDP sampling interval biases CPU when MIDWAY_CPU_PROFILE is on; set MIDWAY_CPU_PROFILE=0 for throughput",
    "the rAF ring is a presentation cadence on the virtual display, not a physical FPS claim",
    "a lost player or a non-advancing sample is reported unqualified; nothing is revived",
  ],
};

try {
  await mkdir(OUT, { recursive: true });
  const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT } });
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    const text = m.text();
    if (m.type() === "error") errors.push(text);
    // The engine's own windowed attribution, captured verbatim. No engine API or source change:
    // the default `frameBudget` convention prints `TN_FRAME_BUDGET:<json>` once per report window
    // and `TN_FRAME_HITCH:<json>` the moment a present gap exceeds `hitchMs`.
    if (text.startsWith("TN_FRAME_BUDGET:")) {
      try {
        const w = JSON.parse(text.slice("TN_FRAME_BUDGET:".length));
        frameBudgetLatest = w;
        frameBudgetWindows.push({ atMs: Date.now(), ...w });
      } catch {
        errors.push(`unparseable TN_FRAME_BUDGET line: ${text}`);
      }
    } else if (text.startsWith("TN_FRAME_HITCH:")) {
      try {
        frameHitches.push({ atMs: Date.now(), ...JSON.parse(text.slice("TN_FRAME_HITCH:".length)) });
      } catch {
        errors.push(`unparseable TN_FRAME_HITCH line: ${text}`);
      }
    } else if (text.startsWith("TN_RENDER_PROJECTION:")) {
      // The engine's own render-projection verdict: whether the authored scene was re-batched or
      // declined, and why. Emitted once per verdict change; the same no-API console contract.
      try {
        projectionReports.push({ atMs: Date.now(), ...JSON.parse(text.slice("TN_RENDER_PROJECTION:".length)) });
      } catch {
        errors.push(`unparseable TN_RENDER_PROJECTION line: ${text}`);
      }
    }
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
  assert.ok(adapter && !/swiftshader|lavapipe|llvmpipe|software/i.test(JSON.stringify(adapter)), `hardware WebGPU adapter required: ${JSON.stringify(adapter)}`);
  report.adapter = adapter;
  report.pixelRatio = await page.evaluate(() => window.devicePixelRatio);
  console.log(`adapter ${JSON.stringify(adapter)}, viewport ${WIDTH}x${HEIGHT} dpr ${report.pixelRatio}`);

  // Airborne start in the cockpit, then the labelled repositioning fixture: place the player astern
  // of a live enemy carrier with a genuine flight attitude, and designate that carrier so KeyT flies
  // the real course-hold law. No stats are altered beyond position/attitude/velocity.
  await page.click("#start-air");
  await page.waitForFunction(() => window.midway.battle.status !== "briefing", null, { timeout: 60000 });
  await page.evaluate((mode) => window.midway.world.setCamera(mode), CAMERA);

  const set = await page.evaluate(({ D, alt }) => {
    const b = window.midway.battle;
    const ship = b.ships.filter((s) => s.team === "jp" && s.kind === "carrier" && !s.sunk).sort((a, c) => (c.aa || 0) - (a.aa || 0))[0];
    if (!ship) throw new Error("no live enemy carrier to approach");
    b.recordContact(ship);
    b.target = ship.id;
    b.updateSortie();
    const f = { x: Math.sin(ship.heading), z: -Math.cos(ship.heading) };
    const p = b.player;
    Object.assign(p, {
      x: ship.x - f.x * D,
      y: alt,
      z: ship.z - f.z * D,
      heading: ship.heading,
      pitch: 0.02,
      roll: 0,
      vx: f.x * 95,
      vy: 0,
      vz: f.z * 95,
      speed: 95,
      autopilot: false,
    });
    if (b.playerFlight?.reset) b.playerFlight.reset();
    if (b.playerFlight?.setAttitude) b.playerFlight.setAttitude(ship.heading, 0.02, 0);
    return {
      ship: { name: ship.name, id: ship.id, team: ship.team, kind: ship.kind, aa: ship.aa, x: +ship.x.toFixed(1), z: +ship.z.toFixed(1), heading: +ship.heading.toFixed(3) },
      player: { x: +p.x.toFixed(1), y: +p.y.toFixed(1), z: +p.z.toFixed(1), heading: +p.heading.toFixed(3), standoff: D },
    };
  }, { D: STANDOFF, alt: ALTITUDE });
  report.fixture = {
    label: "repositioned-astern-of-enemy-carrier",
    note: `player placed ${STANDOFF} m astern of a live enemy carrier at ${ALTITUDE} m with a real flight attitude and the carrier designated; all Battle rules run untouched afterwards`,
    requested: { altitude: ALTITUDE, standoff: STANDOFF },
    ...set,
  };
  console.log(`fixture: repositioned vs ${set.ship.name} (aa ${set.ship.aa}) standoff ${set.player.standoff} m at ${set.player.y} m`);

  await page.keyboard.press("KeyT");
  const hold = await page.evaluate(() => ({ autopilot: !!window.midway.battle.player.autopilot, nav: window.midway.battle.player.nav }));
  assert.ok(hold.autopilot, `KeyT must engage course hold: ${JSON.stringify(hold)}`);
  report.courseHold = hold;

  if (REFLECTION_COMPARE) {
    // Reflection ABBA compare (diagnostic only; no source edits). The same real close battle, then
    // the scene update is frozen so camera, clock and populations are held while the renderer keeps
    // drawing. Four phases toggle REFLECTED_LAYER on the nodes rooted in a ship's own
    // `userData.parked` / `userData.decor` — the parked deck load `markReflected`'s comment says is
    // excluded but which `markReflected(mesh)` in src/render/world.ts actually marks, because the
    // park and the B-25 are added to the hull before that traverse. Every original mask is recorded
    // and restored, and the main camera's eligible/visible mesh counts are asserted unchanged.
    const REFL_OUT = process.env.MIDWAY_REFLECTION_OUT || OUT;
    await mkdir(REFL_OUT, { recursive: true });
    const medianOf = (xs) => {
      const a = xs.filter(Number.isFinite).sort((x, y) => x - y);
      return a.length ? a[Math.min(a.length - 1, Math.round((a.length - 1) * 0.5))] : NaN;
    };
    const discovery = await page.evaluate(async () => {
      const s = window.midway;
      const w = s.world;
      const url = performance
        .getEntriesByType("resource")
        .map((e) => e.name)
        .findLast((n) => /\/src\/render\/ocean\.ts(?:\?|$)/.test(n));
      if (!url) throw new Error("ocean.ts module not found; cannot discover REFLECTED_LAYER");
      const { REFLECTED_LAYER } = await import(url);
      const originals = [];
      const ships = [];
      let onReflectedLayer = 0;
      for (const [id, mesh] of w.meshes) {
        const lists = [mesh.userData?.parked, mesh.userData?.decor].filter(Boolean);
        if (!lists.length) continue;
        let roots = 0;
        let nodes = 0;
        for (const list of lists)
          for (const root of list) {
            roots += 1;
            root.traverse((o) => {
              if (!o.layers) return;
              originals.push({ o, mask: o.layers.mask });
              if ((o.layers.mask & (1 << REFLECTED_LAYER)) !== 0) onReflectedLayer += 1;
              nodes += 1;
            });
          }
        ships.push({ id, roots, nodes });
      }
      const state = { layer: REFLECTED_LAYER, originals, ships, onReflectedLayer, phase: "boot", excluded: false, render: {}, perframe: {}, gpu: {} };
      state.apply = (exclude) => {
        for (const { o, mask } of originals) o.layers.mask = exclude ? mask & ~(1 << REFLECTED_LAYER) : mask;
        state.excluded = exclude;
      };
      state.start = (name) => {
        state.phase = name;
        state.render[name] = [];
        state.perframe[name] = [];
        state.gpu[name] = [];
      };
      state.snapshot = () => {
        const b = s.battle;
        let particles = null;
        try {
          particles = { smoke: w.particles.smokeBatch.geometry.instanceCount, glow: w.particles.glowBatch.geometry.instanceCount };
        } catch {
          // particle batches are optional in this build; the population check then reports null
        }
        return {
          time: +b.time.toFixed(3),
          status: b.status,
          aircraft: b.aircraft.filter((a) => a.hp > 0).length,
          activeAircraft: b.activeAircraft,
          ships: b.ships.filter((x) => !x.sunk).length,
          bullets: b.bullets.length,
          effects: b.effects.length,
          particles,
          player: { hp: b.player.hp, y: +b.player.y.toFixed(1) },
          camera: { mode: w.cameraMode, x: +w.camera.position.x.toFixed(1), y: +w.camera.position.y.toFixed(1), z: +w.camera.position.z.toFixed(1) },
        };
      };
      // Main-camera eligibility exactly as the renderer tests it: visible ancestor chain and a
      // layer-mask intersection, then a frustum projection. Disabling REFLECTED_LAYER must move
      // neither number, which is the proof the main view is untouched.
      state.mainCamera = () => {
        const cam = w.camera;
        const tmp = new cam.position.constructor();
        let eligible = 0;
        let visible = 0;
        w.scene.traverse((o) => {
          if (!o.isMesh) return;
          for (let p = o; p; p = p.parent) if (!p.visible) return;
          if (!cam.layers.test(o.layers)) return;
          eligible += 1;
          o.getWorldPosition(tmp);
          tmp.project(cam);
          if (tmp.x >= -1 && tmp.x <= 1 && tmp.y >= -1 && tmp.y <= 1 && tmp.z >= -1 && tmp.z <= 1) visible += 1;
        });
        return { eligible, visible };
      };
      window.__refl = state;
      return { layer: REFLECTED_LAYER, ships, parkedDecorNodes: originals.length, onReflectedLayer };
    });
    report.reflection = {
      mode: "ABBA-reflection-layer",
      note: "real close battle, frozen scene update; only REFLECTED_LAYER on ship.userData.parked/decor nodes is toggled",
      discovery,
      warmMs: WARM_MS,
      phases: {},
      gpuTimestamps: null,
      delta: null,
    };
    console.log(
      `reflection layer ${discovery.layer}: ${discovery.ships.length} ships, ${discovery.parkedDecorNodes} parked/decor nodes (${discovery.onReflectedLayer} on the reflected layer)`,
    );
    if (discovery.onReflectedLayer === 0) console.log("  WARNING: no parked/decor node carries the reflected layer; the toggle is a no-op on this build");

    await page.waitForTimeout(WARM_MS);
    // Freeze the scene update only: the battle step and the camera update stop, holding clock,
    // camera and populations; world packing and the renderer keep running. The render wrapper is
    // the existing outermost-call timer pattern, so a nested reflection render is charged once.
    await page.evaluate(() => {
      const r = window.midway.world.renderer;
      const original = r.render;
      let depth = 0;
      r.render = function (...args) {
        depth += 1;
        const outer = depth === 1;
        const t0 = outer ? performance.now() : 0;
        try {
          return original.apply(this, args);
        } finally {
          depth -= 1;
          if (outer) (window.__refl.render[window.__refl.phase] ||= []).push(+(performance.now() - t0).toFixed(3));
        }
      };
      window.__refl.undoWrap = () => {
        r.render = original;
      };
      const b = window.midway.battle;
      const bs = b.step;
      const uc = window.midway.world.updateCamera;
      b.step = () => {};
      window.midway.world.updateCamera = () => {};
      window.__refl.undoFreeze = () => {
        b.step = bs;
        window.midway.world.updateCamera = uc;
      };
    });
    const gpuSupported = await page.evaluate(async () => {
      try {
        const r = window.midway.world.renderer;
        r.trackTimestamp = true;
        await r.resolveTimestampsAsync("render");
        return true;
      } catch {
        return false;
      }
    });
    report.reflection.gpuTimestamps = gpuSupported;
    console.log(`gpu timestamp queries: ${gpuSupported ? "available" : "unavailable"}`);

    const PHASE_CAP_MS = Number(process.env.MIDWAY_REFLECTION_CAP_MS || 90000);
    const PHASE_MIN_MS = Number(process.env.MIDWAY_REFLECTION_MIN_MS || 2500);
    const FRAME_TARGET = Number(process.env.MIDWAY_REFLECTION_FRAMES || 30);
    const runPhase = async (name, excluded) => {
      await page.evaluate((e) => window.__refl.apply(e), excluded);
      await page.evaluate((n) => window.__refl.start(n), name);
      const out = await page.evaluate(
        async ({ name: n, target, capMs, minMs }) => {
          const refl = window.__refl;
          const r = window.midway.world.renderer;
          const t0 = performance.now();
          let frames = 0;
          await new Promise((resolve) => {
            const tick = async (now) => {
              frames += 1;
              refl.perframe[n].push({ draws: r.info.render.drawCalls, triangles: r.info.render.triangles });
              try {
                await r.resolveTimestampsAsync("render");
                const t = r.info.render.timestamp;
                if (t > 0) refl.gpu[n].push(t);
              } catch {
                // no timestamp support; the gpu series stays empty and is reported as unavailable
              }
              const elapsed = now - t0;
              if ((frames >= target && elapsed >= minMs) || elapsed >= capMs) resolve();
              else requestAnimationFrame(tick);
            };
            requestAnimationFrame(tick);
          });
          return {
            frames,
            wallMs: +(performance.now() - t0).toFixed(1),
            render: refl.render[n],
            gpu: refl.gpu[n],
            perframe: refl.perframe[n],
            snapshot: refl.snapshot(),
            mainCamera: refl.mainCamera(),
          };
        },
        { name, target: FRAME_TARGET, capMs: PHASE_CAP_MS, minMs: PHASE_MIN_MS },
      );
      await page.screenshot({ path: join(REFL_OUT, `reflection-${name}.png`) });
      const metrics = {
        label: name,
        excluded,
        frames: out.frames,
        wallMs: out.wallMs,
        render: stats(out.render),
        gpu: stats(out.gpu),
        draws: stats(out.perframe.map((p) => p.draws)),
        triangles: stats(out.perframe.map((p) => p.triangles)),
        snapshot: out.snapshot,
        mainCamera: out.mainCamera,
      };
      report.reflection.phases[name] = metrics;
      console.log(
        `${name.padEnd(14)} frames ${out.frames} wall ${out.wallMs}ms | render p95 ${metrics.render.p95}ms gpu p95 ${metrics.gpu.p95 ?? "n/a"} | draws p50 ${metrics.draws.p50} tri p50 ${metrics.triangles.p50} | eligible ${out.mainCamera.eligible} visible ${out.mainCamera.visible} | time ${out.snapshot.time} ac ${out.snapshot.aircraft} particles ${JSON.stringify(out.snapshot.particles)}`,
      );
      assert.ok(out.frames >= FRAME_TARGET, `${name}: ${out.frames} outer frames observed (< ${FRAME_TARGET})`);
      return metrics;
    };

    const phases = [["A1-unchanged", false], ["B1-excluded", true], ["B2-excluded", true], ["A2-unchanged", false]];
    for (const [name, excluded] of phases) await runPhase(name, excluded);

    const held = phases.map(([name]) => report.reflection.phases[name]);
    for (const h of held) {
      assert.equal(h.snapshot.time, held[0].snapshot.time, `frozen battle clock changed in ${h.label}`);
      assert.equal(h.snapshot.aircraft, held[0].snapshot.aircraft, `aircraft population changed in ${h.label}`);
      assert.deepEqual(h.snapshot.particles, held[0].snapshot.particles, `particle population changed in ${h.label}`);
      assert.equal(h.mainCamera.eligible, held[0].mainCamera.eligible, `main-camera eligible meshes changed in ${h.label}`);
      assert.equal(h.mainCamera.visible, held[0].mainCamera.visible, `main-camera visible meshes changed in ${h.label}`);
    }
    const A = ["A1-unchanged", "A2-unchanged"].map((n) => report.reflection.phases[n]);
    const B = ["B1-excluded", "B2-excluded"].map((n) => report.reflection.phases[n]);
    report.reflection.delta = {
      draws: medianOf(A.map((p) => p.draws.p50)) - medianOf(B.map((p) => p.draws.p50)),
      triangles: medianOf(A.map((p) => p.triangles.p50)) - medianOf(B.map((p) => p.triangles.p50)),
      renderMs: medianOf(A.map((p) => p.render.p95)) - medianOf(B.map((p) => p.render.p95)),
    };
    // Restore every original mask, then release the frozen scene.
    await page.evaluate(() => {
      window.__refl.apply(false);
      window.__refl.undoFreeze?.();
      window.__refl.undoWrap?.();
    });
    console.log(
      `reflection delta A-B: draws ${report.reflection.delta.draws} triangles ${report.reflection.delta.triangles} renderP95 ${report.reflection.delta.renderMs}ms; all masks restored`,
    );
  }

  if (!REFLECTION_COMPARE) {
  // One persistent instrumentation pass. Every series is charged to its outermost call only, so a
  // re-entrant render is counted once; the series nest and are reported separately, never summed.
  const installed = await page.evaluate(() => {
    const s = window.midway;
    const b = s.battle;
    const w = s.world;
    const r = w.renderer;
    const METHODS = [
      "updateRescue", "updateShips", "updateFacilities", "updateScouts", "updatePlayer", "observeFuel",
      "updateRecovery", "updateAircraft", "updateWeapons", "updateRadio", "updateIntel", "updateSortie",
      "observeFleet", "observeFacilities", "deliverReports", "updateHunts", "updateCarrier", "updateOperation",
    ];
    const P = { phase: "boot", methods: METHODS, series: {}, step: {}, ring: {}, longTasks: {}, counters: {} };
    window.__bp = P;

    let prev = performance.now();
    const rAF = () => {
      const now = performance.now();
      const arr = P.ring[P.phase];
      if (arr) {
        arr.push(+(now - prev).toFixed(2));
        if (arr.length > 1800) arr.shift();
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
      // the ring still catches the gap
    }

    const wrap = (owner, key, name) => {
      const original = owner[key];
      if (typeof original !== "function") return () => {};
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
          if (outer && rec && rec[name]) rec[name].push(+(performance.now() - t0).toFixed(3));
          // Per-render actual drawing buffer: two integer reads from the canvas, no readback.
          if (outer && name === "render" && r.domElement) P.drawingBuffer = { width: r.domElement.width, height: r.domElement.height };
        }
      };
      return () => {
        owner[key] = original;
      };
    };

    // Counters: prove AA and flak actually fired and damage was dealt, without reading the 80-event
    // ring after the fact. These wrappers are inside the timed step and add a tiny, stated overhead.
    P.undo = [];
    const countEvent = b.event;
    b.event = function (type, data) {
      const c = P.counters[P.phase];
      if (c) c.events[type] = (c.events[type] || 0) + 1;
      return countEvent.call(this, type, data);
    };
    P.undo.push(() => {
      b.event = countEvent;
    });
    const countFx = b.fx;
    b.fx = function (type, p, size, underwater) {
      const c = P.counters[P.phase];
      if (c) c.fx[type] = (c.fx[type] || 0) + 1;
      return countFx.call(this, type, p, size, underwater);
    };
    P.undo.push(() => {
      b.fx = countFx;
    });

    for (const m of METHODS) P.undo.push(wrap(b, m, `m_${m}`));
    P.undo.push(wrap(s, "update", "sceneUpdate"));
    P.undo.push(wrap(w, "update", "worldUpdate"));
    P.undo.push(wrap(w, "updateProjectiles", "updateProjectiles"));
    P.undo.push(wrap(w.particles, "update", "particlesUpdate"));
    P.undo.push(wrap(w.ripples, "update", "ripplesUpdate"));
    P.undo.push(wrap(r, "render", "render"));

    const origStep = b.step;
    let substeps = 0;
    b.step = function (dt, input) {
      const rec = P.series[P.phase];
      const st = P.step[P.phase];
      const t0 = performance.now();
      const out = origStep.call(this, dt, input);
      const ms = performance.now() - t0;
      if (rec) {
        rec.step.push(+ms.toFixed(3));
        if (dt > 0.05) substeps += 1;
        else if (st) {
          let flak = 0;
          let aa = 0;
          for (const bl of this.bullets) {
            if (bl.type === "flak") flak += 1;
            else if (bl.type === "aa") aa += 1;
          }
          st.time.push(+this.time.toFixed(3));
          st.hp.push(this.player.hp);
          st.bullets.push(this.bullets.length);
          st.flak.push(flak);
          st.aa.push(aa);
          st.effects.push(this.effects.length);
        }
      }
      return out;
    };
    P.undo.push(() => {
      b.step = origStep;
    });

    P.snapshot = () => {
      const fxByType = {};
      for (const e of b.effects) fxByType[e.type] = (fxByType[e.type] || 0) + 1;
      let flakBullets = 0;
      let aaBullets = 0;
      for (const bl of b.bullets) {
        if (bl.type === "flak") flakBullets += 1;
        else if (bl.type === "aa") aaBullets += 1;
      }
      // Layer counts: one traverse per snapshot (not per render); the mask is the ordinary
      // Object3D layer bitfield, reported as found rather than interpreted.
      const layerMasks = {};
      w.scene.traverse((o) => {
        const m = o.layers?.mask;
        if (m !== undefined) layerMasks[m] = (layerMasks[m] || 0) + 1;
      });
      return {
        time: +b.time.toFixed(2),
        status: b.status,
        player: { hp: b.player.hp, mode: b.player.mode, y: +b.player.y.toFixed(1), x: +b.player.x.toFixed(1), z: +b.player.z.toFixed(1) },
        aircraftAlive: b.aircraft.filter((a) => a.hp > 0).length,
        shipsAlive: b.ships.filter((x) => !x.sunk).length,
        shipsBurning: b.ships.filter((x) => !x.sunk && x.fire > 0.06).length,
        bullets: b.bullets.length,
        flakBullets,
        aaBullets,
        effects: b.effects.length,
        effectsByType: fxByType,
        draws: r.info.render.drawCalls,
        triangles: r.info.render.triangles,
        drawingBuffer: P.drawingBuffer ?? (r.domElement ? { width: r.domElement.width, height: r.domElement.height } : null),
        layerMasks,
      };
    };

    P.start = (name) => {
      P.phase = name;
      const rec = (P.series[name] = {});
      for (const m of METHODS) rec[`m_${m}`] = [];
      for (const k of ["step", "sceneUpdate", "worldUpdate", "updateProjectiles", "particlesUpdate", "ripplesUpdate", "render"]) rec[k] = [];
      P.step[name] = { time: [], hp: [], bullets: [], flak: [], aa: [], effects: [] };
      P.ring[name] = [];
      P.longTasks[name] = [];
      P.counters[name] = { events: {}, fx: {} };
      P.substeps = substeps;
    };

    P.stop = (name) => ({
      series: P.series[name],
      step: P.step[name],
      ring: P.ring[name],
      longTasks: P.longTasks[name],
      counters: P.counters[name],
      substeps,
      snapshot: P.snapshot(),
    });

    return true;
  });
  assert.ok(installed, "instrumentation installed");

  const beforeWarm = await page.evaluate(() => window.__bp.snapshot());
  await page.waitForTimeout(WARM_MS);
  const afterWarm = await page.evaluate(() => window.__bp.snapshot());
  report.beforeWarm = beforeWarm;
  report.afterWarm = afterWarm;

  const ended = afterWarm.status !== "playing" || afterWarm.player.hp <= 0;
  report.endedBeforeSample = ended;
  if (ended) {
    report.qualified = false;
    report.unqualifiedReasons.push(`battle not playing at sample start (status ${afterWarm.status}, hp ${afterWarm.player.hp})`);
  }
  let sample = null;
  if (!ended) {
    const cdp = await page.context().newCDPSession(page);
    if (CPU_PROFILE) {
      await cdp.send("Profiler.enable");
      await cdp.send("Profiler.setSamplingInterval", { interval: 1000 });
    }
    await page.evaluate((n) => window.__bp.start(n), "combat-20s");
    if (CPU_PROFILE) await cdp.send("Profiler.start");
    await page.screenshot({ path: join(OUT, "battle-start.png") });
    await page.waitForTimeout(SAMPLE_MS);
    if (CPU_PROFILE) {
      const profile = await cdp.send("Profiler.stop");
      await writeFile(join(OUT, "battle-combat.cpuprofile"), JSON.stringify(profile.profile ?? profile));
    }
    sample = await page.evaluate((n) => window.__bp.stop(n), "combat-20s");
  }
  // The default report window is 300 presented frames: at a healthy cadence a 30 s sample yields
  // several, but a very low frame rate can miss one. Wait a bounded extra for a single window and
  // report `unavailable` rather than a fabricated zero if none ever arrives.
  if (!frameBudgetWindows.length) {
    const extra = Number(process.env.MIDWAY_BUDGET_EXTRA_MS || 15000);
    const deadline = Date.now() + extra;
    while (!frameBudgetWindows.length && Date.now() < deadline) await page.waitForTimeout(1000);
    if (!frameBudgetWindows.length) console.log(`frame budget: no TN_FRAME_BUDGET window after +${extra}ms extra — reporting unavailable`);
  }
  await page.screenshot({ path: join(OUT, "battle-final.png") });

  report.sampleSeconds = ended ? 0 : SAMPLE_MS / 1000;
  report.end = await page.evaluate(() => window.__bp.snapshot());

  if (sample) {
    const s = sample.series;
    const reduced = {};
    for (const [k, arr] of Object.entries(s)) reduced[k] = stats(arr);
    // Per-step actual advance: last minus first battle time in the sample.
    const st = sample.step;
    const advanced = st.time.length ? +(st.time[st.time.length - 1] - st.time[0]).toFixed(2) : 0;
    // A death or a sample that did not advance the battle clock is reported unqualified. Nothing is
    // revived and no hp is injected; the run simply does not count as a representative sample.
    if (report.end.status !== "playing") {
      report.qualified = false;
      report.unqualifiedReasons.push(`battle ended during the sample (status ${report.end.status})`);
    }
    if (report.end.player.hp <= 0) {
      report.qualified = false;
      report.unqualifiedReasons.push("player was lost during the sample");
    }
    if (!(advanced > 0)) {
      report.qualified = false;
      report.unqualifiedReasons.push("simulation did not advance during the sample");
    }
    if (report.qualified === null) report.qualified = true;
    const hpMin = st.hp.length ? Math.min(...st.hp) : null;
    const flakMax = st.flak.length ? Math.max(...st.flak) : 0;
    const aaMax = st.aa.length ? Math.max(...st.aa) : 0;
    const bulletsMax = st.bullets.length ? Math.max(...st.bullets) : 0;
    const effectsMax = st.effects.length ? Math.max(...st.effects) : 0;
    const counters = sample.counters;
    const evidence = {
      aaEvents: counters.events.aa || 0,
      flakEvents: counters.events.flak || 0,
      muzzleFx: counters.fx.muzzle || 0,
      flakFx: counters.fx.flak || 0,
      explosionEvents: counters.events.explosion || 0,
      hitEvents: counters.events.hit || 0,
      damageEvents: counters.events.damage || 0,
      splashEvents: counters.events.splash || 0,
      playerHpStart: beforeWarm.player.hp,
      playerHpEnd: report.end.player.hp,
      playerDamaged: report.end.player.hp < beforeWarm.player.hp,
      shipsBurningEnd: report.end.shipsBurning,
      flakBulletsMax: flakMax,
      aaBulletsMax: aaMax,
      bulletsMax,
      effectsMax,
      simAdvancedSeconds: advanced,
    };
    evidence.aaObserved = evidence.aaEvents > 0 || evidence.muzzleFx > 0 || aaMax > 0;
    evidence.flakObserved = evidence.flakEvents > 0 || evidence.flakFx > 0 || flakMax > 0;
    evidence.damageObserved = evidence.damageEvents > 0 || evidence.hitEvents > 0 || evidence.explosionEvents > 0 || evidence.playerDamaged || evidence.shipsBurningEnd > 0;
    report.sample = { seconds: SAMPLE_MS / 1000, substeps: sample.substeps, snapshot: sample.snapshot, advancedSeconds: advanced, hpMin, reduced, counters, longTasks: sample.longTasks, ring: stats(sample.ring), evidence, raw: sample };
    console.log(
      `combat sample: ${advanced}s sim advanced | player hp ${beforeWarm.player.hp}->${report.end.player.hp} status ${report.end.status} | aa events ${evidence.aaEvents} flak events ${evidence.flakEvents} muzzleFx ${evidence.muzzleFx} flakFx ${evidence.flakFx} | flakBullets max ${flakMax} aaBullets max ${aaMax} effects max ${effectsMax} | damageEvents ${evidence.damageEvents} explosions ${evidence.explosionEvents} shipsBurning ${evidence.shipsBurningEnd} | render p95 ${reduced.render?.p95}ms step p95 ${reduced.step?.p95}ms`,
    );
    console.log("  battle methods p95 (ms): " + Object.entries(reduced).filter(([k]) => k.startsWith("m_")).map(([k, v]) => `${k.slice(2)}=${v.samples ? v.p95 : "n/a"}`).join(" "));
    console.log(`  observed: aa=${evidence.aaObserved} flak=${evidence.flakObserved} damage=${evidence.damageObserved}` + (evidence.aaObserved ? "" : " (AA ABSENT/UNOBSERVED)") + (evidence.flakObserved ? "" : " (FLAK ABSENT/UNOBSERVED)") + (evidence.damageObserved ? "" : " (DAMAGE ABSENT/UNOBSERVED)"));
  } else {
    report.endNote = "player status ended before the sample; no sample taken and no revival performed";
    console.log(`ended before sample: ${JSON.stringify(report.end)} — ${report.endNote}`);
  }
  }

  // The engine's whole-presented-frame attribution: simulation (`update`), `render`, `overlay`,
  // `hostGap` and `residual`, plus the applied resolution scale and GPU frame time. This includes
  // the engine's own projection/overlay work the custom wraps above do not, so it is the honest
  // whole-frame number; the custom `render`/`step` series are reported separately and never summed.
  report.frameBudget = {
    marker: "TN_FRAME_BUDGET",
    count: frameBudgetWindows.length,
    windows: frameBudgetWindows,
    latest: frameBudgetLatest,
    hitches: frameHitches,
    unavailableReason: frameBudgetWindows.length ? null : "no completed TN_FRAME_BUDGET window arrived (default report window is 300 presented frames)",
  };
  // The engine's own render-projection verdict: active batching or a declined authored scene.
  report.renderProjection = {
    marker: "TN_RENDER_PROJECTION",
    reports: projectionReports,
    latest: projectionReports.length ? projectionReports[projectionReports.length - 1] : null,
  };
  if (projectionReports.length) {
    const p = projectionReports[projectionReports.length - 1];
    console.log(
      `render projection: projecting ${p.projecting} reason ${p.reasonCode}${p.reason ? ` (${p.reason})` : ""} sourceRenderables ${p.sourceRenderables} drawsPlanned ${p.drawsPlanned} batches ${p.batches} instanced ${p.instancedBatches} material ${p.materialBatches} exact ${p.exactObjects}`,
    );
  } else {
    console.log("render projection: no TN_RENDER_PROJECTION marker captured (verdict may not have changed during the run)");
  }
  if (frameBudgetLatest) {
    const p = frameBudgetLatest.phases || {};
    const su = frameBudgetLatest.surface || {};
    console.log(
      `frame budget window ${frameBudgetLatest.window}: fps ${frameBudgetLatest.fps} frames ${frameBudgetLatest.frames} hitches ${frameBudgetLatest.hitches} | phases update ${p.update?.mean}ms render ${p.render?.mean}ms overlay ${p.overlay?.mean}ms residual ${p.residual?.mean}ms hostGap ${p.hostGap?.mean}ms | surface scale ${su.resolutionScale} (${su.scaleSource}) ${su.drawingBufferWidth}x${su.drawingBufferHeight} msaa ${su.sampleCount} atFloor ${su.atFloor} | gpuMs ${frameBudgetLatest.gpuMs ?? "n/a"}`,
    );
    console.log(`frame budget windows captured: ${frameBudgetWindows.length}; hitch markers: ${frameHitches.length}`);
  } else {
    console.log(`frame budget: UNAVAILABLE — ${report.frameBudget.unavailableReason}`);
  }

  // Browser errors fail the run.
  assert.deepEqual(errors, [], `browser console/page errors: ${JSON.stringify(errors)}`);
} finally {
  report.consoleErrors = errors;
  await writeFile(join(OUT, "battle-profile.json"), JSON.stringify(report, null, 2));
  console.log(`report written to ${join(OUT, "battle-profile.json")}${errors.length ? ` (${errors.length} console/page errors)` : ""}`);
  await browser.close();
}
