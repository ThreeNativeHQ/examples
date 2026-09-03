/**
 * Screenshot the valley: `node tools/shot.mjs <url> <outdir> [spawns...]`
 *
 * Run it under `tools/capture-lock.sh` — headed, WebGPU, on a private virtual display. Headless
 * Chromium serves WebGPU from SwiftShader and hands back a black canvas, so a headless capture
 * here proves nothing.
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const url = process.argv[2] ?? "http://127.0.0.1:5274/";
const out = process.argv[3] ?? "/tmp/wildwood-shots";
// "x,z,yaw" triples, delivered through the scene's ?spawn= override — CDP mouse deltas read zero
// without OS focus, so aim cannot be scripted any other way.
const spawns = process.argv.slice(4);
mkdirSync(out, { recursive: true });

// Headed, and with WebGPU actually switched on. Without these the page silently falls back to
// WebGL, where TSL compiles to GLSL instead of WGSL — so a shader that is fine on the real
// backend can fail here, and one that fails on the real backend can pass. Capture what ships.
const browser = await chromium.launch({
  headless: false,
  args: [
    "--enable-unsafe-webgpu",
    "--enable-features=Vulkan,VulkanFromANGLE,DefaultANGLEVulkan",
    "--use-angle=vulkan",
  ],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errors = [];
const logs = [];
page.on("pageerror", (e) => errors.push(((e && e.stack) || (e && e.message) || String(e)).slice(0, 900)));
page.on("console", (m) => {
  const t = m.text();
  if (/TN_|error|Error|WARN|fail/i.test(t)) logs.push(t.slice(0, 400));
});

// The engine holds the world render behind its startup-readiness gate: the whole scene goes
// through `compileAsync` first, bounded at 15 s, then a stable-frame window, and until both
// resolve the canvas shows the loading layer — uniform grey, HUD fine, console clean, zero
// errors. Every fixed wait short of ~20 s screenshots that frozen loader. The engine publishes
// the one signal that means "the world is on screen": game.ts sets `__TN_STARTUP_READY__` when
// readiness resolves, and the native screenshot path waits on the same flag. Wait for it.
const waitReady = async () => {
  // `__TN_STARTUP_READY__` is the FRAMEWORK's flag and it is no longer the right one to wait on.
  // The loading curtain now holds past it until the detail tier has landed, so a harness gated on
  // the framework flag screenshots the loading screen — a title card at 86% that reads exactly
  // like a scene that failed to build. `__TN_WORLD_REVEALED__` is the game's own flag, set in the
  // one callback that fires as the curtain lifts, and it is what "the world is on screen" means
  // here now.
  const revealed = await page
    .waitForFunction(() => globalThis.__TN_WORLD_REVEALED__ === true, undefined, {
      timeout: 180_000,
      polling: 500,
    })
    .then(
      () => true,
      () => false,
    );
  if (!revealed) {
    console.log("WARN __TN_WORLD_REVEALED__ never flipped; the curtain is probably still up");
  }
  // First frames after the reveal still land pipelines the timed-out warm-up skipped.
  await page.waitForTimeout(3000);
};

const shoot = async (name, at) => {
  const target = at === undefined ? url : `${url}${url.includes("?") ? "&" : "?"}spawn=${at}`;
  // networkidle, not a clock: the valley loads ~70 GLBs through the dev server, and every fixed
  // wait this game ever tried screenshotted a half-loaded scene whose console still said loading.
  await page.goto(target, { waitUntil: "networkidle", timeout: 180_000 });
  await waitReady();
  await page.screenshot({ path: `${out}/${name}.png` });
  console.log(`shot ${name}`);
};

if (spawns.length === 0) await shoot("spawn");
else for (const [index, at] of spawns.entries()) await shoot(`view-${String(index)}`, at);

console.log("\n=== console ===");
for (const line of logs.slice(0, 25)) console.log(line);
if (errors.length > 0) {
  console.log("\n=== PAGE ERRORS ===");
  for (const line of errors.slice(0, 10)) console.log(line);
}
await browser.close();
