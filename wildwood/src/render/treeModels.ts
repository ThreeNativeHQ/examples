// Generated for you. This is ordinary Three.js — edit or delete it freely.
// ThreeNative does not read this file.
//
// Planting a real tree model instead of a procedural one.
//
// The valley's trees were hand-authored cones and spheres because the reference pack's meshes
// would not import (uncooked UE4 object version 514 — see `FRICTION.md`). This file is the other
// half of that story: given a GLB that *does* load, it turns it into the same instanced meshes the
// scatter already places, so swapping stand-ins for the real thing is a change of source, not a
// rewrite of the wood.
//
// Two things a converted tree needs before it can be instanced, and both are easy to get wrong:
//
// 1. **One geometry per material.** A GLB tree is a small hierarchy — trunk, branches, needle
//    cards — each with its own material and its own local transform. `InstancedMesh` draws one
//    geometry with one material, so the hierarchy has to be flattened into groups, with every
//    node's world transform baked into its vertices first. Skipping the bake plants the trunk in
//    the right place and leaves the needles at the origin.
// 2. **A known scale and footing.** Unreal authors in centimetres and Three.js in metres, and a
//    tree whose origin sits at its centre rather than its base floats or buries itself. Both are
//    measured here rather than assumed.
import {
  type BufferGeometry,
  Box3,
  Matrix4,
  Mesh,
  type Material,
  type Object3D,
  Vector3,
} from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

/** One drawable part of a tree: everything in the model that shared a material. */
export interface ITreePart {
  readonly geometry: BufferGeometry;
  readonly material: Material;
}

export interface ITreeModel {
  readonly parts: readonly ITreePart[];
  /** Height in metres after normalisation, so the scatter can size it sensibly. */
  readonly height: number;
}

/**
 * Flatten a loaded tree into one geometry per material, based at its own feet and scaled to metres.
 *
 * `targetHeight` is what the tallest axis becomes. Pass the height you want the species to be in
 * the world and the source file's units stop mattering — which is the point, because a converted
 * Unreal asset arrives in centimetres and a hand-made one arrives in whatever the artist used.
 */
export function prepareTree(root: Object3D, targetHeight: number): ITreeModel {
  root.updateWorldMatrix(true, true);

  // Measure before touching anything: the bounding box of the whole hierarchy in its own space.
  const bounds = new Box3().setFromObject(root);
  const size = new Vector3();
  bounds.getSize(size);
  const tallest = Math.max(size.x, size.y, size.z, 1e-6);
  const scale = targetHeight / tallest;

  // Bake world transform, scale, and a translation that puts the model's lowest point at y = 0.
  // Doing all three in one matrix means each vertex is touched once.
  const bake = new Matrix4()
    .makeTranslation(0, -bounds.min.y * scale, 0)
    .multiply(new Matrix4().makeScale(scale, scale, scale));

  const byMaterial = new Map<Material, BufferGeometry[]>();
  root.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    const material = Array.isArray(object.material) ? object.material[0] : object.material;
    if (material === undefined) return;
    const geometry = object.geometry.clone();
    // The node's own world matrix first, then the shared bake. Without the world matrix a branch
    // authored three metres up the trunk is planted at the tree's feet.
    geometry.applyMatrix4(object.matrixWorld);
    geometry.applyMatrix4(bake);
    // `mergeGeometries` refuses a mix of indexed and non-indexed inputs, and returns null rather
    // than saying so — the same trap `foliage.ts` documents. Normalise before grouping.
    const normalised = geometry.index === null ? geometry : geometry.toNonIndexed();
    const group = byMaterial.get(material);
    if (group === undefined) byMaterial.set(material, [normalised]);
    else group.push(normalised);
  });

  const parts: ITreePart[] = [];
  for (const [material, group] of byMaterial) {
    const merged = group.length === 1 ? group[0] : mergeGeometries(group, false);
    if (merged === undefined || merged === null) {
      throw new Error(`A tree part failed to merge for material ${material.name || "(unnamed)"}.`);
    }
    parts.push({ geometry: merged, material });
  }
  if (parts.length === 0) throw new Error("The tree model contained no meshes.");

  return { height: targetHeight, parts };
}
