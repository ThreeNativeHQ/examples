import { AnimationPlayer, normaliseToMetres } from "@threenative/core";
import type { AnimationClip, Group, Material, Object3D } from "three";
import { BoxGeometry, Color, Mesh, MeshBasicMaterial, MeshStandardMaterial } from "three";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import { hostTint } from "../render/palette.js";
import { SIT_DOWN, STAND_UP, type WorkerState, clipForState } from "./states.js";

export type WorkerHost = keyof typeof hostTint;

export interface IWorkerOptions {
  /** The mannequin loaded once by the scene; every worker clones it. */
  readonly source: Group;
  /** Clips from both animation libraries, already merged onto the one shared rig. */
  readonly clips: readonly AnimationClip[];
  readonly host: WorkerHost;
}

/**
 * One agent session, standing in an office.
 *
 * The worker owns its rig and its clip; it does not know what a session is, what a bridge is, or
 * where its desk came from. Everything it is told arrives through {@link setState}, which is the
 * only place a state becomes a pose.
 */
export class Worker {
  readonly object: Object3D;
  /**
   * The meshes a pointer can actually hit.
   *
   * `ctx.pointer.on` registers one object and tests that object; it does not walk children. Every
   * loaded model is a `Group`, so registering `object` registers something with no geometry and
   * the worker silently cannot be clicked. The meshes are collected once, here, where the reason
   * is visible.
   */
  readonly picks: readonly Object3D[];
  readonly #player: AnimationPlayer;
  #state: WorkerState = "arriving";
  /** A one-shot sit/stand is playing and must finish before the state's own clip resumes. */
  #transition: WorkerState | undefined;

  constructor(options: IWorkerOptions) {
    this.object = cloneSkinned(options.source);
    // A mannequin is authored at whatever height its author liked; an office is a real room and
    // the desks are 0.74 m. Normalising here keeps every asset swap honest about scale.
    normaliseToMetres(this.object, { metres: 1.8, axis: "height" });
    tint(this.object, hostTint[options.host]);
    // A plain box the pointer can hit, rather than the skinned body.
    //
    // Two reasons, both learned the hard way. `ctx.pointer.on` tests the object it was given and
    // does not walk children, so the loaded `Group` can never be hit; and the skinned mesh under
    // it does not answer a raycast the way a static mesh does, so registering it hits nothing
    // either. A box is also a kinder target: at office scale a seated figure is forty pixels wide.
    const proxy = new Mesh(
      new BoxGeometry(0.75, 1.8, 0.75),
      new MeshBasicMaterial({ colorWrite: false, depthWrite: false }),
    );
    proxy.position.y = 0.9;
    proxy.renderOrder = -1;
    proxy.name = "worker-pick-proxy";
    this.object.add(proxy);
    this.picks = [proxy];
    this.#player = new AnimationPlayer({ clips: options.clips, root: this.object });
    this.#player.play(clipForState(this.#state).clip);
  }

  get state(): WorkerState {
    return this.#state;
  }

  /** The clip actually running, which is what a playtest asserts against. */
  get clip(): string | undefined {
    return this.#player.current;
  }

  /**
   * The mixer itself, under the name the playtest bridge reads.
   *
   * `ctx.entities` publishes `entity.animation.{current,advancedFrames,finished}` as runtime
   * observations, so exposing the player here is what turns "the worker is typing" into an
   * assertion a scenario can fail on rather than something only a human can see.
   */
  get animation(): AnimationPlayer {
    return this.#player;
  }

  get standing(): boolean {
    return clipForState(this.#state).standing;
  }

  setState(next: WorkerState): void {
    if (next === this.#state) return;
    const wasStanding = clipForState(this.#state).standing;
    const nowStanding = clipForState(next).standing;
    this.#state = next;
    // Sitting down and standing up are the only moves that would otherwise pop: a worker
    // snapping from a walk cycle into a chair reads as a teleport even at 60 fps.
    if (wasStanding && !nowStanding) {
      this.#transition = next;
      this.#player.play(SIT_DOWN, { mode: "once", fade: 0.2 });
      return;
    }
    if (!wasStanding && nowStanding) {
      this.#transition = next;
      this.#player.play(STAND_UP, { mode: "once", fade: 0.2 });
      return;
    }
    this.#player.play(clipForState(next).clip, { fade: 0.25 });
  }

  update(dt: number): void {
    this.#player.update(dt);
    if (this.#transition !== undefined && this.#player.finished) {
      this.#player.play(clipForState(this.#transition).clip, { fade: 0.15 });
      this.#transition = undefined;
    }
  }

  dispose(): void {
    this.#player.dispose();
  }
}

/** Recolour the cloned mannequin without touching the shared source material. */
function tint(root: Object3D, colour: number): void {
  root.traverse((object) => {
    if (!(object instanceof Mesh) || object.name === "worker-pick-proxy") return;
    object.castShadow = true;
    object.receiveShadow = true;
    const materials: Material[] = Array.isArray(object.material) ? object.material : [object.material];
    object.material = materials.map((material) => {
      const copy = material.clone();
      if (copy instanceof MeshStandardMaterial) {
        // The joints material stays dark so the figure still reads as a mannequin rather than
        // as a solid-colour silhouette; only the body carries the host's colour.
        // Body in office charcoal, host colour on the joints: a figure painted entirely in the
        // host's accent reads as a mascot, and the reference floor has people in dark clothes.
        const joints = /joint/i.test(material.name);
        copy.color = joints ? new Color(colour) : new Color(0x39383d);
        copy.roughness = joints ? 0.45 : 0.8;
        copy.metalness = 0;
      }
      return copy;
    });
    if (Array.isArray(object.material) && object.material.length === 1)
      object.material = object.material[0] as Material;
  });
}
