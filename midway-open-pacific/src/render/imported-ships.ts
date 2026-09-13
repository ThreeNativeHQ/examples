/** Supplied carriers, exported with Blender MCP: metres, bow -Z, deck Y=20.06. */
import type { ICtx } from "@threenative/core";
import * as T from "three";
import type { GLTF } from "three/addons/loaders/GLTFLoader.js";
import type { WebGPURenderer } from "three/webgpu";

// Clear, centered launch rectangles measured by raycasting the tapered flight decks.
export const DECKS = {
  enterprise: { length: 220, width: 20, visualLength: 251.58, height: 20.06 },
  hornet: { length: 220, width: 20, visualLength: 251.58, height: 20.06 },
  // Akagi's original stern deck slopes down ~1.4m; height is its central deck datum.
  akagi: { length: 220, width: 20, visualLength: 260.67, height: 20.06 },
} as const;

let hornet: GLTF;
let mitchell: GLTF;
let akagi: GLTF;

export async function loadImportedShips(ctx: Pick<ICtx, "assets" | "renderer">): Promise<void> {
  [hornet, mitchell, akagi] = await Promise.all([
    ctx.assets.model<GLTF>("/assets/hornet.glb"),
    ctx.assets.model<GLTF>("/assets/b25-mitchell.glb"),
    ctx.assets.model<GLTF>("/assets/akagi.glb"),
  ]);
  const anisotropy = (ctx.renderer.raw as WebGPURenderer).getMaxAnisotropy();
  for (const source of [hornet, mitchell, akagi]) {
    source.scene.traverse((node) => {
      if (!(node instanceof T.Mesh)) return;
      for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
        for (const value of Object.values(material)) {
          if (value instanceof T.Texture) {
            value.anisotropy = anisotropy;
            value.needsUpdate = true;
          }
        }
      }
    });
  }
}

function cloneModel(source: GLTF | undefined): T.Group {
  if (!source) throw new Error("Load imported ships before constructing their instances.");
  // Static hierarchy clones share geometry, materials and textures owned by ctx.assets.
  const model = source.scene.clone(true);
  model.traverse((node) => {
    if (node instanceof T.Mesh) {
      node.castShadow = true;
      node.receiveShadow = true;
    }
  });
  return model;
}

export function createCarrier(id: keyof typeof DECKS): T.Group {
  // The supplied Hornet contains the detailed Enterprise-1944 hull. Use that WWII
  // sister-ship geometry for CV-6; the CVN-80's single 1K atlas fails close deck views.
  const model = cloneModel({ enterprise: hornet, hornet, akagi }[id]);
  model.name = { enterprise: "USS Enterprise", hornet: "USS Hornet", akagi: "IJN Akagi" }[id];
  model.userData.importedShip = true;
  return model;
}

/** One B-25 detached from the nine identical aircraft on Hornet; original detail retained. */
export function createMitchell(): T.Group {
  const model = cloneModel(mitchell);
  model.name = "B-25 Mitchell";
  model.position.y = -new T.Box3().setFromObject(model).min.y;
  model.userData.importedAircraft = true;
  return model;
}
