/**
 * Does the picture get softer the longer you play?
 *
 * `CAPTURE_ON_DESKTOP=1 tools/capture-lock.sh node tools/scale-probe.mjs <url> [seconds] [w] [h]`
 *
 * `renderer.resolutionScale: "auto"` lets the engine hold `display.maxFps` by shrinking the 3D
 * drawing buffer. That is a ratchet with a memory: a window under target steps the scale DOWN,
 * and it only comes back up after several consecutive windows that are both at target AND have a
 * clean presented tail. So a game that misses 60 fps does not settle at "slightly soft" — it walks
 * down the rungs [1, 0.85, 0.72, 0.61, 0.52, 0.44, 0.38, 0.32, 0.27, 0.23] until it either holds
 * budget or hits the floor and says `atFloor`.
 *
 * This prints one row per reported window — the engine reports every 300 frames — so the trajectory
 * is visible rather than inferred. Read the `scale` and `buffer` columns: if they fall, "blurry
 * after a while" IS the frame cost, and there is no blur effect to go looking for.
 *
 * Run it on the REAL display (`CAPTURE_ON_DESKTOP=1`). Under Xvfb there is no vsync, the present
 * wait lands in `update`, and every fps number is wrong — see tools/fps.mjs.
 */
import { chromium } from "playwright";

const url = process.argv[2];
const seconds = Number(process.argv[3] ?? 130);
const width = Number(process.argv[4] ?? 1600);
const height = Number(process.argv[5] ?? 900);

const browser = await chromium.launch({
  headless: false,
  args: [
    "--enable-unsafe-webgpu",
    "--enable-features=Vulkan,VulkanFromANGLE,DefaultANGLEVulkan",
    "--use-angle=vulkan",
  ],
});
const page = await browser.newPage({ viewport: { width, height } });

let started = 0;
const rows = [];
page.on("console", (message) => {
  const text = message.text();
  if (!text.startsWith("TN_FRAME_BUDGET")) return;
  const window = JSON.parse(text.replace("TN_FRAME_BUDGET:", ""));
  const at = started === 0 ? 0 : (Date.now() - started) / 1000;
  rows.push({ at, window });
  const surface = window.surface ?? {};
  console.log(
    [
      `t=${at.toFixed(0).padStart(3)}s`,
      `fps=${String(window.fps).padStart(5)}`,
      `scale=${String(surface.resolutionScale ?? "?").padStart(5)}`,
      `buffer=${String(surface.drawingBufferWidth ?? "?")}x${String(surface.drawingBufferHeight ?? "?")}`,
      `atFloor=${String(surface.atFloor ?? "?")}`,
      `frame p50=${String(window.frame.p50).padStart(6)}`,
      `render p50=${String(window.phases.render?.p50 ?? "?").padStart(6)}`,
      `update p50=${String(window.phases.update?.p50 ?? "?").padStart(6)}`,
      `hitches=${String(window.hitches)}`,
    ].join(" "),
  );
});

await page.goto(url, { waitUntil: "commit", timeout: 180_000 });
await page.waitForFunction(() => globalThis.__TN_WORLD_REVEALED__ === true, undefined, {
  timeout: 180_000,
  polling: 250,
});
started = Date.now();
console.log(`revealed; watching ${String(seconds)}s at ${String(width)}x${String(height)}`);

// Stand still for the first 20 s, then walk for the rest: the scaler reacts to what the frame
// costs, and a static frustum re-uses everything a moving one pays for.
await page.waitForTimeout(20_000);
console.log("--- walking from here ---");
await page.keyboard.down("KeyW");
await page.waitForTimeout(Math.max(0, seconds - 20) * 1000);
await page.keyboard.up("KeyW");

const first = rows.at(0)?.window.surface?.resolutionScale;
const last = rows.at(-1)?.window.surface?.resolutionScale;
console.log(`\nscale ${String(first)} -> ${String(last)} over ${String(rows.length)} windows`);
await browser.close();
