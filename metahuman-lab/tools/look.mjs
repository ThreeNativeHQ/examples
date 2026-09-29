// Look at the finished game with no dev server in the loop: build it, serve the
// production bundle from dist/, capture one screenshot per vantage into
// artifacts/look/, and print every console line per vantage. Exits non-zero when
// any console error or uncaught page exception occurred.
//
// Usage:
//   node tools/look.mjs                            # one screenshot at /
//   node tools/look.mjs --vantage spawn=/ --vantage menu=/?menu=1
//   node tools/look.mjs --webgpu                   # headed Chromium with WebGPU flags
//
// A vantage value is a path (or path + query) served by the built site — games use
// query entry selectors such as /?menu. If the page exposes window.__LOOK_VANTAGES__
// = { name() {...} }, a --vantage whose name matches calls that hook on the loaded
// page before the shot: move the camera there; the game owns what each vantage shows.

import { mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { build, preview } from "vite";

const WEBGPU_ARGS = [
  "--ozone-platform=x11",
  "--enable-unsafe-webgpu",
  "--disable-gpu-sandbox",
  "--ignore-gpu-blocklist",
  // Without this Chromium never reaches the Linux Vulkan driver and silently serves WebGPU
  // from SwiftShader: no error, healthy-looking limits, software-rendered screenshots.
  "--enable-features=Vulkan",
];

/**
 * Milliseconds between an event and the shot.
 *
 * A scene that animates in, or a rig that has just finished loading, needs this long to settle —
 * but it is not how long *loading* takes, and a fixed wait captures a loading screen as a look.
 * `waitForReady` is what decides that; this is only the tail.
 */
const SETTLE_MS = 2500;

/** Startup budget for a scene that downloads a rig and a texture set before it can draw. */
const READY_TIMEOUT_MS = 180_000;

/**
 * Wait for the engine's own readiness flag.
 *
 * `__TN_STARTUP_READY__` is set once the scene is live, the startup compile has settled and the
 * first frames are being presented — the same signal the playtest's `runtimeReady` asserts. Fixed
 * sleeps are how a capture ends up photographing a progress bar.
 */
function waitForReady(page) {
  return page.waitForFunction(() => globalThis.__TN_STARTUP_READY__ === true, undefined, {
    timeout: READY_TIMEOUT_MS,
  });
}

function usage() {
  console.log("usage: node tools/look.mjs [--webgpu] [--viewport 1280x720] [--vantage name=path ...]");
  process.exit(0);
}

function parseVantage(spec) {
  const eq = spec === undefined ? -1 : spec.indexOf("=");
  if (eq <= 0) throw new Error(`--vantage expects name=path, got '${spec ?? ""}'`);
  return { name: spec.slice(0, eq), target: spec.slice(eq + 1) };
}

/**
 * A capture size, for comparing a shot against a reference frame of a different shape.
 *
 * `+append` puts two images side by side only if they are the same height, so a look review against
 * a 1280x720 reference needs a 1280x720 capture — which is also the size `pnpm test` runs at, so the
 * shot and the playtest are looking at the same frame.
 */
function parseViewport(spec) {
  const at = spec.indexOf("x");
  if (at <= 0) throw new Error(`--viewport expects WxH, got '${spec}'`);
  return { width: Number(spec.slice(0, at)), height: Number(spec.slice(at + 1)) };
}

function parseArgs(argv) {
  const vantages = [];
  let webgpu = false;
  let viewport = { width: 1280, height: 800 };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help") usage();
    else if (arg === "--webgpu") webgpu = true;
    else if (arg === "--viewport") viewport = parseViewport(argv[++i]);
    else if (arg === "--vantage") vantages.push(parseVantage(argv[++i]));
    else throw new Error(`unknown argument '${arg}' — see node tools/look.mjs --help`);
  }
  if (vantages.length === 0) vantages.push({ name: "spawn", target: "/" });
  for (const { name } of vantages) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(name)) throw new Error(`bad vantage name '${name}'`);
  }
  return { webgpu, viewport, vantages };
}

const { webgpu, viewport, vantages } = parseArgs(process.argv.slice(2));
const root = path.resolve(import.meta.dirname, "..");

await build({ root });
const server = await preview({ root, logLevel: "warn" });
const base = server.resolvedUrls.local[0];
console.log(`look: serving dist/ at ${base}`);

const outDir = path.join(root, "artifacts", "look");
await mkdir(outDir, { recursive: true });

const browser = await chromium.launch({ headless: !webgpu, args: webgpu ? WEBGPU_ARGS : [] });
let failed = false;
try {
  const page = await browser.newPage({ viewport });
  for (const { name, target } of vantages) {
    const entries = [];
    const onConsole = (message) => entries.push({ type: message.type(), text: message.text() });
    const onPageError = (error) =>
      entries.push({ type: "error", text: `uncaught: ${error.message}` });
    page.on("console", onConsole);
    page.on("pageerror", onPageError);
    try {
      await page.goto(new URL(target, base).href, { waitUntil: "load" });
      await waitForReady(page);
      // Which GPU drew this: an unnamed adapter can be SwiftShader, and its frames are not a look.
      const adapter = await page.evaluate(async () => {
        const info = (await navigator.gpu?.requestAdapter())?.info;
        return info === undefined ? "none" : `${info.vendor} ${info.architecture} ${info.description}`.trim();
      });
      console.log(`look: adapter ${adapter}`);
      await page.waitForTimeout(SETTLE_MS);
      const hasHook = await page.evaluate(
        (vantageName) => Boolean(globalThis.__LOOK_VANTAGES__?.[vantageName]),
        name,
      );
      if (hasHook) {
        await page.evaluate((vantageName) => globalThis.__LOOK_VANTAGES__[vantageName](), name);
        await page.waitForTimeout(SETTLE_MS);
      }
      const file = path.join(outDir, `${name}.png`);
      await page.screenshot({ path: file });
      console.log(`\n== ${name} ${target} -> ${path.relative(root, file)}`);
      for (const entry of entries) console.log(`  [${entry.type}] ${entry.text}`);
      if (entries.some((entry) => entry.type === "error")) failed = true;
    } finally {
      page.off("console", onConsole);
      page.off("pageerror", onPageError);
    }
  }
} finally {
  await browser.close();
  server.httpServer?.close();
}
process.exitCode = failed ? 1 : 0;
