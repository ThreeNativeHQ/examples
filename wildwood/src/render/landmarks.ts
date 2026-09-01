// Generated for you. This is ordinary Three.js — edit or delete it freely.
// ThreeNative does not read this file.
//
// What the five landmarks are made of.
//
// A landmark in a wood has one job before it has any other: be visible from far enough away that
// the player chooses to walk to it. Every one of these is therefore either **tall** (it breaks the
// canopy line), **pale** (it separates from green), or **on a clear patch of ground** (the scatter
// rules in the scene keep trees off it) — and most are all three. A landmark the same height and
// colour as the wood it stands in is a landmark nobody finds.
//
// Every stone on this list is one of the pack's real rock meshes — the monolith is a cliff, the
// cairn is a stack of boulders, the fire ring is sixteen separate stones — normalised to the size
// each landmark needs and placed at its own yaw. Dead wood is a cylinder in the pack's bark, not
// a painted tube.
//
// `src/world/landmarks.ts` owns where they are and what finding one means. This file owns nothing
// but their shape.
import { CylinderGeometry, Group, Mesh, Object3D, Vector3 } from "three";
import { type ITreeSpecies, packSectionMaterial } from "./foliage.js";
import type { createMaterials } from "./materials.js";
import { block, spike, tube } from "./shapes.js";
import { hash2, normalAt } from "./terrain.js";

type Materials = ReturnType<typeof createMaterials>;

/** The stone species the landmarks dress themselves from, loaded with everything else. */
export interface ILandmarkProps {
  /** Big vertical rock faces — the monolith comes from here. */
  readonly cliffs: readonly ITreeSpecies[];
  /** Broken branches, for the debris around the fallen giant. */
  readonly boughs: readonly ITreeSpecies[];
  /** Boulders — the cairn, the fire ring, the shore stones, the rubble. */
  readonly rocks: readonly ITreeSpecies[];
}

const ROCK_GAIN = [3.0, 2.9, 2.7] as const;
const STILL_WIND = { speed: 0, stiffness: 1, strength: 0 } as const;

/**
 * One species as a Group of plain meshes, scaled so its longest side is `target` metres.
 *
 * Landmark stones are one-off placements, not an instanced field, so each is its own small Group
 * sharing a material per section.
 */
