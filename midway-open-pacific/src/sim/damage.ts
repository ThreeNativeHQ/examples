/** Local component damage and contact-only wheel dynamics. No renderer dependency. */
import { clamp, TAU } from "./math.js";
import type { IFlightState } from "@threenative/core";

export const DAMAGE_ZONES = ["engine", "leftWing", "rightWing", "tail", "fuselage"] as const;
export type DamageZone = (typeof DAMAGE_ZONES)[number];

export const ZONE_POSITIONS: Record<DamageZone, { x: number; y: number; z: number }> = Object.freeze({
  engine: { x: 0, y: 0, z: -3.7 },
  leftWing: { x: -2.5, y: -0.1, z: -0.1 },
  rightWing: { x: 2.5, y: -0.1, z: -0.1 },
  tail: { x: 0, y: 0.1, z: 3.7 },
  fuselage: { x: 0, y: 0.1, z: 0.7 },
});

export interface IDamagePart {
  integrity: number;
  fire: number;
  leak: number;
}

export interface IDamageState {
  engine: IDamagePart;
  leftWing: IDamagePart;
  rightWing: IDamagePart;
  tail: IDamagePart;
  fuselage: IDamagePart;
}

export function initDamage(a: any): IDamageState {
  a.damage = Object.fromEntries(
    DAMAGE_ZONES.map((k) => [k, { integrity: 1, fire: 0, leak: 0 }]),
  ) as unknown as IDamageState;
  a.engineCut = false;
  a.lastAttacker = null;
  return a.damage;
}

export function poseAxes(a: any): { r: any; u: any; f: any } {
  let q = a.attitude;
  if (!q) {
    const h = -(a.heading || 0) / 2;
    const p = (a.pitch || 0) / 2;
    const r = (a.roll || 0) / 2;
    const cp = Math.cos(p);
    const sp = Math.sin(p);
    const ch = Math.cos(h);
    const sh = Math.sin(h);
    const cr = Math.cos(r);
    const sr = Math.sin(r);
    q = {
      x: sp * ch * cr + cp * sh * sr,
      y: cp * sh * cr - sp * ch * sr,
      z: cp * ch * sr - sp * sh * cr,
      w: cp * ch * cr + sp * sh * sr,
    };
  }
  const { x, y, z, w } = q;
  return {
    r: { x: 1 - 2 * (y * y + z * z), y: 2 * (x * y + z * w), z: 2 * (x * z - y * w) },
    u: { x: 2 * (x * y - z * w), y: 1 - 2 * (x * x + z * z), z: 2 * (y * z + x * w) },
    f: { x: -2 * (x * z + y * w), y: -2 * (y * z - x * w), z: -(1 - 2 * (x * x + y * y)) },
  };
}

export function aircraftLocal(a: any, p: any): { x: number; y: number; z: number } {
  const b = poseAxes(a);
  const x = p.x - a.x;
  const y = p.y - a.y;
  const z = p.z - a.z;
  return {
    x: x * b.r.x + y * b.r.y + z * b.r.z,
    y: x * b.u.x + y * b.u.y + z * b.u.z,
    z: -(x * b.f.x + y * b.f.y + z * b.f.z),
  };
}

export function aircraftWorld(a: any, p: any): { x: number; y: number; z: number } {
  const b = poseAxes(a);
  return {
    x: a.x + b.r.x * p.x + b.u.x * p.y - b.f.x * p.z,
    y: a.y + b.r.y * p.x + b.u.y * p.y - b.f.y * p.z,
    z: a.z + b.r.z * p.x + b.u.z * p.y - b.f.z * p.z,
  };
}

