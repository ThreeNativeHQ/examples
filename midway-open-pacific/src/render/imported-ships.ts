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

/**
 * The Japanese carriers, at the size each ship actually measured.
 *
 * Only Akagi was supplied with a model. Kaga, Soryu and Hiryu borrow that hull scaled to their
 * own length, which is a class substitution and not those ships: in reality Kaga and Soryu
 * carried their islands to starboard where Akagi and Hiryu carried theirs to port, and the funnel
 * arrangements differ. Those distinctions survive in the differentiated procedural hulls behind
 * the LOD; what this buys is a carrier that reads as a warship at attack range instead of a box.
 */
export const IJN_CARRIERS: Record<string, { length: number; beam: number }> = {
  Akagi: { length: 260.67, beam: 31.3 },
  Kaga: { length: 247.65, beam: 32.5 },
  Soryu: { length: 227.5, beam: 21.3 },
  Hiryu: { length: 227.4, beam: 22.3 },
};

export function createIjnCarrier(name: string): T.Group {
  const ship = IJN_CARRIERS[name] ?? IJN_CARRIERS.Akagi;
  const model = cloneModel(akagi);
  model.scale.setScalar(ship.length / IJN_CARRIERS.Akagi.length);
  model.name = `IJN ${name}`;
  model.userData.importedShip = true;
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
