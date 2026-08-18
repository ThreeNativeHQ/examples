import { chromium } from "playwright";
const b = await chromium.launch({ headless:false, args:["--enable-unsafe-webgpu","--enable-features=Vulkan","--disable-gpu-sandbox","--ignore-gpu-blocklist"] });
const p = await b.newPage({ viewport:{width:800,height:600} });
p.on("response", r => { if (r.status()>=400) console.log("[http]", r.status(), r.url()); });
await p.goto("http://127.0.0.1:5183", { waitUntil:"load" });
await p.waitForTimeout(3000);
await b.close();
