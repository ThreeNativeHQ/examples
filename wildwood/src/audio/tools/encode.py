#!/usr/bin/env python3
"""Turn the generated mp3 into the Ogg Vorbis the game ships, and measure the result.

Ogg Vorbis because it is the one codec both targets decode: `decodeAudioFile` in the native host
sniffs `OggS` and runs stb_vorbis, and every current browser reads it. Opus in an Ogg container is
explicitly rejected over there, and mp3 carries encoder padding no runtime can trim without
`loopStart`, which native does not bind.

Loops are made seamless here rather than at runtime, for the same reason.
"""
import json
import os
import subprocess
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(HERE, "raw")
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, "audio")
RATE = 44100
os.makedirs(OUT, exist_ok=True)


def decode(path: str) -> np.ndarray:
    """(frames, channels) float32. ffmpeg honours the mp3 encoder delay/padding it was given."""
    probe = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "a:0", "-show_entries",
         "stream=channels", "-of", "json", path],
        capture_output=True, check=True, text=True)
    channels = json.loads(probe.stdout)["streams"][0]["channels"]
    raw = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", path, "-f", "f32le", "-ar", str(RATE),
         "-ac", str(channels), "-"],
        capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype="<f4").reshape(-1, channels).astype(np.float64)


def to_mono(x: np.ndarray) -> np.ndarray:
    return x.mean(axis=1, keepdims=True) if x.shape[1] > 1 else x


def seam_loop(x: np.ndarray, fade_seconds: float) -> np.ndarray:
    """Cross-fade the tail onto the head and drop it, so the last sample precedes the first.

    After this, y[-1] is x[n-L-1] and y[0] is x[n-L]: two samples that were adjacent in the source.
    The wrap is therefore exactly as continuous as any interior step, which is the thing the
    measurement below checks.
    """
    fade = int(fade_seconds * RATE)
    if fade * 2 >= len(x):
        raise ValueError("cross-fade is longer than half the clip")
    y = x[: len(x) - fade].copy()
    ramp = (np.arange(fade) / fade).reshape(-1, 1)
    # Equal power: a linear pair dips ~3 dB through the middle of the blend, and on a wind bed
    # that dip is audible as a pulse once a loop.
    y[:fade] = x[:fade] * np.sqrt(ramp) + x[len(x) - fade :] * np.sqrt(1.0 - ramp)
    return y


def trim(x: np.ndarray, floor_db: float = -46.0, pad_seconds: float = 0.01) -> np.ndarray:
    """Strip the lead-in and tail-out silence a 0.5 s generation spends on nothing."""
    level = np.abs(x).max(axis=1)
    threshold = (10.0 ** (floor_db / 20.0)) * max(level.max(), 1e-9)
    loud = np.flatnonzero(level > threshold)
    if loud.size == 0:
        return x
    pad = int(pad_seconds * RATE)
    return x[max(loud[0] - pad, 0) : min(loud[-1] + pad, len(x))]


def normalize(x: np.ndarray, peak_db: float) -> np.ndarray:
    x = x - x.mean(axis=0, keepdims=True)  # DC offset wastes headroom and thumps on a loop wrap
    peak = np.abs(x).max()
    return x if peak < 1e-9 else x * ((10.0 ** (peak_db / 20.0)) / peak)


def encode(x: np.ndarray, path: str, quality: float) -> None:
    channels = x.shape[1]
    subprocess.run(
        ["ffmpeg", "-v", "error", "-y", "-f", "f32le", "-ar", str(RATE), "-ac", str(channels),
         "-i", "-", "-c:a", "libvorbis", "-q:a", str(quality), path],
        input=np.clip(x, -1.0, 1.0).astype("<f4").tobytes(), check=True)


def seam(x: np.ndarray) -> tuple[float, float]:
    """The wrap step, and the 99.9th percentile interior step it has to hide among."""
    interior = np.abs(np.diff(x, axis=0)).max(axis=1)
    wrap = float(np.abs(x[0] - x[-1]).max())
    return wrap, float(np.percentile(interior, 99.9))


JOBS = [
    # name, loop cross-fade seconds (0 = one-shot), mono, vorbis quality, peak dBFS
    ("forest-bed", 0.6, False, 1.0, -3.0),
    ("forest-birds", 0.5, True, 0.0, -6.0),
    ("lake-shore", 0.4, True, 0.0, -3.0),
    ("landmark-found", 0.0, False, 0.0, -1.5),
]
for surface in ("grass", "dirt", "rock", "leaf", "water"):
    for variant in (1, 2, 3):
        JOBS.append((f"step-{surface}-{variant}", 0.0, True, 0.0, -3.0))

report = []
for name, fade, mono, quality, peak in JOBS:
    source = os.path.join(RAW, f"{name}.mp3")
    x = decode(source)
    if mono:
        x = to_mono(x)
    if fade > 0:
        x = seam_loop(x, fade)
    else:
        x = trim(x)
    x = normalize(x, peak)
    path = os.path.join(OUT, f"{name}.ogg")
    encode(x, path, quality)
    wrap, interior = seam(x)
    report.append({
        "name": name, "bytes": os.path.getsize(path), "seconds": round(len(x) / RATE, 3),
        "channels": x.shape[1], "loop": fade > 0,
        "wrapStep": round(wrap, 6), "interiorStepP999": round(interior, 6),
    })

total = sum(row["bytes"] for row in report)
for row in report:
    kind = "loop" if row["loop"] else "one-shot"
    print(f"{row['name']:<20} {row['bytes']:>7} B  {row['seconds']:>6.2f}s  "
          f"{row['channels']}ch  {kind:<8} wrap={row['wrapStep']:.6f} "
          f"interior_p99.9={row['interiorStepP999']:.6f}")
print(f"{'TOTAL':<20} {total:>7} B  ({total / 1024:.1f} KiB)")
with open(os.path.join(HERE, "report.json"), "w") as handle:
    json.dump(report, handle, indent=2)
