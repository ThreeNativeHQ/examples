// Generated for you. This is ordinary Three.js — edit or delete it freely.
// ThreeNative does not read this file.
//
// The lake and the pond.
//
// **The one thing that makes still water read as water is that it contains the far bank.** Not a
// gradient standing in for the far bank — the bank itself, upside down, recognisable as trees.
// Everything else here (absorption, caustics, scatter, glint, the shoreline) is dressing on that
// one fact, and a surface that gets the dressing right and the reflection wrong photographs as a
// sheet of rippled plastic. That is what the version this replaces was: it composited a measured
// three-band sky gradient by fresnel, so the water under a hundred metres of sunlit conifer was
// the same flat blue-grey it would have been under an empty sky.
//
// Six things changed, and they are the whole of the difference:
//
// 1. **The reflection is a real sample of the frame**, taken by projecting the reflected ray to
//    the point it meets the bank and reading the screen there. No mirrored pass, no second draw of
//    the wood: the bank is already on screen this frame, and the geometry says exactly where its
//    reflection lands. `hitUv` below.
// 2. **The surface is a mirror at distance and choppy near you.** Beyond about forty metres one
//    pixel covers many ripples, so what a real photograph shows there is the *average* — a smooth
//    reflection, not a per-pixel scramble. The old constant `SLOPE_GAIN = 7.5` swung the reflected
//    ray by more than the whole range the sky gradient spanned, which is why the far half of the
//    lake broke into hard black-and-white noise. The gain is now graded with distance.
// 3. **The wind touches part of the lake at a time.** A uniform ripple everywhere is the single
//    most reliable tell that water was drawn rather than photographed. A slow drifting noise field
//    gates the short waves, so most of the surface is glass and a few patches are ruffled —
//    and the calm patches take the sharp reflection while the ruffled ones smear it.
// 4. **The underside is drawn.** The lake is eight metres deep and the walker wades into it, so
//    the camera goes under. Seen from below the surface is not water at all: it is a mirror of the
//    dark bed everywhere except inside Snell's window, the 48.6° cone the whole sky is squeezed
//    into. Before this it was the above-water composite evaluated at angles it has no meaning at,
//    which photographed as black-and-white static filling the top half of the frame.
//
// 5. **Every palette colour was being converted to linear twice.** `new Color(hex)` already does
//    that conversion — three enables `ColorManagement` by default — so the `convertSRGBToLinear()`
//    the helper called on top of it took every palette-derived colour in this file down by a
//    factor between three and thirteen, worse on the darker channels. The water had no colour of
//    its own, the treeline fallback was five times darker than the bank it stood in for, and the
//    file carried two colour systems disagreeing by an order of magnitude, because `SKY_RADIANCE`
//    is measured numbers that never went through the helper. See `linear()`.
// 6. **The surface writes depth.** Faint dotted horizontal rules crossed the mid-water in every
//    capture. They were not the refraction sample — a three-strip probe found them on a strip
//    painted a flat constant colour — they were the passes that run after this one reading the
//    lake bed's grazing-angle depth through a surface that wrote none. See the material below.
//
// What is unchanged is where the ripple comes from. Stamping a normal map over the surface, or
// adding `sin(worldZ * k)` highlight bands, puts a period into the picture, and the eye finds a
// period in about a second. There is not one such term in this file. The normal is
// `WaveField.normalNode` — the analytic derivative of a sum of eight waves whose wavelengths share
// no common multiple — so the pattern repeats only where all eight line up again, which within
// this valley is nowhere.
//
// Also unchanged, and worth knowing before touching it: **depth comes off the mesh, not off the
// screen.** Neither basin moves and neither does the ground under it, so every vertex is baked
// with the metres of water standing on it out of the same `heightAt` the terrain and the collider
// use. Exact, free, and it survives the WebGL2 fallback where a depth read may not.
//
// ---------------------------------------------------------------------------------------------
// If this is ever lifted into a package: the seam runs between LOOK and MECHANISM below. Every
// number in LOOK is a decision about *this* lake in *this* wood and would have to be re-chosen.
// Everything under MECHANISM — the wave field, the baked depth, the rim measurement, the
// reflected-ray projection, the Beer-Lambert integration, the Snell's-window split — is maths
// that any still fresh water needs and no game should have to write twice.
// ---------------------------------------------------------------------------------------------
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
  cameraProjectionMatrix,
  cameraViewMatrix,
  clamp,
  dot,
  exp,
  float,
  max,
  min,
  mix,
  mx_noise_float,
  normalize,
  positionLocal,
  positionWorld,
  pow,
  reflect,
  smoothstep,
  sqrt,
  step,
  time,
  vec2,
  vec3,
  vec4,
  viewportSharedTexture,
} from "three/tsl";
import { palette } from "./palette.js";
import { SKY_RADIANCE, SUN_COLOUR, sunDirection } from "./light/sun.js";
import { WATER_LEVEL, heightAt } from "./terrain.js";

