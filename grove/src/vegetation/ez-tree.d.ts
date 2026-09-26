// The pinned EZ Tree source revision is plain JavaScript with no published types, and its
// package.json `exports` map exposes only the prebuilt browser bundle that eagerly loads
// textures. `vite.config.ts` aliases `ez-tree-source/lib` to `src/lib/index.js`; this declares
// what that file exports. The per-level maps are keyed by the literal level indices the donor
// indexes them with, so `noUncheckedIndexedAccess` does not make them `number | undefined`.
declare module "ez-tree-source/lib" {
  import { Group, Material, Mesh } from "three";

  export type TreeOptions = {
    seed: number;
    type: string;
    bark: {
      type: string;
      maps: { color: unknown; ao: unknown; normal: unknown; roughness: unknown };
      tint: number;
      flatShading: boolean;
      textured: boolean;
      textureScale: { x: number; y: number };
    };
    branch: {
      levels: number;
      angle: Record<1 | 2 | 3, number>;
      children: Record<0 | 1 | 2, number>;
      force: { direction: { x: number; y: number; z: number }; strength: number };
      gnarliness: Record<0 | 1 | 2 | 3, number>;
      length: Record<0 | 1 | 2 | 3, number>;
      radius: Record<0 | 1 | 2 | 3, number>;
      sections: Record<0 | 1 | 2 | 3, number>;
      segments: Record<0 | 1 | 2 | 3, number>;
      start: Record<1 | 2 | 3, number>;
      taper: Record<0 | 1 | 2 | 3, number>;
      twist: Record<0 | 1 | 2 | 3, number>;
    };
    leaves: {
      type: string;
      map: unknown;
      billboard: string;
      angle: number;
      count: number;
      start: number;
      size: number;
      sizeVariance: number;
      tint: number;
      alphaTest: number;
      roundedNormals: boolean;
    };
    trellis: {
      enabled: boolean;
      visible: boolean;
      position: { x: number; y: number; z: number };
      width: number;
      height: number;
      spacing: number;
      force: { strength: number; maxDistance: number; falloff: number };
      cylinderRadius: number;
      color: number;
    };
  };

  export class Tree extends Group {
    options: TreeOptions;
    branchesMesh: Mesh<Material>;
    leavesMesh: Mesh<Material>;
    generate(): void;
  }
}
