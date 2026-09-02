/**
 * Drive the animals harness in its framed single-animal view and pull the numeric pose reports.
 *
 * For each `?` query given on the command line this opens dev-animals.html, waits for the
 * harness's TN_ANIMALS_READY marker and its first bone-length sample, then reads
 * window.__TN_BONE_LENGTHS__ (boneLengthDeviations vs the bind baseline, plus the
 * head-minus-pelvis forward probe) and screenshots the framed view.
 *
 * Run it under tools/capture-lock.sh — headed, WebGPU, private display:
 *
 *   node tools/pose-probe.mjs "only=fox&roam=0" "only=fox&roam=0&corruptAnimalForward=fox"
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const BASE = process.env.POSE_PROBE_BASE ?? "http://127.0.0.1:5173/dev-animals.html";
const OUT = resolve("artifacts/animals/pose-probe");
const queries = process.argv.slice(2);
if (queries.length === 0) {
  console.error("usage: node tools/pose-probe.mjs \"only=fox&roam=0\" [...]");
  process.exit(64);
}
mkdirSync(OUT, { recursive: true });

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

for (const [index, query] of queries.entries()) {
  const logs = [];
  const onConsole = (message) => {
    const text = message.text();
    if (/^(TN_BONE_REPORT|TN_FORWARD_PROBE|TN_ANIMALS_AUDIT|TN_ANIMALS_SCALE|TN_ANIMALS_READY|TN_ASSETS_MIRRORED_CLIPS)/.test(text)) {
      logs.push(text.slice(0, 600));
    }
  };
  const onError = (error) => errors.push(String(error?.stack ?? error).slice(0, 600));
  page.on("console", onConsole);
  page.on("pageerror", onError);

  const url = `${BASE}?${query}`;
  // "commit", not "domcontentloaded": the harness's module graph (three/webgpu, core) delays
  // DOMContentLoaded past the default timeout on a cold vite transform.
  await page.goto(url, { waitUntil: "commit", timeout: 60_000 });
  await page
    .waitForFunction(() => globalThis.__TN_BONE_LENGTHS__ !== undefined, undefined, { timeout: 60_000 })
    .catch(() => {});
  await page.waitForTimeout(1_500);
  const report = await page.evaluate(() => globalThis.__TN_BONE_LENGTHS__ ?? null);
  await page.screenshot({ path: `${OUT}/view-${index}.png` });

  console.log(`TN_POSE_PROBE ${JSON.stringify({ query, url, report, logs, errors: [...errors] })}`);
  page.off("console", onConsole);
  page.off("pageerror", onError);
}

await browser.close();
if (errors.length > 0) process.exitCode = 1;
