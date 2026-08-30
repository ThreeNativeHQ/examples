import { SoftBody3D, type ICtx, Scene, type SceneFrame } from "@threenative/core";
import {
  CollisionShape3D,
  type IPhysicsContext,
  RigidBody3D,
  softBodyCollision,
} from "@threenative/physics";
import { Mesh, PerspectiveCamera, PlaneGeometry } from "three";
import { createBarrier, createCurtainMaterial, createStage } from "../render/curtain.js";
import type { GameState } from "../state.js";

const BLAST_TICKS = 30;
const BARRIER_NEAR_Z = 0.35;
const WIN_DEFORMATION = 0.35;

function pinnedLeftEdge(geometry: PlaneGeometry): number[] {
  const positions = geometry.getAttribute("position");
  const pinned: number[] = [];
  for (let vertex = 0; vertex < positions.count; vertex += 1)
    if (Math.abs(positions.getX(vertex) + 2) < 1e-6) pinned.push(vertex);
  if (pinned.length === 0) throw new Error("CURTAIN_PINNED_EDGE_MISSING");
  return pinned;
}

function maximumLocalZ(sample: Float32Array): number {
  if (sample.length === 0) throw new Error("CURTAIN_READBACK_EMPTY");
  let maximum = Number.NEGATIVE_INFINITY;
  for (let index = 2; index < sample.length; index += 3) {
    const value = sample[index];
    if (!Number.isFinite(value)) throw new Error(`CURTAIN_READBACK_NONFINITE_${index}`);
    maximum = Math.max(maximum, value as number);
  }
  return maximum;
}

export class Play extends Scene<GameState, IPhysicsContext> {
  static override readonly initialState: GameState = {
    barrierHeld: 0,
    blasts: 0,
    deformation: 0,
    outcome: "playing",
    solverSteps: 0,
  };

  override enter(ctx: ICtx<GameState, IPhysicsContext>): SceneFrame<GameState, IPhysicsContext> {
    createStage(ctx.scene);
    const camera = ctx.camera as PerspectiveCamera;
    camera.position.set(4.8, 2.4, 8.2);
    camera.lookAt(-1, 0.1, 0);
    camera.updateProjectionMatrix();

    const barrierObject = ctx.add(createBarrier());
    const barrier = new RigidBody3D({
      object: barrierObject,
      physics: ctx.physics,
      shape: CollisionShape3D.box(4.8, 3.4, 0.2),
      type: "fixed",
    });
    const geometry = new PlaneGeometry(4, 2.4, 16, 10);
    const curtain = new SoftBody3D(new Mesh(geometry, createCurtainMaterial()), {
      collision: softBodyCollision(barrier),
      damping: 1.8,
      gravity: [0, 0, 0],
      pinned: pinnedLeftEdge(geometry),
      readbackEveryFrames: 2,
      stiffness: 42,
      wind: [0, 0, 0],
    });
    curtain.position.set(-1, -0.35, 0);
    ctx.add(curtain);

    let barrierHeld = 0;
    let blastStart: number | undefined;
    let blasts = 0;
    let deformation = 0;
    let outcome: GameState["outcome"] = "playing";
    return (frameCtx) => {
      if (frameCtx.input.justPressed("blast")) {
        blastStart = curtain.steps;
        curtain.wind.set(3.5, 1.2, 8);
        blasts += 1;
      }
      const sample = curtain.sample;
      const sampleStep = sample === undefined ? undefined : curtain.steps - sample.staleFrames;
      if (sample !== undefined && blastStart !== undefined) {
        const maximumZ = maximumLocalZ(sample.data);
        deformation = Math.max(deformation, Math.abs(maximumZ));
        if (sampleStep !== undefined && sampleStep - blastStart >= BLAST_TICKS) {
          barrierHeld = maximumZ <= BARRIER_NEAR_Z + 0.01 ? 1 : 0;
          outcome = deformation >= WIN_DEFORMATION && barrierHeld === 1 ? "won" : "lost";
        }
      }
      frameCtx.state.set({
        barrierHeld,
        blasts,
        deformation,
        outcome,
        solverSteps: curtain.steps,
      });
      if (outcome !== "playing") frameCtx.state.flush();
    };
  }
}
