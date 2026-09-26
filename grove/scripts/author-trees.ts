/**
 * Offline authoring step, never shipped: generate the four tree variants and bake each one to a
 * binary glTF the game loads instead of running the generator. Run it with `pnpm trees`; the npm
 * script bundles this file with esbuild for Node first, because the donor is unbuilt JavaScript and
 * only a bundle can carry its `ez-tree-source/lib` alias out of the game build.
 *
 * The species configuration lives here and nowhere else — at runtime a tree is data, not code.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { MeshStandardMaterial } from "three";
import { treeToGlb } from "../src/vegetation/export.js";
import { generateTree, type TreeOptions } from "../src/vegetation/tree.js";

/** Four variants; every tree in the grove is a clone of one of them. */
const SEEDS = [11, 23, 37, 51] as const;
const OUT = resolve(import.meta.dirname, "../assets/trees");

/**
 * A deciduous tree at grove scale, in metres. The donor's own defaults are a 20 m trunk with 20 m
 * primary branches, so only the fields that set size are touched: length, radius and leaf size.
 * Everything else — branch angle, gnarliness, taper, leaf placement — stays at the donor's values,
 * which already describe a believable broadleaf tree.
 */
function configureDeciduous(options: TreeOptions, levels: number): void {
  options.branch.levels = levels;
  options.branch.length = { 0: 5.4, 1: 4.2, 2: 2.6, 3: 1.2 };
  options.branch.radius = { 0: 0.42, 1: 0.24, 2: 0.13, 3: 0.07 };
  options.branch.children = { 0: 6, 1: 4, 2: 3 };
  options.branch.sections = { 0: 10, 1: 8, 2: 6, 3: 4 };
  options.branch.segments = { 0: 8, 1: 6, 2: 4, 3: 3 };
  options.leaves.count = 12;
  options.leaves.size = 1.15;
  options.leaves.sizeVariance = 0.6;
}

// Throwaway materials: the GLB gets the exporter's neutral placeholders and the game re-materializes.
const trunk = new MeshStandardMaterial();
const leaf = new MeshStandardMaterial();
await mkdir(OUT, { recursive: true });
try {
  for (const [index, seed] of SEEDS.entries()) {
    const variant = generateTree({
      seed,
      trunkMaterial: trunk,
      leafMaterial: leaf,
      maxVertices: 120_000,
      configure: (options) => configureDeciduous(options, index % 2 === 0 ? 2 : 3),
    });
    try {
      const glb = await treeToGlb(variant);
      const file = resolve(OUT, `tree-${seed}.glb`);
      await writeFile(file, glb);
      console.log(`${file} vertices=${variant.vertices} height=${variant.height} bytes=${glb.byteLength}`);
    } finally {
      variant.dispose();
    }
  }
} finally {
  trunk.dispose();
  leaf.dispose();
}
