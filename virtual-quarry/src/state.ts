export type GameState = {
  /** True once the loader has returned the body and the walk has begun. */
  loaded: boolean;
  /** True when what the loader returned for the dense body is a ClusteredMesh. */
  clustered: boolean;
  frame: number;
  /** The label of the last mark the camera reached. */
  mark: string;
  /** Triangles this frame's render actually submitted. */
  triangles: number;
  /** The largest submission seen since the walk began. */
  peakTriangles: number;
  /** What the body holds, read off the source `.glb` at bake time. */
  sourceTriangles: number;
};
