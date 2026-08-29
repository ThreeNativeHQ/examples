// Generated-project source. The yard's layout, palette and materials are the game's. The only
// thing the framework knows is which meshes carry `userData.traceable`.
import { BoxGeometry, Group, Mesh, MeshStandardMaterial, type Object3D } from "three";
import { palette } from "./palette.js";

export const YARD_HALF_WIDTH = 9;
export const START_Z = 9;
export const DOOR_Z = -9.5;

export interface IYard {
  readonly cover: readonly Object3D[];
  readonly door: Mesh;
  readonly group: Group;
  /** The one piece of cover that moves, and therefore the one that forces a repack. */
  readonly shutter: Mesh;
}

/** Blocks are placed by hand, not generated: the route through them is the level design. */
const BLOCKS: readonly (readonly [number, number, number, number, number])[] = [
  [-5.4, -6.2, 2.6, 3.4, 2.2],
  [1.2, -6.8, 3.2, 4.2, 2.4],
  [6.2, -4.4, 2.4, 3.0, 2.6],
  [-6.8, -1.2, 3.0, 3.6, 2.4],
  [-1.0, -1.8, 2.2, 2.8, 2.0],
  [5.0, 0.6, 2.8, 3.8, 2.6],
  [-4.2, 4.2, 2.6, 3.2, 2.2],
  [2.6, 4.8, 3.0, 3.4, 2.4],
];

export function createYard(): IYard {
  const group = new Group();
  const stone = new MeshStandardMaterial({ color: palette.shadow, roughness: 0.86, metalness: 0.06 });
  const cover: Object3D[] = [];

  for (const [x, z, width, height, depth] of BLOCKS) {
    const block = new Mesh(new BoxGeometry(width, height, depth), stone);
    block.position.set(x, height / 2, z);
    block.castShadow = true;
    // The game decides what casts. The BVH just packs whatever carries this flag.
    block.userData.traceable = true;
    group.add(block);
    cover.push(block);
  }

  const shutter = new Mesh(
    new BoxGeometry(4.6, 3.2, 1.0),
    new MeshStandardMaterial({ color: palette.accent, roughness: 0.6, metalness: 0.2 }),
  );
  shutter.position.set(0, 1.6, 1.6);
  shutter.userData.traceable = true;
  group.add(shutter);
  cover.push(shutter);

  const wallStone = new MeshStandardMaterial({ color: palette.skyLow, roughness: 0.95 });
  for (const [x, z, w, d] of [
    [0, -13, (YARD_HALF_WIDTH + 3) * 2, 0.8],
    [-YARD_HALF_WIDTH - 3, -1, 0.8, 26],
    [YARD_HALF_WIDTH + 3, -1, 0.8, 26],
  ] as const) {
    const wall = new Mesh(new BoxGeometry(w, 5, d), wallStone);
    wall.position.set(x, 2.5, z);
    wall.userData.traceable = true;
    group.add(wall);
    cover.push(wall);
  }

  const door = new Mesh(
    new BoxGeometry(3.2, 0.12, 3.2),
    new MeshStandardMaterial({
      color: palette.player,
      emissive: palette.player,
      emissiveIntensity: 0.55,
      roughness: 0.4,
    }),
  );
  door.position.set(0, 0.07, DOOR_Z);
  group.add(door);

  return { cover, door, group, shutter };
}
