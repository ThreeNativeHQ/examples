// Generated-project source. The framework packs the scene into storage nodes; the ray, the
// surface it shades and both colours below are the game's.
import { type GPUSceneBVH, bvhIntersectFirstHit, rayStruct } from "@threenative/core";
import { Fn, positionWorld, select, vec3, wgslFn } from "three/tsl";
import { MeshBasicNodeMaterial, type Node, StructNode } from "three/webgpu";

const traceHit = wgslFn(
  `
    fn beaconGroundHit(
      bvh_index: ptr<storage, array<vec3u>, read>,
      bvh_position: ptr<storage, array<vec3f>, read>,
      bvh: ptr<storage, array<BVHNode>, read>,
      ray: Ray,
    ) -> bool {
      let result = bvhIntersectFirstHit(bvh_index, bvh_position, bvh, ray);
      return result.didHit;
    }
  `,
  [bvhIntersectFirstHit as unknown as Node],
) as unknown as (index: Node, position: Node, nodes: Node, ray: Node) => Node<"bool">;

/**
 * Ground that darkens wherever a ray fired straight up from the surface meets a packed beacon.
 *
 * This is a real GPU query per fragment against the snapshot, not a projected blob texture: move a
 * beacon and call `rebuild()`, and the dark patch moves with it.
 */
export function createContactGroundMaterial(bvh: GPUSceneBVH): MeshBasicNodeMaterial {
  const material = new MeshBasicNodeMaterial({ toneMapped: false });
  const occluded = Fn(() => {
    // Slanted, not straight up. A vertical ray puts the dark patch exactly under the beacon's
    // own footprint, where the beacon hides it — the query runs and looks like it does not. This
    // direction is the game's lighting choice and reads as a shadow cast away from the viewer.
    const ray = new StructNode(rayStruct, {
      origin: positionWorld.add(vec3(0, 0.02, 0)),
      direction: vec3(0.42, 1, 0.3),
    } as never);
    return traceHit(bvh.indices, bvh.positions, bvh.nodes, ray);
  })();
  material.colorNode = select(occluded, vec3(0.012, 0.03, 0.05), vec3(0.16, 0.42, 0.5));
  return material;
}
