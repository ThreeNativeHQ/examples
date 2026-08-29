import { type ICtx, Scene, type SceneFrame } from "@threenative/core";
import type { IPhysicsContext } from "@threenative/physics";
import {
  BoxGeometry,
  Color,
  CylinderGeometry,
  Mesh,
  MeshBasicMaterial,
  type PerspectiveCamera,
  Vector3,
} from "three";
import { createHud } from "../render/hud.js";
import { createSpectralOcean, createWaterMesh } from "../render/ocean.js";
import type { GameState } from "../state.js";

export type GameCtx = ICtx<GameState, IPhysicsContext>;

/** How high the raft must be lifted, in metres, to clear the beacon's gate. */
const GATE_HEIGHT = 0.55;
/** How close to the beacon the raft must be for the gate to count. */
const GATE_RADIUS = 7;
const BEACON = new Vector3(19, 0, 0);
const STEER_SPEED = 7;
const TIME_LIMIT = 45;
const SKY = 0x8fb6cc;

export class Play extends Scene<GameState, IPhysicsContext> {
  static override readonly initialState: GameState = {
    frames: 0,
    layerOpaque: 0,
    oceanReleased: 0,
    crestPeak: 0,
    gateCrest: 0,
    gateRange: 0,
    gateTrough: 0,
    gatesCleared: 0,
    heightRange: 0,
    heightSamples: 0,
    oceanSteps: 0,
    outcome: "playing",
    staleFrames: 0,
    steered: 0,
    troughFloor: 0,
  };

  override enter(ctx: GameCtx): SceneFrame<GameState, IPhysicsContext> {
    ctx.scene.background = new Color(SKY);

    // The ocean is a compute-driven node: `ctx.add` hands it the renderer and puts its passes in
    // the warmup set. It draws nothing — the mesh below is this game's, and so is its material.
    const ocean = ctx.add(createSpectralOcean());
    const water = createWaterMesh(ocean);
    ctx.add(water);

    const raft = new Mesh(
      new BoxGeometry(2.4, 0.35, 3.2),
      new MeshBasicMaterial({ color: 0xd8622e, toneMapped: false }),
    );
    ctx.add(raft);
    const mast = new Mesh(
      new BoxGeometry(0.16, 2.2, 0.16),
      new MeshBasicMaterial({ color: 0xf6e7c8, toneMapped: false }),
    );
    mast.position.y = 1.1;
    raft.add(mast);

    // The beacon's gate ring sits at the height the raft has to reach. It is drawn where it is
    // measured, so the capture shows whether a crest actually lifted the raft through it.
    const beacon = new Mesh(
      new CylinderGeometry(0.5, 0.5, 9, 10),
      new MeshBasicMaterial({ color: 0x241a12, toneMapped: false }),
    );
    beacon.position.set(BEACON.x, 4.5, BEACON.z);
    ctx.add(beacon);
    const gate = new Mesh(
      new CylinderGeometry(GATE_RADIUS, GATE_RADIUS, 0.12, 40, 1, true),
      new MeshBasicMaterial({ color: 0xffd166, toneMapped: false, side: 2, transparent: true, opacity: 0.55 }),
    );
    gate.position.set(BEACON.x, GATE_HEIGHT, BEACON.z);
    ctx.add(gate);

    ctx.add(ctx.camera);
    const hud = ctx.entities.add("hud", createHud(ctx.camera as PerspectiveCamera, "RIDES"));

    const position = new Vector3(0, 0, 0);
    let elapsed = 0;
    let crestPeak = 0;
    let troughFloor = 0;
    let steered = 0;
    let gatesCleared = 0;
    let heightSamples = 0;
    let lastStale = -1;
    let outcome = "playing";
    let aboveGate = false;
    let frames = 0;
    let gateCrest = 0;
    let gateTrough = 0;

    return (frameCtx, dt) => {
      elapsed += dt;
      frames += 1;
      ocean.advance(elapsed);

      const move = frameCtx.input.vector("move");
      const stepX = move.x * STEER_SPEED * dt;
      const stepZ = -move.y * STEER_SPEED * dt;
      position.x += stepX;
      position.z += stepZ;
      steered += Math.hypot(stepX, stepZ);

      // The whole game turns on this call. It is the only way the raft learns where the water is,
      // and the water only exists as texels the GPU wrote.
      const surface = ocean.sampleHeight(position.x, position.z);
      if (surface !== undefined) {
        raft.position.set(position.x, surface.height, position.z);
        crestPeak = Math.max(crestPeak, surface.height);
        troughFloor = Math.min(troughFloor, surface.height);
        // Count a landing, not a read: the same bytes read twice are one sample, and a copy that
        // never lands would otherwise look like a stream of fresh ones. A landing shows up as
        // staleness going *down* — never as staleness reaching zero, because the copy resolves
        // between frames and the frame counter has already moved on by the time this reads it.
        if (lastStale >= 0 && surface.staleFrames < lastStale) heightSamples += 1;
        lastStale = surface.staleFrames;

        const withinBeacon = Math.hypot(position.x - BEACON.x, position.z - BEACON.z) < GATE_RADIUS;
        if (withinBeacon) {
          gateCrest = Math.max(gateCrest, surface.height);
          gateTrough = Math.min(gateTrough, surface.height);
        }
        const clearing = withinBeacon && surface.height >= GATE_HEIGHT;
        // Edge-triggered: one ride over the gate is one ride, however many frames it lasts.
        if (clearing && !aboveGate) gatesCleared += 1;
        aboveGate = clearing;
        if (gatesCleared > 0 && outcome === "playing") outcome = "won";
      }

      if (outcome === "playing" && elapsed > TIME_LIMIT) outcome = "adrift";

      // A low chase camera: the wave silhouette between the raft and the beacon is the shot.
      const camera = frameCtx.camera as PerspectiveCamera;
      camera.position.set(position.x - 13, raft.position.y + 4.6, position.z + 13);
      camera.lookAt(raft.position.x + 4, raft.position.y + 0.6, raft.position.z);

      hud.update({ primary: gatesCleared, seconds: elapsed });
      frameCtx.state.set({
        frames,
        layerOpaque: frameCtx.canvasLayer.opaque ? 1 : 0,
        oceanReleased: ocean.released ? 1 : 0,
        crestPeak,
        gateCrest,
        gateRange: gateCrest - gateTrough,
        gateTrough,
        gatesCleared,
        heightRange: crestPeak - troughFloor,
        heightSamples,
        oceanSteps: ocean.steps,
        outcome,
        staleFrames: ocean.staleFrames ?? -1,
        steered,
        troughFloor,
      });
    };
  }
}
