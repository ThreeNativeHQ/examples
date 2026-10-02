import { type FluidParticles3D, GPUParticles3D } from "@threenative/core";
import * as tsl from "three/tsl";
import { SpriteNodeMaterial } from "three/webgpu";

// quality-allow: TSL nodes are typed per swizzle by three 0.185; this file is arithmetic over them.
// biome-ignore lint/suspicious/noExplicitAny: see above.
type N = any;
const { Fn, If, abs, float, hash, instanceIndex, length, time, uint, vec3 } = tsl as unknown as Record<
  string,
  // biome-ignore lint/suspicious/noExplicitAny: see above.
  any
>;

const FAST = 3.2;
const STEP = 1 / 60;

/**
 * Spray droplets: each one flies ballistically and, when it lands, borrows the position and
 * velocity of a random fluid particle that is moving fast. The look (size, colour) is this file's;
 * the solver only supplies where the water is moving.
 */
export function createSpray(water: FluidParticles3D, amount = 1200): GPUParticles3D {
  const material = new SpriteNodeMaterial({ depthWrite: false, transparent: true });
  material.scaleNode = float(0.045);
  material.colorNode = vec3(0.85, 0.95, 1);
  material.opacityNode = float(0.9);
  return new GPUParticles3D({
    amount,
    material,
    process: ({ positions, velocities }: { positions: N; velocities: N }) =>
      Fn(() => {
        const i = instanceIndex;
        const p = positions.element(i);
        const v = velocities.element(i);
        v.y.subAssign(9.81 * STEP);
        p.addAssign(v.mul(STEP));
        // Landed, or flown out of the tank: take a new particle.
        const lost = p.y.lessThan(0.08).or(abs(p.x).greaterThan(2.9)).or(abs(p.z).greaterThan(1.6));
        If(lost, () => {
          const pick = uint(hash(i.add(uint(time.mul(60)))).mul(water.capacity)).min(water.capacity - 1);
          const source = water.positions.element(pick);
          const motion = water.velocities.element(pick);
          If(source.w.greaterThan(0.5).and(length(motion.xyz).greaterThan(FAST)), () => {
            p.assign(source.xyz);
            v.assign(motion.xyz.mul(1.15));
          }).Else(() => {
            p.assign(vec3(0, -100, 0));
            v.assign(vec3(0));
          });
        });
      })().compute(amount),
    start: ({ positions, velocities }: { positions: N; velocities: N }) =>
      Fn(() => {
        positions.element(instanceIndex).assign(vec3(0, 0, 0));
        velocities.element(instanceIndex).assign(vec3(0));
      })().compute(amount),
  });
}
