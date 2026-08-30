// Generated for you. This is ordinary Three.js — edit or delete it freely.
// ThreeNative does not read this file.
//
// This game is indoors. The dome and the fog the starter shipped are gone: a fog term
// added to every fragment is a constant added to every SSGI sample too, and it lifts the
// black the whole comparison depends on.
import { Color, type ColorRepresentation, type Scene } from "three";
import { palette } from "./palette.js";

type SkyOptions = { readonly bottom: ColorRepresentation; readonly top: ColorRepresentation };

export function setupSky(scene: Scene, options?: SkyOptions): void {
  const resolved = options ?? { bottom: palette.skyLow, top: palette.skyHigh };
  if (resolved.top === undefined || resolved.bottom === undefined)
    throw new TypeError("setupSky requires both top and bottom colors.");
  scene.background = new Color(resolved.top);
  scene.fog = null;
}
