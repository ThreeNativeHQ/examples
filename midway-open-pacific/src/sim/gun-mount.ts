/**
 * Rear flexible gun geometry, measured from the shipped `weapon.rear-gun.glb` and its export
 * evidence. Pure data and pure functions: no Three.js, no DOM, so the sim, the renderer and the
 * checks all read one set of hinge, muzzle and obstruction numbers.
 *
 * The gun asset is `tools/blender/normalize-rear-gun.py`'s output: the cradle hinge is the glTF
 * origin and the two barrels run down glTF +Z, which is the game's own +Z (aft). The muzzle tips
 * below are the export's `muzzle_mouths_output_gltf` landmarks in that frame.
 */

/** The hinge and the two muzzle mouths of one airframe's rear gun, in the airframe's own frame. */
export interface RearGunMount {
  /**
   * The cradle hinge in the airframe frame (+x right, +y up, +z aft), gun at rest. Derived from the
   * seated station plus the shared hinge offset `REAR_GUN_HINGE`, both measured.
   */
  pivot: readonly [number, number, number];
  /** Muzzle mouth tips relative to the hinge, gun rest frame. Index 0 = lower, 1 = upper barrel. */
  mouths: readonly [readonly [number, number, number], readonly [number, number, number]];
}

/**
 * The cradle hinge relative to the seated gunner's station origin, in the station's own frame.
 * Root's approved live fit: the old `[0, 1.22, 0.85]` was out of arm reach; this puts the grips
 * under the baked hand pose. Shared by the Douglas and the TBD.
 */
export const REAR_GUN_HINGE: readonly [number, number, number] = [0, 1.12, 0.55];

/** Muzzle mouths from the export evidence, in the gun's rest frame (barrels down +Z). */
const MOUTHS: readonly [readonly [number, number, number], readonly [number, number, number]] = [
  [-0.091054, 0, 0.481435],
  [0.091053, 0, 0.473657],
];

/**
 * Where each airframe's gun hinge sits in the aircraft frame. These are the station origins plus
 * `REAR_GUN_HINGE`: the Douglas gunner station is `[0, -0.26, -0.55]` and the TBD's is
 * `[-0.003, -0.055, 0.686]`, both measured from the seated rig. `scripts/check-aircraft.mjs`
 * asserts the built pivot against this table, so the drawn gun and the fired round cannot drift.
 */
export const REAR_GUN_MOUNTS: Readonly<Record<string, RearGunMount>> = Object.freeze({
  sbd: { pivot: [0, 0.86, 0], mouths: MOUTHS },
  tbd: { pivot: [-0.003, 1.065, 1.236], mouths: MOUTHS },
});

/** The mount for an airframe, or null where the type has no rear gun. */
export function rearGunMountFor(airframe: string | undefined): RearGunMount | null {
  return (airframe && REAR_GUN_MOUNTS[airframe]) || null;
}

/**
 * One muzzle tip in the airframe frame, after the gun's own yaw and pitch. `R = Ry(yaw)·Rx(-pitch)`
 * is exactly the pivot rotation the renderer applies (`rearGunPivotEuler`), so the drawn barrel and
 * the fired round leave the same mouth. Angles are the airframe's: positive yaw swings the muzzle to
 * the aircraft's starboard (+X), which is the gunner's left because he faces aft; the manned
 * station's input is mapped to his own screen-right, not to +X. Pitch positive is upward.
 */
export function rearGunMuzzle(
  mount: RearGunMount,
  barrel: number,
  yaw: number,
  pitch: number,
): [number, number, number] {
  const [mx, my, mz] = mount.mouths[barrel & 1]!;
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  // Rx(-pitch) then Ry(yaw), matching Three's YXZ Euler with (x=-pitch, y=yaw, z=0).
  const y1 = cp * my + sp * mz;
  const z1 = -sp * my + cp * mz;
  return [cy * mx + sy * z1, y1, -sy * mx + cy * z1];
}

/**
 * The fin box a rear-gun round must not pass through, in the airframe frame. The bounds are the
 * **measured** vertical-tail extents of each shipped airframe, not a convenience offset:
 *
 * - SBD: `aircraft.douglas-sbd3.glb`'s fin and rudder meshes, transformed by `createDouglas`
 *   (span 12.66 m, +Y 0.35). The fin slab is only ±0.04 m thick; the two barrels sit at x = ±0.091,
 *   so a dead-astern level round **straddles the fin and is genuinely clear**. The guard only
 *   refuses a round yawed toward the centreline that enters that thin band.
 * - TBD: `devastator.ts`'s `vertical_stabilizer`/`rudder` (fin extrude depth 0.12, bevel 0.025 →
 *   half-thickness 0.085), so its barrels also straddle the fin.
 *
 * The bottom is the fin's real root, not a line drawn above the barrel to let level shots through.
 */
export interface RearGunTailBox {
  /** Forward extent of the fin's leading edge, from the airframe origin. */
  z: number;
  /** Aft reach of the box (to the rudder's trailing edge) past `z`. */
  reach: number;
  /** Half the fin's measured thickness along X. */
  halfWidth: number;
  /** Measured bottom of the fin slab. */
  base: number;
  /** Measured top of the fin. */
  top: number;
}

export const REAR_GUN_TAIL: Readonly<Record<string, RearGunTailBox>> = Object.freeze({
  // SBD fin+rudder: x ±0.04, y 0.47–2.31, z 1.18–4.94 (GLB words, createDouglas frame).
  sbd: { z: 1.18, reach: 3.76, halfWidth: 0.04, base: 0.47, top: 2.31 },
  // TBD fin+rudder: half-thickness 0.085, y 0.10–2.66, z 3.33–5.55 (devastator.ts, -PI/2 yaw frame).
  tbd: { z: 3.33, reach: 2.22, halfWidth: 0.085, base: 0.1, top: 2.66 },
});

/** The fin box for an airframe, or null where none is recorded. */
export function rearGunTailBoxFor(airframe: string | undefined): RearGunTailBox | null {
  return (airframe && REAR_GUN_TAIL[airframe]) || null;
}

/**
 * True when the round from `origin` along unit `dir` (both airframe-local) would cross the fin
 * box. Slab test against a finite box; a hit means the shot is refused rather than fired through
 * the aircraft's own tail.
 */
export function rearGunHitsOwnTail(
  box: RearGunTailBox,
  origin: readonly [number, number, number],
  dir: readonly [number, number, number],
): boolean {
  const lo = [-box.halfWidth, box.base, box.z];
  const hi = [box.halfWidth, box.top, box.z + box.reach];
  let tmin = -Infinity;
  let tmax = Infinity;
  for (let axis = 0; axis < 3; axis += 1) {
    const d = dir[axis]!;
    if (Math.abs(d) < 1e-6) {
      if (origin[axis]! < lo[axis]! || origin[axis]! > hi[axis]!) return false;
      continue;
    }
    let t0 = (lo[axis]! - origin[axis]!) / d;
    let t1 = (hi[axis]! - origin[axis]!) / d;
    if (t0 > t1) [t0, t1] = [t1, t0];
    tmin = Math.max(tmin, t0);
    tmax = Math.min(tmax, t1);
    if (tmin > tmax) return false;
  }
  return tmax >= 0;
}
