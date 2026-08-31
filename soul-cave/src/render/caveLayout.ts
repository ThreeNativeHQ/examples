/**
 * Where each imported Unreal mesh sits.
 *
 * These are merged environment chunks straight out of the Fab pack, so their pivots are wherever
 * the original level put them — one is centred on a 74 m block, another sits on its own base. So a
 * piece is placed by an **anchor** rather than a raw transform: the loader measures the mesh and
 * moves it until the named part of its bounding box lands on the anchor. Nothing here scales; the
 * pack is authored in metres and so is the scene.
 */
export type AnchorMode =
  /** Footprint centred on x/z, base sitting on the anchor's y. Pillars, rocks, anything standing. */
  | "base"
  /** Footprint centred on x/z, top hanging at the anchor's y. Ceilings and stalactites. */
  | "top"
  /** Bounding-box centre on the anchor. Walls, where neither end matters. */
  | "centre";

export interface ICavePiece {
  readonly key: string;
  readonly path: string;
  readonly anchor: readonly [number, number, number];
  readonly mode: AnchorMode;
  readonly rotationY?: number;
  readonly castShadow?: boolean;
}

const BASE = "fab/soul-cave/SoulCave/Environment/Meshes";
const MERGED = `${BASE}/Merged`;
const ROCKS = `${BASE}/Rocks`;
const BUILDING = `${BASE}/Building`;

/**
 * The chamber, read off the reference: tall columns receding into the dark, a rock ceiling with a
 * gap the daylight falls through, walls close on both sides, and chains hanging near the camera.
 */
export const CAVE_PIECES: readonly ICavePiece[] = [
  // Columns. The two tall clusters carry the frame; the wide one closes the back of the room.
  { key: "pillarsLeft", path: `${MERGED}/SM_MergedMesh_Cave_Rock_Pillar01REDO_120.glb`, anchor: [-17, 0, -27], mode: "base", rotationY: 0.35 },
  { key: "pillarsRight", path: `${MERGED}/SM_MergedMesh_Cave_Rock_Pillar01REDO_120.glb`, anchor: [18, 0, -31], mode: "base", rotationY: -2.1 },
  { key: "pillarsBack", path: `${MERGED}/SM_MergedMesh_Cave_Rock_Pillar03a_0.glb`, anchor: [1, 0, -45], mode: "base", rotationY: 0.8 },

  { key: "ceiling", path: `${MERGED}/SM_MergedMesh_Cave_Rocks_Stalactite_01_7.glb`, anchor: [-6, 44, -34], mode: "top", rotationY: 0.5, castShadow: true },


  { key: "pillarsMidLeft", path: `${MERGED}/SM_MergedMesh_Cave_Rock_Pillar01REDO_120.glb`, anchor: [-9, 0, -40], mode: "base", rotationY: 2.6 },
  { key: "pillarsMidRight", path: `${MERGED}/SM_MergedMesh_Cave_Rock_Pillar01REDO_120.glb`, anchor: [11, 0, -42], mode: "base", rotationY: -1.1 },
  { key: "pillarsFar", path: `${MERGED}/SM_MergedMesh_Cave_Rock_Pillar03a_0.glb`, anchor: [-19, 0, -40], mode: "base", rotationY: 2.2 },

  // The built colonnade the reference shows half-buried in the rock.
  { key: "colonnade", path: `${BUILDING}/SM_Cave_Pillars_NoFlag.glb`, anchor: [-19, 0, -18], mode: "base", rotationY: -0.25 },
  { key: "stairs", path: `${BUILDING}/SM_Cave_Floor_Stairs_Quarter.glb`, anchor: [20, 0, -20], mode: "base", rotationY: 2.4 },

  // Ceiling detail directly overhead, which is what sells the roof as rock rather than a lid.
  { key: "stalactiteNear", path: `${ROCKS}/SM_Cave_Rocks_Stalactite_01.glb`, anchor: [4, 18.5, -12], mode: "top" },
  { key: "stalactiteFar", path: `${ROCKS}/SM_Cave_Rocks_Stalactite_01.glb`, anchor: [-6, 18.5, -19], mode: "top", rotationY: 1.4 },
  { key: "ceilingRock", path: `${ROCKS}/SM_Cave_Rock_Ceiling.glb`, anchor: [-3, 18.8, -8], mode: "top", rotationY: 0.7 },

  // Foreground silhouettes. The reference hangs chains close to camera on both sides.
  { key: "chainLeft", path: `${BUILDING}/SM_Cave_Chain_02.glb`, anchor: [-5.5, 18.6, -6], mode: "top", rotationY: 0.2 },
  { key: "chainRight", path: `${BUILDING}/SM_Cave_Chain_02.glb`, anchor: [6.5, 18.6, -8], mode: "top", rotationY: -0.5 },
];
