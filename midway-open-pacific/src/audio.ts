/**
 * The engine drone and combat bursts.
 *
 * Real recordings drive everything the game ships a sample for; the synthetic oscillators survive
 * only as the fallback for a fetch or decode that failed, so a broken asset is quiet-but-playable
 * rather than silent. `engine-loop.ogg` was measured seamless (head and tail both -10.2 dB mean,
 * no fade at either end) and `wind-loop.mp3` was trimmed to its flat region for the same reason,
 * so both loop on a plain `loop = true` with no crossfade.
 */

const BASE = `${(import.meta as any).env?.BASE_URL ?? "/"}assets/audio/`;

/** file name, and the playback gain that levels it against the others (measured with volumedetect). */
const SOUNDS: Record<string, [string, number]> = {
  engine: ["engine-loop.ogg", 0.3],
  wind: ["wind-loop.mp3", 0.22],
  gun: ["machinegun-burst.mp3", 0.3],
  flak: ["flak-airburst.mp3", 0.85], // quietest source at -25.4 dB mean, so it needs the most
  explosion: ["explosion.mp3", 0.55],
  splash: ["water-splash.mp3", 0.45],
  bomb: ["bomb-release.mp3", 0.35],
  stall: ["stall-horn.mp3", 0.22], // loudest source at -8.7 dB mean
};

/** cooldown seconds and simultaneous voice cap, so a held trigger cannot stack into a roar. */
const LIMITS: Record<string, [number, number]> = {
  gun: [0.05, 4],
  flak: [0.08, 3],
  explosion: [0.05, 4],
  splash: [0.12, 2],
  bomb: [0.15, 2],
  stall: [2.5, 1],
};

/** the range past which an event contributes nothing, in metres. */
const FALLOFF: Record<string, number> = { flak: 2200, explosion: 3000, splash: 1800 };

export class Soundscape {
  ctx: AudioContext | null = null;
  active = false;
  master: GainNode | null = null;
  /** kept as the fallback engine voice; silenced the moment the real loop decodes. */
  engine: OscillatorNode | null = null;
  engineGain: GainNode | null = null;
  filter: BiquadFilterNode | null = null;
  low: OscillatorNode | null = null;
  lowGain: GainNode | null = null;
  noise: AudioBuffer | null = null;

  #muted = false;
  #disposed = false;
  #buffers = new Map<string, AudioBuffer>();
  #loops = new Map<string, { src: AudioBufferSourceNode; gain: GainNode; rate?: AudioParam }>();
  #voices = new Map<string, number>();
  #lastAt = new Map<string, number>();
  #loading = false;
  #reported = false;
  #stallArmed = true;
  /** last pause state seen by update(); the mute button must not reopen the master over a pause. */
  #paused = false;
  /** every sounding one-shot, so dispose() can stop them and not just the loops. */
  #live = new Set<{ src: AudioScheduledSourceNode; nodes: AudioNode[] }>();

  /** Set by the SOUND ON/OFF button; takes effect on the same tick rather than the next frame. */
  get muted(): boolean {
    return this.#muted;
  }

  set muted(v: boolean) {
    this.#muted = v;
    // Unmuting while paused must stay silent: the pause, not the button, owns the gain here.
    if (this.ctx && this.master) this.master.gain.setTargetAtTime(v || this.#paused ? 0 : 0.38, this.ctx.currentTime, 0.04);
  }

  /** Nothing may open a voice while muted or paused. */
  get #silent(): boolean {
    return this.#muted || this.#paused;
  }

  /** Registers a one-shot's nodes and returns the teardown that frees them exactly once. */
  #track(src: AudioScheduledSourceNode, nodes: AudioNode[], after?: () => void): () => void {
    const entry = { src, nodes };
    this.#live.add(entry);
    return () => {
      if (!this.#live.delete(entry)) return; // dispose() already tore this voice down
      after?.();
      for (const n of nodes) n.disconnect();
    };
  }

