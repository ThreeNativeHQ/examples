/** Art-scaled impulse response, superimposed on the ship's navigated pose. */
import { clamp } from "../sim/math.js";

export function shipMotion(ship: any, time: number, heightAt: (x: number, z: number, time: number) => number) {
  const c = Math.cos(ship.heading), s = Math.sin(ship.heading);
  const halfLength = ship.hullLength * .35, halfBeam = ship.hullBeam * .45;
  const fore = heightAt(ship.x + s * halfLength, ship.z - c * halfLength, time);
  const aft = heightAt(ship.x - s * halfLength, ship.z + c * halfLength, time);
  const right = heightAt(ship.x + c * halfBeam, ship.z + s * halfBeam, time);
  const left = heightAt(ship.x - c * halfBeam, ship.z - s * halfBeam, time);
  const pose = { x: 0, y: (fore + aft + right + left) * .25, z: 0,
    pitch: clamp((fore - aft) / (2 * halfLength), -.045, .045),
    roll: clamp((right - left) / (2 * halfBeam), -.065, .065) };
  const impacts = ship.impacts;
  if (impacts) for (const hit of impacts) {
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
  pose.roll = clamp(pose.roll, -.16, .16);
  pose.pitch = clamp(pose.pitch, -.07, .07);
  return pose;
}
