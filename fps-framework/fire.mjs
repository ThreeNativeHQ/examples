import { chromium } from "playwright";
const url = process.argv[2], label = process.argv[3];
const browser = await chromium.launch({ headless:false, args:["--enable-unsafe-webgpu","--enable-features=Vulkan","--disable-gpu-sandbox","--ignore-gpu-blocklist","--window-size=1280,800"] });
try {
  const page = await browser.newPage({ viewport:{width:1280,height:800} });
  await page.goto(url, { waitUntil:"load", timeout:60000 });
  await page.waitForTimeout(9000);
  const read = () => page.evaluate(async () => {
    const b = window.__THREENATIVE_PLAYTEST_BRIDGE__;
    const s = await b.sample({ entities: [], resources: ["state"] });
    const st = s.resources?.state ?? s.resources?.GameState ?? {};
    return { shots:st.shots, ammo:st.ammo, score:st.score, targetsHit:st.targetsHit, health:st.health };
  });
  const out = { label, start: await read() };
  for (let i=0;i<3;i++){ await page.keyboard.down("Space"); await page.waitForTimeout(90); await page.keyboard.up("Space"); await page.waitForTimeout(500); }
  out.after3Space = await read();
  await page.screenshot({ path: `screenshots/probe-after-space-${label}.png` });
  for (let i=0;i<3;i++){ await page.mouse.click(640,400); await page.waitForTimeout(500); }
  out.after3InstantClicks = await read();
  for (let i=0;i<3;i++){ await page.mouse.down(); await page.waitForTimeout(160); await page.mouse.up(); await page.waitForTimeout(400); }
  out.after3Clicks = await read();
  await page.screenshot({ path: `screenshots/probe-after-click-${label}.png` });
  out.pointerLock = await page.evaluate(()=>document.pointerLockElement!==null);
  console.log(JSON.stringify(out,null,2));
} finally { await browser.close(); }
