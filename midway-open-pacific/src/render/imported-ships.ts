/** Supplied carriers, exported with Blender MCP: metres, bow -Z, deck Y=20.06. */
import type { ICtx } from "@threenative/core";
import * as T from "three";
import type { GLTF } from "three/addons/loaders/GLTFLoader.js";
import { shipClass, UnknownShipClassError } from "../sim/catalog.js";
import {
  applyAnisotropy,
  createHammann,
  createHiryu,
  createI168,
  createKaga,
  createKageroDestroyer,
  createMogamiCruiser,
  createNautilus,
  createSoryu,
  createToneCruiser,
  createYorktown,
} from "./imported-fleet.js";

/**
 * Flight decks, in metres: `length` by `width` is the launch rectangle, `visualLength` the hull a
 * player sees, `height` the deck above the keel.
 *
 * Enterprise, Hornet and Akagi were surveyed by raycasting their own tapered decks
 * (tools/capture-deck.mjs), which is where their conservative 220x20 corridor comes from. The
 * imported carriers take their rectangle from the class references in src/sim/catalog.ts and their
 * deck datum from the shipped GLB, as the elevation carrying the largest upward-facing triangle
 * area — a method that reproduces Hornet's surveyed 20.06 m to within 0.10 m. A class reference is
 * not a survey, so an imported carrier that ever becomes the player's home deck wants the raycast
 * pass first.
 */
export const DECKS = {
  enterprise: { length: 220, width: 20, visualLength: 251.58, height: 20.06 },
  hornet: { length: 220, width: 20, visualLength: 251.58, height: 20.06 },
  // Akagi's original stern deck slopes down ~1.4m; height is its central deck datum.
  akagi: { length: 220, width: 20, visualLength: 260.67, height: 20.06 },
  kaga: deck("kaga", 23.47),
  soryu: deck("soryu", 20.42),
  hiryu: deck("hiryu", 20.6),
  yorktown: deck("yorktown", 20.45),
} as const;

function deck(classId: string, height: number) {
  const cls = shipClass(classId);
  return { length: cls.hullLength, width: cls.hullBeam, visualLength: cls.measuredLength, height };
}

let hornet: GLTF;
let mitchell: GLTF;
let akagi: GLTF;

export async function loadImportedShips(ctx: Pick<ICtx, "assets" | "renderer">): Promise<void> {
  [hornet, mitchell, akagi] = await Promise.all([
    ctx.assets.model<GLTF>("/assets/hornet.glb"),
    ctx.assets.model<GLTF>("/assets/b25-mitchell.glb"),
    ctx.assets.model<GLTF>("/assets/akagi.glb"),
  ]);
  applyAnisotropy(ctx, [hornet, mitchell, akagi]);
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
 * All four now have their own hull: Akagi was supplied with the project, and Kaga, Soryu and Hiryu
 * were imported from their own models, so nothing here stands in for anything. Akagi keeps its
 * literal because it is the supplied model and has no class record; the other three read their
 * length and beam from src/sim/catalog.ts rather than restating it.
 */
const ijnCarrier = (classId: string) => {
  const cls = shipClass(classId);
  return { length: cls.hullLength, beam: cls.hullBeam };
};

export const IJN_CARRIERS: Record<string, { length: number; beam: number }> = {
  Akagi: { length: 260.67, beam: 31.3 },
  Kaga: ijnCarrier("kaga"),
  Soryu: ijnCarrier("soryu"),
  Hiryu: ijnCarrier("hiryu"),
};

/** One supplied hull, cloned and named. */
function supplied(source: GLTF | undefined, name: string): T.Group {
  const model = cloneModel(source);
  model.name = name;
  model.userData.importedShip = true;
  return model;
}

const CARRIER_MODELS: Record<keyof typeof DECKS, () => T.Group> = {
  // The supplied Hornet contains the detailed Enterprise-1944 hull. Use that WWII
  // sister-ship geometry for CV-6; the CVN-80's single 1K atlas fails close deck views.
  enterprise: () => supplied(hornet, "USS Enterprise"),
  hornet: () => supplied(hornet, "USS Hornet"),
  akagi: () => supplied(akagi, "IJN Akagi"),
  kaga: createKaga,
  soryu: createSoryu,
  hiryu: createHiryu,
  yorktown: createYorktown,
};

/** An IJN carrier by ship name. Anything but the four named ships falls back to the Akagi hull. */
export function createIjnCarrier(name: string): T.Group {
  const own = { Kaga: createKaga, Soryu: createSoryu, Hiryu: createHiryu }[name];
  return own ? own() : supplied(akagi, `IJN ${name}`);
}

export function createCarrier(id: keyof typeof DECKS): T.Group {
  return CARRIER_MODELS[id]();
}

/**
 * The one place a catalog classId becomes a model. Where a class covered more than one ship at
 * Midway the creator takes a name, and this dispatch passes the lead ship: a caller that knows it
 * is building Chikuma, Mikuma or Nowaki should call that class's creator with the real name.
 */
const SHIP_MODELS: Record<string, () => T.Group> = {
  kaga: createKaga,
  soryu: createSoryu,
  hiryu: createHiryu,
  yorktown: createYorktown,
  tone: () => createToneCruiser("Tone"),
  mogami: () => createMogamiCruiser("Mogami"),
  kagero: () => createKageroDestroyer("Kagero"),
  hammann: createHammann,
  i168: createI168,
  nautilus: createNautilus,
};

export function shipModelFor(classId: string): T.Group {
  const create = SHIP_MODELS[classId];
  if (!create) throw new UnknownShipClassError(classId);
  return create();
}

/** One B-25 detached from the nine identical aircraft on Hornet; original detail retained. */
export function createMitchell(): T.Group {
  const model = cloneModel(mitchell);
  model.name = "B-25 Mitchell";
  model.position.y = -new T.Box3().setFromObject(model).min.y;
  model.userData.importedAircraft = true;
  return model;
}
