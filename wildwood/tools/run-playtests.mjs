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
import { access, mkdir, writeFile } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";

const PORT = 5274;
const BASE = `http://127.0.0.1:${String(PORT)}/`;
const STARTUP_ARTIFACT = "artifacts/startup/phase0-lowtier.json";
const ANIMALS_ARTIFACT = "artifacts/animals/browser-observation.json";
const ANIMALS_SCREENSHOT = "artifacts/animals/browser-observation.png";
const cliArgs = process.argv.slice(2);

/** Four metres short of the standing stone at (34, -12), facing it. */
const AT_THE_STONE = "31.2,-10.9,-1.232";

const SCENARIOS = [
  { name: "playtests/startup.playtest.json", url: `${BASE}?lowtier` },
  { name: "playtests/survives.playtest.json", url: BASE },
  { name: "playtests/walk.playtest.json", url: BASE },
  {
    name: "playtests/discover.playtest.json",
    url: `${BASE}?spawn=${AT_THE_STONE}`,
  },
];

const children = [];
function start(command, args, label) {
  const child = spawn(command, args, {
    stdio: ["ignore", "inherit", "inherit"],
  });
  child.on("exit", (code) => {
    if (code !== 0 && code !== null)
      process.stderr.write(`[${label}] exited ${String(code)}\n`);
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
      [
        "npx",
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

function run(command, args, label) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "inherit", "inherit"],
    });
    child.on("error", (error) => {
      process.stderr.write(`[${label}] ${error.message}\n`);
      resolve(1);
    });
    child.on("exit", (code) => resolve(code ?? 1));
  });
}

function option(name, fallback) {
  const index = cliArgs.indexOf(`--${name}`);
  return index >= 0 && cliArgs[index + 1] !== undefined
    ? cliArgs[index + 1]
    : fallback;
}

function finiteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function validateAnimalObservation(observation) {
  if (observation?.version !== 2 || observation.status !== "ready") {
    throw new Error(
      "required browser animal observation is missing its version-2 ready marker",
    );
  }
  if (
    !Array.isArray(observation.subjects) ||
    observation.subjects.length !== 6
  ) {
    throw new Error(
      `required browser animal subjects: expected six, got ${observation?.subjects?.length ?? "missing"}`,
    );
  }
  for (const subject of observation.subjects) {
    if (
      typeof subject.id !== "string" ||
      typeof subject.logicalPath !== "string" ||
      !finiteNumber(subject.displacementMeters) ||
      subject.displacementMeters <= 0 ||
      !finiteNumber(subject.movingSamples) ||
      subject.movingSamples <= 0 ||
      !finiteNumber(subject.modelForwardDot?.minimum) ||
      !finiteNumber(subject.modelForwardDot?.mean) ||
      !finiteNumber(subject.modelForwardDot?.maximum) ||
      !finiteNumber(subject.modelForwardDot?.negativeSamples) ||
      subject.modelForwardReference?.kind !== "head-minus-pelvis" ||
      !subject.modelForwardReference?.head?.endsWith("_-Head") ||
      !subject.modelForwardReference?.pelvis?.endsWith("_-Pelvis") ||
      !finiteNumber(subject.waterOverlap?.lakeSamples) ||
      !finiteNumber(subject.waterOverlap?.pondSamples)
    ) {
      throw new Error(
        `required browser animal fields are missing or non-finite for '${subject?.id ?? "unknown"}'`,
      );
    }
  }
}

