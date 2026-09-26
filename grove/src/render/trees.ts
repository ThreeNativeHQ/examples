// Game-owned tree appearance: the bark and leaf surfaces, and the wind that moves them.
//
// Everything the player sees on a tree is decided here. The generator in ../vegetation/ owns
// shape and the shared wind displacement in ./wind.ts owns motion; the two are composed by
// `windVariant`, so a variant's materials are replaced by wind clones and every tree built from
// that variant sways with its own phase.
import { DoubleSide, Mesh } from "three";
import { color, length, vec2, mix, mx_worley_noise_float, oneMinus, smoothstep, sub, uv } from "three/tsl";
import { MeshStandardNodeMaterial } from "three/webgpu";
import type { IGeneratedTree } from "../vegetation/tree.js";
import { createTreeWind } from "./wind.js";

/** Warm grey-brown, matte. `generateTree` disposes the donor's own bark material and wears this. */
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
// never show. `cells` varies per fragment, so the colour mix mottles each cluster on its own.
const cells = mx_worley_noise_float(uv().mul(vec2(7, 4.5)), 1);
const blob = oneMinus(smoothstep(0.16, 0.3, cells));
const round = oneMinus(smoothstep(0.38, 0.5, length(sub(uv(), 0.5))));
// `cells` stays under ~0.3 inside a blob, so remap that range: dark at the vein, sunlit at the rim.
leafMaterial.colorNode = mix(color(0x3d6a26), color(0x9cc455), smoothstep(0, 0.3, cells));
leafMaterial.maskNode = blob.mul(round).greaterThan(0.5);

/** One wind per variant material, expanded to cover the displacement the shader applies. */
export type TreeWind = ReturnType<typeof createTreeWind>;

/**
 * Give a generated variant its own wind. `phase` differs per variant so no two neighbouring trees
 * move together; a variant's clones share the materials, so one pair of winds drives all of them.
 */
export function windVariant(variant: IGeneratedTree, phase: number): TreeWind[] {
  const meshes: Mesh[] = [];
  let extent = 0;
  variant.root.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    object.geometry.computeBoundingBox();
    extent = Math.max(extent, object.geometry.boundingBox?.max.y ?? 0);
    meshes.push(object);
  });
  return meshes.map((mesh) => {
    const leaves = mesh.material === leafMaterial;
    const wind = createTreeWind(leaves ? leafMaterial : barkMaterial, {
      // One amplitude for bark and leaves: the envelope is shared, so any difference would
      // slide each leaf off its twig by the gap between them.
      amplitude: 0.3,
      frequency: 1.3,
      phase,
      base: 0,
      extent,
      direction: [1, 0.35],
    });
    mesh.material = wind.material;
    wind.expandBounds(mesh.geometry);
    return wind;
  });
}
