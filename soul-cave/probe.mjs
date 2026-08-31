import { chromium } from "playwright";
const url = process.argv[3] ?? "http://127.0.0.1:5174/";
const browser = await chromium.launch({
  headless: false,
  args: ["--ozone-platform=x11","--enable-unsafe-webgpu","--disable-gpu-sandbox","--ignore-gpu-blocklist","--enable-features=Vulkan"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const logs = [];
page.on("console", m => logs.push(`[${m.type()}] ${m.text()}`));
page.on("pageerror", e => logs.push(`[pageerror] ${e.message}`));
await page.goto(url, { waitUntil: "load", timeout: 90000 });
await page.waitForTimeout(Number(process.argv[4] ?? 25000));
await page.screenshot({ path: process.argv[2] });
console.log(logs.slice(0,45).join("\n"));
await browser.close();
