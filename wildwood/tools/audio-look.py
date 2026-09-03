#!/usr/bin/env python3
"""Look at audio, since I cannot listen to it: `python3 tools/audio-look.py <file.ogg> ...`

Writes one PNG spectrogram per input beside a printed summary, so a clip can be checked against
what the scene needs without anybody hearing it. An agent that can see images but not hear them
can still tell a forest from a drone, a drone from silence, and a footstep from a hum — those
are visually unmistakable in a spectrogram, and none of them are distinguishable from the file
size, the duration, or a green "loaded" marker.

What each check is for, and what it catches:

* **Band energy.** A temperate wood is broadband: leaf rustle sits above 2 kHz, birds put narrow
  peaks in 2-8 kHz, and there should be very little below 100 Hz because a forest has no engine
  in it. A generated clip that came back as a synth pad or a room tone shows up as a low-frequency
  bar and nothing above it.
* **Loop seam.** For anything that loops, the last samples have to meet the first. A discontinuity
  is a click every cycle, which is the single most noticeable defect in an ambient bed.
* **Peak and DC.** A clip that clips is distorted; a clip with DC offset wastes headroom and can
  thump when it starts.
* **Silence.** A file that decoded to near-nothing is a generation failure that every other check
  reports as success.
"""

import subprocess
import sys
from pathlib import Path

import numpy as np

SAMPLE_RATE = 22_050  # plenty for a look; halves the FFT work


def decode(path: Path) -> np.ndarray:
    """Mono float32 via ffmpeg, so this works for any container the game ships."""
    raw = subprocess.run(
        [
            "ffmpeg", "-v", "error", "-i", str(path),
            "-f", "f32le", "-ac", "1", "-ar", str(SAMPLE_RATE), "-",
        ],
        capture_output=True,
        check=True,
    ).stdout
    return np.frombuffer(raw, dtype=np.float32)


def spectrogram_png(samples: np.ndarray, out: Path, title: str) -> None:
    window = 1024
    hop = max(1, len(samples) // 900)
    frames = range(0, max(1, len(samples) - window), hop)
    taper = np.hanning(window)
    columns = []
    for start in frames:
        chunk = samples[start : start + window] * taper
        spectrum = np.abs(np.fft.rfft(chunk))
        columns.append(spectrum[: window // 2])
    if not columns:
        return
    image = np.array(columns).T  # frequency up, time across
    # Log magnitude, then normalise, so quiet detail is visible rather than crushed to black.
    image = 20 * np.log10(image + 1e-9)
    image = np.clip((image - image.max() + 70) / 70, 0, 1)
    image = image[::-1]  # low frequency at the bottom, the way a spectrogram is read

    height, width = image.shape
    # Viridis-ish ramp, written by hand to avoid a matplotlib dependency in a game repo.
    stops = np.array(
        [[68, 1, 84], [59, 82, 139], [33, 145, 140], [94, 201, 98], [253, 231, 37]],
        dtype=np.float64,
    )
    position = image.flatten() * (len(stops) - 1)
    low = np.floor(position).astype(int)
    high = np.minimum(low + 1, len(stops) - 1)
    blend = (position - low)[:, None]
    rgb = (stops[low] * (1 - blend) + stops[high] * blend).astype(np.uint8)
    rgb = rgb.reshape(height, width, 3)

    import struct
    import zlib

    def chunk(kind: bytes, payload: bytes) -> bytes:
        return (
            struct.pack(">I", len(payload))
            + kind
            + payload
            + struct.pack(">I", zlib.crc32(kind + payload) & 0xFFFFFFFF)
        )

    scanlines = b"".join(b"\x00" + rgb[y].tobytes() for y in range(height))
    png = (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(scanlines, 6))
        + chunk(b"IEND", b"")
    )
    out.write_bytes(png)
    print(f"  spectrogram -> {out}  ({width}x{height}, {title})")


def band_energy(samples: np.ndarray) -> dict[str, float]:
    spectrum = np.abs(np.fft.rfft(samples * np.hanning(len(samples))))
    freqs = np.fft.rfftfreq(len(samples), 1 / SAMPLE_RATE)
    total = spectrum.sum() + 1e-12
    bands = {
        "sub <100Hz": (0, 100),
        "low 100-500": (100, 500),
        "mid 500-2k": (500, 2000),
        "high 2k-8k": (2000, 8000),
        "air >8k": (8000, SAMPLE_RATE / 2),
    }
    return {
        name: float(spectrum[(freqs >= lo) & (freqs < hi)].sum() / total * 100)
        for name, (lo, hi) in bands.items()
    }


for argument in sys.argv[1:]:
    path = Path(argument)
    samples = decode(path)
    seconds = len(samples) / SAMPLE_RATE
    peak = float(np.abs(samples).max()) if len(samples) else 0.0
    rms = float(np.sqrt((samples**2).mean())) if len(samples) else 0.0
    dc = float(samples.mean()) if len(samples) else 0.0
    # The seam: mean level over 20 ms at each end, and the step between the very last and first
    # sample. A gapless loop has both small.
    edge = min(len(samples), SAMPLE_RATE // 50)
    head = float(np.abs(samples[:edge]).mean()) if edge else 0.0
    tail = float(np.abs(samples[-edge:]).mean()) if edge else 0.0
    step = float(abs(samples[0] - samples[-1])) if len(samples) > 1 else 0.0

    print(f"\n{path.name}  {seconds:.2f}s  peak {peak:.3f}  rms {rms:.4f}  dc {dc:+.5f}")
    if rms < 1e-4:
        print("  *** SILENT — decoded to nothing; this is a generation failure ***")
    if peak >= 0.999:
        print("  *** CLIPPING at full scale ***")
    print(f"  seam: head {head:.4f} tail {tail:.4f} step {step:.4f}")
    print("  bands: " + "  ".join(f"{k} {v:5.1f}%" for k, v in band_energy(samples).items()))
    spectrogram_png(samples, path.with_suffix(".spec.png"), path.stem)
