import { chromium } from "playwright";
const browser = await chromium.launch({
  headless: false,
  args: ["--enable-unsafe-webgpu", "--enable-features=Vulkan", "--disable-gpu-sandbox", "--ignore-gpu-blocklist", "--ozone-platform=x11"],
});
try {
  const page = await browser.newPage({ viewport: { width: 1672, height: 941 } });
  await page.goto("http://127.0.0.1:5199");
  await page.waitForSelector("#loading.hidden", { state: "attached", timeout: 120000 });
  await page.waitForSelector("#briefing:not(.hidden)");
  await page.evaluate(async () => {
    const url = performance.getEntriesByType("resource").map((e) => e.name).findLast((n) => /\/src\/game\.ts(?:\?|$)/.test(n));
    window.midway = (await import(url)).default.scene;
  });
  await page.click("#start-air");
  await page.waitForTimeout(2500);
  await page.keyboard.press("KeyC");
  await page.waitForTimeout(1600);
  await page.screenshot({ path: "screenshots/cockpit-review.png" });
  const read = await page.evaluate(() => {
    const p = window.midway.battle.player;
    const m = window.midway.world.playerMesh;
    const needles = [];
    m.traverse((o) => { if (o.name === "Gauge needle") needles.push(+((o.rotation.z * 180) / Math.PI).toFixed(1)); });
    const stick = m.getObjectByName("Control stick");
    return {
      ias: +p.ias.toFixed(1), mph: +(p.ias * 2.23694).toFixed(0), altFt: +(p.y * 3.28084).toFixed(0),
      rpm: +(p.rpm * 3000).toFixed(0), fuel: p.fuel, vyFpm: +(p.vy * 196.85).toFixed(0), headingDeg: +((p.heading * 180) / Math.PI).toFixed(0),
      pitch: +p.pitch.toFixed(3), roll: +p.roll.toFixed(3), throttle: p.throttle,
      stickX: +stick.rotation.x.toFixed(3), stickZ: +stick.rotation.z.toFixed(3), needleAngles: needles,
    };
  });
  console.log(JSON.stringify(read, null, 2));
} finally {
  await browser.close();
}
