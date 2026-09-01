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
await sleep(4_000);

let failures = 0;
process.stderr.write("\n== proof: the office against a scripted bridge ==\n");
failures += (await playtest(
  "playtests/office.playtest.json",
  `http://127.0.0.1:${String(port)}/?bridge=ws://127.0.0.1:${String(FIXTURE_PORT)}/office`,
)) === 0
  ? 0
  : 1;

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
