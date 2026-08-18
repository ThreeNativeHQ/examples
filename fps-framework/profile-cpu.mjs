// Captures a real Chromium CPU profile and reports the hottest JavaScript call frames.
import { chromium } from "playwright";

const url = process.argv[2] ?? "http://127.0.0.1:5180/";
const browser = await chromium.launch({
  headless: false,
  args: [
    "--ozone-platform=x11",
    "--enable-unsafe-webgpu",
    "--disable-gpu-sandbox",
    "--ignore-gpu-blocklist",
    "--enable-features=Vulkan",
  ],
});

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto(url, { waitUntil: "load" });
  await page.waitForTimeout(7_000);
  const renderStats = await page.evaluate(async () => {
    const { default: game } = await import("/src/game.ts");
    const info = game.ctx?.renderer?.raw?.info;
    return info === undefined
      ? null
      : {
          calls: info.render?.calls,
          triangles: info.render?.triangles,
          geometries: info.memory?.geometries,
          textures: info.memory?.textures,
        };
  });
  const session = await page.context().newCDPSession(page);
  await session.send("Profiler.enable");
  await session.send("Profiler.setSamplingInterval", { interval: 100 });
  await session.send("Profiler.start");
  await page.waitForTimeout(5_000);
  const { profile } = await session.send("Profiler.stop");

  const nodes = new Map(profile.nodes.map((node) => [node.id, node]));
  const micros = new Map();
  for (let index = 0; index < (profile.samples?.length ?? 0); index += 1) {
    const id = profile.samples[index];
    const delta = profile.timeDeltas?.[index] ?? 0;
    micros.set(id, (micros.get(id) ?? 0) + delta);
  }
  const top = [...micros]
    .map(([id, selfMicros]) => {
      const frame = nodes.get(id)?.callFrame;
      return {
        function: frame?.functionName || "(anonymous)",
        selfMs: Number((selfMicros / 1_000).toFixed(1)),
        url: frame?.url?.replace(/^.*\/src\//, "src/").replace(/^.*\/node_modules\//, "node_modules/"),
        line: (frame?.lineNumber ?? -1) + 1,
      };
    })
    .filter((row) => row.selfMs >= 1)
    .sort((a, b) => b.selfMs - a.selfMs)
    .slice(0, 25);
  console.log(JSON.stringify({ renderStats, top }, null, 2));
} finally {
  await browser.close();
}
