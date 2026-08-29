// Generated-project source. The hall's shape, palette and materials are the game's.
import {
  BoxGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
} from "three";
import { palette } from "./palette.js";

export const HALF_WIDTH = 7;
export const HALF_DEPTH = 6;

export function createHall(): Group {
  const hall = new Group();
  const stone = new MeshStandardMaterial({ color: palette.floor, roughness: 0.92, metalness: 0.04 });
  const pillarStone = new MeshStandardMaterial({
    color: palette.shadow,
    roughness: 0.8,
    metalness: 0.1,
  });

  const floor = new Mesh(new PlaneGeometry(HALF_WIDTH * 2, HALF_DEPTH * 2), stone);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  hall.add(floor);

  const wallHeight = 4.2;
  for (const [x, z, w, d] of [
    [0, -HALF_DEPTH, HALF_WIDTH * 2, 0.5],
    [-HALF_WIDTH, 0, 0.5, HALF_DEPTH * 2],
    [HALF_WIDTH, 0, 0.5, HALF_DEPTH * 2],
  ] as const) {
    const wall = new Mesh(new BoxGeometry(w, wallHeight, d), pillarStone);
    wall.position.set(x, wallHeight / 2, z);
    wall.receiveShadow = true;
    hall.add(wall);
  }

  for (const x of [-4.4, 4.4]) {
    for (const z of [-3.6, 0.4]) {
      const pillar = new Mesh(new CylinderGeometry(0.42, 0.5, wallHeight, 10), pillarStone);
      pillar.position.set(x, wallHeight / 2, z);
      pillar.castShadow = true;
      hall.add(pillar);
    }
  }
  return hall;
}
