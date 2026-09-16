/** Art-scaled impulse response, superimposed on the ship's navigated pose. */
import { OCEAN_BANDS } from "./ocean.js";
import { clamp } from "../sim/math.js";

/**
 * The wave-number weight of each band the sea is built from: `k * amplitude`, the slope a band
 * contributes at the surface. `OCEAN_BANDS` multiplies every amplitude by the same sea state, so
 * the constant cancels in the ratio below and is not carried here. The heights are the same field
 * `probe-ocean.mjs` measures at Hs 1.14 m.
 */
const BAND_WEIGHTS = OCEAN_BANDS.map(([a, kx, kz]) => {
  const k = Math.hypot(kx, kz);
  return { k, weight: k * a };
});
const WEIGHT_SUM = BAND_WEIGHTS.reduce((sum, band) => sum + band.weight, 0);

/**
 * How much of the surface's vertical motion survives at `depth` under water, 0..1.
 *
 * Linear wave theory: a band of wave number `k` carries `exp(-k * depth)` of its surface amplitude
 * down to depth. The bands are summed by the slope weight each contributes, because it is slope —
 * not height — that rocks a hull. This is the whole of "a dived boat is not the swell": at the
 * waterline it is 1, at 9 m under it is 0.39, and at 60 m it is 0.04.
 */
function submergence(depth: number): number {
  if (depth <= 0) return 1;
  let sum = 0;
  for (const band of BAND_WEIGHTS) sum += band.weight * Math.exp(-band.k * depth);
  return sum / WEIGHT_SUM;
}

/** A full dive angle, radians: 23 degrees, inside the 20-30 a boat holds in a deliberate dive. */
const MAX_DIVE_ANGLE = 0.4;

/** The swell pose of one hull: mean heave, fore/aft pitch and beam roll, scaled by `decay`. */
function wavePose(
  ship: any,
  time: number,
  heightAt: (x: number, z: number, time: number) => number,
  decay: number,
) {
  const c = Math.cos(ship.heading), s = Math.sin(ship.heading);
  const halfLength = ship.hullLength * .35, halfBeam = ship.hullBeam * .45;
  const fore = heightAt(ship.x + s * halfLength, ship.z - c * halfLength, time);
  const aft = heightAt(ship.x - s * halfLength, ship.z + c * halfLength, time);
  const right = heightAt(ship.x + c * halfBeam, ship.z + s * halfBeam, time);
  const left = heightAt(ship.x - c * halfBeam, ship.z - s * halfBeam, time);
  return {
    y: (fore + aft + right + left) * .25 * decay,
    pitch: clamp((fore - aft) / (2 * halfLength), -.045, .045) * decay,
    roll: clamp((right - left) / (2 * halfBeam), -.065, .065) * decay,
  };
}

/** The recoil and rocking a real hull impact leaves on the pose. Both hulls share it. */
function impactPose(
  ship: any,
  time: number,
  pose: { x: number; y: number; z: number; pitch: number; roll: number },
  limitPitch: number,
  limitRoll: number,
) {
  const impacts = ship.impacts;
  if (!impacts) return pose;
  const c = Math.cos(ship.heading), s = Math.sin(ship.heading);
  const halfLength = ship.hullLength * .35, halfBeam = ship.hullBeam * .45;
  for (const hit of impacts) {
    const age = time - hit.time;
    if (age < 0 || age > 22 || hit.damage <= 0) continue;
    const power = clamp(hit.damage / 120, 0, 2) * clamp(180 / ship.hullLength, .5, 2);
    const side = clamp(hit.right / halfBeam, -1, 1);
    const end = clamp(hit.forward / halfLength, -1, 1);
    const decay = Math.exp(-age * .3);
    const swing = Math.sin(age * 1.45) * decay * power;
    const shove = (1 - Math.exp(-age * 3)) * Math.exp(-age * .48) * power;
    // A starboard hit pushes the starboard side up first; a port hit reverses it.
    pose.roll += side * swing * .055;
    pose.pitch += end * swing * .018;
    pose.y += Math.sin(age * 2.1) * Math.exp(-age * .55) * power * .38;
    pose.x -= c * side * shove * 1.8 + s * end * shove * .5;
    pose.z -= s * side * shove * 1.8 - c * end * shove * .5;
  }
  pose.roll = clamp(pose.roll, -limitRoll, limitRoll);
  pose.pitch = clamp(pose.pitch, -limitPitch, limitPitch);
  return pose;
}

export function shipMotion(ship: any, time: number, heightAt: (x: number, z: number, time: number) => number) {
  const wave = wavePose(ship, time, heightAt, 1);
  const pose = { x: 0, y: wave.y, z: 0, pitch: wave.pitch, roll: wave.roll };
  return impactPose(ship, time, pose, .07, .16);
}

const DRAUGHT_DEFAULT = 4.6;

/**
 * A submarine's pose, superimposed on its navigated track exactly as `shipMotion` is for a surface
 * hull. Three things distinguish it:
 *
 * - **Depth is keel depth.** `sub.depth` is positive downward from the sea surface to the keel, the
 *   way a boat reports it, and `ship.draught` is the measured keel-to-waterline from `catalog.ts`.
 *   A hull cannot float with its keel above the waterline, so until the depth passes the draught the
 *   boat simply floats (`motion.y` lifts `s.y` back to the surface), and every metre past it sinks
 *   the waterline by a metre. That is what makes periscope depth put the periscope — and nothing
 *   more — at the surface: I-168's keel-to-periscope is the 13.5 m `catalog.ts` measures, so 14 m of
 *   keel depth leaves 0.5 m of it showing.
 * - **The swell fades with depth.** `wavePose` runs on `submergence(depth)` of the surface motion,
 *   so a surfaced boat rides the swell, a periscope bobs at 39 % of it, and a deep boat is still.
 * - **Attitude is the path angle.** A hull points along the water it is travelling through, so a
 *   boat descending at `depthRate` while making `speed` noses down by `atan2(depthRate, speed)` and
 *   comes up bow-first when the rate reverses. `SUB_DIVE_RATE` is 2 m/s, so a surfaced dive is about
 *   12 degrees and a submerged one about 26, capped at 23.
 */
export function submarineMotion(ship: any, time: number, heightAt: (x: number, z: number, time: number) => number) {
  const draught = ship.draught ?? DRAUGHT_DEFAULT;
  const depth = Math.max(0, ship.sub?.depth ?? 0);
  const rate = ship.sub?.depthRate ?? 0;
  const underWater = Math.max(0, depth - draught);
  const decay = submergence(underWater);
  const wave = wavePose(ship, time, heightAt, decay);
  const speed = Math.max(1, ship.speed ?? 0);
  // The path angle only bites once the hull is fully wet and carried by its planes, so it ramps in
  // over the last of the draught the boat has to spend going under. A boat still showing its sail
  // noses down gently; a hull a draught deep is on the full `atan2` angle.
  const trim = clamp(underWater / draught, 0, 1);
  // The waterline sits at `-underWater`; `s.y` is `-depth`, so the boat is lifted by the draught it
  // has not yet spent going under. One expression serves the floating boat and the dived one.
  const pose = {
    x: 0,
    y: Math.min(depth, draught) + wave.y,
    z: 0,
    pitch: wave.pitch + trim * clamp(-Math.atan2(rate, speed), -MAX_DIVE_ANGLE, MAX_DIVE_ANGLE),
    roll: wave.roll,
  };
  return impactPose(ship, time, pose, MAX_DIVE_ANGLE, .16);
}
