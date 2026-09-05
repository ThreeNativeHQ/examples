// Ordinary Three.js — edit or delete it freely. ThreeNative does not read this file.
//
// One material per role, shared by every mesh that plays that role, so the whole vault is a
// couple of dozen draw-call-sharing surfaces rather than four hundred unique ones.
import {
  Color,
  DoubleSide,
  type Material,
  MeshBasicMaterial,
  MeshStandardMaterial,
  type Texture,
} from "three";
import { palette } from "./palette.js";

export interface IVaultMaterials {
  readonly floor: Material;
  readonly floorSeam: Material;
  readonly wall: Material;
  readonly wallBase: Material;
  readonly timber: Material;
  readonly timberLight: Material;
  readonly crate: readonly Material[];
  readonly crateBrace: Material;
  readonly phase: Material;
  readonly phaseCore: Material;
  readonly lantern: Material;
  readonly warden: Material;
  readonly wardenDark: Material;
  readonly banner: Material;
  readonly seal: Material;
  readonly sealRim: Material;
}

export function createMaterials(): IVaultMaterials {
  return {
    floor: new MeshStandardMaterial({ color: palette.floor, roughness: 0.86, metalness: 0.04 }),
    floorSeam: new MeshStandardMaterial({ color: palette.floorSeam, roughness: 0.95 }),
    wall: new MeshStandardMaterial({ color: palette.wall, roughness: 0.92 }),
    wallBase: new MeshStandardMaterial({ color: palette.wallBase, roughness: 0.9 }),
    timber: new MeshStandardMaterial({ color: palette.timber, roughness: 0.82 }),
    timberLight: new MeshStandardMaterial({ color: palette.timberLight, roughness: 0.74 }),
    // Three crate colours, alternated across the pile by a seeded draw. Surface variety comes
    // from the palette, never from a bitmap: CanvasTexture samples BLACK under WebGPURenderer.
    crate: [
      new MeshStandardMaterial({ color: palette.crateRed, roughness: 0.72 }),
      new MeshStandardMaterial({ color: palette.crateTeal, roughness: 0.72 }),
      new MeshStandardMaterial({ color: palette.crateAmber, roughness: 0.72 }),
    ],
    crateBrace: new MeshStandardMaterial({ color: palette.crateBrace, roughness: 0.86 }),
    // The phase crate: a glass shell that lets the room through, plus an emissive edge cage so
    // it still reads as a solid-shaped object rather than a smudge.
    phase: new MeshStandardMaterial({
      color: palette.phase,
      emissive: new Color(palette.phase).multiplyScalar(0.5),
      metalness: 0,
      opacity: 0.55,
      roughness: 0.1,
      transparent: true,
    }),
    // Dimmer than the palette entry: at full value the ward clips to white under bloom and
    // stops reading as a crate-shaped thing at all.
    phaseCore: new MeshBasicMaterial({ color: new Color(palette.phase).multiplyScalar(0.62) }),
    lantern: new MeshBasicMaterial({ color: palette.lantern }),
    warden: new MeshStandardMaterial({ color: palette.warden, roughness: 0.62 }),
    wardenDark: new MeshStandardMaterial({
      color: new Color(palette.warden).multiplyScalar(0.72),
      roughness: 0.7,
    }),
    banner: new MeshStandardMaterial({
      color: palette.banner,
      roughness: 0.95,
      side: DoubleSide,
    }),
    // The seal in the floor is the destination and the only cool light source in the room; it is
    // unlit on purpose so the lanterns cannot change what colour "the way out" is.
    seal: new MeshBasicMaterial({ color: palette.phase }),
    // Cut stone. It was emissive for one iteration and the whole plate clipped to a white square
    // under bloom; the seal is supposed to be the bright thing, not its kerb.
    sealRim: new MeshStandardMaterial({ color: palette.sealStone, roughness: 0.82 }),
  };
}

/** The packaged proof glTF is hung on the east wall as a banner; it owns its sampled look. */
export function createBannerMaterial(texture: Texture): Material {
  return new MeshBasicMaterial({ map: texture, side: DoubleSide });
}
