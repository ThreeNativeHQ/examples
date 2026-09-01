// Generated for you. This is ordinary Three.js — edit or delete it freely.
// ThreeNative does not read this file.
//
// The pond: a small still-water pool on the eastern walk.
//
// The basin itself is terrain (`POND` in terrain.ts — a blend toward a floor below the waterline).
// This file dresses it: the water surface, a ring of the pack's real rocks along the shoreline the
// *drawn* ground actually makes, reeds standing in the shallows, and ferns and nettles on the wet
// margin. The shoreline is found, not assumed: the heightfield's noise moves the waterline in and
// out by a metre or more around the nominal radius, so each rock's spot is bisected between the
// flooded middle and the dry bank at build time.
import { CylinderGeometry, Euler, Group, InstancedMesh, Matrix4, Mesh, Quaternion, Vector2, Vector3 } from "three";
import type { createMaterials } from "./materials.js";
import { createWater, type IWater } from "./water.js";
import { type ITreeSpecies, packSectionMaterial } from "./foliage.js";
import { hash2, POND, surfaceAt } from "./terrain.js";

type Materials = ReturnType<typeof createMaterials>;

/** The rock gain, matching the boulders in foliage.ts — the pack's stone is dark under this sky. */
const ROCK_GAIN = [3.0, 2.9, 2.7] as const;
const STILL_WIND = { speed: 0, stiffness: 1, strength: 0 } as const;

/** One placed rock around the rim. */
interface IRingSpot {
  readonly angle: number;
  /** Distance from the pond centre, in metres, at the waterline. */
  readonly radius: number;
}

/**
 * Find the waterline along one bearing: the radius where the drawn surface crosses a hand's
 * breadth above the water. Bisection between the flooded centre and the dry bank outside.
 */
function shorelineRadius(angle: number): number {
  let low = POND.radius * 0.2;
  let high = POND.radius * 1.9;
  const at = (radius: number): number =>
    surfaceAt(POND.x + Math.cos(angle) * radius, POND.z + Math.sin(angle) * radius);
  // Twelve halvings is a millimetre at this scale; more is a loop nobody watches.
  for (let step = 0; step < 12; step += 1) {
    const mid = (low + high) / 2;
    if (at(mid) < 0.25) low = mid;
    else high = mid;
  }
  return (low + high) / 2;
}

/**
 * Build the pond: water, rock ring, reeds, and the wet-margin plants.
 *
 * Everything is placed on the *drawn* surface (`surfaceAt`), not the analytic height, so nothing
 * floats on its own bank.
 */
