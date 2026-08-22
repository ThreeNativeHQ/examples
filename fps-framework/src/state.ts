export type Blip = { x: number; z: number; alive: boolean };

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
  /** Player ground position and facing, for the minimap. */
  playerX: number;
  playerZ: number;
  playerYaw: number;
  /** Enemy positions for the minimap, one entry per soldier. */
  blips: Blip[];
};

/** Shared objective contract for the scene and the HUD. */
export const TARGET_GOAL = 12;
