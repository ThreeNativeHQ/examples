// Frame-time probe: idle, first shot, and steady-state fire. Reports the worst single frame
// in each window, because a one-off hitch is invisible in a median.
import { chromium } from "playwright";
const url = process.argv[2] ?? "http://127.0.0.1:5184/";
const browser = await chromium.launch({
  headless: false,
  args: [
    "--ozone-platform=x11", "--enable-unsafe-webgpu", "--disable-gpu-sandbox",
    "--ignore-gpu-blocklist", "--enable-features=Vulkan",
    // XWayland reports the window occluded and Chromium throttles rAF to ~1 Hz, which reads
    // exactly like the performance bug being measured. Turn that detection off.
    "--disable-features=CalculateNativeWinOcclusion",
    "--disable-backgrounding-occluded-windows", "--disable-renderer-backgrounding",
  ],
});
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push(`console: ${m.text()}`); });
  await page.bringToFront();
  await page.goto(url, { waitUntil: "load" });
  await page.waitForTimeout(9000);
  await page.evaluate(() => {
    window.__f = [];
    let last = performance.now();
    const tick = () => { const n = performance.now(); window.__f.push(n - last); last = n; requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  });
  const cut = async () => page.evaluate(() => { const f = window.__f.slice(1); window.__f.length = 0; return f; });
  const stat = (a) => {
    if (a.length === 0) return { frames: 0 };
    const s = [...a].sort((x, y) => x - y);
    const m = s[Math.floor(s.length / 2)];
    return { frames: a.length, medianMs: +m.toFixed(2), fps: +(1000 / m).toFixed(1),
             p95Ms: +s[Math.floor(s.length * 0.95)].toFixed(2), worstMs: +s.at(-1).toFixed(2) };
  };
  await page.waitForTimeout(3000);
  const idle = stat(await cut());
  await page.keyboard.press("Space");
  await page.waitForTimeout(600);
  const firstShot = stat(await cut());
  for (let i = 0; i < 8; i += 1) { await page.keyboard.press("Space"); await page.waitForTimeout(300); }
  const sustained = stat(await cut());
  const snapshot = await page.evaluate(() => window.__THREENATIVE__?.snapshot?.() ?? null);
  console.log(JSON.stringify({ idle, firstShot, sustained, snapshot, errors: errors.slice(0, 6) }, null, 2));
} finally { await browser.close(); }
