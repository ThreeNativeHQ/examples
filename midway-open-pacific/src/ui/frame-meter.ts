/** Frame-interval summary for the F4 panel, shared by the web HUD and the native bridge. */

export interface IFpsStats {
  fps: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
  over: number;
  samples: number;
  percent: number;
}

/**
 * Frame-interval percentiles over the last 240 frames, re-summarised every 15: no per-frame
 * allocation. The web HUD feeds it from its own rAF; a native target feeds it from the game's
 * rendered frames, because the overlay's rAF runs at the overlay's snapshot rate, not the game's.
 */
export class FrameMeter {
  lines: string[] = [];
  stats: IFpsStats | null = null;
  private readonly ring = new Float32Array(240);
  private readonly scratch = new Float32Array(240);
  private count = 0;
  private head = 0;
  private tick = 0;

  constructor(private readonly label: string) {}

  reset(): void {
    this.count = 0;
    this.head = 0;
    this.tick = 0;
    this.lines = [];
  }

  sample(dt: number): void {
    if (!(dt > 0 && dt < 2000)) return;
    this.ring[this.head] = dt;
    this.head = (this.head + 1) % this.ring.length;
    if (this.count < this.ring.length) this.count += 1;
    this.tick += 1;
    if (this.tick >= 15 || this.count < 2) this.summarize();
  }

  private summarize(): void {
    const n = this.count;
    if (n < 2) return;
    this.tick = 0;
    const len = this.ring.length;
    const s = this.scratch.subarray(0, n);
    for (let i = 0; i < n; i += 1) s[i] = this.ring[(this.head - n + i + len) % len];
    s.sort();
    const q = (p: number) => s[Math.min(n - 1, Math.max(0, Math.round(p * (n - 1))))];
    let mean = 0;
    let over = 0;
    for (let i = 0; i < n; i += 1) {
      mean += s[i];
      if (s[i] > 16.67) over += 1;
    }
    mean /= n;
    const percent = (over / n) * 100;
    this.stats = { fps: 1000 / mean, p50: q(0.5), p95: q(0.95), p99: q(0.99), max: s[n - 1], over, samples: n, percent };
    this.lines = [
      `FRAME TIME · ${this.label}`,
      `FPS ${(1000 / mean).toFixed(0)}`,
      `p50 ${q(0.5).toFixed(1)}  p95 ${q(0.95).toFixed(1)}  p99 ${q(0.99).toFixed(1)} ms`,
      `worst ${s[n - 1].toFixed(1)} ms`,
      `>16.7ms ${over}/${n}  ${percent.toFixed(0)}%`,
    ];
  }
}
