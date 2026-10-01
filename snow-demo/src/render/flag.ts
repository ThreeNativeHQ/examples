// How the cup's flag looks. Where it stands comes from `src/putt.ts`; change the look here.
import {
  BufferGeometry,
  CylinderGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshStandardMaterial,
} from "three";
import { palette } from "./palette.js";

/** A thin dark pole with an accent pennant, tall enough to read from across the glade. */
export function createFlag(height = 1.8): Group {
  const flag = new Group();
  const pole = new Mesh(
    new CylinderGeometry(0.025, 0.025, height, 8),
    new MeshStandardMaterial({ color: 0x25313a, roughness: 0.6 }),
  );
  pole.position.y = height / 2;
  pole.castShadow = true;
  const cloth = new BufferGeometry();
  cloth.setAttribute(
    "position",
    new Float32BufferAttribute([0, height, 0, 0, height - 0.36, 0, 0.62, height - 0.18, 0], 3),
  );
  cloth.computeVertexNormals();
  const pennant = new Mesh(
    cloth,
    new MeshStandardMaterial({ color: palette.accent, roughness: 0.8, side: DoubleSide }),
  );
  pennant.castShadow = true;
  flag.add(pole, pennant);
  return flag;
}
