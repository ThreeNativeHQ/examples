/**
 * Midway's audio direction, on the engine's portable `AudioBus`.
 *
 * This file owns only the game's choices: which cue, how loud, which perspective and which state
 * triggers it. Voice recycling, the concurrency ceiling, positional panning, distance rolloff,
 * detune and tail cut-off belong to `AudioBus`, and every buffer arrives through `ctx.assets.audio`,
 * so the native build plays exactly what the web does. There is no `window.AudioContext` here.
 *
 * The engine bank is cross-faded between a dry exterior recording and a pilot-seat interior one so
 * switching the camera changes the balance rather than swapping one drone for another. Continuous
 * layers are held and their gains are driven every frame; one-shots go through the bus and are
 * capped by its voice ceiling.
 *
 * Asset provenance, exact generation prompts and hashes live in `content/audio/midway-audio.json`.
 * A cue whose file is missing stays silent, preserves its caption and reports once.
 *
 * `IAudioTarget` is the bus surface this file uses. It is declared structurally — rather than
 * imported — so the game logic is testable in Node under a fake bus and the real `AudioBus` is
 * supplied by the scene. Speech lives in `./speech.js`, which owns the finite script table and the
 * bounded queue; this file only routes `speech` events to it and ducks effects underneath.
 */
import { SpeechQueue, speechSlugList, type ISpeechBus, type ISpeechRequest } from "./speech.js";

type Buffers = ReadonlyMap<string, AudioBuffer>;
type Assets = { audio(path: string): Promise<AudioBuffer> };

interface IVoice {
  gain: { gain: AudioParam };
  source?: unknown;
}

/** The subset of `AudioBus` this game uses. `AudioBus` satisfies it structurally. */
export interface IAudioTarget {
  listener: { context: { currentTime: number } };
  setVolume(volume: number, fade?: number): void;
  play(buffer: AudioBuffer, options?: Record<string, unknown>): IVoice;
  playAt(buffer: AudioBuffer, source: unknown, options?: Record<string, unknown>): IVoice;
  music(buffer: AudioBuffer, options?: Record<string, unknown>): IVoice;
  unlock(): Promise<void>;
  dispose(): void;
}

/**
 * Semantic cue name to packaged file. Only cues with a code consumer are listed; the conditional
 * catalog rows are generated and connected when their trigger exists (PRD "conditional cues are
 * generated only when the game has their listed consumer").
 */
