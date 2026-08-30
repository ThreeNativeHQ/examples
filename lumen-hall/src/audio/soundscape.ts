// The cathedral's sound: one ambient bed, five footstep variations, and an optional candle
// layer. Ordinary code in this project — ThreeNative does not read this file.
//
// Everything sounding here goes through the framework's `AudioBus`, which the scene already
// owns: it holds the one `AudioListener` the camera may carry, queues cues until the browser's
// first user gesture unlocks the context, pools and steals voices, and gives per-cue `detune`
// applied before the first sample rather than through three's ramping `setDetune`. This module
// deliberately takes that bus rather than building one, because a second bus would put a second
// listener on the same camera.
//
// The one thing the bus does not own is *when* a footstep happens, which is what `travel` is:
// a stride odometer over the walker's own position, so the cadence follows the player's real
// speed and a stationary player is silent, with no coupling to the movement code at all.
import { createRandom, type IAssetLoader, type IRandom } from "@threenative/core";
import type { AudioBus } from "@threenative/core";
import type { Audio, Object3D, PositionalAudio, Vector3 } from "three";

/** The clips this module loads, by their logical names in `assets/`. */
const AMBIENCE = "cathedral-ambience.wav";
const CANDLES = "candle-flicker.wav";
const FOOTSTEPS = ["footstep-1.wav", "footstep-2.wav", "footstep-3.wav", "footstep-4.wav", "footstep-5.wav"];

/**
 * Metres of stride per footfall, as a function of speed.
 *
 * A fixed stride is what makes a sprinting character machine-gun: this game walks at 3.4 m/s
 * and sprints at 7.5, so one constant would either be four steps a second at a sprint or two
 * steps a second while walking. A stride that opens up with speed keeps the cadence between
 * roughly 2.5 and 4.5 footfalls a second across the whole range, which is what a person does.
 */
const STRIDE_BASE = 0.9;
const STRIDE_PER_SPEED = 0.11;
const STRIDE_MAX = 2;
/** Fraction of a stride the odometer starts loaded with, so the first step lands promptly. */
const FIRST_STEP_LEAD = 0.65;
/**
 * Metres in one fixed step past which this is a teleport, not a walk. The vantage hooks and
 * respawn jump the camera across the nave; without this the odometer cashes that distance in as
 * a burst of twenty footsteps.
 */
const TELEPORT_METRES = 2;
/** Speed below which nobody is walking, so drift and solver jitter stay silent. */
const IDLE_SPEED = 0.35;

/** Cents of pitch spread per footfall. Stops five samples comb-filtering into a metallic buzz. */
const DETUNE_CENTS = 55;
/** Volume jitter per footfall, either side of 1. */
const LEVEL_JITTER = 0.18;
/** Speed that counts as a full-volume footfall; below it steps get proportionally softer. */
const LOUD_SPEED = 7;

export interface ISoundscapeOptions {
  /**
   * The scene's existing bus. Not created here on purpose — `AudioBus` parents an
   * `AudioListener` to the camera, and a camera with two listeners is a bug that presents as
   * doubled, phasing audio rather than as an error.
   */
  readonly bus: AudioBus;
  /** Normally `ctx.assets`, so the clips resolve through the compiled asset manifest. */
  readonly assets: IAssetLoader;
  /** Seeded so a playtest replays the same footstep order. Defaults to a fixed seed. */
  readonly seed?: number;
  readonly ambienceVolume?: number;
  readonly footstepVolume?: number;
  readonly candleVolume?: number;
}

export interface ISoundscape {
  /** Resolves once every clip has loaded, or rejects with the first failure. */
  readonly ready: Promise<void>;
  /** Start the looping room tone. Safe to call before the clips have loaded, or twice. */
  startAmbience(): void;
  /** Loop the flame layer at each source, welded to it when it is an `Object3D`. Optional. */
  startCandles(sources: readonly (Object3D | Vector3)[]): void;
  /** One footfall now. `speed` in m/s only sets how hard it lands; omit it for a plain step. */
  footstep(speed?: number): void;
  /** Call once per fixed step with the walker's position; fires footsteps as ground is covered. */
  travel(dt: number, position: { x: number; z: number }): void;
  /** Registry hook: what the dev overlay, `window.__THREENATIVE__` and assertions read. */
  debug(): {
    loaded: boolean;
    ambience: boolean;
    candles: number;
    steps: number;
    metres: number;
    voices: number;
    queued: number;
  };
  dispose(): void;
}

/** Draw from a shuffled bag so no variation repeats back to back and all five get used. */
function createBag(size: number, random: IRandom): () => number {
  let bag: number[] = [];
  let previous = -1;
  return () => {
    if (bag.length === 0) {
      const shuffled = [...Array(size).keys()];
      for (let index = shuffled.length - 1; index > 0; index -= 1) {
        const swap = Math.floor(random() * (index + 1));
        const held = shuffled[index] ?? 0;
        shuffled[index] = shuffled[swap] ?? 0;
        shuffled[swap] = held;
      }
      // A fresh bag whose first draw repeats the last of the old one is the one case a bag
      // still machine-guns. Push that draw back by one.
      if (shuffled.length > 1 && shuffled[0] === previous) {
        const held = shuffled[0] ?? 0;
        shuffled[0] = shuffled[1] ?? 0;
        shuffled[1] = held;
      }
      bag = shuffled;
    }
    previous = bag.shift() ?? 0;
    return previous;
  };
}

