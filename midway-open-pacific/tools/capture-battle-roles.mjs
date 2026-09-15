/**
 * The role-flow capture for PRD-midway-asset-battle-integration AC-21.
 *
 * AC-21 asks which roles the five named natural seed runs happen to show, and then that every
 * remaining role is reachable through a bounded scenario. This tool is the first half only: it
 * runs those seeds, folds whatever the simulation actually produced into a `RoleTally` through the
 * pure `src/sim/seeded-battle.ts` module, and reports the roles it did NOT see.
 *
 * Three rules the code enforces on purpose:
 *
 *  - A missing role is a REPORT, never a failure. AC-21 is explicit that rare events need not
 *    appear in five arbitrary runs, so `rolesMissing` is printed and the tool still passes.
 *  - The paired comparison injects exactly one intervention through normal Battle entry (one more
 *    armed bomber through `Battle.launch`); a role that is identical in both runs is the visible
 *    "the intervention did nothing" finding, not a crash.
 *  - Determinism is the one HARD assertion: the same seed and input trace (same fixed step, empty
 *    input, zero further intervention) must digest to the same string twice. If that ever breaks,
 *    the tool fails, because every other number here rests on it.
 *
 * Copy conventions from tools/capture-deck.mjs (reach the running scene through its own loaded
 * module URL) and tools/capture-fleet.mjs (the simpler PASS shape). The bounded battles are pure
 * simulation, so they do not need the renderer; frames are captured afterwards from the game's own
 * world by replaying the seed to each role's first occurrence, as AC-21 asks for something to look
 * at. Run it through `bash tools/capture-lock.sh` and never xvfb-run: headed WebGPU only.
 */
import assert from "node:assert/strict";
import { mkdir, readdir, rm } from "node:fs/promises";
import { chromium } from "playwright";

