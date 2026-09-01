/**
 * Run this game's proofs.
 *
 * Two lanes, and they are not interchangeable. `office.playtest.json` runs against the scripted
 * fixture bridge, so arrivals, departures and the blocked state are proved the same way on any
 * machine. `office-live.playtest.json` runs against whatever the real bridge sees, which is the
 * only thing that can show the office is wired to this machine at all — and which says nothing on
 * a machine with no agents running, so it is reported as skipped rather than passed.
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

const FIXTURE_PORT = 7374;
/**
 * The pose fixture's port.
 *
 * A second scripted bridge, because the arrival/departure script never moves a session between two
 * *seated* states — so `SitToType` and `TypeToSit` never run under it, and two of the four sit/stand
 * one-shots were unproven. `tools/office-bridge/fixture-poses.ts` drives all four.
 */
const POSE_FIXTURE_PORT = 7375;
const children = [];

function start(command, args, label) {
  const child = spawn(command, args, { stdio: ["ignore", "inherit", "inherit"] });
  child.on("exit", (code) => {
    if (code !== 0 && code !== null) process.stderr.write(`[${label}] exited ${String(code)}\n`);
  });
  children.push(child);
  return child;
}

async function liveSessions() {
  try {
    const response = await fetch("http://127.0.0.1:7373/health", { signal: AbortSignal.timeout(800) });
    const body = await response.json();
    return typeof body.sessions === "number" ? body.sessions : 0;
  } catch {
    return 0;
  }
}

function playtest(scenario, url) {
  return new Promise((resolve) => {
    const child = spawn(
      "npx",
      [
        "threenative-playtest",
        "--scenario",
        scenario,
        "--browser-recipe",
        "webgpu",
        "--headed",
        "--url",
        url,
      ],
      { stdio: ["ignore", "inherit", "inherit"] },
    );
    child.on("exit", (code) => resolve(code ?? 1));
  });
}

const port = 5273;
start("npx", ["vite", "dev", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], "vite");
start("npx", ["tsx", "tools/office-bridge/fixture.ts"], "fixture");
start("npx", ["tsx", "tools/office-bridge/fixture-poses.ts"], "pose-fixture");
await sleep(4_000);

let failures = 0;
const fixtureUrl = `http://127.0.0.1:${String(port)}/?bridge=ws://127.0.0.1:${String(FIXTURE_PORT)}/office`;
for (const scenario of [
  "playtests/office.playtest.json",
  "playtests/visitor.playtest.json",
  "playtests/office-animation.playtest.json",
]) {
  process.stderr.write(`\n== proof: ${scenario} against a scripted bridge ==\n`);
  failures += (await playtest(scenario, fixtureUrl)) === 0 ? 0 : 1;
}

// The pose lane. Its scenario samples `focusClip` at two labelled ticks either side of the last
// chair<->keyboard one-shot, which is the only thing here that can tell a transition that ended
// because its clip finished from one that ended because Worker's 2.5 s timeout rescued it.
const poseUrl = `http://127.0.0.1:${String(port)}/?bridge=ws://127.0.0.1:${String(POSE_FIXTURE_PORT)}/office`;
process.stderr.write("\n== proof: playtests/office-poses.playtest.json against the pose bridge ==\n");
failures += (await playtest("playtests/office-poses.playtest.json", poseUrl)) === 0 ? 0 : 1;

const live = await liveSessions();
if (live > 0) {
  process.stderr.write(`\n== proof: the office against this machine (${String(live)} sessions) ==\n`);
  failures += (await playtest("playtests/office-live.playtest.json", `http://127.0.0.1:${String(port)}/`)) === 0 ? 0 : 1;
} else {
  process.stderr.write(
    "\n== skipped: no live bridge on 127.0.0.1:7373, so the machine lane proves nothing ==\n",
  );
}

for (const child of children) child.kill("SIGTERM");
process.exit(failures === 0 ? 0 : 1);
