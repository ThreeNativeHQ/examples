import type { Camera, Object3D } from "three";
import { mrt, output, pass, velocity } from "three/tsl";
import { traa } from "three/addons/tsl/display/TRAANode.js";

/**
 * The one post-processing pass this lab installs, and the reason it needs one.
 *
 * The hair is 65 980 strands drawn as one-pixel ribbons (`strands.ts`), and a one-pixel line with
 * no anti-aliasing is a staircase that crawls as the camera moves. `TRAANode` jitters the
 * projection and reprojects the previous frame through the velocity buffer, so each fibre resolves
 * to its sub-pixel coverage, and the rest of the frame — a portrait of a face — resolves without
 * the shimmer plain MSAA would not have removed anyway. The strands write their own true position
 * into the velocity node's input, so their history survives motion too.
 *
 * **It is the engine's own render-chain seam, not a hand-rolled pass.** The chain owns the stage
 * order, the velocity provisioning and the honest reporting: it prints `TN_RENDER_CHAIN` naming
 * `traa` as applied or refused with a reason, and it refuses rather than silently no-op'ing if
 * there is no velocity. The game supplies the one stage factory and nothing else.
 *
 * **Velocity comes from MRT, on the same pass.** The pass carries a `velocity` output beside its
 * `output`, so there is no second scene render, and the face's own morphs are what reject a pixel's
 * history: a jaw opening moves the geometry, the velocity buffer says so, and the history is thrown
 * rather than smeared. That is the "nothing ghosts when the face animates" requirement.
 *
 * **The MRT is declared here rather than asked for, and the reason is three's own node.** TRAA
 * drives the velocity *output* — it calls `setProjectionMatrix` on it every frame to keep the
 * previous projection in step with its jitter — and the engine's chain, when it provisions velocity
 * itself, hands the stage a *texture* node reading that output instead, which has no such method
 * and fails on the first frame. Declaring the output here and telling the chain the velocity is
 * provisioned (`mrt: true`) gets both: the buffer is written, the engine still owns the
 * previous-matrix bookkeeping, and TRAA gets the node it was written against.
 *
 * **MSAA is off while this is on**, which `threenative.config.ts` states: three's TRAA is built
 * around a one-sample-per-pixel history.
 */
interface IRenderer {
  readonly kind: string;
  createRenderChain?: (options: {
    input?: unknown;
    worldPass?: unknown;
    request?: {
      stages?: readonly string[];
      tier?: "high" | "medium" | "low" | "off" | "auto";
      velocity?: { mrt?: boolean };
    };
    stages?: readonly {
      name: string;
      build: (input: never, context: { velocityNode?: unknown }) => unknown;
    }[];
  }) => {
    applied: { stages: readonly string[]; dropped: readonly { name: string; reason: string }[] };
    dispose(): void;
  };
}

/** The chain this scene installed, so a scene change can take it down with everything else. */
let installed: { dispose(): void } | undefined;

export function installTemporalAA(renderer: IRenderer, scene: Object3D, camera: Camera): void {
  if (renderer.createRenderChain === undefined)
    throw new Error("this renderer exposes no render chain, so the strands cannot be anti-aliased");
  if (renderer.kind !== "webgpu")
    throw new Error(`TRAA needs the WebGPU renderer; this one is '${renderer.kind}'`);
  installed?.dispose();
  // One pass, rendered by the engine's own output pipeline: it owns the scene graph for this stage,
  // so the strands, the skin and the backdrop are all the same input the chain reprojects.
  const worldPass = pass(scene, camera);
  worldPass.setMRT(mrt({ output, velocity }));
  const chain = renderer.createRenderChain({
    input: worldPass.getTextureNode("output"),
    worldPass,
    request: { stages: ["traa"], tier: "high", velocity: { mrt: true } },
    stages: [
      {
        name: "traa",
        // Two nodes, and they are not interchangeable: `traa` *samples* its third argument, and
        // *writes* the one it finds in the builder context. The texture node reads the velocity
        // output this pass declares; three's `velocity` is that output, and it is what the pass's
        // own MRT already writes. The chain is told the velocity is provisioned but is given no
        // pass to wrap the graph with, so the output node is left as three's own.
        build: (input: never) =>
          traa(input, worldPass.getTextureNode("depth"), worldPass.getTextureNode("velocity") as never, camera),
      },
    ],
  });
  const applied = chain.applied;
  if (!applied.stages.includes("traa"))
    throw new Error(
      `TRAA was not installed: ${applied.dropped.map((drop) => `${drop.name} (${drop.reason})`).join(", ")}`,
    );
  installed = chain;
}

/** Take the chain down with the scene, so a `goto` does not leave its history buffer bound. */
export function disposeTemporalAA(): void {
  installed?.dispose();
  installed = undefined;
}
