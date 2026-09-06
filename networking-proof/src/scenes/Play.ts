import {
  Atmosphere,
  type ICtx,
  Scene,
  type SceneFrame,
  isMobile,
  isTouchscreenAvailable,
  solarPosition,
} from "@threenative/core";
import { CollisionShape3D, type IPhysicsContext, RigidBody3D } from "@threenative/physics";
import { type PerspectiveCamera, Vector3 } from "three";
import { Player } from "../entities/Player.js";
import { createArena, type IArena } from "../render/arena.js";
import { setupCamera } from "../render/camera.js";
import { createHud } from "../render/hud.js";
import { setupLighting } from "../render/lighting.js";
import { createLoadingScreen } from "../render/loading.js";
import { setupPost } from "../render/postprocessing.js";
import { setupSky } from "../render/sky.js";
import { TouchControls } from "../render/touch-controls.js";
import { createNetworkingGame, type INetworkingConfig } from "../networking.js";
import type { GameState } from "../state.js";

declare const __TN_NETWORKING_CONFIG__: INetworkingConfig;

export type GameCtx = ICtx<GameState, IPhysicsContext>;

export class Play extends Scene<GameState, IPhysicsContext> {
  static override readonly initialState: GameState = {
    playerX: -2,
    score: 0,
    sunAzimuth: 0,
    sunElevation: 0,
    sunTransmittanceRed: 0,
    networkActionAcks: 0,
    networkConnected: false,
    networkError: "",
    networkPeerId: "",
    networkPeerObserved: false,
    networkProtocolErrors: 0,
    networkReconnects: 0,
    networkRemoteDistance: 0,
    networkRetry: 0,
    networkSessionId: "",
    networkStatus: "disabled",
    networkUnmatchedActionAcks: 0,
  };

  #arena: IArena | undefined;
  #floorBody: RigidBody3D | undefined;
  #hud: ReturnType<typeof createHud> | undefined;
  #networking = createNetworkingGame<GameState>(__TN_NETWORKING_CONFIG__);
  #player: Player | undefined;
  #touchControls: TouchControls | undefined;

