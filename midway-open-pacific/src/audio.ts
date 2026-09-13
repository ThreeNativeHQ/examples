/** The engine drone and combat bursts, as in the standalone build. */
export class Soundscape {
  ctx: AudioContext | null = null;
  muted = false;
  active = false;
  master: GainNode | null = null;
  engine: OscillatorNode | null = null;
  engineGain: GainNode | null = null;
  filter: BiquadFilterNode | null = null;
  low: OscillatorNode | null = null;
  lowGain: GainNode | null = null;
  noise: AudioBuffer | null = null;

  start(): void {
    try {
      if (this.ctx) {
        void this.ctx.resume();
        return;
      }
      const Ctor = window.AudioContext || (window as any).webkitAudioContext;
      if (!Ctor) return;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.4;
      this.master.connect(this.ctx.destination);
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
    } catch {
      console.info("Audio is unavailable; continuing silently.");
    }
  }

  update(p: any, paused: boolean): void {
    if (!this.ctx || !this.master || !this.engine || !this.filter || !this.engineGain || !this.low || !this.lowGain) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.muted || paused ? 0 : 0.38, t, 0.08);
    this.engine.frequency.setTargetAtTime(20 + (p.rpm ?? p.throttle) * 63, t, 0.15);
    this.filter.frequency.setTargetAtTime(130 + p.throttle * 210, t, 0.2);
    this.engineGain.gain.setTargetAtTime(0.003 + (p.rpm ?? p.throttle) * 0.033, t, 0.2);
    this.low.frequency.setTargetAtTime(22 + p.throttle * 16, t, 0.1);
  }

  burst(duration: number, volume: number, frequency = 1500): void {
    if (!this.ctx || this.muted || !this.noise || !this.master) return;
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
    s.onended = () => {
      s.disconnect();
      f.disconnect();
      g.disconnect();
    };
  }

  beep(freq = 820, duration = 0.08, volume = 0.03): void {
    if (!this.ctx || this.muted || !this.master) return;
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
    o.onended = () => {
      o.disconnect();
      g.disconnect();
    };
  }

  event(e: any): void {
    if (e.type === "gun") this.burst(0.055, 0.19, 1700);
    if (e.type === "explosion") this.burst(1.3, 0.42, 230);
    if (e.type === "flak" && e.distance < 2200) this.burst(0.32, 0.16 * Math.max(0.08, 1 - e.distance / 2200), 180 + e.distance * 0.08);
    if (e.type === "damage") this.burst(0.18, 0.2, 800);
    if (e.type === "splash") this.burst(0.55, 0.1, 800);
    if (e.type === "bomb") this.beep(260, 0.18, 0.025);
    if (e.type === "radio") this.beep(950, 0.07, 0.018);
    if (e.type === "land") this.burst(0.7, 0.16, 350);
  }
}
