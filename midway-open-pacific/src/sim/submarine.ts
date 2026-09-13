/**
 * One submarine's own state: depth, battery, tubes and reloads. Pure records plus pure functions —
 * `Battle` owns every mutation, exactly as it does for a sortie. No ids and no positions live here;
 * a caller supplies its own coordinates, and a hydrophone contact is a bearing only.
 */
import { clamp, wrap } from "./math.js";

export type SubMode = "surfaced" | "periscope" | "deep";

/**
 * `depth` is POSITIVE DOWNWARD, metres, 0 at the surface: 14 means 14 m under the water. The rest of
 * the game treats `y` as positive up, so a submerged boat sits at negative y. Use `subY` for that
 * conversion instead of writing the sign by hand at each site — this is the field read backwards.
 */
export interface SubState {
  depth: number;
  depthRate: number;
  mode: SubMode;
  battery: number;
  tubes: number;
  reloads: number;
  reloadUntil: number;
  lastLook: number;
}

export const SURFACE_DEPTH = 0;
export const PERISCOPE_DEPTH = 14;
export const DEEP_DEPTH = 60;

export const SURFACED_MAX = 9.8;
export const SUBMERGED_MAX = 4.1;
/** A flat battery still leaves steerage way, but no useful attack speed. */
export const CRAWL_SPEED = 1.2;
/** Tubes cannot be fired this deep; the boat must rise to periscope depth. */
export const FIRING_DEPTH_LIMIT = 20;
/** A periscope only pokes above the swell, so its visual horizon is shorter than the bridge's. */
export const PERISCOPE_HORIZON = 4500;

/** Battery units lost per second at 1 m/s submerged. Cubic in speed, so a sprint is expensive. */
const DRAIN_PER_CUBIC = 6e-6;

const MODE_DEPTH: Record<SubMode, number> = {
  surfaced: SURFACE_DEPTH,
  periscope: PERISCOPE_DEPTH,
  deep: DEEP_DEPTH,
};

export function depthFor(mode: SubMode): number {
  return MODE_DEPTH[mode];
}

/**
 * Move toward the wanted mode's depth at `rate` m/s without overshooting, and claim the new mode
 * only once the hull is actually within a metre of it. A boat is not at periscope depth because the
 * order was given; it is at periscope depth when the depth gauge says so.
 */
export function stepDepth(state: SubState, wanted: SubMode, dt: number, rate: number): SubState {
  const target = MODE_DEPTH[wanted];
  const delta = target - state.depth;
  const move = Math.min(Math.abs(delta), Math.max(0, rate) * Math.max(0, dt));
  const depth = state.depth + Math.sign(delta) * move;
  const depthRate = dt > 0 ? (depth - state.depth) / dt : 0;
  const mode = Math.abs(depth - target) <= 1 ? wanted : state.mode;
  return { ...state, depth, depthRate, mode };
}

/** Surfaced boats make their speed on diesels; submerged boats are slower and live on the battery. */
export function maxSpeed(state: SubState): number {
  if (state.mode === "surfaced") return SURFACED_MAX;
  if (state.battery <= 0) return CRAWL_SPEED;
  return SUBMERGED_MAX;
}

/** Battery spent over `dt` at `speed`. Surfaced running charges nothing; submerged is cubic in speed. */
export function batteryDrain(state: SubState, speed: number, dt: number): number {
  if (state.mode === "surfaced") return 0;
  const s = Math.max(0, speed);
  return s * s * s * DRAIN_PER_CUBIC * Math.max(0, dt);
}

/** A deep boat sees nothing visually; the periscope has the shortest horizon of the three modes. */
export function canSee(state: SubState, targetRange: number, visibility: number): boolean {
  if (state.mode === "deep") return false;
  const horizon = state.mode === "periscope" ? Math.min(visibility, PERISCOPE_HORIZON) : visibility;
  return targetRange <= horizon;
}

export interface HydrophoneContact {
  bearing: number;
  uncertainty: number;
}

/**
 * A hull hydrophone gives a line of bearing, nothing else. It cannot measure range and it cannot
 * identify a target, so this never returns either: range and identity need a second sensor or a
 * look through the periscope. A target quieter than the noise floor is not heard at all.
 */
