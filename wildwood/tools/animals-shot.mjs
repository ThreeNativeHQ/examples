/**
 * Screenshot the animals harness: `node tools/animals-shot.mjs <base-url> <outdir>`
 *
 * Run it under `tools/capture-lock.sh` — headed, WebGPU, on a private virtual display. Headless
 * Chromium serves WebGPU from SwiftShader and hands back a black canvas, so a headless capture
 * here proves nothing.
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const base = process.argv[2] ?? "http://localhost:5199/dev-animals.html";
const out = process.argv[3] ?? "artifacts";
const lanes = ["ai", "wander", "graze", "flee", "idle"];
mkdirSync(out, { recursive: true });

// Headed, and with WebGPU actually switched on — the same recipe tools/shot.mjs runs for the
// valley, because a capture on the wrong backend proves nothing about the frame that ships.
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
  if (/\[animals\]|TN_|error|Error|WARN|fail/i.test(t)) logs.push(t.slice(0, 400));
});

const laneUrls = {
  ai: base,
  wander: `${base}?state=wander&threat=0`,
  graze: `${base}?state=graze&threat=0`,
  // Static threat at the pen centre: every species bolts on frame one, radially away from the
  // red marker, and the shot catches the whole roster mid-gallop before any of them calms.
  flee: `${base}?threatAt=0,0`,
  idle: `${base}?state=idle&threat=0`,
};

for (const lane of lanes) {
  await page.goto(laneUrls[lane], { waitUntil: "load" });
  // Load, spawn, first animation frames, a crossfade or two, and the forced-state re-assert.
  // The flee lane shoots ~1.5 s in on purpose: canines calm and turn back within ~1.4 s.
  await page.waitForTimeout(lane === "flee" ? 1600 : 9000);
  await page.screenshot({ path: `${out}/animals-${lane}.png` });
  console.log(`shot animals-${lane}`);
}

console.log("\n=== animals / engine console ===");
for (const line of logs.slice(0, 40)) console.log(line);
if (errors.length > 0) {
  console.log("\n=== PAGE ERRORS ===");
  for (const line of errors.slice(0, 10)) console.log(line);
}
await browser.close();
