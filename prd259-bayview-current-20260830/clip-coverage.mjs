// Drives a real session and reports which of the rig's clips the AI actually used.
import { chromium } from "playwright";
const url = process.argv[2] ?? "http://127.0.0.1:4177/";
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
  const snap = async () => page.evaluate(() => globalThis.__THREENATIVE__?.snapshot?.()?.enemy ?? null);
  const seen = [];
  // Wander and shoot: the soldier has to hear rounds, search, engage, take hits and die.
  for (let round = 0; round < 26; round += 1) {
    await page.keyboard.down("KeyW");
    await page.waitForTimeout(500);
    await page.keyboard.up("KeyW");
    await page.keyboard.press("Space");
    await page.waitForTimeout(700);
    const e = await snap();
    if (e !== null) seen.push({ t: round, phase: e.phase, clip: e.animation, crouch: e.crouching,
                                supp: +Number(e.suppressed ?? 0).toFixed(1), hp: e.health });
  }
  const final = await snap();
  const RIG = ["DeathBack","DeathFront","DeathHeadshot","FiringRifle","HitReaction",
               "RifleCrouchWalk","RifleCrouchWalkToIdle","RifleIdle","RifleWalk"];
  const played = final?.clipsPlayed ?? [];
  console.log(JSON.stringify({
    played, unused: RIG.filter((c) => !played.includes(c)),
    crouchClipFrames: final?.crouchClipFrames, suppressedPeak: final?.suppressedPeak,
    timeline: seen.filter((s, i) => i === 0 || s.clip !== seen[i-1].clip || s.phase !== seen[i-1].phase),
    errors: errors.slice(0, 4),
  }, null, 2));
} finally { await browser.close(); }
