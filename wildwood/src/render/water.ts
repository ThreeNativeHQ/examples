// Generated for you. This is ordinary Three.js — edit or delete it freely.
// ThreeNative does not read this file.
//
// The lake and the pond, and the one thing that decides whether water reads as water.
//
// Water is four readings composited: what the sky puts *on* the surface, what the bed sends *up*
// through it, how much water stands between the two, and what the water itself scatters back.
// Every colour below is this file's; the engine chooses none of them.
//
// **What was wrong with the version this replaces**, read off two captures rather than guessed at.
// Standing on the pond bank, the surface was a flat slate-grey band with a razor-straight edge
// against the sand. Standing a metre out in the shallows, the frame was one uniform near-black.
// Both are the same defect seen from two angles, and it was not the ripples: it was the *ends* of
// the composite. Grazing fragments mixed almost entirely to `sky`, which was a single constant
// colour — so far water was one flat grey no matter which way you faced. Fragments seen from
// above mixed almost entirely to the bed, with a Beer-Lambert term whose thickness came from the
// screen-space depth read, so shallow water showed the mud unaltered and the pond looked drained.
// And the mesh was opaque to its last triangle, so the shoreline was wherever the triangles ran
// out — a cut, not a shore.
//
// So three things changed, and they are the whole of the difference:
//
// 1. **The sky is a gradient sampled by the reflected ray, not a constant.** `light/sun.ts`
//    measured the radiances of the photograph that lights this valley — zenith, horizon, the
//    forward-scattered haze around the sun — and the same numbers are what the water reflects.
//    Near-grazing rays leave along the horizon and pick up the dark treeline; steeper ones climb
//    into the blue. That single change is what turns a grey sheet into a surface with a far bank
//    in it.
// 2. **Depth comes off the mesh, not off the screen.** The pond does not move and neither does
//    the ground under it, so every vertex is baked with the metres of water standing on it,
//    straight out of the same `heightAt` the terrain and the collider use. It is exact, it is
//    free, it survives the WebGL2 fallback where a depth read may not, and it is the number that
//    grades the colour from silt at the margin to `palette.water` in the middle.
// 3. **The shoreline is an alpha ramp over the last handspan of water.** Opacity fades to nothing
//    as the baked depth goes to zero, so the surface dissolves into the wet sand instead of
//    ending at a triangle edge.
//
// What is unchanged is the ripple, and the ripple is where water usually goes wrong. Stamping a
// normal map over the surface, or adding `sin(worldZ * k)` highlight bands, puts a period into
// the picture, and the eye finds a period in about a second: the surface stops being water and
// becomes wallpaper. There is not one such term in this file. The normal comes from
// `WaveField.normalNode` — the analytic derivative of a sum of eight waves whose wavelengths share
// no common multiple — so the pattern repeats only where all eight line up again, which within
// this valley is nowhere.
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
  min,
  mix,
  normalize,
  positionLocal,
  positionWorld,
  pow,
  reflect,
  smoothstep,
  time,
  vec2,
  vec3,
} from "three/tsl";
import { palette } from "./palette.js";
import { SKY_RADIANCE, SUN_COLOUR, sunDirection } from "./light/sun.js";
import { WATER_LEVEL, heightAt } from "./terrain.js";

/** How deep the water has to be before the bed stops contributing, in metres. */
const OPAQUE_DEPTH = 2.6;

/** Deepest reading the baked attribute carries. The lake bottoms out around 7.6 m. */
const MAX_BAKED_DEPTH = 9;

/**
 * The sun, taken from the one place it exists rather than typed again.
 *
 * `light/sun.ts` measured it out of `kloofendal_48d_2k.hdr`, and the key light, the sky and the
 * aerial perspective are all built from the same vector. A glint that disagrees with the shadows
 * is the sort of thing nobody spots in code and nobody misses in a frame.
 */
const SUN = sunDirection(new Vector3());

/**
 * The ripple field.
 *
 * Eight waves, no two of them commensurate — 11.3, 7.1, 4.7, 3.1, 1.9, 1.3, 0.79 and 0.53 metres.
 * Ratios near, but never at, small whole numbers is the whole point: a set of wavelengths at
 * 8/4/2/1 relines up every eight metres and draws visible corduroy. Directions are spread the same
 * way, at angles that are not multiples of each other.
 *
 * The four shortest are marked `detail`: past about forty metres one of their wavelengths is
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
const DETAIL_NEAR = 18;
const DETAIL_FAR = 62;

/**
 * How much the analytic normal is tilted away from straight up before the light reads it.
 *
 * A two-centimetre wave over eleven metres is a slope of about one degree, and one degree of
 * fresnel variation across a whole lake is invisible — which is why the old surface, with a
 * correct non-repeating normal on it, still photographed as a flat sheet. This exaggerates the
 * horizontal part of the normal so a ripple bends the reflection by something the eye can find,
 * while the geometry keeps its honest two centimetres.
 */