export const CUE_FILES: Record<string, string> = {
  engineExtIdle: "audio/sbd-engine-exterior-idle-01.ogg",
  engineExtCruise: "audio/sbd-engine-exterior-cruise-01.ogg",
  engineExtPower: "audio/sbd-engine-exterior-power-01.ogg",
  engineIntIdle: "audio/sbd-engine-interior-idle-01.ogg",
  engineIntCruise: "audio/sbd-engine-interior-cruise-01.ogg",
  engineIntPower: "audio/sbd-engine-interior-power-01.ogg",
  airflowExterior: "audio/airflow-exterior.ogg",
  airflowCockpit: "audio/airflow-cockpit.ogg",
  engineRough: "audio/engine-rough.ogg",
  propWindmill: "audio/prop-windmill.ogg",
  engineStart: "audio/sbd-engine-start.ogg",
  engineStop: "audio/sbd-engine-stop.ogg",
  diveBrake: "audio/sbd-dive-brake.ogg",
  buffet: "audio/airframe-buffet.ogg",
  cockpitRattle: "audio/cockpit-rattle.ogg",
  gearTravel: "audio/gear-travel.ogg",
  flapTravel: "audio/flap-travel.ogg",
  airframeHit: "audio/airframe-hit.ogg",
  gun50: "audio/gun-50.ogg",
  gun30: "audio/gun-30.ogg",
  gun77: "audio/gun-77.ogg",
  cannon20: "audio/cannon-20.ogg",
  bulletNear: "audio/bullet-near.ogg",
  aaHeavy: "audio/aa-heavy.ogg",
  aa11: "audio/aa-11.ogg",
  aa20: "audio/aa-20.ogg",
  aa25: "audio/aa-25.ogg",
  flakAirburst: "audio/flak-airburst.ogg",
  bombShackle: "audio/bomb-shackle.ogg",
  torpedoRelease: "audio/torpedo-release.ogg",
  bombDeck: "audio/bomb-deck.ogg",
  bombWater: "audio/bomb-water.ogg",
  torpedoHit: "audio/torpedo-hit.ogg",
  torpedoEntry: "audio/torpedo-entry.ogg",
  aircraftCrash: "audio/aircraft-crash.ogg",
  secondaryBlast: "audio/secondary-blast.ogg",
  steelHit: "audio/steel-hit.ogg",
  hullCollapse: "audio/hull-collapse.ogg",
  waterFragments: "audio/water-fragments.ogg",
  deckRoll: "audio/deck-roll.ogg",
  wireCatch: "audio/wire-catch.ogg",
  deckTouchdown: "audio/deck-touchdown.ogg",
  shipMachinery: "audio/ship-machinery.ogg",
  hullWash: "audio/hull-wash.ogg",
  generalAlarm: "audio/general-alarm.ogg",
  radioKey: "audio/radio-key.ogg",
  radioStatic: "audio/radio-static.ogg",
  oceanWind: "audio/ocean-wind.ogg",
  reefSurf: "audio/reef-surf.ogg",
};

/** Speech clips, keyed `speech:<slug>`; a missing clip is silent and keeps its caption. */
const SPEECH_FILES: Record<string, string> = Object.fromEntries(
  speechSlugList().map((slug) => [`speech:${slug}`, `audio/voice/${slug}.ogg`]),
);

/** Engine layers, per perspective and operating state. */
const ENGINE_LAYERS = {
  exterior: ["engineExtIdle", "engineExtCruise", "engineExtPower"],
  interior: ["engineIntIdle", "engineIntCruise", "engineIntPower"],
} as const;
const STATE_CENTERS = [0.16, 0.5, 0.9];

/** The listener's state this frame. `cockpit` drives the perspective cross-fade. */
export interface IListenerState {
  cockpit: boolean;
  onDeck: boolean;
  /** Within shipboard PA range; gates the `pa` channel only. */
  nearPA?: boolean;
  deckSpeed?: number;
  engineCut?: boolean;
  damage?: number;
  /** Stall intensity and load factor; they drive the airframe buffeting layer, not a horn. */
  stall?: number;
  gforce?: number;
  rpm: number;
  throttle: number;
  ias: number;
}

/** One-shot volume and cooldown by cue family; distance is applied per event. */
const ONE_SHOT: Record<string, { volume: number; cooldown: number; fade?: boolean }> = {
  gun50: { volume: 0.5, cooldown: 0.05 },
  gun30: { volume: 0.45, cooldown: 0.06 },
  gun77: { volume: 0.4, cooldown: 0.06 },
  cannon20: { volume: 0.55, cooldown: 0.08 },
  bulletNear: { volume: 0.4, cooldown: 0.05 },
  aaHeavy: { volume: 0.7, cooldown: 0.1 },
  aa11: { volume: 0.55, cooldown: 0.08 },
  aa20: { volume: 0.5, cooldown: 0.07 },
  aa25: { volume: 0.5, cooldown: 0.07 },
  flakAirburst: { volume: 0.7, cooldown: 0.08 },
  bombShackle: { volume: 0.55, cooldown: 0.15 },
  torpedoRelease: { volume: 0.55, cooldown: 0.15 },
  bombDeck: { volume: 0.85, cooldown: 0.05 },
  bombWater: { volume: 0.75, cooldown: 0.05 },
  torpedoHit: { volume: 0.9, cooldown: 0.05 },
  torpedoEntry: { volume: 0.6, cooldown: 0.1 },
  aircraftCrash: { volume: 0.7, cooldown: 0.1 },
  secondaryBlast: { volume: 0.75, cooldown: 0.1 },
  steelHit: { volume: 0.4, cooldown: 0.05 },
  hullCollapse: { volume: 0.7, cooldown: 0.5 },
  waterFragments: { volume: 0.35, cooldown: 0.06 },
  wireCatch: { volume: 0.7, cooldown: 0.4 },
  deckTouchdown: { volume: 0.6, cooldown: 0.3 },
  airframeHit: { volume: 0.6, cooldown: 0.08 },
  gearTravel: { volume: 0.5, cooldown: 0.5 },
  flapTravel: { volume: 0.45, cooldown: 0.5 },
  engineStart: { volume: 0.6, cooldown: 1 },
  engineStop: { volume: 0.6, cooldown: 1 },
  radioKey: { volume: 0.25, cooldown: 0.2 },
  generalAlarm: { volume: 0.8, cooldown: 3 },
};

