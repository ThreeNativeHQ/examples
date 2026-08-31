/**
 * Where each imported Unreal mesh sits.
 *
 * These are environment chunks straight out of the Fab pack, so their pivots are wherever the
 * original level put them — one is centred on a 74 m block, another sits on its own base. So a
 * piece is placed by an **anchor** rather than a raw transform: the loader measures the mesh and
 * moves it until the named part of its bounding box lands on the anchor. Nothing here scales; the
 * pack is authored in metres and so is the scene.
 *
 * Every `path` is copied from `assets/fab/soul-cave/import-report.json`, which is the authority for
 * where the importer put a mesh. Hand-typing them put a pillar under `Rocks/` that lives under
 * `Building/`, and the scene failed closed on a missing manifest entry.
 */
export type AnchorMode =
  /** Footprint centred on x/z, base sitting on the anchor's y. Anything standing. */
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
  /** Tipping a stalactite on its side is how the pack's rock becomes fallen rubble. */
  readonly rotationX?: number;
  readonly rotationZ?: number;
  readonly castShadow?: boolean;
}

const MESHES = "fab/soul-cave/SoulCave/Environment/Meshes";
const BUILDING = `${MESHES}/Building`;
const ROCKS = `${MESHES}/Rocks`;
const MERGED = `${MESHES}/Merged`;
const NATURE = `${MESHES}/Nature`;

/**
 * The chamber, read off the reference: a gilded arch shrine raised at the far end, broken columns
 * leading up to it, cave rock closing in on both sides, rubble and standing water underfoot, and
 * chains hanging out of the dark overhead.
 */
