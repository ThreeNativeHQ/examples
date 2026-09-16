/**
 * One torpedo's run, from release to hit or miss. The weapon is **straight-running**: `release`
 * fixes its heading once and nothing here ever changes it, so a target that turns escapes and there
 * is no homing anywhere in this file. Every speed, range, running depth, arming distance and
 * reliability figure comes from ./armament.ts; this module never restates them.
 *
 * The hit test is the reason the file exists. A point sample at each step boundary can step clean
 * over a thin hull and a torpedo can run under a shallow one, so `sweptHit` tests the segment the
 * torpedo covered against the hull the ship moved through over the same step, and compares the
 * running depth against that hull's draught.
 */
import { actualRunDepth, releaseLegal, torpedoVariant, type TorpedoVariant } from "./armament.js";
import { bearing, forward, localPoint } from "./math.js";

/**
 * The release-time stamp `./sortie.ts` relies on. `sortieId`, `designatedTarget` and `orderedWing`
 * are copied from the launcher verbatim and never recomputed, so a later recall or retask can
 * neither revoke nor grant this weapon's credit.
 */
export interface TorpedoRun {
  id: string;
  variantId: string;
  x: number;
  y: number;
  z: number;
  heading: number;
  speed: number;
  runDepth: number;
  /**
   * m of run at which the exploder became live, or null while it is still unarmed. A weapon that
   * strikes inside this is a dud, not a detonation.
   */
  armedAt: number | null;
  distanceRun: number;
  sortieId: number;
  designatedTarget: string | null;
  orderedWing: boolean;
}

/** The releasing platform. `depth` is the depth set on the weapon, positive down. */
export interface TorpedoLauncher {
  x: number;
  y: number;
  z: number;
  heading: number;
  speed: number;
  /** m below the surface, positive down. Defaults to the variant's shallowest setting. */
  depth?: number;
  /** Release-time stamp, copied through untouched. */
  sortieId: number;
  designatedTarget: string | null;
  orderedWing: boolean;
}

/** Where the weapon is pointed. Only the initial bearing is used, so `release` can take the point
 * `torpedoIntercept` already computes; the run never looks at it again. */
export interface TorpedoAim {
  x: number;
  z: number;
}

/** The hull fields the swept test needs. `draught` is the class draught from ./catalog.ts. */
export interface TorpedoShip {
  id: string;
  x: number;
  z: number;
  heading: number;
  speed?: number;
  hullLength: number;
  hullBeam: number;
  draught: number;
  sunk?: boolean;
  /** The side that owns the hull. `screenIntercept` skips the run's own side when it is given. */
  team?: string;
}

export interface TorpedoHit {
  hit: boolean;
  depthOk: boolean;
  reason: string;
}

export interface TorpedoReliabilityResult {
  ran: boolean;
  detonated: boolean;
  reason: string;
}

/**
 * Fire a torpedo, or return null when the release is outside the variant's envelope. The envelope
 * is the variant's own `release` band, checked by ./armament.ts so a drop and a tube shot share one
 * gate. The weapon keeps the heading from `aim` for its whole run — no homing, ever.
 */
export function release(
  variant: TorpedoVariant,
  launcher: TorpedoLauncher,
  aim: TorpedoAim,
  now: number,
): TorpedoRun | null {
  const legal = releaseLegal(variant.id, { altitude: launcher.y, speed: launcher.speed });
  if (!legal.legal) return null;
  const setting = variant.settings[0];
  const runDepth = actualRunDepth(variant.id, launcher.depth ?? variant.runDepth.min);
  return {
    id: `${variant.id}:${now}`,
    variantId: variant.id,
    x: launcher.x,
    y: -runDepth,
    z: launcher.z,
    heading: bearing(launcher, aim),
    speed: setting.speed,
    runDepth,
    armedAt: null,
    distanceRun: 0,
    sortieId: launcher.sortieId,
    designatedTarget: launcher.designatedTarget,
    orderedWing: launcher.orderedWing,
  };
}

/**
 * Advance the run one step. Motion is straight at the carried speed and stops at the end of the
 * variant's range, so `distanceRun` never exceeds the range and the run expires there. The exploder
 * arms once the run distance reaches the variant's arming distance. Returns a new record; the input
 * is never mutated.
 */
export function stepRun(run: TorpedoRun, dt: number): TorpedoRun {
  const variant = torpedoVariant(run.variantId);
  const setting = variant.settings.find((s) => s.speed === run.speed) ?? variant.settings[0];
  const remaining = Math.max(0, setting.range - run.distanceRun);
  const step = Math.min(Math.max(0, run.speed) * Math.max(0, dt), remaining);
  const f = forward(run.heading);
  const distanceRun = run.distanceRun + step;
  const armedAt = run.armedAt ?? (distanceRun >= variant.armingDistance ? variant.armingDistance : null);
  return {
    ...run,
    x: run.x + f.x * step,
    y: run.y,
    z: run.z + f.z * step,
    distanceRun,
    armedAt,
  };
}

/** A hull that is not afloat cannot be hit by anything. */
function live(ship: TorpedoShip | null | undefined): ship is TorpedoShip {
  return !!ship && !ship.sunk;
}

