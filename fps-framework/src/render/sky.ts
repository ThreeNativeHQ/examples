// The shipped sky is an equirectangular outdoor photograph used three ways at
// once: as the visible background, as the scene's image-based light, and as the
// colour the fog fades distance toward. Keeping all three off one image is what
// makes the town sit in its weather instead of floating in front of a backdrop.
//
// `bayview-sky.jpg` is Poly Haven's partly-cloudy midday pure sky, tonemapped to
// an equirect JPEG. The previous `sky.jpg` was an overcast grey, and an overcast
// environment is most of why the whole scene read flat: with no blue overhead
// there was nothing to separate a sunlit wall from a shaded one.
import {
  EquirectangularReflectionMapping,
  Fog,
  SRGBColorSpace,
  type Scene,
  type Texture,
} from "three";
import { palette } from "./palette.js";

export function setupSky(scene: Scene, environment?: Texture): void {
  if (environment !== undefined) {
    // This JPEG is authored in sRGB; leaving it linear washes out the blue channel and
    // loses the high-cloud contrast in the supplied reference.
    environment.colorSpace = SRGBColorSpace;
    environment.mapping = EquirectangularReflectionMapping;
    scene.background = environment;
    scene.environment = environment;
    // The sky is now the main fill: it carries the blue that shaded plaster
    // bounces, so the hemisphere light in lighting.ts drops back to a trim.
    scene.environmentIntensity = 0.92;
    // A hair under the environment so the horizon does not out-punch whitewash
    // that is taking direct sun.
    scene.backgroundIntensity = 1.0;
    // Sea haze, matched to the sky's own horizon so distance dissolves into the
    // background rather than greying out in front of it. It starts well past
    // the far side of the 84 m deck: fogging the town itself is what made the
    // old frames look washed out at range.
    scene.fog = new Fog(palette.haze, 110, 340);
    return;
  }
  scene.background = null;
  scene.backgroundIntensity = 1;
  scene.fog = null;
}
