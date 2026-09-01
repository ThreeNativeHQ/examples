import { type ICtx, Scene, type SceneFrame, isMobile } from "@threenative/core";
import type { IPhysicsContext } from "@threenative/physics";
import type { AnimationClip, Group, PerspectiveCamera } from "three";
import { Vector3 } from "three";
import { BridgeClient } from "../office/bridge-client.js";
import { Worker } from "../office/Worker.js";
import { assignDesks, workerStateFor } from "../office/floor.js";
import { requiredClips } from "../office/states.js";
import { setupOfficeLighting } from "../render/lighting.js";
import { type IOffice, createOffice } from "../render/office.js";
import { setupPost } from "../render/postprocessing.js";
import { setupSky } from "../render/sky.js";
import type { GameState } from "../state.js";

export type GameCtx = ICtx<GameState, IPhysicsContext>;

const DESK_COUNT = 16;

export class Office extends Scene<GameState, IPhysicsContext> {
  #rig: Group | undefined;
  #clips: readonly AnimationClip[] = [];

  static override readonly initialState: GameState = {
    arrivals: 0,
    blockedSeen: false,
    bridgeOnline: false,
    departures: 0,
    deskCount: 0,
    focusClip: "",
    focusProject: "",
    focusState: "none",
    officeReady: false,
    paused: false,
    uiReady: false,
    workerCount: 0,
  };

  override async load(ctx: GameCtx): Promise<void> {
    // Two CC0 libraries, one rig: library 1 carries the mannequin and the walk and sitting clips,
    // library 2 the phone call. Both were authored on the same 65-joint skeleton, so the clips
    // merge onto one mixer without retargeting — checked here rather than assumed.
    const [base, extra] = await Promise.all([
      ctx.assets.model<{ scene: Group; animations: AnimationClip[] }>("worker.glb"),
      ctx.assets.model<{ scene: Group; animations: AnimationClip[] }>("worker-clips-2.glb"),
    ]);
    const clips: AnimationClip[] = [];
    const names = new Set<string>();
    for (const clip of [...base.animations, ...extra.animations]) {
      // Both libraries ship an `A_TPose`, and a mixer keyed by name cannot hold two. First file
      // wins, and the drop is reported rather than silently resolved.
      if (names.has(clip.name)) {
        console.info(`TN_HQ_DUPLICATE_CLIP:${clip.name}`);
        continue;
      }
      names.add(clip.name);
      clips.push(clip);
    }
    const missing = requiredClips().filter((clip) => !names.has(clip));
    // Fail closed. A missing clip renders as a mannequin frozen in its bind pose, which looks
    // exactly like a worker that is simply idle — the one failure this office must never fake.
    if (missing.length > 0)
      throw new Error(`worker.glb is missing required clips: ${missing.join(", ")}.`);
    this.#rig = base.scene;
    this.#clips = clips;
    console.info(`TN_HQ_CLIPS_LOADED:${String(clips.length)}`);
  }

  override enter(ctx: GameCtx): SceneFrame<GameState, IPhysicsContext> {
    const rig = this.#rig;
    if (rig === undefined) throw new Error("The office rig did not load.");

    setupSky(ctx.scene);
    const key = setupOfficeLighting(
      ctx.scene,
      ctx.renderer.raw as Parameters<typeof setupOfficeLighting>[1],
    );
    setupPost(ctx.renderer, ctx.scene, ctx.camera, { godraysLight: key, mobile: isMobile() });

    const room: IOffice = createOffice(DESK_COUNT);
    ctx.add(room.root);

    ctx.add(ctx.camera);
    const camera = ctx.camera as PerspectiveCamera;
    // Framing after the reference: eye height, off to one side, looking down the desk rows so the
    // slat wall fills the background and the glass throws the far edge of the floor into light.
    camera.position.set(-14.6, 1.68, 7.4);
    camera.lookAt(new Vector3(-1.2, 1.05, -3.4));

    const bridge = new BridgeClient();
    const workers = new Map<string, Worker>();
    let seating = new Map<string, number>();
    let arrivals = 0;
    let departures = 0;
    let blockedSeen = false;

    ctx.state.set({ deskCount: room.desks.length, officeReady: true });
    ctx.state.flush();

    return (frameCtx, dt) => {
      if (frameCtx.state.getState().paused) return;
      bridge.tick();
      const sessions = bridge.sessions();
      const assignment = assignDesks(sessions, room.desks.length, seating);
      seating = new Map(assignment.desks);

      // Arrivals: a session the floor has not seated before gets a mannequin and a desk.
      for (const session of sessions) {
        const deskIndex = assignment.desks.get(session.id);
        if (deskIndex === undefined) continue;
        const desk = room.desks[deskIndex];
        if (desk === undefined) continue;
        let worker = workers.get(session.id);
        if (worker === undefined) {
          worker = new Worker({ clips: this.#clips, host: session.host, source: rig });
          frameCtx.add(worker.object);
          frameCtx.entities.add(entityId(session.id), worker);
          workers.set(session.id, worker);
          arrivals += 1;
        }
        const state = workerStateFor(session);
        if (state === "blocked") blockedSeen = true;
        worker.setState(state);
        // A standing worker steps back from the chair; a seated one sits in it.
        const anchor = worker.standing ? desk.stand : desk.seat;
        worker.object.position.copy(anchor);
        worker.object.rotation.y = desk.facing;
      }

      // Departures: a worker whose session is gone from the snapshot leaves the floor entirely.
      for (const [id, worker] of workers) {
        if (assignment.desks.has(id)) continue;
        worker.object.removeFromParent();
        worker.dispose();
        frameCtx.entities.remove(entityId(id));
        workers.delete(id);
        seating.delete(id);
        departures += 1;
      }

      for (const worker of workers.values()) worker.update(dt);

      const focus = sessions[0];
      const focusWorker = focus === undefined ? undefined : workers.get(focus.id);
      const next = {
        arrivals,
        blockedSeen,
        bridgeOnline: bridge.connected,
        departures,
        focusClip: focusWorker?.clip ?? "",
        focusProject: focus?.project ?? "",
        focusState: focusWorker?.state ?? ("none" as const),
        workerCount: workers.size,
      };
      const current = frameCtx.state.getState();
      const changed = (Object.keys(next) as (keyof typeof next)[]).some(
        (field) => current[field] !== next[field],
      );
      if (changed) frameCtx.state.set(next);
    };
  }
}

/** Entity ids are how a playtest names a worker, so they must be stable and readable. */
function entityId(sessionId: string): string {
  return `worker-${sessionId.replace(/[^a-zA-Z0-9:-]/g, "")}`;
}
