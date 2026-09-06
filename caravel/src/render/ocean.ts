// Generated for you. The sea's tuning and its entire look live in this file, and ThreeNative does
// not read it. `SpectralOcean` runs the simulation and draws nothing: the mesh, the material, the
// colours, the foam line and the tessellation are all decisions this game makes here.
//
// This replaces a two-wave `WaveField` under a `MeshBasicNodeMaterial`. Both halves of that were
// the problem. Two analytic waves plus one domain warp is a corrugated sheet — it repeats visibly
// within a boat length, and no amount of colour work hides a surface with two frequencies in it.
// And a *basic* material takes no lights at all, so the sea could not respond to the sun the rest
// of the scene is lit by: its brightness had to be hand-computed with a `pow(dot(n, sun), 30)`
// term standing in for a specular highlight. Water is one of the few surfaces where the specular
// *is* the material, so that read as plastic.
//
// A spectral ocean is cascaded wave spectra inverse-transformed on the GPU every frame, which is
// what real water is, and a standard node material puts it back under the scene's own lights.
import { type ISpectralOceanOptions, SpectralOcean } from "@threenative/core";
import { Mesh, PlaneGeometry } from "three";
import {
  color,
  dot,
  float,
  mix,
  oneMinus,
  positionLocal,
  positionViewDirection,
  positionWorld,
  pow,
  saturate,
  smoothstep,
  transformNormalToView,
  uniform,
  vec2,
  vec3,
} from "three/tsl";
import type { Node } from "three/webgpu";
import { MeshStandardNodeMaterial } from "three/webgpu";
import { palette } from "./palette.js";

/**
 * The sea state. Every number is this game's.
 *
 * `windSpeed` and `amplitude` are the two to reach for: wind sets which wavelengths carry energy,
 * amplitude scales the whole spectrum. `choppiness` above zero displaces horizontally as well as
 * vertically, which is what sharpens a crest into something a hull can be thrown by.
 */
export const SEA = {
  // Sea state, and the number that decides whether this reads as a passage or as a survival
  // storm. At 0.0082 the field measured 3.2 m from trough to crest — two thirds of the ship's
  // whole length, and five times its draught — so the caravel spent the run being thrown about by
  // seas that would have ended the voyage. A working swell for a 4.6 m hull is nearer 1.5 m, and
  // wave height goes as the square root of spectrum scale, so a quarter of the energy halves it.
  amplitude: 0.0034,
  // Largest patch first, and the bands do not overlap. One cascade is a toy — the join between
  // bands is where a spectral ocean visibly fails, so there is nothing to look at until there are
  // two.
  cascades: [{ patchSize: 190 }, { patchSize: 37 }],
  choppiness: 1.2,
  directionality: 2.6,
  gravity: 9.81,
  // The ship reads this field on the CPU for its buoyancy and its attitude, so the copy has to
  // land often enough — and be fine enough — to steer by.
  //
  // 32 samples across the largest patch is one height every six metres, which is coarser than the
  // waves themselves: the hull then sat at a smoothed mean sea level while the drawn surface moved
  // three metres either side of it, so the ship hung in the air over its own troughs and pitched
  // on differences between samples that were nowhere near it. 64 halves that spacing, and the
  // calmer sea state below closes the rest of the gap. This is the cost of a spectral ocean over
  // an analytic one, and it is worth paying — but it has to be paid.
  readbackEveryFrames: 3,
  // 64, and the paragraph above is the reason: at 32 the copy carried one height every six metres
  // across the broad cascade, which is coarser than the ship is long, so both hull probes landed
  // in the same cell and the ship barely answered the sea it was in.
  readbackResolution: 64,
  resolution: 128,
  seed: 20_260_906,
  smallWaveCutoff: 0.32,
  windDirection: 0.55,
  windSpeed: 10.5,
} satisfies ISpectralOceanOptions;

