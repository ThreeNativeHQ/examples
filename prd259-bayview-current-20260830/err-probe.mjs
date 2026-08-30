import { chromium } from "playwright";
const browser = await chromium.launch({ headless:false, args:["--ozone-platform=x11","--enable-unsafe-webgpu","--disable-gpu-sandbox","--ignore-gpu-blocklist","--enable-features=Vulkan"] });
const page = await browser.newPage({ viewport:{width:1280,height:720} });
await page.addInitScript(() => {
  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason;
    const target = reason?.target;
    console.error("TN_UNHANDLED_REJECTION_DETAILS", JSON.stringify({
      constructor: reason?.constructor?.name,
      message: reason?.message,
      stack: reason?.stack,
      type: reason?.type,
      targetConstructor: target?.constructor?.name,
      targetSrc: target?.currentSrc ?? target?.src,
      targetUrl: target?.url,
    }));
  });
});
page.on("pageerror", (e) => console.log("PAGEERROR:\n" + (e.stack ?? e.message)));
page.on("console", (m) => { if (m.type()==="error") console.log("CONSOLE ERROR:", m.text().slice(0,2000)); });
await page.goto(process.argv[2], { waitUntil:"load" });
await page.waitForTimeout(6000);
await browser.close();
