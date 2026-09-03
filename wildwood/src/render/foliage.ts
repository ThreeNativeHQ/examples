// Generated for you. This is ordinary Three.js — edit or delete it freely.
// ThreeNative does not read this file.
//
// What grows on the valley floor: a closed conifer canopy, the young generation growing up under
// it, broadleaves and standing snags, thickets of shrub, a deep fern and grass floor, leaf litter,
// fallen logs and the stones between them — every one an imported Landscape Pro mesh, instanced,
// all of it moving in the wind.
//
// Five decisions worth knowing before you change anything here.
//
// **Nothing here is drawn by hand.** Every species is one imported pack GLB, split into an opaque
// section and (usually) a cut-out canopy or foliage section, each instanced with the maps the
// importer baked into it.
//
// **A niche is not a species list — it is a layer.** The pack ships eight "conifers"; this file
// deals five of them into the canopy at 20 m and the three small ones twice more, once as a 3–8 m
// mid-storey and once as knee-high saplings. The same seven "broadleaves" become standing trees,
// standing snags, and the logs lying across the floor. That is where a wood's depth comes from:
// the same mesh at three sizes reads as three generations, and the pack has no more species to
// give. See `LAYERS`.
//
// **Species are dealt by weight, not round-robin.** The pack's meshes differ by two orders of
// magnitude in triangles — `SM_rock01_lod000` is 7,178 triangles and `SM_RockGroup01` is 288, and
// dealing boulders evenly across the six spends 90% of the rock budget on four meshes nobody can
// tell apart at 3 m. Every layer names a `mix`, so the cheap meshes carry the density and the
// expensive ones are the specimens you walk up to. This is what paid for tripling the plant count
// at roughly the triangle load the even deal already cost.
//
// **The floor is patchy on purpose.** A jittered lattice sows *evenly*, and an evenly-sown floor
// reads as pins in a map however many pins you push in — which is exactly what the valley looked
// like before this. Every undergrowth layer runs through a smooth patch-density field (`clump`),
// so ferns grow in drifts with bare ground between them and the wood has thickets to walk around.
//
// **The wind is a vertex program, not an animation.** Swaying forty thousand plants from the CPU
// means rewriting forty thousand matrices every frame; swaying them in TSL costs nothing per frame.
// Bend is proportional to height above the instance's own origin, so trunks stay planted and only
// the crown moves. **TSL, not `onBeforeCompile`** — this game runs on `WebGPURenderer`, where GLSL
// chunk injection does nothing at all, silently.
import {
  BufferAttribute,
  BufferGeometry,
  Box3,
  DoubleSide,
  Euler,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  Quaternion,
  Vector3,
  type Texture,
} from "three";
import { MeshStandardNodeMaterial } from "three/webgpu";
import { float, instanceIndex, positionGeometry, positionLocal, sin, texture, time, uv, vec3 } from "three/tsl";
import { hash2, slopeAt, surfaceAt, WATER_LEVEL } from "./terrain.js";

/**
 * One draw-call-able slice of an imported mesh: the pack splits most species into an opaque part
 * and a cut-out part, each with its own maps baked in by the importer.
 */
export interface ITreeSection {
  readonly geometry: BufferGeometry;
  /** Cut-out foliage (alpha-keyed, double-sided) when true; opaque bark or stone when false. */
  readonly cutout: boolean;
  readonly map: Texture;
  readonly normal: Texture | undefined;
  readonly alphaCutoff: number;
}

/** One species as imported from the pack, with the measured size its scatter placement needs. */
export interface ITreeSpecies {
  readonly name: string;
  readonly sections: readonly ITreeSection[];
  /** Largest side of the species' bounding box, in metres. The normalisation divisor. */
  readonly maxDim: number;
  /**
   * The species' own height in metres.
   *
   * Normalising a *tree* on `maxDim` normalises the wrong axis for half the pack: `SM_green-tree01`
   * is 18% wider than it is tall, so asking for "18 metres" on the longest side plants a 15 m tree
   * next to a `SM_pine02` that took the same number as its height. Trees ask for `heightTo`.
   */
  readonly height: number;
}

/**
 * The niches the valley fills, each holding the imported species that live there.
 *
 * These are the pack's own groupings, not the wood's layers — `LAYERS` cuts them up again.
 */
export interface IFoliageSets {
  readonly broadleaves: readonly ITreeSpecies[];
  readonly cliffs: readonly ITreeSpecies[];
  readonly conifers: readonly ITreeSpecies[];
  readonly ferns: readonly ITreeSpecies[];
  readonly grasses: readonly ITreeSpecies[];
  readonly rocks: readonly ITreeSpecies[];
  readonly shrubs: readonly ITreeSpecies[];
}

export interface IScatterRule {
  readonly count: number;
  /** Reject ground steeper than this |gradient|. */
  readonly maxSlope: number;
  /** Reject ground lower than the waterline plus this. */
  readonly minHeight: number;
  /** Reject ground higher than this — nothing grows on the bare crown of the ridge. */
  readonly maxHeight: number;
  /** Keep this much clear around the origin, where the player spawns and needs to see out. */
  readonly clearing: number;
  readonly seed: number;
  /**
   * How strongly the layer gathers into drifts, 0 (evenly sown) to 1 (thickets and bare ground).
   * Trees take a little, undergrowth takes a lot.
   */
  readonly clump?: number;
  /** The width in metres of one patch of the density field `clump` reads. */
  readonly patch?: number;
}

