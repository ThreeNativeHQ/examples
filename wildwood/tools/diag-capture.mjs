import { chromium } from "playwright";
const browser = await chromium.launch({
  headless: false,
  args: ["--enable-unsafe-webgpu", "--enable-features=Vulkan,VulkanFromANGLE,DefaultANGLEVulkan", "--use-angle=vulkan"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on("console", (m) => { const t = m.text(); if (/error|Error|warn|unhandled|fail/i.test(t)) console.log(`[c.${m.type()}] ${t.slice(0, 260)}`); });
page.on("pageerror", (e) => console.log(`[pageerror] ${String(e?.stack ?? e).slice(0, 600)}`));
await page.goto("http://localhost:5173/", { waitUntil: "networkidle", timeout: 180_000 });
await page.waitForTimeout(12000);
await page.screenshot({ path: "/tmp/wildwood-shots/diag3.png" });
await browser.close();
