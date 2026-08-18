import { chromium } from "playwright";
const browser = await chromium.launch({ headless:false, args:["--enable-unsafe-webgpu","--enable-features=Vulkan","--disable-gpu-sandbox","--ignore-gpu-blocklist","--window-size=1536,1024"] });
try {
  const page = await browser.newPage({ viewport:{width:1536,height:1024} });
  await page.goto(process.argv[2], { waitUntil:"load", timeout:60000 });
  await page.waitForTimeout(8000);
  const read = () => page.evaluate(async () => {
    const b = window.__THREENATIVE_PLAYTEST_BRIDGE__;
    const s = await b.sample({ entities: ["enemy"], resources: ["state"] });
    const reg = window.__THREENATIVE__?.snapshot?.() ?? {};
    return { enemy: reg.enemy ?? null, health: s.resources?.state?.health };
  });
  const samples = [];
  for (let i=0;i<24;i++){ await page.waitForTimeout(700); samples.push(await read()); }
  const pos = samples.map(s => s.enemy?.position).filter(Boolean);
  // how far did it actually travel, and did it ever sit still for long?
  let travelled = 0, stalls = 0;
  for (let i=1;i<pos.length;i++){
    const d = Math.hypot(pos[i][0]-pos[i-1][0], pos[i][2]-pos[i-1][2]);
    travelled += d;
    if (d < 0.05) stalls++;
  }
  console.log(JSON.stringify({
    samples: pos.length,
    travelled: Number(travelled.toFixed(2)),
    stalledSamples: stalls,
    armed: samples[0]?.enemy?.armed,
    phases: [...new Set(samples.map(s=>s.enemy?.phase))],
    firstPos: pos[0], lastPos: pos[pos.length-1],
    playerHealth: samples[samples.length-1]?.health,
  }, null, 2));
} finally { await browser.close(); }
