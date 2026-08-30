import { chromium } from "playwright";
const browser = await chromium.launch({ headless:false, args:["--enable-unsafe-webgpu","--enable-features=Vulkan","--disable-gpu-sandbox","--ignore-gpu-blocklist"] });
try {
  const page = await browser.newPage({ viewport:{width:1280,height:800} });
  await page.goto(process.argv[2], { waitUntil:"load", timeout:60000 });
  await page.waitForTimeout(9000);
  const out = await page.evaluate(() => {
    const b = window.__THREENATIVE_PLAYTEST_BRIDGE__;
    const describe = b.describe ? b.describe() : null;
    let sample=null, err=null;
    for (const arg of [undefined, {}, {fields:["resources"]}, {resources:true}]) {
      try { sample = arg===undefined ? b.sample() : b.sample(arg); break; } catch(e){ err=String(e).slice(0,120); }
    }
    return { describe, sampleKeys: sample?Object.keys(sample):null, sample: sample?JSON.parse(JSON.stringify(sample)).__proto__===undefined?null:sample:null, err };
  });
  console.log(JSON.stringify(out, (k,v)=>typeof v==="string"&&v.length>300?v.slice(0,300):v, 2).slice(0,3000));
} finally { await browser.close(); }
