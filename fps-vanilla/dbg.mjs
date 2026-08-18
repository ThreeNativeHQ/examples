import { chromium } from "playwright";
const b = await chromium.launch({ headless:false, args:["--enable-unsafe-webgpu","--enable-features=Vulkan","--disable-gpu-sandbox","--ignore-gpu-blocklist"] });
const p = await b.newPage({ viewport:{width:800,height:600} });
p.on("pageerror", e=>console.log("[pageerror]",String(e)));
await p.goto("http://127.0.0.1:5183", { waitUntil:"load" });
await p.waitForTimeout(4000);
const st = async (tag) => console.log(tag, JSON.stringify(await p.evaluate(() => {
  const s = window.__g.state; return {sc:s.score,hp:s.health,am:s.ammo,rs:s.reserve,sh:s.shots,rl:s.reloads,th:s.targetsHit,dm:+s.distanceMoved.toFixed(2),tr:+s.timeRemaining.toFixed(1),ph:s.phase};
})));
await st("start   ");
await p.keyboard.press("Space"); await p.waitForTimeout(300); await st("1 shot  ");
for (let i=0;i<4;i++){ await p.keyboard.press("Space"); await p.waitForTimeout(200);} await st("5 shots ");
await p.keyboard.press("KeyR"); await p.waitForTimeout(900); await st("reload  ");
await p.keyboard.down("KeyW"); await p.waitForTimeout(1000); await p.keyboard.up("KeyW"); await st("walked  ");
await p.keyboard.press("Space"); await p.waitForTimeout(300); await st("shot@new");
await p.keyboard.press("Enter"); await p.waitForTimeout(300); await st("retry   ");
console.log("enemy", JSON.stringify(await p.evaluate(() => ({ st: window.__g.scene.children.length }))));
await b.close();
