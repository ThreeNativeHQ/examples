export type GameState = {
  /**
   * Blades cut, as the GPU's own atomic counter reported them.
   *
   * The win condition. It starts at zero, rises only because the player drove somewhere, and
   * cannot be produced without the million-candidate pass actually running: nothing on the CPU
   * knows which blades fell, or how many.
   */
  cutTotal: number;
  standingNow: number;
  standingSamples: number;
  /** Candidates the field was built with. The PRD's number, read back from the running game. */
  candidateCount: number;
  /** Reset and cull dispatches. Reset must lead, every frame. */
  resetDispatches: number;
  cullDispatches: number;
  /** True while the geometry still carries the compute-written indirect buffer. */
  indirectBound: number;
  /**
   * Candidate records the CPU wrote. Must stay exactly zero.
   *
   * A million blades touched per frame on the CPU is the failure this whole design exists to
   * avoid, and it would still render correctly — just slowly — so nothing but this number says so.
   */
  cpuCandidateWrites: number;
  /**
   * Blades standing this frame, as the GPU's atomic counter reported them.
   *
   * The win condition reads this. A constant here — the candidate count, the last value, zero —
   * makes the game unwinnable, because there is no other way to know the field has been cut.
   */
  standing: number;
  /** The most and fewest blades ever seen standing, and the span between them. */
  standingPeak: number;
  standingFloor: number;
  standingDrop: number;
  /** Metres driven. Separates "the field changed" from "the player changed it". */
  driven: number;
  /** A literal the scenario compares against: "harvesting" or "cleared". */
  outcome: string;
};
