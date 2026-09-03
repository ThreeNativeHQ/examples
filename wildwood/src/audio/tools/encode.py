#!/usr/bin/env python3
"""Turn the generated mp3 into the Ogg Vorbis the game ships, and measure the result.

    TN_AUDIO_RAW=<dir of generated mp3> python3 encode.py [<output dir>]

Ogg Vorbis because it is the one codec both targets decode: `decodeAudioFile` in the native host
sniffs `OggS` and runs stb_vorbis, and every other container falls through to a WAV decoder that
rejects it. mp3 also carries encoder padding no runtime can trim, because native never wires
`loopStart` into its mixer.

Loops are made seamless here rather than at runtime, for the same reason.
"""
import json
import os
import subprocess
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
RAW = os.environ.get("TN_AUDIO_RAW", os.path.join(HERE, "raw"))
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, "audio")
RATE = 44100
os.makedirs(OUT, exist_ok=True)


def decode(path: str, highpass: float = 0.0) -> np.ndarray:
    """(frames, channels) float32. ffmpeg honours the mp3 encoder delay/padding it was given.

    `highpass` is applied here rather than in numpy because it has to happen before the loop
    cross-fade: low-frequency wander is what makes a head and a tail sit at different offsets, and
    a filter run afterwards would reintroduce its own transient at the join.
    """
    probe = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "a:0", "-show_entries",
         "stream=channels", "-of", "json", path],
        capture_output=True, check=True, text=True)
    channels = json.loads(probe.stdout)["streams"][0]["channels"]
    command = ["ffmpeg", "-v", "error", "-i", path]
    if highpass > 0:
        # Two poles, 12 dB/octave. Steeper rings; gentler leaves the rumble in.
        command += ["-af", f"highpass=f={highpass:g}:poles=2"]
    command += ["-f", "f32le", "-ar", str(RATE), "-ac", str(channels), "-"]
    raw = subprocess.run(command, capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype="<f4").reshape(-1, channels).astype(np.float64)


def to_mono(x: np.ndarray) -> np.ndarray:
    return x.mean(axis=1, keepdims=True) if x.shape[1] > 1 else x


def seam_loop(x: np.ndarray, fade_seconds: float) -> np.ndarray:
    """Cross-fade the tail onto the head and drop it, so the last sample precedes the first.

    After this, y[-1] is x[n-L-1] and y[0] is x[n-L]: two samples that were adjacent in the source.
    The wrap is therefore exactly as continuous as any interior step, which is the thing
    `verify.py` measures — against the steps *near the join*, not against the whole clip.
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
    """Strip the lead-in and tail-out silence a generation spends on nothing."""
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


JOBS = [
    # name, source stem, cross-fade seconds (0 = one-shot), mono, vorbis quality, peak dBFS, highpass Hz
    ("forest-bed", "forest-bed", 0.6, False, 1.0, -3.0, 0.0),
    # 110 Hz: the first cut of this layer carried 6.1% of its energy below 100 Hz, which is
    # rumble a wood does not have and a sparse clip cannot hide. Birdsong starts around 1 kHz,
    # so nothing wanted is anywhere near the corner.
    ("forest-birds", "forest-birds", 0.5, True, 0.0, -6.0, 110.0),
    ("lake-shore", "lake-shore", 0.4, True, 0.0, -3.0, 0.0),
    # `chime-c`, not the first take. The original prompt asked for "soft struck wooden resonance"
    # and got exactly that: 83% of its energy in 100-500 Hz and nothing above 1 kHz — a hum, on
    # the one cue this game exists to acknowledge. This take asks for a struck glass bell and
    # spreads its partials from mid to air, which is what a chime is.
    # -4 dBFS, not the -1.5 the first cut used. Vorbis is a lapped transform and overshoots a
    # percussive attack by a decibel or two on decode; at -1.5 this clip came back at exactly
    # 1.000 and the inspector called it clipping. Headroom has to survive the codec, not the
    # encoder input.
    ("landmark-found", "chime-c", 0.0, False, 0.0, -4.0, 120.0),
]
# 100 Hz on every footstep. The inspector caught what nobody had listened for: step-rock-3 came
# back with 45% of its energy below 100 Hz, rock-1 with 24% and grass-1 with 13%. A boot on stone
# is a dry click with body around 200-800 Hz; sub-bass under it is generator rumble, and at one
# step every 0.82 m of walking it thumps. The corner is well below anything a step needs.
for surface in ("grass", "dirt", "rock", "leaf", "water"):
    for variant in (1, 2, 3):
        name = f"step-{surface}-{variant}"
        JOBS.append((name, name, 0.0, True, 0.0, -3.0, 100.0))

report = []
for name, stem, fade, mono, quality, peak, highpass in JOBS:
    x = decode(os.path.join(RAW, f"{stem}.mp3"), highpass)
    if mono:
        x = to_mono(x)
    x = seam_loop(x, fade) if fade > 0 else trim(x)
    x = normalize(x, peak)
    path = os.path.join(OUT, f"{name}.ogg")
    encode(x, path, quality)
    report.append({
        "name": name, "source": stem, "bytes": os.path.getsize(path),
        "seconds": round(len(x) / RATE, 3), "channels": x.shape[1], "loop": fade > 0,
        "highpassHz": highpass,
    })

total = sum(row["bytes"] for row in report)
for row in report:
    kind = "loop" if row["loop"] else "one-shot"
    hp = f"hp {row['highpassHz']:g}Hz" if row["highpassHz"] else ""
    print(f"{row['name']:<20} {row['bytes']:>7} B  {row['seconds']:>6.2f}s  "
          f"{row['channels']}ch  {kind:<9} {hp}")
print(f"{'TOTAL':<20} {total:>7} B  ({total / 1024:.1f} KiB)")
with open(os.path.join(HERE, "report.json"), "w") as handle:
    json.dump(report, handle, indent=2)
print(f"report -> {os.path.join(HERE, 'report.json')}")