function stone(species: ITreeSpecies, target: number): Group {
  const group = new Group();
  for (const section of species.sections) {
    const mesh = new Mesh(section.geometry, packSectionMaterial(section, STILL_WIND, ROCK_GAIN));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  group.scale.setScalar(target / species.maxDim);
  return group;
}

/** A monolith: one weathered cliff mesh stood on end, leaning the way settled stone leans. */
function standingStone(materials: Materials, props: ILandmarkProps): Group {
  const group = new Group();
  const cliff = props.cliffs[0];
  if (cliff === undefined) throw new Error("No cliff species loaded for the standing stone.");
  const slab = stone(cliff, 7.0);
  // The pack's cliff meshes are wall formations: metres wide, a metre or two thick, low. Stood on
  // its long edge (X up) the same mesh is a broken monolith instead of a fallen lintel.
  slab.rotation.x = -Math.PI / 2;
  slab.position.y = 2.2;
  slab.rotation.z = 0.1;
  slab.rotation.y = -0.07;
  group.add(slab);

  // Rubble at the foot, half-buried, so the stone emerges from the ground rather than resting on
  // it. A ring of real small boulders at their own yaws and tilts.
  for (let index = 0; index < 11; index += 1) {
    const species = props.rocks[index % props.rocks.length];
    if (species === undefined) continue;
    const chunk = stone(species, 0.26 + hash2(index, 5, 607) * 0.5);
    const angle = (index / 11) * Math.PI * 2 + 0.4;
    const radius = 1.3 + hash2(index, 3, 601) * 1.9;
    chunk.position.set(Math.cos(angle) * radius, -0.14, Math.sin(angle) * radius);
    chunk.rotation.set(hash2(index, 6, 617) * 0.2, hash2(index, 7, 619) * 6.283, hash2(index, 8, 631) * 0.2);
    group.add(chunk);
  }
  return group;
}

/** The fallen giant: a felled trunk on two root balls, lying across the gully, branch pile beside it. */
function fallenGiant(materials: Materials, props: ILandmarkProps): Group {
  const group = new Group();
  const trunk = new Mesh(new CylinderGeometry(0.95, 1.25, 17, 9), materials.deadwood);
  trunk.rotation.z = Math.PI / 2;
  trunk.rotation.y = 0.34;
  trunk.position.y = 1.35;
  trunk.castShadow = true;
  trunk.receiveShadow = true;
  group.add(trunk);
  // The root plate: the wall of earth and roots a windthrown tree pulls up with it. This is the
  // silhouette that says "fallen" rather than "cut and left".
  const plate = block(0.7, 5.2, 5.2, materials.deadwood, { radius: 0.5 });
  plate.position.set(-8.4, 1.9, 1.5);
  plate.rotation.z = 0.22;
  group.add(plate);
  for (let index = 0; index < 9; index += 1) {
    const root = new Mesh(new CylinderGeometry(0.11, 0.2, 2.2 + hash2(index, 1, 613) * 1.8, 5), materials.deadwood);
    const angle = (index / 9) * Math.PI * 2;
    root.position.set(-8.9, 1.9 + Math.sin(angle) * 1.9, 1.5 + Math.cos(angle) * 1.9);
    root.rotation.z = Math.PI / 2 + (hash2(index, 2, 617) - 0.5) * 0.9;
    root.rotation.y = (hash2(index, 4, 619) - 0.5) * 1.2;
    root.castShadow = true;
    group.add(root);
  }
  // Broken stubs along the trunk, so the eye reads a tree and not a pipe.
  for (let index = 0; index < 6; index += 1) {
    const stub = spike(0.24, 1.3, materials.deadwood, { segments: 6 });
    stub.position.set(-6 + index * 2.4, 2.1, (hash2(index, 6, 631) - 0.5) * 1.6);
    stub.rotation.z = (hash2(index, 7, 641) - 0.5) * 1.4;
    stub.rotation.x = (hash2(index, 8, 643) - 0.5) * 1.4;
    group.add(stub);
  }
  // The crown came off when the tree fell: a pile of the pack's broken branches by the root plate.
  props.boughs.forEach((bough, index) => {
    const pile = stone(bough, 2.4 + hash2(index, 9, 647) * 1.2);
    pile.position.set(-7.2 + hash2(index, 10, 649) * 2.2, 0.5 + hash2(index, 11, 653) * 0.4, 1.5 + (hash2(index, 12, 659) - 0.5) * 3.4);
    pile.rotation.set(hash2(index, 13, 661) * 6.283, hash2(index, 14, 653) * 6.283, hash2(index, 15, 659) * 0.5);
    group.add(pile);
  });
  return group;
}

/** Still water: a stand of reeds and three flat stones you can stand on at the waterline. */
function stillWater(materials: Materials, props: ILandmarkProps): Group {
  const group = new Group();
  for (let index = 0; index < 46; index += 1) {
    const reed = new Mesh(new CylinderGeometry(0.015, 0.035, 1.5 + hash2(index, 9, 653) * 1.4, 3), materials.reed);
    const angle = hash2(index, 10, 659) * Math.PI * 2;
    const radius = 1.2 + hash2(index, 11, 661) * 5.4;
    reed.position.set(Math.cos(angle) * radius, 0.9, Math.sin(angle) * radius);
    reed.rotation.z = (hash2(index, 12, 673) - 0.5) * 0.5;
    group.add(reed);
  }
  // Stepping stones: the pack's rocks squashed on Y, which at this scale reads as flat slabs.
  for (let index = 0; index < 3; index += 1) {
    const species = props.rocks[(index + 2) % props.rocks.length];
    if (species === undefined) continue;
    const flat = stone(species, 2.4 - index * 0.4);
    flat.scale.y *= 0.3;
    flat.position.set(-1.4 + index * 1.7, 0.1, 0.7 - index * 1.2);
    flat.rotation.y = hash2(index, 13, 677) * 1.2;
    group.add(flat);
  }
  return group;
}

/** The charcoal ring: a fire circle of real stones, still-warm embers, and three sitting stumps. */
function charcoalRing(materials: Materials, props: ILandmarkProps): Group {
  const group = new Group();
  const burnt = new Mesh(new CylinderGeometry(1.5, 1.5, 0.06, 18), materials.char);
  burnt.position.y = 0.04;
  burnt.receiveShadow = true;
  group.add(burnt);
  for (let index = 0; index < 12; index += 1) {
    const species = props.rocks[index % props.rocks.length];
    if (species === undefined) continue;
    const angle = (index / 12) * Math.PI * 2;
    const kerb = stone(species, 0.26 + hash2(index, 14, 683) * 0.14);
    kerb.position.set(Math.cos(angle) * 1.55, 0.1, Math.sin(angle) * 1.55);
    kerb.rotation.set(hash2(index, 15, 687) * 0.24, hash2(index, 16, 689) * 6.283, hash2(index, 17, 691) * 0.24);
    group.add(kerb);
  }
  for (let index = 0; index < 5; index += 1) {
    const ember = spike(0.1, 0.1, materials.ember, { segments: 5 });
    ember.position.set((hash2(index, 15, 691) - 0.5) * 1.3, 0.12, (hash2(index, 16, 701) - 0.5) * 1.3);
    group.add(ember);
  }
  // Three stumps, spaced like seats round a fire. Deliberately not four: an odd number reads as
  // people having sat down, an even one as furniture. Dead bark now, not painted tube colour.
  for (let index = 0; index < 3; index += 1) {
    const angle = (index / 3) * Math.PI * 2 + 0.7;
    const stump = tube(0.42, 0.5, 0.75, materials.deadwood, { segments: 9 });
    stump.position.set(Math.cos(angle) * 2.9, 0.38, Math.sin(angle) * 2.9);
    group.add(stump);
  }
  return group;
}

/** The ridge cairn: a stack of the pack's real boulders, each smaller and turned from the last. */
function ridgeCairn(materials: Materials, props: ILandmarkProps): Group {
  const group = new Group();
  let y = 0.1;
  for (let index = 0; index < 7; index += 1) {
    const species = props.rocks[index % props.rocks.length];
    if (species === undefined) continue;
    const target = 1.6 - index * 0.18;
    const slab = stone(species, target);
    // A rock's height is roughly three quarters of its longest side once normalised on Y; stacking
    // on that estimate sinks each stone a little into the one below, which is what a real cairn's
    // courses do.
    y += target * 0.34;
    slab.position.y = y;
    slab.rotation.y = index * 0.53;
    slab.position.x = (hash2(index, 17, 709) - 0.5) * 0.16;
    slab.position.z = (hash2(index, 18, 719) - 0.5) * 0.16;
    group.add(slab);
  }
  const cap = stone(props.rocks[1] ?? props.rocks[0]!, 0.42);
  cap.position.y = y + 0.22;
  group.add(cap);
  return group;
}

const BUILDERS: Record<string, (materials: Materials, props: ILandmarkProps) => Group> = {
  cairn: ridgeCairn,
  camp: charcoalRing,
  log: fallenGiant,
  shore: stillWater,
  stone: standingStone,
};

/**
 * Build one landmark and stand it on the ground.
 *
 * Only the low, flat pieces are tilted onto the surface normal — the standing stone and the cairn
 * stay vertical, because a monolith leaning with the hillside stops reading as placed by anyone.
 */
export function createLandmark(
  id: string,
  materials: Materials,
  props: ILandmarkProps,
  x: number,
  y: number,
  z: number,
): Object3D {
  const build = BUILDERS[id];
  if (build === undefined) throw new Error(`No landmark is built for ${JSON.stringify(id)}.`);
  const group = build(materials, props);
  group.name = `landmark:${id}`;
  group.position.set(x, y, z);
  if (id === "log" || id === "camp" || id === "shore") {
    const normal = normalAt(x, z, new Vector3());
    // Lay it flat on the slope: rotate +Y onto the surface normal, which for a gentle hillside is
    // a couple of degrees and for the gully lip is closer to fifteen.
    group.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), normal);
  }
  group.traverse((object) => {
    if (object instanceof Mesh) {
      object.castShadow = true;
      object.receiveShadow = true;
    }
  });
  return group;
}

