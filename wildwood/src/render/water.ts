// Generated for you. This is ordinary Three.js — edit or delete it freely.
// ThreeNative does not read this file.
//
// The lake and the pond, and the one thing that decides whether water reads as water.
//
// Water is three readings composited: the sky mirrored in the surface, the bed seen through it,
// and how much water stands between the two. `WaterSurface3D` takes all three — the mirrored
// camera and its render target, the frame beneath the surface, and the scene depth turned into
// **metres** — and hands them back as nodes. Every colour below is this file's; the engine
// chooses none of them.
//
// What is left here is the ripple, and the ripple is where water usually goes wrong. Stamping a
// normal map over the surface, or adding `sin(worldZ * k)` highlight bands, puts a period into
// the picture, and the eye finds a period in about a second: the surface stops being water and
// becomes wallpaper. There is not one such term in this file. The normal comes from
// `WaveField.normalNode` — the analytic derivative of a sum of eight waves whose wavelengths share
// no common multiple — so the pattern repeats only where all eight line up again, which within
// this valley is nowhere.
//
// A second trick worth keeping: the pond does not move and neither does the ground under it, so
// the *vertex* depth is baked once at build time, straight out of the same `heightAt` the terrain
// and the collider use. That is what welds the ripple to the shoreline — waves fade to nothing in
// the last handspan of water instead of rippling through the bank.
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  Mesh,
  Vector2,
  Vector3,
} from "three";
import { WaterSurface3D, WaveField } from "@threenative/core";
import { MeshBasicNodeMaterial } from "three/webgpu";
import {
  attribute,
  cameraPosition,
  clamp,
  dot,
  exp,
  float,
  max,
  mix,
  normalize,
  positionLocal,
  positionWorld,
  pow,
  smoothstep,
  time,
  vec2,
  vec3,
} from "three/tsl";
import { palette } from "./palette.js";
import { WATER_LEVEL, heightAt } from "./terrain.js";

/** How deep the water has to be before it reads as fully opaque. */
const OPAQUE_DEPTH = 2.6;

/** Where the sun is, matching the key light in lighting.ts. Glint comes from the same direction. */
const SUN = new Vector3(-52, 46, -68).normalize();

/**
 * The ripple field.
 *
 * Eight waves, no two of them commensurate — 11.3, 7.1, 4.7, 3.1, 1.9, 1.3, 0.79 and 0.53 metres.
 * Ratios near, but never at, small whole numbers is the whole point: a set of wavelengths at
 * 8/4/2/1 relines up every eight metres and draws visible corduroy. Directions are spread the same
 * way, at angles that are not multiples of each other.
 *
 * The four shortest are marked `detail`: past about thirty metres one of their wavelengths is
 * narrower than the pixel drawing it, and what an unresolvable wave produces is not detail but a
 * crawling moire — which reads, again, as a repeat. They are faded out with distance below.
 *
 * Amplitudes are tiny because this is a sheltered pond in a wood. They set the *normal*, which is
 * what the light reads; the surface only has to move a couple of centimetres to look alive.
 */
const RIPPLE = new WaveField({
  waves: [
    { amplitude: 0.021, direction: [0.94, 0.35], wavelength: 11.3, speed: 0.78 },
    { amplitude: 0.014, direction: [-0.42, 0.91], wavelength: 7.1, speed: 0.61, phase: 1.7 },
    { amplitude: 0.009, direction: [0.71, -0.7], wavelength: 4.7, speed: 0.52, phase: 2.4 },
    { amplitude: 0.006, direction: [-0.87, -0.49], wavelength: 3.1, speed: 0.44, phase: 0.8 },
    { amplitude: 0.0035, detail: true, direction: [0.29, 0.96], wavelength: 1.9, speed: 0.37, phase: 3.9 },
    { amplitude: 0.0022, detail: true, direction: [-0.66, 0.75], wavelength: 1.3, speed: 0.31, phase: 5.2 },
    { amplitude: 0.0013, detail: true, direction: [0.98, -0.19], wavelength: 0.79, speed: 0.26, phase: 1.1 },
    { amplitude: 0.0008, detail: true, direction: [-0.12, -0.99], wavelength: 0.53, speed: 0.21, phase: 4.4 },
  ],
  // One slow warp under all of it. Without this the wave set still has *a* period, however long;
  // the warp bends the domain those waves are measured in, so crests curve and wander the way a
  // real breeze pushes them, and the field stops being a sum of straight lines.
  domainWarp: [
    { direction: [0.8, 0.6], displacement: [0.55, -0.38], wavelength: 23, speed: 0.13, phase: 0.6 },
  ],
});

/** Where the detail waves start and finish fading, in metres from the camera. */
const DETAIL_NEAR = 14;
const DETAIL_FAR = 46;

