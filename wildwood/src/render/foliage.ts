// Generated for you. This is ordinary Three.js — edit or delete it freely.
// ThreeNative does not read this file.
//
// What grows on the valley floor: trees, ferns, and grass, all instanced, all moving in the wind.
//
// Three decisions worth knowing before you change anything here.
//
// **One instanced mesh per species, geometry merged.** A tree is trunk *and* canopy in a single
// geometry with vertex colours choosing bark or leaf, so 1,200 trees are one draw call instead of
// 2,400 objects. The colour is in the geometry rather than in two materials because a second
// material would mean a second mesh, which is the thing being avoided.
//
// **The wind is a vertex program, not an animation.** Swaying 1,200 canopies from the CPU means
// rewriting 1,200 matrices every frame; swaying them in TSL costs nothing per frame and scales to
// however many blades of grass you want. Bend is proportional to height above the instance's own
// origin, so trunks stay planted and only the crown moves.
//
// **TSL, not `onBeforeCompile`.** This game runs on `WebGPURenderer`, where GLSL chunk injection
// does nothing at all — silently. If a shader edit here appears to have no effect, that is the
// first thing to check.
import {
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Float32BufferAttribute,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  PlaneGeometry,
  Quaternion,
  RepeatWrapping,
  type Texture,
  Vector3,
} from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { MeshStandardNodeMaterial } from "three/webgpu";
import { attribute, float, instanceIndex, positionLocal, sin, texture, time, uv, vec3 } from "three/tsl";
import { palette } from "./palette.js";
import { WATER_LEVEL, hash2, heightAt, slopeAt } from "./terrain.js";

/** The pack's foliage maps. Bark tiles; the rest are atlases of cut-out plants on black. */
export interface IFoliageMaps {
  readonly bark: Texture;
  readonly barkNormal: Texture;
  readonly frond: Texture;
  readonly plants: Texture;
}

/**
 * One cut-out in an atlas, in UV space.
 *
 * Read off the imported PNGs by eye. `grassgroup_diffuse` is 1024x512 with two rows: a top row of
 * about two dozen small plants and flowers, and a bottom row of nine taller tufts. `farn_diffuse`
 * is 1024x512 holding four fern fronds. Cells are given generously — a card that clips its own
 * frond looks broken, a card with a little black margin looks like nothing at all, because the
 * black is transparent.
 */
interface ICell {
  readonly u0: number;
  readonly v0: number;
  readonly u1: number;
  readonly v1: number;
}

/** Tall tufts, bottom row of the plant atlas. These are the grass the valley is carpeted with. */
const TUFT_CELLS: readonly ICell[] = [
  { u0: 0.155, u1: 0.235, v0: 0.02, v1: 0.5 },
  { u0: 0.235, u1: 0.315, v0: 0.02, v1: 0.5 },
  { u0: 0.315, u1: 0.395, v0: 0.02, v1: 0.46 },
  { u0: 0.395, u1: 0.475, v0: 0.02, v1: 0.44 },
];

/** Small plants and flowers, top row. Sparser, and what puts the reference's yellow in the grass. */
const PLANT_CELLS: readonly ICell[] = [
  { u0: 0.415, u1: 0.462, v0: 0.71, v1: 0.98 }, // yellow flowers
  { u0: 0.462, u1: 0.508, v0: 0.71, v1: 0.98 }, // yellow flowers
  { u0: 0.017, u1: 0.070, v0: 0.71, v1: 0.99 }, // purple thistle
  { u0: 0.508, u1: 0.560, v0: 0.71, v1: 0.98 }, // broadleaf
  { u0: 0.560, u1: 0.612, v0: 0.71, v1: 0.98 }, // broadleaf
];

/** The four fern fronds. */
const FROND_CELLS: readonly ICell[] = [
  { u0: 0.015, u1: 0.300, v0: 0.53, v1: 0.98 },
  { u0: 0.300, u1: 0.680, v0: 0.55, v1: 0.99 },
  { u0: 0.020, u1: 0.360, v0: 0.06, v1: 0.50 },
  { u0: 0.360, u1: 0.760, v0: 0.04, v1: 0.48 },
];

