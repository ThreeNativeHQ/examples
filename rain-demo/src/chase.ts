/**
 * Storm Chaser: the round this demo adds on top of the Tempest study.
 *
 * Log a reading at two survey lamps along the coast road, then reach the field station before the
 * clock runs out. Lightning is the threat: a strike within `DANGER_METRES` while you are out in the
 * open costs one nerve, and a lamp post is shelter. Three nerves, 75 seconds. Pure game rules — no
 * engine, no renderer — so the whole round is checkable without a browser.
 */

export interface IWaypoint {
  readonly label: string;
  readonly x: number;
  readonly z: number;
  /** How close, on the ground, counts as being there. */
  readonly radius: number;
}

/** The two survey lamps (the study's first two luminaires) and the field station. */
export const WAYPOINTS: readonly IWaypoint[] = [
  { label: "Survey lamp 1", radius: 6, x: -8.2, z: -10 },
  { label: "Survey lamp 2", radius: 6, x: -9.09, z: -48 },
  // In front of the station door, so the round ends looking at it rather than inside its walls.
  { label: "Field station", radius: 5, x: -15, z: -66 },
];

/** The six lamp posts, every 38 m down the road: standing under one is shelter. */
export const SHELTERS: readonly { readonly x: number; readonly z: number }[] = [
  { x: -8.2, z: -10 },
  { x: -9.09, z: -48 },
  { x: -9.75, z: -86 },
  { x: -10.04, z: -124 },
  { x: -9.82, z: -162 },
  { x: -8.02, z: -200 },
];
export const SHELTER_RADIUS = 5;
/** Above this altitude you are not under a lamp, whatever its distance on the ground. */
export const SHELTER_CEILING = 9;
/** A strike this close, in metres, is felt; the thunder arrives under ~1.5 s. */
export const DANGER_METRES = 500;
export const ROUND_SECONDS = 75;
export const NERVE = 3;

export type ChasePhase = "playing" | "won" | "lost";

export interface IChase {
  phase: ChasePhase;
  /** Index of the next waypoint; equal to `WAYPOINTS.length` once the round is won. */
  next: number;
  timeLeft: number;
  nerve: number;
  /** Metres to the next waypoint on the ground, for the HUD. */
  distance: number;
  sheltered: boolean;
  /** Close strikes taken in the open this round. */
  hits: number;
  reason: "" | "station" | "time" | "nerve";
}

export function startChase(): IChase {
  return {
    distance: 0,
    hits: 0,
    nerve: NERVE,
    next: 0,
    phase: "playing",
    reason: "",
    sheltered: false,
    timeLeft: ROUND_SECONDS,
  };
}

const ground = (x: number, z: number, p: { x: number; z: number }): number =>
  Math.hypot(x - p.x, z - p.z);

export function isSheltered(position: { x: number; y: number; z: number }): boolean {
  return (
    position.y <= SHELTER_CEILING &&
    SHELTERS.some((lamp) => ground(position.x, position.z, lamp) <= SHELTER_RADIUS)
  );
}

/** One simulation step: the clock runs down and reaching the next waypoint advances the route. */
export function stepChase(
  chase: IChase,
  dt: number,
  position: { x: number; y: number; z: number },
): IChase {
  if (chase.phase !== "playing") return chase;
  const next = { ...chase, sheltered: isSheltered(position) };
  const target = WAYPOINTS[next.next];
  if (target !== undefined && ground(position.x, position.z, target) <= target.radius) {
    next.next += 1;
    if (next.next === WAYPOINTS.length) {
      next.phase = "won";
      next.reason = "station";
      next.distance = 0;
      return next;
    }
  }
  next.timeLeft = Math.max(0, chase.timeLeft - Math.max(0, dt));
  const ahead = WAYPOINTS[next.next];
  next.distance = ahead === undefined ? 0 : ground(position.x, position.z, ahead);
  if (next.timeLeft === 0) {
    next.phase = "lost";
    next.reason = "time";
  }
  return next;
}

/** A strike `metres` from the player: costs a nerve when close and the player is in the open. */
export function strikeChase(chase: IChase, metres: number, sheltered: boolean): IChase {
  if (chase.phase !== "playing" || sheltered || !(metres <= DANGER_METRES)) return chase;
  const nerve = chase.nerve - 1;
  return {
    ...chase,
    hits: chase.hits + 1,
    nerve,
    ...(nerve <= 0 ? { phase: "lost" as const, reason: "nerve" as const } : {}),
  };
}
