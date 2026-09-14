import { chromium } from "playwright";
const url = process.env.MIDWAY_URL;
const b = await chromium.launch({ headless: false, args: ["--enable-unsafe-webgpu","--enable-features=Vulkan","--disable-gpu-sandbox","--ignore-gpu-blocklist","--ozone-platform=x11","--enable-dawn-features=allow_unsafe_apis"] });
const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
p.on("console", m => console.log("console:", m.type(), m.text().slice(0,300)));
p.on("pageerror", e => console.log("pageerror:", String(e).slice(0,500)));
p.on("requestfailed", r => console.log("reqfail:", r.url().slice(0,200), r.failure()?.errorText));
const t0 = Date.now();
await p.goto(url);
try { await p.waitForSelector("#loading.hidden", { state: "attached", timeout: 180000 }); console.log("loaded in", Date.now()-t0, "ms"); }
catch (e) { console.log("TIMEOUT after", Date.now()-t0, "ms"); console.log(await p.evaluate(() => document.getElementById("loading")?.textContent?.slice(0,300))); }
await b.close();
