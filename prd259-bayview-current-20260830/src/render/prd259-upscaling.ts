// PRD-259 throwaway comparison arm. This file is rewritten between isolated builds.
// It is game-owned ordinary Three.js source; no framework API is added by the spike.
import { upscale } from "@pmndrs/upscaler";
import { Object3D, REVISION } from "three";
import { mrt, output, pass, velocity } from "three/tsl";
import { taau } from "three/addons/tsl/display/TAAUNode.js";
import type { GameCtx } from "../scenes/Play.js";

export type Prd259Arm = "control" | "taau" | "pmndrs";

/** Rewritten to `taau` and `pmndrs` by the arm runner before each build. */
export const PRD259_ARM: Prd259Arm = "taau";
export const PRD259_SOURCE_SCALE = 0.44;

type Prd259Ctx = Pick<GameCtx, "camera" | "renderer" | "scene">;

/**
 * Force every arm through the authored scene. The production render projection owns a private
 * mirror, while a normal Three post pass receives the authored scene. One non-rendering hook makes
 * the projection deliberately decline so control and temporal arms cannot accidentally draw
 * different roots. This is spike instrumentation, not product code.
 */
function forceAuthoredScene(ctx: Prd259Ctx): void {
  const blocker = new Object3D();
  blocker.name = "prd259-authored-scene-control";
  blocker.visible = false;
  blocker.onBeforeRender = () => undefined;
  ctx.scene.add(blocker);
}

export function setupPrd259Upscaling(ctx: Prd259Ctx): void {
  forceAuthoredScene(ctx);

  const surface = ctx.renderer.surface();
  console.info(
    `TN_PRD259_ARM:${JSON.stringify({
      arm: PRD259_ARM,
      engineHead: "fbfb3693e2e643ba7954ad8b8ad3f8a772b1afba",
      consumerHead: "b394778f97830dbc9f61ed541cf82443087a86c6",
      threeRevision: REVISION,
      sourceScale: PRD259_SOURCE_SCALE,
      outputBuffer: [surface.drawingBufferWidth, surface.drawingBufferHeight],
      sampleCount: surface.sampleCount,
      rendererKind: ctx.renderer.kind,
    })}`,
  );

  if (PRD259_ARM === "control") return;
  if (ctx.renderer.kind !== "webgpu") {
    throw new Error(`PRD-259 ${PRD259_ARM} requires WebGPU, received ${ctx.renderer.kind}.`);
  }
  if (surface.sampleCount !== 1) {
    throw new Error(`PRD-259 ${PRD259_ARM} requires effective sampleCount=1, received ${surface.sampleCount}.`);
  }

  const scenePass = pass(ctx.scene, ctx.camera);
  scenePass.setResolutionScale(PRD259_SOURCE_SCALE);
  scenePass.setMRT(
    mrt({
      output,
      velocity,
    }),
  );

  const colorNode = scenePass.getTextureNode("output");
  const depthNode = scenePass.getTextureNode("depth");
  const velocityNode = scenePass.getTextureNode("velocity");
  const outputNode =
    PRD259_ARM === "taau"
      ? taau(colorNode, depthNode, velocityNode, ctx.camera)
      : upscale(colorNode, depthNode, velocityNode, ctx.camera, {
          ratio: 1 / PRD259_SOURCE_SCALE,
        });

  ctx.renderer.setOutputNode(outputNode);
}
