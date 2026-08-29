import { Atmosphere, type ICtx, Scene, type SceneFrame, solarPosition } from "@threenative/core";
import type { IPhysicsContext } from "@threenative/physics";
import { BoxGeometry, Mesh, MeshStandardMaterial, type PerspectiveCamera, Vector3 } from "three";
import { createCameraRig, setupCamera } from "../render/camera.js";
import { HALF_DEPTH, HALF_WIDTH, createHall } from "../render/hall.js";
import { createHud } from "../render/hud.js";
import { setupLighting } from "../render/lighting.js";
import { createLoadingScreen } from "../render/loading.js";
import { palette } from "../render/palette.js";
import { setupPost } from "../render/postprocessing.js";
import { Revenant } from "../render/revenant.js";
import { setupSky } from "../render/sky.js";
import type { GameState } from "../state.js";

export type GameCtx = ICtx<GameState, IPhysicsContext>;

const TO_BANISH = 6;
const CAUGHT_RANGE = 1.15;
const WARDEN_SPEED = 4.4;
const SPAWN_EVERY = 0.55;
const PLATE_FACING = new Vector3();
const PLATE_TO_CAMERA = new Vector3();

export class Play extends Scene<GameState, IPhysicsContext> {
  static override readonly initialState: GameState = {
    banished: 0,
    alive: 0,
    nearest: 99,
    outcome: "playing",
    shakePeak: 0,
    spriteAdvances: 0,
    billboardFacingWorst: 0,
  };

