export type GameState = {
  playerX: number;
  score: number;
  sunAzimuth: number;
  sunElevation: number;
  /** Red channel of the atmosphere's sun transmittance; stays 0 when no atmosphere is built. */
  sunTransmittanceRed: number;
  /** Beacons lit by a pointer tap on the beacon itself. */
  beaconsLit: number;
  /** Beacons the pointer is currently over. */
  beaconsHovered: number;
  /** Every pointerEntered a beacon has received. Cumulative, so a sample cannot miss one. */
  beaconHoverEvents: number;
  /** Camera distance driven by the portable zoom axis (wheel on desktop, pinch on touch). */
  cameraDistance: number;
  /** Largest camera-shake offset magnitude seen so far, in metres. */
  shakePeak: number;
  /** Dot of the nameplate's normal and the direction to the camera; 1 when it faces the camera. */
  billboardFacing: number;
  /**
   * The worst `billboardFacing` seen after the camera has moved away from where it started.
   *
   * Zero until the camera has actually travelled, so a scenario asserting on it cannot pass on a
   * value that was already true before the first step ran.
   */
  billboardFacingWorst: number;
  /** Frame index of the flame atlas, advanced on the fixed step. */
  flameFrame: number;
  /**
   * Times the flame atlas moved to a different frame.
   *
   * A looping index is not a usable assertion target — two samples can land on the same frame and
   * read as "nothing happened". This only ever increases.
   */
  flameAdvances: number;
  /** Fixed steps the game-owned compute field has been dispatched for. */
  computeSteps: number;
  /** Triangles the scene BVH packed into GPU storage. */
  bvhTriangles: number;
};