export interface IScatterPoint {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** A stable per-instance random in [0, 1), for size and rotation variety. */
  readonly roll: number;
}

/**
 * A smooth 0..1 patch field: which parts of the floor this layer likes.
 *
 * Bilinear over a coarse hashed lattice, smoothstepped so the drifts have soft edges rather than
 * square cell borders. Each layer reads it at its own seed and patch width, so ferns, grass and
 * thicket drift independently instead of all thinning out in the same places.
 */
function patchDensity(x: number, z: number, patch: number, seed: number): number {
  const gx = x / patch;
  const gz = z / patch;
  const ix = Math.floor(gx);
  const iz = Math.floor(gz);
  const fx = gx - ix;
  const fz = gz - iz;
  const sx = fx * fx * (3 - 2 * fx);
  const sz = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz, seed);
  const b = hash2(ix + 1, iz, seed);
  const c = hash2(ix, iz + 1, seed);
  const d = hash2(ix + 1, iz + 1, seed);
  return (a + (b - a) * sx) * (1 - sz) + (c + (d - c) * sx) * sz;
}

/**
 * Rejection-sample points that satisfy a rule.
 *
 * Candidates come off a jittered lattice rather than uniform random pairs: uniform scatter clumps
 * and leaves bald patches at these counts, and a wood with bald patches reads as a bug.
 *
 * **Every cell is visited, and the thinning happens afterwards.** The obvious loop — walk the
 * lattice in raster order and stop once `count` points are in hand — silently sows the *first*
 * rows of the valley and leaves the rest bare the moment the lattice is oversampled, and this
 * layer list oversamples every one of them. So: gather every candidate, then keep the `count`
 * whose per-point hash ranks lowest, which thins uniformly across the whole extent.
 */
export function scatter(rule: IScatterRule, extent: number): IScatterPoint[] {
  const clump = rule.clump ?? 0;
  const patch = rule.patch ?? 18;
  // Oversample: the taken fraction falls with rejection, and a lattice sized for the target count
  // returns short once slope, height, clearing and patch thinning have all had their say.
  const lattice = Math.ceil(Math.sqrt(rule.count * (2.4 + 3.6 * clump)));
  const cell = (extent * 2) / lattice;
  const candidates: { key: number; point: IScatterPoint }[] = [];
  for (let index = 0; index < lattice * lattice; index += 1) {
    const ix = index % lattice;
    const iz = Math.floor(index / lattice);
    const jitterX = hash2(ix, iz, rule.seed);
    const jitterZ = hash2(ix, iz, rule.seed + 1);
    const x = -extent + (ix + jitterX) * cell;
    const z = -extent + (iz + jitterZ) * cell;
    if (Math.hypot(x, z) < rule.clearing) continue;
    // The drawn surface, not the analytic one — see `surfaceAt`. Placing on `heightAt`
    // leaves every plant on a hilltop hovering a few centimetres clear of the ground.
    const y = surfaceAt(x, z);
    if (y < WATER_LEVEL + rule.minHeight) continue;
    if (y > rule.maxHeight) continue;
    if (slopeAt(x, z) > rule.maxSlope) continue;
    if (clump > 0) {
      // Lerp toward the patch field: at clump 1 a point in the emptiest drift is refused outright
      // and one in the densest is always taken; at clump 0 the field is ignored.
      const admit = 1 - clump + clump * patchDensity(x, z, patch, rule.seed + 3) * 1.9;
      if (hash2(ix, iz, rule.seed + 4) > admit) continue;
    }
    candidates.push({
      key: hash2(ix, iz, rule.seed + 5),
      point: { roll: hash2(ix, iz, rule.seed + 2), x, y, z },
    });
  }
  if (candidates.length > rule.count) {
    candidates.sort((left, right) => left.key - right.key);
    candidates.length = rule.count;
  }
  return candidates.map((candidate) => candidate.point);
}

/**
 * Widen a quantized POSITION attribute to float before anything transforms it.
 *
 * The asset pipeline ships `KHR_mesh_quantization`: positions arrive as *normalized* int16, so
 * every component means a value in [-1, 1]. `BufferGeometry.applyMatrix4` reads those out as
 * floats, transforms them, and writes them back through `setXYZ`, which re-normalizes — and
 * `normalize()` **clamps**. A species whose node scale is 5 has 99.7% of its vertices outside
 * [-1, 1] after the bake, so all of them land on the faces of the unit cube and the tree collapses
 * into a blocky slab. Silently: no error, no warning, a perfectly valid draw of ruined geometry.
 */
