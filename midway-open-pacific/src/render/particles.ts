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
  mx_noise_float,
  positionLocal,
  pow,
  sin,
  smoothstep,
  step,
  uv,
  vec2,
  vec3,
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
  // Foam (kind 6) is a patch ON the sea, so its quad lies in world XZ and keeps its shape from
  // every angle; a billboard would stand the patch up like a wall when seen from a beam. Both
  // kinds take the same single transform and differ only in which frame the rotated corner is
  // added in — world for the patch, view for everything else.
  const lying: any = step(float(5.5), aExtra.y);
  const world: any = vec3(rotated.x, float(0), rotated.y).mul(lying);
  const view: any = rotated.mul(float(1).sub(lying));
  const mv: any = cameraViewMatrix.mul(vec4(aPosition.add(world), 1));
  material.vertexNode = cameraProjectionMatrix.mul(vec4(mv.xy.add(view), mv.z, mv.w));

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
  const shade = uv().y.oneMinus().mul(0.3).add(0.7);
  // Ship smoke (4) and flame (5) have their own surface; flashes, spray and aircraft
  // trails retain their masks. The seed and age were already uploaded for every particle.
  const flow = vec3(q.mul(2.3), aExtra.x.add(aExtra.z.mul(2)));
  const billow = mx_noise_float(flow);
  const detail = mx_noise_float(flow.mul(2.9).add(17));
  const density = float(1).sub(radial).add(billow.mul(0.65)).add(detail.mul(0.18));
  const smoke = smoothstep(0.02, 0.55, density).mul(smoothstep(1, 0.72, radial));
  const smokeShade = billow.mul(0.65).add(detail.mul(0.22)).add(uv().y.mul(0.35)).add(0.65);
  const height = uv().y;
  const flameFlow = vec3(q.x.mul(3), height.mul(3).sub(aExtra.z.mul(6)), aExtra.x);
  const curl = mx_noise_float(flameFlow);
  const wisps = mx_noise_float(flameFlow.mul(2.7));
  const heat = height.oneMinus().mul(0.85)
    .sub(q.x.add(curl.mul(height).mul(0.6)).abs().mul(0.65))
    .add(curl.mul(0.65)).add(wisps.mul(0.2));
  const flame = smoothstep(0.08, 0.4, heat)
    .mul(smoothstep(0, 0.1, height)).mul(smoothstep(1, 0.8, height))
    .mul(smoothstep(1, 0.78, q.x.abs()));
  // Kind 5 alone is flame: kind 6 sits above it and must not inherit the fire ramp.
  const isFlame = step(float(4.5), kind).sub(step(float(5.5), kind));
  const isFoam = step(float(5.5), kind);
  // Foam is a ragged disc, brightest where the water is still churning.
  const foam = smoothstep(float(1.0), float(0.25), radial.sub(billow.mul(0.22)).sub(detail.mul(0.1)));
  const shipMask = mix(mix(smoke, flame, isFlame), foam, isFoam);
  // FIRE_COLOR / FIRE_ALPHA from the engine VFX gallery's render/archivePresets.ts.
  // Reuse the authored fire curves in this game's existing batches, at carrier scale.
  const age = aExtra.z;
  let flameColor = mix(vec3(1, 0.957, 0.749), vec3(1, 0.945, 0.541), age.div(0.12).clamp(0, 1));
  flameColor = mix(flameColor, vec3(1, 0.612, 0.184), age.sub(0.12).div(0.33).clamp(0, 1));
  flameColor = mix(flameColor, vec3(1, 0.294, 0.071), age.sub(0.45).div(0.37).clamp(0, 1));
  flameColor = mix(flameColor, vec3(0.322, 0.078, 0), age.sub(0.82).div(0.18).clamp(0, 1));
  let flameFade = mix(float(0), float(0.55), age.div(0.08).clamp(0, 1));
  flameFade = mix(flameFade, float(1), age.sub(0.08).div(0.1).clamp(0, 1));
  flameFade = mix(flameFade, float(0.92), age.sub(0.18).div(0.52).clamp(0, 1));
  flameFade = mix(flameFade, float(0), age.sub(0.7).div(0.3).clamp(0, 1));
  flameColor = flameColor.mul(mix(0.65, 1.8, smoothstep(0.15, 0.8, heat)));
  const foamColor = aColor.mul(billow.mul(0.22).add(detail.mul(0.1)).add(0.88));
  const shipColor = mix(mix(aColor.mul(smokeShade), flameColor, isFlame), foamColor, isFoam);
  const isShip = step(3.5, kind);
  material.opacityNode = mix(alpha, shipMask, isShip).mul(aShape.z).mul(mix(1, flameFade, isFlame));
  material.colorNode = mix(aColor.mul(mix(shade, float(1.0), step(0.5, kind))), shipColor, isShip);

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
      this.emit(this.glow, e, { life: 0.045, size: size * 0.7, kind: 1, color: [1.5, 0.85, 0.32], alpha: 0.65, drag: 0 });
      return;
    }
    if (water) {
      return;
    }
    const smokeCount = hit ? 2 : flak ? 23 : 34;
    for (let i = 0; i < smokeCount; i += 1) {
      const angle = this.random() * 6.28;
      const radial = (flak ? 4 : 11) * size;
      this.emit(this.smoke, { x: e.x + this.spread(size * 2), y: e.y + this.spread(size * 2), z: e.z + this.spread(size * 2) }, {
        vx: Math.cos(angle) * radial * this.random(),
        vy: (this.random() * 9 + 2) * size,
        vz: Math.sin(angle) * radial * this.random(),
        drag: flak ? 1.4 : 0.7,
        gravity: 0,
        buoyancy: 0.38,
        life: hit ? 0.5 : flak ? 6 + this.random() * 5 : 8 + this.random() * 7,
        size: (flak ? 2.7 : 3) * size,
        growth: (flak ? 2.2 : 3.8) * size,
        alpha: flak ? 0.52 : 0.52,
        color: flak ? [0.026, 0.031, 0.033] : [0.065, 0.067, 0.063],
      });
    }
    {
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
        // A hurt engine smokes before it burns: a radial with holed cylinders trails grey-blue
        // exhaust smoke, thinner and paler than a fire's near-black column. Without this the
        // wingman's "smoke coming from your engine" was a call about nothing.
        if (zone === "engine" && d.integrity < 0.8 && d.fire <= 0.02) {
          const hurt = Math.min(1, (0.8 - d.integrity) / 0.7);
          // Rate is set against the aircraft's own speed, not by eye: at ninety metres a second a
          // trail needs a puff every metre or it reads as a string of separate blobs.
          this.continuous(a.id + "enginesmoke", pos, (70 + hurt * 90) * detail, dt, (p) => this.emit(this.smoke, p, { ...vel, vx: vel.vx + this.spread(1.1), vy: vel.vy + 0.4 + hurt, vz: vel.vz + this.spread(1.1), drag: 0.7, buoyancy: 0.22, life: 3.6 + hurt * 2.4, size: 0.62 + hurt * 0.7, growth: 2.2 + hurt * 1.8, alpha: 0.3 + hurt * 0.16, color: [0.09, 0.09, 0.088] }));
        }
        if (d.leak > 0.05) {
          const oil = zone === "engine";
          // Fuel from a holed tank atomises into the slipstream: a pale vapour streamer off the
          // wing that hangs for a couple of seconds, not the near-invisible drip this used to be.
          // Oil stays heavy and dark, and falls away instead of trailing.
          const leak = Math.min(1, d.leak);
          const rate = oil ? 13 : 60 + leak * 120;
          this.continuous(a.id + zone + "leak", pos, rate * detail, dt, (p) => this.emit(this.smoke, p, { ...vel, vx: vel.vx + (oil ? 0 : this.spread(0.7)), vy: vel.vy - (oil ? 1 : 0.6), vz: vel.vz + (oil ? 0 : this.spread(0.7)), drag: oil ? 0.9 : 0.72, gravity: oil ? 1 : 0.35, life: oil ? 3.8 : 2.4, size: oil ? 0.55 : 0.3 + leak * 0.34, growth: oil ? 1.25 : 2.4, aspect: oil ? 1 : 1.35, alpha: oil ? 0.24 : 0.15 + leak * 0.11, color: oil ? [0.2, 0.24, 0.29] : [0.78, 0.82, 0.84] }));
        }
      }
    }
    for (const s of b.ships) {
      if (s.fire < 0.06 || s.sink > 0.55 || distance3(s, camera) > 18000) continue;
      const detail = distance3(s, camera) < 4000 ? 1 : 0.3;
      const hits = (s.impacts || []).filter((h: any) => h.nearMiss !== true).sort((a: any, c: any) => c.time - a.time).slice(0, 3);
      const origins = hits.length
        ? hits.map((h: any) => ({ x: h.right, y: h.height, z: -h.forward }))
        : [0, 1, 2].map((k) => ({ x: k === 1 ? 5 : -3, y: s.kind === "carrier" ? 21 : 9, z: (k - 1) * 38 }));
      for (let j = 0; j < origins.length; j += 1) {
        const pos = aircraftWorld({ ...s, y: s.y || 0, pitch: 0, roll: 0 }, origins[j]);
        const f = Math.min(s.fire, 1.4);
        // Burning oil is near black where it leaves the ship and only greys out as it thins,
        // so the colour is picked from the source end of that range and the shader's own
        // height and noise shading carry it lighter up the column.
        this.continuous(s.id + j + "smoke", pos, 5 * detail, dt, (p) => {
          const grey = 0.028 + this.random() * 0.03;
          this.emit(this.smoke, { x: p.x + this.spread(6), y: p.y + 5, z: p.z + this.spread(6) }, {
            vx: this.spread(5), vy: 10 + f * 5 + this.random() * 4, vz: this.spread(5),
            drag: 0.16, buoyancy: 0.32, life: 18 + this.random() * 6,
            size: 7 + f * 4, growth: 2.8 + this.random() * 1.8, aspect: 0.85 + this.random() * 0.4,
            kind: 4, alpha: 0.55, color: [grey * 0.92, grey * 0.97, grey], spin: this.spread(0.16),
          });
        });
        // Steam off flooded and hosed compartments: white, faster up, gone sooner. It stands
        // beside the oil column rather than mixing with it, which is what the photographs show.
        this.continuous(s.id + j + "steam", pos, 1.6 * detail, dt, (p) => {
          this.emit(this.smoke, { x: p.x + this.spread(16), y: p.y + 2, z: p.z + this.spread(16) }, {
            vx: this.spread(4), vy: 13 + this.random() * 6, vz: this.spread(4),
            drag: 0.22, buoyancy: 0.5, life: 9 + this.random() * 4,
            size: 6 + this.random() * 4, growth: 3.6 + this.random() * 2, aspect: 0.9,
            kind: 4, alpha: 0.3, color: [0.62, 0.66, 0.68], spin: this.spread(0.14),
          });
        });
        this.continuous(s.id + j + "flame", pos, 16 * detail, dt, (p) => {
          const size = 3 + f + this.random() * 4;
          // Normal blending keeps overlapping tongues orange and lets smoke obscure them.
          this.emit(this.smoke, { x: p.x + this.spread(10), y: p.y + size * 0.65, z: p.z + this.spread(14) }, {
            vx: this.spread(3), vy: 4 + this.random() * 5, vz: this.spread(3),
            life: 0.5 + this.random() * 0.65, size, aspect: 1.4 + this.random() * 0.8,
            kind: 5, alpha: 0.9, color: [1.25, 0.095, 0.004], drag: 0.4,
            rot: this.spread(0.3), spin: this.spread(0.25), growth: -1.5,
          });
        });
      }
    }
    for (const [key, e] of this.emitters) if (b.time - e.time > 2) this.emitters.delete(key);
  }

  /**
   * Repack both draw buffers for the camera about to be drawn. The engine calls this once per actual
   * world draw through `ctx.beforeRender`, so the simulation runs at fixed step while the buffers
   * follow the draw. An own mesh `onBeforeRender` would disable whole-scene batching; this does not.
   */
  prepare(camera: T.Vector3): void {
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
      const fadeIn = p.kind === 5 ? 1 : Math.min(1, p.age / (p.kind === 1 ? 0.018 : 0.1) + 0.2);
      const fadeOut = p.kind === 5 ? 1 : clamp((1 - t) * 2.2, 0, 1);
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
