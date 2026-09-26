export type GameState = {
  /** Trees placed in the grove. */
  treeCount: number;
  /** Vertices summed across the generated variants, not across the placed clones. */
  treeVertices: number;
  /** Simulation seconds fed to every tree wind this frame. */
  windTime: number;
  sunAzimuth: number;
  sunElevation: number;
  /** Red channel of the atmosphere's sun transmittance; stays 0 when no atmosphere is built. */
  sunTransmittanceRed: number;
};