// =============================================================================================
// LOOK — what this lake is like. Every number here is a choice, and the reason is on the line.
// =============================================================================================

/**
 * Extinction per metre, per channel, in the renderer's linear space.
 *
 * Red dies first and blue survives, which is why deep fresh water is blue-green. These are
 * roughly two and a half times the coefficients of distilled water because this basin sits in a
 * wood and carries the wood in it — leaf tannin and suspended silt — and because a lake you can
 * see four metres into reads as a swimming pool. At the 0.7 m margin the bed still shows; by
 * three metres it is gone.
 */
const EXTINCTION: readonly [number, number, number] = [0.86, 0.5, 0.36];

/** How deep the water has to be before the bed stops contributing, in metres. */
const OPAQUE_DEPTH = 2.6;

/** Deepest reading the baked attribute carries. The lake bottoms out around 8.6 m. */
const MAX_BAKED_DEPTH = 9;

/**
 * Peak ripple slope multiplier close to the camera, and far from it.
 *
 * The wave field's honest peak slope is about 5°, which is right for a sheltered lake and far too
 * small to see once it is the only thing bending a reflection — the version this replaces used a
 * flat 7.5 (≈37°, a gale) and paid for it in per-pixel noise across the far half of the water.
 * The physical argument for grading it is that one distant pixel covers many ripples and shows
 * their average, so the *visible* slope really does fall off with distance. Near water gets chop
 * you can see; water past seventy metres is a mirror.
 */
const SLOPE_GAIN_NEAR = 1.5;
const SLOPE_GAIN_FAR = 0.45;
/** Metres over which the gain above falls from near to far. */
const SLOPE_FADE_NEAR = 10;
const SLOPE_FADE_FAR = 72;

/**
 * How much of that slope the *reflection* is allowed to see, as a fraction of what the glint sees.
 *
 * These are two different readings of the same surface and they want different amounts of it. A
 * glint is a peak-finder: it wants every steep facet, because one facet catching the sun is the
 * whole spark. A reflection is an average over the pixel's footprint, and feeding it the same
 * unfiltered slope shreds the treeline into crumpled foil — a texture that reads as an oil slick
 * rather than as a mirror. Halving the slope halves how far each sample slides, which turns the
 * crumple back into the long slow wobble a still lake actually has, while the sparks keep their
 * bite.
 *
 * The honest version of this is a second evaluation of the wave field with the short waves
 * dropped, which is a low-pass filter rather than a scale. This is the cheap version — same
 * frequencies, less amplitude — and it costs nothing at all.
 */
const REFLECT_SLOPE_SHARE = 0.55;

/** Where the detail waves start and finish fading, in metres from the camera. */
const DETAIL_NEAR = 16;
const DETAIL_FAR = 58;

/**
 * The wind patches: how big they are, how fast they cross the lake, and how calm the calm is.
 *
 * Wind does not arrive everywhere at once. On a sheltered lake most of the surface is glass and a
 * few slowly-travelling patches are ruffled — the cat's paws — and that contrast between mirror
 * and texture is the strongest single cue that the water is real. `PATCH_METRES` is the size of
 * one patch; `PATCH_DRIFT` is how fast it travels, in metres a second; `PATCH_CALM` is how much of
 * the long swell survives in the flattest places (0 would be a dead mirror, which reads as ice).
 */
const PATCH_METRES = 26;
const PATCH_DRIFT = 0.55;
const PATCH_CALM = 0.45;
/** Which way the patches travel. Roughly across the lake, and not aligned with any wave. */
const PATCH_WIND: readonly [number, number] = [0.62, -0.78];

