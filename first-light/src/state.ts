export type GameState = {
  /** How golden the sunlight is right now, 0-100, derived from the atmosphere's transmittance. */
  warmth: number;
  /** Sun elevation in radians, straight from solarPosition. */
  sunElevation: number;
  /** Red channel of the sky radiance the dome is drawing. Zero without an atmosphere. */
  skyRadianceRed: number;
  /** Signal mirrors fired. Three is all you get. */
  shots: number;
  /** True while the runner is standing on the spur the mirror aims from. */
  onSpur: boolean;
  /** `playing`, `signalled`, or `missed`. The proof compares against these literals. */
  outcome: string;
  /** Warmth of the best shot taken, or 0 if none has been fired. */
  bestShot: number;
  sunDiscY: number;
  sunDiscZ: number;
};
