/**
 * The bounded delivery queue for friendly speech.
 *
 * Delivery follows the PRD's contract: one sentence at a time, immediate threats interrupt routine
 * traffic, priority/expiry/deduplication bounds the queue, and shipboard PA is a separate channel
 * that only sounds while the listener is aboard or alongside. The script itself is pure data in
 * `./sim/radio-script.js`; this module owns no WebAudio graph, playing through an injected bus so it
 * is testable under a fake one.
 */
import {
  resolveSpeech,
  type IResolvedSpeech,
  type ISpeechRequest,
  type SpeechPriority,
} from "./sim/radio-script.js";

export {
  SPEECH,
  SPEAKERS,
  SPEECH_DIRECTIONS,
  SPEECH_SHIPS,
  resolveSpeech,
  speechSlugList,
} from "./sim/radio-script.js";
export type { ISpeechRequest, IResolvedSpeech, SpeechPriority, SpeechChannel } from "./sim/radio-script.js";

type Buffers = ReadonlyMap<string, AudioBuffer>;

interface IVoice {
  gain: { gain: AudioParam };
  isPlaying?: boolean;
}

/** The slice of `AudioBus` speech needs. Declared structurally so a fake satisfies it. */
export interface ISpeechBus {
  listener: { context: { currentTime: number } };
  setVolume(volume: number, fade?: number): void;
  play(buffer: AudioBuffer, options?: Record<string, unknown>): IVoice;
  stopVoice(voice: IVoice): boolean;
  unlock?(): Promise<void>;
  dispose(): void;
}

/** Cooldown per dedup key: 30 s for a live threat, 45 s for routine status (PRD §4). */
const COOLDOWN: Record<SpeechPriority, number> = { 1: 30, 2: 30, 3: 45 };
/** Queued but not yet started, an alert is stale after these seconds (PRD §3). */
const EXPIRY: Record<SpeechPriority, number> = { 1: 5, 2: 15, 3: 20 };
/** Pause between routine sentences; nothing between an urgent one and the next. */
const ROUTINE_GAP = 3;
/** Maximum queued sentences; overflow discards the oldest lowest-priority entry. */
const MAX_QUEUED = 4;

interface IQueued {
  readonly cue: IResolvedSpeech;
  readonly dedup: string;
  readonly valid?: () => boolean;
  readonly at: number;
}

export class SpeechQueue {
  readonly #bus: ISpeechBus;
  readonly #buffers: Buffers;
  #queue: IQueued[] = [];
  #current: { cue: IResolvedSpeech; dedup: string; voice: IVoice; startedAt: number; endsAt: number } | null = null;
  readonly #lastAt = new Map<string, number>();
  #lastRoutineAt = -Infinity;
  #nearPA = false;
  #disposed = false;
  /** Counts lines that actually began sounding; the playtest gate reads it. */
  spoken = 0;

  constructor(bus: ISpeechBus, buffers: Buffers) {
    this.#bus = bus;
    this.#buffers = buffers;
  }

  /** True while a sentence is sounding; the effects bus ducks under it. */
  get speaking(): boolean {
    return this.#current !== null;
  }

  get queued(): number {
    return this.#queue.length;
  }

  /** Offer a line. Dedup, predicate, PA range and priority are applied at request time. */
  request(request: ISpeechRequest): boolean {
    if (this.#disposed) return false;
    const cue = resolveSpeech(request);
    if (!cue) return false;
    if (cue.channel === "pa" && !this.#nearPA) return false;
    const now = this.#bus.listener.context.currentTime;
    const dedup = `${cue.slug}|${request.identity ?? ""}`;
    if (now - (this.#lastAt.get(dedup) ?? -Infinity) < COOLDOWN[cue.priority]) return false;
    const entry: IQueued = { cue, dedup, valid: request.valid, at: now };
    const urgent = this.#current && (cue.priority < this.#current.cue.priority || (cue.channel === "intercom" && this.#current.cue.channel !== "intercom"));
    if (urgent) {
      this.#interrupt();
      this.#start(entry, now);
      return true;
    }
    this.#queue.push(entry);
    this.#trim();
    return true;
  }

  /** Expire stale queued lines, then advance to the next eligible one. Muted stays silent but keeps expiring. */
  update(_dt: number, paused: boolean, nearPA: boolean, muted = false): void {
    if (this.#disposed) return;
    this.#nearPA = nearPA;
    const now = this.#bus.listener.context.currentTime;
    this.#bus.setVolume(paused || muted ? 0 : 0.9, 0.05);
    if (paused) return;
    this.#queue = this.#queue.filter((q) => now - q.at < EXPIRY[q.cue.priority]);
    if (this.#current) {
      const ended = now >= this.#current.endsAt || (now > this.#current.startedAt + 0.05 && this.#current.voice.isPlaying === false);
      if (!ended) return;
      if (this.#current.cue.priority === 3) this.#lastRoutineAt = now;
      this.#current = null;
    }
    while (this.#queue.length) {
      const next = this.#queue.shift()!;
      if (next.valid && !next.valid()) continue;
      if (next.cue.channel === "pa" && !nearPA) continue;
      if (next.cue.priority === 3 && now - this.#lastRoutineAt < ROUTINE_GAP) {
        this.#queue.unshift(next);
        return;
      }
      this.#start(next, now);
      return;
    }
  }

  /** One queue slot, capped; overflow drops the oldest entry in the lowest-priority band. */
  #trim(): void {
    while (this.#queue.length > MAX_QUEUED) {
      let worst = 1 as SpeechPriority;
      for (const q of this.#queue) if (q.cue.priority > worst) worst = q.cue.priority;
      const index = this.#queue.findIndex((q) => q.cue.priority === worst);
      this.#queue.splice(index >= 0 ? index : 0, 1);
    }
  }

  #start(entry: IQueued, now: number): void {
    const buffer = this.#buffers.get(`speech:${entry.cue.slug}`);
    this.#lastAt.set(entry.dedup, now);
    if (!buffer) return; // missing clip: silent, caption already in the log
    const voice = this.#bus.play(buffer, { volume: entry.cue.channel === "intercom" ? 0.95 : 0.8, lowpassHz: entry.cue.channel === "pa" ? 9000 : 3200 });
    this.#current = { cue: entry.cue, dedup: entry.dedup, voice, startedAt: now, endsAt: now + (buffer.duration || 4) };
    this.spoken += 1;
  }

  /** Fade the current line out over ~50 ms and drop it, so a warning does not overlap itself. */
  #interrupt(): void {
    const current = this.#current;
    this.#current = null;
    if (!current) return;
    const now = this.#bus.listener.context.currentTime;
    current.voice.gain.gain.setTargetAtTime?.(0, now, 0.02);
    setTimeout(() => this.#bus.stopVoice(current.voice), 60);
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    if (this.#current) this.#bus.stopVoice(this.#current.voice);
    this.#current = null;
    this.#queue = [];
    // The bus owner disposes the bus: a shared bus would otherwise be closed twice.
  }
}
