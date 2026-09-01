// Generated for you. This is ordinary Three.js — edit or delete it freely.
// ThreeNative does not read this file.
//
// A hazy overcast-bright sky, and — more importantly for a forest — the fog.
//
// Fog is doing real work here, not atmosphere. A wood is thousands of near-identical green objects
// at every distance, and without depth cueing the far trees and the near trees are the same colour
// and the scene has no depth at all. The near plane sits well past where the player is standing so
// the ground they are walking on stays saturated, and the far plane is a little short of the ridge
// so the ridge reads as *far* rather than as a wall three metres behind the last tree.
import {
  BackSide,
  BufferAttribute,
  Color,
  type ColorRepresentation,
  Fog,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  type Scene,
  SphereGeometry,
} from "three";
import { palette } from "./palette.js";

type SkyOptions = { readonly bottom: ColorRepresentation; readonly top: ColorRepresentation };

export function setupSky(scene: Scene, options?: SkyOptions): void {
  const resolved = options ?? { bottom: palette.skyLow, top: palette.skyHigh };
  if (resolved.top === undefined || resolved.bottom === undefined)
    throw new TypeError("setupSky requires both top and bottom colors.");

  const top = new Color(resolved.top);
  const bottom = new Color(resolved.bottom);
  // Larger than the starter's 90: this valley is 190 m across, and a dome that fits inside it
  // shows its own back wall through the trees.
  const radius = 400;
  const geometry = new SphereGeometry(radius, 32, 16);
  const positions = geometry.getAttribute("position");
  const colors = new Float32Array(positions.count * 3);
  const color = new Color();
  for (let index = 0; index < positions.count; index += 1) {
    const height = MathUtils.clamp((positions.getY(index) / radius + 0.15) / 0.6, 0, 1);
    color.copy(bottom).lerp(top, height);
    colors.set([color.r, color.g, color.b], index * 3);
  }
  geometry.setAttribute("color", new BufferAttribute(colors, 3));
  const dome = new Mesh(
    geometry,
    // `fog: false` or the whole dome sits past the far plane and renders as one flat fog-coloured
    // wash — the gradient authored just above never reaches the screen.
    new MeshBasicMaterial({ fog: false, side: BackSide, toneMapped: false, vertexColors: true }),
  );
  dome.updateMatrix();
  dome.matrixAutoUpdate = false;
  dome.frustumCulled = false;
  scene.background = new Color(palette.fog);
  scene.fog = new Fog(palette.fog, 110, 400);
  scene.add(dome);
}
