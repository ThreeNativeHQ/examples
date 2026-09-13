/** Sortie presets and a game-tuned 1942-style straight-running torpedo envelope. */
import { clamp, forward } from "./math.js";

type Any = any;

export interface ILoadout {
  id: string;
  airframe: string;
  name: string;
  description: string;
  bombs: number;
  torpedo: number;
  kind: string;
}

export const LOADOUTS: Record<string, ILoadout> = Object.freeze({
  bomb: {
    id: "bomb",
    airframe: "sbd",
    name: "SBD Dauntless",
    description: "Dive strike · 1 heavy + 2 light bombs",
    bombs: 3,
    torpedo: 0,
    kind: "bomber",
  },
  torpedo: {
    id: "torpedo",
    airframe: "tbd",
    name: "TBD Devastator",
    description: "Torpedo strike · 1 Mark 13",
    bombs: 0,
    torpedo: 1,
    kind: "torpedo",
  },
});

export function applyLoadout(p: Any, id: string): boolean {
  const load = LOADOUTS[id];
  if (!load) return false;
  Object.assign(p, {
    loadout: id,
    airframe: load.airframe,
    kind: id === "torpedo" ? "torpedo" : "bomber",
    bombs: load.bombs,
    torpedo: load.torpedo,
  });
  if (id === "torpedo") {
    p.brakes = false;
    p.brakePos = 0;
  }
  updateStores(p);
  return true;
}

/**
 * Payload mass and drag the flight model reads, derived from the stores actually left on the racks.
 * Call this after every successful release; calling `applyLoadout` instead would replenish them.
 */
export function updateStores(p: Any): void {
  p.payloadMass =
    ((p.bombs ?? 0) >= 3 ? 454 : 0) + Math.min(2, p.bombs ?? 0) * 45 + (p.torpedo ?? 0) * 1000;
  p.payloadDrag = ((p.bombs ?? 0) > 0 ? 0.003 : 0) + ((p.torpedo ?? 0) > 0 ? 0.014 : 0);
}

export function torpedoEnvelope(p: Any): {
  safe: boolean;
  problems: string[];
  maxHeight: number;
  maxSpeed: number;
} {
  const japan = p.team === "jp";
  const speed = p.speed ?? Math.hypot(p.vx || 0, p.vy || 0, p.vz || 0);
  const maxHeight = japan ? 45 : 15.5;
  const maxSpeed = japan ? 88 : 57;
  const problems: string[] = [];
  if (p.y < 5) problems.push("TOO LOW");
  if (p.y > maxHeight) problems.push("TOO HIGH");
  if (speed > maxSpeed) problems.push("TOO FAST");
  if (speed < 35) problems.push("TOO SLOW");
  if (Math.abs(p.roll || 0) > 0.17) problems.push("WINGS NOT LEVEL");
  if (Math.abs(p.pitch || 0) > 0.14) problems.push("LEVEL THE NOSE");
  return { safe: problems.length === 0, problems, maxHeight, maxSpeed };
}

export function torpedoIntercept(
  a: Any,
  target: Any,
  speed = 17.25,
): { x: number; y: number; z: number; time: number } {
  const tf = forward(target.heading);
  const vx = tf.x * target.speed;
  const vz = tf.z * target.speed;
  const dx = target.x - a.x;
  const dz = target.z - a.z;
  const A = vx * vx + vz * vz - speed * speed;
  const B = 2 * (dx * vx + dz * vz);
  const C = dx * dx + dz * dz;
  const disc = B * B - 4 * A * C;
  let t = 0;
  if (disc >= 0 && Math.abs(A) > 1e-7) {
    const roots = [(-B + Math.sqrt(disc)) / (2 * A), (-B - Math.sqrt(disc)) / (2 * A)].filter(
      (v) => v > 0,
    );
    if (roots.length) t = Math.min(...roots);
  } else if (Math.abs(B) > 1e-7) t = -C / B;
  t = clamp(t, 0, 160);
  return { x: target.x + vx * t, y: 0, z: target.z + vz * t, time: t };
}
