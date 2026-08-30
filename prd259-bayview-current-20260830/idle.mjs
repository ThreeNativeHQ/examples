import { chromium } from "playwright";
const browser = await chromium.launch({ headless:false, args:["--enable-unsafe-webgpu","--enable-features=Vulkan","--disable-gpu-sandbox","--ignore-gpu-blocklist"] });
try {
  const page = await browser.newPage({ viewport:{width:1280,height:800} });
  await page.goto(process.argv[2], { waitUntil:"load", timeout:60000 });
  const read = () => page.evaluate(async () => {
    const b = window.__THREENATIVE_PLAYTEST_BRIDGE__;
    const s = await b.sample({ entities: [], resources: ["state"] });
    const st = s.resources?.state ?? {};
    return { shots:st.shots, ammo:st.ammo, score:st.score, health:st.health };
  });
  const out = [];
  for (const t of [4000, 4000, 4000]) { await page.waitForTimeout(t); out.push(await read()); }
  console.log(JSON.stringify(out));
} finally { await browser.close(); }
