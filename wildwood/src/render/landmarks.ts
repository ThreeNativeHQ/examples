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
// `src/world/landmarks.ts` owns where they are and what finding one means. This file owns nothing
// but their shape.
import { CylinderGeometry, Group, IcosahedronGeometry, Mesh, Object3D, Vector3 } from "three";
import type { createMaterials } from "./materials.js";
import { ball, block, spike, tube } from "./shapes.js";
import { hash2, normalAt } from "./terrain.js";

type Materials = ReturnType<typeof createMaterials>;

/**
 * A monolith: one weathered upright stone on a scatter of rubble.
 *
 * This was a `roundedBox` slab with two spheres at its foot, and it read exactly as that — a dark
 * rectangle stuck in the ground. Three things fix it, and all three matter:
 *
 * 1. **Taper and irregularity.** A standing stone is wider at the base, narrower and broken at the
 *    top, and never the same width on two axes. A box is none of those.
 * 2. **Displaced vertices.** Every vertex is pushed along its own normal by seeded noise, then the
 *    geometry is re-normalled, so the faces catch light unevenly the way stone does.
 * 3. **A lean that is not a rotation about one axis.** Tilting a box about Z alone still reads as a
 *    box that fell over; leaning on both X and Z reads as something that settled.
 */
function standingStone(materials: Materials): Group {
  const group = new Group();

  // A tall prism, segmented enough to displace. Six sides, not four: an even-sided stone reads as
  // cut, and a six-sided one reads as split from a larger rock.
  const slab = new CylinderGeometry(0.62, 1.05, 6.8, 6, 7);
  slab.translate(0, 3.4, 0);
  const position = slab.getAttribute("position");
  const vertex = new Vector3();
  for (let index = 0; index < position.count; index += 1) {
    vertex.fromBufferAttribute(position, index);
    const noise = hash2(Math.round(vertex.x * 6), Math.round(vertex.y * 3 + vertex.z * 6), 907);
    const second = hash2(Math.round(vertex.z * 9), Math.round(vertex.y * 7), 911);
    // Push out from the axis, not from the origin — pushing from the origin would fan the top and
    // pinch the base into a spindle.
    const radial = Math.hypot(vertex.x, vertex.z);
    if (radial > 1e-4) {
      const push = 1 + (noise - 0.5) * 0.34 + (second - 0.5) * 0.14;
      vertex.x *= push;
      vertex.z *= push;
    }
    // The top is broken: displace it downward much more than the flanks.
    if (vertex.y > 5.6) vertex.y -= (noise + second) * 0.75;
    position.setXYZ(index, vertex.x, vertex.y, vertex.z);
  }
  position.needsUpdate = true;
  slab.computeVertexNormals();
  const stone = new Mesh(slab, materials.stone);
  stone.rotation.z = 0.1;
  stone.rotation.x = -0.07;
  group.add(stone);

  // Rubble at the foot, half-buried, so the stone emerges from the ground rather than resting on
  // it. Irregular blobs rather than spheres: a sphere at this size is unmistakably a sphere.
  for (let index = 0; index < 11; index += 1) {
    const angle = (index / 11) * Math.PI * 2 + 0.4;
    const radius = 1.3 + hash2(index, 3, 601) * 1.9;
    const size = 0.26 + hash2(index, 5, 607) * 0.5;
    const chunk = new IcosahedronGeometry(size, 1);
    const chunkPosition = chunk.getAttribute("position");
    for (let v = 0; v < chunkPosition.count; v += 1) {
      vertex.fromBufferAttribute(chunkPosition, v);
      // 0.86-1.14, not 0.75-1.25. The wider range spiked individual vertices far enough out that
      // the flat-shaded facets read as black shards rather than as a weathered lump.
      vertex.multiplyScalar(0.86 + hash2(Math.round(vertex.x * 9), Math.round(vertex.z * 9 + v), 613 + index) * 0.28);
      vertex.y *= 0.7;
      chunkPosition.setXYZ(v, vertex.x, vertex.y, vertex.z);
    }
    chunkPosition.needsUpdate = true;
    chunk.computeVertexNormals();
    const rubble = new Mesh(chunk, materials.stone);
    // Sunk to half depth: rubble sitting on the surface looks scattered by hand.
    rubble.position.set(Math.cos(angle) * radius, -size * 0.35, Math.sin(angle) * radius);
    rubble.rotation.set(hash2(index, 6, 617) * 3, hash2(index, 7, 619) * 3, hash2(index, 8, 631) * 3);
    group.add(rubble);
  }
  return group;
}

