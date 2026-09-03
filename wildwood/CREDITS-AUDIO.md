# CREDITS-AUDIO.md — sound in wildwood

Every file in `public/audio/` was generated with **ElevenLabs Sound Effects**, then trimmed,
loop-conditioned and re-encoded locally. No recording, sample pack or third-party asset is used, so
there is no upstream author to credit — but there is a generator and a licence, and both are below.

| Field | Value |
| --- | --- |
| Generator | ElevenLabs Sound Effects (text-to-sound) |
| Model | `eleven_text_to_sound_v2` |
| Endpoint | `POST https://api.elevenlabs.io/v1/sound-generation` |
| Requested format | `mp3_44100_128`; loops requested with `"loop": true` |
| Account tier | Starter (paid) at the time of generation, 2026-09-03 |
| Licence | ElevenLabs grants ownership of, and commercial rights to, output generated on a paid plan. Verify against the terms in force before any commercial release: https://elevenlabs.io/terms |
| Local processing | ffmpeg n9.0.1 (`libvorbis`) plus the NumPy pass described below |

## The files

Nineteen clips, **510,864 bytes (498.9 KiB)** shipped, against a stated budget of 512 KiB, and
**13.71 MiB of float PCM once decoded** — which is the number that matters, because nothing in the
engine streams and every clip is resident at once.

| File | Bytes | Decoded | Length | Ch | Kind |
| --- | --- | --- | --- | --- | --- |
| `forest-bed.ogg` | 220,693 | 7.20 MiB | 21.40 s | 2 | loop |
| `forest-birds.ogg` | 93,352 | 2.37 MiB | 14.10 s | 1 | loop |
| `lake-shore.ogg` | 76,719 | 1.95 MiB | 11.60 s | 1 | loop, positional |
| `landmark-found.ogg` | 22,238 | 1.01 MiB | 3.00 s | 2 | one-shot |
| `step-{grass,leaf,rock,dirt,water}-{1,2,3}.ogg` | 5,983–6,994 each, 97,862 total | 1.18 MiB | 0.38–0.49 s | 1 | one-shot |

Prompts, verbatim, are in `src/audio/tools/generate.py`. The four that shape the wood are: a
late-morning temperate pine ambience of wind in high conifer branches with distant songbirds and
slow trunk creak; a thin detail layer of sparse birds and one creak with long gaps; a quiet
freshwater shoreline of ripples on wet pebbles and reeds; and — see the retakes below — a struck
glass bell with shimmering high partials and a light airy tail.

## Two retakes, and how they were caught

Neither defect was visible to any check that does not involve listening. Both files existed, were
served, decoded, threw no error and sat inside the byte budget.

**`landmark-found.ogg` was a hum.** The first prompt asked for "soft struck *wooden* resonance" and
got exactly that: **79.6% of its energy in 100-500 Hz and 1.1% above 2 kHz**, on the one sound this
game exists to acknowledge. Three brighter candidates were generated and compared by band profile
and spectrogram; two were single narrow tones (86-87% in one band — a beep, and the spectrogram
shows two sustained lines), and the third is a real struck bell: a percussive onset with partials
spread from mid to air and the upper ones decaying faster, which is what a bell does. It ships as
`landmark-found.ogg`, now **0.9% low / 29.4% mid / 42.6% high / 27.1% air**.

It also had to be normalised **4 dB down rather than 1.5 dB**. Vorbis is a lapped transform and
overshoots a percussive attack on decode; at −1.5 dBFS the brighter take came back at exactly
1.000 and read as clipping. Headroom has to survive the codec, not merely precede it.

**Fifteen footsteps were thuds.** Nobody had looked at these at all. `step-rock-3.ogg` carried
**45.2% of its energy below 100 Hz**, rock-1 23.8%, rock-2 13.7%, grass-1 13.1%. A boot on stone is
a dry click with body around 200-800 Hz; sub-bass beneath it is generator rumble, and at one step
per 0.82 m of walking it thumps. All fifteen are now high-passed at 100 Hz and the worst sub-bass
in the set is 4.2%.

**`forest-birds.ogg` was high-passed at 110 Hz** for the same reason — 6.1% below 100 Hz under
sparse birdsong is rumble a wood does not have.