export function aircraftHit(a: any, start: any, end: any): any {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const dz = end.z - start.z;
  const len2 = dx * dx + dy * dy + dz * dz;
  const u =
    len2 > 1e-12 ? clamp(((a.x - start.x) * dx + (a.y - start.y) * dy + (a.z - start.z) * dz) / len2, 0, 1) : 0;
  if (
    (start.x + dx * u - a.x) ** 2 + (start.y + dy * u - a.y) ** 2 + (start.z + dz * u - a.z) ** 2 >
    100
  )
    return null;
  const p = aircraftLocal(a, start);
  const q = aircraftLocal(a, end);
  const sx = a.airframe === "tbd" ? 1.19 : a.kind === "fighter" ? 0.82 : 1;
  const zones: [string, number, number, number, number, number, number][] = [
    ["engine", 0, 0, -3.2, 0.86, 0.85, 1.35],
    ["leftWing", -3.25, -0.1, -0.2, 3.18 * sx, 0.39, 1.3],
    ["rightWing", 3.25, -0.1, -0.2, 3.18 * sx, 0.39, 1.3],
    ["tail", 0, 0.18, 3.9, 2.27, 0.75, 1.0],
    ["fuselage", 0, 0.12, 0.1, 0.74, 0.98, 3.45],
  ];
  let hit: any = null;
  for (const [zone, cx, cy, cz, rx, ry, rz] of zones) {
    const x = (p.x - cx) / rx;
    const y = (p.y - cy) / ry;
    const z = (p.z - cz) / rz;
    const ddx = (q.x - p.x) / rx;
    const ddy = (q.y - p.y) / ry;
    const ddz = (q.z - p.z) / rz;
    const A = ddx * ddx + ddy * ddy + ddz * ddz;
    const B = 2 * (x * ddx + y * ddy + z * ddz);
    const C = x * x + y * y + z * z - 1;
    const disc = B * B - 4 * A * C;
    if (A < 1e-12 || disc < 0) continue;
    const t = C <= 0 ? 0 : (-B - Math.sqrt(disc)) / (2 * A);
    if (t < 0 || t > 1 || (hit && hit.t < t)) continue;
    hit = {
      zone,
      t,
      point: {
        x: start.x + (end.x - start.x) * t,
        y: start.y + (end.y - start.y) * t,
        z: start.z + (end.z - start.z) * t,
      },
    };
  }
  return hit;
}

export function applyAircraftHit(
  a: any,
  amount: number,
  zone: DamageZone = "fuselage",
  random: () => number = Math.random,
  incendiary = true,
): any {
  if (a.hp <= 0 || !Number.isFinite(amount) || amount <= 0) return null;
  const d = a.damage || initDamage(a);
  const part = d[zone] || d.fuselage;
  const max = a.maxHp || 100;
  part.integrity = clamp(
    part.integrity - amount / (max * (zone === "engine" ? 0.68 : zone === "fuselage" ? 1.5 : 0.82)),
    0,
    1,
  );
  a.hp = Math.max(0, a.hp - amount);
  if (zone === "leftWing" || zone === "rightWing" || zone === "fuselage") {
    if (part.integrity < 0.85)
      part.leak = Math.max(part.leak, (1 - part.integrity) * (zone === "fuselage" ? 0.38 : 0.75));
    if (incendiary && part.integrity < 0.78 && a.fuel > 0 && random() < 0.34 + part.leak * 0.24)
      part.fire = Math.min(1, Math.max(0.12, part.fire) + (amount / max) * 0.65);
  } else if (zone === "engine") {
    part.leak = Math.max(part.leak, 1 - part.integrity);
    if (incendiary && part.integrity < 0.75 && random() < 0.4)
      part.fire = Math.min(1, part.fire + 0.18 + (amount / max) * 0.45);
  }
  if (d.engine.integrity < 0.06) a.engineCut = true;
  if (d.leftWing.integrity < 0.035 || d.rightWing.integrity < 0.035 || d.tail.integrity < 0.025) a.hp = 0;
  return { zone, killed: a.hp <= 0, fire: part.fire, leak: part.leak };
}

