// Profiles the very first shot in isolation to find what is built lazily on the fire path.
import { chromium } from "playwright";
const url = process.argv[2] ?? "http://127.0.0.1:4176/";
const browser = await chromium.launch({
  headless: false,
  args: ["--ozone-platform=x11","--enable-unsafe-webgpu","--disable-gpu-sandbox","--ignore-gpu-blocklist",
    "--enable-features=Vulkan","--disable-features=CalculateNativeWinOcclusion",
    "--disable-backgrounding-occluded-windows","--disable-renderer-backgrounding"],
});
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.bringToFront();
  await page.goto(url, { waitUntil: "load" });
  await page.waitForTimeout(9000);
  const session = await page.context().newCDPSession(page);
  await session.send("Profiler.enable");
  await session.send("Profiler.setSamplingInterval", { interval: 50 });
  await session.send("Profiler.start");
  await page.keyboard.press("Space");
  await page.waitForTimeout(500);
  const { profile } = await session.send("Profiler.stop");
  const nodes = new Map(profile.nodes.map((n) => [n.id, n]));
  const micros = new Map();
  const total = profile.timeDeltas.reduce((a, b) => a + b, 0);
  profile.samples.forEach((id, i) => {
    micros.set(id, (micros.get(id) ?? 0) + (profile.timeDeltas[i] ?? 0));
  });
  const top = [...micros.entries()]
    .map(([id, us]) => ({ frame: nodes.get(id)?.callFrame, ms: us / 1000 }))
    .filter((r) => r.frame !== undefined && r.ms > 0.4)
    .sort((a, b) => b.ms - a.ms).slice(0, 14)
    .map((r) => ({ fn: r.frame.functionName || "(anon)", ms: +r.ms.toFixed(2),
                   at: `${r.frame.url.split("/").slice(-1)[0]}:${r.frame.lineNumber + 1}` }));
  console.log(JSON.stringify({ windowMs: +(total / 1000).toFixed(1), top }, null, 2));
} finally { await browser.close(); }
