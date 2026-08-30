// Cross-checks the cheap skin envelope against a real precise-bounds measurement while the
// soldier patrols, and reports where the player rests. Run against a dev server.
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
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.bringToFront();
  await page.goto(url, { waitUntil: "load" });
  await page.waitForTimeout(9000);
  await page.evaluate(() => { globalThis.__FPS_GROUNDING_AUDIT__ = true; });
  const samples = [];
  for (let i = 0; i < 60; i += 1) {
    await page.waitForTimeout(250);
    const s = await page.evaluate(() => {
      const snap = globalThis.__THREENATIVE__?.snapshot?.();
      if (snap === undefined) return null;
      const e = snap.enemy, p = snap.player;
      return { phase: e?.phase, foot: e?.footClearance, err: e?.envelopeErrorM,
               groundSnap: e?.groundSnap, playerY: p?.positionY, enemyY: e?.position?.[1] };
    });
    if (s !== null) samples.push(s);
  }
  const nums = (k) => samples.map((s) => s[k]).filter((v) => typeof v === "number");
  const summarise = (k) => { const a = nums(k); if (a.length === 0) return null;
    return { n: a.length, min: +Math.min(...a).toFixed(4), max: +Math.max(...a).toFixed(4),
             absMax: +Math.max(...a.map(Math.abs)).toFixed(4) }; };
  console.log(JSON.stringify({
    footClearance: summarise("foot"), envelopeError: summarise("err"),
    playerY: summarise("playerY"), enemyGroupY: summarise("enemyY"),
    groundSnap: samples[0]?.groundSnap, phases: [...new Set(samples.map((s) => s.phase))],
    errors: errors.slice(0, 4),
  }, null, 2));
} finally { await browser.close(); }