/**
 * How far the reflection smears, in fractions of the screen, at the near and far ends.
 *
 * A reflection in rippled water is blurred *vertically*, because the surface tilts about a
 * horizontal axis far more often than it tilts toward you — that anisotropy is why a lakeside
 * photograph's reflection looks stretched downward rather than fogged. The blur grows with
 * distance for the same reason the slope gain shrinks: more ripples per pixel.
 */
const REFLECT_BLUR_NEAR = 0.003;
const REFLECT_BLUR_FAR = 0.015;
/** How much narrower the smear is across the screen than down it. */
const REFLECT_BLUR_ASPECT = 0.5;

/**
 * How far outside the waterline the bank the water reflects actually stands, in metres.
 *
 * The reflected ray is aimed at a ring, and the ring wants to be where the trees are rather than
 * where the sand is. Six metres is roughly one tree back from the shore, measured off this
 * valley's own scatter.
 */
const REFLECT_RIM_MARGIN = 6;

/** The floor under Schlick: still water seen straight down is not perfectly clear. */
const SKY_FLOOR = 0.045;

/** Where the ripple is allowed to start, in metres of depth. Water at the sand is glass. */
const RIPPLE_DEPTH = 0.55;

/** The wet band at the margin, in metres of depth: the surface fades out across it. */
const SHORE_FADE = 0.32;

/**
 * The cosine band the Snell's-window edge is blended over, seen from underwater.
 *
 * Water's critical angle is 48.6° from vertical, cos 0.661: look up more steeply than that and
 * the sky refracts in, look up shallower and the surface is a mirror of the dark bed. A real
 * window's edge is ragged because the ripple moves it, and the perturbed normal below does that
 * on its own; this band only keeps the transition from aliasing into a hard circle.
 */
const SNELL_INNER = 0.6;
const SNELL_OUTER = 0.79;

// =============================================================================================
// MECHANISM — the maths. Nothing below picks a colour.
// =============================================================================================

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
 * The four shortest are marked `detail`, and the `fade` handed to the graph does double duty on
 * them. Past about forty metres one of their wavelengths is narrower than the pixel drawing it,
 * and what an unresolvable wave produces is not detail but a crawling moire. They are *also* the
 * waves the wind makes, so the same fade carries the patch mask: the long swell runs everywhere
 * and the chop only where the breeze is touching down.
 *
 * Amplitudes are tiny because this is sheltered water in a wood. They set the *normal*, which is
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
 *
 * **`new Color(hex)` has already done that conversion.** three enables `ColorManagement` by
 * default, and `Color.setHex` takes its argument as sRGB and stores linear-sRGB: `new
 * Color(0x2b4a4a).r` is 0.0242, not 0.169. The version this replaces called
 * `.convertSRGBToLinear()` on top of that, which converted a second time and took every
 * palette-derived colour in this file down by a factor between three and thirteen — worse on the
 * darker channels, so the colours came out desaturated and hue-shifted as well as dim. It is
 * invisible in review and it does not look like a bug in a frame; it looks like a shader whose
 * constants want turning up, and it got them turned up. What made it visible was arithmetic that
 * did not match a capture: an underwater ceiling computed at 0.062 linear luminance photographed
 * at 4/255, and running the ACES curve backwards from that measurement put the real value at
 * 0.010, which is exactly one extra conversion.
 *
 * Everything downstream has been re-picked against the corrected values. `SKY_RADIANCE` was never
 * affected — those are measured numbers, already linear, and the file had two colour systems in it
 * disagreeing by an order of magnitude.
 */
function linear(hex: number, gain = 1) {
  const colour = new Color(hex);
  return vec3(colour.r * gain, colour.g * gain, colour.b * gain);
}

/**
 * The mean radius of the actual waterline, measured rather than assumed.
 *
 * The reflected ray has to be aimed at something, and for a basin in a bowl the thing it hits is
 * the ring of bank around it. That ring is *not* the nominal radius the basin was drawn with: the
 * noise `heightAt` adds pushes the real waterline in and out by several metres, and it lands
 * eleven per cent inside the nominal figure for the lake while landing seventeen per cent outside
 * it for the pond. Bisecting `heightAt` along thirty-two bearings costs a few hundred evaluations
 * once, at build time, and removes a constant nobody could have guessed right for both.
 */
