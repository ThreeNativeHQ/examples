import { chromium } from "playwright";
const browser = await chromium.launch({ headless:false, args:["--enable-unsafe-webgpu","--enable-features=Vulkan","--disable-gpu-sandbox","--ignore-gpu-blocklist"] });
try {
  const page = await browser.newPage({ viewport:{width:1280,height:800} });
  await page.goto(process.argv[2], { waitUntil:"load", timeout:60000 });
  await page.waitForTimeout(9000);
  const read = () => page.evaluate(async () => {
    const b = window.__THREENATIVE_PLAYTEST_BRIDGE__;
    try {
      const s = await b.sample({ entities: [], resources: ["state"] });
      return { keys: Object.keys(s), json: JSON.parse(JSON.stringify(s)) };
    } catch(e) { return { error: String(e).slice(0,200) }; }
  });
  const a = await read();
  await page.keyboard.down("Space"); await page.waitForTimeout(150); await page.keyboard.up("Space");
  await page.waitForTimeout(1500);
  const c = await read();
  console.log(JSON.stringify({ beforeKeys:a.keys, before:a.json?.resources ?? a.json, error:a.error,
                               afterKeys:c.keys, after:c.json?.resources ?? c.json }, null, 2).slice(0,2500));
} finally { await browser.close(); }
