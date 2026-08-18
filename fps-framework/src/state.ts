export type GameState = {
  aiming: boolean;
  ammo: number;
  distanceMoved: number;
  health: number;
  hitFlash: number;
  phase: "playing" | "complete" | "failed";
  reloads: number;
  reserve: number;
  score: number;
  shots: number;
  targetsHit: number;
  timeRemaining: number;
};

/** Shared objective contract for the scene and the HUD. */
export const TARGET_GOAL = 12;