export function hydrophoneBearing(
  selfX: number,
  selfZ: number,
  targetX: number,
  targetZ: number,
  targetSpeed: number,
  noiseFloor: number,
  r01: number,
): HydrophoneContact | null {
  if (targetSpeed <= noiseFloor) return null;
  const trueBearing = wrap(Math.atan2(targetX - selfX, -(targetZ - selfZ)));
  const snr = (targetSpeed - noiseFloor) / Math.max(noiseFloor, 1e-3);
  const uncertainty = clamp(0.04 + 0.45 / (1 + snr) + 0.1 * r01, 0.04, 1.2);
  const error = (clamp(r01, 0, 1) - 0.5) * uncertainty;
  return { bearing: wrap(trueBearing + error), uncertainty };
}

export interface FireCheck {
  ok: boolean;
  reason: string;
}

/** Tubes left, no reload in progress, and shallow enough for the torpedoes to run. */
export function canFire(state: SubState, now: number): FireCheck {
  if (state.mode === "deep" || state.depth > FIRING_DEPTH_LIMIT) return { ok: false, reason: "too deep" };
  if (now < state.reloadUntil) return { ok: false, reason: "reloading" };
  if (state.tubes <= 0) return { ok: false, reason: "no tubes" };
  return { ok: true, reason: "" };
}

/** Fire one tube; the last tube consumes a spare load and starts its reload clock. */
export function applyFire(state: SubState, now: number, reloadSeconds: number): SubState {
  if (state.tubes <= 0) return state;
  const tubes = state.tubes - 1;
  if (tubes > 0 || state.reloads <= 0) return { ...state, tubes };
  return { ...state, tubes, reloads: state.reloads - 1, reloadUntil: now + reloadSeconds };
}

/**
 * Constant-bearing intercept: find the sub's heading and time-of-flight to collide with a target
 * moving on `tgtHeading` at `tgtSpeed`. Null is the normal answer — a carrier at speed opens the
 * bearing faster than a submerged boat can close it, and no heading gets there.
 */
export function interceptCourse(
  subX: number,
  subZ: number,
  subSpeed: number,
  tgtX: number,
  tgtZ: number,
  tgtHeading: number,
  tgtSpeed: number,
): { heading: number; time: number } | null {
  const dx = tgtX - subX;
  const dz = tgtZ - subZ;
  const vtx = Math.sin(tgtHeading) * tgtSpeed;
  const vtz = -Math.cos(tgtHeading) * tgtSpeed;
  const pv = dx * vtx + dz * vtz;
  const pp = dx * dx + dz * dz;
  const a = subSpeed * subSpeed - tgtSpeed * tgtSpeed;
  const b = -2 * pv;
  const c = -pp;
  let time: number | null = null;
  if (Math.abs(a) < 1e-9) {
    if (Math.abs(b) < 1e-9) return null;
    const root = -c / b;
    if (root > 0) time = root;
  } else {
    const disc = b * b - 4 * a * c;
    if (disc < 0) return null;
    const sq = Math.sqrt(disc);
    const roots = [(-b + sq) / (2 * a), (-b - sq) / (2 * a)].filter((t) => t > 0).sort((x, y) => x - y);
    if (roots.length) time = roots[0];
  }
  if (time === null || !Number.isFinite(time)) return null;
  const aimX = tgtX + vtx * time;
  const aimZ = tgtZ + vtz * time;
  return { heading: wrap(Math.atan2(aimX - subX, -(aimZ - subZ))), time };
}

/**
 * A depth charge in the water. `y` is POSITIVE UP everywhere in the game, so a charge below the
 * surface has negative y. That is the opposite of `SubState.depth`; use `subY` to convert a boat's
 * depth once, at the comparison, rather than mixing the two sign conventions.
 */
export interface DepthCharge {
  x: number;
  y: number;
  z: number;
  presetDepth: number;
  sinkRate: number;
  armed: boolean;
}

export function subY(state: SubState): number {
  return -state.depth;
}

/** Sink until the fuse's preset depth, then detonate. `armed` means the charge has gone off. */
export function stepCharge(charge: DepthCharge, dt: number): DepthCharge {
  if (charge.armed) return charge;
  const y = charge.y - Math.max(0, charge.sinkRate) * Math.max(0, dt);
  if (-y >= charge.presetDepth) return { ...charge, y: -charge.presetDepth, armed: true };
  return { ...charge, y };
}

/** Falloff from the charge to the target in three dimensions; zero at or beyond the lethal radius. */
export function chargeDamage(
  charge: DepthCharge,
  targetX: number,
  targetY: number,
  targetZ: number,
  lethalRadius: number,
): number {
  if (lethalRadius <= 0) return 0;
  const d = Math.hypot(charge.x - targetX, charge.y - targetY, charge.z - targetZ);
  return clamp(1 - d / lethalRadius, 0, 1);
}
