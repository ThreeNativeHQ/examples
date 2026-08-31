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
/**
 * The chamber, read off the reference.
 *
 * The reference never shows a flat surface: every wall and every stretch of ceiling is broken rock,
 * and the room is a forest of slender columns with daylight coming down between them. So the built
 * shell is treated as a backstop to be hidden — rock masses ring the perimeter to cover the walls,
 * and ceiling rock breaks up the roof — while the columns and the light between them carry the shot.
 */
export const CAVE_PIECES: readonly ICavePiece[] = [
  // --- The colonnade. The subject of the reference. Two ranks the camera looks along, plus
  // stragglers so the rows never read as a grid.
  { key: "colL1", path: `${BUILDING}/SM_Cave_Rock_Pillar01REDO.glb`, anchor: [-8.5, 0, -10], mode: "base", rotationY: 0.2 },
  { key: "colL2", path: `${BUILDING}/SM_Cave_Rock_Pillar03b.glb`, anchor: [-8, 0, -18], mode: "base", rotationY: 1.1 },
  { key: "colL3", path: `${BUILDING}/SM_Cave_Rock_Pillar01REDO.glb`, anchor: [-7, 0, -26], mode: "base", rotationY: 2.3 },
  { key: "colL4", path: `${BUILDING}/SM_Cave_Rock_Pillar03b.glb`, anchor: [-9, 0, -34], mode: "base", rotationY: 0.7 },
  { key: "colL5", path: `${BUILDING}/SM_Cave_Rock_Pillar01REDO.glb`, anchor: [-13, 0, -22], mode: "base", rotationY: 1.6 },
  { key: "colR1", path: `${BUILDING}/SM_Cave_Rock_Pillar03b.glb`, anchor: [8.5, 0, -12], mode: "base", rotationY: 1.7 },
  { key: "colR2", path: `${BUILDING}/SM_Cave_Rock_Pillar01REDO.glb`, anchor: [8, 0, -20], mode: "base", rotationY: 0.5 },
  { key: "colR3", path: `${BUILDING}/SM_Cave_Rock_Pillar03b.glb`, anchor: [7, 0, -28], mode: "base", rotationY: 2.6 },
  { key: "colR4", path: `${BUILDING}/SM_Cave_Rock_Pillar01REDO.glb`, anchor: [9.5, 0, -36], mode: "base", rotationY: 1.3 },
  { key: "colR5", path: `${BUILDING}/SM_Cave_Rock_Pillar03b.glb`, anchor: [13, 0, -25], mode: "base", rotationY: 0.4 },
  { key: "colC1", path: `${BUILDING}/SM_Cave_Rock_Pillar01REDO.glb`, anchor: [0.5, 0, -31], mode: "base", rotationY: 0.9 },
  { key: "colC2", path: `${BUILDING}/SM_Cave_Rock_Pillar03b.glb`, anchor: [-2.5, 0, -40], mode: "base", rotationY: 2.0 },
  { key: "colC3", path: `${BUILDING}/SM_Cave_Rock_Pillar01REDO.glb`, anchor: [3.5, 0, -43], mode: "base", rotationY: 1.5 },
  // Broken stubs, as the reference has among the standing ones.
  { key: "stubA", path: `${BUILDING}/SM_Cave_Rock_PillarBottom.glb`, anchor: [-3, 0, -15], mode: "base", rotationY: 0.3 },
  { key: "stubB", path: `${BUILDING}/SM_Cave_Rock_Pillar_Broken01a.glb`, anchor: [4, 0, -24], mode: "base", rotationY: 1.2 },
  { key: "stubC", path: `${BUILDING}/SM_Cave_Rock_PillarBroken01b.glb`, anchor: [-5, 0, -33], mode: "base", rotationY: 2.1 },
  { key: "stubD", path: `${BUILDING}/SM_Cave_Rock_PillarTop.glb`, anchor: [11, 0, -31], mode: "base", rotationY: 2.4 },

  // --- The enclosure. These exist to make sure a flat wall is never in frame.
  // Human-scale rock, many of them, ringing the room outside the camera's lane. Big enough to
  // hide a wall, small enough that one does not contain the whole chamber.
  { key: "wallL1", path: `${ROCKS}/SM_Cave_Rock_Large02.glb`, anchor: [-17, 0, -6], mode: "base", rotationY: 0.5 },
  { key: "wallL2", path: `${ROCKS}/SM_Cave_Rock_Large01_REDO.glb`, anchor: [-19, 0, -16], mode: "base", rotationY: 1.7 },
  { key: "wallL3", path: `${ROCKS}/SM_Cave_Rock_Large02.glb`, anchor: [-18, 0, -27], mode: "base", rotationY: 2.6 },
  { key: "wallL4", path: `${ROCKS}/SM_Cave_Rock_Large01_REDO.glb`, anchor: [-16, 0, -37], mode: "base", rotationY: 0.9 },
  { key: "wallR1", path: `${ROCKS}/SM_Cave_Rock_Large01_REDO.glb`, anchor: [17, 0, -7], mode: "base", rotationY: -0.8 },
  { key: "wallR2", path: `${ROCKS}/SM_Cave_Rock_Large02.glb`, anchor: [19, 0, -18], mode: "base", rotationY: 2.1 },
  { key: "wallR3", path: `${ROCKS}/SM_Cave_Rock_Large01_REDO.glb`, anchor: [18, 0, -29], mode: "base", rotationY: 1.2 },
  { key: "wallR4", path: `${ROCKS}/SM_Cave_Rock_Large02.glb`, anchor: [16, 0, -39], mode: "base", rotationY: 0.3 },
  { key: "wallB1", path: `${ROCKS}/SM_Cave_Rock_Large02.glb`, anchor: [-7, 0, -44], mode: "base", rotationY: 2.2 },
  { key: "wallB2", path: `${ROCKS}/SM_Cave_Rock_Large01_REDO.glb`, anchor: [6, 0, -45], mode: "base", rotationY: 0.6 },
  { key: "wallB3", path: `${ROCKS}/SM_Cave_Rock_Large02.glb`, anchor: [0, 0, -47], mode: "base", rotationY: 1.4 },

  // --- Ceiling rock, so the roof never reads as a plane.
  { key: "ceilA", path: `${ROCKS}/SM_Cave_Rock_Ceiling.glb`, anchor: [-11, 14.9, -8], mode: "top", rotationY: 0.7 },
  { key: "ceilB", path: `${ROCKS}/SM_Cave_Rock_Ceiling.glb`, anchor: [12, 14.9, -15], mode: "top", rotationY: 2.1 },
  { key: "ceilC", path: `${ROCKS}/SM_Cave_Rock_Ceiling.glb`, anchor: [-9, 14.9, -26], mode: "top", rotationY: 1.4 },
  { key: "ceilD", path: `${ROCKS}/SM_Cave_Rock_Ceiling.glb`, anchor: [5, 14.9, -33], mode: "top", rotationY: 0.3 },
  { key: "stalA", path: `${ROCKS}/SM_Cave_Rocks_Stalactite_01.glb`, anchor: [-9, 14.7, -13], mode: "top", rotationY: 0.9 },
  { key: "stalB", path: `${ROCKS}/SM_Cave_Rocks_Stalactite_02.glb`, anchor: [6, 14.7, -22], mode: "top", rotationY: 2.2 },
  { key: "stalC", path: `${ROCKS}/SM_Cave_Rocks_Stalactite_01.glb`, anchor: [12, 14.7, -9], mode: "top", rotationY: 1.5 },
  { key: "stalD", path: `${ROCKS}/SM_Cave_Rocks_Stalactite_02.glb`, anchor: [-11, 14.7, -27], mode: "top", rotationY: 0.6 },
  { key: "stalE", path: `${ROCKS}/SM_Cave_Rocks_Stalactite_01.glb`, anchor: [2, 14.7, -35], mode: "top", rotationY: 2.8 },

  // --- Chains, hanging near camera on both sides as the reference frames it.
  { key: "chainLeft", path: `${BUILDING}/SM_Cave_Chain_02.glb`, anchor: [-9, 14.6, -7], mode: "top", rotationY: 0.2 },
  { key: "chainRight", path: `${BUILDING}/SM_Cave_Chain_02.glb`, anchor: [10, 14.6, -11], mode: "top", rotationY: -0.5 },
  { key: "chainFar", path: `${BUILDING}/SM_Cave_Chain_02.glb`, anchor: [3, 14.6, -26], mode: "top", rotationY: 1.1 },

  // --- Fallen rock among the columns.
  { key: "debrisA", path: `${ROCKS}/SM_Cave_Rocks_Stalactite_01.glb`, anchor: [-11, 0, -6], mode: "base", rotationZ: 1.75, rotationY: 0.6 },
  { key: "debrisB", path: `${ROCKS}/SM_Cave_Rocks_Stalactite_02.glb`, anchor: [12, 0, -7], mode: "base", rotationZ: -1.5, rotationY: 2.2 },
  { key: "debrisC", path: `${ROCKS}/SM_Cave_Rocks_Stalactite_01.glb`, anchor: [-4, 0, -21], mode: "base", rotationZ: 1.62, rotationY: 1.9 },
  { key: "debrisD", path: `${ROCKS}/SM_Cave_Rocks_Stalactite_02.glb`, anchor: [5, 0, -34], mode: "base", rotationZ: -1.6, rotationY: 0.8 },

  // --- Ground cover: grass at the water's edge, leaf litter drifted against the stone.
  { key: "grassA", path: `${NATURE}/SM_Cave_Grass01.glb`, anchor: [-5, 0, -11], mode: "base", rotationY: 0.4 },
  { key: "grassB", path: `${NATURE}/SM_Cave_Grass01.glb`, anchor: [3, 0, -9], mode: "base", rotationY: 1.9 },
  { key: "grassC", path: `${NATURE}/SM_Cave_Grass01.glb`, anchor: [-10, 0, -19], mode: "base", rotationY: 2.7 },
  { key: "grassD", path: `${NATURE}/SM_Cave_Grass01.glb`, anchor: [7, 0, -18], mode: "base", rotationY: 0.9 },
  { key: "grassE", path: `${NATURE}/SM_Cave_Grass01.glb`, anchor: [0, 0, -25], mode: "base", rotationY: 1.4 },
  { key: "grassF", path: `${NATURE}/SM_Cave_Grass01.glb`, anchor: [-2, 0, -5], mode: "base", rotationY: 2.2 },
  { key: "grassG", path: `${NATURE}/SM_Cave_Grass01.glb`, anchor: [9, 0, -29], mode: "base", rotationY: 0.6 },
  { key: "leafPileA", path: `${NATURE}/SM_Cave_Leaf_Pile01.glb`, anchor: [-7, 0, -8], mode: "base", rotationY: 0.6 },
  { key: "leafPileB", path: `${NATURE}/SM_Cave_Leaf_Pile02.glb`, anchor: [6, 0, -15], mode: "base", rotationY: 2.1 },
  { key: "leafPileC", path: `${NATURE}/SM_Cave_Leaf_Pile03_1.glb`, anchor: [-12, 0, -32], mode: "base", rotationY: 1.1 },
  { key: "leavesA", path: `${NATURE}/SM_S_Soul_Leaves1.glb`, anchor: [2, 0, -12], mode: "base", rotationY: 1.6 },
  { key: "fernA", path: `${NATURE}/SM_S_Soul_Plants_Fern.glb`, anchor: [-4, 0, -28], mode: "base", rotationY: 0.9 },
  { key: "fernB", path: `${NATURE}/SM_S_Soul_Plants_Fern2.glb`, anchor: [8, 0, -24], mode: "base", rotationY: 2.4 },
  { key: "bushA", path: `${NATURE}/SM_S_Soul_bush.glb`, anchor: [-16, 0, -20], mode: "base", rotationY: 0.8 },

  // --- The shrine, kept as something to walk to rather than the subject of this shot.
  { key: "shrinePlinth", path: `${BUILDING}/SM_Cave_Floor_Stairs_Quarter.glb`, anchor: [19, 0, -37], mode: "base", rotationY: 1.4 },
  { key: "shrineFigure", path: `${BUILDING}/SM_S_Soul_Statue.glb`, anchor: [18, 0.62, -35], mode: "base", rotationY: 2.2 },
];
