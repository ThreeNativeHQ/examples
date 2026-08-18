import type { ICtx } from "@threenative/core";
import type { IPhysicsContext } from "@threenative/physics";
import { BoxGeometry, Group, Mesh, PlaneGeometry, type Vector3Like } from "three";
import type { RangeMaterials } from "../render/materials.js";
import { scale } from "../render/scale.js";
import type { GameState } from "../state.js";

type GameCtx = ICtx<GameState, IPhysicsContext>;

/** A struck plate swings back up this long after it drops. */
const RESET_SECONDS = 1.4;

export type TargetSpec = {
  readonly position: Vector3Like;
  readonly value: 100 | 150 | 250 | 300;
  readonly width?: number;
  readonly height?: number;
  /** Omit the stand when the plate is bolted to a wall or a walkway rail. */
  readonly standing?: boolean;
};

export class Target {
  readonly group = new Group();
  readonly plate: Mesh;
  readonly value: number;
  #up = true;
  #dropY: number;
  #mounted: boolean;
  #faceMaterial: RangeMaterials["targetFace"];
  #hitMaterial: RangeMaterials["targetHit"];

  constructor(materials: RangeMaterials, spec: TargetSpec) {
    const width = spec.width ?? scale.silhouette.width;
    const height = spec.height ?? scale.silhouette.height;
    this.#mounted = spec.standing === false;
    this.#dropY = -Math.max(height * 0.65, scale.ankleHeight * 8);
    this.value = spec.value;
    this.#faceMaterial = materials.targetFace;
    this.#hitMaterial = materials.targetHit;
    this.plate = new Mesh(new PlaneGeometry(width, height), materials.targetFace);
    this.plate.name = "target-plate";
    this.plate.castShadow = true;
    this.plate.receiveShadow = false;
    this.plate.userData.target = this;
    this.plate.position.set(0, 0, 0.03);

    const carrier = new Group();
    const frame = new Mesh(
      new PlaneGeometry(width + 0.1, height + 0.1),
      materials.block,
    );
    frame.name = "target-frame";
    frame.castShadow = true;
    carrier.add(frame);
    carrier.add(this.plate);
    carrier.name = "target-carrier";
    this.group.add(carrier);
    this.group.position.set(spec.position.x, spec.position.y, spec.position.z);

    if (!this.#mounted) {
      // Steel stand: two posts down to the deck plus a cross brace under the plate.
      const legHeight = Math.max(0, spec.position.y - height / 2);
      for (const side of [-1, 1]) {
        const post = new Mesh(
          new BoxGeometry(scale.ankleHeight * 2.5, legHeight, scale.ankleHeight * 2.5),
          materials.steel,
        );
        post.name = "target-post";
        post.position.set((side * width) / 2 - side * 0.04, -height / 2 - legHeight / 2, 0);
        post.castShadow = true;
        this.group.add(post);
      }
      const brace = new Mesh(
        new BoxGeometry(width + scale.ankleHeight * 3, scale.ankleHeight * 2.5, scale.ankleHeight * 2.5),
        materials.steel,
      );
      brace.name = "target-brace";
      brace.position.set(0, -height / 2 - 0.03, 0);
      brace.castShadow = true;
      this.group.add(brace);
      const foot = new Mesh(
        new BoxGeometry(width + scale.ankleHeight * 15, scale.ankleHeight * 3, scale.ankleHeight * 20),
        materials.steel,
      );
      foot.name = "target-foot";
      foot.position.set(0, -spec.position.y + 0.03, 0);
      foot.receiveShadow = true;
      this.group.add(foot);
    } else {
      const mount = new Mesh(
        new BoxGeometry(
          width + scale.ankleHeight * 8,
          scale.ankleHeight * 2.5,
          scale.ankleHeight * 3,
        ),
        materials.steel,
      );
      mount.name = "target-mount";
      mount.position.set(0, 0, -scale.ankleHeight * 2);
      this.group.add(mount);
    }
  }

  get scorable(): boolean {
    return this.#up;
  }

  debug(): { value: number; scorable: boolean; position: number[] } {
    return {
      value: this.value,
      scorable: this.scorable,
      position: this.group.position.toArray(),
    };
  }

  /** The plate the raycast has to hit; `undefined` once it has dropped. */
  get carrier(): Group {
    return this.plate.parent as Group;
  }

  /** Drops the plate below its stand and schedules the swing back up. */
  strike(ctx: GameCtx): number {
    if (!this.#up) return 0;
    this.#up = false;
    this.plate.material = this.#hitMaterial;
    const carrier = this.carrier;
    void ctx.tween(carrier.rotation, { x: -Math.PI / 2 }, 0.12);
    void ctx.tween(carrier.position, { y: this.#dropY }, 0.16);
    ctx.after(RESET_SECONDS, () => {
      void ctx.tween(carrier.position, { y: 0 }, 0.22);
      void ctx.tween(carrier.rotation, { x: 0 }, 0.26);
      this.plate.material = this.#faceMaterial;
      this.#up = true;
    });
    return this.value;
  }

  dispose(): void {
    this.group.removeFromParent();
  }
}
