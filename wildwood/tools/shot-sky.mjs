// Capture the sky-HDRI harness: `node tools/shot-sky.mjs [url] [outpath]`
//
// Run it under `tools/capture-lock.sh` — headed, WebGPU, on a private virtual display. Headless
// Chromium serves WebGPU from SwiftShader and hands back a black canvas, so a headless capture
// here proves nothing. Launch args are the working recipe from `tools/shot.mjs`.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const url = process.argv[2] ?? "http://localhost:5199/dev-sky.html";
const out = process.argv[3] ?? "/home/joao/projects/threenative/sandbox/wildwood/screenshots/sky-hdri.png";
mkdirSync(new URL(".", `file://${out}`).pathname, { recursive: true });

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

await page.goto(url, { waitUntil: "load" });
// The .hdr is 7.5 MB over the dev server; wait for the environment to land before judging it.
await page.waitForTimeout(8000);
await page.screenshot({ path: out });
console.log(`shot ${out}`);

console.log("\n=== console ===");
for (const line of logs.slice(0, 25)) console.log(line);
if (errors.length > 0) {
  console.log("\n=== PAGE ERRORS ===");
  for (const line of errors.slice(0, 10)) console.log(line);
}
await browser.close();
