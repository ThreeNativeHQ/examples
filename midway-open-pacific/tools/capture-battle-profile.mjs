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
 */
import assert from "node:assert/strict";
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
const ALTITUDE = Number(process.env.MIDWAY_BATTLE_ALTITUDE || 1800);
const STANDOFF = Number(process.env.MIDWAY_BATTLE_STANDOFF || 2400);
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
const browser = await chromium.launch({
  headless: false,
  args: browserArgs,
});
const errors = [];
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

  // Browser errors fail the run.
  assert.deepEqual(errors, [], `browser console/page errors: ${JSON.stringify(errors)}`);
} finally {
  report.consoleErrors = errors;
  await writeFile(join(OUT, "battle-profile.json"), JSON.stringify(report, null, 2));
  console.log(`report written to ${join(OUT, "battle-profile.json")}${errors.length ? ` (${errors.length} console/page errors)` : ""}`);
  await browser.close();
}
