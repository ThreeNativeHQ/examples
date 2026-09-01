import { type ICtx, Scene, type SceneFrame, isMobile } from "@threenative/core";
import type { IPhysicsContext } from "@threenative/physics";
import type { AnimationClip, Group, PerspectiveCamera } from "three";
import { Vector3 } from "three";
import { setupOfficeLighting } from "../render/lighting.js";
import { createOffice, type IOffice } from "../render/office.js";
import { setupPost } from "../render/postprocessing.js";
import { setupSky } from "../render/sky.js";
import { Worker } from "../office/Worker.js";
import { type WorkerState, requiredClips } from "../office/states.js";
import type { GameState } from "../state.js";

export type GameCtx = ICtx<GameState, IPhysicsContext>;

const DESK_COUNT = 8;

/** Phase 0's stand-in for the bridge: every worker state, in order, three seconds each. */
const DEMO_CYCLE: readonly WorkerState[] = [
  "arriving",
  "working",
  "thinking",
  "idle",
  "blocked",
  "leaving",
];
const DEMO_SECONDS = 6;

export class Office extends Scene<GameState, IPhysicsContext> {
  #rig: Group | undefined;
  #clips: readonly AnimationClip[] = [];

  static override readonly initialState: GameState = {
    deskCount: 0,
    focusClip: "",
    focusState: "none",
    officeReady: false,
    paused: false,
    uiReady: false,
    workerCount: 0,
  };

  override async load(ctx: GameCtx): Promise<void> {
    // Two CC0 libraries, one rig: library 1 carries the mannequin and the walk and sitting clips,
    // library 2 the phone call. Both were authored on the same 65-joint skeleton, so the clips
    // merge onto one mixer without retargeting — checked at load rather than assumed.
    const [base, extra] = await Promise.all([
      ctx.assets.model<{ scene: Group; animations: AnimationClip[] }>("worker.glb"),
      ctx.assets.model<{ scene: Group; animations: AnimationClip[] }>("worker-clips-2.glb"),
    ]);
    // Both libraries ship an `A_TPose`, and a mixer keyed by name cannot hold two. First file
    // wins, and the drop is reported rather than silently resolved — a clip that quietly became
    // another library's copy of itself is a pose bug nobody would think to look for.
    const clips: AnimationClip[] = [];
    const names = new Set<string>();
    for (const clip of [...base.animations, ...extra.animations]) {
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
    camera.position.set(-11.2, 1.62, 7.1);
    camera.lookAt(new Vector3(-0.6, 1.0, -3.2));

    const desk = room.desks[0];
    if (desk === undefined) throw new Error("The office built no desks.");
    const worker = new Worker({ clips: this.#clips, host: "claude", source: rig });
    worker.object.position.copy(desk.seat);
    worker.object.rotation.y = desk.facing;
    ctx.add(worker.object);
    ctx.entities.add("worker-0", worker);

    ctx.state.set({ deskCount: room.desks.length, officeReady: true, workerCount: 1 });
    ctx.state.flush();

    let elapsed = 0;
    let step = 0;
    // The demo walks itself for anyone watching, and stops walking itself the moment something
    // drives it — a proof that has to out-guess a wall clock is a proof about the clock.
    let driven = false;
    return (frameCtx, dt) => {
      if (frameCtx.state.getState().paused) return;
      if (frameCtx.input.justPressed("cycle")) {
        driven = true;
        step = (step + 1) % DEMO_CYCLE.length;
        worker.setState(DEMO_CYCLE[step] as WorkerState);
      } else if (!driven) {
        elapsed += dt;
        const next = Math.floor(elapsed / DEMO_SECONDS) % DEMO_CYCLE.length;
        if (next !== step) {
          step = next;
          worker.setState(DEMO_CYCLE[step] as WorkerState);
        }
      }
      worker.update(dt);
      const current = frameCtx.state.getState();
      if (current.focusState !== worker.state || current.focusClip !== (worker.clip ?? ""))
        frameCtx.state.set({ focusClip: worker.clip ?? "", focusState: worker.state });
    };
  }
}
