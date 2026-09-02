// Generated for you. This is ordinary Three.js — edit or delete it freely.
// ThreeNative does not read this file.
//
// What grows on the valley floor: trees, shrubs, ferns, grass, and the boulders between them —
// every one an imported Landscape Pro mesh, instanced, all of it moving in the wind.
//
// Three decisions worth knowing before you change anything here.
//
// **Nothing here is drawn by hand any more.** Every species is one imported pack GLB, split into
// an opaque section and (usually) a cut-out canopy or foliage section, each instanced with the
// maps the importer baked into it. The scatter's ecological rules (conifers high and steep,
// broadleaves low and flat, grass everywhere, boulders wherever soil gave up) deal their points
// round-robin across the imported species of each niche.
//
// **The wind is a vertex program, not an animation.** Swaying ten thousand plants from the CPU
// means rewriting ten thousand matrices every frame; swaying them in TSL costs nothing per frame
// and scales to however many blades you want. Bend is proportional to height above the instance's
// own origin, so trunks stay planted and only the crown moves.
//
// **TSL, not `onBeforeCompile`.** This game runs on `WebGPURenderer`, where GLSL chunk injection
// does nothing at all — silently. If a shader edit here appears to have no effect, that is the
// first thing to check.
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
}

/**
 * The niches the valley fills, each holding the imported species that live there.
 *
 * Conifers take the high steep ground, broadleaves the low flat ground, shrubs and flowers the
 * open margins, ferns the shade, grass the whole floor, and rocks wherever nothing grows.
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
}

export interface IScatterPoint {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** A stable per-instance random in [0, 1), for size and rotation variety. */
  readonly roll: number;
}

/**
 * Rejection-sample points that satisfy a rule.
 *
 * Candidates come off a jittered lattice rather than uniform random pairs: uniform scatter clumps
 * and leaves bald patches at these counts, and a wood with bald patches reads as a bug. Bounded
 * attempts, so a rule nothing can satisfy returns short rather than hanging the load.
 */
