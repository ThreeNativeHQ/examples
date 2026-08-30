// Proof that the soundscape actually sounds, measured off the audio graph rather than inferred
// from the fact that some objects were constructed.
//
// A module that loads its clips, builds its voices and reports healthy counters while emitting
// no signal at all is the normal way this fails, and every counter-based check passes on it. So
// this taps an `AnalyserNode` onto the listener's input — where every `AudioBus` voice, flat or
// positional, is summed — and reads the real samples in three phases: silence, bed only, then
// bed, bed plus the positional candle layer, then all of it plus a walk. Each phase has to be
// measurably louder than the one before it.
//
// Driven by `tools/soundscape-proof.mjs`, which serves this page and reads the result.
import { AudioBus, createAssetLoader } from "@threenative/core";
import { Object3D, Vector3 } from "three";
import { loadSoundscape } from "../src/audio/soundscape.js";

interface IPhase {
  readonly name: string;
  readonly rms: number;
  readonly peak: number;
}

interface IProof {
  ok: boolean;
  failures: string[];
  buffers: { name: string; seconds: number; rate: number; peak: number }[];
  phases: IPhase[];
  steps: number;
  contextState: string;
  debug: Record<string, unknown>;
}

const TICK = 1 / 60;
const WALK_SPEED = 3.4;

const wait = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/** Peak absolute sample across every channel of a decoded buffer. */
function bufferPeak(buffer: AudioBuffer): number {
  let peak = 0;
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const data = buffer.getChannelData(channel);
    for (const sample of data) {
      const magnitude = Math.abs(sample);
      if (magnitude > peak) peak = magnitude;
    }
  }
  return peak;
}

async function run(): Promise<IProof> {
  const failures: string[] = [];
  const camera = new Object3D();
  const bus = new AudioBus({ camera });
  const assets = createAssetLoader({ basePath: "/" });
  const soundscape = loadSoundscape({ bus, assets, seed: 7 });

  // The real unlock path: `AudioBus` listens for pointerdown/keydown itself, and the runner
  // clicks the page. This only forces the issue if the click landed before the bus existed.
  await bus.unlock();

  const context = bus.listener.context;
  const analyser = context.createAnalyser();
  analyser.fftSize = 2048;
  // Tap, do not reroute: `getInput()` stays connected to the destination as well, so this
  // measures the graph as it actually plays rather than a copy built for the test.
  bus.listener.getInput().connect(analyser);
  const frame = new Float32Array(analyser.fftSize);

  async function measure(name: string, seconds: number): Promise<IPhase> {
    let peak = 0;
    let sumSquares = 0;
    let samples = 0;
    const until = performance.now() + seconds * 1000;
    while (performance.now() < until) {
      analyser.getFloatTimeDomainData(frame);
      for (const sample of frame) {
        const magnitude = Math.abs(sample);
        if (magnitude > peak) peak = magnitude;
        sumSquares += sample * sample;
        samples += 1;
      }
      await wait(20);
    }
    return { name, peak, rms: Math.sqrt(sumSquares / Math.max(samples, 1)) };
  }

  await soundscape.ready;

  // Every shipped clip, decoded and measured. This is the "a silent 0-byte clip loaded fine"
  // gate, run against the bytes the browser actually fetched through the asset manifest.
  const buffers: IProof["buffers"] = [];
  for (const name of [
    "cathedral-ambience.wav",
    "candle-flicker.wav",
    "footstep-1.wav",
    "footstep-2.wav",
    "footstep-3.wav",
    "footstep-4.wav",
    "footstep-5.wav",
  ]) {
    const buffer = await assets.audio(name);
    const peak = bufferPeak(buffer);
    buffers.push({ name, seconds: buffer.duration, rate: buffer.sampleRate, peak });
    // -34 dBFS. Well under the quietest clip's own target (-20), so this catches a broken or
    // empty decode rather than re-litigating the mix.
    if (peak < 0.02) failures.push(`${name} decoded near-silent (peak ${peak.toFixed(4)})`);
    if (buffer.duration < 0.2) failures.push(`${name} decoded at ${buffer.duration.toFixed(3)}s`);
  }

  const phases: IPhase[] = [];
  phases.push(await measure("silence", 0.6));

  soundscape.startAmbience();
  // Past the 2.5 s fade the bed is at its stated level; measuring inside the fade reads low.
  await wait(3000);
  phases.push(await measure("ambience", 1.2));

  // The positional path is a different `AudioBus` call (`playAt`, a panner-backed voice) and
  // fails differently — a runtime with no `createPanner`, or a source the panner never places.
  // One rack a metre in front of the listener, inside its own refDistance.
  soundscape.startCandles([new Vector3(0, 0, -1)]);
  await wait(2500);
  phases.push(await measure("ambience+candles", 1.2));

  // Walk due north at the game's own walk speed and let the odometer decide the cadence.
  let z = 0;
  const before = soundscape.debug().steps;
  const walking = performance.now() + 2600;
  while (performance.now() < walking) {
    for (let tick = 0; tick < 6; tick += 1) {
      z -= WALK_SPEED * TICK;
      soundscape.travel(TICK, { x: 0, z });
    }
    await wait(100);
  }
  phases.push(await measure("ambience+candles+walking", 1.2));
  const steps = soundscape.debug().steps - before;

  const silence = phases[0] as IPhase;
  const ambience = phases[1] as IPhase;
  const candles = phases[2] as IPhase;
  const walkingPhase = phases[3] as IPhase;

  if (context.state !== "running") failures.push(`audio context is ${context.state}, not running`);
  if (ambience.rms <= silence.rms * 4 || ambience.rms < 1e-4) {
    failures.push(`ambience did not sound: rms ${ambience.rms.toExponential(2)} vs silence ${silence.rms.toExponential(2)}`);
  }
  if (soundscape.debug().candles !== 1) failures.push("the candle layer did not start");
  if (candles.rms <= ambience.rms) {
    failures.push(`candles added nothing: rms ${candles.rms.toExponential(2)} vs bed ${ambience.rms.toExponential(2)}`);
  }
  if (steps < 3) failures.push(`walking fired ${steps} footsteps`);
  if (walkingPhase.peak <= candles.peak * 1.5) {
    failures.push(`footsteps are not audible over the bed: peak ${walkingPhase.peak.toFixed(4)} vs ${candles.peak.toFixed(4)}`);
  }

  const proof: IProof = {
    ok: failures.length === 0,
    failures,
    buffers,
    phases,
    steps,
    contextState: context.state,
    debug: soundscape.debug(),
  };
  soundscape.dispose();
  bus.dispose();
  return proof;
}

const status = document.querySelector("#status") as HTMLElement;
run()
  .then((proof) => {
    status.textContent = proof.ok ? "PASS" : "FAIL";
    console.info(`TN_SOUNDSCAPE_PROOF:${JSON.stringify(proof)}`);
    (globalThis as unknown as { __SOUNDSCAPE_PROOF__?: IProof }).__SOUNDSCAPE_PROOF__ = proof;
  })
  .catch((error: unknown) => {
    status.textContent = "ERROR";
    const message = error instanceof Error ? `${error.message}\n${error.stack ?? ""}` : String(error);
    console.error(`TN_SOUNDSCAPE_PROOF_ERROR:${message}`);
    (globalThis as unknown as { __SOUNDSCAPE_PROOF__?: IProof }).__SOUNDSCAPE_PROOF__ = {
      ok: false,
      failures: [message],
      buffers: [],
      phases: [],
      steps: 0,
      contextState: "unknown",
      debug: {},
    };
  });
