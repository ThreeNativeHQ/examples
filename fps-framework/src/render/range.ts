// The yard itself: a 34 m walled square, tiled deck, painted lanes, and the
// props the reference frame shows — a round barrier left, concrete barricades
// centre, two lockers and a raised walkway on the right.
import {
  BufferGeometry,
  BoxGeometry,
  CylinderGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  type Texture,
} from "three";
import { Target, type TargetSpec } from "../entities/Target.js";
import { type RangeMaterials, tiled } from "./materials.js";
import { scale } from "./scale.js";

export const YARD = 34;
export const WALL_HEIGHT = 5.5;
/** Where the player stands; the yard runs away from here toward -z. */
export const FIRING_LINE_Z = 13.4;

export type BoxCollider = {
  readonly min: readonly [number, number, number];
  readonly max: readonly [number, number, number];
};

export type Range = {
  readonly group: Group;
  readonly hittable: Mesh[];
  readonly targets: Target[];
  readonly colliders: BoxCollider[];
};

const TARGETS: readonly TargetSpec[] = [
  {
    position: { x: -11.7, y: 2.68, z: -1.0 },
    value: 150,
    width: scale.targets.wideWidth,
    height: scale.targets.tallHeight,
    standing: false,
  },
  {
    position: { x: 0.2, y: 1.95, z: -2.6 },
    value: 100,
    width: scale.targets.standardWidth,
    height: scale.targets.highHeight,
  },
  {
    position: { x: 2.5, y: 3.65, z: -8.4 },
    value: 250,
    width: scale.targets.narrowWidth,
    height: scale.targets.shortHeight,
    standing: false,
  },
  {
    position: { x: 8.9, y: 4.6, z: -5.8 },
    value: 300,
    width: scale.targets.standardWidth,
    height: scale.targets.almostHighHeight,
    standing: false,
  },
  {
    position: { x: -1.0, y: 0.85, z: -1.5 },
    value: 150,
    width: scale.targets.standardWidth,
    height: scale.targets.halfHeight,
  },
  {
    position: { x: 13.0, y: 1.2, z: 3.0 },
    value: 250,
    width: scale.targets.standardWidth,
    height: scale.targets.lowHeight,
  },
  {
    position: { x: 6.4, y: 1.2, z: -6.2 },
    value: 250,
    width: scale.targets.standardWidth,
    height: scale.targets.lowHeight,
  },
  {
    position: { x: 13.5, y: 1.2, z: 3.0 },
    value: 300,
    width: scale.targets.extraWideWidth,
    height: scale.targets.lowHeight,
  },
  {
    position: { x: -11.4, y: 0.7, z: 0.6 },
    value: 150,
    width: scale.targets.extraWideWidth,
    height: scale.targets.quarterHeight,
  },
  {
    position: { x: 8.0, y: 1.2, z: -5.8 },
    value: 100,
    width: scale.targets.standardWidth,
    height: scale.targets.mediumHeight,
  },
];

function addBox(
  group: Group,
  colliders: BoxCollider[],
  material: Mesh["material"],
  size: readonly [number, number, number],
  at: readonly [number, number, number],
  options: {
    readonly collide?: boolean;
    readonly hittable?: Mesh[];
    /** Audit label. `tools/scale-audit.mjs` measures by name; an unnamed prop is reported
     *  as unlabelled rather than silently skipped. */
    readonly name?: string;
  } = {},
): Mesh {
  const mesh = new Mesh(new BoxGeometry(size[0], size[1], size[2]), material);
  if (options.name !== undefined) mesh.name = options.name;
  mesh.position.set(at[0], at[1], at[2]);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
  options.hittable?.push(mesh);
  if (options.collide !== false) {
    colliders.push({
      min: [at[0] - size[0] / 2, at[1] - size[1] / 2, at[2] - size[2] / 2],
      max: [at[0] + size[0] / 2, at[1] + size[1] / 2, at[2] + size[2] / 2],
    });
  }
  return mesh;
}

function addWallGrid(group: Group, positions: number[]): void {
  const grid = new LineSegments(
    new BufferGeometry().setAttribute("position", new Float32BufferAttribute(positions, 3)),
    new LineBasicMaterial({ color: 0x202832, opacity: 0.35, transparent: true }),
  );
  grid.name = "wall-grid";
  grid.renderOrder = 1;
  group.add(grid);
}

