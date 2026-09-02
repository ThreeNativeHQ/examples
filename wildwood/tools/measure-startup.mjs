/**
 * Cold-start measurement: how long until the valley is playable, and what the player sees first.
 *
 * Runs N cold browser contexts (no cache, fresh profile each) against a dev server, headed with
 * WebGPU under the capture lock's private display, and records per run:
 *   - navigation → DOMContentLoaded, every `TN_*` console marker with its wall time,
 *     `window.__TN_STARTUP_READY__` (the engine's readiness global), and `TN_VALLEY_BUILT`;
 *   - transferred bytes, the ten largest resources, and the bytes that landed before the valley
 *     was built (the "critical" transfer) versus in total;
 *   - a coarse frame sample every 200 ms: mean RGB of a screenshot, so the first frame is
 *     classified as white/blank, authored loading view, or world.
 * Writes artifacts/startup/<label>.json plus a Markdown table to stdout.
 *
 *   tools/capture-lock.sh node tools/measure-startup.mjs --runs 5 --label baseline [--query "?lowtier"]
 */
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";
import { chromium } from "playwright";
import { createRequire } from "node:module";

// pngjs ships with the installed playtest package; this tool borrows it rather than adding a
// dependency the game itself never needs.
const { PNG } = createRequire(import.meta.resolve("@threenative/playtest"))("pngjs");

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback;
};
const RUNS = Number(opt("runs", "3"));
const LABEL = opt("label", "run");
const QUERY = opt("query", "");
const PORT = Number(opt("port", "5279"));
const READY_TIMEOUT_MS = Number(opt("timeout", "60000"));
const BASE = `http://127.0.0.1:${PORT}/${QUERY}`;

const WEBGPU_ARGS = [
  "--ozone-platform=x11",
  "--enable-unsafe-webgpu",
  "--disable-gpu-sandbox",
  "--ignore-gpu-blocklist",
  "--enable-features=Vulkan",
];

function startVite() {
  const child = spawn(
    "npx",
    ["vite", "dev", "--host", "127.0.0.1", "--port", String(PORT), "--strictPort"],
    { stdio: ["ignore", "pipe", "inherit"] },
  );
  child.stdout.on("data", () => undefined);
  return child;
}

async function waitForServer(url, ms) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      /* not yet */
    }
    await sleep(250);
  }
  throw new Error(`dev server did not answer at ${url}`);
}

/** Mean RGB and the fraction of near-white pixels of a PNG buffer. */
function classify(png) {
  const img = PNG.sync.read(png);
  let r = 0;
  let g = 0;
  let b = 0;
  let white = 0;
  const n = img.width * img.height;
  for (let i = 0; i < n; i += 1) {
    const R = img.data[i * 4];
    const G = img.data[i * 4 + 1];
    const B = img.data[i * 4 + 2];
    r += R;
    g += G;
    b += B;
    if (R > 235 && G > 235 && B > 235) white += 1;
  }
  const mean = [r / n, g / n, b / n].map((v) => Math.round(v));
  return { mean, whiteRatio: Number((white / n).toFixed(3)) };
}

async function oneRun(browser, index) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();
  // Cold: no cache between runs, and the dev server's module graph is already warm, so what is
  // measured is the bytes and the work, not Vite's first transform.
  await context.route("**/*", (route) => route.continue());
  const cdp = await context.newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
  await cdp.send("Network.clearBrowserCache");

  const t0 = Date.now();
  const markers = [];
  const resources = new Map();
  let bytes = 0;
  page.on("console", (message) => {
    const text = message.text();
    if (/^TN_[A-Z_]+/.test(text) || /^\[animals\]/.test(text)) {
      markers.push({ t: Date.now() - t0, text: text.slice(0, 120) });
    }
  });
  cdp.on("Network.responseReceived", (event) => {
    resources.set(event.requestId, { url: event.response.url, size: 0, t: Date.now() - t0 });
  });
  cdp.on("Network.loadingFinished", (event) => {
    const entry = resources.get(event.requestId);
    if (entry === undefined) return;
    entry.size = event.encodedDataLength;
    entry.done = Date.now() - t0;
    bytes += event.encodedDataLength;
  });

  const frames = [];
  let sampling = true;
  const sampler = (async () => {
    while (sampling) {
      try {
        const shot = await page.screenshot({ type: "png", scale: "css" });
        frames.push({ t: Date.now() - t0, ...classify(shot) });
      } catch {
        /* page navigating */
      }
      await sleep(200);
    }
  })();

  await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: READY_TIMEOUT_MS });
  const dcl = Date.now() - t0;
  await page.waitForFunction(() => window.__TN_STARTUP_READY__ === true, undefined, {
    timeout: READY_TIMEOUT_MS,
    polling: 50,
  });
  const readyAt = Date.now() - t0;
  // Let late detail land so the total transfer is honest.
  await sleep(4000);
  sampling = false;
  await sampler;

  const adapter = await page.evaluate(async () => {
    const a = await navigator.gpu?.requestAdapter();
    const info = a?.info ?? {};
    return `${info.vendor ?? "?"} | ${info.architecture ?? "?"} | ${info.device ?? ""} ${info.description ?? ""}`.trim();
  });

  const valley = markers.find((m) => m.text.startsWith("TN_VALLEY_BUILT"))?.t ?? -1;
  const firstNonWhite = frames.find((f) => f.whiteRatio < 0.9)?.t ?? -1;
  const firstFrame = frames[0];
  const criticalBytes = [...resources.values()]
    .filter((r) => r.done !== undefined && valley >= 0 && r.done <= valley)
    .reduce((s, r) => s + r.size, 0);
  const largest = [...resources.values()]
    .sort((a, b) => b.size - a.size)
    .slice(0, 10)
    .map((r) => ({ url: r.url.replace(/^https?:\/\/[^/]+/, ""), mb: Number((r.size / 1e6).toFixed(2)), doneAt: r.done }));

  await context.close();
  return {
    index,
    adapter,
    dclMs: dcl,
    valleyBuiltMs: valley,
    startupReadyMs: readyAt,
    firstNonWhiteFrameMs: firstNonWhite,
    firstFrame,
    totalMb: Number((bytes / 1e6).toFixed(2)),
    criticalMb: Number((criticalBytes / 1e6).toFixed(2)),
    markers,
    frames: frames.slice(0, 60),
    largest,
  };
}

