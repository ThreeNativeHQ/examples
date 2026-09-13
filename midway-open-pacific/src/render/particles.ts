/** Two instanced billboard batches: turbulent smoke/mist and emissive fire/sparks. */
import {
  attribute,
  cameraProjectionMatrix,
  cameraViewMatrix,
  cos,
  float,
  length,
  max,
  mix,
  positionLocal,
  pow,
  sin,
  smoothstep,
  step,
  uv,
  vec2,
  vec4,
} from "three/tsl";
import * as T from "three";
import { MeshBasicNodeMaterial } from "three/webgpu";
import { ParticlePool, type IParticle } from "../sim/particle-state.js";
import { aircraftWorld, DAMAGE_ZONES, ZONE_POSITIONS } from "../sim/damage.js";
import { clamp, distance3, lerp, rng } from "../sim/math.js";

function batch(capacity: number, glow: boolean): any {
  const g = new T.InstancedBufferGeometry();
  const base = new T.PlaneGeometry(1, 1);
  g.setIndex(base.index!.clone());
  g.setAttribute("position", base.attributes.position.clone());
  g.setAttribute("uv", base.attributes.uv.clone());
  base.dispose();
  const fields: Record<string, number> = { aPosition: 3, aColor: 3, aShape: 4, aExtra: 3 };
  const arrays: Record<string, Float32Array> = {};
  for (const [key, n] of Object.entries(fields)) {
    arrays[key] = new Float32Array(capacity * n);
    g.setAttribute(key, new T.InstancedBufferAttribute(arrays[key], n).setUsage(T.DynamicDrawUsage));
  }
  g.instanceCount = 0;

  const aPosition: any = attribute("aPosition", "vec3");
  const aColor: any = attribute("aColor", "vec3");
  const aShape: any = attribute("aShape", "vec4");
  const aExtra: any = attribute("aExtra", "vec3");

  const material = new MeshBasicNodeMaterial({
    depthTest: true,
    depthWrite: false,
    transparent: true,
    blending: glow ? T.AdditiveBlending : T.NormalBlending,
  });

  // The quad is billboarded by rotating it in view space, exactly as the original GLSL did.
  const size: any = aShape.xy;
  const local: any = vec2(positionLocal.x.mul(size.x) as any, positionLocal.y.mul(size.y) as any);
  const c: any = cos(aShape.w);
  const s: any = sin(aShape.w);
  const rotated: any = vec2(local.x.mul(c).sub(local.y.mul(s)), local.x.mul(s).add(local.y.mul(c)));
  const mv: any = cameraViewMatrix.mul(vec4(aPosition, 1));
  material.vertexNode = cameraProjectionMatrix.mul(vec4(mv.xy.add(rotated), mv.z, mv.w));

  // Per-kind masks: soft smoke, tight glow, hard spark, boxed streak.
  const q = uv().mul(2).sub(1);
  const radial = length(q);
  const soft = smoothstep(float(1.0), float(0.15), radial);
  const glowAlpha = pow(soft, float(1.55));
  const spark = pow(max(float(1).sub(radial), float(0)), float(0.8));
  const streak = smoothstep(float(0.92), float(0.6), max(q.x.abs(), q.y.abs()));
  const kind = aExtra.y;
  const alpha = mix(
    mix(soft, glowAlpha, step(float(0.5), kind)),
    mix(spark, streak, step(float(2.5), kind)),
    step(float(1.5), kind),
  );
  material.opacityNode = alpha.mul(aShape.z);
  const shade = uv().y.oneMinus().mul(0.3).add(0.7);
  material.colorNode = aColor.mul(mix(shade, float(1.0), step(float(0.5), kind)));

  const mesh = new T.Mesh(g, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = glow ? 6 : 5;
  return { mesh, arrays, geometry: g, material };
}

export class CombatParticles {
  random = rng(419);
  smoke = new ParticlePool(3600);
  glow = new ParticlePool(1600);
  smokeBatch = batch(3600, false);
  glowBatch = batch(1600, true);
  seen = new Set<string>();
  emitters = new Map<string, { carry: number; previous: IParticle; time: number }>();
  lastTime = 0;
  scene: T.Scene;

  constructor(scene: T.Scene) {
    this.scene = scene;
    scene.add(this.smokeBatch.mesh, this.glowBatch.mesh);
  }

  spread(s = 1): number {
    return (this.random() - 0.5) * s;
  }

  emit(pool: ParticlePool, pos: any, opts: Partial<IParticle> = {}): IParticle {
    return pool.add({ ...pos, rot: this.random() * 6.28, spin: this.spread(0.5), seed: this.random() * 100, ...opts });
  }

  burst(e: any): void {
    const water = e.type === "splash";
    const flak = e.type === "flak";
    const hit = e.type === "hit";
    const muzzle = e.type === "muzzle";
    const size = e.size;
    if (muzzle) {
      this.emit(this.glow, e, { life: 0.1, size: size * 5, kind: 1, color: [2.4, 1.4, 0.52], alpha: 0.9, drag: 3 });
      return;
    }
    const smokeCount = hit ? 2 : flak ? 23 : water ? 12 : 34;
    for (let i = 0; i < smokeCount; i += 1) {
      const angle = this.random() * 6.28;
      const up = water ? this.random() * 18 + 12 : this.random() * 9 + 2;
      const radial = (flak ? 4 : water ? 9 : 11) * size;
      this.emit(this.smoke, { x: e.x + this.spread(size * 2), y: water ? 0.6 : e.y + this.spread(size * 2), z: e.z + this.spread(size * 2) }, {
        vx: Math.cos(angle) * radial * this.random(),
        vy: up * size,
        vz: Math.sin(angle) * radial * this.random(),
        drag: flak ? 1.4 : water ? 0.24 : 0.7,
        gravity: water ? 9.81 : 0,
        buoyancy: water ? 0 : 0.38,
        life: hit ? 0.5 : flak ? 6 + this.random() * 5 : water ? 2 + this.random() * 2 : 8 + this.random() * 7,
        size: (flak ? 2.7 : water ? 2 : 3) * size,
        growth: (flak ? 2.2 : water ? 2.6 : 3.8) * size,
        alpha: flak ? 0.52 : water ? 0.46 : 0.52,
        color: water ? [0.53, 0.68, 0.72] : flak ? [0.026, 0.031, 0.033] : [0.065, 0.067, 0.063],
      });
    }
    if (!water) {
      for (let i = 0; i < (hit ? 8 : flak ? 14 : 40); i += 1) {
        const angle = this.random() * 6.28;
        const v = (hit ? 9 : flak ? 28 : 45) * size;
        this.emit(this.glow, e, {
          vx: Math.cos(angle) * v * this.random(),
          vy: this.spread(v),
          vz: Math.sin(angle) * v * this.random(),
          drag: 0.55,
          gravity: 9.81,
          life: (hit ? 0.16 : flak ? 0.35 : 1.4) + this.random() * 0.5,
          size: (hit ? 0.1 : 0.18) * size,
          aspect: 3.5,
          kind: 2,
          alpha: 1,
          color: [2.6, 1.3, 0.26],
        });
      }
      for (let i = 0; i < (flak ? 3 : hit ? 1 : 15); i += 1)
        this.emit(this.glow, { x: e.x + this.spread(size * 8), y: e.y + this.spread(size * 8), z: e.z + this.spread(size * 8) }, { life: flak ? 0.1 : hit ? 0.08 : 0.25 + this.random() * 0.5, size: (flak ? 13 : hit ? 1 : 12) * size, growth: 9 * size, kind: 1, alpha: 0.85, color: [2.3, 0.8, 0.17], vy: 5, drag: 2 });
      if (!hit && !flak)
        for (let i = 0; i < 10; i += 1)
          this.emit(this.smoke, e, { vx: this.spread(45 * size), vy: (12 + this.random() * 25) * size, vz: this.spread(45 * size), life: 4, drag: 0.1, gravity: 9.81, size: 0.5 * size, aspect: 2, kind: 3, color: [0.04, 0.045, 0.045], alpha: 1, spin: this.spread(9) });
    } else {
      for (let i = 0; i < 22; i += 1)
        this.emit(this.smoke, { x: e.x, y: 0.4, z: e.z }, { vx: this.spread(16) * size, vy: (10 + this.random() * 18) * size, vz: this.spread(16) * size, life: 1.7 + this.random(), gravity: 9.81, drag: 0.17, size: 0.2 * size, aspect: 3.8, growth: 0.22, kind: 2, color: [0.75, 0.85, 0.87], alpha: 0.8 });
    }
  }

  continuous(key: string, pos: any, rate: number, dt: number, emit: (p: any) => void): void {
    let e = this.emitters.get(key);
    if (!e) {
      e = { carry: 0, previous: { ...pos }, time: this.lastTime };
      this.emitters.set(key, e);
    }
    e.carry += rate * dt;
    const n = Math.min(25, Math.floor(e.carry));
    e.carry -= n;
    for (let i = 0; i < n; i += 1) {
      const t = (i + 0.5) / n;
      emit({ x: lerp(e.previous.x, pos.x, t), y: lerp(e.previous.y, pos.y, t), z: lerp(e.previous.z, pos.z, t) });
    }
    e.previous = { ...pos };
    e.time = this.lastTime;
  }

  update(b: any, camera: T.Vector3): void {
    const dt = clamp(b.time - this.lastTime, 0, 0.12);
    this.lastTime = b.time;
    this.smoke.step(dt, b.wind);
    this.glow.step(dt, b.wind);
    for (const e of b.effects) if (!this.seen.has(e.id)) {
      this.seen.add(e.id);
      if (distance3(e, camera) < 18000) this.burst(e);
    }
    if (this.seen.size > 650) this.seen = new Set(b.effects.map((e: any) => e.id));
    for (const a of [...b.aircraft, b.player]) {
      if (!a.damage || a.recovered || a.mode === "service" || a.mode === "spectator") continue;
      const distance = distance3(a, camera);
      if (distance > 11000) continue;
      const detail = distance < 1200 ? 1 : distance < 4000 ? 0.4 : 0.14;
      for (const zone of DAMAGE_ZONES) {
        const d = a.damage[zone];
        const pos = aircraftWorld(a, ZONE_POSITIONS[zone]);
        const vel = { vx: (a.vx || 0) * 0.08, vy: (a.vy || 0) * 0.08 + 1.2, vz: (a.vz || 0) * 0.08 };
        if (d.fire > 0.02 || (a.mode === "crashing" && zone === "engine")) {
          const fire = Math.max(d.fire, 0.25);
          this.continuous(a.id + zone + "smoke", pos, (35 + fire * 20) * detail, dt, (p) => this.emit(this.smoke, p, { ...vel, vx: vel.vx + this.spread(2), vy: vel.vy + 1 + fire, vz: vel.vz + this.spread(2), drag: 0.62, buoyancy: 0.28, life: 7 + this.random() * 4, size: 0.5 + fire * 0.9, growth: 2 + fire * 2, alpha: 0.47, color: [0.04, 0.038, 0.035] }));
          this.continuous(a.id + zone + "fire", pos, 38 * detail, dt, (p) => this.emit(this.glow, p, { vx: (a.vx || 0) * 0.35, vy: (a.vy || 0) * 0.35 + 1, vz: (a.vz || 0) * 0.35, life: 0.1 + this.random() * 0.1, size: 0.8 + fire * 1.5, aspect: 1.2, kind: 1, color: [0.95, 0.22, 0.025], alpha: 0.55, drag: 0.4, growth: 1 }));
        }
        if (d.leak > 0.05) {
          const oil = zone === "engine";
          this.continuous(a.id + zone + "leak", pos, (oil ? 13 : 28) * detail, dt, (p) => this.emit(this.smoke, p, { ...vel, vy: vel.vy - (oil ? 1 : 3), drag: 0.9, gravity: oil ? 1 : 2, life: oil ? 3.8 : 1.7, size: oil ? 0.55 : 0.17, growth: oil ? 1.25 : 0.7, aspect: oil ? 1 : 1.8, alpha: oil ? 0.24 : 0.2, color: oil ? [0.2, 0.24, 0.29] : [0.62, 0.69, 0.68] }));
        }
      }
    }
    for (const s of b.ships) {
      if (s.fire < 0.06 || s.sink > 0.55 || distance3(s, camera) > 18000) continue;
      const detail = distance3(s, camera) < 4000 ? 1 : 0.3;
      for (let j = 0; j < 3; j += 1) {
        const pos = aircraftWorld({ ...s, y: s.y || 0, pitch: 0, roll: 0 }, { x: j === 1 ? 5 : -3, y: s.kind === "carrier" ? 21 : 9, z: (j - 1) * 38 });
        const f = Math.min(s.fire, 1.4);
        this.continuous(s.id + j + "smoke", pos, 8 * detail, dt, (p) => this.emit(this.smoke, p, { vx: 0, vy: 6 + f * 5, vz: 0, drag: 0.18, buoyancy: 0.1, life: 18 + this.random() * 5, size: 6 + f * 5, growth: 3 + f * 2, alpha: 0.48, color: [0.025, 0.028, 0.029] }));
        this.continuous(s.id + j + "flame", pos, 10 * detail, dt, (p) => this.emit(this.glow, { x: p.x + this.spread(6), y: p.y + 2, z: p.z + this.spread(8) }, { vy: 12, life: 0.45 + this.random() * 0.4, size: 8 + f * 7, aspect: 1.5, kind: 1, alpha: 0.6, color: [1.2, 0.3, 0.025], drag: 0.9 }));
      }
    }
    for (const [key, e] of this.emitters) if (b.time - e.time > 2) this.emitters.delete(key);
    this.writeBatch(this.smoke, this.smokeBatch, camera, true);
    this.writeBatch(this.glow, this.glowBatch, camera, false);
  }

  writeBatch(pool: ParticlePool, b: any, camera: T.Vector3, sort: boolean): void {
    const array = sort ? [...pool.items].sort((a, c) => (c.x - camera.x) ** 2 + (c.y - camera.y) ** 2 + (c.z - camera.z) ** 2 - ((a.x - camera.x) ** 2 + (a.y - camera.y) ** 2 + (a.z - camera.z) ** 2)) : pool.items;
    const attrs = b.arrays;
    let count = 0;
    for (const p of array) {
      const k = count * 3;
      const j = count * 4;
      const t = p.age / p.life;
      const fadeIn = Math.min(1, p.age / (p.kind === 1 ? 0.018 : 0.1) + 0.2);
      const fadeOut = clamp((1 - t) * 2.2, 0, 1);
      const size = Math.max(0.02, p.size + p.growth * p.age);
      attrs.aPosition.set([p.x, p.y, p.z], k);
      attrs.aColor.set(p.color, k);
      attrs.aShape.set([size, size * p.aspect, p.alpha * fadeIn * fadeOut, p.rot], j);
      attrs.aExtra.set([p.seed, p.kind, t], k);
      count += 1;
    }
    b.geometry.instanceCount = count;
    for (const a of Object.values(b.geometry.attributes) as any[]) if (a.isInstancedBufferAttribute) a.needsUpdate = true;
  }

  reset(): void {
    this.smoke.clear();
    this.glow.clear();
    this.seen.clear();
    this.emitters.clear();
    this.lastTime = 0;
    this.smokeBatch.geometry.instanceCount = 0;
    this.glowBatch.geometry.instanceCount = 0;
  }

  dispose(): void {
    for (const b of [this.smokeBatch, this.glowBatch]) {
      this.scene.remove(b.mesh);
      b.geometry.dispose();
      b.material.dispose();
    }
  }
}