export function loadSoundscape(options: ISoundscapeOptions): ISoundscape {
  const { bus, assets } = options;
  const ambienceVolume = options.ambienceVolume ?? 0.5;
  const footstepVolume = options.footstepVolume ?? 0.8;
  const candleVolume = options.candleVolume ?? 0.6;
  const random = createRandom(options.seed ?? 20260830);
  const draw = createBag(FOOTSTEPS.length, random);

  let ambienceBuffer: AudioBuffer | undefined;
  let candleBuffer: AudioBuffer | undefined;
  let footstepBuffers: AudioBuffer[] = [];
  let loaded = false;
  let disposed = false;

  // What was asked for before the clips arrived. A scene calls `startAmbience()` in `enter()`,
  // which is always before the decode finishes, so the request has to outlive the load.
  let wantAmbience = false;
  let wantCandles: readonly (Object3D | Vector3)[] = [];
  let ambienceVoice: Audio | undefined;
  const candleVoices: PositionalAudio[] = [];

  let previous: { x: number; z: number } | undefined;
  let odometer = 0;
  let stride = STRIDE_BASE;
  let steps = 0;
  let metres = 0;

  const nextStride = (speed: number): number =>
    Math.min(STRIDE_BASE + STRIDE_PER_SPEED * speed, STRIDE_MAX) * (1 + (random() - 0.5) * 0.16);

  const soundscape: ISoundscape = {
    ready: Promise.all([
      assets.audio(AMBIENCE),
      assets.audio(CANDLES),
      ...FOOTSTEPS.map((name) => assets.audio(name)),
    ]).then(([ambience, candles, ...footsteps]) => {
      ambienceBuffer = ambience;
      candleBuffer = candles;
      footstepBuffers = footsteps;
      loaded = true;
      if (disposed) return;
      // Replay whatever was asked for while the decode was still in flight.
      if (wantAmbience) soundscape.startAmbience();
      if (wantCandles.length > 0) soundscape.startCandles(wantCandles);
    }),

    startAmbience() {
      wantAmbience = true;
      if (disposed || ambienceBuffer === undefined || ambienceVoice !== undefined) return;
      // `music` loops by default. The fade is so the bed arrives rather than cuts in on the
      // frame the context unlocks, which is a click on an otherwise silent scene.
      ambienceVoice = bus.music(ambienceBuffer, { volume: ambienceVolume, fade: 2.5 });
    },

    startCandles(sources) {
      wantCandles = sources;
      if (disposed || candleBuffer === undefined || candleVoices.length > 0) return;
      for (const source of sources) {
        candleVoices.push(
          bus.playAt(candleBuffer, source, {
            loop: true,
            volume: candleVolume,
            fade: 2,
            // Three's 1 m panner default would make a candle rack inaudible from two steps
            // away; a rack reads from across a bay and dies off over the next one.
            refDistance: 2.5,
            rolloffFactor: 1.6,
          }),
        );
      }
    },

    footstep(speed = 0) {
      if (disposed || footstepBuffers.length === 0) return;
      const buffer = footstepBuffers[draw()];
      if (buffer === undefined) return;
      const weight = Math.min(1, 0.55 + (0.45 * speed) / LOUD_SPEED);
      const jitter = 1 + (random() - 0.5) * 2 * LEVEL_JITTER;
      bus.play(buffer, {
        volume: Math.max(0, footstepVolume * weight * jitter),
        detune: (random() - 0.5) * 2 * DETUNE_CENTS,
      });
      steps += 1;
    },

    travel(dt, position) {
      if (disposed || dt <= 0) return;
      const last = previous;
      previous = { x: position.x, z: position.z };
      if (last === undefined) {
        odometer = stride * FIRST_STEP_LEAD;
        return;
      }
      // Horizontal only: the stairs to the chancel should not spend stride on their rise, and
      // the solver's vertical settle should not spend any at all.
      const distance = Math.hypot(position.x - last.x, position.z - last.z);
      if (distance > TELEPORT_METRES) {
        odometer = stride * FIRST_STEP_LEAD;
        return;
      }
      const speed = distance / dt;
      if (speed < IDLE_SPEED) return;
      metres += distance;
      odometer += distance;
      // `while`, not `if`: a long fixed step at a sprint can cover more than one stride, and an
      // `if` would quietly drop the extra footfalls and drift the cadence slow.
      while (odometer >= stride) {
        odometer -= stride;
        stride = nextStride(speed);
        soundscape.footstep(speed);
      }
    },

    debug() {
      return {
        loaded,
        ambience: ambienceVoice !== undefined,
        candles: candleVoices.length,
        steps,
        metres: Math.round(metres * 100) / 100,
        voices: bus.voices,
        queued: bus.queued,
      };
    },

    dispose() {
      disposed = true;
      wantAmbience = false;
      wantCandles = [];
      // Only this module's own looping voices are stopped. `bus.stop()` would take the scene's
      // one-shots down with them, and the bus is not ours to clear.
      //
      // Guarded on `isPlaying` because the bus is usually registered before this module and so
      // is disposed first: by the time a scene exit reaches here the voices may already have
      // been retired and handed back, and the bus's own contract is to read `isPlaying` before
      // touching a voice you kept a reference to.
      if (ambienceVoice?.isPlaying === true) ambienceVoice.stop();
      ambienceVoice = undefined;
      for (const voice of candleVoices) if (voice.isPlaying) voice.stop();
      candleVoices.length = 0;
    },
  };

  // `ready` stays rejectable so a caller that wants to know can await it, but nothing is
  // required to. Without this, a scene that only calls `startAmbience()` turns a missing clip
  // into an unhandled rejection — which surfaces as a console error and fails an otherwise
  // unrelated `diagnostics.noConsoleErrors` assertion somewhere else entirely.
  void soundscape.ready.catch(() => undefined);

  return soundscape;
}
