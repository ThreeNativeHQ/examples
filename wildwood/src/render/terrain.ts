// Generated for you. This is ordinary Three.js — edit or delete it freely.
// ThreeNative does not read this file.
//
// The valley floor, and the one idea this game took from its reference.
//
// Landscape Pro 2.0 (Fab listing 1ac647da) is an Unreal *material*: you sculpt a landscape and the
// material picks a layer per pixel from the surface's own slope and height, so rock appears on
// cliffs without anyone painting it. None of that ships as geometry — it is a node graph for a
// renderer this game does not have — so what crosses over is the rule, not the asset: **the ground
// chooses its own surface**. Here that choice is made once per vertex, at build time, and baked
// into vertex colours. Seven layers, chosen from height above water, slope, and a low-frequency
// moisture field, blended with `smoothstep` bands so no seam is a hard edge.
//
// The same height function feeds three consumers, which is the whole reason it lives in one file:
// the drawn mesh, the Rapier heightfield the player walks on, and every scatter and landmark that
// needs to know where the ground is.
import { BufferAttribute, BufferGeometry, Mesh, RepeatWrapping, type Texture, Vector3 } from "three";
import { MeshStandardNodeMaterial } from "three/webgpu";
import { attribute, float, positionLocal, texture, vec2 } from "three/tsl";

/** Standing water sits at y = 0, so "height" and "height above the lake" are the same number. */
export const WATER_LEVEL = 0;

/** The valley is a square this many metres on a side, centred on the origin. */
export const TERRAIN_SIZE = 190;

/** Samples per side. 191 gives a one-metre grid, which is as fine as the walk can feel. */
export const TERRAIN_SAMPLES = 191;

/** Anything steeper than this holds no soil, and the layer blend draws rock on it. */
const ROCK_SLOPE = 0.62;

/**
 * A seeded 2D value noise.
 *
 * Deliberately not `Math.random`: the valley has to come back byte-identical on every reload or a
 * screenshot diff cannot tell a bug from a reroll. Hash-based rather than table-based so it is a
 * pure function of (x, z) — the scatter in `foliage.ts` samples it at arbitrary points, out of
 * order, long after the mesh was built.
 */
function hash2(x: number, z: number, seed: number): number {
  let h = x * 374_761_393 + z * 668_265_263 + seed * 1_274_126_177;
  h = (h ^ (h >>> 13)) * 1_274_126_177;
  h = h ^ (h >>> 16);
  return (h >>> 0) / 4_294_967_295;
}

/** Ken Perlin's smootherstep: zero first *and* second derivative at both ends, so no creasing. */
function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function valueNoise(x: number, z: number, seed: number): number {
  const xi = Math.floor(x);
  const zi = Math.floor(z);
  const xf = fade(x - xi);
  const zf = fade(z - zi);
  const a = hash2(xi, zi, seed);
  const b = hash2(xi + 1, zi, seed);
  const c = hash2(xi, zi + 1, seed);
  const d = hash2(xi + 1, zi + 1, seed);
  return (a + (b - a) * xf) * (1 - zf) + (c + (d - c) * xf) * zf;
}

