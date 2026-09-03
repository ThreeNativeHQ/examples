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

Nineteen clips, **509,854 bytes (497.9 KiB)** shipped, against a stated budget of 512 KiB.

| File | Bytes | Length | Ch | Kind |
| --- | --- | --- | --- | --- |
| `forest-bed.ogg` | 220,693 | 21.40 s | 2 | loop |
| `forest-birds.ogg` | 93,469 | 14.10 s | 1 | loop |
| `lake-shore.ogg` | 76,719 | 11.60 s | 1 | loop, positional |
| `landmark-found.ogg` | 20,788 | 3.00 s | 2 | one-shot |
| `step-{grass,leaf,rock,dirt,water}-{1,2,3}.ogg` | 6,013–6,994 each, 98,185 total | 0.38–0.49 s | 1 | one-shot |

Prompts, verbatim, are in the generation script kept with this change; the four that shape the
wood are: a late-morning temperate pine ambience of wind in high conifer branches with distant
songbirds and slow trunk creak; a thin detail layer of sparse birds and one creak with long gaps; a
quiet freshwater shoreline of ripples on wet pebbles and reeds; and a single warm struck-wood
discovery chime with a short airy tail.

## Processing

Identical for every file, in this order:

1. **Decode** the mp3 with ffmpeg to 44.1 kHz float PCM. ffmpeg honours the encoder delay and
   padding written into the stream, so the decode is gapless.
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
5. **DC removal and peak normalisation** to −3 dBFS (−1.5 for the chime, −6 for the bird layer).
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

| Loop | Length drift through the codec | Wrap step | Percentile of that clip's own sample-to-sample steps |
| --- | --- | --- | --- |
| `forest-bed.ogg` | 0.000 ms | 0.016142 | 50.3 % |
| `forest-birds.ogg` | 0.000 ms | 0.021019 | 23.7 % |
| `lake-shore.ogg` | 0.000 ms | 0.000648 | 32.2 % |

The claim is not that the wrap step is zero — no real signal's adjacent samples are equal. It is
that the wrap step is *ordinary*: half of the steps inside `forest-bed.ogg` are larger than the one
at its loop point. A discontinuity a listener could pick out would sit at the 100th percentile,
where `landmark-found.ogg` sits, which is exactly why that one is a one-shot and not a loop.

## Cost of holding them decoded

13.72 MiB of float PCM if every clip is resident at once, which it is — nothing in the engine
streams, and `AudioBus` deals only in fully decoded `AudioBuffer`s. That constraint, not taste, is
why the bed is 21 seconds rather than four minutes; it is written up in the engine repo's
`AUDIO-REQUESTS.md`. The two beds are deliberately co-prime-ish in length (21.4 s and 14.1 s) so
the pair does not return to the same alignment for just over five minutes.
