import { chromium } from "playwright";
const browser = await chromium.launch({ headless:false, args:["--enable-unsafe-webgpu","--enable-features=Vulkan","--disable-gpu-sandbox","--ignore-gpu-blocklist","--window-size=1280,800"] });
try {
  const page = await browser.newPage({ viewport:{width:1280,height:800} });
  await page.goto(process.argv[2], { waitUntil:"load", timeout:60000 });
  await page.waitForTimeout(9000);
  await page.evaluate(() => {
    window.__frames = [];
    let last = performance.now();
    const tick = () => { const n = performance.now(); window.__frames.push(n-last); last = n; requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  });
  await page.waitForTimeout(2500);
  const idle = await page.evaluate(() => { const f = window.__frames.slice(); window.__frames.length = 0; return f; });
  for (let i=0;i<6;i++){ await page.mouse.down(); await page.waitForTimeout(120); await page.mouse.up(); await page.waitForTimeout(280); }
  const firing = await page.evaluate(() => window.__frames.slice());
  const stat = (a) => { const s=[...a].sort((x,y)=>x-y); return { n:a.length, median:+s[Math.floor(s.length/2)].toFixed(2), p95:+s[Math.floor(s.length*0.95)].toFixed(2), max:+s[s.length-1].toFixed(2) }; };
  console.log(JSON.stringify({ idle: stat(idle), firing: stat(firing) }, null, 2));
} finally { await browser.close(); }