  /** Safe to call on every gesture: it builds the graph once and only resumes thereafter. */
  start(): void {
    if (this.#disposed) return;
    try {
      if (this.ctx) {
        if (this.ctx.state === "suspended") void this.ctx.resume().catch(() => {});
        return;
      }
      const Ctor = window.AudioContext || (window as any).webkitAudioContext;
      if (!Ctor) return;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.#muted ? 0 : 0.4;
      this.master.connect(this.ctx.destination);
      // The synthetic engine runs from the first gesture so there is never a silent gap while the
      // samples are still in flight; #load() retires it once engine-loop.ogg decodes.
      this.engine = this.ctx.createOscillator();
      this.engine.type = "sawtooth";
      this.engine.frequency.value = 53;
      this.filter = this.ctx.createBiquadFilter();
      this.filter.type = "lowpass";
      this.filter.frequency.value = 150;
      this.engineGain = this.ctx.createGain();
      this.engineGain.gain.value = 0.025;
      this.engine.connect(this.filter);
      this.filter.connect(this.engineGain);
      this.engineGain.connect(this.master);
      this.engine.start();
      this.low = this.ctx.createOscillator();
      this.low.type = "sine";
      this.low.frequency.value = 27;
      this.lowGain = this.ctx.createGain();
      this.lowGain.gain.value = 0.045;
      this.low.connect(this.lowGain);
      this.lowGain.connect(this.master);
      this.low.start();
      const buffer = this.ctx.createBuffer(1, this.ctx.sampleRate * 2, this.ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
      this.noise = buffer;
      this.active = true;
      void this.#load();
    } catch {
      console.info("Audio is unavailable; continuing silently.");
    }
  }

  /** Fetch and decode every sample once. Failures are collected and reported in a single line. */
  async #load(): Promise<void> {
    if (this.#loading || !this.ctx) return;
    this.#loading = true;
    const ctx = this.ctx;
    const results = await Promise.allSettled(
      Object.entries(SOUNDS).map(async ([key, [file]]) => {
        const res = await fetch(BASE + file);
        if (!res.ok) throw new Error(`${file}: ${res.status}`);
        const buf = await ctx.decodeAudioData(await res.arrayBuffer());
        return [key, buf] as const;
      }),
    );
    // A dispose() during the fetch must not resurrect the graph.
    if (this.#disposed || this.ctx !== ctx) return;
    const failed: string[] = [];
    for (const r of results) {
      if (r.status === "fulfilled") this.#buffers.set(r.value[0], r.value[1]);
      else failed.push(String(r.reason?.message ?? r.reason));
    }
    if (failed.length && !this.#reported) {
      this.#reported = true;
      console.info(`Audio: ${failed.length} sample(s) unavailable, using the synthetic fallback — ${failed.join(", ")}`);
    }
    if (this.#buffers.has("engine")) {
      this.#startLoop("engine", 0);
      this.#retireSynthEngine();
    }
    if (this.#buffers.has("wind")) this.#startLoop("wind", 0);
  }

  /** Starts a looping voice at most once per key; a second call is a no-op, never a second loop. */
  #startLoop(key: string, gain: number): void {
    if (!this.ctx || !this.master || this.#loops.has(key)) return;
    const buffer = this.#buffers.get(key);
    if (!buffer) return;
    const src = this.ctx.createBufferSource();
    const g = this.ctx.createGain();
    src.buffer = buffer;
    src.loop = true;
    g.gain.value = gain;
    src.connect(g);
    g.connect(this.master);
    src.start();
    this.#loops.set(key, { src, gain: g, rate: src.playbackRate });
  }

  /** Fades out the oscillators and frees them once a real engine loop is playing. */
  #retireSynthEngine(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    for (const node of [this.engineGain, this.lowGain]) node?.gain.setTargetAtTime(0, t, 0.25);
    const osc = [this.engine, this.low];
    const gains = [this.engineGain, this.lowGain, this.filter];
    this.engine = this.low = null;
    this.engineGain = this.lowGain = null;
    this.filter = null;
    for (const o of osc) {
      if (!o) continue;
      o.stop(t + 1.2);
      o.onended = () => o.disconnect();
    }
    setTimeout(() => {
      for (const g of gains) g?.disconnect();
    }, 1500);
  }

  update(p: any, paused: boolean): void {
    if (!this.ctx || !this.master) return;
    const t = this.ctx.currentTime;
    this.#paused = paused;
    this.master.gain.setTargetAtTime(this.#silent ? 0 : 0.38, t, 0.08);
    const rpm = p.rpm ?? p.throttle ?? 0;
    const engine = this.#loops.get("engine");
    if (engine) {
      // The recording sits at cruise; the rate span covers idle chug to full military power.
      engine.rate?.setTargetAtTime(0.74 + rpm * 0.62, t, 0.2);
      engine.gain.gain.setTargetAtTime(SOUNDS.engine[1] * (0.34 + rpm * 0.66), t, 0.2);
    } else if (this.engine && this.filter && this.engineGain && this.low && this.lowGain) {
      this.engine.frequency.setTargetAtTime(20 + rpm * 63, t, 0.15);
      this.filter.frequency.setTargetAtTime(130 + p.throttle * 210, t, 0.2);
      this.engineGain.gain.setTargetAtTime(0.003 + rpm * 0.033, t, 0.2);
      this.low.frequency.setTargetAtTime(22 + p.throttle * 16, t, 0.1);
    }
    const wind = this.#loops.get("wind");
    if (wind) {
      // Slipstream tracks airspeed, not power: it is what a dead-stick dive still sounds like.
      const speed = Math.max(0, p.ias ?? p.speed ?? 0);
      wind.gain.gain.setTargetAtTime(SOUNDS.wind[1] * Math.min(1, (speed / 150) ** 1.5), t, 0.25);
    }
    // The horn is a state, not an event, so it is edge-triggered here rather than in event().
    const stall = p.stall ?? 0;
    if (stall < 0.25) this.#stallArmed = true;
    else if (stall > 0.45 && this.#stallArmed && !paused) {
      this.#stallArmed = false;
      this.#play("stall", 1);
    }
  }

  /** One-shot sample with the key's cooldown, voice cap and distance attenuation applied. */
  #play(key: string, attenuation = 1): boolean {
    if (!this.ctx || !this.master || this.#silent || attenuation <= 0.01) return false;
    const buffer = this.#buffers.get(key);
    if (!buffer) return false;
    const t = this.ctx.currentTime;
    const [cooldown, cap] = LIMITS[key] ?? [0, 6];
    if (t - (this.#lastAt.get(key) ?? -Infinity) < cooldown) return true;
    if ((this.#voices.get(key) ?? 0) >= cap) return true;
    this.#lastAt.set(key, t);
    this.#voices.set(key, (this.#voices.get(key) ?? 0) + 1);
    const src = this.ctx.createBufferSource();
    const g = this.ctx.createGain();
    src.buffer = buffer;
    g.gain.value = (SOUNDS[key]?.[1] ?? 0.3) * attenuation;
    src.connect(g);
    g.connect(this.master);
    src.start(t);
    src.onended = this.#track(src, [src, g], () =>
      this.#voices.set(key, Math.max(0, (this.#voices.get(key) ?? 1) - 1)),
    );
    return true;
  }

  burst(duration: number, volume: number, frequency = 1500): void {
    if (!this.ctx || this.#silent || !this.noise || !this.master) return;
    const t = this.ctx.currentTime;
    const s = this.ctx.createBufferSource();
    const f = this.ctx.createBiquadFilter();
    const g = this.ctx.createGain();
    s.buffer = this.noise;
    f.type = "lowpass";
    f.frequency.value = frequency;
    g.gain.setValueAtTime(volume, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + duration);
    s.connect(f);
    f.connect(g);
    g.connect(this.master);
    s.start(t);
    s.stop(t + duration);
    s.onended = this.#track(s, [s, f, g]);
  }

  beep(freq = 820, duration = 0.08, volume = 0.03): void {
    if (!this.ctx || this.#silent || !this.master) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.frequency.value = freq;
    g.gain.setValueAtTime(volume, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + duration);
    o.connect(g);
    g.connect(this.master);
    o.start(t);
    o.stop(t + duration);
    o.onended = this.#track(o, [o, g]);
  }

  event(e: any): void {
    const d = typeof e.distance === "number" ? e.distance : 0;
    // Linear falloff to exactly zero at the cutoff. No floor: past its range an event is silent
    // in both paths, so a sample that failed to load cannot make a distant hit audible either.
    const near = (key: string) => Math.max(0, 1 - d / (FALLOFF[key] ?? 1));
    switch (e.type) {
      case "gun":
        if (!this.#play("gun")) this.burst(0.055, 0.19, 1700);
        break;
      case "explosion": {
        const a = near("explosion");
        if (a <= 0) break;
        if (!this.#play("explosion", a)) this.burst(1.3, 0.42 * a, 230);
        break;
      }
      case "flak": {
        const a = near("flak");
        if (a <= 0) break;
        if (!this.#play("flak", a)) this.burst(0.32, 0.16 * a, 180 + d * 0.08);
        break;
      }
      case "splash": {
        const a = near("splash");
        if (a <= 0) break;
        if (!this.#play("splash", a)) this.burst(0.55, 0.1 * a, 800);
        break;
      }
      case "bomb":
        if (!this.#play("bomb")) this.beep(260, 0.18, 0.025);
        break;
      // No recording ships for these two: a hit on your own airframe and a radio blip are both
      // better served by the synthetic voices than by a wrong sample.
      case "damage":
        this.burst(0.18, 0.2, 800);
        break;
      case "radio":
        this.beep(950, 0.07, 0.018);
        break;
      case "land":
        this.burst(0.7, 0.16, 350);
        break;
    }
  }

  /** Stops every voice, disconnects the graph and closes the context. Safe to call twice. */
  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.active = false;
    for (const { src, gain } of this.#loops.values()) {
      try {
        src.onended = null;
        src.stop();
      } catch {
        /* already stopped */
      }
      src.disconnect();
      gain.disconnect();
    }
    // Sounding one-shots outlive the loops: a gun burst or radio beep in flight when the scene
    // exits must be stopped here, and its onended cleared so a late callback cannot refill #voices.
    for (const { src, nodes } of this.#live) {
      try {
        src.onended = null;
        src.stop();
      } catch {
        /* already stopped */
      }
      for (const n of nodes) n.disconnect();
    }
    this.#live.clear();
    this.#loops.clear();
    this.#buffers.clear();
    this.#voices.clear();
    this.#lastAt.clear();
    for (const o of [this.engine, this.low]) {
      try {
        o?.stop();
      } catch {
        /* already stopped */
      }
      o?.disconnect();
    }
    for (const n of [this.engineGain, this.lowGain, this.filter, this.master]) n?.disconnect();
    this.engine = this.low = null;
    this.engineGain = this.lowGain = null;
    this.filter = null;
    this.master = null;
    this.noise = null;
    const ctx = this.ctx;
    this.ctx = null;
    void ctx?.close().catch(() => {});
  }
}
