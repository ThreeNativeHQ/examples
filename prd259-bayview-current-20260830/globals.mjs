import { chromium } from "playwright";

const url = process.argv[2];
const browser = await chromium.launch({
  headless: false,
  args: [
    "--enable-unsafe-webgpu",
    "--enable-features=Vulkan",
    "--disable-gpu-sandbox",
    "--ignore-gpu-blocklist",
  ],
});
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto(url, { waitUntil: "load", timeout: 60_000 });
  await page.waitForTimeout(9000);
  const info = await page.evaluate(() => {
    const keys = Object.keys(window).filter((k) => /three|game|playtest|__/i.test(k));
    const out = { keys, shapes: {} };
    for (const k of keys) {
      try {
        const v = window[k];
        out.shapes[k] =
          v && typeof v === "object"
            ? Object.keys(v).slice(0, 25)
            : typeof v === "function"
              ? "function"
              : String(v).slice(0, 60);
      } catch (e) {
        out.shapes[k] = `threw: ${String(e).slice(0, 60)}`;
      }
    }
    return out;
  });
  process.stdout.write(`${JSON.stringify(info, null, 2)}\n`);
} finally {
  await browser.close();
}