/** Fractal sum. Four octaves is where this terrain stops gaining detail the eye can find. */
function fbm(x: number, z: number, seed: number, octaves = 4): number {
  let sum = 0;
  let amplitude = 1;
  let frequency = 1;
  let norm = 0;
  for (let octave = 0; octave < octaves; octave += 1) {
    sum += valueNoise(x * frequency, z * frequency, seed + octave * 101) * amplitude;
    norm += amplitude;
    amplitude *= 0.5;
    frequency *= 2.07; // Off an exact 2 so octaves never line their grids up into visible plaid.
  }
  return sum / norm;
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** The lake: a bowl in the south-west, deep enough to read as water rather than a puddle. */
const LAKE = { x: -46, z: 42, radius: 34 } as const;

/** The ridge: a wall of rock along the north edge, and the only place with a view. */
const RIDGE = { z: -64, height: 17, falloff: 62 } as const;

/**
 * The height of the ground at any point in the valley, in metres above the lake.
 *
 * Pure and seedless — the shape of this valley is authored, not rolled. Changing a constant here
 * changes the mesh, the collider and every scattered tree together, because all three call this.
 */
export function heightAt(x: number, z: number): number {
  // Rolling ground: two octave sets at different scales so the walk has both hills and texture.
  const rolling = (fbm(x * 0.011, z * 0.011, 7) - 0.5) * 13 + (fbm(x * 0.047, z * 0.047, 19) - 0.5) * 3.2;

  // The ridge. A raised cosine wall rather than a step, warped left and right by its own noise so
  // the skyline is a ridge and not a rampart.
  const warp = (fbm(x * 0.02, 0.5, 31) - 0.5) * 22;
  const ridgeDistance = Math.abs(z - (RIDGE.z + warp));
  const ridge = RIDGE.height * Math.max(0, 1 - smoothstep(0, RIDGE.falloff, ridgeDistance)) ** 1.4;

  // The lake basin, carved out of whatever the two terms above produced. Subtracting rather than
  // replacing keeps the shoreline irregular: the bowl is round, the ground it cuts into is not.
  const lakeDistance = Math.hypot(x - LAKE.x, z - LAKE.z);
  const basin = (1 - smoothstep(LAKE.radius * 0.35, LAKE.radius * 1.25, lakeDistance)) * 11.5;

  // A raised lip around the whole valley so the world reads as bounded by land, not by a cliff of
  // nothing — the player can walk to the edge and find a hillside there.
  const edge = Math.max(Math.abs(x), Math.abs(z));
  const rim = smoothstep(TERRAIN_SIZE * 0.34, TERRAIN_SIZE * 0.54, edge) * 13;

  return rolling + ridge - basin + rim + 3.4;
}

/** How steep the ground is, as |gradient|. Sampled by finite difference at half a metre. */
export function slopeAt(x: number, z: number): number {
  const h = 0.5;
  const dx = (heightAt(x + h, z) - heightAt(x - h, z)) / (2 * h);
  const dz = (heightAt(x, z + h) - heightAt(x, z - h)) / (2 * h);
  return Math.hypot(dx, dz);
}

/**
 * How much of each ground layer this point is made of.
 *
 * This is the reference's rule, evaluated per vertex on the CPU. Landscape Pro picks its layer in
 * an Unreal material graph from the surface's own slope and height; the graph does not port, but
 * the rule does — and it is the whole product. Four weights, normalised to sum to one, handed to
 * the shader as a vertex attribute so the GPU only has to do the mixing.
 *
 * Order matters: slope wins over everything, because a cliff face is a cliff face whatever height
 * it sits at, and the wet margin wins over grass.
 *
 * The layers are the pack's own textures: `ground_grass_01` (mossy turf), `ground_forest` (needle
 * litter, the shaded floor under a canopy), `ground_rock_01` (the slope layer Landscape Pro draws
 * automatically), and `ground_dirt_01` (the dry transition band and the bare crown of the ridge).
 */
function layerWeights(height: number, slope: number, moisture: number): [number, number, number, number] {
  // Grass is the default floor of the valley; forest litter takes over where the ground is damp
  // and shaded, which is most of the low flat interior.
  const forest = smoothstep(0.42, 0.78, moisture);
  let grass = 1 - forest;
  let litter = forest;

  // The dry band: high ground that is not yet steep enough to be rock.
  const dirt = smoothstep(0.55, 0.15, moisture) * smoothstep(6, 15, height) + smoothstep(19, 26, height);

  // Slope draws rock, with no help from anyone. This is the line the reference is famous for.
  const rock = smoothstep(ROCK_SLOPE, ROCK_SLOPE + 0.45, slope);

  // The wet margin reads as bare silt, which this pack spells "dirt".
  const margin = 1 - smoothstep(0.15, 1.8, Math.abs(height - WATER_LEVEL));

  const soil = Math.max(0, 1 - rock);
  const dry = Math.min(1, dirt + margin);
  grass *= soil * (1 - dry);
  litter *= soil * (1 - dry);
  const dirtWeight = soil * dry;

  const total = grass + litter + rock + dirtWeight;
  if (total <= 1e-6) return [1, 0, 0, 0];
  return [grass / total, litter / total, rock / total, dirtWeight / total];
}

export interface ITerrain {
  readonly mesh: Mesh;
  /** Row-major by x then z, in the order Rapier's heightfield collider wants. */
  readonly heights: Float32Array;
  readonly rows: number;
  readonly columns: number;
  readonly size: number;
  readonly triangles: number;
}

/**
 * Build the valley: one mesh, one matching height array.
 *
 * The height array is laid out for Rapier, which stores its heightfield **column-major with the
 * row index running along z** — `heights[xIndex * rows + zIndex]`. Getting that transposed is the
 * classic way to end up with a collider that is the terrain reflected about its diagonal, which
 * looks correct from above and drops the player through the floor everywhere else. The scene's
 * `groundGap` reading exists to catch exactly that, and the walk playtest asserts on it.
 */
export function createTerrain(material: MeshStandardNodeMaterial): ITerrain {
  const samples = TERRAIN_SAMPLES;
  const size = TERRAIN_SIZE;
  const step = size / (samples - 1);
  const half = size / 2;
  const vertexCount = samples * samples;

  const positions = new Float32Array(vertexCount * 3);
  // Four layer weights per vertex, summing to one. The shader mixes the pack's textures by these.
  const weights = new Float32Array(vertexCount * 4);
  // A low-frequency tint, multiplied over the blended texture. Tiling a 1 m texture across a
  // 190 m valley reads as wallpaper however good the texture is; a slow colour drift on top is
  // the cheapest thing that breaks the repeat, and it costs one attribute.
  const tints = new Float32Array(vertexCount * 3);
  const heights = new Float32Array(vertexCount);

  for (let ix = 0; ix < samples; ix += 1) {
    const x = -half + ix * step;
    for (let iz = 0; iz < samples; iz += 1) {
      const z = -half + iz * step;
      const height = heightAt(x, z);
      // Rapier's layout, written here so the collider and the drawn surface can never drift.
      heights[ix * samples + iz] = height;

      // The drawn mesh is indexed the other way round — row of z inside a row of x — because that
      // is the order the triangle strip below walks. Two layouts, one loop, both explicit.
      const vertex = ix * samples + iz;
      positions[vertex * 3] = x;
      positions[vertex * 3 + 1] = height;
      positions[vertex * 3 + 2] = z;

      const moisture = fbm(x * 0.018, z * 0.018, 53);
      const [wGrass, wLitter, wRock, wDirt] = layerWeights(height, slopeAt(x, z), moisture);
      weights[vertex * 4] = wGrass;
      weights[vertex * 4 + 1] = wLitter;
      weights[vertex * 4 + 2] = wRock;
      weights[vertex * 4 + 3] = wDirt;

      // Macro tint: a slow warm/cool and light/dark drift, plus a little per-vertex grain so a
      // large flat area has texture at the vertex scale as well as the texel scale.
      const drift = fbm(x * 0.0065, z * 0.0065, 71);
      const grain = 0.94 + hash2(ix, iz, 91) * 0.12;
      tints[vertex * 3] = (0.86 + drift * 0.34) * grain;
      tints[vertex * 3 + 1] = (0.88 + drift * 0.28) * grain;
      tints[vertex * 3 + 2] = (0.82 + drift * 0.22) * grain;
    }
  }

  const cells = samples - 1;
  const indices = new Uint32Array(cells * cells * 6);
  let write = 0;
  for (let ix = 0; ix < cells; ix += 1) {
    for (let iz = 0; iz < cells; iz += 1) {
      const a = ix * samples + iz;
      const b = a + 1;
      const c = a + samples;
      const d = c + 1;
      // Wound counter-clockwise seen from above (+Y), so the surface faces the sky.
      indices[write] = a;
      indices[write + 1] = b;
      indices[write + 2] = c;
      indices[write + 3] = b;
      indices[write + 4] = d;
      indices[write + 5] = c;
      write += 6;
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(positions, 3));
  geometry.setAttribute("layerWeight", new BufferAttribute(weights, 4));
  geometry.setAttribute("color", new BufferAttribute(tints, 3));
  geometry.setIndex(new BufferAttribute(indices, 1));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();

  // The material is supplied by the caller, because it needs textures and this file loads nothing.
  const mesh = new Mesh(geometry, material);
  mesh.name = "terrain";
  mesh.receiveShadow = true;
  // Terrain casts too: the ridge's shadow across the valley floor at this sun angle is most of
  // what makes the ground read as three-dimensional rather than as a painted plane.
  mesh.castShadow = true;
  mesh.matrixAutoUpdate = false;
  mesh.updateMatrix();

  return {
    columns: samples,
    heights,
    mesh,
    rows: samples,
    size,
    triangles: cells * cells * 2,
  };
}

/** The surface normal at a point, for anything that has to sit flat on the ground. */
export function normalAt(x: number, z: number, target = new Vector3()): Vector3 {
  const h = 0.5;
  const dx = (heightAt(x + h, z) - heightAt(x - h, z)) / (2 * h);
  const dz = (heightAt(x, z + h) - heightAt(x, z - h)) / (2 * h);
  return target.set(-dx, 1, -dz).normalize();
}

export { LAKE, RIDGE, hash2, fbm, smoothstep };


/** The four ground layers this valley is made of, as diffuse/normal pairs from the pack. */
export interface ITerrainMaps {
  readonly grassDiffuse: Texture;
  readonly grassNormal: Texture;
  readonly litterDiffuse: Texture;
  readonly litterNormal: Texture;
  readonly rockDiffuse: Texture;
  readonly rockNormal: Texture;
  readonly dirtDiffuse: Texture;
  readonly dirtNormal: Texture;
}

/**
 * How many times a ground texture repeats across the valley.
 *
 * The pack's ground maps are authored at roughly two metres square, so this is `1 / 2`. Getting it
 * wrong is the loudest possible mistake: too small and the ground is a smear, too large and the
 * whole valley reads as graph paper.
 */
const TILING = 0.5;
/** A second sample at an incommensurate scale, mixed in to break the repeat. */
const TILING_MACRO = 0.077;

/**
 * Build the ground material: four layers, mixed per pixel by the weights baked into the mesh.
 *
 * This is the port of the reference. Landscape Pro chooses a layer per pixel inside an Unreal
 * material graph; that graph is `.uasset` and does not travel. What travels is its *textures* —
 * which imported cleanly — and its *rule*, which `layerWeights` above evaluates per vertex. The
 * GPU is left with the cheap half: mix four samples by an interpolated vec4.
 *
 * Written in TSL rather than `onBeforeCompile` because this game runs on `WebGPURenderer`, where
 * GLSL chunk injection silently does nothing at all.
 */
export function createTerrainMaterial(maps: ITerrainMaps): MeshStandardNodeMaterial {
  for (const map of Object.values(maps)) {
    map.wrapS = RepeatWrapping;
    map.wrapT = RepeatWrapping;
  }

  const material = new MeshStandardNodeMaterial({ metalness: 0, roughness: 0.92 });

  // World XZ as the UV. The terrain mesh sits at the origin and never moves, so local position is
  // world position — and a planar projection is correct for ground, which is what this is.
  const uv = vec2(positionLocal.x, positionLocal.z).mul(TILING);
  const uvMacro = vec2(positionLocal.x, positionLocal.z).mul(TILING_MACRO);

  const w = attribute<"vec4">("layerWeight", "vec4");
  const tint = attribute<"vec3">("color", "vec3");

  const blend = (a: Texture, b: Texture, c: Texture, d: Texture) =>
    texture(a, uv).mul(w.x).add(texture(b, uv).mul(w.y)).add(texture(c, uv).mul(w.z)).add(texture(d, uv).mul(w.w));

  const detail = blend(maps.grassDiffuse, maps.litterDiffuse, maps.rockDiffuse, maps.dirtDiffuse);
  // The same four layers again at a far larger scale, and the two multiplied. One tiling texture
  // repeats visibly every couple of metres; the same texture times a slow copy of itself repeats
  // at the lowest common multiple of the two, which is far past the fog.
  const macro = texture(maps.grassDiffuse, uvMacro).mul(w.x)
    .add(texture(maps.litterDiffuse, uvMacro).mul(w.y))
    .add(texture(maps.rockDiffuse, uvMacro).mul(w.z))
    .add(texture(maps.dirtDiffuse, uvMacro).mul(w.w));

  // The pack's maps are authored for Unreal's exposure and read very dark under this scene's
  // tonemapper. The gain is a look decision, made once, here — not baked into the files, so the
  // imported textures stay byte-identical to what the pack shipped.
  material.colorNode = detail.rgb.mul(macro.rgb.add(float(0.62))).mul(tint).mul(float(9.4));

  return material;
}