function dequantizePositions(geometry: BufferGeometry): BufferGeometry {
  const position = geometry.getAttribute("position");
  if (position === undefined) return geometry;
  const plain = position instanceof BufferAttribute;
  if (plain && !position.normalized && position.array instanceof Float32Array) return geometry;
  const widened = new Float32Array(position.count * 3);
  for (let index = 0; index < position.count; index += 1) {
    widened[index * 3] = position.getX(index);
    widened[index * 3 + 1] = position.getY(index);
    widened[index * 3 + 2] = position.getZ(index);
  }
  geometry.setAttribute("position", new BufferAttribute(widened, 3));
  return geometry;
}

/**
 * Pull the renderable sections out of one imported GLB.
 *
 * The importer writes each species as a small set of primitives — bark, leafs — under identity
 * transforms. The world matrix is baked into the geometry clone anyway, so a future export that
 * offsets or scales a node cannot silently shear every instance of the species. The species'
 * bounding box is measured here too, because placement normalises by size and a species whose
 * scale is only discovered at draw time normalises wrong.
 */
export function extractTreeSpecies(name: string, model: { scene: Group }): ITreeSpecies {
  model.scene.updateMatrixWorld(true);
  const sections: ITreeSection[] = [];
  const bounds = new Box3();
  model.scene.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    const material = object.material;
    if (Array.isArray(material)) throw new Error(`Species ${name} has a multi-material section.`);
    const map = material.map;
    if (map === undefined || map === null) throw new Error(`Species ${name} has an untextured section.`);
    const cutout = material.alphaTest > 0 || material.transparent || /leaf|grass|plant|fern|flower|clover|nettle|bush/i.test(material.name);
    const geometry = dequantizePositions(object.geometry.clone()).applyMatrix4(object.matrixWorld);
    geometry.computeBoundingBox();
    if (geometry.boundingBox !== null) bounds.union(geometry.boundingBox);
    sections.push({
      alphaCutoff: material.alphaTest > 0 ? material.alphaTest : 0.5,
      cutout,
      geometry,
      map,
      normal: material.normalMap ?? undefined,
    });
  });
  if (sections.length === 0) throw new Error(`Species ${name} contained no mesh sections.`);
  const size = new Vector3();
  bounds.getSize(size);
  const maxDim = Math.max(size.x, size.y, size.z);
  if (!(maxDim > 0)) throw new Error(`Species ${name} measures as a point; the GLB carried no geometry.`);
  return { height: size.y, maxDim, name, sections };
}

/**
 * Replace every section's maps with the ones the scene decides are correct.
 *
 * Needed because the importer's filename-based resolver can bind a *data* map as a base colour:
 * the rock material instances carry a packed height/AO/curvature texture, the resolver matched it
 * as "exact", and a packed data map multiplied by an exposure gain glows radioactive green. The
 * scene knows which diffuse the pack's stone actually wears — the same `cliffrocks` maps the
 * terrain's rock layer uses — and says so here, once, at load time.
 */
export function retextureSpecies(species: ITreeSpecies, map: Texture, normal?: Texture): ITreeSpecies {
  return {
    height: species.height,
    maxDim: species.maxDim,
    name: species.name,
    sections: species.sections.map((section) => ({
      alphaCutoff: section.alphaCutoff,
      cutout: section.cutout,
      geometry: section.geometry,
      map,
      normal: normal ?? section.normal,
    })),
  };
}

/**
 * A material for one section of an imported pack mesh: the GLB's own maps, lifted for this
 * scene's exposure, wearing the wind this niche moves with.
 *
 * The pack's maps are authored for Unreal's exposure and are dark, so the colour is multiplied
 * the same way every other surface out of this pack is lifted. Cut-out sections are double-sided
 * including `shadowSide`, or a branch seen from beneath is a hole.
 */
export function packSectionMaterial(
  section: ITreeSection,
  wind: { readonly strength: number; readonly stiffness: number; readonly speed: number },
  gain: readonly [number, number, number],
): MeshStandardNodeMaterial {
  const material = new MeshStandardNodeMaterial({ metalness: 0, roughness: 0.92 });
  const sample = texture(section.map, uv());
  material.colorNode = sample.rgb.mul(vec3(gain[0], gain[1], gain[2]));
  if (section.normal !== undefined) material.normalMap = section.normal;
  section.map.anisotropy = 8;
  if (section.cutout) {
    material.side = DoubleSide;
    material.shadowSide = DoubleSide;
    // The GLB carries a real alpha channel, unlike the JPEG atlases this used to be fed — so the
    // cut runs on alpha itself, at the threshold the import recorded from the pack.
    material.alphaTest = section.alphaCutoff;
    material.opacityNode = sample.a;
  }
  if (wind.strength > 0) applyWind(material, wind.strength, wind.stiffness, wind.speed);
  return material;
}

/**
 * A material that bends with the wind.
 *
 * `strength` is the sway in metres at one metre above the instance origin; `stiffness` is the
 * exponent on height, so a high number keeps the lower trunk rigid and puts all the motion in the
 * crown. Each instance gets its own phase from its index — without that the whole wood leans as
 * one object, which is the single loudest tell of a fake wind.
 */