  override enter(ctx: GameCtx): SceneFrame<GameState, IPhysicsContext> {
    const webgpu = ctx.renderer.kind === "webgpu";
    const atmosphere = webgpu
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
    // A low night sun keeps the hall dim, which is what makes the revenants' eyes read.
    atmosphere?.setSunDirection(
      solarPosition({
        dayOfYear: 305,
        timeOfDay: 19.4,
        latitude: 49.28,
        longitude: -123.12,
        utcOffset: -8,
      }),
    );
    if (atmosphere !== undefined) {
      ctx.add(atmosphere);
      atmosphere.attachRenderer(ctx.renderer);
    }
    setupSky(ctx.scene, atmosphere);
    setupLighting(ctx.scene, ctx.renderer.raw as Parameters<typeof setupLighting>[1], atmosphere);
    setupPost(ctx.renderer, ctx.scene, ctx.camera, atmosphere);

    const camera = ctx.camera as PerspectiveCamera;
    setupCamera(camera);
    const rig = createCameraRig();
    const loading = createLoadingScreen(ctx);
    ctx.add(ctx.camera);
    const hud = ctx.entities.add("hud", createHud(camera, "SENT", "NEAR"));
    ctx.add(createHall());

    const warden = new Mesh(
      new BoxGeometry(0.62, 1.4, 0.62),
      new MeshStandardMaterial({
        color: palette.player,
        emissive: palette.player,
        emissiveIntensity: 0.35,
        roughness: 0.4,
      }),
    );
    warden.position.set(0, 0.7, 2.6);
    warden.castShadow = true;
    ctx.add(warden);
    ctx.entities.add("warden", { mesh: warden, debug: () => ({ x: warden.position.x }) });

    const revenants: Revenant[] = [];
    let banished = 0;
    let spawned = 0;
    let outcome = "playing";
    let spawnTimer = 0.35;
    let spriteAdvances = 0;
    let lastFrames = new Map<Revenant, number>();
    let facingWorst = 0;
    let facingSamples = 0;

    const spawn = (): void => {
      // Spread along the back wall rather than alternating two corners. Two corners stacks them
      // on top of each other from this camera, and a stack is unclickable: the pointer picks
      // whichever quad is nearest, which is correct behaviour and a miserable game.
      const lane = spawned % 8;
      const revenant = new Revenant(
        camera,
        -5.4 + lane * 1.54,
        -HALF_DEPTH + 1.1 + (lane % 2) * 0.55,
      );
      // Registered by spawn order so a scenario can aim at the revenant itself. The order is
      // deterministic: the two corners alternate and the spawn clock is fixed.
      ctx.entities.add(`revenant-${spawned}`, {
        mesh: revenant.mesh,
        debug: () => ({ banished: revenant.banished }),
      });
      spawned += 1;
      revenants.push(revenant);
      ctx.add(revenant.mesh);
      // PRD-237: the listener is on the revenant's own quad. Nothing in the frame loop asks
      // "is the pointer over a revenant".
      ctx.pointer.on(revenant.mesh, "tapped", () => {
        if (revenant.banished || outcome !== "playing") return;
        revenant.banish();
        banished += 1;
        rig.shake.trigger();
        if (banished >= TO_BANISH) outcome = "won";
      });
    };

    let elapsed = 0;
    return (frameCtx, dt) => {
      loading.update();
      elapsed += dt;

      if (outcome === "playing") {
        const move = frameCtx.input.vector("move");
        warden.position.x = Math.max(
          -HALF_WIDTH + 1,
          Math.min(HALF_WIDTH - 1, warden.position.x + move.x * WARDEN_SPEED * dt),
        );
        warden.position.z = Math.max(
          -HALF_DEPTH + 1,
          Math.min(HALF_DEPTH - 1, warden.position.z - move.y * WARDEN_SPEED * dt),
        );
        spawnTimer -= dt;
        if (spawnTimer <= 0 && spawned < TO_BANISH + 2) {
          spawn();
          spawnTimer = SPAWN_EVERY;
        }
      }

      const target = { x: warden.position.x, z: warden.position.z };
      let nearest = 99;
      let alive = 0;
      for (let index = revenants.length - 1; index >= 0; index -= 1) {
        const revenant = revenants[index];
        if (revenant === undefined) continue;
        const speed = outcome === "playing" ? 0.85 + banished * 0.1 : 0;
        if (!revenant.update(camera, target, dt, speed)) {
          revenants.splice(index, 1);
          lastFrames.delete(revenant);
          continue;
        }
        const previous = lastFrames.get(revenant);
        if (previous !== revenant.frameIndex) {
          if (previous !== undefined) spriteAdvances += 1;
          lastFrames.set(revenant, revenant.frameIndex);
        }
        if (revenant.banished) continue;
        alive += 1;
        const distance = revenant.distanceTo(target);
        nearest = Math.min(nearest, distance);
        if (distance < CAUGHT_RANGE && outcome === "playing") outcome = "lost";
      }

      rig.update(camera, warden.position, dt);

      // A billboard is square-on from frame one, so only sample once the rig has actually moved —
      // otherwise the reading is true before the game starts and proves nothing.
      const subject = revenants.find((revenant) => !revenant.banished);
      // Gated on the first banishing, not on a clock: the before-snapshot is taken before any
      // click lands, so this reads 0 there and the assertion has something to prove.
      if (subject !== undefined && banished >= 1) {
        subject.mesh.getWorldDirection(PLATE_FACING);
        PLATE_TO_CAMERA.copy(camera.position).sub(subject.mesh.position).normalize();
        // lockAxis "y" keeps the quad upright, so compare on the ground plane the lock leaves free.
        PLATE_FACING.y = 0;
        PLATE_TO_CAMERA.y = 0;
        const facing = Math.abs(PLATE_FACING.normalize().dot(PLATE_TO_CAMERA.normalize()));
        facingSamples += 1;
        facingWorst = facingSamples === 1 ? facing : Math.min(facingWorst, facing);
      }

      hud.update({
        primary: banished,
        counter: Math.round(Math.min(99, nearest)),
        seconds: elapsed,
      });
      frameCtx.state.set({
        banished,
        alive,
        nearest: Math.min(99, nearest),
        outcome,
        shakePeak: rig.shakePeak,
        spriteAdvances,
        billboardFacingWorst: facingWorst,
      });
    };
  }
}
