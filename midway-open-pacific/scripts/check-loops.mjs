/**
 * Loop-seam check (PRD AC-9): every packaged looping cue must wrap without an audible step.
 *
 * One loop with a bad seam clicks once per cycle, which no screenshot or playtest can see. This
 * decodes each looping cue to 8 kHz mono PCM with ffmpeg and compares the wrap-to-start step against
 * the clip's own 99th-percentile adjacent-sample step: a seamless loop's wrap is ordinary sample
 * noise, not a discontinuity. Run: node scripts/check-loops.mjs
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(readFileSync(resolve(root, "content/audio/midway-audio.json"), "utf8"));
/** A wrap step within this multiple of the clip's ordinary step is inaudible; higher is a click. */
const MAX_RATIO = 12;

function pcm(file) {
  const raw = execFileSync("ffmpeg", ["-v", "error", "-i", file, "-ac", "1", "-ar", "8000", "-f", "s16le", "-"], {
    maxBuffer: 1 << 28,
  });
  const count = Math.floor(raw.length / 2);
  const out = new Float32Array(count);
  for (let i = 0; i < count; i += 1) out[i] = raw.readInt16LE(i * 2) / 32768;
  return out;
}

const rows = manifest.sfx.filter((r) => r.loop && existsSync(resolve(root, "public/assets", r.file)));
assert.ok(rows.length > 20, `expected the looping bank, found ${rows.length}`);
const worst = [];
for (const row of rows) {
  const x = pcm(resolve(root, "public/assets", row.file));
  assert.ok(x.length > 1000, `${row.id}: decoded too few samples`);
  const steps = new Float32Array(x.length - 1);
  for (let i = 1; i < x.length; i += 1) steps[i - 1] = Math.abs(x[i] - x[i - 1]);
  const sorted = Float32Array.from(steps).sort();
  const p99 = sorted[Math.floor(sorted.length * 0.99)] || 1e-5;
  const wrap = Math.abs(x[0] - x[x.length - 1]);
  worst.push({ id: row.id, ratio: wrap / p99, wrap, p99 });
}
worst.sort((a, b) => b.ratio - a.ratio);
const bad = worst.filter((w) => w.ratio > MAX_RATIO);
console.log(
  `check-loops: ${rows.length} loops measured; worst ${worst
    .slice(0, 4)
    .map((w) => `${w.id}=${w.ratio.toFixed(2)}x`)
    .join(", ")}`,
);
assert.equal(bad.length, 0, `seam ratio over ${MAX_RATIO}x: ${bad.map((b) => `${b.id} ${b.ratio.toFixed(1)}x`).join(", ")}`);
console.log("check-loops: all packaged loops wrap below the seam threshold");