const SLOPE_GAIN = 7.5;

/** Where the ripple is allowed to start, in metres of depth. Water at the sand is glass. */
const RIPPLE_DEPTH = 0.55;

/** The wet band at the margin, in metres of depth: the surface fades out across it. */
const SHORE_FADE = 0.32;

export interface IWater {
  readonly mesh: Mesh;
  /** True when a point is over water — the scene uses it to report wading. */
  readonly covers: (x: number, z: number) => boolean;
  readonly level: number;
  /** Release the mirrored pass and its render target. */
  readonly dispose: () => void;
}

/**
 * A linear-space vec3 node from a palette hex, so the shader math is in the renderer's space.
 *
 * The palette is authored in sRGB, which is what a person picks colours in; every number this
 * shader multiplies and exponentiates has to be linear or the absorption curve is being applied
 * to a gamma-encoded quantity and the shallows come out chalky.
 */
function linear(hex: number, gain = 1) {
  const colour = new Color(hex).convertSRGBToLinear();
  return vec3(colour.r * gain, colour.g * gain, colour.b * gain);
}

/**
 * Build a water surface over a circular patch of the valley.
 *
 * The grid is generous around the nominal radius because the shoreline is where `heightAt` happens
 * to cross zero, not where the basin was drawn — the noise the basin is subtracted from pushes the
 * real waterline in and out by several metres, which is exactly what makes it look like a shore
 * instead of a drawn circle.
 */
