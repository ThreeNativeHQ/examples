export type GameState = {
  /** Scene frames run. Compared against oceanSteps to see whether dispatch is keeping up. */
  frames: number;
  /** Whether the startup cover is still opaque, which gates render-cadence compute. */
  layerOpaque: number;
  /** Ocean released itself. */
  oceanReleased: number;
  /** Simulation steps the ocean has dispatched. Zero means no GPU work happened at all. */
  oceanSteps: number;
  /** Height copies that have landed on the CPU. Zero means the raft is floating on nothing. */
  heightSamples: number;
  /**
   * How many frames behind the drawn surface the raft's height is.
   *
   * A spectral ocean cannot answer this exactly, so the number is the contract rather than a
   * defect. The scenario asserts it stays bounded, never that it is zero.
   */
  staleFrames: number;
  /**
   * The highest and lowest surface the raft has ridden, and the span between them.
   *
   * `heightRange` is the assertion that matters. A `sampleHeight` returning any constant — zero,
   * sea level, the last landed value forever — leaves it at exactly 0, and the game becomes
   * unwinnable because nothing ever lifts the raft to the gate.
   */
  crestPeak: number;
  troughFloor: number;
  heightRange: number;
  /**
   * Crest and trough measured only while the raft is inside the beacon ring, and their span.
   *
   * Gated on purpose. The open-sea numbers are already large before the scenario presses a key —
   * the field is fully developed at warmup — so asserting on them proves the sea exists and
   * nothing more. These read exactly zero until the player has steered to the beacon, so they
   * cannot pass without both the steering and the sea that lifts the raft there.
   */
  gateCrest: number;
  gateTrough: number;
  gateRange: number;
  /** Metres the raft has been steered, which separates "the sea moved it" from "the player did". */
  steered: number;
  /** Crest rides that carried the raft over the beacon's gate. The win condition, counted. */
  gatesCleared: number;
  /** A literal the scenario compares against: "playing", "won", or "adrift". */
  outcome: string;
};