const vite = startVite();
try {
  await waitForServer(`http://127.0.0.1:${PORT}/`, 30_000);
  const browser = await chromium.launch({ headless: false, args: WEBGPU_ARGS });
  const runs = [];
  for (let i = 0; i < RUNS; i += 1) {
    runs.push(await oneRun(browser, i));
    process.stderr.write(
      `run ${i + 1}/${RUNS}: dcl ${runs[i].dclMs} ms, valley ${runs[i].valleyBuiltMs} ms, ready ${runs[i].startupReadyMs} ms, first non-white ${runs[i].firstNonWhiteFrameMs} ms, ${runs[i].totalMb} MB\n`,
    );
  }
  await browser.close();

  const p95 = (values) => {
    const s = [...values].sort((a, b) => a - b);
    return s[Math.min(s.length - 1, Math.ceil(0.95 * s.length) - 1)];
  };
  const med = (values) => {
    const s = [...values].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
  };
  const summary = {
    label: LABEL,
    url: BASE,
    adapter: runs[0]?.adapter,
    runs: RUNS,
    startupReadyMs: { median: med(runs.map((r) => r.startupReadyMs)), p95: p95(runs.map((r) => r.startupReadyMs)) },
    valleyBuiltMs: { median: med(runs.map((r) => r.valleyBuiltMs)), p95: p95(runs.map((r) => r.valleyBuiltMs)) },
    firstNonWhiteFrameMs: { median: med(runs.map((r) => r.firstNonWhiteFrameMs)) },
    totalMb: med(runs.map((r) => r.totalMb)),
    criticalMb: med(runs.map((r) => r.criticalMb)),
  };
  await mkdir("artifacts/startup", { recursive: true });
  await writeFile(`artifacts/startup/${LABEL}.json`, JSON.stringify({ summary, runs }, null, 2));
  console.log(`\n## startup ${LABEL} — ${summary.adapter}\n`);
  console.log("| run | DCL | valley built | startup ready | first non-white frame | total MB | critical MB |");
  console.log("|---|---:|---:|---:|---:|---:|---:|");
  for (const r of runs) {
    console.log(`| ${r.index + 1} | ${r.dclMs} | ${r.valleyBuiltMs} | ${r.startupReadyMs} | ${r.firstNonWhiteFrameMs} | ${r.totalMb} | ${r.criticalMb} |`);
  }
  console.log(`| **p95** | | ${summary.valleyBuiltMs.p95} | ${summary.startupReadyMs.p95} | | | |`);
  console.log("\nmarkers (run 1):");
  for (const m of runs[0].markers) console.log(`  ${String(m.t).padStart(6)} ms  ${m.text}`);
  console.log("\nlargest resources (run 1):");
  for (const l of runs[0].largest) console.log(`  ${String(l.mb).padStart(7)} MB  done ${l.doneAt} ms  ${l.url}`);
  console.log("\nfirst frames (run 1):");
  for (const f of runs[0].frames.slice(0, 12)) console.log(`  ${String(f.t).padStart(6)} ms  mean ${f.mean.join(",")}  white ${f.whiteRatio}`);
} finally {
  vite.kill("SIGTERM");
}