function waterlineRadius(centre: Vector2, radius: number): number {
  if (heightAt(centre.x, centre.y) >= WATER_LEVEL) return radius;
  const bearings = 32;
  let sum = 0;
  for (let index = 0; index < bearings; index += 1) {
    const angle = (index / bearings) * Math.PI * 2;
    let wet = 0.05;
    let dry = radius * 1.6;
    // Twenty-four halvings is under a millimetre at this scale.
    for (let halving = 0; halving < 24; halving += 1) {
      const mid = (wet + dry) / 2;
      const ground = heightAt(centre.x + Math.cos(angle) * mid, centre.y + Math.sin(angle) * mid);
      if (ground < WATER_LEVEL) wet = mid;
      else dry = mid;
    }
    sum += (wet + dry) / 2;
  }
  return sum / bearings;
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
  const spacing = span / (samples - 1);
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
      const x = centre.x - half + ix * spacing;
      const z = centre.y - half + iz * spacing;
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
  // repeated until the device gives up warning. The reflection below therefore comes out of the
  // frame this surface is being drawn into, which costs one framebuffer copy and no second draw
  // of the wood at all. `surface` is still here for `refractionAt`, which is the same read taken
  // downward.
  const surface = new WaterSurface3D({ level: WATER_LEVEL, maxThickness: OPAQUE_DEPTH });

  // Where the bank the water reflects actually stands. Measured, then pushed back one tree.
  const rim = waterlineRadius(centre, radius) + REFLECT_RIM_MARGIN;

  // Basic, not Standard: every photon on this surface is composited by hand below, out of the
  // sky and the bed. Handing the same fragment to a lit material as well would light water
  // that is already carrying the light it reflected.
  const material = new MeshBasicNodeMaterial({
    // Writing depth, which for a transparent surface wants a reason.
    //
    // Faint dotted horizontal rules cross the mid-water in every capture, and a three-strip probe
    // ruled out the refraction sample: they are there on a strip painted a flat constant colour
    // with no frame read in it at all, along with a diagonal dither weave. What varies across a
    // constant colour is not the material — it is the passes that run after it, and with
    // `depthWrite: false` the depth and normal buffers under every water pixel hold the *lake bed*
    // at a grazing angle, where its triangle rows are a few pixels apart and its depth derivative
    // is enormous. Ambient occlusion and screen-space reflection both read those buffers. Writing
    // depth puts the smooth water plane there instead, which is also the more honest thing for a
    // surface you cannot see through.
    depthWrite: true,
    // Both sides: the lake is eight metres deep and the walker wades in, so the camera goes under
    // this surface and has to find something drawn there. See the Snell's window branch below.
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

  // ---- the wind on the water ---------------------------------------------------------------
  //
  // Two octaves of gradient noise in world metres, translated downwind and evolving slowly in
  // place. Noise rather than another wave sum, because a *sum of sines used as a mask* has the
  // same corduroy problem the waves themselves would: the mask has to be lumpy, not periodic.
  const drift = time.mul(float(PATCH_DRIFT / PATCH_METRES));
  const patchUv = here
    .mul(float(1 / PATCH_METRES))
    .sub(vec2(PATCH_WIND[0], PATCH_WIND[1]).mul(drift));
  const patchCoarse = mx_noise_float(vec3(patchUv.x, patchUv.y, time.mul(float(0.021))));
  const patchFine = mx_noise_float(
    vec3(patchUv.x.mul(2.7).add(11.3), patchUv.y.mul(2.7).sub(4.1), time.mul(float(0.048))),
  );
  /** 0 where the lake is glass, 1 where the breeze is on it. */
  const patch = smoothstep(float(-0.12), float(0.34), patchCoarse.add(patchFine.mul(float(0.34))));

  // ---- the surface normal ------------------------------------------------------------------
  //
  // One evaluation of the field per fragment. No texture, no stripe term, no screen-space
  // anything. Two modulations on top of it: the short waves are gated by both distance and the
  // wind patch, and the whole horizontal part is scaled by a gain that falls off with distance,
  // because a far pixel covers many ripples and shows their average.
  const detailFade = float(1)
    .sub(smoothstep(float(DETAIL_NEAR), float(DETAIL_FAR), eyeDistance))
    .mul(patch);
  const raw = RIPPLE.normalNode({ fade: detailFade, point: here, time });
  const slopeGain = mix(
    float(SLOPE_GAIN_NEAR),
    float(SLOPE_GAIN_FAR),
    smoothstep(float(SLOPE_FADE_NEAR), float(SLOPE_FADE_FAR), eyeDistance),
  )
    // The long swell survives in the calm patches; it is only damped, never switched off, because
    // a dead-flat mirror reads as ice rather than as water.
    .mul(mix(float(PATCH_CALM), float(1), patch))
    // And nothing ripples in the last half metre before the sand: a shoreline that chops reads as
    // a beach in a gale rather than as a pond in a wood.
    .mul(smoothstep(float(0), float(RIPPLE_DEPTH), depthM));
  const normal = normalize(vec3(raw.x.mul(slopeGain), raw.y, raw.z.mul(slopeGain)));
  // The same surface read with less of its slope, for the reflection alone. See
  // `REFLECT_SLOPE_SHARE`; the glint, the caustics and the refraction offset keep the sharp one.
  const reflectGain = slopeGain.mul(float(REFLECT_SLOPE_SHARE));
  const reflectNormal = normalize(vec3(raw.x.mul(reflectGain), raw.y, raw.z.mul(reflectGain)));

  // Vertices ride the four long waves only. The short ones are shorter than the grid this mesh is
  // built on, so displacing by them would alias into a stair pattern the normal above already
  // draws correctly and for free.
  material.positionNode = vec3(
    positionLocal.x,
    positionLocal.y.add(RIPPLE.heightNode({ fade: float(0), time }).mul(waveDepth)),
    positionLocal.z,
  );

  const view = normalize(cameraPosition.sub(positionWorld));
  const facing = clamp(dot(normal, view), float(0), float(1));
  // Schlick, at water's 1.333 index — F0 is 0.02, which is why still water at your feet is nearly
  // clear and the same water at the far bank is a mirror.
  const fresnel = float(0.02).add(float(0.98).mul(pow(float(1).sub(facing), 5)));

  // ---- what comes up through the surface ---------------------------------------------------
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

  // Beer-Lambert through this basin's own water; the coefficients and why are on `EXTINCTION`.
  const transmittance = exp(vec3(-EXTINCTION[0], -EXTINCTION[1], -EXTINCTION[2]).mul(path));

  // Caustics. The same analytic normal that bends the reflection also focuses the sun onto the
  // bed, so the bright cells are where the surface happens to point at it. No texture, no second
  // wave set: this is a function of the field already computed above, which is why the caustic
  // pattern drifts with the ripple that causes it — and why it appears under the wind patches and
  // not on the glassy parts, for free. Killed with depth, because a caustic is a shallow-water
  // phenomenon and the bed at three metres is in shade.
  const sunNode = vec3(SUN.x, SUN.y, SUN.z);
  const focus = pow(clamp(dot(normal, sunNode), float(0), float(1)), 34);
  const caustic = focus
    .mul(float(1.7))
    .mul(float(1).sub(smoothstep(float(0.15), float(1.9), depthM)));

  // What the water body itself scatters back: silt and tannin at the margin, `palette.water` in
  // the middle. This is the depth-graded colour — the thing that makes a shallow edge read as
  // shallow rather than as the same sheet with less alpha on it.
  // Gains are small because these are radiances, not albedos: this is the light the water body
  // itself sends back, and it is a fraction of what the bank returns. 0.15 of the silt puts the
  // margin at about 0.020 linear luminance and 0.20 of `palette.water` puts the middle at 0.012 —
  // dark, and the tint you see through the last metre of clear water rather than a paint layer.
  // Under the doubled conversion above these two summed to 0.0013 and 0.0073, which is to say the
  // water had no colour of its own at all and the shallows were bare sand seen through a pane.
  const shallowBody = linear(palette.silt, 0.15).mul(vec3(1.06, 1, 0.74));
  const deepBody = linear(palette.water, 0.2);
  const body = mix(shallowBody, deepBody, smoothstep(float(0.1), float(2.4), depthM));

  const submerged = bed
    .mul(transmittance)
    .mul(float(1).add(caustic))
    .add(body.mul(float(1).sub(transmittance)));

  // Subsurface scatter: the green-gold glow you get looking into shallow water with the sun
  // behind it, which is light that went in, bounced around in the silt and came back out rather
  // than reflecting off the top. Strongest looking toward the sun, and only where the water is
  // shallow enough for it to get back out again.
  const towardSun = clamp(dot(view.negate(), sunNode), float(0), float(1));
  const glow = pow(towardSun, 2.5)
    .mul(float(1).sub(smoothstep(float(0.2), float(1.8), depthM)))
    .mul(float(0.26));
  const underwater = submerged.add(linear(palette.moss, 0.35).mul(vec3(1.3, 1.15, 0.6)).mul(glow));

  // ---- what sits on the surface: the far bank, actually reflected ---------------------------
  //
  // The reflected ray leaves this fragment and hits *something*, and for a basin in a bowl that
  // something is the ring of bank around it. `rim` is where that ring is, measured off `heightAt`
  // at build time. So: intersect the reflected ray's horizontal part with a circle of that radius,
  // walk the ray to the crossing, and project the point it reaches back into the frame that has
  // already been drawn. Reading the screen there is reading the bank — the real trees, at the real
  // brightness, with this frame's own haze already on them.
  //
  // This is one step of a screen-space reflection with the march replaced by a closed form, and it
  // is exact for anything standing on the rim. It is wrong for anything between here and there, in
  // the usual screen-space way. On open water there is nothing between here and there.
  const bounced = reflect(view.negate(), reflectNormal);
  // Aimed at the bank even where a wave face tips the ray below horizontal. A ray leaving a crest
  // downward does not escape the lake: it strikes the next wave a metre away and leaves again at
  // very nearly the horizontal, so the thing it eventually shows is still the bank. Letting those
  // fragments fall through to the analytic fallback instead put dark blue-grey blotches all over
  // the near water — the same defect as the old black amoebae, arriving by a different route.
  const aimed = normalize(vec3(bounced.x, max(bounced.y, float(0.006)), bounced.z));
  const flat = vec2(aimed.x, aimed.z);
  const flatLength = max(flat.length(), float(0.02));
  const fromCentre = here.sub(vec2(centre.x, centre.y));
  const along = dot(fromCentre, flat.div(flatLength));
  // The near root is behind the ray for any fragment inside the ring, so the far root is the one
  // that matters. `max` on the discriminant keeps a fragment on the dry fringe outside the ring,
  // whose ray misses it entirely, from producing a NaN that would poison the whole composite.
  const discriminant = max(
    along.mul(along).sub(dot(fromCentre, fromCentre).sub(float(rim * rim))),
    float(0),
  );
  const toRim = max(sqrt(discriminant).sub(along), float(0));
  const travel = min(toRim.div(flatLength), float(400));
  const hit = positionWorld.add(aimed.mul(travel));

  // Project the point the ray reached into this frame. `w` is the view-space distance in front of
  // the camera, and it is also the whole "is this point behind me" test.
  //
  // **The y is negated, and that is not a taste.** Clip space puts +1 at the top of the frame;
  // `screenUV`, which is the space `viewportSharedTexture` samples in, puts 0 there —
  // `NodeBuilder.isFlipY()` returns false on WGSL, so `screenCoordinate` is the raw fragment
  // coordinate with its origin at the top left, and the GLSL backend flips its own bottom-left
  // origin to match. The two conventions differ by exactly this sign on both backends. Written the
  // obvious way (`* 0.5 + 0.5`) every reflection is mirrored about the middle of the screen, which
  // for a lake means every fragment reads the *bed* instead of the bank and the whole surface
  // photographs as marbled brown mud. It looks plausible enough to ship, which is the danger.
  const hitClip = cameraProjectionMatrix.mul(cameraViewMatrix.mul(vec4(hit.x, hit.y, hit.z, 1)));
  const hitNdc = hitClip.xy.div(max(hitClip.w, float(0.0001)));
  const hitUv = vec2(hitNdc.x.mul(0.5).add(0.5), hitNdc.y.mul(-0.5).add(0.5));

  // Whether that sample is worth believing, as a 0..1 weight rather than a branch, so the seam
  // where it stops being worth believing is a fade and not an edge.
  //
  //   - off the top or the side of the frame: the bank's reflection is simply not on screen
  //   - behind the camera: `w` at or below zero, and the projection is meaningless
  //   - crossing the ring within a couple of metres: the fragment is out on the dry fringe and
  //     the "reflection" would be the ground it is lying on
  //
  // The horizontal fade is narrow and the vertical one is not, and the asymmetry is the point.
  // Off the side of the frame is more of the same bank, so the clamped edge sample is very nearly
  // right and a wide fade to the analytic fallback just draws a grey stripe down the edge of the
  // lake — which it did, sixty pixels wide. Off the top is sky and off the bottom is the near
  // water itself, and neither is anything like the bank.
  const inFrame = smoothstep(float(0), float(0.012), hitUv.x)
    .mul(smoothstep(float(1), float(0.988), hitUv.x))
    .mul(smoothstep(float(0), float(0.04), hitUv.y))
    .mul(smoothstep(float(1), float(0.9), hitUv.y));
  const believable = inFrame
    .mul(step(float(0.001), hitClip.w))
    .mul(smoothstep(float(1.5), float(5), toRim));

  // Sampled with a vertical smear, because that is the shape a rippled reflection has. Five taps
  // on an ellipse taller than it is wide; the radius grows with distance and shrinks where the
  // lake is glass, so a calm patch takes a sharp reflection of the trees and a ruffled one
  // dissolves them.
  const blur = mix(
    float(REFLECT_BLUR_NEAR),
    float(REFLECT_BLUR_FAR),
    smoothstep(float(8), float(60), eyeDistance),
  ).mul(mix(float(0.25), float(1), patch));
  const tap = (dx: number, dy: number) =>
    viewportSharedTexture(
      vec2(
        clamp(hitUv.x.add(blur.mul(float(dx * REFLECT_BLUR_ASPECT))), float(0.002), float(0.998)),
        clamp(hitUv.y.add(blur.mul(float(dy))), float(0.002), float(0.998)),
      ),
    ).rgb;
  const sampled = tap(0, 0)
    .mul(float(0.36))
    .add(tap(0, 1).mul(float(0.16)))
    .add(tap(0, -1).mul(float(0.16)))
    .add(tap(1.3, 0.5).mul(float(0.16)))
    .add(tap(-1.3, -0.5).mul(float(0.16)));

  // The fallback, for every fragment whose reflection is off the frame. Three measured bands out
  // of `light/sun.ts` — the same radiances the analytic sky and the aerial perspective are built
  // from, so the water and the ridge above it agree about what colour the air is — plus the wood,
  // because a ray leaving a lake at two degrees does not reach the sky at all.
  // Summing to about 0.069 linear luminance, which is what the sunlit conifers across this lake
  // actually measure (`tools/luminance.mjs --crop 0,0.28,1,0.45` reads 0.065 from the south shore
  // and 0.090 from the north-east). A fallback darker than the thing it stands in for is how the
  // first version of this surface grew hard black blotches.
  const treeline = linear(palette.canopy, 0.45).add(linear(palette.bark, 0.3));
  const horizon = vec3(SKY_RADIANCE.horizon[0], SKY_RADIANCE.horizon[1], SKY_RADIANCE.horizon[2]);
  const zenith = vec3(SKY_RADIANCE.zenith[0], SKY_RADIANCE.zenith[1], SKY_RADIANCE.zenith[2]);
  const sunward = vec3(SKY_RADIANCE.sunward[0], SKY_RADIANCE.sunward[1], SKY_RADIANCE.sunward[2]);
  const skyward = mix(
    mix(treeline, horizon, smoothstep(float(-0.28), float(0.16), bounced.y)),
    zenith,
    smoothstep(float(0.08), float(0.62), bounced.y),
  );
  const reflected = mix(skyward, sampled, believable);

  // The circumsolar haze, which is what makes the sun's half of a lake brighter than the other
  // half even where the disc itself is nowhere in the reflection.
  const halo = pow(clamp(dot(bounced, sunNode), float(0), float(1)), 6).mul(float(0.4));
  const surfaceLight = mix(reflected, sunward, halo);

  const skyWeight = min(float(SKY_FLOOR).add(fresnel.mul(float(1 - SKY_FLOOR))), float(1));
  const composited = mix(underwater, surfaceLight, skyWeight);

  // Sun glint off the same analytic normal. A specular lobe on a non-repeating normal breaks into
  // separate sparks by itself, and multiplying by the patch mask puts those sparks where the wind
  // is and nowhere else — which is what a glitter path on a real lake looks like from the bank.
  const halfway = normalize(view.add(sunNode));
  const glint = pow(clamp(dot(normal, halfway), float(0), float(1)), 170).mul(
    mix(float(0.15), float(1), patch),
  );
  const above = composited.add(linear(SUN_COLOUR, 0.75).mul(glint));

  // ---- and what the surface is from underneath ----------------------------------------------
  //
  // Nothing about the composite above survives being looked at from below: the fresnel is measured
  // against a ray leaving the water, the refraction reads a bed that is now behind the camera, and
  // the reflection aims at a bank the ray cannot reach. Drawn anyway — which is what it used to do
  // — it photographs as black-and-white static filling the top of the frame.
  //
  // Seen from below, the surface is two things separated by the critical angle. Look up steeply
  // and the whole sky refracts into a cone 97° wide: Snell's window, bright, and the only thing
  // down here that is not dark. Look up shallowly and the surface is a total mirror of the lake
  // bottom. The ripple moves the boundary about, which is why a real window has a ragged edge, and
  // that comes out of the same perturbed normal for free.
  const upward = normalize(positionWorld.sub(cameraPosition));
  const throughSurface = clamp(dot(upward, normal), float(0), float(1));
  const window = smoothstep(float(SNELL_INNER), float(SNELL_OUTER), throughSurface);
  // The sky as it arrives after a metre or two of water: the measured horizon band, drained of
  // red the way everything under water is.
  const windowSky = vec3(horizon.x.mul(0.55), horizon.y.mul(0.92), horizon.z).mul(float(1.35));
  const sunDisc = pow(clamp(dot(upward, sunNode), float(0), float(1)), 90)
    .mul(window)
    .mul(float(2.2));
  // Outside the window the surface is a total mirror, and what it mirrors is the bed — pale silt
  // in this basin, not blackness. Rendered dark (0.11 of `palette.water`, luminance 0.01) the
  // ceiling photographed as a flat black slab across the top of every wading frame, which reads as
  // a hole in the world rather than as water overhead. This is the bed's own colours taken down by
  // the metres of water the mirrored ray crosses twice.
  //
  // It is a constant and not a second projected sample. Reflecting the bed properly means running
  // the whole ray-to-screen machinery again pointing downward, for a view the player is in for a
  // few seconds at a time; a dim warm teal is the honest cheap answer and this comment is the
  // record that it is one.
  const ceiling = linear(palette.water, 0.35).add(linear(palette.silt, 0.22));
  // The dapple: brighter where the underside of a wave happens to face the sun, which is the
  // moving net of light every photograph taken from under a lake has in it.
  const dapple = mix(float(0.68), float(1.5), pow(clamp(dot(normal, sunNode), float(0), float(1)), 16));
  const below = mix(ceiling.mul(dapple), windowSky, window).add(linear(SUN_COLOUR, 0.65).mul(sunDisc));

  // One step, on the camera's own height. It is uniform across the draw, so both sides costing a
  // multiply is the whole price of not writing two materials.
  const eyeIsAbove = step(float(WATER_LEVEL + 0.02), cameraPosition.y);
  material.colorNode = mix(below, above, eyeIsAbove);

  // The shoreline, and the end of the hard edge.
  //
  // The surface is fully there once there is a handspan of water under it and gone where there is
  // none, so it dissolves into the wet sand across the last third of a metre instead of stopping
  // at whichever triangle ran out. The `max` keeps a grazing view of the very margin from vanishing
  // entirely: even a film of water still catches a sheen at two degrees, and that sheen is what
  // reads as *wet* ground rather than as no ground at all. From underneath there is no shore to
  // dissolve into and the ceiling is opaque.
  const shore = max(
    smoothstep(float(0), float(SHORE_FADE), depthM),
    fresnel.mul(smoothstep(float(0), float(0.06), depthM)),
  );
  material.opacityNode = mix(float(1), shore, eyeIsAbove);

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
