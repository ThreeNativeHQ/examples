import { AnimationPlayer, normaliseToMetres } from "@threenative/core";
import type { AnimationClip, Group, Object3D } from "three";
import { BoxGeometry, Group as ThreeGroup, Mesh, MeshBasicMaterial, Vector3 } from "three";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import { hostTint } from "../render/palette.js";
import { tintMannequin } from "./mannequin.js";
import {
  SIT_DOWN,
  SIT_TO_TYPE,
  STAND_UP,
  TYPE_TO_SIT,
  type WorkerState,
  clipForState,
} from "./states.js";

export type WorkerHost = keyof typeof hostTint;

/** Longest a sit or stand may run before the state's own clip takes over regardless. */
const TRANSITION_TIMEOUT_SECONDS = 2.5;

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
  /**
   * The body the game moves. The rig hangs underneath it.
   *
   * Two objects rather than one, because stride sync measures the ground a body covers against the
   * clip driving the feet — and if the thing being moved is also the thing the mixer writes, the
   * measurement reads the clip's own root motion back and the legs run at a speed nothing on
   * screen is travelling at.
   */
  readonly object: Object3D;
  /**
   * The meshes a pointer can actually hit.
   *
   * `ctx.pointer.on` registers one object and tests that object; it does not walk children. Every
   * loaded model is a `Group`, so registering the rig registers something with no geometry — and
   * the `SkinnedMesh` underneath answers no raycast under the BVH-patched raycaster either. An
   * explicit box is both the fix and the kinder hit target.
   */
  readonly picks: readonly Object3D[];
  readonly #player: AnimationPlayer;
  #state: WorkerState = "arriving";
  /** A one-shot sit/stand is playing and must finish before the state's own clip resumes. */
  #transition: WorkerState | undefined;
  /** Seconds the current transition has been running, so a stuck one-shot cannot hold forever. */
  #transitionAge = 0;
  /** Seconds the current clip has been playing, so a measurement can wait for the pose to arrive. */
  #clipAge = 0;
  #stateChanges = 0;

  constructor(options: IWorkerOptions) {
    const body = new ThreeGroup();
    body.name = "worker";
    const rig = cloneSkinned(options.source);
    // A mannequin is authored at whatever height its author liked; an office is a real room and
    // the desks are 0.74 m. Normalising here keeps every asset swap honest about scale.
    normaliseToMetres(rig, { metres: 1.8, axis: "height" });
    tintMannequin(rig, hostTint[options.host]);
    body.add(rig);

    const proxy = new Mesh(
      new BoxGeometry(0.75, 1.8, 0.75),
      // Transparent rather than zero-write: WebGPU rejects a pipeline that writes no colour while
      // its target still has a write mask, and this box must stay visible to the raycaster.
      new MeshBasicMaterial({ depthWrite: false, opacity: 0, transparent: true }),
    );
    proxy.position.y = 0.9;
    proxy.renderOrder = -1;
    proxy.name = "worker-pick-proxy";
    body.add(proxy);

    this.object = body;
    this.picks = [proxy];
    this.#player = new AnimationPlayer({ clips: options.clips, root: rig, strideRoot: body });
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

  /**
   * How far the pelvis sits above the body's own origin, in metres, in the pose running now.
   *
   * A seated clip is authored against the chair its animator had. Placing the body on the floor
   * and trusting the clip leaves the worker hovering above this office's seat with its feet off
   * the carpet and its hands above the keys — one offset, wrong in three visible ways. Measured
   * relative to the body rather than the world so the scene can subtract it without feeding its
   * own correction back in next frame.
   */
  get pelvisRise(): number | undefined {
    const pelvis = this.object.getObjectByName("pelvis");
    if (pelvis === undefined) return undefined;
    pelvis.updateWorldMatrix(true, false);
    return pelvis.matrixWorld.elements[13] - this.object.position.y;
  }

  /**
   * How far the lower foot sits above the body's own origin, in the pose running now.
   *
   * The seat landing above is the right answer for the hips and the wrong one for the feet: the
   * seated Quaternius clips reach 1.3 cm further down than the Mixamo typing take, so hips placed
   * exactly on the seat put both shoes through the carpet. The scene clamps against this.
   */
  get lowestFootRise(): number | undefined {
    let lowest: number | undefined;
    for (const name of ["foot_l", "foot_r"]) {
      const foot = this.object.getObjectByName(name);
      if (foot === undefined) continue;
      foot.updateWorldMatrix(true, false);
      const rise = foot.matrixWorld.elements[13] - this.object.position.y;
      if (lowest === undefined || rise < lowest) lowest = rise;
    }
    return lowest;
  }

  /**
   * World position midway between both hands — where a keyboard belongs.
   *
   * One hand is the wrong answer and looks like a bug in something else. In the typing take the
   * right hand ranges a quarter of a metre either side of the body while the left barely moves,
   * so a board slid to the right hand alone sits well off to one side with the left hand hanging
   * in the air beside it. Their midpoint tracks the body centre to within a few centimetres,
   * which is what "the hands are on the keys" actually means.
   */
  handCentre(target: Vector3): Vector3 | undefined {
    const left = this.object.getObjectByName("hand_l");
    const right = this.object.getObjectByName("hand_r");
    const hands = [left, right].filter((bone) => bone !== undefined);
    if (hands.length === 0) return undefined;
    target.set(0, 0, 0);
    for (const hand of hands) {
      hand.updateWorldMatrix(true, false);
      target.x += hand.matrixWorld.elements[12];
      target.y += hand.matrixWorld.elements[13];
      target.z += hand.matrixWorld.elements[14];
    }
    return target.divideScalar(hands.length);
  }

  /**
   * True when the pose on screen is the one this state means.
   *
   * Not just "no transition running": a crossfade takes a quarter of a second, and anything
   * measured during it reads the pose the worker is leaving. A keyboard placed from that sample
   * ends up under the hands the worker no longer has.
   */
  get settled(): boolean {
    return this.#transition === undefined && this.#clipAge > 0.6;
  }

  /** Seconds the current clip has run, and how many times the state has actually changed. */
  get clipAge(): number {
    return this.#clipAge;
  }

  get stateChanges(): number {
    return this.#stateChanges;
  }

  /** True while a sit or stand one-shot is still running. */
  get transitioning(): boolean {
    return this.#transition !== undefined;
  }

  get standing(): boolean {
    return clipForState(this.#state).standing;
  }

  setState(next: WorkerState): void {
    if (next === this.#state) return;
    this.#stateChanges += 1;
    const wasStanding = clipForState(this.#state).standing;
    const nowStanding = clipForState(next).standing;
    const wasWorking = this.#state === "working";
    const nowWorking = next === "working";
    this.#state = next;
    // Changes that would otherwise pop get a one-shot: a worker snapping from a walk cycle into a
    // chair reads as a teleport even at 60 fps. Between two seated states the Mixamo
    // chair<->keyboard moves keep the worker in its chair; everywhere else the Quaternius
    // stand<->chair moves carry the standing seam.
    const oneShot = wasStanding && !nowStanding
      ? SIT_DOWN
      : !wasStanding && nowStanding
        ? STAND_UP
        : wasWorking && !nowWorking
          ? TYPE_TO_SIT
          : !wasWorking && nowWorking
            ? SIT_TO_TYPE
            : undefined;
    if (oneShot !== undefined) {
      this.#transition = next;
      this.#transitionAge = 0;
      this.#player.play(oneShot, { mode: "once", fade: 0.2 });
      this.#clipAge = 0;
      return;
    }
    this.#player.play(clipForState(next).clip, { fade: 0.25 });
    this.#clipAge = 0;
  }

  update(dt: number): void {
    this.#player.update(dt);
    this.#clipAge += dt;
    if (this.#transition === undefined) return;
    this.#transitionAge += dt;
    // A one-shot that never reports finished holds its last frame forever, and a worker frozen
    // half-way into a chair looks exactly like a worker whose session hung. Time it out.
    if (this.#player.finished || this.#transitionAge > TRANSITION_TIMEOUT_SECONDS) {
      this.#player.play(clipForState(this.#transition).clip, { fade: 0.15 });
      this.#transition = undefined;
      this.#transitionAge = 0;
      this.#clipAge = 0;
    }
  }

  dispose(): void {
    this.#player.dispose();
  }
}