const URL = process.env.MIDWAY_URL || "http://127.0.0.1:5301";
const OUT = process.env.MIDWAY_SHOTS || "screenshots";
// The bounded natural run per seed. AC-21 fixes the seeds, not the length; this is long enough for
// reports, intercepts and submarine attacks to happen naturally and short enough to stay bounded.
const MINUTES = Number(process.env.MIDWAY_ROLE_MINUTES || 12);
const DT = 1 / 30;
const STEPS = Math.round((MINUTES * 60) / DT);
// A state sample per simulated second, for traceDigest. Dense enough that one changed value shows.
const SAMPLE_EVERY = Math.round(1 / DT);

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
const log = (stage, detail) => console.log(`${stage.padEnd(28)} ${JSON.stringify(detail)}`);

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await page.goto(URL);
  // The startup gate, not a fixed timeout: the framework raises this once the scene is enter()ed
  // and the first update has built the world, which is exactly when a battle exists to observe.
  await page.waitForFunction(() => window.__TN_STARTUP_READY__ === true, null, { timeout: 180000 });
  await page.waitForSelector("#briefing:not(.hidden)");
  // The same reach-the-running-scene dance the other capture tools use: Vite can leave several
  // `game.ts?t=` entries behind and only the one the page actually started has a live battle.
  await page.evaluate(async () => {
    const urls = performance
      .getEntriesByType("resource")
      .map((e) => e.name)
      .filter((n) => /\/src\/game\.ts(?:\?|$)/.test(n))
      .reverse();
    for (const url of urls) {
      const scene = (await import(url)).default.scene;
      if (scene?.battle) {
        window.midway = scene;
        return;
      }
    }
    throw new Error(`No loaded game module holds a running scene; tried ${urls.length}: ${urls.join(", ")}`);
  });
  const adapter = await page.evaluate(async () => {
    const a = await navigator.gpu.requestAdapter();
    return a ? { vendor: a.info.vendor, architecture: a.info.architecture } : null;
  });
  assert.ok(
    adapter?.vendor && !/swiftshader|lavapipe|llvmpipe/i.test(JSON.stringify(adapter)),
    `a hardware WebGPU adapter is required: ${JSON.stringify(adapter)}`,
  );
  log("adapter", adapter);

  // Re-import the game's own modules rather than copying their numbers: `battle.ts` is already in
  // the page's module graph, and `seeded-battle.ts` has no runtime imports so it loads over Vite.
  await page.evaluate(async () => {
    const find = (path) =>
      performance
        .getEntriesByType("resource")
        .map((e) => e.name)
        .findLast((n) => n.includes(path));
    window.__mod = async (path) => {
      const url = find(path);
      return url ? import(url) : import(path);
    };
    const battle = await window.__mod("/src/sim/battle.ts");
    const sb = await window.__mod("/src/sim/seeded-battle.ts");
    window.__Battle = battle.Battle;
    window.__sb = sb;
  });
  const seeds = await page.evaluate(() => [...window.__sb.SEEDS]);
  assert.deepEqual(seeds, [19420604, 19420605, 19420606, 19420607, 19420608], "the five named seeds");
  log("seeds", seeds);

  /**
   * One bounded natural battle. Everything the tally reads is an entry into the simulation or a
   * transition between two of its own states; nothing is written to a task or AI field. The one
   * optional intervention is a single `Battle.launch` of an armed bomber, retried step by step
   * until the deck allows it, which is the normal carrier-ops entry and no other change.
   */
  const runSeed = (seed, intervention) =>
    page.evaluate(
      async ({ seed, steps, intervention, sampleEvery, dt }) => {
        const b = new window.__Battle(seed);
        const sb = window.__sb;
        let tally = sb.newTally();
        const firstStep = {};
        const trace = [];
        let stepIndex = 0;
        let interventionLaunched = false;
        let interventionStep = null;
        const push = (event) => {
          const before = tally;
          tally = sb.observeRole(before, event);
          for (const role of sb.ROLES)
            if (tally[role] > before[role] && firstStep[role] === undefined) firstStep[role] = stepIndex;
        };

        // Public entry points, wrapped only to observe. A null launch stays silent because nothing
        // entered the world.
        const launch = b.launch.bind(b);
        b.launch = (s, role) => {
          const before = b.aircraft.length;
          const out = launch(s, role);
          if (out && b.aircraft.length > before) push({ type: "launch", role: role ?? "fighter" });
          return out;
        };
        const fileReport = b.fileReport.bind(b);
        b.fileReport = (team, observer, target) => {
          push({ type: "report", delivered: false });
          return fileReport(team, observer, target);
        };
        const deliverReports = b.deliverReports.bind(b);
        b.deliverReports = () => {
          const before = b.reports.length;
          const out = deliverReports();
          const delivered = before - b.reports.length;
          for (let i = 0; i < delivered; i += 1) push({ type: "report", delivered: true });
          return out;
        };
        const spawnTorpedo = b.spawnTorpedo.bind(b);
        b.spawnTorpedo = (a, heading, options = {}) => {
          const out = spawnTorpedo(a, heading, options);
          if (a && a.kind === "sub" && !options.aerial)
            push({ type: "submarine", mode: (a.sub && a.sub.mode) || "periscope", fired: true });
          return out;
        };
        const event = b.event.bind(b);
        b.event = (type, data = {}) => {
          if (type === "facility") push({ type: "facility", kind: data.kind, damage: data.damage });
          return event(type, data);
        };

        // Transition sampling for the module states that carry a phase rather than an event.
        const lastTactic = new Map();
        const lastRescue = new Map();
        const lastAssist = new Map();
        const sweep = () => {
          for (const a of b.aircraft) {
            const now = a.tactic;
            if (now === undefined || lastTactic.get(a.id) === now) continue;
            if (lastTactic.has(a.id)) push({ type: "tactic", tactic: now });
            lastTactic.set(a.id, now);
          }
          for (const s of b.ships) {
            const rp = s.rescue && s.rescue.phase;
            if (rp && lastRescue.get(s.id) !== rp) {
              if (lastRescue.has(s.id)) push({ type: "rescue", phase: rp });
              lastRescue.set(s.id, rp);
            }
            const ap = s.assist && s.assist.phase;
            if (ap && lastAssist.get(s.id) !== ap) {
              if (lastAssist.has(s.id)) push({ type: "assist", phase: ap });
              lastAssist.set(s.id, ap);
            }
          }
        };
        // A compact, JSON-safe slice of the live state. Same seed and same input trace must
        // serialise byte for byte; a single altered number changes the digest.
        const sample = () => ({
          t: +b.time.toFixed(4),
          p: [+b.player.x.toFixed(3), +b.player.y.toFixed(3), +b.player.z.toFixed(3), +b.player.hp.toFixed(3), b.player.mode, +b.player.speed.toFixed(3)],
          air: b.aircraft.slice(0, 60).map((a) => [a.id, +a.x.toFixed(2), +a.y.toFixed(2), +a.z.toFixed(2), +a.hp.toFixed(2), a.tactic || "", a.mode || ""]),
          ships: b.ships.map((s) => [s.id, +s.hp.toFixed(2), +(s.deck ?? 0).toFixed(3), s.sunk ? 1 : 0]),
        });

        b.start(true);
        // Observe the fleet, not the unflown scout: an unattended player ditches around four
        // minutes in and `step` stops at `lost`, cutting the natural window short. Spectator is the
        // game's own mode and writes no task or AI field; it just leaves the player out of physics.
        b.player.mode = "spectator";
        for (stepIndex = 0; stepIndex < steps; stepIndex += 1) {
          b.step(dt, {});
          sweep();
          if (intervention && !interventionLaunched) {
            const a = b.launch(b.home, "bomber");
            if (a) {
              interventionLaunched = true;
              interventionStep = stepIndex;
            }
          }
          if (stepIndex % sampleEvery === 0) trace.push(sample());
        }
        return {
          seed,
          time: +b.time.toFixed(1),
          status: b.status,
          tally,
          occurred: sb.rolesOccurred(tally),
          missing: sb.rolesMissing(tally, sb.ROLES),
          firstStep,
          digest: sb.traceDigest(trace),
          interventionLaunched,
          interventionStep,
        };
      },
      { seed, steps: STEPS, intervention, sampleEvery: SAMPLE_EVERY, dt: DT },
    );

  // ── 1. The five named seeds, folded through observeRole ─────────────────────────────────────
  const results = [];
  for (const seed of seeds) {
    const r = await runSeed(seed, false);
    results.push(r);
    log(`seed ${seed}`, { simulated: r.time, status: r.status, occurred: r.occurred, missing: r.missing, digest: r.digest });
  }

  // ── 2. Repeating the seed and input trace repeats the digest. HARD assertion. ───────────────
  const repeat = await runSeed(seeds[0], false);
  log(`seed ${seeds[0]} repeat`, { digest: repeat.digest, first: results[0].digest });
  assert.equal(
    repeat.digest,
    results[0].digest,
    `repeating seed ${seeds[0]} with the same input trace repeated the state digest`,
  );
  assert.deepEqual(repeat.tally, results[0].tally, `and repeated its role tally`);
  console.log(`determinism PASS: seed ${seeds[0]} digested ${results[0].digest} twice`);

  // ── 3. One paired comparison, one intervention through normal Battle entry ──────────────────
  const paired = await runSeed(seeds[0], true);
  const comparison = await page.evaluate(
    ({ without, withIntervention }) => {
      const c = window.__sb.pairedComparison(withIntervention, without);
      return { changed: c.changed, unchanged: c.unchanged };
    },
    { without: results[0].tally, withIntervention: paired.tally },
  );
  log(`paired seed ${seeds[0]}`, {
    intervention: paired.interventionLaunched ? `Battle.launch(home,"bomber") at step ${paired.interventionStep}` : "never entered",
    changed: comparison.changed,
    unchangedCount: comparison.unchanged.length,
  });
  // The intervention must move its own corresponding outcome, or there is nothing to compare:
  // that is the finding AC-21 wants, not a failure of the run.
  const interventionMoved = comparison.changed.length > 0;
  if (!paired.interventionLaunched)
    console.log(`NOTE paired comparison: the intervention never entered (no deck slot or stores); no role could change`);
  else if (!interventionMoved)
    console.log(`NOTE paired comparison: the bomber launch changed no role count — the finding itself`);
  // Sensitivity: a digest that cannot distinguish the intervention would make the equality check
  // above vacuous. This is the second half of the determinism proof.
  assert.notEqual(
    paired.digest,
    results[0].digest,
    `a genuine one-launch intervention changes the digest (${results[0].digest} vs ${paired.digest})`,
  );

  // ── 4. Frame per distinct role seen, replayed from the game's own world ─────────────────────
  const frames = new Map();
  for (const r of results)
    for (const role of r.occurred) if (!frames.has(role)) frames.set(role, { seed: r.seed, step: r.firstStep[role] });
  const bySeed = new Map();
  for (const [role, info] of frames) {
    const list = bySeed.get(info.seed) ?? [];
    list.push({ role, step: info.step });
    bySeed.set(info.seed, list);
  }
  await mkdir(OUT, { recursive: true });
  // A frame this tool wrote last run for a role that no longer occurs must not linger and read as
  // current evidence. Only this tool's own prefix is swept.
  for (const name of await readdir(OUT))
    if (/^battle-role-.*\.png$/.test(name)) await rm(`${OUT}/${name}`);
  const captured = [];
  for (const [seed, list] of bySeed) {
    // Replay the same seed in the running world, through the same wiring the scene's own restart
    // uses. `world.reset` repoints the view and keeps the shared ship meshes; `hud.b` follows.
    await page.evaluate((seed) => {
      const scene = window.midway;
      const b = new window.__Battle(seed);
      window.__b = b;
      scene.battle = b;
      scene.world.reset(b);
      scene.hud.b = b;
      scene.paused = true;
      // The same UI transition `begin()` makes, so the frame shows the battle and not the briefing.
      document.getElementById("briefing")?.classList.add("hidden");
      document.getElementById("debrief")?.classList.add("hidden");
      document.getElementById("flight-ui")?.classList.remove("hidden");
      b.start(true);
      b.player.mode = "spectator";
      // Frame the battle, not the parked spectator: hold the world's camera off and let the
      // per-role focus below place it. `capture-fleet.mjs` freezes the same seam for its shots.
      const w = scene.world;
      if (!w.__origUpdateCamera) {
        w.__origUpdateCamera = w.updateCamera.bind(w);
        w.updateCamera = function () {
          const f = w.__focus;
          if (!f) return w.__origUpdateCamera(...arguments);
          this.camera.position.set(f.x + f.dx, f.y + f.dy, f.z + f.dz);
          this.camera.up.set(0, 1, 0);
          this.camera.lookAt(f.x, f.y, f.z);
          this.camera.fov = f.fov ?? 45;
          this.camera.updateProjectionMatrix();
          this.camera.updateMatrixWorld();
        };
      }
    }, seed);
    list.sort((x, y) => x.step - y.step);
    let cursor = 0;
    for (const { role, step } of list) {
      const shown = await page.evaluate(
        ({ target, from, role }) => {
          const b = window.__b;
          for (let i = from; i < target; i += 1) b.step(1 / 30, {});
          // Where the role happened, read from the live battle at this step. The role names the
          // subject; nothing here invents a position the simulation did not produce.
          const live = b.ships.filter((s) => !s.sunk);
          const b2 = b;
          const focusFor = () => {
            if (role === "strike-launched") {
              const s = b2.home;
              if (s) return { x: s.x, y: s.deckHeight, z: s.z, dx: 280, dy: 130, dz: 280, fov: 44 };
            }
            if (role === "submarine-attack") {
              // The subject that moved is the torpedo the boat just fired, not the boat itself:
              // a submerged sub is invisible and the frame would show an unrelated hull.
              const subIds = new Set(live.filter((x) => x.kind === "sub").map((x) => x.id));
              const t = [...b2.torpedoes].reverse().find((x) => subIds.has(x.owner));
              if (t) return { x: t.x, y: 0, z: t.z, dx: 75, dy: 28, dz: 75, fov: 35 };
              const s = live.find((x) => x.kind === "sub");
              if (s) return { x: s.x, y: 0, z: s.z, dx: 110, dy: 35, dz: 110, fov: 38 };
            }
            if (role === "rescue-started") {
              const s = live.find((x) => x.rescue);
              if (s) return { x: s.x, y: 0, z: s.z, dx: 120, dy: 45, dz: 120, fov: 38 };
            }
            if (role === "alongside-assist") {
              const s = live.find((x) => x.assist);
              if (s) return { x: s.x, y: 0, z: s.z, dx: 160, dy: 75, dz: 160, fov: 40 };
            }
            if (role === "facility-hit") {
              const i = b2.island;
              return { x: i.x, y: 20, z: i.z, dx: 320, dy: 190, dz: 320, fov: 45 };
            }
            if (role === "escort-engaged") {
              const a = b2.aircraft.find((x) => x.tactic === "intercept" || x.tactic === "escort");
              if (a) return { x: a.x, y: a.y, z: a.z, dx: 95, dy: 40, dz: 95, fov: 45 };
            }
            if (role === "contact-delivered" || role === "scout-report") {
              const c = [...b2.contacts.values()].find((x) => x.kind === "carrier");
              if (c) return { x: c.x, y: 0, z: c.z, dx: 240, dy: 130, dz: 240, fov: 45 };
            }
            const cx = live.reduce((n, s) => n + s.x, 0) / Math.max(1, live.length);
            const cz = live.reduce((n, s) => n + s.z, 0) / Math.max(1, live.length);
            return { x: cx, y: 0, z: cz, dx: 0, dy: 1600, dz: 1300, fov: 55 };
          };
          window.midway.world.__focus = focusFor();
          window.midway.world.snap = true;
          return { time: +b.time.toFixed(1), status: b.status, focus: window.midway.world.__focus };
        },
        { target: step + 1, from: cursor, role },
      );
      cursor = step + 1;
      // Two rendered frames, so the view has digested the replayed state before the shutter.
      await page.evaluate(
        () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
      );
      const path = `${OUT}/battle-role-${role}.png`;
      await page.screenshot({ path });
      captured.push({ role, seed, step, ...shown, path });
      log(`frame ${role}`, { seed, step, time: shown.time, status: shown.status });
    }
  }

  // ── Report ──────────────────────────────────────────────────────────────────────────────────
  const occurredEver = new Set(results.flatMap((r) => r.occurred));
  const allRoles = await page.evaluate(() => [...window.__sb.ROLES]);
  const missingEverywhere = allRoles.filter((role) => !occurredEver.has(role));
  console.log(`\nrole table (${MINUTES} simulated minutes per seed)`);
  for (const r of results)
    console.log(
      `  seed ${r.seed}: ${r.time}s ${r.status} | ${r.occurred.join(", ") || "(none)"} | missing: ${r.missing.join(", ") || "(none)"}`,
    );
  console.log(`  never in any of the five seeds: ${missingEverywhere.join(", ") || "(none)"}`);
  console.log(`  paired (seed ${seeds[0]}): changed [${comparison.changed.join(", ")}], ${comparison.unchanged.length} unchanged`);
  console.log(`  digests: ${results.map((r) => `${r.seed}=${r.digest}`).join(" ")} repeat(${seeds[0]})=${repeat.digest}`);
  console.log(`  frames: ${captured.length} captured into ${OUT}/`);

  assert.deepEqual(errors, []);
  console.log(
    `PASS: five seeds folded through observeRole and reported (missing roles reported, never forced); ` +
      `seed ${seeds[0]} digest reproduced twice and moved by one normal-entry bomber launch; ` +
      `${captured.length} role frames captured, no console errors`,
  );
} finally {
  await browser.close();
}
