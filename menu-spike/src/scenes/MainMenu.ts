import { type ICtx, Scene, type SceneFrame } from "@threenative/core";
import type { IPhysicsContext } from "@threenative/physics";
import { Group, Mesh, type PerspectiveCamera, Vector3 } from "three";
import { createMaterials } from "../render/materials.js";
import { setupLighting } from "../render/lighting.js";
import { setupSky } from "../render/sky.js";
import { ball, block, roundedBox } from "../render/shapes.js";
import type { GameState } from "../state.js";

export type GameCtx = ICtx<GameState, IPhysicsContext>;

/**
 * The title screen as a scene, not a DOM page: the art is the world (sky, key light, the
 * character on a plinth) and the camera slowly orbits it while the React overlay draws the
 * menu on top. Starting the game is an intent that arrives here through game.ts.
 */
export class MainMenu extends Scene<GameState, IPhysicsContext> {
  static override readonly initialState: GameState = {
    characterName: "",
    coyoteJumps: 0,
    entityCount: 0,
    jumps: 0,
    levelX: -99,
    lives: 3,
    odometer: 0,
    paused: false,
    screen: "menu",
    uiReady: false,
    peakRise: 0,
    playerX: -2,
    respawns: 0,
    score: 0,
    status: "playing",
  };

  override enter(ctx: GameCtx): SceneFrame<GameState, IPhysicsContext> {
    ctx.state.set({ screen: "menu" });
    ctx.state.flush();
    setupSky(ctx.scene);
    setupLighting(ctx.scene, ctx.renderer.raw as Parameters<typeof setupLighting>[1]);
    ctx.add(ctx.camera);

    const materials = createMaterials();
    const plinth = new Mesh(roundedBox(1.4, 0.5, 1.4, 0.08), materials.floor);
    plinth.position.y = -0.25;
    plinth.receiveShadow = true;
    const pedestal = block(0.9, 0.9, 0.9, materials.rock);
    pedestal.position.y = 0.45;
    const bust = ball(0.45, materials.player);
    bust.position.y = 1.35;
    const display = new Group();
    display.add(plinth, pedestal, bust);
    ctx.add(display);

    // Slow orbit — framing is a look decision, so the numbers live here in generated source.
    const target = new Vector3(0, 0.9, 0);
    let angle = Math.PI * 0.25;
    return (_frameCtx, dt) => {
      angle += dt * 0.18;
      const radius = 4.2;
      const camera = ctx.camera as PerspectiveCamera;
      camera.position.set(
        target.x + Math.sin(angle) * radius,
        target.y + 1.1,
        target.z + Math.cos(angle) * radius,
      );
      camera.lookAt(target);
    };
  }
}