/**
 * The trailhead post: a waymarker at the spawn carrying the packaged banner texture.
 *
 * This is where the project's shipped `native-proof.png` and `native-proof.glb` earn their place —
 * on the sign that starts the walk, rather than parked in the scene as a debug object.
 */
export function createTrailhead(materials: Materials, banner: Mesh, y: number): Group {
  const group = new Group();
  group.name = "trailhead";
  const post = tube(0.11, 0.14, 2.6, materials.deadwood, { segments: 8 });
  post.position.y = 1.3;
  group.add(post);
  const arm = block(1.1, 0.12, 0.1, materials.deadwood, { radius: 0.04 });
  arm.position.set(0.5, 2.3, 0);
  group.add(arm);
  // Normalise the packaged proof mesh to a real-world size before hanging it on the post.
  //
  // It is a single triangle authored at whatever scale its exporter felt like, and it arrives here
  // metres across — big enough to fill half the screen with the checker pattern, which reads
  // exactly like a missing-texture error rather than like a signpost. Measure it, then scale it to
  // something a person could actually nail to a piece of wood.
  banner.geometry.computeBoundingBox();
  const box = banner.geometry.boundingBox;
  const span = box === null ? 1 : Math.max(box.max.x - box.min.x, box.max.y - box.min.y, 1e-6);
  banner.scale.setScalar(0.42 / span);
  banner.position.set(0.62, 2.05, 0);
  banner.rotation.y = -0.35;
  group.add(banner);
  const blaze = block(0.26, 0.5, 0.03, materials.ember, { radius: 0.02 });
  blaze.position.set(0, 1.65, 0.14);
  group.add(blaze);
  group.position.set(0, y, 0);
  return group;
}