function applyWind(
  material: MeshStandardNodeMaterial,
  strength: number,
  stiffness: number,
  speed: number,
): void {
  // A cheap decorrelating hash: sin of a large irrational multiple of the index.
  const phase = float(instanceIndex).mul(12.9898).sin().mul(43_758.545).fract().mul(6.2831);
  // Two waves, and BOTH are slow. Real foliage in a light breeze moves at well under a tenth of a
  // hertz — the sway is something you notice only if you stop and watch a branch. The harmonic is
  // quiet and further from an integer ratio, so the two never line up into a visible pulse.
  const gust = sin(time.mul(speed).add(phase))
    .mul(0.82)
    .add(sin(time.mul(speed * 1.73).add(phase.mul(1.7))).mul(0.18));
  // The lift reads **`positionGeometry`**, not `positionLocal`. This is the one trap in the file:
  // for an InstancedMesh the pipeline multiplies the instance matrix into `positionLocal` BEFORE
  // the material's `positionNode` runs, so `positionLocal.y` up here is the plant's height *in the
  // world* — and lifting on it shoves the base around as much as the crown, which reads as the
  // whole plant hovering. `positionGeometry` is the raw attribute: zero at the root, so the base
  // is pinned and only the crown bends. The displacement itself is still applied to
  // `positionLocal`, in instance space, which for yaw-only placements is world-aligned anyway.
  // `float(0)` and `float(stiffness)`, not `0` and `stiffness`. A bare JS number reaches the
  // generated GLSL as an int literal, and `max(float, int)` has no overload — the shader fails to
  // compile and the whole material silently falls back, which on screen looks like the wind simply
  // not working rather than like an error.
  const lift = positionGeometry.y.max(float(0)).pow(float(stiffness));
  const bend = gust.mul(lift).mul(float(strength));
  material.positionNode = vec3(
    positionLocal.x.add(bend),
    // Bending an arc without shortening the radius stretches the plant; taking a little height back
    // in proportion to the square of the bend keeps a swaying trunk the length it started.
    positionLocal.y.sub(bend.mul(bend).mul(float(0.35))),
    positionLocal.z.add(bend.mul(float(0.55))),
  );
}

function instance(
  geometry: BufferGeometry,
  material: MeshStandardNodeMaterial,
  points: readonly IScatterPoint[],
  place: (point: IScatterPoint, index: number, matrix: Matrix4) => void,
  name: string,
): InstancedMesh {
  const mesh = new InstancedMesh(geometry, material, points.length);
  mesh.name = name;
  const matrix = new Matrix4();
  points.forEach((point, index) => {
    place(point, index, matrix);
    mesh.setMatrixAt(index, matrix);
  });
  mesh.instanceMatrix.needsUpdate = true;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  // Instanced foliage covering the whole valley has a bounding sphere the size of the valley, so
  // per-object frustum culling can only ever cull it when it is entirely off screen — and the
  // sphere three computes from instance 0 alone is wrong. Draw it always; the depth buffer is
  // cheaper than a wrong cull that pops the wood out of frame when you turn your head.
  mesh.frustumCulled = false;
  return mesh;
}

export interface IFoliage {
  readonly meshes: readonly InstancedMesh[];
  readonly boulderCount: number;
  readonly treeCount: number;
  readonly fernCount: number;
  readonly grassCount: number;
  /** Trunk positions, so gameplay can keep the player from standing inside a tree. */
  readonly trunks: readonly Vector3[];
}

/** How the instances of one layer stand. */
type Stance =
  /** Upright whatever the slope beneath — a tree tilted onto the normal looks felled, not planted. */
  | "upright"
  /** A settled tumble: a slight tilt reads as settled, a full 3-axis tumble reads as dropped. */
  | "tumbled"
  /** Tipped onto its side and half-sunk: the trunks lying across the forest floor. */
  | "fallen"
  /** Pressed flat to the ground with a free yaw — leaf litter, clover mats, moss. */
  | "flat";

/**
 * One layer of the wood: which species, how many, how big, how they stand, how they move.
 *
 * Sizes are metres. A layer names **either** `heightTo` (normalise the species' height, what trees
 * want) **or** `sizeTo` (normalise its longest side, what ground cover wants), never both.
 */
interface ILayer {
  readonly name: string;
  /** Which of the pack's niches this layer draws from, and the names within them it takes. */
  readonly from: (sets: IFoliageSets) => readonly ITreeSpecies[];
  /**
   * Relative share per species, matched by name; the first matching pattern wins and anything
   * unmatched is 1. This is the triangle budget: cheap meshes carry density, dear ones are
   * specimens.
   */
  readonly mix?: readonly (readonly [RegExp, number])[];
  readonly rule: IScatterRule;
  /** Per-instance scale after normalisation, as [minimum, roll-spread]. */
  readonly size: readonly [number, number];
  readonly heightTo?: number;
  readonly sizeTo?: number;
  /**
   * The share of instances that grow into specimens, and how much larger they get. A wood with
   * one size of tree reads as planted; a few old giants over the general canopy is what makes it
   * read as grown.
   */
  readonly giants?: readonly [number, number];
  /** Radians of random lean. Undergrowth leans; trunks do not. */
  readonly lean?: number;
  /** Sunk this fraction of its own scale into the ground, to hide the mesh/terrain seam. */
  readonly sink: number;
  readonly stance: Stance;
  readonly recordTrunks?: boolean;
  readonly castShadows: boolean;
  readonly wind: { readonly strength: number; readonly stiffness: number; readonly speed: number };
  readonly gain: readonly [number, number, number];
  /** Which of the four reported totals this layer's instances count toward. */
  readonly tally: "trees" | "ferns" | "ground" | "stone";
}