/** Audio falloff range in metres; past it an event contributes nothing. */
const FALLOFF: Record<string, number> = {
  gun50: 1400,
  gun30: 900,
  gun77: 900,
  cannon20: 1400,
  aaHeavy: 9000,
  aa11: 4500,
  aa20: 3200,
  aa25: 3200,
  flakAirburst: 6000,
  bombDeck: 9000,
  bombWater: 6000,
  torpedoHit: 8000,
  torpedoEntry: 4000,
  aircraftCrash: 5000,
  secondaryBlast: 6000,
  steelHit: 3000,
  hullCollapse: 9000,
  waterFragments: 2500,
};

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Triangular weight around a state centre, so adjacent operating states overlap. */
function stateWeight(rpm: number, center: number): number {
  return Math.max(0, 1 - Math.abs(rpm - center) / 0.42);
}

export class Soundscape {
  /** Load every packaged cue and speech clip; a missing file is skipped and reported once. */
  static async load(assets: Assets): Promise<Buffers> {
    const entries = await Promise.allSettled(
      Object.entries({ ...CUE_FILES, ...SPEECH_FILES }).map(async ([key, path]) => [key, await assets.audio(path)] as const),
    );
    const buffers = new Map<string, AudioBuffer>();
    for (const result of entries) if (result.status === "fulfilled") buffers.set(result.value[0], result.value[1]);
    return buffers;
  }

  readonly bus: IAudioTarget;
  readonly speech: SpeechQueue;
  readonly buffers: Buffers;
  readonly #speechBus: ISpeechBus | undefined;
  active = false;
  /** Continuous voices, keyed, started at most once and reused every frame. */
  readonly #loops = new Map<string, IVoice>();
  readonly #lastAt = new Map<string, number>();
  #muted = false;
  #paused = false;
  #disposed = false;
  #layersStarted = false;
  #reported = 0;
  #perspective = 0;
  #lastT = 0;

  constructor(buffers: Buffers, bus: IAudioTarget, speechBus?: ISpeechBus) {
    this.buffers = buffers;
    this.bus = bus;
    this.#speechBus = speechBus;
    this.speech = new SpeechQueue(speechBus ?? (bus as unknown as ISpeechBus), buffers);
  }

  /** True while a spoken line sounds; the scene ducks effects under it. */
  get speaking(): boolean {
    return this.speech.speaking;
  }

  get muted(): boolean {
    return this.#muted;
  }

