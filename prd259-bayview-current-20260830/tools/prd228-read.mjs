// PRD-228 Phase 0 — read one arm's kept run into a ladder row, or refuse it.
//
// Fails closed: no live windows, no SurfaceFlinger cross-check, or a thermal/battery
// end that moved out of NONE is a refused arm, never a quiet number.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const root = process.argv[2] ?? "artifacts/prd228";
const PANEL_W = 2400, PANEL_H = 1080;

function windows(logPath) {
  const seen = new Map();
  for (const line of readFileSync(logPath, "utf8").split("\n")) {
    const at = line.indexOf("TN_FRAME_BUDGET:");
    if (at < 0) continue;
    let d;
    try { d = JSON.parse(line.slice(at + "TN_FRAME_BUDGET:".length).trim()); } catch { continue; }
    seen.set(d.window, d);
  }
  return [...seen.values()].sort((a, b) => a.window - b.window);
}

// Liveness. Method rule 9's `update.mean >= 3 ms` was calibrated before PRD-227 cut the
// update phase to ~0.46 ms; it now rejects every genuinely live window. The classifier
// here is the steady-state test that rule was reaching for: the simulation is stepping
// and the window is not one of the two that follow a launch.
const live = (ws) => ws.filter((w, i) => i >= 2 && w.substeps.mean >= 1 && w.phases.update.mean > 0.05);

const pct = (xs, p) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
};
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;

function sfFps(path) {
  if (!existsSync(path)) return null;
  const text = readFileSync(path, "utf8");
  // The game's own surface, never the aggregate and never the view-root layer: an fps
  // claim cross-checked against the wrong layer is not a cross-check.
  const start = text.indexOf("(BLAST)");
  if (start < 0) return { error: "no game BLAST layer in timestats" };
  const block = text.slice(start, start + 4000);
  const frames = Number(/totalFrames = (\d+)/.exec(block)?.[1] ?? NaN);
  const fps = Number(/averageFPS = ([\d.]+)/.exec(block)?.[1] ?? NaN);
  const hist = /present2present histogram is as below:\n([\s\S]*?)\n(?:present2presentDelta|postToPresent)/.exec(block);
  const bins = (hist?.[1] ?? "").trim().split("\n")
    .map((l) => l.trim()).filter((l) => /^\d+ms=\d+/.test(l) && !/=0$/.test(l));
  return { frames, fps, present2present: bins.join(" ") };
}

const rows = [];
for (const label of readdirSync(root).sort()) {
  const dir = join(root, label);
  const kept = join(dir, "logcat-kept.txt");
  if (!existsSync(kept)) continue;
  const cfg = readFileSync(join(dir, "config.txt"), "utf8");
  const scale = Number(/resolutionScale: ([\d.]+)/.exec(cfg)?.[1]);
  const aa = /antialias: (true|false)/.exec(cfg)?.[1] ?? "?";
  const maxFps = Number(/maxFps: (\d+)/.exec(cfg)?.[1]);
  const all = windows(kept);
  const ws = live(all);
  if (ws.length < 3) { rows.push({ label, refused: `only ${ws.length} live windows of ${all.length}` }); continue; }
  const w = Math.max(1, Math.round(PANEL_W * scale)), h = Math.max(1, Math.round(PANEL_H * scale));
  rows.push({
    label, scale, aa, maxFps,
    uncapped: /present_uncapped=1/.test(readFileSync(join(dir, "present-mode.txt"), "utf8")),
    buffer: `${w}x${h}`, mpx: +(w * h / 1e6).toFixed(4),
    liveWindows: ws.length, ofWindows: all.length,
    fps: +mean(ws.map((x) => x.fps)).toFixed(2),
    presentedP50: +mean(ws.map((x) => x.presented.p50)).toFixed(2),
    presentedP95: +pct(ws.map((x) => x.presented.p95), 0.5).toFixed(2),
    renderP50: +mean(ws.map((x) => x.phases.render.p50)).toFixed(2),
    renderP95: +pct(ws.map((x) => x.phases.render.p95), 0.5).toFixed(2),
    hostGapP50: +mean(ws.map((x) => x.phases.hostGap.p50)).toFixed(2),
    updateMean: +mean(ws.map((x) => x.phases.update.mean)).toFixed(2),
    sf: sfFps(join(dir, "sf-kept.txt")),
    apk: readFileSync(join(dir, "apk.sha256"), "utf8").trim().slice(0, 16),
    // The panel is part of the arm. A slope fitted across two refresh rates is fitting two
    // machines at once, which is the confound this whole PRD exists to stop.
    panelHz: JSON.parse(readFileSync(join(dir, "preflight-before.json"), "utf8")).activeRefreshHz,
    batteryStart: JSON.parse(readFileSync(join(dir, "preflight-before.json"), "utf8")).batteryPercent,
    thermalEnd: /Thermal Status: (\d+)/.exec(readFileSync(join(dir, "battery-after.txt"), "utf8"))?.[1] ?? "?",
    batteryEnd: /level: (\d+)/.exec(readFileSync(join(dir, "battery-after.txt"), "utf8"))?.[1] ?? "?",
  });
}

console.log(JSON.stringify(rows, null, 1));

// Least-squares slope of presented p50 against megapixels, on accepted arms only.
// One panel per fit, and the panel with the most arms wins: the ladder is a slope arm and the
// PRD's acceptance runs separately at 60 Hz.
const candidates = rows.filter((r) => !r.refused && r.uncapped);
const byPanel = new Map();
for (const r of candidates) byPanel.set(r.panelHz, [...(byPanel.get(r.panelHz) ?? []), r]);
const fit = [...byPanel.values()].sort((a, b) => b.length - a.length)[0] ?? [];
if (fit.length > 0) console.log(`FIT PANEL: ${fit[0].panelHz} Hz, ${fit.length} arm(s); other panels reported but not fitted`);
if (fit.length >= 3) {
  for (const key of ["presentedP50", "presentedP95", "renderP50"]) {
    const n = fit.length, sx = mean(fit.map((r) => r.mpx)), sy = mean(fit.map((r) => r[key]));
    const num = fit.reduce((a, r) => a + (r.mpx - sx) * (r[key] - sy), 0);
    const den = fit.reduce((a, r) => a + (r.mpx - sx) ** 2, 0);
    const m = num / den, b = sy - m * sx;
    const ssTot = fit.reduce((a, r) => a + (r[key] - sy) ** 2, 0);
    const ssRes = fit.reduce((a, r) => a + (r[key] - (m * r.mpx + b)) ** 2, 0);
    console.log(`SLOPE ${key}: ${m.toFixed(2)} ms/Mpx  intercept ${b.toFixed(2)} ms  R2 ${(1 - ssRes / ssTot).toFixed(3)}  n=${n}`);
  }
  const sorted = [...fit].sort((a, b) => a.mpx - b.mpx);
  const mono = sorted.every((r, i) => i === 0 || r.presentedP50 >= sorted[i - 1].presentedP50);
  console.log(`MONOTONIC in presented p50: ${mono}`);
}