/**
 * Where the torpedo sits in the hull's own frame, relative to hull motion. The ship translates
 * during the step, so the torpedo's start is measured from where the ship **was**, its end from
 * where the ship **is**; heading rotation over one fixed step is small and ignored.
 */
function crossingEntry(
  run: TorpedoRun,
  prevPos: { x: number; z: number },
  ship: TorpedoShip,
  dt: number,
): number | null {
  const f = forward(ship.heading);
  const travel = (ship.speed ?? 0) * dt;
  const startFrame = { x: ship.x - f.x * travel, z: ship.z - f.z * travel, heading: ship.heading };
  const a = localPoint(prevPos, startFrame);
  const b = localPoint(run, ship);
  return segmentRectEntry(a, b, ship.hullBeam / 2, ship.hullLength / 2);
}

/**
 * Slab clip of a 2D segment against a rectangle centred on the origin, returning the entry
 * parameter in [0, 1] or null. This is what makes the test swept: both endpoints of a fast step can
 * sit outside a thin hull while the segment between them passes through it.
 */
function segmentRectEntry(
  a: { right: number; forward: number },
  b: { right: number; forward: number },
  halfRight: number,
  halfForward: number,
): number | null {
  let lo = 0;
  let hi = 1;
  const axes: Array<["right" | "forward", number]> = [
    ["right", halfRight],
    ["forward", halfForward],
  ];
  for (const [key, extent] of axes) {
    const d = b[key] - a[key];
    if (Math.abs(d) < 1e-9) {
      if (Math.abs(a[key]) > extent) return null;
      continue;
    }
    let u = (-extent - a[key]) / d;
    let v = (extent - a[key]) / d;
    if (u > v) [u, v] = [v, u];
    lo = Math.max(lo, u);
    hi = Math.min(hi, v);
    if (lo > hi) return null;
  }
  return hi >= 0 && lo <= 1 ? Math.max(0, lo) : null;
}

/**
 * Did the torpedo hit this hull during the step? The test is the swept segment against the hull the
 * ship moved through, plus the running depth against the hull's draught: a torpedo running deeper
 * than the target draws passes under it. Plan uses the waterline beam, not the flight deck's
 * overhang, because the weapon is under the surface. A hull with no recorded draught is treated as
 * zero and survives rather than taking a phantom hit.
 */
export function sweptHit(
  run: TorpedoRun,
  prevPos: { x: number; z: number },
  ship: TorpedoShip,
  dt: number,
): TorpedoHit {
  if (!live(ship)) return { hit: false, depthOk: false, reason: "no target" };
  const depthOk = run.runDepth <= ship.draught;
  const crossed = crossingEntry(run, prevPos, ship, dt) !== null;
  if (!crossed) return { hit: false, depthOk, reason: "miss" };
  if (!depthOk) return { hit: false, depthOk, reason: "under" };
  return { hit: true, depthOk, reason: "hit" };
}

/**
 * Which hull the step actually strikes, escort or target, or null for a clean miss. The PRD rule:
 * a shallow destroyer alongside a carrier must not be hit automatically before every deeper-running
 * torpedo reaches the carrier. So an escort is **only** hit when the swept path crosses its hull
 * *and* the running depth is within its draught; a deeper weapon runs under it and carries on to
 * whatever lies beyond. The earliest crossing along the step wins.
 */
export function screenIntercept(
  run: TorpedoRun,
  prevPos: { x: number; z: number },
  escorts: TorpedoShip[],
  target: TorpedoShip | null,
  dt: number,
  team?: string,
): string | null {
  let best: string | null = null;
  let bestT = Infinity;
  const consider = (ship: TorpedoShip | null | undefined) => {
    if (!live(ship)) return;
    // A run never screens against its own side. Without this a boat that fires from its own hull
    // finds itself in the sweep and detonates on the tube it just left.
    if (team !== undefined && ship.team === team) return;
    if (run.runDepth > ship.draught) return; // runs under this hull, so it cannot screen
    const t = crossingEntry(run, prevPos, ship, dt);
    if (t !== null && t < bestT) {
      bestT = t;
      best = ship.id;
    }
  };
  for (const escort of escorts ?? []) consider(escort);
  consider(target);
  return best;
}

/**
 * Does this release run true and detonate? `r01` is the caller's 0..1 draw; the threshold is the
 * variant's own `reliability.runs`. This is a **seeded game approximation with stated provenance**
 * (see `TorpedoReliability.provenance` in ./armament.ts), not a historical per-shot probability. An
 * unarmed run can pass the roll and still not detonate, which is why `ran` and `detonated` differ.
 */
export function reliabilityRoll(
  variant: TorpedoVariant,
  run: TorpedoRun,
  r01: number,
): TorpedoReliabilityResult {
  if (!(r01 < variant.reliability.runs)) {
    return { ran: false, detonated: false, reason: "dud: failed to run" };
  }
  if (run.armedAt === null) {
    return { ran: true, detonated: false, reason: "running true but not yet armed" };
  }
  return { ran: true, detonated: true, reason: "ran true and detonated" };
}
