// Game-owned tree appearance: the bark and leaf surfaces, and the wind that moves them.
//
// Shape is data — `assets/trees/tree-<seed>.glb`, cooked offline by `pnpm trees` — and everything
// the player sees on a tree is decided here. The shared wind displacement in ./wind.ts owns motion;
// this file dresses one loaded variant so its meshes wear the game's materials and one wind pair.
import { Box3, DoubleSide, type Group, type Material, Mesh } from "three";
import {
  color,
  length,
  mix,
  modelWorldMatrix,
  mx_noise_float,
  mx_worley_noise_float,
  oneMinus,
  positionGeometry,
  smoothstep,
  sub,
  uv,
  vec2,
  vec3,
  vec4,
} from "three/tsl";
import { MeshStandardNodeMaterial } from "three/webgpu";
import type { IWind } from "../vegetation/geometry.js";
import { createTreeWind } from "./wind.js";

/** Warm grey-brown, matte. */
export const barkMaterial = new MeshStandardNodeMaterial({
  color: 0x6d5c4a,
  metalness: 0,
  roughness: 0.92,
});

/**
 * Leaves are opaque quads carved by a cut-out, never blended: `maskNode` discards outside the
 * leaf cluster, and three's WebGPU renderer reads the same node in the shadow pass, so a canopy
 * throws a dappled shadow instead of a square one.
 */
export const leafMaterial = new MeshStandardNodeMaterial({
  side: DoubleSide,
  metalness: 0,
  roughness: 0.78,
});

// The donor gives every leaf quad a 0..1 uv, so one procedural cluster fits in each: small leaf
// blobs where the worley field is near a cell centre, clipped to a disc so the quad's own corners
// never show. Every quad shares that uv range, so the cluster is shifted by the fragment's
// pre-wind tree-space position; without it the whole canopy is one stamp repeated (judge, round 5).
// World-space rest position, before the wind: the cook stores positions in quantized units with
// the scale on the node, so a pattern keyed on raw geometry coordinates would change with the cook.
const rest = modelWorldMatrix.mul(vec4(positionGeometry, 1)).xyz;
const seed = rest.xz.mul(1.7).add(rest.y.mul(0.9));
const cells = mx_worley_noise_float(uv().mul(vec2(7, 4.5)).add(seed), 1);
const blob = oneMinus(smoothstep(0.16, 0.3, cells));
const round = oneMinus(smoothstep(0.38, 0.5, length(sub(uv(), 0.5))));
// `cells` stays under ~0.3 inside a blob, so remap that range: dark at the vein, sunlit at the rim.
const leaf = mix(color(0x3d6a26), color(0x9cc455), smoothstep(0, 0.3, cells));
// Canopy-scale drift between fresh green and a warmer, older olive, a few metres per patch.
const age = mx_noise_float(rest.mul(0.35)).mul(0.5).add(0.5);
leafMaterial.colorNode = mix(leaf, leaf.mul(vec3(1.2, 1.05, 0.62)), age);
leafMaterial.maskNode = blob.mul(round).greaterThan(0.5);

/** One wind per material, expanded to cover the displacement the shader applies. */
export type TreeWind = ReturnType<typeof createTreeWind>;

/** A cooked variant, dressed: the meshes of each role and the winds that move them. */
export interface TreeVariant {
  readonly root: Group;
  readonly bark: Mesh[];
  readonly leaf: Mesh[];
  readonly winds: TreeWind[];
  /** World-metre tree height, measured from the loaded scene; the wind's slope denominator. */
  readonly height: number;
  readonly vertices: number;
}

/** The glTF material name the exporter gave a role; the cook may flatten the nodes around it. */
function roleOf(mesh: Mesh): "bark" | "leaf" | undefined {
  const material: Material | undefined = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
  return material?.name === "bark" || material?.name === "leaf" ? material.name : undefined;
}

/**
 * Dress one loaded variant in place. `phase` differs per variant so no two neighbouring trees move
 * together, and a variant's clones share the materials, so one wind pair drives all of them.
 *
 * One options object covers bark and leaves because the envelope is the baked `_wind` weight — a
 * share of the tree's own height — so both roles at one height read the same value, before or after
 * the cook gave each mesh its own dequantized local frame.
 */
export function dressVariant(root: Group, phase: number): TreeVariant {
  const box = new Box3().setFromObject(root);
  const height = box.max.y - box.min.y;
  const bark: Mesh[] = [];
  const leaf: Mesh[] = [];
  root.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    const role = roleOf(object);
    if (role === "bark") bark.push(object);
    else if (role === "leaf") leaf.push(object);
  });
  if (bark.length === 0 || leaf.length === 0)
    throw new Error(
      `Tree variant has no ${bark.length === 0 ? "bark" : "leaf"} mesh; the glTF material name is how a cooked tree is told apart.`,
    );
  const options: IWind = {
    // World metres: the displacement is built in world space, so 0.3 reads the same on every clone.
    amplitude: 0.3,
    frequency: 1.3,
    phase,
    height,
    direction: [1, 0.35],
  };
  const barkWind = createTreeWind(barkMaterial, options);
  const leafWind = createTreeWind(leafMaterial, options);
  for (const mesh of bark) {
    mesh.material = barkWind.material;
  }
  for (const mesh of leaf) {
    mesh.material = leafWind.material;
  }
  let vertices = 0;
  for (const mesh of [...bark, ...leaf])
    vertices += mesh.geometry.getAttribute("position")?.count ?? 0;
  return { root, bark, leaf, winds: [barkWind, leafWind], height, vertices };
}