export function createWater(centre: Vector2, radius: number, samples = 128): IWater {
  const span = radius * 2.4;
  const step = span / (samples - 1);
  const half = span / 2;
  const vertexCount = samples * samples;

  const positions = new Float32Array(vertexCount * 3);
  // Two depth attributes, in two units, because they answer two different questions and packing
  // them into one is how a shallows tint ends up controlling the waves. `wave` is 0..1 and damps
  // the vertex displacement toward the bank; `metres` is the real thing and grades the colour.
  const waveDepths = new Float32Array(vertexCount);
  const metreDepths = new Float32Array(vertexCount);

  for (let ix = 0; ix < samples; ix += 1) {
    for (let iz = 0; iz < samples; iz += 1) {
      const index = ix * samples + iz;
      const x = centre.x - half + ix * step;
      const z = centre.y - half + iz * step;
      const depth = Math.max(0, WATER_LEVEL - heightAt(x, z));
      positions[index * 3] = x;
      positions[index * 3 + 1] = WATER_LEVEL;
      positions[index * 3 + 2] = z;
      waveDepths[index] = Math.min(1, depth / OPAQUE_DEPTH);
      metreDepths[index] = Math.min(MAX_BAKED_DEPTH, depth);
    }
  }

  // Only cells with water in at least one corner get triangles. Skipping the dry ones is what
  // keeps the surface from showing as a square sheet hovering over the hillside — and keeping the
  // ones with a *single* wet corner is what gives the alpha ramp below a strip of dry ground to
  // fade out over, instead of ending abruptly on the waterline itself.
  const cells = samples - 1;
  const indices: number[] = [];
  for (let ix = 0; ix < cells; ix += 1) {
    for (let iz = 0; iz < cells; iz += 1) {
      const a = ix * samples + iz;
      const b = a + 1;
      const c = a + samples;
      const d = c + 1;
      const wet = (waveDepths[a] ?? 0) + (waveDepths[b] ?? 0) + (waveDepths[c] ?? 0) + (waveDepths[d] ?? 0);
      if (wet <= 0) continue;
      indices.push(a, b, c, b, d, c);
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(positions, 3));
  geometry.setAttribute("waveDepth", new BufferAttribute(waveDepths, 1));
  geometry.setAttribute("metres", new BufferAttribute(metreDepths, 1));
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
  // measured gradient below — colours this file picks, out of the same photograph that lights the
  // valley — rather than from a second draw of the wood.
  const surface = new WaterSurface3D({ level: WATER_LEVEL, maxThickness: OPAQUE_DEPTH });

  // Basic, not Standard: every photon on this surface is composited by hand below, out of the
  // sky and the bed. Handing the same fragment to a lit material as well would light water
  // that is already carrying the light it reflected.
  const material = new MeshBasicNodeMaterial({
    depthWrite: false,
    // Both sides: the surface is thin, and standing in the shallows puts the camera under it.
    side: DoubleSide,
    // Transparent so the wood is already drawn when this surface reads the frame beneath it, and
    // so the shoreline can fade rather than end.
    transparent: true,
  });

  // The generic is written out: `attribute()` infers its node type from the argument, which
  // widens to `string` and produces a node with none of the `.mul`/`.add` methods below.
  const waveDepth = attribute<"float">("waveDepth", "float");
  const depthM = attribute<"float">("metres", "float");
  const here = vec2(positionWorld.x, positionWorld.z);
  const eyeDistance = here.sub(vec2(cameraPosition.x, cameraPosition.z)).length();
  const detailFade = float(1).sub(smoothstep(float(DETAIL_NEAR), float(DETAIL_FAR), eyeDistance));

  // Vertices ride the four long waves only. The short ones are shorter than the grid this mesh is
  // built on, so displacing by them would alias into a stair pattern the normal below already
  // draws correctly and for free.
  material.positionNode = vec3(
    positionLocal.x,
    positionLocal.y.add(RIPPLE.heightNode({ fade: float(0), time }).mul(waveDepth)),
    positionLocal.z,
  );

  // The surface normal, evaluated per fragment from the same field. This is the whole ripple:
  // no texture, no stripe term, no screen-space anything.
  //
  // Two modulations on top of the field. The horizontal part is exaggerated by `SLOPE_GAIN`,
  // because a physically honest one-degree slope moves the reflection by nothing the eye can
  // find; and the whole thing is damped to flat in the last half metre of water, because a
  // shoreline that ripples reads as a beach in a gale rather than as a pond in a wood.
  const raw = RIPPLE.normalNode({ fade: detailFade, point: here, time });
  const ripple = smoothstep(float(0), float(RIPPLE_DEPTH), depthM).mul(float(SLOPE_GAIN));
  const normal = normalize(vec3(raw.x.mul(ripple), raw.y, raw.z.mul(ripple)));

  const view = normalize(cameraPosition.sub(positionWorld));
  const facing = clamp(dot(normal, view), float(0), float(1));
  // Schlick, at water's 1.333 index — F0 is 0.02, which is why still water at your feet is nearly
  // clear and the same water at the far bank is a mirror.
  const fresnel = float(0.02).add(float(0.98).mul(pow(float(1).sub(facing), 5)));

  // ---- what comes up through the surface -------------------------------------------------
  //
  // The normal's horizontal part is the offset, in screen UV. Grazing fragments slide further,
  // because that is what a longer path through a tilted surface does — and the offset is taken to
  // zero at the margin, or the dry bank a handspan away smears out across the water in front of it.
  const slide = mix(float(0.004), float(0.026), float(1).sub(facing));
  const offset = vec2(normal.x, normal.z)
    .mul(slide)
    .mul(smoothstep(float(0), float(0.6), depthM));
  const bed = surface.refractionAt(offset);

  // How far light actually travels through this water to reach the eye: straight down it is the
  // baked depth, and at a grazing angle it is much further, which is the entire reason a lake is
  // clear at your feet and opaque at the far bank. The clamp on `facing` keeps a horizon fragment
  // from asking for a kilometre of water.
  const path = min(depthM.div(max(facing, float(0.12))), float(MAX_BAKED_DEPTH * 1.6));

  // Beer-Lambert through this pond's own water: red goes first, then green, and what survives at
  // depth is the blue-green in `palette.water`. Extinction per metre is this file's choice. It is
  // stronger than clear water because this basin sits in a wood and carries the wood in it —
  // leaf tannin and silt, which is also why the shallows read warm rather than blue.
  const transmittance = exp(vec3(-0.46, -0.26, -0.19).mul(path));

  // Caustics. The same analytic normal that bends the reflection also focuses the sun onto the
  // bed, so the bright cells are where the surface happens to point at it. No texture, no second
  // wave set: this is a function of the field already computed above, which is why the caustic
  // pattern drifts with the ripple that causes it instead of sliding under it. Killed with depth,
  // because a caustic is a shallow-water phenomenon and the bed at three metres is in shade.
  const sunNode = vec3(SUN.x, SUN.y, SUN.z);
  const focus = pow(clamp(dot(normal, sunNode), float(0), float(1)), 34);
  const caustic = focus
    .mul(float(2.6))
    .mul(float(1).sub(smoothstep(float(0.15), float(1.9), depthM)));

  // What the water body itself scatters back: silt and tannin at the margin, `palette.water` in
  // the middle. This is the depth-graded colour — the thing that makes a shallow edge read as
  // shallow rather than as the same sheet with less alpha on it.
  const shallowBody = linear(palette.silt, 0.5).mul(vec3(1.06, 1, 0.82));
  const deepBody = linear(palette.water, 0.34);
  const body = mix(shallowBody, deepBody, smoothstep(float(0.1), float(2.4), depthM));

  const submerged = bed.mul(transmittance).mul(float(1).add(caustic)).add(body.mul(float(1).sub(transmittance)));

  // Subsurface scatter: the green-gold glow you get looking into shallow water with the sun
  // behind it, which is light that went in, bounced around in the silt and came back out rather
  // than reflecting off the top. Strongest looking toward the sun, and only where the water is
  // shallow enough for it to get back out again.
  const towardSun = clamp(dot(view.negate(), sunNode), float(0), float(1));
  const glow = pow(towardSun, 2.5)
    .mul(float(1).sub(smoothstep(float(0.2), float(1.8), depthM)))
    .mul(float(0.5));
  const underwater = submerged.add(linear(palette.moss, 0.9).mul(vec3(1.3, 1.15, 0.6)).mul(glow));

  // ---- what sits on the surface ------------------------------------------------------------
  //
  // The sky, as the reflected ray sees it. Three measured bands out of `light/sun.ts` — the same
  // radiances the analytic sky and the aerial perspective are built from, so the pond and the
  // ridge above it agree about what colour the air is — plus the wood, because a ray leaving a
  // pond at two degrees does not reach the sky at all. It reaches the far bank.
  const bounced = reflect(view.negate(), normal);
  const treeline = linear(palette.canopy, 0.34).add(linear(palette.bark, 0.16));
  const horizon = vec3(SKY_RADIANCE.horizon[0], SKY_RADIANCE.horizon[1], SKY_RADIANCE.horizon[2]);
  const zenith = vec3(SKY_RADIANCE.zenith[0], SKY_RADIANCE.zenith[1], SKY_RADIANCE.zenith[2]);
  const sunward = vec3(SKY_RADIANCE.sunward[0], SKY_RADIANCE.sunward[1], SKY_RADIANCE.sunward[2]);
  const skyward = mix(
    mix(treeline, horizon, smoothstep(float(0.01), float(0.11), bounced.y)),
    zenith,
    smoothstep(float(0.08), float(0.62), bounced.y),
  );
  // The circumsolar haze, which is what makes the sun's half of a lake brighter than the other
  // half even where the disc itself is nowhere in the reflection.
  const halo = pow(clamp(dot(bounced, sunNode), float(0), float(1)), 6).mul(float(0.55));
  const reflected = mix(skyward, sunward, halo);

  // A small floor under Schlick rather than Schlick alone. Two per cent is the honest number for a
  // surface seen straight down, and it is also how water rendered from Schlick alone reads as tar:
  // the two per cent is of a sky far brighter than anything under the surface. The floor is much
  // smaller than it used to be, because what it now mixes toward is a gradient with a dark
  // treeline in it — the old constant grey needed a large floor and paid for it by hiding the bed.
  const skyWeight = min(float(0.05).add(fresnel.mul(float(0.95))), float(1));
  const composited = mix(underwater, reflected, skyWeight);

  // Sun glint off the same analytic normal. A specular lobe on a non-repeating normal breaks into
  // separate sparks by itself; the old way — a `sin(worldZ)` band multiplied over a highlight —
  // is what drew the ladder of horizontal stripes this replaced.
  const halfway = normalize(view.add(sunNode));
  const glint = pow(clamp(dot(normal, halfway), float(0), float(1)), 210);
  material.colorNode = composited.add(linear(SUN_COLOUR, 0.85).mul(glint));

  // The shoreline, and the end of the hard edge.
  //
  // The surface is fully there once there is a handspan of water under it and gone where there is
  // none, so it dissolves into the wet sand across the last third of a metre instead of stopping
  // at whichever triangle ran out. The `max` keeps a grazing view of the very margin from vanishing
  // entirely: even a film of water still catches a sheen at two degrees, and that sheen is what
  // reads as *wet* ground rather than as no ground at all.
  material.opacityNode = max(
    smoothstep(float(0), float(SHORE_FADE), depthM),
    fresnel.mul(smoothstep(float(0), float(0.06), depthM)),
  );

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
