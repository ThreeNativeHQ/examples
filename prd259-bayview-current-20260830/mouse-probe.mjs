// Drives the real mouse: does left click fire, and does right click aim?
import { chromium } from "playwright";

const URL = process.argv[2] ?? "http://127.0.0.1:5180/";
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
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on("pageerror", (error) => console.log("PAGEERROR:", error.message.slice(0, 200)));
await page.goto(URL, { waitUntil: "load" });
await page.waitForFunction(() => window.__THREENATIVE__?.snapshot !== undefined, { timeout: 60_000 });
await page.waitForTimeout(4000);

await page.evaluate(async () => {
  const module = await import("/src/game.ts");
  window.__TN_GAME__ = module.default;
});

const read = () =>
  page.evaluate(() => {
    const state = window.__TN_GAME__.state.getState();
    return {
      shots: state.shots,
      ammo: state.ammo,
      aiming: state.aiming,
      captured: window.__TN_GAME__.ctx?.input?.raw?.pointer?.captured,
    };
  });

console.log("before        ", JSON.stringify(await read()));

// First click captures the pointer and fires.
await page.mouse.move(640, 360);
await page.mouse.down({ button: "left" });
await page.waitForTimeout(120);
await page.mouse.up({ button: "left" });
await page.waitForTimeout(400);
console.log("after 1 click ", JSON.stringify(await read()));

for (let shot = 0; shot < 3; shot += 1) {
  await page.mouse.down({ button: "left" });
  await page.waitForTimeout(120);
  await page.mouse.up({ button: "left" });
  await page.waitForTimeout(220);
}
console.log("after 4 clicks", JSON.stringify(await read()));

await page.mouse.down({ button: "right" });
await page.waitForTimeout(500);
const aimed = await read();
await page.mouse.up({ button: "right" });
await page.waitForTimeout(400);
const released = await read();
console.log("right held    ", JSON.stringify(aimed));
console.log("right released", JSON.stringify(released));

await browser.close();
