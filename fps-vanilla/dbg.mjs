import { chromium } from "playwright";
const b = await chromium.launch({ headless:false, args:["--enable-unsafe-webgpu","--enable-features=Vulkan","--disable-gpu-sandbox","--ignore-gpu-blocklist"] });
const p = await b.newPage({ viewport:{width:1536,height:1024} });
p.on("pageerror", e=>console.log("[pageerror]",String(e)));
await p.goto("http://127.0.0.1:5183", { waitUntil:"load" });
await p.waitForTimeout(4500);
// aim down the sights via the keyboard binding
await p.keyboard.down("KeyE"); await p.waitForTimeout(1200);
await p.screenshot({path:"/tmp/ads.png"});
console.log("fov", await p.evaluate(() => +window.__g.camera.fov.toFixed(1)));
await p.keyboard.up("KeyE"); await p.waitForTimeout(1200);
console.log("fov-hip", await p.evaluate(() => +window.__g.camera.fov.toFixed(1)));
// reload drops the sights
await p.keyboard.press("Space"); await p.waitForTimeout(120);
await p.screenshot({path:"/tmp/hitmarker.png"});
await b.close();