export function createPond(
  materials: Materials,
  rocks: readonly ITreeSpecies[],
  ferns: readonly ITreeSpecies[],
  nettles: readonly ITreeSpecies[],
): { readonly group: Group; readonly water: IWater } {
  const group = new Group();
  group.name = "pond";

  const water = createWater(new Vector2(POND.x, POND.z), POND.radius * 1.7);
  group.add(water.mesh);

  // The rock ring. Sixteen stones close enough to read as a tended shore, every one a different
  // pack mesh at its own yaw and a hand's breadth sunk, so none balances on a single vertex.
  const ring: IRingSpot[] = [];
  for (let index = 0; index < 16; index += 1) {
    const angle = (index / 16) * Math.PI * 2 + hash2(index, 1, 211) * 0.22;
    const radius = shorelineRadius(angle) * (0.94 + hash2(index, 2, 223) * 0.16);
    ring.push({ angle, radius });
  }
  ring.forEach((spot, index) => {
    const species = rocks[index % rocks.length];
    if (species === undefined) return;
    const stone = speciesGroup(species);
    const scale = 0.55 + hash2(index, 3, 227) * 0.55;
    stone.scale.setScalar(scale * (1 / species.maxDim));
    stone.position.set(
      POND.x + Math.cos(spot.angle) * spot.radius,
      surfaceAt(POND.x + Math.cos(spot.angle) * spot.radius, POND.z + Math.sin(spot.angle) * spot.radius) - scale * 0.3,
      POND.z + Math.sin(spot.angle) * spot.radius,
    );
    stone.rotation.set(
      (hash2(index, 4, 229) - 0.5) * 0.2,
      hash2(index, 5, 233) * 6.283,
      (hash2(index, 6, 239) - 0.5) * 0.2,
    );
    group.add(stone);
  });

  // Reeds, standing in the shallows just inside the rock ring — the pack has no reed mesh, and a
  // thin cylinder in a flat unlit colour is the one place that reads honestly.
  const reedMatrix = new Matrix4();
  const reedPosition = new Vector3();
  const reedQuat = new Quaternion();
  const reedScale = new Vector3();
  const reedShape = new CylinderGeometry(0.016, 0.04, 1.5, 4);
  const reeds = new InstancedMesh(reedShape, materials.reed, 130);
  for (let index = 0; index < 130; index += 1) {
    const angle = hash2(index, 7, 241) * Math.PI * 2;
    const radius = shorelineRadius(angle) * (0.55 + hash2(index, 8, 251) * 0.38);
    const x = POND.x + Math.cos(angle) * radius;
    const z = POND.z + Math.sin(angle) * radius;
    const height = 0.65 + hash2(index, 9, 257) * 0.6;
    reedPosition.set(x, surfaceAt(x, z) + height * 0.4, z);
    reedQuat.setFromEuler(new Euler((hash2(index, 10, 263) - 0.5) * 0.3, hash2(index, 11, 269) * 6.283, (hash2(index, 12, 271) - 0.5) * 0.3));
    reedScale.set(1, height / 1.5, 1);
    reedMatrix.compose(reedPosition, reedQuat, reedScale);
    reeds.setMatrixAt(index, reedMatrix);
  }
  reeds.instanceMatrix.needsUpdate = true;
  reeds.frustumCulled = false;
  reeds.castShadow = false;
  reeds.name = "pond-reeds";
  group.add(reeds);

  // The wet margin: ferns and nettles on the bank, instanced so twenty-some plants stay cheap.
  dressMargin(group, ferns, 14, 263_001, 0.95);
  dressMargin(group, nettles, 10, 263_013, 0.7);

  return { group, water };
}

/** Sow one species-set around the bank, outside the rock ring, on instanced meshes. */
function dressMargin(
  group: Group,
  species: readonly ITreeSpecies[],
  perSpecies: number,
  seed: number,
  targetMetres: number,
): void {
  species.forEach((sp, variant) => {
    if (sp.sections.length === 0) return;
    const matrix = new Matrix4();
    const position = new Vector3();
    const quat = new Quaternion();
    const scale = new Vector3();
    sp.sections.forEach((section, sectionIndex) => {
      const mesh = new InstancedMesh(
        section.geometry,
        packSectionMaterial(section, { speed: 0.13, stiffness: 1.3, strength: 0.04 }, [3.3, 3.6, 2.8]),
        perSpecies,
      );
      mesh.name = `pond-margin-${sp.name}-${String(sectionIndex)}`;
      for (let index = 0; index < perSpecies; index += 1) {
        const angle = hash2(index + variant * 31, 13, seed) * Math.PI * 2;
        const radius = shorelineRadius(angle) * (1.15 + hash2(index, 14, seed + 1) * 0.55);
        const x = POND.x + Math.cos(angle) * radius;
        const z = POND.z + Math.sin(angle) * radius;
        const size = (0.6 + hash2(index, 15, seed + 2) * 0.6) * (targetMetres / sp.maxDim);
        position.set(x, surfaceAt(x, z) - size * 0.08, z);
        quat.setFromAxisAngle(new Vector3(0, 1, 0), hash2(index, 16, seed + 3) * 6.283);
        scale.set(size, size * (0.9 + hash2(index, 17, seed + 4) * 0.3), size);
        matrix.compose(position, quat, scale);
        mesh.setMatrixAt(index, matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
      mesh.frustumCulled = false;
      mesh.castShadow = false;
      group.add(mesh);
    });
  });
}

/** A species as plain meshes at identity — for the one-off placements a ring wants. */
function speciesGroup(species: ITreeSpecies): Group {
  const group = new Group();
  for (const section of species.sections) {
    const mesh = new Mesh(section.geometry, packSectionMaterial(section, STILL_WIND, ROCK_GAIN));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  return group;
}
