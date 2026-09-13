import {
  attachToBone,
  type ICtx,
  Scene,
  SkeletalMesh3D,
  type SceneFrame,
} from "@threenative/core";
import type { IPhysicsContext } from "@threenative/physics";
import {
  type AnimationClip,
  type Bone,
  Box3,
  BoxGeometry,
  DirectionalLight,
  HemisphereLight,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  type Object3D,
  Vector3,
} from "three";
import { createLoadingScreen } from "../render/loading.js";
import type { GameState } from "../state.js";

export type RigCtx = ICtx<GameState, IPhysicsContext>;

// three sanitises glTF `.` node names on load (`hand.R` -> `handR`); the report names the glTF
// node, so the game resolves the runtime bone once here.
const WEAPON_BONE = "handR";

function bonesOf(root: Object3D): Bone[] {
  const bones: Bone[] = [];
  root.traverse((object) => {
    if ((object as Bone).isBone === true) bones.push(object as Bone);
  });
  return bones;
}

/** The weapon's transform relative to its bone; constant when the attachment does not slide. */
function relativeTransform(bone: Object3D | undefined, weapon: Object3D | undefined): ArrayLike<number> | null {
  if (!bone || !weapon) return null;
  bone.updateWorldMatrix(true, false);
  weapon.updateWorldMatrix(false, false);
  return new Matrix4().multiplyMatrices(bone.matrixWorld.clone().invert(), weapon.matrixWorld).toArray();
}
const LENGTH_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ["handR", "forearmR"],
  ["footL", "shinL"],
  ["head", "chest"],
];

/** Runtime evidence for the retargeted AETHER character, read by the playtest components assertion. */
class RigCharacter {
  readonly root: Object3D;
  readonly #player: SkeletalMesh3D;
  readonly #clipNames: readonly string[];
  readonly #startPose = new Map<string, Vector3>();
  readonly #startLengths = new Map<string, number>();
  #startRelative?: ArrayLike<number>;
  readonly #clipsPlayed = new Set<string>();
  #poseDelta = 0;
  #boneLengthDrift = 0;
  #attachmentDrift = 0;
  #seconds = 0;
  #trackCount = 0;

  constructor(player: SkeletalMesh3D, clipNames: readonly string[], weapon: Object3D) {
    this.#player = player;
    this.root = player.root;
    this.#clipNames = clipNames;
    for (const bone of bonesOf(this.root)) {
      bone.updateWorldMatrix(true, false);
      this.#startPose.set(bone.name, bone.getWorldPosition(new Vector3()));
    }
    for (const [child, parent] of LENGTH_PAIRS) {
      const a = this.root.getObjectByName(child);
      const b = this.root.getObjectByName(parent);
      if (a && b) {
        a.updateWorldMatrix(true, false);
        b.updateWorldMatrix(true, false);
        this.#startLengths.set(
          child,
          a.getWorldPosition(new Vector3()).distanceTo(b.getWorldPosition(new Vector3())),
        );
      }
    }
    this.#startRelative =
      relativeTransform(this.root.getObjectByName(WEAPON_BONE), weapon) ?? undefined;
  }

  update(dt: number): void {
    this.#seconds += dt;
    const current = this.#player.current;
    if (current === undefined) {
      this.#player.play("ual1/Walk_Loop");
    } else if (this.#seconds > 1.2 && current !== "ual2/Sword_Regular_Combo") {
      this.#player.play("ual2/Sword_Regular_Combo");
    }
    this.#player.update(dt);
    const active = this.#player.current ?? "";
    this.#clipsPlayed.add(active);
    this.#trackCount = Math.max(this.#trackCount, this.#player.clip(active).tracks.length);

    for (const [name, start] of this.#startPose) {
      const bone = this.root.getObjectByName(name);
      if (!bone) continue;
      bone.updateWorldMatrix(true, false);
      this.#poseDelta = Math.max(
        this.#poseDelta,
        start.distanceTo(bone.getWorldPosition(new Vector3())),
      );
    }
    for (const [child, parent] of LENGTH_PAIRS) {
      const a = this.root.getObjectByName(child);
      const b = this.root.getObjectByName(parent);
      const start = this.#startLengths.get(child);
      if (!a || !b || start === undefined || start === 0) continue;
      a.updateWorldMatrix(true, false);
      b.updateWorldMatrix(true, false);
      const length = a.getWorldPosition(new Vector3()).distanceTo(b.getWorldPosition(new Vector3()));
      this.#boneLengthDrift = Math.max(this.#boneLengthDrift, Math.abs(length - start) / start);
    }
    const bone = this.root.getObjectByName(WEAPON_BONE);
    const weapon = bone?.children.find((child) => child.name === "rigged-weapon");
    const relative = relativeTransform(bone, weapon);
    if (relative && this.#startRelative) {
      for (let index = 0; index < 16; index += 1) {
        this.#attachmentDrift = Math.max(
          this.#attachmentDrift,
          Math.abs(relative[index]! - this.#startRelative[index]!),
        );
      }
    }
  }

  debug(): Record<string, unknown> {
    const bone = this.root.getObjectByName(WEAPON_BONE);
    const weapon = bone?.children.find((child) => child.name === "rigged-weapon");
    const weaponScale = weapon?.getWorldScale(new Vector3()).length() ?? 0;
    const height = new Box3().setFromObject(this.root).getSize(new Vector3()).y;
    const namespaced = this.#clipNames.filter((name) => /^(ual1|ual2)\//.test(name)).length;
    return {
      attachmentBone: weapon?.parent?.name ?? "",
      attachmentDrift: this.#attachmentDrift,
      boneCount: bonesOf(this.root).length,
      boneLengthDrift: this.#boneLengthDrift,
      characterHeight: height,
      clipsPlayed: this.#clipsPlayed.size,
      legacyClips: this.#clipNames.length - namespaced,
      namespacedClips: namespaced,
      poseDelta: this.#poseDelta,
      trackCount: this.#trackCount,
      weaponScale,
    };
  }
}