/**
 * How fast the sea's dominant waves travel, and which way they run.
 *
 * A spectral ocean has no closed-form height, so the CPU copy a hull floats on is always some
 * frames behind the field the GPU is drawing — the API says so, and reports the age. This is what
 * a reader needs to *use* that age: deep-water waves travel, so the field at time `t + d` is very
 * nearly the field at time `t` shifted downwind by `speed * d`. Sampling that far **upwind** of a
 * point therefore reads what the water there is about to be doing.
 *
 * The peak angular frequency is the Pierson-Moskowitz one, `0.855 g / U`, and a deep-water wave's
 * phase speed is `g / w`. Both come straight out of `SEA` above, so retuning the wind retunes
 * this with it.
 */
const PEAK_ANGULAR_FREQUENCY = (0.855 * SEA.gravity) / SEA.windSpeed;
export const SWELL = {
  /** Metres per second. */
  speed: SEA.gravity / PEAK_ANGULAR_FREQUENCY,
  x: Math.cos(SEA.windDirection),
  z: Math.sin(SEA.windDirection),
} as const;

/**
 * The most wave-time any reader will extrapolate over, in seconds. See `surfaceHeight`.
 *
 * The lag being corrected for is a few frames in a real session and an order of magnitude worse
 * inside a playtest, where the fixed step runs far faster than wall-clock and a copy in flight
 * covers a hundred ticks. Correcting the first is what a floating thing needs; chasing the second
 * would sample twenty metres upwind, where a spectral field has already decorrelated and the
 * "prediction" is just a different wave.
 */
const MAX_LEAD_SECONDS = 0.25;

/**
 * The sea's height at a world point, corrected for the age of the copy it came from.
 *
 * This is the call anything that floats should use, rather than `sampleHeight` raw: a hull, a
 * buoy or a bit of flotsam put straight onto the returned number rides water the renderer stopped
 * drawing several frames ago, and the tell is a hull that cuts down through a crest and then hangs
 * over the following trough.
 *
 * `undefined` before the first copy lands, exactly as `sampleHeight` is, so a caller still has to
 * decide what an unknown sea level means for it.
 */
export function surfaceHeight(
  ocean: SpectralOcean,
  x: number,
  z: number,
  deltaTime: number,
): number | undefined {
  const probe = ocean.sampleHeight(x, z);
  if (probe === undefined) return undefined;
  const lead = Math.min(MAX_LEAD_SECONDS, Math.max(0, probe.staleFrames) * deltaTime);
  const run = SWELL.speed * lead;
  return ocean.sampleHeight(x - SWELL.x * run, z - SWELL.z * run)?.height ?? probe.height;
}

/** The drawn surface's edge length in metres, and how finely it is tessellated. */
export const SURFACE = { segments: 160, size: 300 } as const;

/**
 * The step the surface normal is differenced over, in metres.
 *
 * Deliberately finer than the mesh's own quad, which is 1.9 m. Differencing at the quad size
 * throws away every wave shorter than about four metres *before it can shade anything*, and a sea
 * with no short waves in its normals has no glitter: the sun arrives as one smooth mirror lobe a
 * third of the frame wide, blooms, and blows out. Shading detail below the geometric resolution is
 * the whole point of a normal, and the fine cascade already carries it at 0.29 m per texel. This
 * sits between the two: fine enough to break the highlight into a glitter path, coarse enough not
 * to alias into sparkle noise as the camera moves.
 *
 * Decoupling the two is also what lets the tessellation stay where it is. Buying the same detail
 * as geometry meant 256 segments a side, which took the scene from 138k triangles to 282k and
 * straight through this template's own performance budget — for detail that shades identically
 * from a normal costing nothing per frame.
 */
const NORMAL_STEP = 0.7;

/** Crest foam. Near-white, and not a seventh palette role: the sea's look is owned here. */
const FOAM = 0xe9f4f6;

export function createOcean(): SpectralOcean {
  return new SpectralOcean(SEA);
}

/**
 * Read one cascade's displacement at a world position, **bilinearly**.
 *
 * Nearest-texel sampling is the obvious way to write this and it is visibly wrong here. The mesh
 * carries one vertex per 1.6 m while the fine cascade's texel is 0.29 m, so every vertex grabbed a
 * different texel of a field it was far too coarse to resolve — and the normal, being a difference
 * of two of those, came out piecewise-constant. The frame showed the sun's reflection broken into
 * hard axis-aligned white rectangles, which is a sampling artefact and reads as a bug in the water.
 *
 * The two `mod`s are not redundant: the first is still negative for a vertex left of the origin,
 * and a negative index reads whatever happens to sit behind the buffer.
 */
