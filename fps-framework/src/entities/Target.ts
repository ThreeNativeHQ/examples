import type { ICtx } from "@threenative/core";
import type { IPhysicsContext } from "@threenative/physics";
import { BoxGeometry, Group, Mesh, PlaneGeometry, type Material, type Vector3Like } from "three";
import { scale } from "../render/scale.js";
import { tagSurface } from "../surfaces.js";
import type { GameState } from "../state.js";

type GameCtx = ICtx<GameState, IPhysicsContext>;

/** A struck plate swings back up this long after it drops. */
const RESET_SECONDS = 1.4;

/** The four surfaces a plate needs; the town palette supplies them. */
export type TargetMaterials = {
  readonly face: Material;
  readonly hit: Material;
  readonly frame: Material;
  readonly steel: Material;
};

export type TargetSpec = {
  readonly position: Vector3Like;
  readonly value: 100 | 150 | 250 | 300;
  readonly width?: number;
  readonly height?: number;
  /** A standing target has a deck stand; false selects a fixed structural mount. */
  readonly standing?: boolean;
  /** Surface supporting a mounted target. Deck mounts are freestanding; walkway mounts meet its rail. */
  readonly mountedTo?: "deck" | "walkway";
  /** Yaw the plate faces, radians. Zero faces +z like the range plates did. */
  readonly yaw?: number;
};

export class Target {
  readonly group = new Group();
  readonly plate: Mesh;
  readonly value: number;
  #up = true;
  #dropY: number;
  #mounted: boolean;
  #faceMaterial: TargetMaterials["face"];
  #hitMaterial: TargetMaterials["hit"];

  constructor(materials: TargetMaterials, spec: TargetSpec) {
    const width = spec.width ?? scale.silhouette.width;
    const height = spec.height ?? scale.silhouette.height;
    this.#mounted = spec.standing === false;
    this.#dropY = -Math.max(height * 0.65, scale.ankleHeight * 8);
    this.value = spec.value;
    this.#faceMaterial = materials.face;
    this.#hitMaterial = materials.hit;
    this.plate = new Mesh(new PlaneGeometry(width, height), materials.face);
    this.plate.name = "target-plate";
    this.plate.castShadow = true;
    this.plate.receiveShadow = false;
    this.plate.userData.target = this;
    // The plate is steel by the palette table; a struck plate is intercepted
    // before surface resolution today, but the tag keeps it honest for decals.
    tagSurface(this.plate, "steel");
    this.plate.position.set(0, 0, 0.03);

    const carrier = new Group();
    const frame = new Mesh(
      new PlaneGeometry(width + 0.1, height + 0.1),
      materials.frame,
    );
    frame.name = "target-frame";
    frame.castShadow = true;
    carrier.add(frame);
    carrier.add(this.plate);
    carrier.name = "target-carrier";
    this.group.add(carrier);
    this.group.position.set(spec.position.x, spec.position.y, spec.position.z);
    if (spec.yaw !== undefined) this.group.rotation.y = spec.yaw;

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
      const mountSurfaceY = spec.mountedTo === "walkway" ? scale.walkwaySurface : 0;
      const plateBottom = spec.position.y - height / 2;
      const supportHeight = Math.max(scale.ankleHeight * 2, plateBottom - mountSurfaceY);
      const supportX = width / 2 - scale.ankleHeight * 1.4;

      // Mounted plates need a real load path. These twin steel uprights run from the declared
      // surface to the frame, so the plate cannot read as a floating five-centimetre tab.
      for (const side of [-1, 1]) {
        const support = new Mesh(
          new BoxGeometry(
            scale.ankleHeight * 3.5,
            supportHeight,
            scale.ankleHeight * 3.5,
          ),
          materials.steel,
        );
        support.name = "target-support";
        support.position.set(
          side * supportX,
          mountSurfaceY + supportHeight / 2 - spec.position.y,
          -scale.ankleHeight * 1.5,
        );
        support.castShadow = true;
        this.group.add(support);
      }

      const brace = new Mesh(
        new BoxGeometry(
          width + scale.ankleHeight * 4,
          scale.ankleHeight * 3,
          scale.ankleHeight * 5,
        ),
        materials.steel,
      );
      brace.name = "target-mount-brace";
      brace.position.set(
        0,
        plateBottom - scale.ankleHeight * 1.5 - spec.position.y,
        -scale.ankleHeight * 1.5,
      );
      brace.castShadow = true;
      this.group.add(brace);

      if (mountSurfaceY === 0) {
        const foot = new Mesh(
          new BoxGeometry(
            width + scale.ankleHeight * 18,
            scale.ankleHeight * 4,
            scale.ankleHeight * 18,
          ),
          materials.steel,
        );
        foot.name = "target-mount-foot";
        foot.position.set(0, scale.ankleHeight * 2 - spec.position.y, -scale.ankleHeight * 1.5);
        foot.receiveShadow = true;
        this.group.add(foot);
      } else {
        // The high mounted plate is tied into the existing walkway rail as well as its short
        // deck-side uprights. The carrier remains separate so strike() still hinges in place.
        const railY =
          scale.walkwaySurface - scale.walkway.thickness / 2 + scale.handrailHeight + 0.05;
        const railBracket = new Mesh(
          new BoxGeometry(width + scale.ankleHeight * 7, scale.ankleHeight * 3, 0.22),
          materials.steel,
        );
        railBracket.name = "target-rail-bracket";
        railBracket.position.set(0, railY - spec.position.y, -0.1);
        railBracket.castShadow = true;
        this.group.add(railBracket);
      }

      const mount = new Mesh(
        new BoxGeometry(
          width + scale.ankleHeight * 6,
          scale.ankleHeight * 2.5,
          scale.ankleHeight * 4,
        ),
        materials.steel,
      );
      mount.name = "target-mount";
      mount.position.set(0, -scale.ankleHeight * 1.25, -scale.ankleHeight * 2);
      mount.castShadow = true;
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

  /** Drops a standing plate below its stand; mounted plates hinge in place. */
  strike(ctx: GameCtx): number {
    if (!this.#up) return 0;
    this.#up = false;
    this.plate.material = this.#hitMaterial;
    const carrier = this.carrier;
    void ctx.tween(carrier.rotation, { x: -Math.PI / 2 }, 0.12);
    if (!this.#mounted) void ctx.tween(carrier.position, { y: this.#dropY }, 0.16);
    ctx.after(RESET_SECONDS, () => {
      if (!this.#mounted) void ctx.tween(carrier.position, { y: 0 }, 0.22);
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