export const CAVE_PIECES: readonly ICavePiece[] = [
  // The hero, built in three parts as the reference has it: a raised plinth, a gilded arch
  // standing on it, and the robed figure hanging inside the arch where the shaft lands.
  { key: "shrinePlinth", path: `${BUILDING}/SM_Cave_Floor_Stairs_Quarter.glb`, anchor: [1, 0, -21], mode: "base", rotationY: 0.8 },
  { key: "shrineArch", path: `${BUILDING}/SM_Cave_Pillars_NoFlag.glb`, anchor: [1, 2.4, -24], mode: "base", rotationY: 1.45 },
  { key: "shrineFigure", path: `${BUILDING}/SM_S_Soul_Statue.glb`, anchor: [-2, 0.62, -17], mode: "base", rotationY: 0.35 },
  { key: "archFragments", path: `${BUILDING}/SM_Cave_Arches.glb`, anchor: [-16, 0, -44], mode: "base", rotationY: 0.6 },

  // Cave rock closing in on both sides, near enough to frame the shot.
  { key: "rockLeft", path: `${MERGED}/SM_MergedMesh_Cave_Rock_Pillar01REDO_120.glb`, anchor: [-27, 0, -20], mode: "base", rotationY: 1.1 },
  { key: "rockRight", path: `${MERGED}/SM_MergedMesh_Cave_Rock_Pillar01REDO_120.glb`, anchor: [28, 0, -26], mode: "base", rotationY: -1.9 },
  { key: "rockBack", path: `${MERGED}/SM_MergedMesh_Cave_Rock_Pillar03a_0.glb`, anchor: [-4, 0, -56], mode: "base", rotationY: 0.7 },
  { key: "rockMassLeft", path: `${ROCKS}/SM_Cave_Rock_Large02.glb`, anchor: [-21, 0, -14], mode: "base", rotationY: 0.5 },
  { key: "rockMassRight", path: `${ROCKS}/SM_Cave_Rock_Large01_REDO.glb`, anchor: [21, 0, -18], mode: "base", rotationY: -0.8 },

  // Broken columns. The reference has a row of stumps walking away from camera on the left.
  { key: "columnA", path: `${BUILDING}/SM_Cave_Rock_Pillar01REDO.glb`, anchor: [-11, 0, -18], mode: "base", rotationY: 0.3 },
  { key: "columnTall", path: `${BUILDING}/SM_Cave_Rock_Pillar03b.glb`, anchor: [-15, 0, -30], mode: "base", rotationY: 1.5 },
  { key: "columnB", path: `${BUILDING}/SM_Cave_Rock_Pillar_Broken01a.glb`, anchor: [-6, 0, -22], mode: "base", rotationY: 1.2 },
  { key: "columnC", path: `${BUILDING}/SM_Cave_Rock_PillarTop.glb`, anchor: [-11, 0, -27], mode: "base", rotationY: 2.4 },
  { key: "columnD", path: `${BUILDING}/SM_Cave_Rock_PillarBottom.glb`, anchor: [-4, 0, -30], mode: "base", rotationY: 1.9 },
  { key: "columnE", path: `${BUILDING}/SM_Cave_Rock_Pillar_Broken01a.glb`, anchor: [12, 0, -28], mode: "base", rotationY: 0.6 },
  { key: "columnFallen", path: `${BUILDING}/SM_Cave_Rock_PillarBroken01b.glb`, anchor: [7, 0, -20], mode: "base", rotationY: 2.1 },

  // Statues flanking the shrine, as the reference has.
  { key: "statueLeft", path: `${BUILDING}/SM_Cave_Statue_01.glb`, anchor: [-6, 0.4, -23], mode: "base", rotationY: 0.4 },
  { key: "statueRight", path: `${BUILDING}/SM_Cave_Statue_Torso.glb`, anchor: [10, 0.4, -26], mode: "base", rotationY: -0.7 },

  // Stalactites out of the dark overhead.
  { key: "stalactiteA", path: `${ROCKS}/SM_Cave_Rocks_Stalactite_01.glb`, anchor: [-2, 18.6, -12], mode: "top", rotationY: 0.9 },
  { key: "stalactiteB", path: `${ROCKS}/SM_Cave_Rocks_Stalactite_02.glb`, anchor: [6, 18.6, -16], mode: "top", rotationY: 2.2 },
  { key: "stalactiteC", path: `${ROCKS}/SM_Cave_Rocks_Stalactite_01.glb`, anchor: [13, 18.6, -9], mode: "top", rotationY: 1.5 },
  { key: "ceilingRock", path: `${ROCKS}/SM_Cave_Rock_Ceiling.glb`, anchor: [-8, 18.8, -7], mode: "top", rotationY: 0.7 },

  // Chains, hanging near camera on both sides.
  { key: "chainLeft", path: `${BUILDING}/SM_Cave_Chain_02.glb`, anchor: [-8, 18.6, -6], mode: "top", rotationY: 0.2 },
  { key: "chainRight", path: `${BUILDING}/SM_Cave_Chain_02.glb`, anchor: [9, 18.6, -10], mode: "top", rotationY: -0.5 },

  // Fallen rock. The reference's floor is strewn with broken blocks catching the light.
  { key: "debrisA", path: `${ROCKS}/SM_Cave_Rocks_Stalactite_01.glb`, anchor: [-7, 0, -5], mode: "base", rotationZ: 1.75, rotationY: 0.6 },
  { key: "debrisB", path: `${ROCKS}/SM_Cave_Rocks_Stalactite_02.glb`, anchor: [7, 0, -7], mode: "base", rotationZ: -1.5, rotationY: 2.2 },
  { key: "debrisC", path: `${ROCKS}/SM_Cave_Rock_Ceiling.glb`, anchor: [-12, 0, -10], mode: "base", rotationX: 0.25, rotationY: 1.1 },
  { key: "debrisD", path: `${ROCKS}/SM_Cave_Rocks_Stalactite_01.glb`, anchor: [3, 0, -14], mode: "base", rotationZ: 1.62, rotationY: 1.9 },
  { key: "debrisE", path: `${ROCKS}/SM_Cave_Rock_Ceiling.glb`, anchor: [14, 0, -22], mode: "base", rotationX: -0.2, rotationY: 2.7 },

  { key: "debrisNearA", path: `${ROCKS}/SM_Cave_Rocks_Stalactite_02.glb`, anchor: [-13, 0, -4], mode: "base", rotationZ: 1.68, rotationY: 1.2 },
  { key: "debrisNearB", path: `${ROCKS}/SM_Cave_Rock_Ceiling.glb`, anchor: [14, 0, -5], mode: "base", rotationX: 0.18, rotationY: 2.3 },
  { key: "debrisNearC", path: `${ROCKS}/SM_Cave_Rocks_Stalactite_01.glb`, anchor: [-14, 0, -12], mode: "base", rotationZ: -1.55, rotationY: 0.8 },

  // Greenery where the daylight lands, which is the only place it grows.
  { key: "fernA", path: `${NATURE}/SM_S_Soul_Plants_Fern.glb`, anchor: [-2, 0, -25], mode: "base", rotationY: 0.9 },
  { key: "fernB", path: `${NATURE}/SM_S_Soul_Plants_Fern2.glb`, anchor: [6, 0, -27], mode: "base", rotationY: 2.4 },
  { key: "fernC", path: `${NATURE}/SM_S_Soul_Plants_Fern.glb`, anchor: [9, 0, -18], mode: "base", rotationY: 1.7 },
  { key: "foliageA", path: `${NATURE}/SM_LV_Soul_Foliage021SM.glb`, anchor: [-5, 0, -19], mode: "base", rotationY: 0.2 },
  { key: "foliageB", path: `${NATURE}/SM_LV_Soul_Foliage021SM.glb`, anchor: [2, 0, -21], mode: "base", rotationY: 2.8 },
];
