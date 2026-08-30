import { chromium } from "playwright";
const browser = await chromium.launch({ headless:false, args:["--enable-unsafe-webgpu","--enable-features=Vulkan","--disable-gpu-sandbox","--ignore-gpu-blocklist","--window-size=1536,1024"] });
try {
  const page = await browser.newPage({ viewport:{width:1536,height:1024} });
  const errs=[]; page.on("pageerror",e=>errs.push(String(e).slice(0,180)));
  page.on("console",m=>{ if(m.type()==="error") errs.push(m.text().slice(0,180)); });
  await page.goto(process.argv[2], { waitUntil:"load", timeout:60000 });
  await page.waitForTimeout(9000);
  // walk toward the enemy and fire a few rounds so the flash and smoke are on screen
  await page.keyboard.down("KeyW"); await page.waitForTimeout(900); await page.keyboard.up("KeyW");
  for (let i=0;i<2;i++){ await page.mouse.down(); await page.waitForTimeout(120); await page.mouse.up(); await page.waitForTimeout(90); }
  await page.screenshot({ path: "screenshots/after-fixes.png" });
  const st = await page.evaluate(async () => {
    const b = window.__THREENATIVE_PLAYTEST_BRIDGE__;
    const s = await b.sample({ entities: ["enemy"], resources: ["state"] });
    return { state: s.resources?.state, enemy: s.entities };
  });
  console.log(JSON.stringify({ state: st.state, errors: errs.slice(0,5) }, null, 2));
} finally { await browser.close(); }