export function buildRange(materials: RangeMaterials): Range {
  const group = new Group();
  group.name = "range";
  const hittable: Mesh[] = [];
  const colliders: BoxCollider[] = [];

  // Deck.
  const floor = new Mesh(new PlaneGeometry(YARD, YARD), materials.floor);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  floor.name = "deck";
  group.add(floor);
  hittable.push(floor);

  // Lane paint: four long stripes down range plus the firing line across it.
  for (const x of [-10.8, -3.6, 3.6, 10.8]) {
    const stripe = new Mesh(new PlaneGeometry(0.22, YARD - 1.6), materials.paint);
    stripe.rotation.x = -Math.PI / 2;
    stripe.name = "lane-paint";
    stripe.position.set(x, 0.012, 0);
    stripe.receiveShadow = true;
    group.add(stripe);
  }
  const firingLine = new Mesh(new PlaneGeometry(YARD - 1.6, 0.13), materials.paint);
  firingLine.rotation.x = -Math.PI / 2;
  firingLine.name = "firing-line";
  firingLine.position.set(0, 0.014, FIRING_LINE_Z - 2.8);
  group.add(firingLine);

  // Perimeter wall, near-black, with a lighter capping course along the top.
  const half = YARD / 2;
  const walls: readonly (readonly [number, number, number, number, number, number])[] = [
    [YARD + 1.2, WALL_HEIGHT, 0.6, 0, WALL_HEIGHT / 2, -half],
    [YARD + 1.2, WALL_HEIGHT, 0.6, 0, WALL_HEIGHT / 2, half],
    [0.6, WALL_HEIGHT, YARD + 1.2, -half, WALL_HEIGHT / 2, 0],
    [0.6, WALL_HEIGHT, YARD + 1.2, half, WALL_HEIGHT / 2, 0],
  ];
  for (const [sx, sy, sz, px, py, pz] of walls) {
    addBox(group, colliders, materials.wall, [sx, sy, sz], [px, py, pz], {
      hittable,
      name: "wall",
    });
  }

  const farGrid: number[] = [];
  for (let x = -half + 1; x < half; x += 1) {
    farGrid.push(x, 0.05, -half + 0.31, x, WALL_HEIGHT - 0.05, -half + 0.31);
  }
  for (let y = 1; y < WALL_HEIGHT; y += 1) {
    farGrid.push(-half, y, -half + 0.31, half, y, -half + 0.31);
  }
  addWallGrid(group, farGrid);

  const sideGrid: number[] = [];
  for (const x of [-half + 0.31, half - 0.31]) {
    for (let z = -half + 1; z < half; z += 1) {
      sideGrid.push(x, 0.05, z, x, WALL_HEIGHT - 0.05, z);
    }
    for (let y = 1; y < WALL_HEIGHT; y += 1) {
      sideGrid.push(x, y, -half, x, y, half);
    }
  }
  addWallGrid(group, sideGrid);

  // Round barrier, left of the lane: an open concrete drum the player can shoot over.
  const drumMap = tiled((materials.floor as MeshStandardMaterial).map as Texture, 9);
  const drum = new Mesh(
    new CylinderGeometry(
      scale.drum.radius,
      scale.drum.radius,
      scale.drum.height,
      40,
      1,
      true,
      Math.PI * 0.15,
      Math.PI * 1.7,
    ),
    new MeshStandardMaterial({
      color: 0xffffff,
      emissive: 0x1c1e1f,
      map: drumMap,
      roughness: 0.95,
      side: DoubleSide,
    }),
  );
  drum.name = "drum";
  drum.position.set(-11.4, scale.drum.height / 2 + scale.ankleHeight * 0.5, 0.6);
  drum.castShadow = true;
  drum.receiveShadow = true;
  group.add(drum);
  hittable.push(drum);
  // The visual is an open arc, so its collision must be an arc too. The old enclosing box
  // turned the drum's empty centre into an invisible solid that both the player and the enemy
  // could never enter.
  const drumCentreX = -11.4;
  const drumCentreZ = 0.6;
  const arcStart = Math.PI * 0.15;
  const arcSpan = Math.PI * 1.7;
  for (let index = 0; index < 22; index += 1) {
    const angle = arcStart + (arcSpan * (index + 0.5)) / 22;
    const x = drumCentreX + Math.cos(angle) * scale.drum.radius;
    const z = drumCentreZ + Math.sin(angle) * scale.drum.radius;
    const thickness = scale.ankleHeight * 18;
    colliders.push({
      min: [x - thickness, 0, z - thickness],
      max: [x + thickness, scale.drum.height, z + thickness],
    });
  }

  // Concrete barricades down the centre lane.
  addBox(
    group,
    colliders,
    materials.concrete,
    [scale.silhouette.width * 8.3, scale.humanHeight * 0.84, scale.barricade.depth],
    [0.2, scale.humanHeight * 0.42, 0.3],
    {
    hittable,
    name: "barricade",
    },
  );
  addBox(
    group,
    colliders,
    materials.concrete,
    [scale.silhouette.width * 8.8, scale.humanHeight * 0.62, scale.barricade.depth],
    [2.6, scale.humanHeight * 0.31, -4.6],
    {
    hittable,
    name: "barricade",
    },
  );

  // Two dark lockers, right of centre.
  addBox(group, colliders, materials.block, [scale.locker.width, scale.locker.height, scale.locker.depth], [6.4, scale.locker.height / 2, -5.4], {
    hittable,
    name: "locker",
  });
  addBox(group, colliders, materials.block, [scale.locker.width, scale.locker.height, scale.locker.depth], [8.0, scale.locker.height / 2, -5.4], {
    hittable,
    name: "locker",
  });

  // Raised walkway on the right, with a ramp up to it from the firing side.
  const deckY = scale.walkwaySurface - scale.walkway.thickness / 2;
  addBox(group, colliders, materials.block, [scale.walkway.width, scale.walkway.thickness, scale.walkway.depth], [11.6, deckY, -8.6], {
    hittable,
    name: "walkway-deck",
  });
  for (const px of [7.5, 15.6]) {
    for (const pz of [-6.4, -10.8]) {
      addBox(group, colliders, materials.block, [1.0, deckY, 1.0], [px, deckY / 2, pz], {
        hittable,
        name: "walkway-column",
      });
    }
  }
  const rail = new Mesh(new BoxGeometry(9.6, 0.12, 0.14), materials.paint);
  rail.name = "walkway-rail";
  rail.position.set(11.6, deckY + 1.05, -5.9);
  rail.castShadow = true;
  group.add(rail);
  const ramp = new Mesh(new BoxGeometry(scale.ramp.width, scale.ramp.length * 0.04, scale.ramp.length), materials.concrete);
  ramp.name = "ramp";
  ramp.position.set(11.6, scale.walkwaySurface / 2 - scale.ramp.length * 0.04 / 2, -2.1);
  ramp.rotation.x = -Math.atan2(scale.walkwaySurface - scale.ankleHeight * 10, scale.ramp.length - scale.ankleHeight * 20);
  ramp.castShadow = true;
  ramp.receiveShadow = true;
  group.add(ramp);
  hittable.push(ramp);

  // A stepped proxy gives CharacterBody3D a climbable surface. The sloped render mesh alone is
  // not a collider, and one rotated box makes the player either float or fail autostep.
  const rampStartZ = 1.6;
  const rampEndZ = rampStartZ - scale.ramp.length;
  for (let index = 0; index < scale.ramp.steps; index += 1) {
    const progress = (index + 0.5) / scale.ramp.steps;
    const height = scale.walkwaySurface * progress;
    const depth = scale.ramp.length / scale.ramp.steps + scale.ankleHeight * 1.5;
    const centreZ = rampStartZ - scale.ramp.length * progress;
    colliders.push({
      min: [11.6 - scale.ramp.width / 2, 0, centreZ - depth / 2],
      max: [11.6 + scale.ramp.width / 2, height, centreZ + depth / 2],
    });
  }

  // Solid dark blocks: one hard right, one squat pair mid-right.
  addBox(group, colliders, materials.block, [4.2, 3.2, 4.2], [14.4, 1.6, 1.6], {
    hittable,
    name: "block",
  });
  addBox(group, colliders, materials.block, [2.4, 2.4, 2.4], [7.2, 1.2, -1.6], {
    hittable,
    name: "block",
  });
  addBox(group, colliders, materials.block, [2.0, 1.6, 2.0], [-8.0, 0.8, -12.4], {
    hittable,
    name: "block",
  });

  const targets = TARGETS.map((spec) => {
    const target = new Target(materials, spec);
    group.add(target.group);
    hittable.push(target.plate);
    return target;
  });

  return { group, hittable, targets, colliders };
}