async function captureAnimals() {
  const { chromium } = await import("playwright");
  const url = option("url", `${BASE}dev-animals.html`);
  const timeout = Number(option("observation-timeout", "90000"));
  if (!Number.isFinite(timeout) || timeout < 1)
    throw new Error("--observation-timeout must be positive");
  const browser = await chromium.launch({
    headless: false,
    args: [
      "--ozone-platform=x11",
      "--enable-unsafe-webgpu",
      "--disable-gpu-sandbox",
      "--ignore-gpu-blocklist",
      "--enable-features=Vulkan",
    ],
  });
  try {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 720 },
    });
    const page = await context.newPage();
    const diagnostics = [];
    page.on("console", (message) => {
      if (["warning", "error"].includes(message.type())) {
        diagnostics.push({
          type: "console",
          level: message.type(),
          text: message.text(),
        });
      }
    });
    page.on("pageerror", (error) =>
      diagnostics.push({
        type: "pageerror",
        text: error.stack ?? error.message,
      }),
    );
    await page.goto(url, { waitUntil: "commit", timeout });
    await page.waitForFunction(
      () => globalThis.__TN_ANIMALS_OBSERVATION__ !== undefined,
      undefined,
      {
        timeout,
        polling: 50,
      },
    );
    const observation = await page.evaluate(
      () => globalThis.__TN_ANIMALS_OBSERVATION__,
    );
    validateAnimalObservation(observation);
    if (cliArgs.includes("--require-forward")) {
      const backwards = observation.subjects
        .filter((subject) => subject.modelForwardDot.mean < 0)
        .map((subject) => subject.id);
      if (backwards.length > 0) {
        throw new Error(
          `TN_ANIMAL_BACKWARDS: ${backwards.join(",")} have negative head-minus-pelvis movement dots`,
        );
      }
    }
    const expectedCorruption = option("expect-forward-corruption", undefined);
    if (expectedCorruption !== undefined) {
      const corruption =
        observation.controls?.rigYawCorruptionRadians?.[expectedCorruption];
      if (corruption !== Math.PI) {
        throw new Error(
          `required ${expectedCorruption} rig-yaw corruption marker is missing`,
        );
      }
      const subject = observation.subjects.find(
        (candidate) => candidate.id === expectedCorruption,
      );
      if (subject === undefined) {
        throw new Error(
          `required forward-corruption subject is missing: ${expectedCorruption}`,
        );
      }
      if (subject.modelForwardDot.mean <= 0) {
        throw new Error(
          `required ${expectedCorruption} π rig-yaw corruption to flip forward; mean=${String(subject.modelForwardDot.mean)}`,
        );
      }
      console.log(
        `TN_ANIMAL_FORWARD_CORRUPTION:${expectedCorruption} mean=${String(subject.modelForwardDot.mean)}`,
      );
    }
    await page.waitForTimeout(1_000);
    const adapter = await page.evaluate(async () => {
      const gpu = await navigator.gpu?.requestAdapter();
      if (gpu === null || gpu === undefined) return undefined;
      const info = gpu.info ?? {};
      return {
        vendor: info.vendor ?? "",
        architecture: info.architecture ?? "",
        device: info.device ?? "",
        description: info.description ?? "",
      };
    });
    if (
      adapter === undefined ||
      !Object.values(adapter).some((value) => value.length > 0)
    ) {
      throw new Error(
        "required browser animal WebGPU adapter observation is missing",
      );
    }
    await mkdir("artifacts/animals", { recursive: true });
    await page.screenshot({ path: ANIMALS_SCREENSHOT, type: "png" });
    await access(ANIMALS_SCREENSHOT);
    const artifact = {
      version: 1,
      url,
      viewport: { width: 1280, height: 720 },
      adapter,
      screenshot: ANIMALS_SCREENSHOT,
      diagnostics,
      observation,
    };
    await writeFile(ANIMALS_ARTIFACT, `${JSON.stringify(artifact, null, 2)}\n`);
    console.log(`TN_ANIMAL_BROWSER_CAPTURE:${ANIMALS_ARTIFACT}`);
    await context.close();
  } finally {
    await browser.close();
  }
}

if (cliArgs.includes("--capture-animals")) {
  await captureAnimals();
  process.exit(0);
}

process.stderr.write(`\n== proof: cold startup (${STARTUP_ARTIFACT}) ==\n`);
let failures =
  (await run(
    "tools/capture-lock.sh",
    [
      "node",
      "tools/measure-startup.mjs",
      "--runs",
      "5",
      "--label",
      "phase0-lowtier",
      "--query",
      "?lowtier",
      "--timeout",
      "90000",
    ],
    "cold-start",
  )) === 0
    ? 0
    : 1;

start(
  "npx",
  [
    "vite",
    "dev",
    "--host",
    "127.0.0.1",
    "--port",
    String(PORT),
    "--strictPort",
  ],
  "vite",
);
await sleep(5_000);

for (const { name, url } of SCENARIOS) {
  process.stderr.write(`\n== proof: ${name} ==\n`);
  failures += (await playtest(name, url)) === 0 ? 0 : 1;
}

process.stderr.write(`\n== proof: browser animals (${ANIMALS_ARTIFACT}) ==\n`);
failures +=
  (await run(
    "tools/capture-lock.sh",
    [
      "node",
      "tools/run-playtests.mjs",
      "--capture-animals",
      "--url",
      `${BASE}dev-animals.html`,
    ],
    "browser-animals",
  )) === 0
    ? 0
    : 1;

for (const child of children) child.kill("SIGTERM");
process.exit(failures === 0 ? 0 : 1);