/** Where a plant may live, and how thickly. All distances in metres. */
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
    const y = heightAt(x, z);
    if (y < WATER_LEVEL + rule.minHeight) continue;
    if (y > rule.maxHeight) continue;
    if (slopeAt(x, z) > rule.maxSlope) continue;
    points.push({ roll: hash2(ix, iz, rule.seed + 2), x, y, z });
  }
  return points;
}

/**
 * Paint a geometry a single colour, as a vertex attribute, and normalise it for merging.
 *
 * Two things have to be true before `mergeGeometries` will accept a set of parts, and both are
 * silent failures — it returns `null` rather than explaining itself.
 *
 * 1. **Matching attributes.** Every part of a merged plant needs a `color` whether it varies or
 *    not, which is what this function is mostly for.
 * 2. **Matching index-ness.** All parts indexed, or none. `CylinderGeometry` and `ConeGeometry`
 *    are indexed; `IcosahedronGeometry` is not — so a trunk merged with a cone canopy works and
 *    the same trunk merged with a ball canopy returns `null`, from one line away. Everything is
 *    forced non-indexed here so the question cannot come up again. The cost is a few hundred
 *    duplicated vertices in a geometry that is then instanced a few hundred times, which is
 *    nothing next to an afternoon spent on a null nobody explained.
 */
function painted(source: BufferGeometry, hex: number, shade = 1): BufferGeometry {
  const geometry = source.index === null ? source : source.toNonIndexed();
  const colour = new Color(hex).multiplyScalar(shade);
  const count = geometry.getAttribute("position").count;
  const colors = new Float32Array(count * 3);
  for (let index = 0; index < count; index += 1) {
    colors[index * 3] = colour.r;
    colors[index * 3 + 1] = colour.g;
    colors[index * 3 + 2] = colour.b;
  }
  geometry.setAttribute("color", new Float32BufferAttribute(colors, 3));
  return geometry;
}

/**
 * Trunk and canopy in one material: the pack's pine bark, tinted by the vertex colour.
 *
 * The trunks are painted white so the bark texture comes through unchanged; the canopy cones are
 * painted with the palette's greens, so the same texture reads as bark on the trunk and as a
 * darkening grain on the needles. One material, one draw call per species.
 */
function barkMaterial(maps: IFoliageMaps): MeshStandardNodeMaterial {
  for (const map of [maps.bark, maps.barkNormal]) {
    map.wrapS = RepeatWrapping;
    map.wrapT = RepeatWrapping;
  }
  const material = windMaterial(0.02, 1.7, 0.21);
  // Straight bark, lifted for this scene's exposure. No vertex tint and no bias: this material is
  // only ever on trunks now.
  //
  // It used to serve the canopy too, and could not. A palette green multiplied by a dark bark map
  // goes black; bias the map toward one so the green survives and the white-painted trunks blow
  // out instead. There is no single curve that flatters both, so there are now two materials and
  // two meshes — two more draw calls, and both surfaces honest.
  material.colorNode = texture(maps.bark, uv()).rgb.mul(vec3(3.9, 3.4, 2.7));
  return material;
}

/**
 * The canopy: flat palette colour, the same wind, no texture at all.
 *
 * A needle mass at this distance is a silhouette and a colour, and a bark grain stretched over a
 * cone only muddies it. The variety comes from the per-tier shades baked into the vertex colours.
 */
function canopyMaterial(): MeshStandardNodeMaterial {
  const material = windMaterial(0.026, 1.6, 0.23);
  material.colorNode = attribute<"vec3">("color", "vec3").mul(float(1.15));
  return material;
}

/**
 * A quad standing on the ground, textured from one atlas cell.
 *
 * `width` and `height` are metres. Segmented vertically so the wind can bend it into a curve
 * rather than shearing it as a rigid parallelogram — a two-triangle blade pivots about its base
 * and reads as a windscreen wiper.
 */
function card(width: number, height: number, cell: ICell): BufferGeometry {
  const geometry = new PlaneGeometry(width, height, 1, 4);
  geometry.translate(0, height / 2, 0);
  const attribute = geometry.getAttribute("uv");
  for (let index = 0; index < attribute.count; index += 1) {
    // PlaneGeometry's own UVs run 0..1 across the quad, so remapping them into the cell is a
    // straight lerp on both axes.
    attribute.setXY(
      index,
      cell.u0 + attribute.getX(index) * (cell.u1 - cell.u0),
      cell.v0 + attribute.getY(index) * (cell.v1 - cell.v0),
    );
  }
  attribute.needsUpdate = true;
  return geometry;
}

