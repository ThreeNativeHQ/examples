import { BoxGeometry, EdgesGeometry, Group, LineBasicMaterial, LineSegments, Mesh, PlaneGeometry } from "three";
import { floor, mix, positionWorld, vec3 } from "three/tsl";
import { MeshBasicNodeMaterial } from "three/webgpu";

export interface ITankBounds {
  readonly min: readonly [number, number, number];
  readonly max: readonly [number, number, number];
}

/** A checker floor and a wire box: what the water refracts and what contains it. */
export function createStage(bounds: ITankBounds): Group {
  const stage = new Group();
  const [x0, y0, z0] = bounds.min;
  const [x1, y1, z1] = bounds.max;
  const floorMaterial = new MeshBasicNodeMaterial();
  const cell = floor(positionWorld.x.mul(2)).add(floor(positionWorld.z.mul(2))).mod(2);
  floorMaterial.colorNode = mix(vec3(0.16, 0.19, 0.24), vec3(0.3, 0.34, 0.4), cell);
  floorMaterial.toneMapped = false;
  const ground = new Mesh(new PlaneGeometry(x1 - x0, z1 - z0).rotateX(-Math.PI / 2), floorMaterial);
  ground.position.set((x0 + x1) / 2, 0, (z0 + z1) / 2);
  stage.add(ground);
  const frame = new LineSegments(
    new EdgesGeometry(new BoxGeometry(x1 - x0, y1 - y0, z1 - z0)),
    new LineBasicMaterial({ color: 0x3a5a7a }),
  );
  frame.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  stage.add(frame);
  return stage;
}
