import { GPUSceneBVH, type ICtx, Scene, type SceneFrame } from "@threenative/core";
import type { IPhysicsContext } from "@threenative/physics";
import {
  BoxGeometry,
  Mesh,
  MeshStandardMaterial,
  type PerspectiveCamera,
  PlaneGeometry,
  Vector3,
} from "three";
import { uniform } from "three/tsl";
import { createCameraRig, setupCamera } from "../render/camera.js";
import { createYardGroundMaterial } from "../render/contact.js";
import { createHud } from "../render/hud.js";
import { setupLighting } from "../render/lighting.js";
import { createLoadingScreen } from "../render/loading.js";
import { palette } from "../render/palette.js";
import { setupPost } from "../render/postprocessing.js";
import { setupSky } from "../render/sky.js";
import { DOOR_Z, START_Z, YARD_HALF_WIDTH, createYard } from "../render/yard.js";
import type { GameState } from "../state.js";

export type GameCtx = ICtx<GameState, IPhysicsContext>;

const RUNNER_SPEED = 4.6;
const BURN_PER_SECOND = 16;
const COOL_PER_SECOND = 30;
/** The sun sits low in the west; a low sun is what makes cover throw usable shadow. */
const SUN = new Vector3(0.5, 0.3, 0.46).normalize();
const SHUTTER_TRAVEL = 5.2;
const SHUTTER_PERIOD = 3.4;
const RAY_ORIGIN = new Vector3();

export class Play extends Scene<GameState, IPhysicsContext> {
  static override readonly initialState: GameState = {
    exposure: 0,
    inShadow: false,
    crossed: 0,
    outcome: "playing",
    bvhTriangles: 0,
    bvhRebuilds: 0,
    cameraDistance: 0,
  };

  override enter(ctx: GameCtx): SceneFrame<GameState, IPhysicsContext> {
    const webgpu = ctx.renderer.kind === "webgpu";
    setupSky(ctx.scene, undefined);
    setupLighting(ctx.scene, ctx.renderer.raw as Parameters<typeof setupLighting>[1], undefined);
    setupPost(ctx.renderer, ctx.scene, ctx.camera, undefined);

    const camera = ctx.camera as PerspectiveCamera;
    setupCamera(camera);
    const rig = createCameraRig();
    const loading = createLoadingScreen(ctx);
    ctx.add(ctx.camera);
    const hud = ctx.entities.add("hud", createHud(camera, "HEAT", "HOME"));

    const yard = createYard();
    ctx.add(yard.group);

    const runner = new Mesh(
      new BoxGeometry(0.66, 1.5, 0.66),
      new MeshStandardMaterial({
        color: palette.player,
        emissive: palette.player,
        emissiveIntensity: 0.3,
        roughness: 0.45,
      }),
    );
    runner.position.set(-1.2, 0.75, START_Z);
    runner.castShadow = true;
    ctx.add(runner);
    ctx.entities.add("runner", {
      mesh: runner,
      debug: () => ({ z: runner.position.z }),
    });

    // The BVH packs world-space triangles and nothing has rendered yet, so flush first or every
    // block packs at its unparented local position and the whole yard reads as lit.
    ctx.scene.updateMatrixWorld(true);
    const sunUniform = uniform(SUN.clone());
    const bvh = webgpu
      ? (ctx.add(
          new GPUSceneBVH(ctx.scene, { include: (object) => object.userData.traceable === true }),
        ) as GPUSceneBVH)
      : undefined;
    if (bvh !== undefined) {
      const ground = new Mesh(
        new PlaneGeometry(YARD_HALF_WIDTH * 2 + 6, 26),
        createYardGroundMaterial(bvh, sunUniform),
      );
      ground.rotation.x = -Math.PI / 2;
      ground.name = "yard-ground";
      ctx.add(ground);
    } else {
      const ground = new Mesh(
        new PlaneGeometry(YARD_HALF_WIDTH * 2 + 6, 26),
        new MeshStandardMaterial({ color: palette.floor, roughness: 0.9 }),
      );
      ground.rotation.x = -Math.PI / 2;
      ctx.add(ground);
    }

    let exposure = 0;
    let outcome = "playing";
    let elapsed = 0;
    let rebuilds = 0;
    let shutterLeg = 0;

    return (frameCtx, dt) => {
      loading.update();
      elapsed += dt;

      // The shutter slides, and cover that moves is cover the snapshot has to be told about. It
      // repacks at each end of its travel rather than every frame: rebuild() is a real CPU SAH
      // build, and paying for one every frame to move one box would be the wrong trade.
      const phase = (elapsed % SHUTTER_PERIOD) / SHUTTER_PERIOD;
      const leg = phase < 0.5 ? 0 : 1;
      yard.shutter.position.x = (leg === 0 ? -1 : 1) * SHUTTER_TRAVEL * 0.5;
      if (leg !== shutterLeg) {
        shutterLeg = leg;
        yard.shutter.updateMatrixWorld(true);
        bvh?.rebuild();
        rebuilds += 1;
      }

      if (outcome === "playing") {
        const move = frameCtx.input.vector("move");
        runner.position.x = Math.max(
          -YARD_HALF_WIDTH,
          Math.min(YARD_HALF_WIDTH, runner.position.x + move.x * RUNNER_SPEED * dt),
        );
        runner.position.z = Math.max(
          DOOR_Z,
          Math.min(START_Z, runner.position.z - move.y * RUNNER_SPEED * dt),
        );
      }

      // The same occlusion question the ground shader answers per fragment, asked once for the
      // runner. One ray, against the same blocks the BVH packed.
      RAY_ORIGIN.set(runner.position.x, 0.2, runner.position.z);
      const hit = frameCtx.raycast({
        origin: RAY_ORIGIN,
        direction: SUN,
        targets: yard.cover,
        far: 60,
      });
      const inShadow = hit !== undefined;

      if (outcome === "playing") {
        exposure = Math.max(
          0,
          Math.min(100, exposure + (inShadow ? -COOL_PER_SECOND : BURN_PER_SECOND) * dt),
        );
        if (exposure >= 100) outcome = "caught";
        else if (runner.position.z <= DOOR_Z + 0.9) outcome = "home";
      }

      rig.update(camera, runner.position, frameCtx.input.axis("zoom"), dt);
      const crossed = START_Z - runner.position.z;
      hud.update({ primary: Math.round(exposure), counter: Math.round(crossed), seconds: elapsed });
      frameCtx.state.set({
        exposure,
        inShadow,
        crossed,
        outcome,
        bvhTriangles: bvh?.triangleCount ?? 0,
        bvhRebuilds: rebuilds,
        cameraDistance: rig.distance,
      });
    };
  }
}