/**
 * A crossed cluster of cards, which is how every game has drawn a plant for twenty-five years.
 *
 * Three quads at sixty degrees to each other read as volume from any angle without being volume.
 * Rotating the whole cluster per instance then hides the repetition.
 */
function cluster(width: number, height: number, cells: readonly ICell[], blades = 3): BufferGeometry {
  const parts: BufferGeometry[] = [];
  for (let blade = 0; blade < blades; blade += 1) {
    const cell = cells[blade % cells.length];
    if (cell === undefined) continue;
    const quad = card(width, height, cell);
    quad.applyMatrix4(new Matrix4().makeRotationY((blade / blades) * Math.PI));
    parts.push(painted(quad, 0xffffff));
  }
  const merged = mergeGeometries(parts, false);
  if (merged === null) throw new Error("A foliage cluster failed to merge.");
  return merged;
}

/**
 * A material for cut-out foliage: the atlas, alpha-tested out of its own black background.
 *
 * The pack ships opacity as a separate packed mask, and the import wrote the atlases as JPEG,
 * which has no alpha channel at all. Neither matters here, because these cut-outs sit on pure
 * black — so the brightest channel *is* the coverage, and `alphaTest` against it cuts a clean
 * silhouette. Alpha-tested rather than blended on purpose: blended foliage needs back-to-front
 * sorting that instanced geometry cannot do, and unsorted blending on ten thousand blades is a
 * mess of halos. A hard cut costs nothing and sorts itself.
 */