/** Trunks and boughs: a slow, stiff sway with all the motion in the crown. */
const TREE_WIND = { strength: 0.011, stiffness: 1.8, speed: 0.11 } as const;
const CANOPY_WIND = { strength: 0.013, stiffness: 1.6, speed: 0.1 } as const;
/** Cut-out foliage: a slow shiver. The old values moved three times too fast for real plants. */
const LEAF_WIND = { strength: 0.045, stiffness: 1.3, speed: 0.13 } as const;
const GRASS_WIND = { strength: 0.07, stiffness: 1.25, speed: 0.16 } as const;
const STILL = { strength: 0, stiffness: 1, speed: 0 } as const;

const BARK_GAIN = [3.9, 3.4, 2.7] as const;
const LEAF_GAIN = [3.3, 3.6, 2.8] as const;
const STONE_GAIN = [3.0, 2.9, 2.7] as const;

/** Take the species of a niche whose pack names match any of these patterns. */
function pick(species: readonly ITreeSpecies[], ...patterns: readonly RegExp[]): ITreeSpecies[] {
  return species.filter((one) => patterns.some((pattern) => pattern.test(one.name)));
}

/**
 * Deal `slots` instances across species in proportion to their weights, interleaved.
 *
 * Largest-remainder: each slot goes to whichever species is furthest behind its entitlement, so a
 * 3:1 mix alternates rather than laying down a run of one species and then a run of the other.
 * Interleaving matters because the deal is indexed by scatter order, which is spatially coherent —
 * a run of one species would put every specimen of it in the same corner of the valley.
 */
function dealShares(weights: readonly number[], slots: number): number[] {
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  if (!(total > 0)) return [];
  const awarded = weights.map(() => 0);
  const table: number[] = [];
  for (let slot = 0; slot < slots; slot += 1) {
    let best = 0;
    let bestDebt = -Infinity;
    for (let index = 0; index < weights.length; index += 1) {
      const debt = ((weights[index] ?? 0) / total) * (slot + 1) - (awarded[index] ?? 0);
      if (debt > bestDebt) {
        bestDebt = debt;
        best = index;
      }
    }
    awarded[best] = (awarded[best] ?? 0) + 1;
    table.push(best);
  }
  return table;
}

function weightOf(name: string, mix: ILayer["mix"]): number {
  if (mix === undefined) return 1;
  for (const [pattern, weight] of mix) if (pattern.test(name)) return weight;
  return 1;
}

/**
 * The wood, layer by layer, from the crowns down to the litter.
 *
 * Counts are for the whole 182 m valley. They are the density dial: `pine0[1-5]` at 500 is a
 * canopy you cannot see the sky through from under it, and at 200 it is the parkland this valley
 * used to be.
 */
