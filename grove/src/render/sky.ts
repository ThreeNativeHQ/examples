// Generated for you. This is ordinary Three.js — edit or delete it freely.
// The atmosphere object is mechanism; this file owns the mesh, material, and exposure.
import { BackSide, Color, Fog, Mesh, type Scene, SphereGeometry } from "three";
import { cameraPosition, color, mix, normalize, positionWorld, smoothstep } from "three/tsl";
import { MeshBasicNodeMaterial } from "three/webgpu";
import { palette } from "./palette.js";

type AtmosphereLike = {
  radiance(direction: unknown): unknown;
};

export function setupSky(scene: Scene, atmosphere?: AtmosphereLike): void {
  const top = new Color(palette.skyHigh);
  if (atmosphere === undefined) {
    scene.background = top;
    scene.fog = null;
    return;
  }

  // A game-owned gradient, not `atmosphere.radiance`: this template's radiance dome read as a dark
  // grey, faceted vault over a daytime grove (captures in FRICTION.md). The atmosphere still
  // aims and colours the sun in lighting.ts; the sky and the fog share one horizon colour so the
  // far trees dissolve into it instead of stopping at a line.
  const geometry = new SphereGeometry(16_000, 32, 16);
  const material = new MeshBasicNodeMaterial({ fog: false, side: BackSide, toneMapped: false });
  const viewDirection = normalize(positionWorld.sub(cameraPosition));
  material.colorNode = mix(
    color(palette.skyLow),
    color(palette.skyHigh),
    smoothstep(-0.02, 0.45, viewDirection.y),
  );
  const dome = new Mesh(geometry, material);
  // The dome is authored at the origin and never moves; freeze only this known-static render
  // object, leaving gameplay transforms under user control.
  dome.updateMatrix();
  dome.matrixAutoUpdate = false;
  dome.frustumCulled = false;
  scene.background = null;
  scene.fog = new Fog(palette.skyLow, 45, 170);
  scene.add(dome);
}
