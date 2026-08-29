// Generated-project source. The framework packs the scene into TSL storage nodes; the ray, the
// surface it shades and the two colours are the game's, and so is the decision that a hit means
// shadow.
import { type GPUSceneBVH, bvhIntersectFirstHit, rayStruct } from "@threenative/core";
import { Fn, positionWorld, select, vec3, wgslFn } from "three/tsl";
import { MeshBasicNodeMaterial, type Node, StructNode } from "three/webgpu";

const traceHit = wgslFn(
  `
    fn yardSunHit(
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
 * Ground that is dark wherever a ray fired at the sun meets cover.
 *
 * This is the game's rule, drawn. The dark is not a blob texture and not a shadow map: it is the
 * same occlusion question the CPU asks for the runner, answered per fragment against the same
 * snapshot. Move the shutter, repack, and the safe ground moves with it.
 */
export function createYardGroundMaterial(
  bvh: GPUSceneBVH,
  sunDirection: Node<"vec3">,
): MeshBasicNodeMaterial {
  const material = new MeshBasicNodeMaterial({ toneMapped: false });
  const occluded = Fn(() => {
    const ray = new StructNode(rayStruct, {
      origin: positionWorld.add(vec3(0, 0.03, 0)),
      direction: sunDirection,
    } as never);
    return traceHit(bvh.indices, bvh.positions, bvh.nodes, ray);
  })();
  material.colorNode = select(occluded, vec3(0.028, 0.038, 0.062), vec3(0.30, 0.26, 0.17));
  return material;
}
