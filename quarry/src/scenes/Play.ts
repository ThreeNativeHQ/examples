import { type ICtx, loadAll, Scene, type SceneFrame } from "@threenative/core";
import { buildStaticColliders, type IPhysicsContext, type RigidBody3D } from "@threenative/physics";
import { Mesh, MeshStandardMaterial, type Object3D, type PerspectiveCamera } from "three";
import { Player } from "../entities/Player.js";
import { buildQuarry, placeProp, PROPS } from "../render/quarry.js";
import type { GameState } from "../state.js";

type GameCtx = ICtx<GameState, IPhysicsContext>;

export class Play extends Scene<GameState, IPhysicsContext> {
  static override readonly initialState: GameState = {
    ready: false, props: 0, texturedProps: 0, normalMappedProps: 0,
    visited: 0, distance: 0, playerZ: 15, groundGap: 0,
  };
  private props: Object3D[] = [];
  private bodies: readonly RigidBody3D[] = [];
  private player?: Player;

  override async load(ctx: GameCtx): Promise<void> {
    this.props = await loadAll(PROPS, async (spec) => {
      const model = await ctx.assets.model<{ scene: Object3D }>(`models/${spec.name}.glb`);
      return placeProp(model.scene, spec);
    });
  }

  override enter(ctx: GameCtx): SceneFrame<GameState, IPhysicsContext> {
    const ground = buildQuarry(ctx.scene, ctx.renderer.raw as Parameters<typeof buildQuarry>[1]);
    ctx.add(ground);
    let texturedProps = 0;
    let normalMappedProps = 0;
    for (const prop of this.props) {
      let colour = false;
      let normal = false;
      prop.traverse((object) => {
        if (!(object instanceof Mesh)) return;
        for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
          if (!(material instanceof MeshStandardMaterial)) continue;
          colour ||= material.map !== null;
          normal ||= material.normalMap !== null;
        }
      });
      texturedProps += Number(colour);
      normalMappedProps += Number(normal);
      ctx.add(prop);
      ctx.entities.add(prop.name, prop);
    }
    this.bodies = [
      ...buildStaticColliders(ctx, ground),
      ...this.props.flatMap((prop) => buildStaticColliders(ctx, prop)),
    ];
    const player = new Player(ctx);
    this.player = player;
    ctx.entities.add("walker", player);
    const camera = ctx.camera as PerspectiveCamera;
    camera.fov = 68;
    camera.far = 180;
    camera.updateProjectionMatrix();
    player.frameCamera(camera);
    ctx.state.set({ ready: true, props: this.props.length, texturedProps, normalMappedProps });
    console.info(`TN_QUARRY_READY: props=${this.props.length}, textured=${texturedProps}, normals=${normalMappedProps}`);
    const visited = new Set<string>();
    return (frame, dt) => {
      if (frame.input.justPressed("restart")) { void frame.goto("play"); return; }
      player.update(frame, dt);
      player.frameCamera(camera);
      for (const prop of this.props) {
        if (Math.hypot(prop.position.x - player.object.position.x, prop.position.z - player.object.position.z) < 8) visited.add(prop.name);
      }
      frame.state.set({ visited: visited.size, distance: player.distance, playerZ: player.object.position.z, groundGap: player.object.position.y - 0.9 });
    };
  }

  override exit(): void {
    this.player?.dispose();
    for (const body of this.bodies) body.dispose();
  }
}
