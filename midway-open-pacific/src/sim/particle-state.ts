/** Bounded, world-space particles. Kept separate from Three.js for regression tests. */

export interface IParticle {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  age: number;
  life: number;
  drag: number;
  gravity: number;
  buoyancy: number;
  size: number;
  growth: number;
  alpha: number;
  color: number[];
  rot: number;
  spin: number;
  seed: number;
  kind: number;
  aspect: number;
}

export class ParticlePool {
  readonly capacity: number;
  items: IParticle[] = [];
  private cursor = 0;

  constructor(capacity: number) {
    this.capacity = capacity;
  }

  add(options: Partial<IParticle>): IParticle {
    const p: IParticle = {
      x: 0,
      y: 0,
      z: 0,
      vx: 0,
      vy: 0,
      vz: 0,
      age: 0,
      life: 2,
      drag: 1,
      gravity: 0,
      buoyancy: 0,
      size: 1,
      growth: 0,
      alpha: 0.6,
      color: [0.2, 0.22, 0.23],
      rot: 0,
      spin: 0,
      seed: 1,
      kind: 0,
      aspect: 1,
      ...options,
    };
    if (this.items.length < this.capacity) this.items.push(p);
    else {
      this.items[this.cursor] = p;
      this.cursor = (this.cursor + 1) % this.capacity;
    }
    return p;
  }

  step(dt: number, wind: { x: number; z: number } = { x: 1.2, z: 11 }): void {
    if (dt <= 0) return;
    for (let i = this.items.length - 1; i >= 0; i -= 1) {
      const p = this.items[i];
      if (p === undefined) continue;
      p.age += dt;
      if (p.age >= p.life) {
        const last = this.items.at(-1);
        if (last !== undefined) this.items[i] = last;
        this.items.pop();
        continue;
      }
      const drag = Math.exp(-p.drag * dt);
      p.vx = wind.x + (p.vx - wind.x) * drag;
      p.vz = wind.z + (p.vz - wind.z) * drag;
      p.vy = p.vy * Math.exp(-p.drag * 0.2 * dt) + (p.buoyancy - p.gravity) * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      p.rot += p.spin * dt;
    }
  }

  clear(): void {
    this.items.length = 0;
    this.cursor = 0;
  }
}
