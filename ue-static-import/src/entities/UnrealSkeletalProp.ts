import { AnimationPlayer, type ICtx, reconcileMirroredClips } from "@threenative/core";
import type { IPhysicsContext } from "@threenative/physics";
import { type AnimationClip, Bone, Group, Mesh, type Object3D } from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import type { GameState } from "../state.js";

type GameCtx = ICtx<GameState, IPhysicsContext>;

interface IGltfLike {
  readonly scene: Object3D;
  readonly animations: readonly AnimationClip[];
}

export interface IUnrealSkeletalPropOptions {
  /** The GLB the game plays, converted by the fixed ActorX PSA reader. */
  readonly path: string;
  /** The same mesh converted by the pre-fix reader. Measured, never rendered. */
  readonly controlPath: string;
  readonly position: { readonly x: number; readonly y: number; readonly z: number };
  readonly rotationY?: number;
  readonly clip: string;
}

/**
 * A skeletal mesh imported from Unreal, carrying the one measurement that says whether its
 * animation clips arrived intact.
 *
 * `ctx.assets.model()` repairs a z-mirrored rig on the way past, and that is exactly what makes
 * this defect invisible from inside a game: a broken file and a sound one both animate correctly
 * once the loader has been through them. So the measurement cannot use that path. Both arms are
 * parsed here with a bare `GLTFLoader` and handed to `reconcileMirroredClips`, which returns
 * whether it converted — `true` means that file would have needed repairing.
 *
 * Bone lengths deliberately are not the detector. A mirrored rig folds without stretching, so it
 * keeps healthy parent-to-child distances; `compareBoneLengths` reads it as sound.
 *
 * The rendered wolf still comes through `ctx.assets.model()`, the ordinary way.
 */
export class UnrealSkeletalProp {
  readonly mesh: Group;
  /** Read by the playtest bridge, which reports `current`, `advancedFrames` and stride. */
  readonly animation: AnimationPlayer;
  readonly #clipCount: number;
  readonly #boneCount: number;
  readonly #mirrorFixed: boolean;
  readonly #mirrorOld: boolean;

  private constructor(
    gltf: IGltfLike,
    options: IUnrealSkeletalPropOptions,
    measured: { readonly fixed: boolean; readonly old: boolean },
  ) {
    this.mesh = new Group();
    this.mesh.add(gltf.scene);
    this.mesh.position.set(options.position.x, options.position.y, options.position.z);
    this.mesh.rotation.y = options.rotationY ?? 0;
    this.mesh.updateWorldMatrix(true, true);

    let bones = 0;
    gltf.scene.traverse((child) => {
      if (child instanceof Bone) bones += 1;
      if (child instanceof Mesh) {
        child.castShadow = true;
        child.receiveShadow = true;
        // A skinned mesh's bind-pose bounds do not follow the pose; without this the wolf
        // disappears whenever a clip carries it past the culler's idea of where it is.
        child.frustumCulled = false;
      }
    });
    this.#boneCount = bones;
    this.#clipCount = gltf.animations.length;
    this.#mirrorFixed = measured.fixed;
    this.#mirrorOld = measured.old;

    // The clips are authored in place, so the rig is its own stride root and the convention reads
    // the sweep of a planted foot rather than a body that never moves.
    this.animation = new AnimationPlayer({ clips: [...gltf.animations], root: gltf.scene });
    this.animation.play(options.clip, { mode: "loop" });
  }

  static async load(ctx: GameCtx, options: IUnrealSkeletalPropOptions): Promise<UnrealSkeletalProp> {
    console.info("WOLF_STEP model start");
    const gltf = await ctx.assets.model<IGltfLike>(options.path);
    console.info("WOLF_STEP model ok clips=" + gltf.animations.length);
    const fixed = await mirrorSignature(options.path);
    console.info("WOLF_STEP fixed=" + fixed);
    const old = await mirrorSignature(options.controlPath);
    console.info("WOLF_STEP old=" + old);
    const instance = new UnrealSkeletalProp(gltf, options, { fixed, old });
    console.info("WOLF_STEP constructed");
    return instance;
  }

  attach(ctx: GameCtx): void {
    ctx.add(this.mesh);
  }

  update(dt: number): void {
    this.animation.update(dt);
  }

  debug(): Record<string, unknown> {
    return {
      advancedFrames: this.animation.advancedFrames,
      boneCount: this.#boneCount,
      clipCount: this.#clipCount,
      mirrorSignatureFixed: this.#mirrorFixed,
      mirrorSignatureOld: this.#mirrorOld,
    };
  }

  dispose(): void {
    this.animation.dispose();
    this.mesh.removeFromParent();
  }
}

/**
 * Whether this file's clips are z-mirrored against its own bind pose, read off a parse the
 * framework's loader has not touched.
 */
async function mirrorSignature(path: string): Promise<boolean> {
  const gltf = await new GLTFLoader().loadAsync(path);
  return reconcileMirroredClips(gltf.scene, gltf.animations);
}
