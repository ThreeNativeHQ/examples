#!/usr/bin/env node
// Generates the cathedral soundscape clips with the ElevenLabs sound-effects endpoint.
//
//   ELEVENLABS_API_KEY=... node tools/generate-soundscape.mjs [--only <id>] [--force]
//   node tools/generate-soundscape.mjs --reprocess      # no credits: re-run the DSP on cached PCM
//   node tools/generate-soundscape.mjs --list
//
// The key is read from the environment and is never written to a file, a log, or an argument.
//
// Two things about this endpoint cost real time to discover, so they are recorded here:
//
//  1. It returns **stereo interleaved 16-bit PCM at the requested rate**, with no header and a
//     bare `content-type: audio/pcm`. Wrapping it as mono plays every clip at half speed with an
//     L/R comb on top. Proven by asking for 3.0 s twice: `pcm_22050` returned 264600 bytes
//     (= 66150 stereo frames @ 22050) and `pcm_44100` returned 529200 (= 132300 @ 44100).
//  2. It returns very quiet audio — around -50 dBFS peak for these prompts, and asking for
//     "loud, close-miked, full volume" moved it less than 4 dB. Every clip therefore has to be
//     normalised here, and the noise floor that comes up with it is why the bed is low-passed
//     and the footsteps are trimmed to their audible part.
//
// Output is 16-bit mono RIFF/WAVE in `assets/`: the asset pipeline copies audio through
// untouched, and `--target android` decodes RIFF/WAVE only.
import { Buffer } from "node:buffer";
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ASSETS = join(ROOT, "assets");
const RAW = join(tmpdir(), "lumen-hall-soundscape-raw");
const ENDPOINT = "https://api.elevenlabs.io/v1/sound-generation";
const MODEL = "eleven_text_to_sound_v2";

/**
 * `rate` is what the endpoint is asked for; `outRate` is what ships. A deep muffled room tone
 * carries nothing above a few kHz, so the bed ships at a third of the footsteps' rate and a
 * third of the bytes. `peakDb` is the normalisation target, not a mastering preference: the bed
 * has to sit under the footsteps without either one being touched at the call site.
 */
const CLIPS = [
  {
    id: "cathedral-ambience",
    file: "cathedral-ambience.wav",
    rate: 22050,
    outRate: 8000,
    seconds: 20,
    loop: true,
    // Seconds 4-7 of the returned bed sit 20 dB below the rest, so the loop starts past them.
    loopBuild: { skip: 8.3, seconds: 10, fade: 1.5 },
    influence: 0.5,
    peakDb: -14,
    // Low-pass does double duty: it is the "distant and muffled" the brief asks for, and it
    // removes the hiss that normalising a -50 dBFS source drags up with the signal.
    lowpassHz: 3200,
    // `trim` is the one-shot decay cut; a loop's length is `loopBuild`'s business instead.
    trim: false,
    text:
      "Continuous deep room tone inside a vast empty stone cathedral. Very low distant air " +
      "rumble, faint muffled hush far away beyond thick stone, long slow reverberant decay. " +
      "No music, no voices, no bells, no footsteps, no wind gusts. Steady, featureless, " +
      "unchanging background atmosphere.",
  },
  {
    id: "candle-flicker",
    file: "candle-flicker.wav",
    rate: 22050,
    outRate: 12000,
    seconds: 8,
    loop: true,
    loopBuild: { skip: 0.4, seconds: 6, fade: 1.2 },
    influence: 0.5,
    peakDb: -20,
    lowpassHz: 5500,
    trim: false,
    text:
      "Quiet close-up rack of votive candles burning. Soft irregular wax flame flutter and " +
      "faint tiny crackles, intimate and low level. No fire roar, no wood fire, no music, " +
      "no voices.",
  },
  ...[1, 2, 3, 4, 5].map((n) => ({
    id: `footstep-${n}`,
    file: `footstep-${n}.wav`,
    rate: 22050,
    outRate: 22050,
    seconds: 1.4,
    loop: false,
    influence: 0.55,
    peakDb: -6,
    lowpassHz: 9500,
    trim: true,
    minSeconds: 0.45,
    maxSeconds: 1.0,
    // Each variation is worded differently on purpose: the same prompt five times returns five
    // near-identical samples, which is the machine-gun the variations exist to prevent.
    text: [
      "A single leather-soled shoe step on polished marble floor in a huge empty stone " +
        "cathedral. One sharp dry heel click, then a long reverberant tail decaying into the " +
        "distant vault. One step only, no music, no voices.",
      "One footstep, hard leather sole landing flat on smooth polished stone in an enormous " +
        "echoing cathedral nave. Dry slap of the sole, faint grit, long cavernous echo tail. " +
        "A single step, nothing else.",
      // The first wording of this one returned a dry 0.15 s click with no room on it at all.
      // Leading with the reverberation rather than the impact is what got the hall back.
      "Enormous cathedral reverberation triggered by one heel strike on cold marble. The echo " +
        "swells and rolls around the empty stone hall for several seconds after the single " +
        "sharp impact. Long wet decay, cavernous. One step, no music, no voices.",
      "One quiet leather shoe step on a polished cathedral floor, softer and flatter than a " +
        "heel click, with a long resonant echo rolling off into a giant stone hall. Single " +
        "footfall only.",
      "A single deliberate footstep on hard stone in a colossal empty cathedral. Sharp dry " +
        "contact, faint dust scrape, and an enormous decaying reverberation. One step, no " +
        "voices, no music.",
    ][n - 1],
  })),
];

