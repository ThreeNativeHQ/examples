/**
 * Run this game's proofs.
 *
 * Each scenario gets its own URL, because a first-person game cannot be aimed from outside itself:
 * CDP mouse deltas read zero without OS focus, so there is no way to script a look. Spawn position
 * and facing are delivered through the scene's `?spawn=x,z,yaw` override instead — which is also
 * what keeps `discover` from having to walk thirty-six metres through a wood to reach the thing it
 * is testing, a walk that would break every time the terrain was retuned.
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

const PORT = 5274;
const BASE = `http://127.0.0.1:${String(PORT)}/`;

/** Four metres short of the standing stone at (34, -12), facing it. */
const AT_THE_STONE = "31.2,-10.9,-1.232";

const SCENARIOS = [
  { name: "playtests/survives.playtest.json", url: BASE },
  { name: "playtests/walk.playtest.json", url: BASE },
  { name: "playtests/discover.playtest.json", url: `${BASE}?spawn=${AT_THE_STONE}` },
];

const children = [];
function start(command, args, label) {
  const child = spawn(command, args, { stdio: ["ignore", "inherit", "inherit"] });
  child.on("exit", (code) => {
    if (code !== 0 && code !== null) process.stderr.write(`[${label}] exited ${String(code)}\n`);
  });
  children.push(child);
  return child;
}

function playtest(scenario, url) {
  return new Promise((resolve) => {
    // Headed and WebGPU, under the capture lock: headless Chromium serves WebGPU from SwiftShader
    // and hands back a black canvas, so a headless run here proves nothing about what ships.
    const child = spawn(
      "tools/capture-lock.sh",
      ["npx", "threenative-playtest", "--scenario", scenario, "--browser-recipe", "webgpu", "--headed", "--url", url],
      { stdio: ["ignore", "inherit", "inherit"] },
    );
    child.on("exit", (code) => resolve(code ?? 1));
  });
}

start("npx", ["vite", "dev", "--host", "127.0.0.1", "--port", String(PORT), "--strictPort"], "vite");
await sleep(5_000);

let failures = 0;
for (const { name, url } of SCENARIOS) {
  process.stderr.write(`\n== proof: ${name} ==\n`);
  failures += (await playtest(name, url)) === 0 ? 0 : 1;
}

for (const child of children) child.kill("SIGTERM");
process.exit(failures === 0 ? 0 : 1);