const LAYERS: readonly ILayer[] = [
  {
    // The canopy. Twenty metres, which is the whole point: the pack's pines are 5–7 m as they
    // ship, and a 6 m tree over a 1.7 m eye is a hedge, not a wood. Normalised on HEIGHT, then a
    // wide roll and a giant tail on top, so the crowns close at several different levels.
    castShadows: true,
    from: (sets) => pick(sets.conifers, /^SM_pine0[1-5]$/),
    gain: BARK_GAIN,
    giants: [0.12, 1.5],
    heightTo: 20,
    mix: [
      [/pine03/, 1.7],
      [/pine01/, 1.4],
      [/pine02/, 1.2],
      [/pine05/, 0.6],
    ],
    name: "canopy",
    recordTrunks: true,
    rule: { clearing: 11, clump: 0.58, count: 540, maxHeight: 25, maxSlope: 1.15, minHeight: 1.2, patch: 34, seed: 4_101 },
    sink: 0.02,
    size: [0.62, 0.62],
    stance: "upright",
    tally: "trees",
    wind: TREE_WIND,
  },
  {
    // Broadleaves on the low flat ground, wider than they are tall, so they fill the gaps the
    // conifer spires leave rather than competing with them.
    castShadows: true,
    from: (sets) => pick(sets.broadleaves, /^SM_green-tree/),
    gain: BARK_GAIN,
    giants: [0.1, 1.45],
    heightTo: 14,
    name: "broadleaf",
    recordTrunks: true,
    rule: { clearing: 11, clump: 0.4, count: 210, maxHeight: 15, maxSlope: 0.55, minHeight: 0.9, patch: 26, seed: 8_803 },
    sink: 0.02,
    size: [0.66, 0.6],
    stance: "upright",
    tally: "trees",
  wind: TREE_WIND,
  },
  {
    // Standing snags: dead trunks with the bark still on. Weighted to the two cheap ones — a snag
    // is read as a silhouette and nobody counts its branches.
    castShadows: true,
    from: (sets) => pick(sets.broadleaves, /^SM_dead-tree/),
    gain: BARK_GAIN,
    heightTo: 12,
    mix: [
      [/dead-tree04/, 2.2],
      [/dead-tree03/, 1.8],
      [/dead-tree0[25]/, 0.5],
    ],
    name: "snag",
    recordTrunks: true,
    rule: { clearing: 12, clump: 0.45, count: 130, maxHeight: 20, maxSlope: 0.8, minHeight: 0.8, patch: 24, seed: 6_299 },
    sink: 0.03,
    size: [0.6, 0.55],
    stance: "upright",
    tally: "trees",
    wind: TREE_WIND,
  },
  {
    // The young generation, and the reason the wood has a middle. Three pack meshes at 286–530
    // triangles each, blown up to 3–8 m: twelve hundred of them cost less than forty canopy pines
    // and they are what closes the sightlines between the trunks.
    castShadows: true,
    from: (sets) => pick(sets.conifers, /^SM_pine-small/),
    gain: BARK_GAIN,
    heightTo: 5.5,
    name: "midstorey",
    rule: { clearing: 9, clump: 0.62, count: 1_250, maxHeight: 24, maxSlope: 1.05, minHeight: 0.8, patch: 20, seed: 21_713 },
    sink: 0.04,
    size: [0.55, 1.0],
    stance: "upright",
    tally: "trees",
    wind: TREE_WIND,
  },
  {
    // The same three meshes again at knee height. Seedlings under the parent trees.
    castShadows: false,
    from: (sets) => pick(sets.conifers, /^SM_pine-small/),
    gain: LEAF_GAIN,
    heightTo: 1.6,
    lean: 0.1,
    name: "sapling",
    rule: { clearing: 6, clump: 0.78, count: 1_500, maxHeight: 22, maxSlope: 1.0, minHeight: 0.5, patch: 13, seed: 24_907 },
    sink: 0.06,
    size: [0.5, 0.95],
    stance: "upright",
    tally: "ground",
    wind: LEAF_WIND,
  },
  {
    // Deadfall. The two cheapest snags tipped onto their sides and half-sunk: from a walker's eye
    // these are the logs you step over, and they are most of what makes a floor read as a floor
    // rather than as a lawn.
    castShadows: true,
    from: (sets) => pick(sets.broadleaves, /^SM_dead-tree0[34]$/),
    gain: BARK_GAIN,
    heightTo: 9,
    name: "deadfall",
    rule: { clearing: 7, clump: 0.5, count: 210, maxHeight: 20, maxSlope: 0.5, minHeight: 0.5, patch: 22, seed: 30_011 },
    sink: 0.16,
    size: [0.55, 0.5],
    stance: "fallen",
    tally: "trees",
    wind: STILL,
  },
  {
    // Thicket: the waist-to-shoulder mass between the trunks. Drawn from the shrubs AND from the
    // grass niche's four `grass_bush` meshes, which are shrubs the pack happened to file as grass.
    castShadows: false,
    from: (sets) => [
      ...pick(sets.shrubs, /bush01|Nettle|Weath/),
      ...pick(sets.grasses, /grass_bush/),
    ],
    gain: LEAF_GAIN,
    lean: 0.12,
    mix: [
      [/NettleGroup01/, 2.4],
      [/WeathGroup02/, 2.0],
      [/WeathGroup01|NettleGroup02/, 1.5],
      [/grass_bush/, 0.55],
      [/bush01/, 0.5],
    ],
    name: "thicket",
    rule: { clearing: 7, clump: 0.75, count: 1_600, maxHeight: 22, maxSlope: 0.95, minHeight: 0.5, patch: 15, seed: 12_703 },
    sink: 0.07,
    sizeTo: 2.1,
    size: [0.6, 0.8],
    stance: "upright",
    tally: "ground",
    wind: LEAF_WIND,
  },
  {
    // Flowers and soft-stemmed plants on the open margins — 21 to 143 triangles each, so this
    // whole layer is cheaper than nine canopy pines.
    castShadows: false,
    from: (sets) => pick(sets.shrubs, /Flower|PlantGroup|LargePlant/),
    gain: LEAF_GAIN,
    lean: 0.14,
    name: "margin",
    rule: { clearing: 6, clump: 0.5, count: 2_200, maxHeight: 22, maxSlope: 0.9, minHeight: 0.5, patch: 17, seed: 18_233 },
    sink: 0.08,
    sizeTo: 1.35,
    size: [0.65, 0.6],
    stance: "upright",
    tally: "ground",
    wind: LEAF_WIND,
  },
  {
    // Ferns, in drifts. `clump` is high here on purpose: an evenly sown fern floor is the "pins in
    // a map" look, and a fern floor with drifts and bare ground between them is a wood.
    castShadows: false,
    from: (sets) => sets.ferns,
    gain: LEAF_GAIN,
    lean: 0.16,
    mix: [
      [/FarnGroup/, 2.4],
      [/new_farn/, 0.7],
    ],
    heightTo: 0.62,
    name: "fern",
    rule: { clearing: 5, clump: 0.72, count: 7_000, maxHeight: 18, maxSlope: 0.8, minHeight: 0.4, patch: 16, seed: 15_527 },
    sink: 0.08,
    size: [0.65, 0.8],
    stance: "upright",
    tally: "ferns",
    wind: LEAF_WIND,
  },
  {
    // Grass, everywhere, and taller than it was: 0.62 m rather than 0.55 m, which is the
    // difference between blades you notice at your feet and a sward you walk through.
    castShadows: false,
    from: (sets) => pick(sets.grasses, /GrassGroup/),
    gain: LEAF_GAIN,
    lean: 0.1,
    heightTo: 0.55,
    mix: [
      [/GrassGroup0[12]/, 1.7],
      [/GrassGroup03/, 0.5],
    ],
    name: "grass",
    rule: { clearing: 0, clump: 0.45, count: 13_000, maxHeight: 20, maxSlope: 0.95, minHeight: 0.15, patch: 11, seed: 27_449 },
    sink: 0.1,
    size: [0.6, 0.8],
    stance: "upright",
    tally: "ground",
    wind: GRASS_WIND,
  },
  {
    // Leaf litter. The pack's three clover mats are flat meshes of ~78 triangles; pressed to the
    // ground at a metre across they are the layer that stops the terrain texture reading as bare
    // paint, and nine thousand of them cost less than sixty canopy pines.
    castShadows: false,
    from: (sets) => pick(sets.grasses, /clover/),
    gain: LEAF_GAIN,
    name: "litter",
    rule: { clearing: 0, clump: 0.6, count: 11_000, maxHeight: 21, maxSlope: 1.0, minHeight: 0.15, patch: 12, seed: 31_337 },
    sink: 0,
    sizeTo: 1.45,
    size: [0.55, 0.95],
    stance: "flat",
    tally: "ground",
    wind: GRASS_WIND,
  },
  {
    // Boulders. Allowed on ground far steeper than anything that grows, and right down to the
    // waterline, because a rock in the shallows is exactly where a rock ends up. Weighted six to
    // one toward the two 220–288 triangle rock groups over the four 7,200 triangle scans, which
    // is why there can be half again as many of them for half the triangles.
    castShadows: true,
    from: (sets) => sets.rocks,
    gain: STONE_GAIN,
    mix: [
      [/RockGroup/, 3.2],
      [/rock0[1-4]_lod000/, 0.55],
    ],
    name: "rocks",
    rule: { clearing: 4, clump: 0.5, count: 1_250, maxHeight: 30, maxSlope: 1.6, minHeight: -1.5, patch: 20, seed: 33_301 },
    sink: 0.35,
    sizeTo: 1.2,
    size: [0.3, 1.0],
    stance: "tumbled",
    tally: "stone",
    wind: STILL,
  },
  {
    // Loose stones half-buried in the litter — the same two cheap rock groups at 40 cm. Ground
    // clutter, not scenery: you only notice them when they are missing.
    castShadows: false,
    from: (sets) => pick(sets.rocks, /RockGroup/),
    gain: STONE_GAIN,
    name: "stones",
    rule: { clearing: 3, clump: 0.55, count: 1_700, maxHeight: 26, maxSlope: 1.3, minHeight: -0.5, patch: 14, seed: 35_797 },
    sink: 0.45,
    sizeTo: 0.42,
    size: [0.5, 0.9],
    stance: "tumbled",
    tally: "stone",
    wind: STILL,
  },
];

