/** The engine's RippleField as a shader source: impacts push chop and leave foam the ocean samples. */
import { RippleField } from "@threenative/core";
import { ClampToEdgeWrapping, DataTexture, DataUtils, HalfFloatType, LinearFilter, RGFormat, Vector2 } from "three";
import { float, smoothstep, texture, uniform } from "three/tsl";
import type { Node } from "three/webgpu";

export function createRipples(): {
  heightNode: (point: Node<"vec2">) => Node<"float">;
  foamNode: (point: Node<"vec2">) => Node<"float">;
  update: (battle: any, camera: { x: number; z: number }, dt: number) => void;
  /** Total disturbance energy; zero on a flat sea. The water gate asserts on this, not on pixels. */
  energy: () => number;
  /** Tallest and deepest metre of disturbance anywhere on the patch, for judging visibility. */
  peak: () => { high: number; low: number };
  reset: () => void;
  dispose: () => void;
} {
  const field = new RippleField({ resolution: 128, size: 900, speed: 22, damping: 0.22, foamHalfLife: 9 });
  const resolution = field.resolution;
  // Half float, not float: WebGPU will not linearly filter an rg32float texture without the
  // optional `float32-filterable` feature, and it does not complain — the sample silently reads
  // nothing, so the sea stays flat while the simulation behind it is moving metres of water.
  // rg16float is filterable everywhere, and a centimetre of precision over a few metres of
  // disturbance is far more than the surface needs.
  const data = new Uint16Array(resolution * resolution * 2);
  const map = new DataTexture(data, resolution, resolution, RGFormat, HalfFloatType);
  map.minFilter = map.magFilter = LinearFilter;
  map.wrapS = map.wrapT = ClampToEdgeWrapping;
  map.needsUpdate = true;
  const center = uniform(new Vector2());
  const size = uniform(field.size);

  const patchUv = (point: Node<"vec2">): any => (point as any).sub(center).div(size).add(0.5);
  // Fade the outer 12% of each axis so the patch has no square edge; zero outside it too.
  const rimMask = (uv: any): any =>
    smoothstep(0, 0.12, uv.x)
      .mul(smoothstep(0, 0.12, uv.x.oneMinus()))
      .mul(smoothstep(0, 0.12, uv.y))
      .mul(smoothstep(0, 0.12, uv.y.oneMinus()));
  const heightNode = (point: Node<"vec2">): Node<"float"> => {
    const uv = patchUv(point);
    // `.level(0)` is load bearing. This node is evaluated in the vertex stage, and WGSL has no
    // implicit derivatives there, so a plain sample is silently dropped: the sea stays perfectly
    // flat while the field behind it is moving five metres of water, with nothing on the console.
    // The fragment-stage foam below needs no such thing, which is why foam appeared and the
    // displacement did not.
    return texture(map, uv).level(float(0)).r.mul(rimMask(uv)) as unknown as Node<"float">;
  };
  const foamNode = (point: Node<"vec2">): Node<"float"> => {
    const uv = patchUv(point);
    return texture(map, uv).g.mul(rimMask(uv)) as unknown as Node<"float">;
  };

  let seen = new Set<string>();
  let uploaded = -1;
  /** Surface disturbances that have not happened yet, soonest last so the tail pops cheaply. */
  let queued: Array<{ at: number; x: number; z: number; radius: number; amplitude: number; foam: number }> = [];
  let clock = 0;

  const update = (battle: any, camera: { x: number; z: number }, dt: number): void => {
    field.recenter(camera.x, camera.z);
    center.value.set(field.centerX, field.centerZ);
    for (const e of battle.effects) {
      if (seen.has(e.id)) continue;
      seen.add(e.id);
      if (Math.abs(e.y) > 60) continue;
      if (e.underwater) {
        // A charge fused to burst below the surface does not move the sea at the instant it goes
        // off. The gas cavity has to reach the surface first, and what the crew see is the column
        // breaking through and then falling back — two disturbances, not one, on the same timeline
        // the audio schedules its concussion and its falling water against.
        queued.push({ at: clock + 0.35, x: e.x, z: e.z, radius: 5 + e.size * 4, amplitude: -30 * Math.sqrt(e.size), foam: 0.6 });
        queued.push({ at: clock + 1.55, x: e.x, z: e.z, radius: 7 + e.size * 5, amplitude: -11 * Math.sqrt(e.size), foam: 0.45 });
      } else if (e.type === "splash") field.impulse(e.x, e.z, 2.5 + e.size * 3, -14 * Math.sqrt(e.size), 0.25 * e.size);
      else if (e.type === "explosion") field.impulse(e.x, e.z, 4 + e.size * 4, -26 * Math.sqrt(e.size), 0.5);
    }
    if (seen.size > 650) seen = new Set(battle.effects.map((e: any) => e.id));
    for (const t of battle.torpedoes) field.depositFoam(t.x, t.z, 3, 0.5 * dt);
    for (const t of battle.airTorpedoes) field.depositFoam(t.x, t.z, 3, 0.5 * dt);
    for (const s of battle.ships) {
      if (s.sunk || (s.kind === "sub" && !s.surfaced) || s.speed < 2) continue;
      field.depositFoam(s.x, s.z, s.hullBeam, 0.35 * dt);
    }
    clock += dt;
    if (queued.length > 0) {
      for (const q of queued) if (q.at <= clock) field.impulse(q.x, q.z, q.radius, q.amplitude, q.foam);
      queued = queued.filter((q) => q.at > clock);
    }
    field.advance(dt);
    if (field.version !== uploaded) {
      for (let i = 0; i < resolution * resolution; i++) {
        data[i * 2] = DataUtils.toHalfFloat(field.height[i]!);
        data[i * 2 + 1] = DataUtils.toHalfFloat(field.foam[i]!);
      }
      map.needsUpdate = true;
      uploaded = field.version;
    }
  };

  return {
    heightNode,
    foamNode,
    update,
    energy: () => field.energy(),
    peak: () => {
      let high = 0;
      let low = 0;
      for (const h of field.height) {
        if (h > high) high = h;
        if (h < low) low = h;
      }
      return { high, low };
    },
    reset: () => {
      field.reset();
      seen.clear();
      queued = [];
      clock = 0;
    },
    dispose: () => map.dispose(),
  };
}
