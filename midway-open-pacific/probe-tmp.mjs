import { chromium } from "playwright";
const b = await chromium.launch({ headless: false, args: ["--enable-unsafe-webgpu","--enable-features=Vulkan","--disable-gpu-sandbox","--ignore-gpu-blocklist","--ozone-platform=x11"] });
const page = await b.newPage({ viewport: { width: 900, height: 600 } });
await page.goto("http://localhost:5199");
await page.waitForSelector("#loading.hidden", { state: "attached", timeout: 180000 });
await page.waitForSelector("#briefing:not(.hidden)");
await page.evaluate(async () => {
  const url = performance.getEntriesByType("resource").map((e) => e.name).findLast((n) => /\/src\/game\.ts(?:\?|$)/.test(n));
  window.midway = (await import(url)).default.scene;
});
await page.click("#start-air");
await page.waitForTimeout(3000);
console.log(JSON.stringify(await page.evaluate(() => {
  const b = window.midway.battle, s = b.ships[13];
  return { name: s.name, hullLength: s.hullLength, hullBeam: s.hullBeam, heading: s.heading, speed: s.speed, keys: Object.keys(s).slice(0, 40) };
}), null, 1));
await b.close();
