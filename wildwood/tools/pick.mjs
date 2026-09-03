/**
 * Ask the picture what it is looking at: `node tools/pick.mjs <url> <x,y> [x,y ...]`
 *
 * Run it under `tools/capture-lock.sh`, the same as every other headed capture here.
 *
 * Written because a probe that walks the scene graph can only rank objects by how odd their
 * numbers look, and this valley has 46,000 instances whose numbers all look odd in isolation. A
 * pale twisted ribbon in a screenshot was chased through the foliage scatter, the wind shader, the
 * animals and the landmark props on exactly that kind of evidence; one ray through the pixel
 * identified it as the standing stone 1.14 m from a debug camera parked inside the boulder.
 *
 * It reports what the ray hits, nearest first, with each hit's triangle count and world-space
 * size. Note that a ray tests CPU geometry: a mesh displaced by a TSL `positionNode` — everything
 * in the wind-blown foliage — is hit at its rest position, so a ray passing *through* what you can
 * plainly see on screen is itself the finding.
 *
 * Needs `__TN_PICK__`, which src/scenes/Valley.ts installs alongside `__TN_SCENE__`.
 */
import { chromium } from "playwright";
const url = process.argv[2];
const points = process.argv.slice(3).map((p) => p.split(",").map(Number));
const browser = await chromium.launch({ headless: false, args: ["--enable-unsafe-webgpu","--enable-features=Vulkan,VulkanFromANGLE,DefaultANGLEVulkan","--use-angle=vulkan"] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
await page.goto(url, { waitUntil: "commit", timeout: 180_000 });
await page.waitForFunction(() => globalThis.__TN_WORLD_REVEALED__ === true, undefined, { timeout: 180_000, polling: 500 });
await page.waitForTimeout(2500);
await page.screenshot({ path: "screenshots/pick.png" });
for (const [x, y] of points) {
  const hits = await page.evaluate(([x, y]) => globalThis.__TN_PICK__(x, y), [x, y]);
  console.log(`pixel (${x},${y}):`);
  for (const h of hits) console.log(`   ${String(h.distance).padStart(7)}m  tris=${String(h.tris).padStart(6)} dims=${JSON.stringify(h.dims).padEnd(28)} ${h.name}`);
}
await browser.close();