export function damageModifiers(a: any): {
  power: number;
  lift: number;
  drag: number;
  roll: number;
  controls: number;
} {
  const d = a.damage;
  if (!d) return { power: 1, lift: 1, drag: 0, roll: 0, controls: 1 };
  return {
    power: a.engineCut ? 0 : clamp((d.engine.integrity - 0.04) / 0.96, 0, 1),
    lift: 0.25 + 0.375 * (d.leftWing.integrity + d.rightWing.integrity),
    drag: (2 - d.leftWing.integrity - d.rightWing.integrity) * 0.031 + (1 - d.fuselage.integrity) * 0.018,
    roll: (d.leftWing.integrity - d.rightWing.integrity) * 0.014,
    controls: 0.2 + 0.8 * d.tail.integrity,
  };
}

export function stepDamage(a: any, dt: number): void {
  if (!a.damage || a.hp <= 0 || dt <= 0) return;
  if (dt > 0.1) {
    const n = Math.ceil(dt / 0.1);
    for (let i = 0; i < n; i += 1) stepDamage(a, dt / n);
    return;
  }
  const d = a.damage;
  let totalLeak = 0;
  let totalFire = 0;
  for (const zone of DAMAGE_ZONES) {
    const p = d[zone];
    if (zone !== "engine") totalLeak += p.leak;
    if (p.fire > 0) {
      const starved = a.fuel <= 0 || (zone === "engine" && a.engineCut);
      p.fire = clamp(p.fire + dt * (starved ? -0.12 : p.leak * 0.023 + 0.0015), 0, 1);
      p.integrity = Math.max(0, p.integrity - p.fire * dt * 0.003);
      totalFire += p.fire;
    }
  }
  const capacity = a.id === "player" ? 100 : a.fuelCapacity || 600;
  a.fuel = Math.max(0, a.fuel - dt * (totalLeak * 0.46 + totalFire * 0.12) * (capacity / 100));
  a.hp = Math.max(0, a.hp - dt * totalFire * 0.9);
  if (d.engine.integrity < 0.06) a.engineCut = true;
  if (d.leftWing.integrity < 0.035 || d.rightWing.integrity < 0.035 || d.tail.integrity < 0.025) a.hp = 0;
}

export function damageSummary(a: any): string[] {
  if (!a.damage) return [];
  const out: string[] = [];
  const names: Record<DamageZone, string> = {
    engine: "ENGINE",
    leftWing: "PORT WING",
    rightWing: "STARBOARD WING",
    tail: "TAIL",
    fuselage: "FUSELAGE",
  };
  for (const key of DAMAGE_ZONES) {
    const d = a.damage[key];
    if (d.fire > 0.06) out.push(`${names[key]} FIRE`);
    else if (d.integrity < 0.45) out.push(`${names[key]} DAMAGED`);
  }
  if (["leftWing", "rightWing", "fuselage"].some((z) => a.damage[z].leak > 0.08)) out.push("FUEL LEAK");
  if (a.damage.engine.leak > 0.2) out.push("OIL LEAK");
  if (a.engineCut) out.push("ENGINE OFF");
  return out;
}

export function stepWheels(p: IFlightState, dt: number): void {
  if (!Number.isFinite(dt) || dt <= 0) return;
  const contact = (p as any).mode === "deck" || (p as any).mode === "arrest";
  if (contact) (p as any).wheelOmega = Math.max(0, (p.deckSpeed || 0) / 0.35);
  else if ((p as any).mode === "service") (p as any).wheelOmega = 0;
  else
    (p as any).wheelOmega =
      ((p as any).wheelOmega || 0) * Math.exp(-dt * ((p.gearPos ?? 1) < 0.65 ? 3.2 : 0.64));
  if ((p as any).wheelOmega < 0.02) (p as any).wheelOmega = 0;
  (p as any).wheelAngle = ((((p as any).wheelAngle || 0) + (p as any).wheelOmega * dt) % TAU + TAU) % TAU;
}
