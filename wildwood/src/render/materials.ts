// Generated for you. This is ordinary Three.js — edit or delete it freely.
// ThreeNative does not read this file.
//
// The materials for everything that is *not* ground, water, or foliage: the landmarks the player
// walks out to find. Each is deliberately a little apart from the palette of the wood around it,
// because a landmark that blends in is not a landmark.
import { Color, DoubleSide, MeshBasicMaterial, MeshStandardMaterial, type Texture } from "three";
import { MeshBasicNodeMaterial } from "three/webgpu";
import { palette } from "./palette.js";

export function createMaterials() {
  return {
    // The standing stone and the cairn: pale, matte, and cool against the warm ground.
    stone: new MeshStandardMaterial({ color: palette.stone, roughness: 0.94, metalness: 0 }),
    // Wet dark stone for the shrine's basin, which is the one shiny thing in the valley.
    slick: new MeshStandardMaterial({ color: new Color(palette.stone).multiplyScalar(0.42), roughness: 0.22, metalness: 0.08 }),
    // Dead wood: the fallen giant, the trail posts, the stumps around the camp.
    deadwood: new MeshStandardMaterial({ color: new Color(palette.bark).multiplyScalar(1.25), roughness: 0.95, metalness: 0 }),
    // The charcoal ring, near black so the burnt ground reads even in shade.
    char: new MeshStandardMaterial({ color: 0x1c1a17, roughness: 1, metalness: 0 }),
    // Embers and the trailhead's painted blaze — the two warm accents in the whole valley.
    ember: new MeshStandardMaterial({
      color: palette.ember,
      emissive: new Color(palette.ember).multiplyScalar(0.55),
      metalness: 0,
      roughness: 0.6,
    }),
    // Reeds at the water's edge. Unlit: they stand against bright water and a standard material
    // there goes to silhouette anyway, so the flat colour costs nothing and reads cleaner.
    reed: new MeshBasicMaterial({ color: new Color(palette.blade).multiplyScalar(0.8), side: DoubleSide }),
  };
}

/** The trailhead banner owns its sampled, double-sided look. */
export function createBannerMaterial(texture: Texture): MeshBasicNodeMaterial {
  return new MeshBasicNodeMaterial({ map: texture, side: DoubleSide });
}