export class Rig extends Scene<GameState, IPhysicsContext> {
  static override readonly initialState: GameState = {
    playerX: 0,
    score: 0,
    sunAzimuth: 0,
    sunElevation: 0,
    sunTransmittanceRed: 0,
    rigReady: 0,
    rigBoneCount: 0,
  };

  #loaded?: { scene: Object3D; animations: AnimationClip[] };

  override async load(ctx: RigCtx): Promise<void> {
    this.#loaded = await ctx.assets.model<{ scene: Object3D; animations: AnimationClip[] }>(
      "aether-rigged.glb",
    );
  }

  override enter(ctx: RigCtx): SceneFrame<GameState, IPhysicsContext> {
    const loaded = this.#loaded;
    if (!loaded) throw new Error("Rig scene loaded before its GLB resolved.");
    const loading = createLoadingScreen(ctx);
    ctx.scene.add(new HemisphereLight(0xffffff, 0x333344, 3));
    const key = new DirectionalLight(0xffffff, 2.5);
    key.position.set(6, 12, 10);
    ctx.scene.add(key);
    ctx.add(ctx.camera);

    const player = new SkeletalMesh3D({
      source: loaded.scene,
      clips: loaded.animations,
      requiredClips: ["ual1/Walk_Loop"],
    });
    ctx.add(player.root);
    const weapon = new Mesh(
      new BoxGeometry(0.6, 0.6, 5),
      new MeshStandardMaterial({ color: 0xcc3333, metalness: 0.6, roughness: 0.4 }),
    );
    weapon.name = "rigged-weapon";
    ctx.add(weapon);
    attachToBone(player.root, WEAPON_BONE, weapon);

    const character = new RigCharacter(
      player,
      loaded.animations.map((clip) => clip.name),
      weapon,
    );
    ctx.entities.add("character", character);
    const height = new Box3().setFromObject(player.root).getSize(new Vector3()).y;
    const camera = ctx.camera as { position: Vector3; lookAt: (target: Vector3) => void };
    camera.position.set(height * 0.6, height * 0.5, height * 1.7);
    camera.lookAt(new Vector3(0, height * 0.5, 0));

    const statePatch: Partial<GameState> = {};
    return (_frameCtx, dt) => {
      loading.update();
      character.update(dt);
      statePatch.rigReady = 1;
      statePatch.rigBoneCount = bonesOf(player.root).length;
      ctx.state.set(statePatch);
    };
  }
}
