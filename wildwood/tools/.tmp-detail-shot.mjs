/* One-off: capture AFTER the detail tier finishes. Same recipe as wildwood tools/shot.mjs. */
import { chromium } from "playwright";

const url = process.argv[2] ?? "http://127.0.0.1:5173/";
const out = process.argv[3] ?? "/tmp/ww-detail.png";
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
const marks = [];
page.on("pageerror", (e) => errors.push(String(e?.stack ?? e).slice(0, 400)));
page.on("console", (m) => {
  const t = m.text();
  if (/TN_VALLEY|TN_STARTUP|error|fail/i.test(t)) marks.push(t.slice(0, 200));
});
await page.goto(url, { waitUntil: "networkidle", timeout: 180_000 });
await page.waitForFunction(() => globalThis.__TN_STARTUP_READY__ === true, undefined, { timeout: 120_000 });
try {
  await page.waitForFunction(
    () => (globalThis.__TN_MARKS__ ?? []).some((x) => String(x).includes("TN_VALLEY_DETAIL_DONE")) ||
          (window.__tnDetailDone === true),
    undefined,
    { timeout: 90_000 },
  );
  console.log("detail-done flag observed");
} catch {
  console.log("detail-done flag not observed in time; shooting anyway");
}
// The detail-done marker reaches the page console, not a global — poll the console buffer instead.
await page.waitForTimeout(12_000);
await page.screenshot({ path: out, type: "png" });
console.log("marks:", JSON.stringify(marks.slice(-8), null, 1));
console.log("errors:", JSON.stringify(errors.slice(0, 4)));
await browser.close();