/**
 * Grow the wood.
 *
 * `extent` is half the valley's width; `clearing` is how much space to leave around the spawn.
 * Every layer in `LAYERS` is scattered, dealt across its species by weight, and instanced once per
 * species section. The clearing each layer names is scaled by the caller's, so raising the spawn
 * clearing opens the whole wood rather than only its canopy.
 */
export function createFoliage(extent: number, clearing: number, sets: IFoliageSets): IFoliage {
  const trunks: Vector3[] = [];
  const up = new Vector3(0, 1, 0);
  const scratch = new Quaternion();
  const lean = new Quaternion();
  const scale = new Vector3();
  const position = new Vector3();
  const euler = new Euler();
  const meshes: InstancedMesh[] = [];
  const tally = { ferns: 0, ground: 0, stone: 0, trees: 0 };
  const report: string[] = [];
  // The layers name their clearings against the 9 m spawn clearing this game ships; scale rather
  // than replace, so a caller asking for a wider clearing widens every layer's.
  const clearingScale = clearing / 9;

  for (const layer of LAYERS) {
    const species = layer.from(sets);
    if (species.length === 0) continue;
    const points = scatter(
      { ...layer.rule, clearing: layer.rule.clearing * clearingScale },
      extent,
    );
    if (points.length === 0) continue;
    const weights = species.map((one) => weightOf(one.name, layer.mix));
    // A deal table an order of magnitude finer than the species count keeps the mix even across
    // any prefix of the scatter, which matters because the scatter is spatially coherent.
    const table = dealShares(weights, Math.max(species.length * 24, 120));
    const shares = species.map<IScatterPoint[]>(() => []);
    points.forEach((point, index) => {
      shares[table[index % table.length] ?? 0]?.push(point);
    });
    tally[layer.tally] += points.length;

    species.forEach((one, variant) => {
      const share = shares[variant] ?? [];
      if (share.length === 0) return;
      // Normalise on height for anything that stands as a tree, on the longest side for ground
      // cover whose height is not what you read it by.
      const divisor = layer.heightTo === undefined ? one.maxDim : one.height;
      const target = layer.heightTo ?? layer.sizeTo;
      const fit = target === undefined || !(divisor > 0) ? 1 : target / divisor;
      const place = placement(layer, fit, {
        euler,
        lean,
        position,
        scale,
        scratch,
        trunks,
        up,
      });
      one.sections.forEach((section, sectionIndex) => {
        const mesh = instance(
          section.geometry,
          packSectionMaterial(section, section.cutout ? CANOPY_WIND : layer.wind, layer.gain),
          share,
          place(sectionIndex === 0 && layer.recordTrunks === true),
          `${layer.name}-${one.name}-${String(sectionIndex)}`,
        );
        if (!layer.castShadows) mesh.castShadow = false;
        meshes.push(mesh);
      });
    });
    report.push(`${layer.name}=${String(points.length)}/${String(species.length)}sp`);
  }

  // One line, because every density decision in this file is a number somebody will want to read
  // back without opening a screenshot. `TN_FOLIAGE` is grepped by tools/foliage-shot.mjs.
  console.info(`TN_FOLIAGE ${report.join(" ")} meshes=${String(meshes.length)}`);

  return {
    boulderCount: tally.stone,
    fernCount: tally.ferns,
    grassCount: tally.ground,
    meshes,
    treeCount: tally.trees,
    trunks,
  };
}