function cutoutMaterial(
  map: Texture,
  strength: number,
  stiffness: number,
  speed: number,
  gain: number,
): MeshStandardNodeMaterial {
  map.wrapS = RepeatWrapping;
  map.wrapT = RepeatWrapping;
  const material = windMaterial(strength, stiffness, speed);
  material.side = DoubleSide;
  // 0.055, not the 0.4-ish a cut-out atlas usually wants.
  //
  // These maps are authored for Unreal's exposure and are *dark*: the mean brightness inside a
  // grass cell is 0.085, and the fern atlas is 0.094. A conventional threshold discards the entire
  // plant and leaves only its few specular pixels — which renders as a faint dusting of white
  // specks on the ground and reads as a particle bug, not as a missing threshold. Measure the
  // atlas before choosing this number; do not copy it to a brighter one.
  material.alphaTest = 0.055;
  const sample = texture(map, uv());
  material.colorNode = sample.rgb.mul(float(gain));
  material.shadowSide = DoubleSide;
  material.opacityNode = sample.r.max(sample.g).max(sample.b);
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
function windMaterial(strength: number, stiffness: number, speed: number): MeshStandardNodeMaterial {
  const material = new MeshStandardNodeMaterial({ metalness: 0, roughness: 0.9 });
  // A cheap decorrelating hash: sin of a large irrational multiple of the index.
  const phase = float(instanceIndex).mul(12.9898).sin().mul(43_758.545).fract().mul(6.2831);
  // Two waves, and BOTH are slow. An earlier version ran the primary at 0.8-2.1 rad/s with a
  // second harmonic at 2.31x on top; that is roughly a third of a hertz of full-amplitude sway
  // with a faster flutter riding it, and on screen the whole wood shook like a storm. Real foliage
  // in a light breeze moves at well under a tenth of a hertz — the sway should be something you
  // notice only if you stop and watch a branch. The harmonic is also quieter now (0.18, not 0.28)
  // and further from an integer ratio, so the two never line up into a visible pulse.
  const gust = sin(time.mul(speed).add(phase))
    .mul(0.82)
    .add(sin(time.mul(speed * 1.73).add(phase.mul(1.7))).mul(0.18));
  // `float(0)` and `float(stiffness)`, not `0` and `stiffness`. A bare JS number reaches the
  // generated GLSL as an int literal, and `max(float, int)` has no overload — the shader fails to
  // compile and the whole material silently falls back, which on screen looks like the wind simply
  // not working rather than like an error.
  const lift = positionLocal.y.max(float(0)).pow(float(stiffness));
  const bend = gust.mul(lift).mul(float(strength));
  material.positionNode = vec3(
    positionLocal.x.add(bend),
    // Bending an arc without shortening the radius stretches the plant; taking a little height back
    // in proportion to the square of the bend keeps a swaying trunk the length it started.
    positionLocal.y.sub(bend.mul(bend).mul(float(0.35))),
    positionLocal.z.add(bend.mul(float(0.55))),
  );
  return material;
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

/** A tree, as the two meshes it is drawn with: bark below, flat colour above. */
interface ITreeGeometry {
  readonly trunk: BufferGeometry;
  readonly canopy: BufferGeometry;
}

/**
 * One conifer: a tapered trunk and four stacked cones, origin at the base of the trunk.
 *
 * The trunk is deliberately long and bare before the first tier starts. The reference photograph
 * is mostly *trunk* — dark verticals in the near field with the canopy above the frame — and a
 * tree whose branches start at knee height reads as a bush however good its texture is.
 */
function coniferGeometry(): ITreeGeometry {
  const trunk = new CylinderGeometry(0.15, 0.36, 9.4, 7);
  trunk.translate(0, 4.7, 0);
  // The bark tiles up the trunk rather than stretching once over seven metres.
  const trunkUv = trunk.getAttribute("uv");
  for (let index = 0; index < trunkUv.count; index += 1) {
    trunkUv.setXY(index, trunkUv.getX(index) * 2, trunkUv.getY(index) * 4);
  }

  const tiers = [
    { height: 3.6, radius: 1.75, shade: 0.66, y: 7.6 },
    { height: 3.1, radius: 1.4, shade: 0.88, y: 9.6 },
    { height: 2.6, radius: 1.02, shade: 1.1, y: 11.4 },
    { height: 2.1, radius: 0.62, shade: 1.36, y: 13.0 },
  ];
  const cones: BufferGeometry[] = [];
  for (const tier of tiers) {
    const cone = new ConeGeometry(tier.radius, tier.height, 7);
    cone.translate(0, tier.y, 0);
    cones.push(painted(cone, palette.canopy, tier.shade));
  }
  const canopy = mergeGeometries(cones, false);
  if (canopy === null) throw new Error("The conifer canopy failed to merge.");
  return { canopy, trunk: painted(trunk, 0xffffff) };
}

/** One broadleaf: a leaning trunk under a cluster of three low-poly blobs. */
function broadleafGeometry(): ITreeGeometry {
  const trunk = new CylinderGeometry(0.18, 0.44, 7.0, 7);
  trunk.translate(0, 3.5, 0);
  const trunkUv = trunk.getAttribute("uv");
  for (let index = 0; index < trunkUv.count; index += 1) {
    trunkUv.setXY(index, trunkUv.getX(index) * 2, trunkUv.getY(index) * 3);
  }

  const blobs = [
    { radius: 1.75, shade: 0.98, x: 0, y: 8.2, z: 0 },
    { radius: 1.25, shade: 0.76, x: 1.3, y: 7.4, z: 0.6 },
    { radius: 1.15, shade: 1.2, x: -1.0, y: 7.7, z: -0.8 },
  ];
  const balls: BufferGeometry[] = [];
  for (const blob of blobs) {
    const ball = new IcosahedronGeometry(blob.radius, 1);
    ball.translate(blob.x, blob.y, blob.z);
    balls.push(painted(ball, palette.canopyLight, blob.shade));
  }
  const canopy = mergeGeometries(balls, false);
  if (canopy === null) throw new Error("The broadleaf canopy failed to merge.");
  return { canopy, trunk: painted(trunk, 0xffffff) };
}

export interface IFoliage {
  readonly meshes: readonly InstancedMesh[];
  readonly treeCount: number;
  readonly fernCount: number;
  readonly grassCount: number;
  /** Trunk positions, so gameplay can keep the player from standing inside a tree. */
  readonly trunks: readonly Vector3[];
}

/**
 * Grow the wood.
 *
 * `extent` is half the valley's width; `clearing` is how much space to leave around the spawn.
 * Conifers take the high, steep ground and broadleaves the low flat ground, which is what gives
 * the walk from the lake to the ridge a change of scenery rather than more of the same trees.
 */
export function createFoliage(extent: number, clearing: number, maps: IFoliageMaps): IFoliage {
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
  const ferns = scatter(
    { clearing: clearing * 0.45, count: 2_600, maxHeight: 18, maxSlope: 0.8, minHeight: 0.4, seed: 15_527 },
    extent,
  );
  const grass = scatter(
    { clearing: 0, count: 7_400, maxHeight: 20, maxSlope: 0.95, minHeight: 0.15, seed: 27_449 },
    extent,
  );

  const treeMaterial = barkMaterial(maps);
  const fernMaterial = cutoutMaterial(maps.frond, 0.09, 1.2, 0.34, 4.2);
  const grassMaterial = cutoutMaterial(maps.plants, 0.19, 1.15, 0.46, 5.0);

  const placeUpright =
    (minScale: number, spread: number, record: boolean) =>
    (point: IScatterPoint, _index: number, matrix: Matrix4): void => {
      const size = minScale + point.roll * spread;
      // Trees stand up straight whatever the slope beneath them. A tree rotated onto the surface
      // normal on a 30-degree hillside looks felled, not planted.
      scratch.setFromAxisAngle(up, point.roll * Math.PI * 2);
      // Sink the base a little so a trunk on a rounded vertex never shows daylight underneath.
      position.set(point.x, point.y - 0.2, point.z);
      scale.set(size, size * (0.9 + point.roll * 0.3), size);
      matrix.compose(position, scratch, scale);
      if (record) trunks.push(new Vector3(point.x, point.y, point.z));
    };

  // Grass is split across three meshes, each cut from a different pair of atlas cells. One mesh
  // would mean eleven thousand identical tufts; three is enough that the eye stops finding the
  // repeat, and it costs two extra draw calls.
  const grassThirds = [
    grass.filter((_, index) => index % 3 === 0),
    grass.filter((_, index) => index % 3 === 1),
    grass.filter((_, index) => index % 3 === 2),
  ];

  const conifer = coniferGeometry();
  const broadleaf = broadleafGeometry();
  const canopyMat = canopyMaterial();
  // Trunk and canopy share one placement function, so the two meshes of a tree land on the same
  // transform for the same instance index and stay welded together.
  // Only the trunk pass records a trunk position. Both passes derive the same transform from the
  // same scatter point, so the canopy lands on its trunk; but running the recording closure twice
  // would put every tree in the list twice.
  const meshes = [
    instance(conifer.trunk, treeMaterial, conifers, placeUpright(0.85, 0.65, true), "conifer-trunks"),
    instance(conifer.canopy, canopyMat, conifers, placeUpright(0.85, 0.65, false), "conifer-canopies"),
    instance(broadleaf.trunk, treeMaterial, broadleaves, placeUpright(0.8, 0.55, true), "broadleaf-trunks"),
    instance(broadleaf.canopy, canopyMat, broadleaves, placeUpright(0.8, 0.55, false), "broadleaf-canopies"),
    instance(cluster(1.15, 0.95, FROND_CELLS, 3), fernMaterial, ferns, placeUpright(0.75, 0.7, false), "ferns"),
    instance(cluster(0.62, 0.62, TUFT_CELLS, 3), grassMaterial, grassThirds[0] ?? [], placeUpright(0.8, 0.9, false), "grass-a"),
    instance(cluster(0.55, 0.55, TUFT_CELLS.slice(2), 3), grassMaterial, grassThirds[1] ?? [], placeUpright(0.8, 0.9, false), "grass-b"),
    // The flower cards. Fewer, taller, and the only warm colour on the valley floor.
    instance(cluster(0.42, 0.52, PLANT_CELLS, 2), grassMaterial, grassThirds[2] ?? [], placeUpright(0.7, 0.8, false), "plants"),
  ];
  // Grass and ferns never cast: at this count the shadow pass costs more than the contact shadows
  // are worth, and a 0.5 m blade's shadow is invisible under the canopy shadow it stands in.
  // Undergrowth never casts: at this count the shadow pass costs more than a 0.5 m blade's
  // shadow is worth, and it is standing inside the canopy's own shadow anyway.
  for (const mesh of meshes.slice(4)) mesh.castShadow = false;

  return {
    fernCount: ferns.length,
    grassCount: grass.length,
    meshes,
    treeCount: conifers.length + broadleaves.length,
    trunks,
  };
}
