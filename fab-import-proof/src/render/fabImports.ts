import type { ICtx } from "@threenative/core";
import { Box3, type Group, Mesh, Vector3 } from "three";
import type { IPhysicsContext } from "@threenative/physics";
import type { GameState } from "../state.js";

/**
 * The three assets imported straight out of an owned Fab Unreal listing by
 * `fab_import_asset`. They are placed at their authored size and orientation — nothing here
 * scales or rotates them — because the point of the scene is whether one Unreal metre arrived
 * as one ThreeNative metre, right way up, with its textures attached.
 */
export interface IFabImport {
  readonly key: string;
  readonly path: string;
  readonly position: readonly [number, number, number];
  /** Authored height in metres, from the importer's report. The scene fails if it drifts. */
  readonly expectedHeight: number;
}

export const FAB_IMPORTS: readonly IFabImport[] = [
  {
    key: "soulRock",
    path: "fab/soul-cave/SoulCave/Environment/Meshes/Rocks/SM_S_Soul_Flatrock.glb",
    position: [-3.4, 0, -1.4],
    expectedHeight: 1.23,
  },
  {
    key: "soulStatue",
    path: "fab/soul-cave/SoulCave/Environment/Meshes/Building/SM_S_Soul_Statue.glb",
    position: [-0.2, 0, -2.4],
    expectedHeight: 3.86,
  },
  {
    key: "soulTree",
    path: "fab/soul-cave/SoulCave/Environment/Meshes/Nature/SM_LV_Soul_Tree01_B.glb",
    position: [3.6, 0, -4.2],
    expectedHeight: 8.19,
  },
];

export interface ILoadedFabImport extends IFabImport {
  readonly scene: Group;
  readonly measuredHeight: number;
  readonly texturedMeshes: number;
  readonly maskedMeshes: number;
}

/** Loads every imported model through the normal manifest path a game uses for any other asset. */
export async function loadFabImports(
  ctx: ICtx<GameState, IPhysicsContext>,
): Promise<ILoadedFabImport[]> {
  const loaded = await Promise.all(
    FAB_IMPORTS.map(async (entry) => {
      const model = await ctx.assets.model<{ scene: Group }>(entry.path);
      const size = new Box3().setFromObject(model.scene).getSize(new Vector3());
      let texturedMeshes = 0;
      let maskedMeshes = 0;
      model.scene.traverse((object) => {
        if (!(object instanceof Mesh)) return;
        object.castShadow = true;
        object.receiveShadow = true;
        const material = Array.isArray(object.material) ? object.material[0] : object.material;
        const map = (material as { map?: unknown } | undefined)?.map;
        if (map) texturedMeshes += 1;
        if ((material as { alphaTest?: number } | undefined)?.alphaTest) maskedMeshes += 1;
      });
      return {
        ...entry,
        scene: model.scene,
        measuredHeight: size.y,
        texturedMeshes,
        maskedMeshes,
      };
    }),
  );

  for (const entry of loaded) {
    // One Unreal metre must be one ThreeNative metre. A silent scale factor is the failure this
    // scene exists to catch, and it is invisible in a screenshot without a reference beside it.
    const drift = Math.abs(entry.measuredHeight - entry.expectedHeight);
    if (drift > entry.expectedHeight * 0.05) {
      throw new Error(
        `Imported ${entry.key} is ${entry.measuredHeight.toFixed(2)} m tall; the importer reported ${entry.expectedHeight} m.`,
      );
    }
    if (entry.texturedMeshes === 0) {
      throw new Error(`Imported ${entry.key} rendered with no base colour texture bound.`);
    }
  }

  console.info(
    `TN_FAB_IMPORT_LOADED:${loaded
      .map((entry) => `${entry.key}=${entry.measuredHeight.toFixed(2)}m/${entry.texturedMeshes}tex/${entry.maskedMeshes}mask`)
      .join(",")}`,
  );
  return loaded;
}

/** Adds the loaded models to the scene at their authored transform. */
export function placeFabImports(
  ctx: ICtx<GameState, IPhysicsContext>,
  loaded: readonly ILoadedFabImport[],
): void {
  for (const entry of loaded) {
    entry.scene.name = entry.key;
    entry.scene.position.set(entry.position[0], entry.position[1], entry.position[2]);
    ctx.add(entry.scene);
    ctx.entities.add(entry.key, entry.scene);
  }
}
