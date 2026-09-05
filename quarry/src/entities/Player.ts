import type { ICtx } from "@threenative/core";
import { CharacterBody3D, CollisionShape3D, type IPhysicsContext } from "@threenative/physics";
import { Group, type PerspectiveCamera } from "three";
import type { GameState } from "../state.js";

type GameCtx = ICtx<GameState, IPhysicsContext>;

export class Player {
  readonly object = new Group();
  readonly body: CharacterBody3D;
  private yaw = 0;
  private lastX = 0;
  private lastZ = 15;
  distance = 0;

  constructor(ctx: GameCtx) {
    this.object.name = "walker";
    this.object.position.set(0, 0.95, 15);
    ctx.add(this.object);
    this.body = new CharacterBody3D({
      object: this.object, physics: ctx.physics,
      shape: CollisionShape3D.capsule(0.6, 0.3),
      snapToGround: 0.3, autostep: { maxHeight: 0.3, minWidth: 0.2 },
    });
  }

  update(ctx: GameCtx, dt: number): void {
    this.distance += Math.hypot(
      this.object.position.x - this.lastX,
      this.object.position.z - this.lastZ,
    );
    this.lastX = this.object.position.x;
    this.lastZ = this.object.position.z;
    this.yaw += ((ctx.input.pressed("turnLeft") ? 1 : 0) - (ctx.input.pressed("turnRight") ? 1 : 0)) * dt * 1.3;
    const move = ctx.input.vector("move");
    this.body.velocity.x = (Math.cos(this.yaw) * move.x - Math.sin(this.yaw) * move.y) * 3.4;
    this.body.velocity.z = (-Math.sin(this.yaw) * move.x - Math.cos(this.yaw) * move.y) * 3.4;
    if (this.body.grounded) this.body.velocity.y = ctx.input.justPressed("jump") ? 4.8 : 0;
    this.body.moveAndSlide(dt);
  }

  frameCamera(camera: PerspectiveCamera): void {
    camera.position.copy(this.object.position).add({ x: 0, y: 0.76, z: 0 });
    camera.rotation.set(-0.05, this.yaw, 0, "YXZ");
  }

  dispose(): void { this.body.dispose(); }
}
