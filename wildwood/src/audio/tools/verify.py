#!/usr/bin/env python3
"""Measure the files the game actually ships, decoded the way a runtime decodes them.

The intermediate PCM is not the thing that plays; Vorbis is lossy and could in principle move the
first and last samples apart again. So this decodes the .ogg back and asks two questions of every
loop:

  1. Did the codec preserve the length? Ogg Vorbis carries an exact sample count in its granule
     position — unlike mp3, which is why mp3 loops click — so the decoded length must match.
  2. Is the wrap step ordinary? Not "is it zero", which no real signal is, but: among all
     |x[i+1] - x[i]| inside the clip, what fraction are smaller than the wrap step |x[0] - x[-1]|?
     A seam sitting at the 40th percentile of ordinary steps is one no listener can pick out.
"""
import json
import os
import subprocess
import sys

import numpy as np

RATE = 44100
AUDIO = sys.argv[1]
REPORT = json.load(open(sys.argv[2]))
LOOPS = {row["name"] for row in REPORT if row["loop"]}
INTENDED = {row["name"]: row["seconds"] for row in REPORT}

rows = []
for row in REPORT:
    name = row["name"]
    path = os.path.join(AUDIO, f"{name}.ogg")
    channels = row["channels"]
    raw = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", path, "-f", "f32le", "-ar", str(RATE),
         "-ac", str(channels), "-"],
        capture_output=True, check=True).stdout
    x = np.frombuffer(raw, dtype="<f4").reshape(-1, channels).astype(np.float64)
    seconds = len(x) / RATE
    drift_ms = (seconds - INTENDED[name]) * 1000.0
    interior = np.abs(np.diff(x, axis=0)).max(axis=1)
    wrap = float(np.abs(x[0] - x[-1]).max())
    rank = float((interior < wrap).mean() * 100.0)
    rows.append((name, name in LOOPS, os.path.getsize(path), seconds, drift_ms, wrap, rank,
                 float(np.abs(x).max())))

print(f"{'clip':<20}{'kind':<10}{'bytes':>8}{'sec':>8}{'drift ms':>10}"
      f"{'wrap':>10}{'pctile':>9}{'peak':>7}")
worst = 0.0
for name, loop, size, seconds, drift, wrap, rank, peak in rows:
    kind = "loop" if loop else "one-shot"
    mark = ""
    if loop:
        worst = max(worst, rank)
        mark = "  <-- seam" if rank > 99.0 else ""
    print(f"{name:<20}{kind:<10}{size:>8}{seconds:>8.2f}{drift:>10.3f}"
          f"{wrap:>10.6f}{rank:>8.1f}%{peak:>7.3f}{mark}")

total = sum(row[2] for row in rows)
decoded = sum(row[3] * RATE * (2 if row[0] in ("forest-bed", "landmark-found") else 1) * 4
              for row in rows)
print(f"\nshipped bytes  {total} ({total / 1024:.1f} KiB)")
print(f"decoded PCM    {decoded / 1024 / 1024:.2f} MiB resident if every clip is held at once")
print(f"worst loop seam sits at the {worst:.1f}th percentile of that clip's own sample steps")
