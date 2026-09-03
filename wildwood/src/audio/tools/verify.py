#!/usr/bin/env python3
"""Measure the files the game ships, decoded the way a runtime decodes them.

    python3 verify.py <audio dir> <report.json>

Two rules this obeys, both learned the hard way:

**Decode at the file's own sample rate.** A loop seam measured on a resampled decode is measuring
the resampler. Its FIR window runs off the end of the data at the first and last output sample and
gets zero-padded, so the edge samples are the only wrong ones in the file — precisely where a seam
test looks. On this set that inflated the reported step by 3-7x and reordered the clips.

**Compare the wrap against the steps beside it, not against the whole clip.** A click is a step
that is anomalous where it happens. A sparse clip is mostly quiet, so a whole-clip percentile
flatters it; a dense one is mostly loud, so the same percentile condemns it. The 50 ms either side
of the join is what a listener hears the wrap against.
"""
import json
import os
import subprocess
import sys

import numpy as np

RATE = 44100
AUDIO = sys.argv[1]
REPORT = json.load(open(sys.argv[2]))
NEAR = int(0.05 * RATE)


def decode(path: str, channels: int) -> np.ndarray:
    raw = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", path, "-f", "f32le", "-ar", str(RATE),
         "-ac", str(channels), "-"],
        capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype="<f4").reshape(-1, channels).astype(np.float64)


rows = []
for row in REPORT:
    name = row["name"]
    path = os.path.join(AUDIO, f"{name}.ogg")
    x = decode(path, row["channels"])
    steps = np.abs(np.diff(x, axis=0)).max(axis=1)
    near = np.concatenate([steps[:NEAR], steps[-NEAR:]])
    wrap = float(np.abs(x[0] - x[-1]).max())
    rows.append({
        "name": name, "loop": row["loop"], "bytes": os.path.getsize(path),
        "seconds": len(x) / RATE, "drift_ms": (len(x) / RATE - row["seconds"]) * 1000.0,
        "peak": float(np.abs(x).max()), "wrap": wrap,
        "near_p99": float(np.percentile(near, 99)),
        "rank": float((near < wrap).mean() * 100.0),
        "decoded": len(x) * row["channels"] * 4,
    })

print(f"{'clip':<20}{'kind':<10}{'bytes':>8}{'sec':>7}{'drift ms':>10}{'peak':>7}"
      f"{'wrap':>10}{'near p99':>10}{'x p99':>7}{'rank':>8}")
worst = 0.0
for r in rows:
    kind = "loop" if r["loop"] else "one-shot"
    ratio = r["wrap"] / max(r["near_p99"], 1e-9)
    # A one-shot's first and last samples never meet, so its wrap number is not a measurement of
    # anything. Printed as a dash rather than as a number somebody might act on.
    seam = (f"{r['wrap']:>10.6f}{r['near_p99']:>10.6f}{ratio:>7.2f}{r['rank']:>7.1f}%"
            if r["loop"] else f"{'-':>10}{'-':>10}{'-':>7}{'-':>8}")
    if r["loop"]:
        worst = max(worst, ratio)
    print(f"{r['name']:<20}{kind:<10}{r['bytes']:>8}{r['seconds']:>7.2f}"
          f"{r['drift_ms']:>10.3f}{r['peak']:>7.3f}{seam}")

wire = sum(r["bytes"] for r in rows)
decoded = sum(r["decoded"] for r in rows)
print(f"\nshipped {wire} B ({wire / 1024:.1f} KiB)   "
      f"decoded {decoded / 1024 / 1024:.2f} MiB resident   "
      f"ratio {decoded / wire:.1f}x")
print(f"worst loop wrap is {worst:.2f}x the 99th-percentile step beside it "
      f"(1.00x would mean 'as large as the largest ordinary step there')")