function cascadeAt(
  ocean: SpectralOcean,
  index: number,
  x: Node<"float">,
  z: Node<"float">,
): Node<"vec4"> {
  const grid = float(ocean.resolution);
  const patch = float(ocean.cascadePatchSize(index));
  const buffer = ocean.cascadeDisplacement(index);
  const u = x.div(patch).mul(grid);
  const v = z.div(patch).mul(grid);
  const u0 = u.floor();
  const v0 = v.floor();
  const wrap = (value: Node<"float">): Node<"float"> => value.mod(grid).add(grid).mod(grid);
  const read = (cx: Node<"float">, cz: Node<"float">): Node<"vec4"> =>
    buffer.element(wrap(cz).mul(grid).add(wrap(cx)).toUint()) as Node<"vec4">;
  const near = mix(read(u0, v0), read(u0.add(1), v0), u.sub(u0));
  const far = mix(read(u0, v0.add(1)), read(u0.add(1), v0.add(1)), u.sub(u0));
  return mix(near, far, v.sub(v0)) as Node<"vec4">;
}

/** Summed displacement of both cascades at a world position. */
function displacementAt(ocean: SpectralOcean, x: Node<"float">, z: Node<"float">): Node<"vec3"> {
  const broad = cascadeAt(ocean, 0, x, z);
  const fine = cascadeAt(ocean, 1, x, z);
  return vec3(broad.x.add(fine.x), broad.y.add(fine.y), broad.z.add(fine.z));
}

/**
 * The sea surface: displaced by the simulation, and lit by the scene.
 *
 * The vertex stage reads the cascade buffers directly, so what is drawn is the same field the
 * height query is copied from. If the two disagreed the ship would ride water nothing renders and
 * every assertion in this template would still be green.
 */
/** A sea surface, and the handle that keeps it under the ship. */
export interface IWaterSurface {
  readonly mesh: Mesh;
  /** Move the drawn sea to follow a position, keeping the wave field anchored to the world. */
  follow(x: number, z: number): void;
}