export function scatter(rule: IScatterRule, extent: number): IScatterPoint[] {
  const points: IScatterPoint[] = [];
  const lattice = Math.ceil(Math.sqrt(rule.count * 2.4));
  const cell = (extent * 2) / lattice;
  for (let index = 0; index < lattice * lattice && points.length < rule.count; index += 1) {
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
    points.push({ roll: hash2(ix, iz, rule.seed + 2), x, y, z });
  }
  return points;
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
  return { maxDim, name, sections };
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

/** How one niche's species are sown: sizes are metres *before* normalisation. */
interface INiche {
  readonly species: readonly ITreeSpecies[];
  readonly points: readonly IScatterPoint[];
  /** Per-instance scale, as [minimum, roll-spread]. */
  readonly size: readonly [number, number];
  /** Shrink or grow each species so its longest side would be this many metres, before scaling. */
  readonly normalizeTo: number | undefined;
  /** Sunk this fraction of its own scale into the ground, to hide the mesh/terrain seam. */
  readonly sink: number;
  readonly recordTrunks: boolean;
  readonly castShadows: boolean;
  readonly name: string;
  readonly wind: { readonly strength: number; readonly stiffness: number; readonly speed: number };
  readonly gain: readonly [number, number, number];
}

/** The trees: lifted exactly as the pack ships them, no normalisation. */
const TREE_WIND = { strength: 0.011, stiffness: 1.8, speed: 0.11 } as const;
const CANOPY_WIND = { strength: 0.013, stiffness: 1.6, speed: 0.1 } as const;
/** Cut-out foliage: a slow shiver. The old values moved three times too fast for real plants. */
const LEAF_WIND = { strength: 0.045, stiffness: 1.3, speed: 0.13 } as const;
const GRASS_WIND = { strength: 0.07, stiffness: 1.25, speed: 0.16 } as const;
const STILL = { strength: 0, stiffness: 1, speed: 0 } as const;

/**
 * Grow the wood.
 *
 * `extent` is half the valley's width; `clearing` is how much space to leave around the spawn.
 * Each niche's points are dealt round-robin across that niche's imported species, so the mix stays
 * even across the valley instead of clustering one species in one corner.
 */
export function createFoliage(extent: number, clearing: number, sets: IFoliageSets): IFoliage {
  const trunks: Vector3[] = [];
  const up = new Vector3(0, 1, 0);
  const scratch = new Quaternion();
  const scale = new Vector3();
  const position = new Vector3();

  const conifers = scatter(
    { clearing, count: 470, maxHeight: 25, maxSlope: 1.15, minHeight: 1.2, seed: 4_101 },
    extent,
  );
  const broadleaves = scatter(
    { clearing, count: 360, maxHeight: 15, maxSlope: 0.55, minHeight: 0.9, seed: 8_803 },
    extent,
  );
  const shrubs = scatter(
    { clearing: clearing * 0.6, count: 900, maxHeight: 22, maxSlope: 0.9, minHeight: 0.5, seed: 12_703 },
    extent,
  );
  const ferns = scatter(
    { clearing: clearing * 0.45, count: 2_600, maxHeight: 18, maxSlope: 0.8, minHeight: 0.4, seed: 15_527 },
    extent,
  );
  // Boulders. Allowed on ground far steeper than anything that grows, and right down to the
  // waterline, because a rock in the shallows is exactly where a rock ends up.
  const boulders = scatter(
    { clearing: 4, count: 900, maxHeight: 30, maxSlope: 1.6, minHeight: -1.5, seed: 33_301 },
    extent,
  );
  const grass = scatter(
    { clearing: 0, count: 7_400, maxHeight: 20, maxSlope: 0.95, minHeight: 0.15, seed: 27_449 },
    extent,
  );
  // The cliff meshes are NOT scattered. Sown on high steep ground they lean off slopes as dark
  // prisms that loom over the trailhead; the ridge already reads as rock from the boulders, and
  // the cliff faces' one good use is the standing stone they become in landmarks.ts.

  const placeUpright =
    (niche: INiche, species: ITreeSpecies, record: boolean) =>
    (point: IScatterPoint, _index: number, matrix: Matrix4): void => {
      // Small import, big world: normalisation puts every species' own metre-scale behind the
      // niche's size range, so a 2 m pack bush and a 6 m one sow at the same visual size.
      const fit = niche.normalizeTo === undefined ? 1 : niche.normalizeTo / species.maxDim;
      const size = (niche.size[0] + point.roll * niche.size[1]) * fit;
      // Trees stand up straight whatever the slope beneath them. A tree rotated onto the surface
      // normal on a 30-degree hillside looks felled, not planted.
      scratch.setFromAxisAngle(up, point.roll * Math.PI * 2);
      position.set(point.x, point.y - size * niche.sink, point.z);
      scale.set(size, size * (0.9 + point.roll * 0.3), size);
      matrix.compose(position, scratch, scale);
      if (record) trunks.push(new Vector3(point.x, point.y, point.z));
    };

  // The rock niche tumbles a little — a slight tilt reads as settled, a full 3-axis tumble reads
  // as dropped from the sky.
  const placeRock =
    (niche: INiche, species: ITreeSpecies) =>
    (point: IScatterPoint, index: number, matrix: Matrix4): void => {
      const fit = niche.normalizeTo === undefined ? 1 : niche.normalizeTo / species.maxDim;
      const size = (niche.size[0] + point.roll * niche.size[1]) * fit;
      scratch.setFromEuler(
        new Euler((hash2(index, 5, 97) - 0.5) * 0.24, point.roll * 6.283, (hash2(index, 6, 101) - 0.5) * 0.24),
      );
      position.set(point.x, point.y - size * niche.sink, point.z);
      scale.set(size, size * (0.7 + point.roll * 0.4), size * (0.85 + hash2(index, 7, 103) * 0.3));
      matrix.compose(position, scratch, scale);
    };

  const sown = (niche: INiche): void => {
    niche.species.forEach((species, variant) => {
      const share = niche.points.filter((_, index) => index % niche.species.length === variant);
      if (share.length === 0) return;
      species.sections.forEach((section, sectionIndex) => {
        const mesh = instance(
          section.geometry,
          packSectionMaterial(section, section.cutout ? CANOPY_WIND : niche.wind, niche.gain),
          share,
          niche.name === "rocks" || niche.name === "cliff"
            ? placeRock(niche, species)
            : placeUpright(niche, species, sectionIndex === 0 && niche.recordTrunks),
          `${niche.name}-${species.name}-${String(sectionIndex)}`,
        );
        if (!niche.castShadows) mesh.castShadow = false;
        meshes.push(mesh);
      });
    });
  };

  const meshes: InstancedMesh[] = [];

  sown({
    castShadows: true, gain: [3.9, 3.4, 2.7], name: "conifer", normalizeTo: undefined,
    points: conifers, recordTrunks: true, sink: 0.06, size: [0.84, 0.42], species: sets.conifers, wind: TREE_WIND,
  });
  sown({
    castShadows: true, gain: [3.9, 3.4, 2.7], name: "broadleaf", normalizeTo: undefined,
    points: broadleaves, recordTrunks: true, sink: 0.06, size: [0.84, 0.42], species: sets.broadleaves, wind: TREE_WIND,
  });
  sown({
    castShadows: false, gain: [3.3, 3.6, 2.8], name: "shrub", normalizeTo: 1.2,
    points: shrubs, recordTrunks: false, sink: 0.08, size: [0.7, 0.55], species: sets.shrubs, wind: LEAF_WIND,
  });
  sown({
    castShadows: false, gain: [3.3, 3.6, 2.8], name: "fern", normalizeTo: 0.85,
    points: ferns, recordTrunks: false, sink: 0.08, size: [0.6, 0.6], species: sets.ferns, wind: LEAF_WIND,
  });
  sown({
    castShadows: false, gain: [3.3, 3.6, 2.8], name: "grass", normalizeTo: 0.55,
    points: grass, recordTrunks: false, sink: 0.1, size: [0.5, 0.55], species: sets.grasses, wind: GRASS_WIND,
  });
  sown({
    castShadows: true, gain: [3.0, 2.9, 2.7], name: "rocks", normalizeTo: 1.2,
    points: boulders, recordTrunks: false, sink: 0.35, size: [0.3, 1.0], species: sets.rocks, wind: STILL,
  });

  return {
    boulderCount: boulders.length,
    fernCount: ferns.length,
    grassCount: grass.length + shrubs.length,
    meshes,
    treeCount: conifers.length + broadleaves.length,
    trunks,
  };
}
