import { chromium } from "playwright";
const browser = await chromium.launch({ headless:false, args:["--enable-unsafe-webgpu","--enable-features=Vulkan","--disable-gpu-sandbox","--ignore-gpu-blocklist","--window-size=1280,800"] });
try {
  const page = await browser.newPage({ viewport:{width:1280,height:800} });
  await page.goto(process.argv[2], { waitUntil:"load", timeout:60000 });
  await page.waitForTimeout(9000);
  const yaw = () => page.evaluate(() => {
    const c = window.__THREENATIVE__?.snapshot?.() ?? {};
    return { player: c.player ?? null, locked: document.pointerLockElement !== null };
  });
  const before = await yaw();
  // click to lock, then move the mouse the way a player does
  await page.mouse.click(640, 400);
  await page.waitForTimeout(600);
  const locked = await yaw();
  for (let i=0;i<12;i++){ await page.mouse.move(640 + i*18, 400); await page.waitForTimeout(35); }
  await page.waitForTimeout(400);
  const after = await yaw();
  console.log(JSON.stringify({ before, locked, after }, null, 2).slice(0, 1800));
} finally { await browser.close(); }
