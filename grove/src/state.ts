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
  /** Bark meshes the engine's baked LOD chain is currently drawing below its authored LOD0. */
  lodBarkCoarse: number;
  /** Leaf meshes likewise; the bake refuses an alpha-masked primitive, so this stays 0. */
  lodLeafCoarse: number;
  /** Distinct bark geometries drawn so far: each variant's LOD0 plus every baked level selected. */
  lodBarkGeometries: number;
};
