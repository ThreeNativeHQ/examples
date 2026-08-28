// Ordinary Three.js. High midday sun over a Mediterranean coast: a hot, barely
// warm key, crisp shadows, and a sky that fills the shade blue.
//
// The totals here assume `sky.ts` has installed the equirect sky as
// `scene.environment` at intensity ~1.15. That image-based fill is doing the
// work the old hemisphere light did, so hemisphere and ambient are trimmed to
// almost nothing; leaving them at their previous strength on top of a real
// environment washes every upward face to paper.
import { AmbientLight, DirectionalLight, HemisphereLight, type Scene } from "three";
import { palette } from "./palette.js";

type ShadowRenderer = { shadowMap: { enabled: boolean; type: number } };

export function setupLighting(scene: Scene, renderer: ShadowRenderer): DirectionalLight {
  if (renderer?.shadowMap !== undefined) {
    // PRD-227 Phase 4: Bayview's town-wide dynamic shadow pass resubmitted hundreds of
    // already-lit meshes every frame. On the Pixel 8 that left render.p50 at 29.53 ms after
    // the one-crossing host fix. The authored IBL, hemisphere bounce, rounded geometry and
    // contact-dark materials retain depth without paying for a second town render.
    renderer.shadowMap.enabled = false;
  }

  // The town is 84 m across, so the shadow frustum has to cover it whole: a
  // smaller box pops shadows in and out at the edges of the frame. Midday sun
  // sits high and slightly south-west, which is what throws the short hard
  // shadows the reference frames show down the lanes.
  const sun = new DirectionalLight(0xfff4e0, 2.7);
  sun.position.set(-30, 74, 30);
  sun.castShadow = false;
  scene.add(sun);
  scene.add(sun.target);
  sun.target.position.set(-2, 0, -2);

  // A trim on top of the environment: sky blue down, warm stone bounce up, so
  // north-facing plaster keeps a little colour instead of crushing to grey.
  scene.add(new HemisphereLight(palette.skyHigh, palette.sand, 0.34));
  scene.add(new AmbientLight(0xffffff, 0.05));
  return sun;
}