/** The scratch objects one layer's placement borrows, so placing 40,000 instances allocates none. */
interface IPlacementScratch {
  readonly up: Vector3;
  readonly scratch: Quaternion;
  readonly lean: Quaternion;
  readonly scale: Vector3;
  readonly position: Vector3;
  readonly euler: Euler;
  readonly trunks: Vector3[];
}

/**
 * Build the matrix-writer for one species of one layer.
 *
 * The four stances differ only in the rotation they compose and how deep they sit, so they share
 * everything else: the size roll, the giant tail, the lean, and the sink.
 */
function placement(
  layer: ILayer,
  fit: number,
  scratch: IPlacementScratch,
): (record: boolean) => (point: IScatterPoint, index: number, matrix: Matrix4) => void {
  return (record) =>
    (point, index, matrix): void => {
      let size = (layer.size[0] + point.roll * layer.size[1]) * fit;
      if (layer.giants !== undefined && hash2(index, 11, layer.rule.seed) < layer.giants[0]) {
        size *= layer.giants[1];
      }
      // Yaw comes off a different hash from `roll`, which also drives size: sharing one would tie
      // every large tree in the valley to the same compass bearing.
      const yaw = hash2(index, 3, layer.rule.seed + 7) * Math.PI * 2;
      switch (layer.stance) {
        case "fallen": {
          // Tipped a hair past horizontal so the crown end rests on the ground rather than in it,
          // and rolled about its own length so no two logs show the same face.
          scratch.euler.set(Math.PI * 0.47, yaw, hash2(index, 4, layer.rule.seed + 8) * Math.PI * 2, "YXZ");
          scratch.scratch.setFromEuler(scratch.euler);
          break;
        }
        case "flat": {
          // Pressed to the ground, with only enough tilt to stop a mat of litter reading as a decal.
          scratch.euler.set(
            (hash2(index, 5, layer.rule.seed + 9) - 0.5) * 0.3,
            yaw,
            (hash2(index, 6, layer.rule.seed + 10) - 0.5) * 0.3,
            "YXZ",
          );
          scratch.scratch.setFromEuler(scratch.euler);
          break;
        }
        case "tumbled": {
          scratch.euler.set(
            (hash2(index, 5, 97) - 0.5) * 0.24,
            yaw,
            (hash2(index, 6, 101) - 0.5) * 0.24,
            "YXZ",
          );
          scratch.scratch.setFromEuler(scratch.euler);
          break;
        }
        default: {
          // Trees stand up straight whatever the slope beneath them. A tree rotated onto the
          // surface normal on a 30-degree hillside looks felled, not planted. Undergrowth gets a
          // little lean, because a fern that stands to attention reads as a prop.
          scratch.scratch.setFromAxisAngle(scratch.up, yaw);
          if (layer.lean !== undefined && layer.lean > 0) {
            scratch.euler.set(
              (hash2(index, 7, layer.rule.seed + 11) - 0.5) * 2 * layer.lean,
              0,
              (hash2(index, 8, layer.rule.seed + 12) - 0.5) * 2 * layer.lean,
              "YXZ",
            );
            scratch.lean.setFromEuler(scratch.euler);
            scratch.scratch.multiply(scratch.lean);
          }
          break;
        }
      }
      scratch.position.set(point.x, point.y - size * layer.sink, point.z);
      const stretch =
        layer.stance === "flat" || layer.stance === "fallen"
          ? 1
          : 0.88 + hash2(index, 9, layer.rule.seed + 13) * 0.34;
      scratch.scale.set(size, size * stretch, size);
      matrix.compose(scratch.position, scratch.scratch, scratch.scale);
      if (record) scratch.trunks.push(new Vector3(point.x, point.y, point.z));
    };
}
