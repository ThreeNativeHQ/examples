// Rebuilds the scene twice and fails if cached asset transforms compound the AK scale.
import { chromium } from "playwright";

const url = process.argv[2] ?? "http://127.0.0.1:5180/";
const browser = await chromium.launch({
  headless: false,
  args: [
    "--ozone-platform=x11",
    "--enable-unsafe-webgpu",
    "--disable-gpu-sandbox",
    "--ignore-gpu-blocklist",
    "--enable-features=Vulkan",
  ],
});

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.goto(url, { waitUntil: "load" });
  await page.waitForFunction(() => window.__THREENATIVE__?.snapshot !== undefined, {
    timeout: 60_000,
  });
  await page.waitForTimeout(5_000);
  await page.evaluate(async () => {
    const { default: game } = await import("/src/game.ts");
    window.__TN_RESTART_GAME__ = game;
  });

  const samples = [];
  for (let run = 0; run < 3; run += 1) {
    if (run > 0) {
      await page.evaluate(() => window.__TN_RESTART_GAME__.goto("play"));
      await page.waitForTimeout(1_500);
    }
    const sample = await page.evaluate(() => window.__THREENATIVE__.snapshot().enemy);
    samples.push({ run: run + 1, rifleLength: sample?.rifleLength });
  }
  console.log(JSON.stringify(samples, null, 2));
  for (const sample of samples) {
    if (sample.rifleLength < 1 || sample.rifleLength > 1.5) {
      throw new Error(`run ${sample.run} AK length was ${sample.rifleLength}m`);
    }
  }
} finally {
  await browser.close();
}