export function createWaterMesh(ocean: SpectralOcean): IWaterSurface {
  const geometry = new PlaneGeometry(SURFACE.size, SURFACE.size, SURFACE.segments, SURFACE.segments);
  geometry.rotateX(-Math.PI / 2);

  // Where the drawn patch sits in the world.
  //
  // A 300 m square nailed to the origin was fine for a course eight metres long. The passage now
  // reaches (-34, -46), which puts the nearest edge of the water about a hundred metres from the
  // camera and well inside the fog's 330 m reach: the player sails towards a visible rectangular
  // hem where the sea stops and the sky dome begins. The patch therefore travels, and the field
  // it reads does **not** travel with it — the cascade lookup adds this offset back, so a wave
  // stays where it is in the world while the mesh slides underneath it. Without that the whole
  // ocean would be dragged along by the ship and the sea would appear to stand still.
  const seaOrigin = uniform(vec2(0, 0));

  // Standard, not basic. This is the whole reason the sea now has a sun on it rather than a
  // hand-rolled `pow()` blob: a lit material gets the scene's key light, its hemisphere fill and
  // its specular response for free, and gets them consistent with the hull floating on it.
  const material = new MeshStandardNodeMaterial({
    metalness: 0.02,
    // Not glass. At 0.08 the key light landed as one blown white disc on the swell in front of the
    // camera; water this side of a dead calm scatters enough to spread that into a glitter path.
    // 0.29 was still a mirror once the sea state came down to a working swell — the highlight
    // reassembled into a single blown lobe the width of a third of the frame, because a flatter
    // sea gives the specular fewer facets to break up on.
    roughness: 0.4,
  });

  const worldX = positionLocal.x.add(seaOrigin.x);
  const worldZ = positionLocal.z.add(seaOrigin.y);
  const offset = displacementAt(ocean, worldX, worldZ);
  material.positionNode = positionLocal.add(offset);

  // Normals by central difference. Without this the surface is lit by the flat plane's normals —
  // every vertex pointing straight up — and a perfectly simulated ocean shades like a sheet of
  // paper.
  //
  // The step is `NORMAL_STEP`, not the mesh's quad — see the note on that constant.
  const step = float(NORMAL_STEP);
  const east = displacementAt(ocean, worldX.add(step), worldZ);
  const west = displacementAt(ocean, worldX.sub(step), worldZ);
  const north = displacementAt(ocean, worldX, worldZ.add(step));
  const south = displacementAt(ocean, worldX, worldZ.sub(step));
  const twice = step.mul(2);
  // `transformNormalToView`, not the raw vector. `normalNode` overrides `normalView`, so a
  // material handed a world-space normal lights the surface in the camera's frame instead of the
  // world's: the sun's reflection stopped being a place on the sea and became a column of glare
  // pointing at the camera, sliding across the water as the ship turned.
  const viewNormal = transformNormalToView(
    vec3(
      west.y.sub(east.y).div(twice),
      float(1),
      south.y.sub(north.y).div(twice),
    ).normalize(),
  );
  material.normalNode = viewNormal;

  // Colour by height: deep in the troughs, lit water on the shoulders, foam on the crests. The
  // band is narrower than the wave amplitude on purpose, so the tops read as foam-lit rather than
  // as a gentle gradient.
  // These four numbers are in metres of wave height, so they move with `SEA.amplitude` and are
  // wrong the moment it changes. Tuned for the -2.4..3 range of the old storm they put every foam
  // threshold above the highest crest the calmer sea now reaches: the surface came back a single
  // flat teal with no crests in it at all, which looks exactly like the frozen ocean this template
  // just finished fixing and is not.
  const shade = smoothstep(float(-0.85), float(0.75), positionWorld.y);
  const water = mix(color(palette.floor), color(palette.accent), shade);
  // Foam on the tops, not on the faces. The band has to sit near the **highest** water the field
  // reaches, not near its mean: at 0.62..1.15 against a sea whose crests run to 1.4 the threshold
  // was clearing across whole wave faces at once, and the middle distance came back as an
  // unbroken white sheet that read as snow rather than as sea.
  const crest = smoothstep(float(1.0), float(1.62), positionWorld.y);
  const surfaced = mix(water, color(FOAM), crest);

  // Fresnel. This is the term that was missing, and it is the one that decides whether a surface
  // reads as water at all: looked straight down into, water is nearly transparent and shows its
  // own depth; looked along, it is a mirror of the sky. Without it the sea was one flat teal from
  // the bow to the horizon whatever the waves underneath it were doing, because a diffuse albedo
  // that ignores the view direction cannot be sea.
  //
  // The scene has no environment map to reflect — `sky.ts` builds a vertex-coloured dome, not a
  // cube map — so the reflection is stood in for by the horizon haze the dome fades to. That is
  // also the fog colour, which is why the far water now meets the sky instead of ending at it.
  const facing = saturate(dot(viewNormal, positionViewDirection));
  // Exponent five is water's own Schlick curve, and 0.4 is as far as the mix is allowed to go.
  // At an exponent of four and a weight of 0.8 the term stopped being a reflection and became a
  // wash: a chase camera sits low, so most of the sea is at a grazing angle from it, and nearly
  // the whole frame went to horizon haze with the deep water gone entirely.
  const sheen = pow(oneMinus(facing), float(5)).mul(0.4);
  material.colorNode = mix(surfaced, color(palette.skyLow), sheen);
  // Foam is not a mirror. Roughening the crests is what stops them reading as chrome.
  material.roughnessNode = mix(float(0.4), float(0.86), crest);

  const mesh = new Mesh(geometry, material);
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  mesh.name = "sea-surface";

  // Snapped to the mesh's own quad. Following continuously would slide every vertex through the
  // wave field by a fraction of a quad each frame, and the surface would visibly crawl; landing
  // only on whole quads means each vertex always samples the same world grid it did last frame.
  const quad = SURFACE.size / SURFACE.segments;
  return {
    mesh,
    follow(x: number, z: number): void {
      const snappedX = Math.round(x / quad) * quad;
      const snappedZ = Math.round(z / quad) * quad;
      mesh.position.set(snappedX, 0, snappedZ);
      seaOrigin.value.set(snappedX, snappedZ);
    },
  };
}
