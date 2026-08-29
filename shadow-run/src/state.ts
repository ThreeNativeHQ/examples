export type GameState = {
  /** How lit the runner is, 0 to 100. Reaching 100 loses the round. */
  exposure: number;
  /** True while the sun-ward ray from the runner is blocked by cover. */
  inShadow: boolean;
  /** Metres of the yard crossed, from the near edge toward the door. */
  crossed: number;
  /** `playing`, `home`, or `caught`. The proof compares against these literals. */
  outcome: string;
  /** Triangles the scene BVH has packed. Changes when the shutter moves and it repacks. */
  bvhTriangles: number;
  /** Times the BVH repacked because cover moved. */
  bvhRebuilds: number;
  /** Camera distance, driven by the portable zoom axis. */
  cameraDistance: number;
};