const FULL_SCALE = 32768;
const db = (ratio) => 20 * Math.log10(Math.max(ratio, 1e-9));

/**
 * Peak, noise floor, and the frame the *decay* stops at.
 *
 * The end of a footstep cannot be found by measuring down from the peak: these sources run from
 * -6 to -50 dBFS, so any fixed window below the peak lands in a different place on each one. It
 * cut a 1.4 s clip to 0.15 s on the loud take and left 0.7 s of amplified dither on the quiet
 * ones, because a source at -49 dBFS has its own floor only 25 dB below its peak.
 *
 * So the floor is measured instead — the 15th percentile of the block envelope, which for these
 * clips is the flat dither plateau after the tail has died — and the tail is declared over when
 * the envelope reaches 8 dB above it. That is the point past which normalising only amplifies
 * hiss, whatever the take's level happened to be.
 */
function analyse(pcm, rate) {
  const samples = new Int16Array(pcm.buffer, pcm.byteOffset, pcm.length / 2);
  const frames = samples.length / 2;
  let peak = 0;
  for (const sample of samples) {
    const magnitude = Math.abs(sample);
    if (magnitude > peak) peak = magnitude;
  }
  const block = Math.max(1, Math.round(rate * 0.02));
  const envelope = [];
  for (let start = 0; start < frames; start += block) {
    let localPeak = 0;
    for (let frame = start; frame < Math.min(start + block, frames); frame += 1) {
      localPeak = Math.max(localPeak, Math.abs(samples[frame * 2]), Math.abs(samples[frame * 2 + 1]));
    }
    envelope.push(localPeak);
  }
  const sorted = [...envelope].sort((a, b) => a - b);
  const noise = Math.max(sorted[Math.floor(sorted.length * 0.15)], 1);
  const threshold = noise * 10 ** (8 / 20);
  // Follow the decay forward from the impact and stop where it reaches the floor, rather than
  // taking the last block above it anywhere in the clip. Several takes end with a stray blip at
  // the generation boundary, 12 dB clear of the floor, and a backward scan hands back the whole
  // buffer because of it — which is how two footsteps kept 0.4 s of amplified hiss.
  let peakBlock = 0;
  for (let index = 0; index < envelope.length; index += 1) {
    if (envelope[index] > envelope[peakBlock]) peakBlock = index;
  }
  const hold = 3; // consecutive quiet blocks, so a momentary dip in the tail is not the end of it
  let lastBlock = envelope.length - 1;
  let quiet = 0;
  for (let index = peakBlock; index < envelope.length; index += 1) {
    quiet = envelope[index] < threshold ? quiet + 1 : 0;
    if (quiet >= hold) {
      lastBlock = index - hold;
      break;
    }
  }
  return {
    peak,
    peakDb: db(peak / FULL_SCALE),
    noiseDb: db(noise / FULL_SCALE),
    snrDb: db(peak / noise),
    frames,
    seconds: frames / rate,
    tailSeconds: ((lastBlock + 1) * block) / rate,
  };
}

