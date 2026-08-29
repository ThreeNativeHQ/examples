import { Atmosphere, GPUSceneBVH, type ICtx, Scene, type SceneFrame, solarPosition } from "@threenative/core";
import { CollisionShape3D, type IPhysicsContext, RigidBody3D } from "@threenative/physics";
import { BoxGeometry, Mesh, type PerspectiveCamera, PlaneGeometry, Vector3 } from "three";
import { Player } from "../entities/Player.js";
import { createBeacons } from "../render/beacons.js";
import { createCameraRig, setupCamera } from "../render/camera.js";
import { createContactGroundMaterial } from "../render/contact.js";
import { createHud } from "../render/hud.js";
import { setupLighting } from "../render/lighting.js";
import { createLoadingScreen } from "../render/loading.js";
import { floorMaterial } from "../render/materials.js";
import { MoteField } from "../render/motes.js";
import { setupPost } from "../render/postprocessing.js";
import { setupSky } from "../render/sky.js";
import type { GameState } from "../state.js";

export type GameCtx = ICtx<GameState, IPhysicsContext>;

const PLATE_FACING = new Vector3();
const PLATE_POSITION = new Vector3();
const PLATE_TO_CAMERA = new Vector3();

export class Play extends Scene<GameState, IPhysicsContext> {
  static override readonly initialState: GameState = {
    playerX: 0,
    score: 0,
    sunAzimuth: 0,
    sunElevation: 0,
    sunTransmittanceRed: 0,
    beaconsLit: 0,
    beaconsHovered: 0,
    beaconHoverEvents: 0,
    cameraDistance: 0,
    shakePeak: 0,
    billboardFacing: 0,
    billboardFacingWorst: 0,
    flameFrame: 0,
    flameAdvances: 0,
    computeSteps: 0,
    bvhTriangles: 0,
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
    const initialSun = solarPosition({
      dayOfYear: 172,
      timeOfDay: 18.1,
      latitude: 49.28,
      longitude: -123.12,
      utcOffset: -8,
    });
    atmosphere?.setSunDirection(initialSun);
    if (atmosphere !== undefined) {
      ctx.add(atmosphere);
      atmosphere.attachRenderer(ctx.renderer);
    }
    setupSky(ctx.scene, atmosphere);
    const lighting = setupLighting(
      ctx.scene,
      ctx.renderer.raw as Parameters<typeof setupLighting>[1],
      atmosphere,
    );
    setupPost(ctx.renderer, ctx.scene, ctx.camera, atmosphere);
    const camera = ctx.camera as PerspectiveCamera;
    setupCamera(camera);
    const rig = createCameraRig();
    const loading = createLoadingScreen(ctx);
    ctx.add(ctx.camera);
    const hud = ctx.entities.add("hud", createHud(camera, "ON"));

    // A collider the player actually stands on. Its mesh is invisible when the BVH contact ground
    // is drawn instead, so exactly one surface is ever visible.
    const floor = new Mesh(new BoxGeometry(26, 0.2, 20), floorMaterial);
    floor.position.set(0, -0.1, -2);
    floor.receiveShadow = true;
    ctx.add(floor);
    new RigidBody3D({
      object: floor,
      physics: ctx.physics,
      shape: CollisionShape3D.fromMesh(floor),
      type: "fixed",
    });

    const beaconField = createBeacons(camera);
    ctx.add(beaconField.root);
    // Registered so a scenario can aim a click at the beacon itself rather than at a pixel that
    // only happens to be over it at one camera distance.
    beaconField.beacons.forEach((beacon, index) => {
      ctx.entities.add(`beacon-${index}`, beacon.post);
    });

    const player = new Player(ctx);
    ctx.entities.add("player", player);

    // Flush world matrices first. The BVH packs world-space triangles, and nothing has rendered
    // yet at scene-build time, so without this every beacon packs at its unparented local
    // position and the ground query misses all three.
    ctx.scene.updateMatrixWorld(true);
    // The scene BVH packs whatever the game flagged traceable — here, the beacon posts.
    const bvh = webgpu
      ? (ctx.add(
          new GPUSceneBVH(ctx.scene, { include: (object) => object.userData.traceable === true }),
        ) as GPUSceneBVH)
      : undefined;
    if (bvh !== undefined) {
      const ground = new Mesh(new PlaneGeometry(26, 20), createContactGroundMaterial(bvh));
      ground.rotation.x = -Math.PI / 2;
      ground.position.set(0, 0.005, -2);
      ground.name = "contact-ground";
      ctx.add(ground);
      floor.visible = false;
    }

    const motes = webgpu ? (ctx.add(new MoteField()) as MoteField) : undefined;

    // PRD-237: the listener is registered against the beacon's own mesh. No DOM handler, no
    // hit-test table, and nothing in the frame loop asks "is the pointer over a beacon".
    let hovered = 0;
    let hoverEvents = 0;
    for (const beacon of beaconField.beacons) {
      ctx.pointer.on(beacon.post, "pointerEntered", () => {
        hovered += 1;
        hoverEvents += 1;
        beacon.nameplate.scale.setScalar(1.25);
      });
      ctx.pointer.on(beacon.post, "pointerExited", () => {
        hovered = Math.max(0, hovered - 1);
        beacon.nameplate.scale.setScalar(1);
      });
      ctx.pointer.on(beacon.post, "tapped", () => {
        if (beacon.lit) return;
        beacon.lit = true;
        beacon.flame.visible = true;
        // A lit flame becomes part of the traced scene. The snapshot is static by contract, so
        // the game says when to repack — and `bvhTriangles` moving is what proves it did.
        beacon.flame.userData.traceable = true;
        bvh?.rebuild();
        // The shake is a consequence of a gameplay event, triggered by game code.
        rig.shake.trigger();
      });
    }

    let elapsed = 0;
    let facingWorst = 0;
    let flameAdvances = 0;
    let lastFlameFrame = -1;
    let facingSamples = 0;
    const startDistance = rig.distance;
    return (frameCtx, dt) => {
      loading.update();
      player.update(frameCtx, dt);
      elapsed += dt;

      const sun = solarPosition({
        dayOfYear: 172,
        timeOfDay: (18.1 + elapsed * 0.22) % 24,
        latitude: 49.28,
        longitude: -123.12,
        utcOffset: -8,
      });
      if (atmosphere !== undefined) {
        atmosphere.setSunDirection(sun);
        lighting.updateSun(atmosphere.getSunDirection());
      }

      beaconField.animator.update(dt);
      if (beaconField.animator.frameIndex !== lastFlameFrame) {
        if (lastFlameFrame !== -1) flameAdvances += 1;
        lastFlameFrame = beaconField.animator.frameIndex;
      }
      beaconField.update(camera);
      rig.update(camera, player.mesh.position, frameCtx.input.axis("zoom"), dt);

      const lit = beaconField.beacons.filter((beacon) => beacon.lit).length;
      hud.update({ primary: lit, seconds: elapsed });

      // Compare the leftmost nameplate's normal against the direction to the camera, not against
      // the camera's forward axis: an off-centre billboard is turned toward the camera's position,
      // so those two differ by the view angle even when the billboard is perfect. Reads 1 when it
      // faces the camera; delete the Billboard3D update above and it collapses as the rig orbits.
      const plate = beaconField.beacons[0]?.nameplate;
      let facing = 0;
      if (plate !== undefined) {
        plate.getWorldDirection(PLATE_FACING);
        plate.getWorldPosition(PLATE_POSITION);
        PLATE_TO_CAMERA.copy(camera.position).sub(PLATE_POSITION).normalize();
        facing = Math.abs(PLATE_FACING.dot(PLATE_TO_CAMERA));
      }
      // Only sample once the rig has actually moved. A billboard is aligned on frame one, so a
      // reading taken before the camera travels proves nothing and the harness says so.
      if (Math.abs(rig.distance - startDistance) >= 1) {
        facingSamples += 1;
        facingWorst = facingSamples === 1 ? facing : Math.min(facingWorst, facing);
      }

      frameCtx.state.set({
        playerX: player.mesh.position.x,
        score: lit,
        sunAzimuth: sun.azimuth,
        sunElevation: sun.elevation,
        beaconsLit: lit,
        beaconsHovered: hovered,
        beaconHoverEvents: hoverEvents,
        cameraDistance: rig.distance,
        shakePeak: rig.shakePeak,
        billboardFacing: facing,
        billboardFacingWorst: facingWorst,
        flameFrame: beaconField.animator.frameIndex,
        flameAdvances,
        computeSteps: motes?.steps ?? 0,
        bvhTriangles: bvh?.triangleCount ?? 0,
      });

      if (atmosphere !== undefined) {
        const transmittance = atmosphere.sunTransmittance(atmosphere.getSunDirection());
        if (transmittance instanceof Vector3)
          frameCtx.state.set({ sunTransmittanceRed: transmittance.x });
      }
    };
  }
}
