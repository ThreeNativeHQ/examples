/**
 * Everything the walk publishes, and nothing it does not.
 *
 * The loop writes this at frame rate; React and the playtests read it at about 10 Hz. Values are
 * JSON-safe and named the way a person would describe them, because a proof that reads
 * `discovered` and `nearest` says what it checked and one that reads `f3` does not.
 */
export type GameState = {
  /** How many of the five landmarks have been inspected. */
  discovered: number;
  /** How many there are, so the HUD never hard-codes five. */
  landmarkTotal: number;
  /** The journal, in the order they were found. Names, not ids — this is read by a person. */
  journal: string[];
  /** The nearest landmark still to find, or "" once they are all found. */
  nearest: string;
  /** Metres to that landmark, rounded to a tenth. */
  nearestDistance: number;
  /** True while standing close enough that E would do something. */
  canInspect: boolean;
  /** The landmark E would inspect right now, or "". */
  inspectTarget: string;
  /** True once every landmark is in the journal. */
  objectiveComplete: boolean;
  /** Where you are. Published so a proof can show the walk covered real ground. */
  walkerX: number;
  walkerY: number;
  walkerZ: number;
  /** Compass heading in degrees, north at zero. */
  heading: number;
  /** Metres walked since the trailhead. */
  odometer: number;
  /**
   * Feet minus the analytic terrain height under them.
   *
   * The single number that proves the Rapier heightfield and the drawn valley are the same
   * surface. A transposed collider looks correct from above and reads several metres here.
   */
  groundGap: number;
  /** True while the soles are under the waterline. */
  wading: boolean;
  /** What the valley was built out of, for the performance panel and the load proof. */
  treeCount: number;
  fernCount: number;
  boulderCount: number;
  grassCount: number;
  terrainTriangles: number;
  /** True once the valley has finished building. */
  valleyReady: boolean;
  /**
   * What was standing at the instant the loading curtain lifted — the first world the player saw.
   *
   * `treeCount` alone cannot express the defect this measures: by the end of any run the detail
   * tier has landed and the count is high, whether the player watched it pop in or not. These two
   * are sampled once, at the reveal, and never move again, so a proof can assert on the frame the
   * player was actually shown. `-1` means the curtain has not lifted yet.
   */
  revealTreeCount: number;
  revealFernCount: number;
  /** Set from the UI's pause and resume intents, and read back by the menu. */
  paused: boolean;
  /** True once the UI layer has rendered and published its interactive rectangles. */
  uiReady: boolean;
};
