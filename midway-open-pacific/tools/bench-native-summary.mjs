// Summarise a native runtime log from the moment of the airborne start: one line per
// TN_FRAME_BUDGET window, then a run total. Usage: node tools/bench-native-summary.mjs <log> <startLine>
import { readFileSync } from "node:fs";

const [file, startArg] = process.argv.slice(2);
const lines = readFileSync(file, "utf8").split("\n").slice(Number(startArg ?? 0));
const med = (a) => (a.length ? [...a].sort((x, y) => x - y)[a.length >> 1] : null);
const pct = (a, p) => (a.length ? [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(p * a.length))] : null);
const windows = [];
let ui = [];
let pipelines = 0;
let pipelineMs = 0;
let pipelineMax = 0;
for (const line of lines) {
  const at = line.indexOf("TN_");
  if (at < 0) continue;
  const colon = line.indexOf(":", at);
  const tag = line.slice(at, colon);
  let j;
  try {
    j = JSON.parse(line.slice(colon + 1));
  } catch {
    continue;
  }
  if (tag === "TN_UI_COMPOSITE") ui.push(j.uploadsPerSecond);
  else if (tag === "TN_PIPELINE_EVENT" && j.status === "created") {
    pipelines += 1;
    pipelineMs += j.serviceMs ?? 0;
    pipelineMax = Math.max(pipelineMax, j.serviceMs ?? 0);
  } else if (tag === "TN_FRAME_BUDGET" && j.frames >= 100) {
    const p = j.phases ?? {};
    windows.push({
      fps: j.fps,
      p95: j.presented?.p95,
      p99: j.presented?.p99,
      max: j.presented?.max,
      update: p.update?.max,
      render: p.render?.p99,
      ui: p.ui?.p95,
      uploads: med(ui),
    });
    ui = [];
  }
}
// The first window after the click is the takeoff transition; it is reported, never averaged in.
for (const [i, w] of windows.entries())
  console.log(
    `w${i} fps ${w.fps} presented p95 ${w.p95} p99 ${w.p99} max ${w.max} | update max ${w.update} render p99 ${w.render} ui p95 ${w.ui} | UI uploads/s ${w.uploads}`,
  );
const steady = windows.slice(1);
const all = (k) => steady.map((w) => w[k]).filter((v) => typeof v === "number");
console.log(
  JSON.stringify({
    windows: steady.length,
    fpsMedian: med(all("fps")),
    presentedP95Median: med(all("p95")),
    presentedP99Median: med(all("p99")),
    presentedP99Worst: pct(all("p99"), 1),
    worstFrame: pct(all("max"), 1),
    updateMaxWorst: pct(all("update"), 1),
    renderP99Median: med(all("render")),
    uiP95Median: med(all("ui")),
    uiUploadsMedian: med(all("uploads")),
    pipelinesAfterStart: pipelines,
    pipelineServiceMs: Math.round(pipelineMs),
    pipelineMaxMs: Math.round(pipelineMax),
  }),
);
