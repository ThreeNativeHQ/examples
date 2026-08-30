export type GameState = {
  characterName: string;
  coyoteJumps: number;
  entityCount: number;
  jumps: number;
  levelX: number;
  lives: number;
  odometer: number;
  /** Set from the UI's pause and resume intents, and read back by the menu. */
  paused: boolean;
  /** Which scene-backed screen the shared UI should show. */
  screen: "menu" | "playing";
  /** True once the UI layer has rendered and published its interactive rectangles. */
  uiReady: boolean;
  peakRise: number;
  playerX: number;
  /** Where the first-person walker actually ended up, after collision resolved. */
  walkerZ: number;
  /** Walker eye height. Rises when the character climbs the chancel steps. */
  walkerY: number;
  /** Walker position across the nave. Passing +-8 means it got through an arcade opening. */
  walkerX: number;
  /**
   * How far the furthest banner hem has travelled from where it was authored, in metres.
   *
   * A screenshot cannot tell a simulated cloth in still air from a static one, so this is
   * the observable that proves the sim runs. Zero forever means `stepCloth` is not being
   * called; a number that grows without bound means the integrator has gone unstable and
   * the banner has left the building.
   */
  bannerSway: number;
  /**
   * Footfalls played since the scene started.
   *
   * Audio's normal failure is a sound that is wired up and never fires, which looks
   * identical to a working one in every capture. This is what a scenario asserts instead.
   */
  footsteps: number;
  respawns: number;
  score: number;
  /** The run: "playing" until the flag is reached ("won") or the last life is gone ("lost"). */
  status: "lost" | "playing" | "won";
};
