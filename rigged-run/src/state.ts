export type GameState = {
  playerX: number;
  score: number;
  sunAzimuth: number;
  sunElevation: number;
  /** Red channel of the atmosphere's sun transmittance; stays 0 when no atmosphere is built. */
  sunTransmittanceRed: number;
  /** 1 once the rigged character is running; the playtest reads it as construction evidence. */
  rigReady: number;
  /** Bones in the loaded character, read back from the runtime skeleton. */
  rigBoneCount: number;
};
