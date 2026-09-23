/**
 * Fighter target-selection equivalence: the O(n) per-step selection must return exactly the same
 * target as the old per-fighter full-fleet scans. This runs one seeded `Battle` to 60+ airborne
 * and then several simulated minutes of fighting, hashing every aircraft's target id, position and
 * heading each step, and asserts the hash sequences are identical.
 *
 * The "old" selection is the `tactics.ts` at `MIDWAY_TACTICS_OLD_REF` (default `HEAD~1`, the commit
 * before the optimization). Both bundles are built from the same `src/sim` tree except that file,
 * so any difference in the hash sequence is the selection, not the environment.
 *
 * Run: node scripts/check-tactics-equivalence.mjs
 */
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { build } from "esbuild";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const STEP = 1 / 60;
const SEED = 19420601;
/** Grow to the fleet cap so the run starts with 60+ airborne, then keep fighting. */
const TARGET = 68;
const BUILD_STEPS_MAX = Math.round(300 / STEP);
/** Several simulated minutes of fighting, hashed step by step. */
const FLIGHT_STEPS = Math.round(240 / STEP);
const ROLES = ["fighter", "bomber", "torpedo"];

async function bundle(entry, nodePaths) {
  const built = await build({
    entryPoints: [entry],
    absWorkingDir: root,
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node20",
    write: false,
    logLevel: "silent",
    nodePaths,
  });
  return built.outputFiles[0].text;
}

async function load(text) {
  return import(`data:text/javascript,${encodeURIComponent(text)}`);
}

/** One canonical line per aircraft: id, ship target, air target, position and heading. */
function hashStep(b) {
  let s = "";
  for (const a of b.aircraft) {
    s += `${a.id}|${a.target ?? ""}|${a.airTarget ?? ""}|${a.x}|${a.y}|${a.z}|${a.heading};`;
  }
  return createHash("sha256").update(s).digest("hex");
}

/** Grow a real battle to `TARGET` airborne through `Battle.launch`, then fly and hash each step. */
function scenario(Battle) {
  const b = new Battle(SEED);
  b.start(false);
  let attempt = 0;
  let buildSteps = 0;
  while (b.activeAircraft < TARGET && buildSteps < BUILD_STEPS_MAX) {
    for (const s of b.ships) {
      if (b.activeAircraft >= TARGET) break;
      if (s.kind !== "carrier" || s.sunk || !s.air) continue;
      for (let k = 0; k < ROLES.length; k += 1) {
        if (b.launch(s, ROLES[(attempt + k) % ROLES.length])) break;
      }
      attempt += 1;
    }
    b.step(STEP, {});
    buildSteps += 1;
  }
  const built = b.activeAircraft;
  const hashes = [];
  let peak = built;
  for (let i = 0; i < FLIGHT_STEPS; i += 1) {
    b.step(STEP, {});
    hashes.push(hashStep(b));
    peak = Math.max(peak, b.activeAircraft);
  }
  const rolling = createHash("sha256").update(hashes.join("\n")).digest("hex");
  return { built, peak, steps: hashes.length, rolling, hashes };
}

/** The old `tactics.ts`, checked out beside the current one so esbuild resolves the same tree. */
function oldTree() {
  const ref = process.env.MIDWAY_TACTICS_OLD_REF || "HEAD~1";
  const oldRoot = "/tmp/opencode/tactics-equivalence-old";
  rmSync(oldRoot, { recursive: true, force: true });
  mkdirSync(oldRoot, { recursive: true });
  cpSync(resolve(root, "src/sim"), resolve(oldRoot, "sim"), { recursive: true });
  const old = execFileSync("git", ["show", `${ref}:./src/sim/tactics.ts`], { cwd: root, encoding: "utf8" });
  writeFileSync(resolve(oldRoot, "sim/tactics.ts"), old);
  return resolve(oldRoot, "sim/battle.ts");
}

const nodePaths = [resolve(root, "node_modules")];
const newMod = await load(await bundle(resolve(root, "src/sim/battle.ts"), nodePaths));
const oldMod = await load(await bundle(oldTree(), nodePaths));

const oldRun = scenario(oldMod.Battle);
const newRun = scenario(newMod.Battle);

assert.equal(
  newRun.built >= 60 && newRun.peak >= 60,
  true,
  `the scenario must have 60+ aircraft airborne, got built ${newRun.built}, peak ${newRun.peak}`,
);
assert.equal(newRun.steps, FLIGHT_STEPS, "the run must cover the full simulated window");
assert.equal(
  oldRun.hashes.length,
  newRun.hashes.length,
  `the two runs must cover the same number of steps (old ${oldRun.hashes.length}, new ${newRun.hashes.length})`,
);
let diverge = -1;
for (let i = 0; i < oldRun.hashes.length; i += 1) {
  if (oldRun.hashes[i] !== newRun.hashes[i]) {
    diverge = i;
    break;
  }
}
assert.equal(
  diverge,
  -1,
  `target selection diverged at step ${diverge} (${(diverge * STEP).toFixed(2)} s): ` +
    `old ${oldRun.hashes[diverge]} new ${newRun.hashes[diverge]}`,
);

console.log(
  `check-tactics-equivalence: seed ${SEED}, built to ${newRun.built} airborne (peak ${newRun.peak}), ` +
    `${newRun.steps} steps (${((newRun.steps * STEP) / 60).toFixed(1)} simulated minutes)`,
);
console.log(`check-tactics-equivalence: old ${oldRun.rolling}`);
console.log(`check-tactics-equivalence: new ${newRun.rolling}`);
console.log(`check-tactics-equivalence: PASS — ${newRun.steps} per-step hashes identical`);
