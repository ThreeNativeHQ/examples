export const TAU = Math.PI * 2;
export const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n));
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const wrap = (a: number): number => ((a % TAU) + TAU) % TAU;
export const angleDelta = (a: number, b: number): number =>
  Math.atan2(Math.sin(a - b), Math.cos(a - b));
export const distance2 = (a: { x: number; z: number }, b: { x: number; z: number }): number =>
  Math.hypot(a.x - b.x, a.z - b.z);
export const distance3 = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): number =>
  Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
export const bearing = (a: { x: number; z: number }, b: { x: number; z: number }): number =>
  wrap(Math.atan2(b.x - a.x, -(b.z - a.z)));
export const forward = (h: number, p = 0): { x: number; y: number; z: number } => ({
  x: Math.sin(h) * Math.cos(p),
  y: Math.sin(p),
  z: -Math.cos(h) * Math.cos(p),
});
export function localPoint(
  p: { x: number; z: number },
  s: { x: number; z: number; heading: number },
): { right: number; forward: number } {
  const x = p.x - s.x;
  const z = p.z - s.z;
  return {
    right: x * Math.cos(s.heading) + z * Math.sin(s.heading),
    forward: x * Math.sin(s.heading) - z * Math.cos(s.heading),
  };
}
export function onDeck(
  p: { x: number; z: number },
  s: { x: number; z: number; heading: number; width: number; length: number },
  margin = 0,
): boolean {
  const l = localPoint(p, s);
  return Math.abs(l.right) < s.width / 2 + margin && Math.abs(l.forward) < s.length / 2 + margin;
}
export function segmentDistance(
  a: { x: number; y: number; z: number },
  b: { x: number; y: number; z: number },
  p: { x: number; y: number; z: number },
): number {
  const x = b.x - a.x;
  const y = b.y - a.y;
  const z = b.z - a.z;
  const t = clamp(
    ((p.x - a.x) * x + (p.y - a.y) * y + (p.z - a.z) * z) / (x * x + y * y + z * z || 1),
    0,
    1,
  );
  return Math.hypot(a.x + x * t - p.x, a.y + y * t - p.y, a.z + z * t - p.z);
}
export function bombImpact(
  p: { x: number; y: number; z: number },
  v: { x: number; y: number; z: number },
  height = 0,
): { x: number; z: number; y: number; time: number } {
  const time = Math.max(
    0,
    (v.y + Math.sqrt(v.y * v.y + 2 * 9.81 * Math.max(0, p.y - height))) / 9.81,
  );
  return { x: p.x + v.x * time, z: p.z + v.z * time, y: height, time };
}
export interface IContact {
  id: string;
  name: string;
  kind: string;
  x: number;
  z: number;
  heading: number;
  speed: number;
  time: number;
  confidence: number;
  source?: string;
  reported?: boolean;
}
export function contactEstimate(
  c: IContact,
  time: number,
): IContact & { age: number; uncertainty: number } {
  const age = Math.max(0, time - c.time);
  const d = forward(c.heading);
  return {
    ...c,
    x: c.x + d.x * c.speed * age,
    z: c.z + d.z * c.speed * age,
    age,
    uncertainty: 60 + age * 5,
    confidence: Math.max(0.12, c.confidence * Math.exp(-age / 170)),
  };
}
export function rng(seed = 1): () => number {
  let a = seed >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
