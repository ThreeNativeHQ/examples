import { chromium } from "playwright";
const b = await chromium.launch({ headless:false, args:["--enable-unsafe-webgpu","--enable-features=Vulkan","--disable-gpu-sandbox","--ignore-gpu-blocklist"] });
const p = await b.newPage({ viewport:{width:1536,height:1024} });
p.on("pageerror", e=>console.log("[pageerror]",String(e)));
await p.goto("http://127.0.0.1:5183", { waitUntil:"load" });
await p.waitForTimeout(4000);
// tick-driven: 60 ticks must be exactly one second of game clock
console.log(await p.evaluate(async () => {
  const br = globalThis.__THREENATIVE_PLAYTEST_BRIDGE__;
  const a = (await br.sample({})).resources.state.timeRemaining;
  await br.advance(60);
  const b2 = (await br.sample({})).resources.state.timeRemaining;
  return JSON.stringify({ delta: +(a-b2).toFixed(4) });
}));
// real-time keyboard still works afterwards
await p.waitForTimeout(1200);
await p.keyboard.down("KeyW"); await p.waitForTimeout(800); await p.keyboard.up("KeyW");
await p.keyboard.press("Space"); await p.waitForTimeout(80);
await p.screenshot({path:"/tmp/impact.png"});
console.log(await p.evaluate(() => JSON.stringify({dm:+window.__g.state.distanceMoved.toFixed(2), sh:window.__g.state.shots, sc:window.__g.state.score})));
await b.close();