/**
 * Samples of a 16-bit mono WAV, found by walking the RIFF chunks.
 *
 * Not by skipping 44 bytes: ffmpeg writes a `LIST`/`INFO` chunk before `data`, so a fixed 44
 * lands inside the header and reads it — misaligned by a byte — as audio. That is what made the
 * seam check call two perfectly ordinary loops a 100x and a 440x discontinuity.
 */
function readWavMono(wavPath) {
  const file = readFileSync(wavPath);
  let offset = 12; // past "RIFF" <size> "WAVE"
  while (offset + 8 <= file.length) {
    const id = file.toString("ascii", offset, offset + 4);
    const size = file.readUInt32LE(offset + 4);
    if (id === "data") {
      const start = offset + 8;
      const count = Math.min(size, file.length - start) >> 1;
      const samples = new Int16Array(count);
      for (let index = 0; index < count; index += 1) samples[index] = file.readInt16LE(start + index * 2);
      return samples;
    }
    offset += 8 + size + (size % 2);
  }
  throw new Error(`${wavPath}: no data chunk`);
}

/**
 * How audible the wrap point is.
 *
 * The sample-to-sample step across the seam is only meaningful next to the steps the clip takes
 * everywhere else — noise-like material moves a long way between adjacent samples by nature, so
 * comparing the seam step to the peak calls every room tone a click. `jumpRatio` is the seam step
 * over the 99th-percentile step inside the clip: at or below 1 the wrap is indistinguishable from
 * ordinary material. `headDb`/`tailDb` catch the other failure, a bed that ramps or fades and so
 * mismatches its own level across the join however smooth the single step is.
 */
function seam(wavPath) {
  const samples = readWavMono(wavPath);
  const steps = [];
  for (let index = 1; index < samples.length; index += 1) {
    steps.push(Math.abs(samples[index] - samples[index - 1]));
  }
  steps.sort((a, b) => a - b);
  const typical = Math.max(steps[Math.floor(steps.length * 0.99)], 1);
  const jump = Math.abs(samples[0] - samples[samples.length - 1]);
  const window = Math.min(Math.round(samples.length / 8), 4000);
  const rms = (from) => {
    let sum = 0;
    for (let index = 0; index < window; index += 1) sum += samples[from + index] ** 2;
    return Math.sqrt(sum / window);
  };
  const head = rms(0);
  const tail = rms(samples.length - window);
  return { jumpRatio: jump / typical, levelDb: db(head / Math.max(tail, 1)) };
}

/**
 * Cut a seamless loop out of the raw stereo PCM with an equal-power crossfade.
 *
 * `loop: true` on the endpoint did not produce a usable one. The bed it returned ramps out of a
 * 20 dB hole in its first third, so it swells once per pass and does exactly the drawing of
 * attention to itself an ambient bed exists not to do. `skip` steps past that, and the crossfade
 * builds the wrap here instead: the last `fade` seconds are mixed back over the first `fade`
 * seconds, so the last sample of the loop is the source sample immediately before the first, and
 * the join is continuous by construction rather than by luck.
 */
