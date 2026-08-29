export type GameState = {
  /** Revenants banished. Six wins the round. */
  banished: number;
  /** Revenants still walking. */
  alive: number;
  /** Distance from the player to the nearest revenant, in metres. */
  nearest: number;
  /** `playing`, `won`, or `lost`. The proof compares against these literals. */
  outcome: string;
  /** Largest camera-shake offset magnitude this round, in metres. */
  shakePeak: number;
  /** Times a revenant's sprite atlas moved to a different frame. Only increases. */
  spriteAdvances: number;
  /** Worst facing of any revenant's billboard after the camera has moved; 1 is square-on. */
  billboardFacingWorst: number;
};
