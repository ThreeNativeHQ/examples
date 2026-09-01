import { chromium } from "playwright";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
page.on("console", (m) => console.log(`[${m.type()}]`, m.text().slice(0, 300)));
page.on("pageerror", (e) => console.log("[pageerror]", String(e).slice(0, 800)));
await page.goto(process.argv[2], { waitUntil: "load" });
await page.waitForTimeout(15000);
console.log("globals:", await page.evaluate(() => Object.keys(globalThis).filter((k) => /three|playtest|tn/i.test(k))));
await browser.close();
