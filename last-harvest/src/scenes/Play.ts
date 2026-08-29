import { type ICtx, Scene, type SceneFrame } from "@threenative/core";
import type { IPhysicsContext } from "@threenative/physics";
import {
  BoxGeometry,
  Color,
  Mesh,
  MeshBasicMaterial,
  type PerspectiveCamera,
  PlaneGeometry,
} from "three";
import { FIELD, GrassField } from "../render/grass.js";
import { createHud } from "../render/hud.js";
import type { GameState } from "../state.js";

export type GameCtx = ICtx<GameState, IPhysicsContext>;

/** Blades left standing in range before the field counts as cleared. */
const CUT_TO_WIN = 30_000;
const DRIVE_SPEED = 7;
/** The harvester cannot leave the field; there is nothing to cut out there. */
const DRIVE_LIMIT = FIELD.size / 2 - 10;
const SKY = 0x9fb9d4;
const GROUND = 0x6b5a36;

export class Play extends Scene<GameState, IPhysicsContext> {
  static override readonly initialState: GameState = {
    candidateCount: 0,
    cutTotal: 0,
    standingNow: 0,
    standingSamples: 0,
    cpuCandidateWrites: 0,
    cullDispatches: 0,
    driven: 0,
    indirectBound: 0,
    outcome: "harvesting",
    resetDispatches: 0,
    standing: 0,
    standingDrop: 0,
    standingFloor: 0,
    standingPeak: 0,
  };

  override enter(ctx: GameCtx): SceneFrame<GameState, IPhysicsContext> {
    ctx.scene.background = new Color(SKY);

    const ground = new Mesh(
      new PlaneGeometry(FIELD.size, FIELD.size),
      new MeshBasicMaterial({ color: GROUND, toneMapped: false }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.01;
    ctx.add(ground);

    // One node, one draw, a million candidates behind it.
    const field = ctx.add(new GrassField());

    const harvester = new Mesh(
      new BoxGeometry(3.2, 1.5, 4.4),
      new MeshBasicMaterial({ color: 0xd94f2b, toneMapped: false }),
    );
    harvester.position.y = 0.75;
    ctx.add(harvester);

    ctx.add(ctx.camera);
    const hud = ctx.entities.add("hud", createHud(ctx.camera as PerspectiveCamera, "STANDING"));

    let elapsed = 0;
    let driven = 0;
    let x = 0;
    let z = 0;
    let standingPeak = 0;
    let standingFloor = Number.POSITIVE_INFINITY;
    let outcome = "harvesting";
    let standingSamples = 0;
    let lastStanding = -1;

    return (frameCtx, dt) => {
      elapsed += dt;
      const move = frameCtx.input.vector("move");
      const stepX = move.x * DRIVE_SPEED * dt;
      const stepZ = -move.y * DRIVE_SPEED * dt;
      x = Math.max(-DRIVE_LIMIT, Math.min(DRIVE_LIMIT, x + stepX));
      z = Math.max(-DRIVE_LIMIT, Math.min(DRIVE_LIMIT, z + stepZ));
      driven += Math.hypot(stepX, stepZ);
      harvester.position.set(x, 0.75, z);
      field.moveHarvester(x, z);

      // The win condition is a number the GPU wrote. Nothing on the CPU knows which blades fell.
      const standing = field.standing;
      const cutTotal = field.cutTotal ?? 0;
      if (cutTotal >= CUT_TO_WIN && outcome === "harvesting") outcome = "cleared";
      if (standing !== undefined && standing !== lastStanding) {
        standingSamples += 1;
        lastStanding = standing;
      }
      if (standing !== undefined) {
        standingPeak = Math.max(standingPeak, standing);
        standingFloor = Math.min(standingFloor, standing);
      }

      const camera = frameCtx.camera as PerspectiveCamera;
      // Set back and low, looking along the swathe the harvester has cut rather than down at it:
      // a top-down shot of a mown strip is indistinguishable from a shot of bare ground.
      camera.position.set(x - 14, 6.5, z + 16);
      camera.lookAt(x + 2, 0.6, z - 2);

      hud.update({ primary: cutTotal, seconds: elapsed });
      frameCtx.state.set({
        candidateCount: FIELD.candidates,
        standingNow: standing ?? -1,
        standingSamples,
        cutTotal,
        cpuCandidateWrites: field.cpuCandidateWrites,
        cullDispatches: field.cullDispatches,
        driven,
        indirectBound: field.indirectBound ? 1 : 0,
        outcome,
        resetDispatches: field.resetDispatches,
        standing: standing ?? -1,
        standingDrop: standingFloor === Number.POSITIVE_INFINITY ? 0 : standingPeak - standingFloor,
        standingFloor: standingFloor === Number.POSITIVE_INFINITY ? 0 : standingFloor,
        standingPeak,
      });
    };
  }
}