function buildLoop(pcm, rate, { skip, seconds, fade }) {
  const samples = new Int16Array(pcm.buffer, pcm.byteOffset, pcm.length / 2);
  const start = Math.round(skip * rate);
  const length = Math.round(seconds * rate);
  const overlap = Math.round(fade * rate);
  const available = samples.length - start;
  if (available < length + overlap) {
    const needed = ((length + overlap) / rate).toFixed(1);
    throw new Error(`loop needs ${needed}s after ${skip}s, source has ${(available / rate).toFixed(1)}s`);
  }
  const out = new Int16Array(length);
  out.set(samples.subarray(start, start + length));
  for (let index = 0; index < overlap; index += 1) {
    const progress = index / overlap;
    const rising = Math.sin((progress * Math.PI) / 2);
    const falling = Math.cos((progress * Math.PI) / 2);
    out[index] = Math.round(samples[start + index] * rising + samples[start + length + index] * falling);
  }
  return Buffer.from(out.buffer, out.byteOffset, out.byteLength);
}

async function fetchClip(clip, key) {
  const response = await fetch(`${ENDPOINT}?output_format=pcm_${clip.rate}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "xi-api-key": key },
    body: JSON.stringify({
      text: clip.text,
      model_id: MODEL,
      duration_seconds: clip.seconds,
      prompt_influence: clip.influence,
      loop: clip.loop,
    }),
  });
  if (!response.ok) {
    // The body carries the reason (quota, validation). The key only ever rode in the header.
    throw new Error(`HTTP ${response.status} ${await response.text()}`);
  }
  const pcm = Buffer.from(await response.arrayBuffer());
  if (pcm.length < 4) throw new Error(`body was ${pcm.length} bytes`);
  return pcm;
}

/** Normalise, trim, low-pass, downmix and resample the raw stereo PCM into a mono WAV. */
function render(clip, rawPath, stats) {
  const filters = [`volume=${(clip.peakDb - stats.peakDb).toFixed(2)}dB`];
  if (clip.trim) {
    // Trim to the decay plus a 90 ms fade, so the cut is never a click and the room's tail still
    // reads as a tail. The bounds are a quality gate as much as a byte budget: a footstep in a
    // cathedral that measures under `minSeconds` has no reverb on it and is a bad take, not a
    // tight one, and `maxSeconds` stops a noisy source from shipping its whole dither plateau.
    const fade = 0.09;
    const end = Math.min(stats.seconds, clip.maxSeconds, Math.max(clip.minSeconds, stats.tailSeconds + fade));
    filters.unshift(`atrim=0:${end.toFixed(3)}`, `afade=t=out:st=${(end - fade).toFixed(3)}:d=${fade}`);
  }
  filters.push(`lowpass=f=${clip.lowpassHz}`);
  const target = join(ASSETS, clip.file);
  const ffmpeg = (input, inRate, channels, filter, output) =>
    execFileSync(
      "ffmpeg",
      ["-hide_banner", "-loglevel", "error", "-f", "s16le", "-ar", String(inRate), "-ac",
        String(channels), "-i", input, ...(filter === undefined ? [] : ["-af", filter]),
        "-ac", "1", "-ar", String(clip.outRate), "-c:a", "pcm_s16le",
        ...(output.endsWith(".pcm") ? ["-f", "s16le"] : []), "-y", output],
      { stdio: ["ignore", "ignore", "inherit"] },
    );

  /**
   * Bring the finished file to `peakDb` exactly.
   *
   * The first gain is computed from the raw source, but the low-pass takes energy out after it
   * and a loop is cut from a window that need not contain the source's peak — so the candle bed
   * came out 6 dB under its target. That matters because the balance between bed, candles and
   * footsteps is set entirely by these numbers, and a call site correcting for it by ear would
   * be compensating for a bug.
   */
  const trueUp = () => {
    const samples = readWavMono(target);
    let peak = 0;
    for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
    const correction = clip.peakDb - db(peak / FULL_SCALE);
    if (Math.abs(correction) < 0.5) return;
    const staged = join(RAW, `${clip.id}.trued.wav`);
    execFileSync(
      "ffmpeg",
      ["-hide_banner", "-loglevel", "error", "-i", target, "-af",
        `volume=${correction.toFixed(2)}dB`, "-c:a", "pcm_s16le", "-y", staged],
      { stdio: ["ignore", "ignore", "inherit"] },
    );
    copyFileSync(staged, target);
  };

  if (clip.loopBuild === undefined) {
    ffmpeg(rawPath, clip.rate, 2, filters.join(","), target);
    trueUp();
    return target;
  }
  // Filter first, cut the loop last. `lowpass` is a biquad starting from zero state, so it damps
  // the opening milliseconds — run it after the crossfade and it puts a dent in the one sample
  // boundary the whole loop depends on. This way the filter's startup transient lands in the
  // intro that `skip` throws away.
  const filtered = join(RAW, `${clip.id}.filtered.pcm`);
  ffmpeg(rawPath, clip.rate, 2, filters.join(","), filtered);
  const looped = join(RAW, `${clip.id}.loop.pcm`);
  writeFileSync(looped, buildLoop(readFileSync(filtered), clip.outRate, clip.loopBuild));
  ffmpeg(looped, clip.outRate, 1, undefined, target);
  trueUp();
  return target;
}

const args = parseArgs();
function parseArgs() {
  const list = process.argv.slice(2);
  return {
    only: list.includes("--only") ? list[list.indexOf("--only") + 1] : undefined,
    force: list.includes("--force"),
    reprocess: list.includes("--reprocess"),
    list: list.includes("--list"),
  };
}

if (args.list) {
  for (const clip of CLIPS) console.log(`${clip.id}\t${clip.seconds}s\t${clip.rate}->${clip.outRate}Hz`);
  process.exit(0);
}

const key = process.env.ELEVENLABS_API_KEY;
if (!args.reprocess && (key === undefined || key === "")) {
  console.error("ELEVENLABS_API_KEY is not set in the environment.");
  process.exit(1);
}

mkdirSync(ASSETS, { recursive: true });
mkdirSync(RAW, { recursive: true });
let failed = false;
let total = 0;

for (const clip of CLIPS) {
  if (args.only !== undefined && clip.id !== args.only) continue;
  const rawPath = join(RAW, `${clip.id}.pcm`);
  try {
    if (!existsSync(rawPath) || (args.force && !args.reprocess)) {
      if (args.reprocess) {
        console.log(`skip   ${clip.id}: no cached PCM at ${rawPath}`);
        continue;
      }
      writeFileSync(rawPath, await fetchClip(clip, key));
    }
    const raw = readFileSync(rawPath);
    const stats = analyse(raw, clip.rate);
    const target = render(clip, rawPath, stats);
    const bytes = statSync(target).size;
    total += bytes;
    const seconds = ((bytes - 44) / 2 / clip.outRate).toFixed(2);
    let note = `  src ${stats.seconds.toFixed(2)}s ${stats.peakDb.toFixed(1)}dBFS snr ${stats.snrDb.toFixed(0)}dB`;
    if (clip.loop) {
      const measured = seam(target);
      const seamless = measured.jumpRatio <= 1.5 && Math.abs(measured.levelDb) <= 3;
      note += `  seam x${measured.jumpRatio.toFixed(2)} lvl ${measured.levelDb.toFixed(1)}dB ${seamless ? "OK" : "SUSPECT"}`;
      if (!seamless) failed = true;
    }
    console.log(
      `wrote  ${clip.file.padEnd(24)} ${String(bytes).padStart(7)} B  ${seconds}s @ ${clip.outRate}Hz mono${note}`,
    );
  } catch (error) {
    failed = true;
    console.error(`FAILED ${clip.id}: ${error instanceof Error ? error.message : error}`);
  }
}
console.log(`total  ${total} bytes`);
process.exit(failed ? 1 : 0);
