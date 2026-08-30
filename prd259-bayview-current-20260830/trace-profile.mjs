import { writeFile } from "node:fs/promises";
import { chromium } from "playwright";

const url = process.argv[2] ?? "http://127.0.0.1:5180/";
const output = process.argv[3] ?? "screenshots/chrome-performance-trace.json";
const browser = await chromium.launch({
  headless: false,
  args: [
    "--enable-unsafe-webgpu",
    "--enable-features=Vulkan",
    "--disable-gpu-sandbox",
    "--ignore-gpu-blocklist",
    "--window-size=1280,800",
  ],
});

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(url, { waitUntil: "load", timeout: 60_000 });
  await page.waitForTimeout(9_000);
  await page.mouse.click(640, 400);
  await page.waitForTimeout(500);

  const session = await page.context().newCDPSession(page);
  await session.send("Tracing.start", {
    categories: [
      "-*",
      "blink.user_timing",
      "cc",
      "devtools.timeline",
      "disabled-by-default-devtools.timeline",
      "disabled-by-default-devtools.timeline.frame",
      "disabled-by-default-devtools.timeline.stack",
      "gpu",
      "toplevel",
      "v8.execute",
      "viz",
    ].join(","),
    options: "sampling-frequency=10000,enable-sampling",
    transferMode: "ReturnAsStream",
  });
  await page.waitForTimeout(6_000);
  const complete = new Promise((resolve) => session.once("Tracing.tracingComplete", resolve));
  await session.send("Tracing.end");
  const { stream } = await complete;
  let json = "";
  for (;;) {
    const chunk = await session.send("IO.read", { handle: stream });
    json += chunk.data;
    if (chunk.eof) break;
  }
  await session.send("IO.close", { handle: stream });
  await writeFile(output, json);

  const trace = JSON.parse(json);
  const names = new Map();
  for (const event of trace.traceEvents) {
    if (event.ph === "M" && event.name === "thread_name") {
      names.set(`${event.pid}:${event.tid}`, event.args.name);
    }
  }
  const totals = new Map();
  const counts = new Map();
  const frames = [];
  for (const event of trace.traceEvents) {
    if (event.ph !== "X" || typeof event.dur !== "number") continue;
    const thread = names.get(`${event.pid}:${event.tid}`) ?? `${event.pid}:${event.tid}`;
    const key = `${thread} :: ${event.name}`;
    totals.set(key, (totals.get(key) ?? 0) + event.dur / 1_000);
    counts.set(key, (counts.get(key) ?? 0) + 1);
    if (event.name === "DrawFrame" || event.name === "BeginFrame") frames.push(event.ts / 1_000);
  }
  frames.sort((a, b) => a - b);
  const gaps = frames.slice(1).map((time, index) => time - frames[index]);
  gaps.sort((a, b) => a - b);
  const top = [...totals.entries()]
    .map(([name, totalMs]) => ({ name, totalMs: +totalMs.toFixed(2), count: counts.get(name) }))
    .sort((left, right) => right.totalMs - left.totalMs)
    .slice(0, 30);
  const percentile = (values, fraction) =>
    values.length === 0 ? null : +values[Math.floor((values.length - 1) * fraction)].toFixed(2);
  console.log(
    JSON.stringify(
      {
        output,
        bytes: json.length,
        pageErrors: errors,
        frameEvents: frames.length,
        frameGapMedianMs: percentile(gaps, 0.5),
        frameGapP95Ms: percentile(gaps, 0.95),
        top,
      },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
}