/** The fallen giant: a felled trunk on two root balls, lying across the gully. */
function fallenGiant(materials: Materials): Group {
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
  return group;
}

/** Still water: a stand of reeds and two flat stones you can stand on at the waterline. */
function stillWater(materials: Materials): Group {
  const group = new Group();
  for (let index = 0; index < 46; index += 1) {
    const reed = new Mesh(new CylinderGeometry(0.015, 0.035, 1.5 + hash2(index, 9, 653) * 1.4, 3), materials.reed);
    const angle = hash2(index, 10, 659) * Math.PI * 2;
    const radius = 1.2 + hash2(index, 11, 661) * 5.4;
    reed.position.set(Math.cos(angle) * radius, 0.9, Math.sin(angle) * radius);
    reed.rotation.z = (hash2(index, 12, 673) - 0.5) * 0.5;
    group.add(reed);
  }
  for (let index = 0; index < 3; index += 1) {
    const flat = block(2.4 - index * 0.4, 0.3, 1.9 - index * 0.3, materials.slick, { radius: 0.14 });
    flat.position.set(-1.4 + index * 1.7, 0.12, 0.7 - index * 1.2);
    flat.rotation.y = hash2(index, 13, 677) * 1.2;
    group.add(flat);
  }
  return group;
}

/** The charcoal ring: a fire circle, still-warm embers, and three sitting stumps. */
function charcoalRing(materials: Materials): Group {
  const group = new Group();
  const burnt = new Mesh(new CylinderGeometry(1.5, 1.5, 0.06, 18), materials.char);
  burnt.position.y = 0.04;
  burnt.receiveShadow = true;
  group.add(burnt);
  for (let index = 0; index < 12; index += 1) {
    const angle = (index / 12) * Math.PI * 2;
    const kerb = ball(0.26 + hash2(index, 14, 683) * 0.14, materials.stone, { segments: 6 });
    kerb.position.set(Math.cos(angle) * 1.55, 0.16, Math.sin(angle) * 1.55);
    group.add(kerb);
  }
  for (let index = 0; index < 5; index += 1) {
    const ember = ball(0.1, materials.ember, { segments: 5 });
    ember.position.set((hash2(index, 15, 691) - 0.5) * 1.3, 0.12, (hash2(index, 16, 701) - 0.5) * 1.3);
    group.add(ember);
  }
  // Three stumps, spaced like seats round a fire. Deliberately not four: an odd number reads as
  // people having sat down, an even one as furniture.
  for (let index = 0; index < 3; index += 1) {
    const angle = (index / 3) * Math.PI * 2 + 0.7;
    const stump = tube(0.42, 0.5, 0.75, materials.deadwood, { segments: 9 });
    stump.position.set(Math.cos(angle) * 2.9, 0.38, Math.sin(angle) * 2.9);
    group.add(stump);
  }
  return group;
}

/** The ridge cairn: seven stacked slabs, each smaller and turned a little from the last. */
function ridgeCairn(materials: Materials): Group {
  const group = new Group();
  let y = 0;
  for (let index = 0; index < 7; index += 1) {
    const width = 1.6 - index * 0.18;
    const height = 0.34 - index * 0.02;
    const slab = block(width, height, width * 0.82, materials.stone, { radius: 0.07 });
    y += height / 2;
    slab.position.y = y;
    slab.rotation.y = index * 0.53;
    slab.position.x = (hash2(index, 17, 709) - 0.5) * 0.16;
    slab.position.z = (hash2(index, 18, 719) - 0.5) * 0.16;
    y += height / 2;
    group.add(slab);
  }
  const cap = spike(0.42, 0.7, materials.stone, { segments: 7 });
  cap.position.y = y + 0.35;
  group.add(cap);
  return group;
}

const BUILDERS: Record<string, (materials: Materials) => Group> = {
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
export function createLandmark(id: string, materials: Materials, x: number, y: number, z: number): Object3D {
  const build = BUILDERS[id];
  if (build === undefined) throw new Error(`No landmark is built for ${JSON.stringify(id)}.`);
  const group = build(materials);
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
