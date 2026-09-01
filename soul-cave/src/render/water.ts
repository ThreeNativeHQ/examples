// Ordinary Three.js/TSL: the framework decides none of this.
//
// The pack ships water meshes, but every one of them imports untextured — water in Unreal is a
// material, not a picture: panning normals, depth fade, refraction. So the importer correctly
// refused to paint them, and the surface is built here instead.
//
// What the reference actually shows is standing rainwater on a cave floor: nearly black where it
// is deep, mirror-flat, catching the light shafts and the columns above it. That is a very smooth,
// very dark surface plus the screen-space reflections the render chain already runs — no
// transparency and no refraction needed, because there is nothing to see through it to.
import {
  type Group as GroupType,
  Group,
  Mesh,
  PlaneGeometry,
  RepeatWrapping,
  type Texture,
} from "three";
import { MeshStandardNodeMaterial } from "three/webgpu";
import { float, mix, texture, time, uv, vec2, vec3 } from "three/tsl";

/** Deep cave water reads almost black; what you see in it is what it reflects. */
const WATER_TINT = vec3(0.045, 0.058, 0.058);

export interface IWaterOptions {
  /** Reused as a ripple normal — it is a rock mask, but at this scale its grain is water. */
  readonly rippleMap: Texture;
  readonly pools: readonly {
    readonly x: number;
    readonly z: number;
    readonly width: number;
    readonly depth: number;
    readonly rotationY?: number;
  }[];
  /** Sits just above the floor so it never z-fights with it. */
  readonly heightMetres?: number;
}

function rippleTexture(map: Texture, tiles: number): Texture {
  const copy = map.clone();
  copy.wrapS = RepeatWrapping;
  copy.wrapT = RepeatWrapping;
  copy.repeat.set(tiles, tiles);
  copy.needsUpdate = true;
  return copy;
}

/**
 * Standing water for the cave floor.
 *
 * The ripple is two copies of one map drifting against each other at different speeds — the
 * cheapest thing that stops a mirror from looking like polished glass, and the only motion in an
 * otherwise still scene.
 */
export function createWater(options: IWaterOptions): GroupType {
  const group = new Group();
  group.name = "caveWater";
  const height = options.heightMetres ?? 0.015;

  const material = new MeshStandardNodeMaterial();
  const near = texture(rippleTexture(options.rippleMap, 26), uv().add(vec2(time.mul(0.006), time.mul(0.004))));
  const far = texture(rippleTexture(options.rippleMap, 11), uv().sub(vec2(time.mul(0.0035), time.mul(0.005))));
  material.colorNode = WATER_TINT;
  // Not a perfect mirror: a hairline of roughness variation is what makes the reflected shaft
  // smear the way it does on water rather than sitting on it like a decal.
  material.roughnessNode = mix(float(0.02), float(0.11), near.r.mul(0.6).add(far.g.mul(0.4)));
  material.metalnessNode = float(0.02);
  // A puddle has no edge you can see. Without this the planes read as grey rectangles laid on the
  // floor, which is exactly what they are — the radial falloff is what makes them water instead.
  const centred = uv().sub(vec2(0.5, 0.5));
  const rim = centred.length().mul(2).clamp(0, 1);
  material.opacityNode = float(1).sub(rim.mul(rim).mul(rim));
  material.transparent = true;
  material.depthWrite = false;

  for (const pool of options.pools) {
    const mesh = new Mesh(new PlaneGeometry(pool.width, pool.depth), material);
    mesh.rotation.x = -Math.PI / 2;
    if (pool.rotationY !== undefined) mesh.rotation.z = pool.rotationY;
    mesh.position.set(pool.x, height, pool.z);
    mesh.receiveShadow = true;
    mesh.name = `cavePool${group.children.length}`;
    group.add(mesh);
  }
  return group;
}

/** Where the water sits. Low ground collects it, so the pools follow the walked route. */
export const CAVE_POOLS: IWaterOptions["pools"] = [
  // Puddles, not a lake: the reference's floor is wet gravel with water standing in the hollows.
  // Placed in the open floor around the shrine platform, never on it.
  { x: -6, z: -6, width: 9, depth: 6, rotationY: 0.2 },
  { x: 7, z: -9, width: 7, depth: 5, rotationY: -0.4 },
  { x: -11, z: -13, width: 8, depth: 6, rotationY: 0.7 },
  { x: 9, z: -16, width: 7, depth: 6, rotationY: 0.3 },
  { x: -8, z: -27, width: 9, depth: 7, rotationY: -0.6 },
  { x: 10, z: -30, width: 7, depth: 6, rotationY: 1.1 },
  { x: -2, z: -34, width: 8, depth: 6, rotationY: 0.1 },
];
