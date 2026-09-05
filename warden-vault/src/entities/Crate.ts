import type { ICtx } from "@threenative/core";
import { CollisionShape3D, type IPhysicsContext, RigidBody3D } from "@threenative/physics";
import { type Material, Mesh, type Quaternion, Vector3 } from "three";
import { CRATE_SIZE, crateGeometry } from "../render/crateShape.js";
import type { GameState } from "../state.js";

/**
 * The two kinds of body in the vault.
 *
 * `solid` crates occupy the default collision layer, so the warden's capsule scans them and is
 * stopped by them. `phase` crates occupy a layer the warden's mask does not include, so they are
 * simulated against the floor and against each other exactly like the solid ones — they fall,
 * stack and are shoved by a solid crate — while the warden's own sweep never sees them.
 *
 * The distinction is a collision layer, not a sensor: a sensor collider would also stop colliding
 * with the crates around it, and a phase crate that fell through the floor would not read as
 * "walk through me", it would read as broken.
 */
export type CrateKind = "phase" | "solid";

/** Layer 1 is everything solid. Layer 4 is the phase crates, and only they are on it. */
export const SOLID_LAYER = 1;
export const PHASE_LAYER = 4;
/** What the warden scans: everything except the phase layer. */
export const WARDEN_MASK = 0xffff & ~PHASE_LAYER;

export interface ICrateOptions {
  readonly kind?: CrateKind;
  /** Restores a full orientation — the replay check rebuilds crates from captured poses. */
  readonly quaternion?: Quaternion;
  readonly rotationY?: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export class Crate {
  readonly mesh: Mesh;
  readonly body: RigidBody3D;
  readonly kind: CrateKind;
  /** Where it was authored, before the opening drop. */
  readonly spawn: Vector3;
  /** Where the drop left it, filled in once the vault has settled. */
  readonly rest = new Vector3();

  constructor(
    ctx: ICtx<GameState, IPhysicsContext>,
    material: Material | readonly Material[],
    options: ICrateOptions,
  ) {
    this.kind = options.kind ?? "solid";
    this.mesh = new Mesh(crateGeometry(), material as Material | Material[]);
    this.mesh.position.set(options.x, options.y, options.z);
    if (options.quaternion === undefined) this.mesh.rotation.y = options.rotationY ?? 0;
    else this.mesh.quaternion.copy(options.quaternion);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.spawn = this.mesh.position.clone();
    this.rest.copy(this.spawn);
    ctx.add(this.mesh);
    this.body = new RigidBody3D({
      // A box shape, not `fromMesh`: the merged brace planks would become a convex hull a
      // centimetre proud of the crate on every face, and a stack of those never sits flush.
      collisionLayer: this.kind === "phase" ? PHASE_LAYER : SOLID_LAYER,
      mass: 6,
      object: this.mesh,
      physics: ctx.physics,
      shape: CollisionShape3D.box(CRATE_SIZE, CRATE_SIZE, CRATE_SIZE),
    });
  }

  get speed(): number {
    const velocity = this.body.linearVelocity;
    return Math.hypot(velocity.x, velocity.y, velocity.z);
  }

  /** Metres from where the opening drop left it. Zero until `markRest` has run. */
  displacement(): number {
    return this.mesh.position.distanceTo(this.rest);
  }

  markRest(): void {
    this.rest.copy(this.mesh.position);
  }

  dispose(): void {
    this.body.dispose();
    this.mesh.removeFromParent();
  }
}