## Processing

Identical for every file, in this order:

1. **Decode** the mp3 with ffmpeg to 44.1 kHz float PCM, applying any high-pass here rather than
   later — low-frequency wander is what makes a head and a tail sit at different offsets, and a
   filter run after the cross-fade would put its own transient at the join. ffmpeg honours the
   encoder delay and padding written into the stream, so the decode is gapless.
2. **Downmix to mono** for everything positional or underfoot. A panner collapses a stereo source
   anyway, so stereo there would be paying twice for nothing.
3. **Loop conditioning**, for the three loops only: cross-fade the last *L* seconds onto the first
   *L* with an equal-power pair (`√t` / `√(1−t)`, not a linear pair, which dips ~3 dB through the
   middle of the blend and pulses once a loop), then discard the tail. *L* is 0.6 s for the bed,
   0.5 s for the birds, 0.4 s for the shore. The result's last sample is the source's *n−L−1* and
   its first is the source's *n−L*: two samples that were adjacent in the original, so the wrap is
   an ordinary step rather than a join.
4. **Trim**, for one-shots only: strip lead-in and tail-out below −46 dBFS relative to peak,
   keeping 10 ms of pad.
5. **DC removal and peak normalisation** to −3 dBFS (−4 for the chime, −6 for the bird layer).
   A DC offset wastes headroom and thumps at a loop wrap.
6. **Encode** to Ogg Vorbis, `-q:a 1.0` for the stereo bed and `-q:a 0` for everything else.

## Why Ogg Vorbis

It is the one codec both of this project's targets decode. The native host's `decodeAudioFile`
sniffs the container and runs stb_vorbis on `OggS`; an Ogg carrying Opus is explicitly rejected
there, and every current browser reads Vorbis. Vorbis also stores an exact sample count in its
granule position, so a loop survives encoding at the sample — mp3's encoder padding is the usual
reason a "seamless" loop clicks once a bar, and there is no way to trim it at runtime because the
native host does not bind `loopStart`.

## Proof the loops are seamless

Measured on the shipped `.ogg` files, decoded back to PCM — not on the intermediates, because
Vorbis is lossy and could in principle move the first and last samples apart again.

| Loop | Length drift through the codec | Wrap step | 99th-pct step within 50 ms of the join | Ratio |
| --- | --- | --- | --- | --- |
| `forest-bed.ogg` | 0.000 ms | 0.016142 | 0.041870 | **0.39x** |
| `forest-birds.ogg` | 0.000 ms | 0.066752 | 0.298793 | **0.22x** |
| `lake-shore.ogg` | 0.000 ms | 0.000648 | 0.005415 | **0.12x** |

The claim is not that the wrap step is zero — no real signal's adjacent samples are equal. It is
that the wrap step is *ordinary where it happens*: every one of these joins is a fraction of the
largest ordinary step in its own neighbourhood.

**Judge a seam against its neighbourhood, at the file's own sample rate.** Two ways to get this
wrong, both of which produced a false alarm on `forest-birds.ogg` before the method was fixed:

- *Resampling.* A decode at 22.05 kHz reported this clip's wrap step as 0.1098 against 0.0346 for
  the bed — three times worse, and the wrong ranking. A resampler is an FIR filter whose window
  runs off the end of the data at the first and last output sample and is zero-padded, so those two
  samples are the only wrong ones in the file, and a seam test looks at exactly them.
- *A whole-clip reference.* A sparse clip is mostly quiet, so a percentile taken over its whole
  length flatters its join; a dense one is mostly loud, so the same percentile condemns a join
  nobody could hear.

Both rules are now enforced by `threenative-playtest audio`, which is where this measurement
lives permanently — `src/audio/tools/verify.py` is its ancestor, kept for the encode loop.

## Cost of holding them decoded

13.72 MiB of float PCM if every clip is resident at once, which it is — nothing in the engine
streams, and `AudioBus` deals only in fully decoded `AudioBuffer`s. That constraint, not taste, is
why the bed is 21 seconds rather than four minutes; it is written up in the engine repo's
`AUDIO-REQUESTS.md`. The two beds are deliberately co-prime-ish in length (21.4 s and 14.1 s) so
the pair does not return to the same alignment for just over five minutes.
