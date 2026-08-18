import { chromium } from "playwright";
const browser = await chromium.launch({ headless:false, args:["--enable-unsafe-webgpu","--enable-features=Vulkan","--disable-gpu-sandbox","--ignore-gpu-blocklist","--window-size=1536,1024"] });
try {
  const page = await browser.newPage({ viewport:{width:1536,height:1024} });
  await page.goto(process.argv[2], { waitUntil:"load", timeout:60000 });
  await page.waitForTimeout(8000);
  // aim down sights (F) and hold, so the optic and the distant soldier are both large
  await page.keyboard.down("KeyF");
  await page.waitForTimeout(1200);
  await page.screenshot({ path: "screenshots/aiming.png" });
  await page.keyboard.up("KeyF");
  // fire a burst for the flash/smoke
  await page.mouse.down(); await page.waitForTimeout(140); await page.mouse.up();
  await page.waitForTimeout(60);
  await page.screenshot({ path: "screenshots/firing.png" });
} finally { await browser.close(); }