export interface IWater {
  readonly mesh: Mesh;
  /** True when a point is over water — the scene uses it to report wading. */
  readonly covers: (x: number, z: number) => boolean;
  readonly level: number;
  /** Release the mirrored pass and its render target. */
  readonly dispose: () => void;
}

/**
 * Build a water surface over a circular patch of the valley.
 *
 * The grid is generous around the nominal radius because the shoreline is where `heightAt` happens
 * to cross zero, not where the basin was drawn — the noise the basin is subtracted from pushes the
 * real waterline in and out by several metres, which is exactly what makes it look like a shore
 * instead of a drawn circle.
 */
export function createWater(centre: Vector2, radius: number, samples = 96): IWater {
  const span = radius * 2.4;
  const step = span / (samples - 1);
  const half = span / 2;
  const vertexCount = samples * samples;

  const positions = new Float32Array(vertexCount * 3);
  const colors = new Float32Array(vertexCount * 3);
  // A plain float attribute rather than a fourth colour channel: the baked depth drives the wave
  // amplitude, and packing it into a colour is how a shallows tint ends up controlling the waves.
  const depths = new Float32Array(vertexCount);

  // The two ends of the silt ramp. This is the bed's colour seen *through* clear water at the
  // margin; the absorption below darkens it toward the deep colour on its own, so both ends here
  // stay honest mud rather than pre-darkened guesses.
  // Both ends pulled well down. A pond this shallow shows its floor almost everywhere, and a
  // full-brightness silt read through a translucent margin is what turns the whole surface into a
  // glowing cream sheet — measured, twice. The darkening belongs here in the bake, not on the
  // material, where it would fight the composite below.
  const shallow = new Color(palette.silt).lerp(new Color(palette.water), 0.6).multiplyScalar(0.34);
  const deep = new Color(palette.water).multiplyScalar(0.22);
  const colour = new Color();

  for (let ix = 0; ix < samples; ix += 1) {
    for (let iz = 0; iz < samples; iz += 1) {
      const index = ix * samples + iz;
      const x = centre.x - half + ix * step;
      const z = centre.y - half + iz * step;
      const depth = Math.max(0, WATER_LEVEL - heightAt(x, z));
      positions[index * 3] = x;
      positions[index * 3 + 1] = WATER_LEVEL;
      positions[index * 3 + 2] = z;
      depths[index] = Math.min(1, depth / OPAQUE_DEPTH);
      colour.copy(shallow).lerp(deep, Math.min(1, depth / OPAQUE_DEPTH));
      colors[index * 3] = colour.r;
      colors[index * 3 + 1] = colour.g;
      colors[index * 3 + 2] = colour.b;
    }
  }

  // Only cells with water in at least one corner get triangles. Skipping the dry ones is what
  // keeps the surface from showing as a square sheet hovering over the hillside.
  const cells = samples - 1;
  const indices: number[] = [];
  for (let ix = 0; ix < cells; ix += 1) {
    for (let iz = 0; iz < cells; iz += 1) {
      const a = ix * samples + iz;
      const b = a + 1;
      const c = a + samples;
      const d = c + 1;
      const wet = (depths[a] ?? 0) + (depths[b] ?? 0) + (depths[c] ?? 0) + (depths[d] ?? 0);
      if (wet <= 0) continue;
      indices.push(a, b, c, b, d, c);
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(positions, 3));
  geometry.setAttribute("color", new BufferAttribute(colors, 3));
  geometry.setAttribute("depth", new BufferAttribute(depths, 1));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();

  // No mirrored pass here, deliberately.
  //
  // `WaterSurface3D` will render one — but a reflector re-renders the whole scene from inside
  // `updateBefore`, and this game's render chain (ssgi, ssr, sharpen, bloom) is already inside a
  // render target when that happens. Nested that way, and with the auto resolution scaler resizing
  // the drawing buffer underneath (1359x965 -> 1155x820 in one run), three r185 destroys the
  // reflector's target while a command buffer still references it:
  //
  //   Destroyed texture [Texture (unlabeled 1359x965 px, RGBA16Float)] used in a submit
  //
  // repeated until the device gives up warning. The sky in this pond therefore comes from the
  // fresnel tint below — a colour this file picks — not from a second draw of the wood.
  const surface = new WaterSurface3D({ level: WATER_LEVEL, maxThickness: OPAQUE_DEPTH });

  // Basic, not Standard: every photon on this surface is composited by hand below, out of the
  // mirror and the bed. Handing the same fragment to a lit material as well would light water
  // that is already carrying the light it reflected.
  const material = new MeshBasicNodeMaterial({
    depthWrite: false,
    // Both sides: the surface is thin, and standing in the shallows puts the camera under it.
    side: DoubleSide,
    // Transparent so the wood is already drawn when this surface reads the frame beneath it.
    transparent: true,
  });

  // The generic is written out: `attribute()` infers its node type from the argument, which
  // widens to `string` and produces a node with none of the `.mul`/`.add` methods below.
  const bakedDepth = attribute<"float">("depth", "float");
  const here = vec2(positionWorld.x, positionWorld.z);
  const eyeDistance = here.sub(vec2(cameraPosition.x, cameraPosition.z)).length();
  const detailFade = float(1).sub(smoothstep(float(DETAIL_NEAR), float(DETAIL_FAR), eyeDistance));

  // Vertices ride the four long waves only. The short ones are shorter than the 30 cm grid this
  // mesh is built on, so displacing by them would alias into a stair pattern the normal below
  // already draws correctly and for free.
  material.positionNode = vec3(
    positionLocal.x,
    positionLocal.y.add(RIPPLE.heightNode({ fade: float(0), time }).mul(bakedDepth)),
    positionLocal.z,
  );

  // The surface normal, evaluated per fragment from the same field. This is the whole ripple:
  // no texture, no stripe term, no screen-space anything.
  const normal = RIPPLE.normalNode({ fade: detailFade, point: here, time });
  const view = normalize(cameraPosition.sub(positionWorld));
  const facing = clamp(dot(normal, view), float(0), float(1));
  // Schlick, at water's 1.333 index — F0 is 0.02, which is why still water at your feet is nearly
  // clear and the same water at the far bank is a mirror.
  const fresnel = float(0.02).add(float(0.98).mul(pow(float(1).sub(facing), 5)));

  // The normal's horizontal part is the offset, in screen UV. Grazing fragments slide further,
  // because that is what a longer path through a tilted surface does.
  const slide = mix(float(0.006), float(0.02), float(1).sub(facing));
  const offset = vec2(normal.x, normal.z).mul(slide);

  const thickness = surface.thicknessAt(offset);
  // Beer–Lambert through this pond's own water: red goes first, then green, and what survives at
  // depth is the blue-green in `palette.water`. Extinction per metre is this file's choice, and it
  // is gentle — this basin is 2.6 m at its deepest and its floor sits in the wood's shade, so
  // clear-water numbers take the surface to black long before the shore does anything interesting.
  const transmittance = exp(vec3(-0.34, -0.2, -0.16).mul(thickness));
  const bed = surface.refractionAt(offset);
  // What the water itself scatters back is the ramp baked into the vertices: silt at the margin,
  // `palette.water` in the middle. The bake was already there for the shoreline; this is what it
  // was always for, and reading it here is why the material can drop `vertexColors`.
  const scatter = attribute<"vec3">("color", "vec3");
  const submerged = bed.mul(transmittance).add(scatter.mul(float(1).sub(transmittance)));

  // What the surface shows at a grazing angle: this wood's sky, as a flat colour. A mirror would
  // be better and is what `WaterSurface3D` exists to provide; see the note above for why not here.
  const sky = vec3(0.34, 0.42, 0.47);
  // A floor under the fresnel, not fresnel alone. Schlick says a surface seen straight down
  // reflects 2% — true, and it is also why water rendered from Schlick alone reads as tar: the
  // 2% is of a sky far brighter than anything under the surface. A fifth, rising to most of it at
  // a grazing angle, is what makes the near water read as water rather than as a hole.
  const skyWeight = float(0.1).add(fresnel.mul(float(0.72))).min(float(1));
  const composited = mix(submerged, sky, skyWeight);

  // Sun glint off the same analytic normal. A specular lobe on a non-repeating normal breaks into
  // separate sparks by itself; the old way — a `sin(worldZ)` band multiplied over a highlight —
  // is what drew the ladder of horizontal stripes this replaced.
  const halfway = normalize(view.add(vec3(SUN.x, SUN.y, SUN.z)));
  const glint = pow(clamp(dot(normal, halfway), float(0), float(1)), 260);
  material.colorNode = composited.add(vec3(1, 0.94, 0.82).mul(glint).mul(float(0.55)));

  const mesh = new Mesh(geometry, material);
  mesh.name = "water";
  mesh.receiveShadow = false;
  mesh.castShadow = false;
  // Drawn after the opaque valley, and after the foliage, so the shore blends over both.
  mesh.renderOrder = 2;
  mesh.matrixAutoUpdate = false;
  mesh.updateMatrix();

  return {
    covers: (x, z) => heightAt(x, z) < WATER_LEVEL,
    dispose: () => {
      surface.dispose();
    },
    level: WATER_LEVEL,
    mesh,
  };
}
