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

const shoot = async (name, at) => {
  const target = at === undefined ? url : `${url}${url.includes("?") ? "&" : "?"}spawn=${at}`;
  await page.goto(target, { waitUntil: "load" });
  // The valley builds ~11,000 instances and eight 1K textures; give it real time before judging.
  await page.waitForTimeout(9000);
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