  override enter(ctx: GameCtx): SceneFrame<GameState, IPhysicsContext> {
    const showTouchControls = isMobile() && isTouchscreenAvailable();
    const useAtmosphere = ctx.renderer.kind === "webgpu" && !showTouchControls;
    const atmosphere = useAtmosphere
      ? new Atmosphere({
          rayleigh: [0.005802, 0.013558, 0.0331],
          mie: [0.00444, 0.00444, 0.00444],
          ozone: [0.00065, 0.001881, 0.000085],
          planetRadius: 6360,
          atmosphereRadius: 6460,
          resolutions: {
            transmittance: { width: 128, height: 32 },
            multiScattering: { width: 16, height: 16 },
            skyView: { width: 128, height: 72 },
          },
        })
      : undefined;
    const solarInput = {
      dayOfYear: 172,
      timeOfDay: 6,
      latitude: 49.28,
      longitude: -123.12,
      utcOffset: -8,
    };
    const sun = { azimuth: 0, elevation: 0 };
    solarPosition(solarInput, sun);
    atmosphere?.setSunDirection(sun);
    if (atmosphere !== undefined) {
      ctx.add(atmosphere);
      // Idempotent with the PRD-242 registry when that contract is present; required by the
      // current renderer seam while this template is also usable on WebGL.
      atmosphere.attachRenderer(ctx.renderer);
    }
    setupSky(ctx.scene, atmosphere);
    const lighting = setupLighting(
      ctx.scene,
      ctx.renderer.raw as Parameters<typeof setupLighting>[1],
      atmosphere,
    );
    // isMobile() arrives as an argument because src/render/ imports no framework package: the
    // platform decision is made here, in portable game code, exactly like createRandom.
    setupPost(ctx.renderer, ctx.scene, ctx.camera, {
      atmosphere,
      godraysLight: lighting.key,
      mobile: isMobile(),
    });
    setupCamera(ctx.camera as PerspectiveCamera);
    const loading = createLoadingScreen(ctx);
    ctx.add(ctx.camera);
    const arena = createArena();
    this.#arena = arena;
    ctx.add(arena.root);
    ctx.entities.add("arena", arena.root);
    ctx.entities.add("network-local-player", arena.localPlayer);
    ctx.entities.add("network-remote-player", arena.remotePlayer);
    this.#floorBody = new RigidBody3D({
      object: arena.floor,
      physics: ctx.physics,
      shape: CollisionShape3D.fromMesh(arena.floor),
      type: "fixed",
    });
    const player = new Player(ctx);
    player.mesh.visible = false;
    this.#player = player;
    ctx.entities.add("player", player);
    this.#networking.enter(ctx.state);
    this.#touchControls = showTouchControls
      ? ctx.entities.add("touch-controls", new TouchControls(ctx.camera as PerspectiveCamera))
      : undefined;
    this.#hud = ctx.entities.add("hud", createHud(ctx.camera as PerspectiveCamera, "ACK", "RETRY"));

    let elapsed = 0;
    let actionHeld = false;
    let retryHeld = false;
    const statePatch: Partial<GameState> = {};
    return (frameCtx, dt) => {
      loading.update();
      const retryPressed = frameCtx.input.raw.keys.has("KeyR") && !retryHeld;
      retryHeld = frameCtx.input.raw.keys.has("KeyR");
      if (retryPressed) this.#networking.retry();
      const touch = this.#touchControls?.update(
        frameCtx.input.raw.pointers,
        frameCtx.viewport.size,
      );
      player.update(
        frameCtx,
        dt,
        touch,
      );
      const move = frameCtx.input.vector("move");
      this.#networking.update(frameCtx.state, {
        actionPressed:
          (frameCtx.input.raw.keys.has("Space") || touch?.jumpPressed === true) && !actionHeld,
        x: move.x + (touch?.move.x ?? 0),
        z: -move.y - (touch?.move.y ?? 0),
      });
      actionHeld = frameCtx.input.raw.keys.has("Space") || touch?.jumpPressed === true;
      elapsed += dt;
      solarInput.timeOfDay = (6 + elapsed * 2) % 24;
      solarPosition(solarInput, sun);
      if (atmosphere !== undefined) {
        atmosphere.setSunDirection(sun);
        lighting.updateSun(atmosphere.getSunDirection());
      }
      const state = frameCtx.state.getState();
      this.#arena?.update(state);
      this.#hud?.update({
        counter: state.networkRetry,
        primary: state.networkActionAcks,
        seconds: elapsed,
        status: state.networkStatus,
      });
      statePatch.playerX = player.mesh.position.x;
      statePatch.sunAzimuth = sun.azimuth;
      statePatch.sunElevation = sun.elevation;
      if (atmosphere !== undefined) {
        // The sun's angle is plain arithmetic and keeps moving with the atmosphere deleted, so a
        // scenario asserting only on it proves nothing. This number cannot be produced without
        // the node, which is what makes the atmosphere playtest able to go red.
        const transmittance = atmosphere.sunTransmittance(atmosphere.getSunDirection());
        if (transmittance instanceof Vector3) statePatch.sunTransmittanceRed = transmittance.x;
      }
      frameCtx.state.set(statePatch);
    };
  }

  override exit(ctx: GameCtx): void {
    this.#networking.exit();
    this.#floorBody?.dispose();
    this.#player?.dispose();
    this.#touchControls?.dispose();
    this.#hud?.dispose();
    this.#arena?.dispose();
    this.#floorBody = undefined;
    this.#player = undefined;
    this.#touchControls = undefined;
    this.#hud = undefined;
    this.#arena = undefined;
    void ctx;
  }
}