  set muted(v: boolean) {
    this.#muted = v;
    this.bus.setVolume(v || this.#paused ? 0 : 0.85, 0.04);
  }

  /** Safe to call on every gesture: the buses unlock themselves, this is only a nudge. */
  start(): void {
    void this.bus.unlock().catch(() => undefined);
    void this.#speechBus?.unlock?.().catch(() => undefined);
  }

  /** Starts the continuous layers once; a missing buffer simply leaves that layer out. */
  #startLayers(): void {
    if (this.#layersStarted) return;
    this.#layersStarted = true;
    this.active = true;
    const start = (key: string, volume: number) => {
      const buffer = this.buffers.get(key);
      if (!buffer) return;
      this.#loops.set(key, this.bus.music(buffer, { loop: true, volume, fade: 0.2 }));
    };
    for (const key of [...ENGINE_LAYERS.exterior, ...ENGINE_LAYERS.interior]) start(key, 0);
    start("airflowExterior", 0);
    start("airflowCockpit", 0);
    start("engineRough", 0);
    start("propWindmill", 0);
    start("buffet", 0);
    start("deckRoll", 0);
    start("shipMachinery", 0);
    start("hullWash", 0);
    start("radioStatic", 0);
    start("oceanWind", 0);
  }

  /** Drive every continuous layer's gain and pitch from the listener's real state. */
  update(p: IListenerState, paused: boolean, dt = 1 / 60): void {
    if (this.#disposed) return;
    this.#startLayers();
    const now = this.bus.listener.context.currentTime;
    this.#lastT = now;
    this.#paused = paused;
    // Duck effects 4 dB under speech so a warning is legible; the speech bus is untouched.
    const level = this.#muted || paused ? 0 : this.speaking ? 0.54 : 0.85;
    this.bus.setVolume(level, 0.08);
    this.speech.update(dt, paused, p.nearPA ?? p.onDeck, this.#muted);
    // Perspective ramps over ~150 ms; the same engine phase keeps running underneath.
    const target = p.cockpit ? 1 : 0;
    this.#perspective += (target - this.#perspective) * (1 - Math.exp(-dt / 0.15));
    const inside = this.#perspective;
    const rpm = p.rpm ?? p.throttle ?? 0;
    const dead = !!p.engineCut;
    const rough = clamp01(p.damage ?? 0);
    for (const [perspective, keys] of Object.entries(ENGINE_LAYERS)) {
      const side = perspective === "interior" ? inside : 1 - inside;
      keys.forEach((key, i) => {
        const weight = (dead ? 0 : side * stateWeight(rpm, STATE_CENTERS[i] ?? 0.5)) * (1 - rough * 0.7);
        this.#setGain(key, weight * 0.9, 0.18);
        this.#setRate(key, 0.78 + rpm * 0.5, 0.2);
      });
    }
    this.#setGain("engineRough", dead ? 0 : rough * 0.8, 0.25);
    this.#setGain("propWindmill", dead && (p.ias ?? 0) > 30 ? 0.7 : 0, 0.25);
    // Buffeting is the honest replacement for a modern stall horn: it rises with stall and load.
    const buffet = Math.min(1, (p.stall ?? 0) * 0.45 + Math.max(0, Math.abs(p.gforce ?? 1) - 4) * 0.08);
    this.#setGain("buffet", buffet * 0.6, 0.2);
    // Slipstream tracks airspeed, not power: it is what a dead-stick dive still sounds like.
    const wind = Math.min(1, ((p.ias ?? 0) / 150) ** 1.5);
    this.#setGain("airflowCockpit", wind * inside * 0.5, 0.25);
    this.#setGain("airflowExterior", wind * (1 - inside) * 0.4, 0.25);
    const deck = p.onDeck ? Math.min(1, (p.deckSpeed ?? 0) / 40) * (1 - inside * 0.5) : 0;
    this.#setGain("deckRoll", deck * 0.7, 0.2);
    this.#setGain("shipMachinery", p.onDeck ? 0.35 * (1 - inside) : 0, 0.5);
    this.#setGain("hullWash", p.onDeck ? 0.25 * (1 - inside) : 0, 0.5);
    this.#setGain("oceanWind", (1 - inside) * 0.12, 0.6);
    this.#setGain("radioStatic", 0, 0.4);
    if (this.#reported === 0 && !this.buffers.size) {
      this.#reported = Date.now();
      console.info("Audio: no packaged cues loaded; running silent and preserving captions.");
    }
  }

  #setGain(key: string, value: number, tau: number): void {
    const voice = this.#loops.get(key);
    if (!voice) return;
    voice.gain.gain.setTargetAtTime?.(value, this.#lastT, tau);
  }

  #setRate(key: string, value: number, tau: number): void {
    const voice = this.#loops.get(key);
    const param = (voice?.source as { playbackRate?: AudioParam } | null | undefined)?.playbackRate;
    param?.setTargetAtTime?.(value, this.#lastT, tau);
  }

  /** One-shot cue with the family's cooldown and distance falloff; missing buffers stay quiet. */
  #play(key: string, attenuation = 1): boolean {
    if (this.#disposed || this.#muted || this.#paused) return false;
    const buffer = this.buffers.get(key);
    const tune = ONE_SHOT[key];
    if (!buffer || !tune || attenuation <= 0.01) return false;
    const now = this.bus.listener.context.currentTime;
    if (now - (this.#lastAt.get(key) ?? -Infinity) < tune.cooldown) return true;
    this.#lastAt.set(key, now);
    this.bus.play(buffer, { volume: tune.volume * attenuation, fade: tune.fade ? 0.05 : undefined });
    return true;
  }

  /** A one-shot at a world point: the panner carries the distance and direction. */
  #playAt(key: string, at: { x: number; y: number; z: number }, volume = 1): boolean {
    if (this.#disposed || this.#muted || this.#paused) return false;
    const buffer = this.buffers.get(key);
    const tune = ONE_SHOT[key];
    if (!buffer || !tune) return false;
    this.bus.playAt(buffer, { x: at.x, y: at.y, z: at.z } as never, {
      volume: tune.volume * volume,
      refDistance: 60,
      rolloffFactor: 0.7,
    });
    return true;
  }

  /**
   * One battle/airframe event. Enriched events (source ID, position, weapon family, outcome) are
   * added by the later phases; today the existing distance field is an honest attenuation input.
   */
  event(e: { type?: string; distance?: number; at?: { x: number; y: number; z: number }; cue?: string; request?: ISpeechRequest }): void {
    const d = typeof e.distance === "number" ? e.distance : 0;
    const near = (key: string) => Math.max(0, 1 - d / (FALLOFF[key] ?? 1));
    if (e.type === "speech") {
      if (e.request) this.speak(e.request);
      return;
    }
    if (e.cue && e.at) {
      this.#playAt(e.cue, e.at, near(e.cue));
      return;
    }
    switch (e.type) {
      case "gun":
        this.#play("gun50");
        break;
      case "explosion": {
        const a = near("bombWater");
        if (a > 0) this.#play("bombWater", a);
        break;
      }
      case "flak": {
        const a = near("flakAirburst");
        if (a > 0) this.#play("flakAirburst", a);
        break;
      }
      case "splash": {
        const a = near("torpedoEntry");
        if (a > 0) this.#play("torpedoEntry", a);
        break;
      }
      case "bomb":
        this.#play("bombShackle");
        break;
      case "damage":
        this.#play("airframeHit");
        break;
      case "radio":
        this.#play("radioKey");
        break;
      case "land":
        this.#play("deckTouchdown");
        break;
      case "alarm":
        this.#play("generalAlarm");
        break;
    }
  }

  /** Offer a friendly line to the bounded speech queue. */
  speak(request: ISpeechRequest): boolean {
    return this.speech.request(request);
  }

  /** Stops every voice and closes the buses. Safe to call twice. */
  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.active = false;
    this.#loops.clear();
    this.#lastAt.clear();
    this.speech.dispose();
    if (this.#speechBus && (this.#speechBus as unknown) !== (this.bus as unknown)) this.#speechBus.dispose();
    this.bus.dispose();
  }
}
