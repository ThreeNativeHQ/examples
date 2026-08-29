import { Atmosphere, type ICtx, Scene, type SceneFrame, solarPosition } from "@threenative/core";
import type { IPhysicsContext } from "@threenative/physics";
import {
  BoxGeometry,
  Mesh,
  type MeshBasicMaterial,
  MeshStandardMaterial,
  type PerspectiveCamera,
  Vector3,
} from "three";
import { createHud } from "../render/hud.js";
import { setupLighting } from "../render/lighting.js";
import { createLoadingScreen } from "../render/loading.js";
import { palette } from "../render/palette.js";
import { setupPost } from "../render/postprocessing.js";
import { setupSky } from "../render/sky.js";
import { RIDGE_HALF_WIDTH, SPUR_X, createValley } from "../render/valley.js";
import type { GameState } from "../state.js";

export type GameCtx = ICtx<GameState, IPhysicsContext>;

const WALK_SPEED = 3.6;
const SPUR_RANGE = 1.7;
const SHOTS = 3;
/** The golden band. Chosen after reading what the model actually produces over a sunrise. */
const BAND_LOW = 56;
const BAND_HIGH = 76;
/** Game-hours of sunrise per real second. The whole window passes in about twelve seconds. */
const HOURS_PER_SECOND = 0.22;
const START_HOUR = 4.92;

export class Play extends Scene<GameState, IPhysicsContext> {
  static override readonly initialState: GameState = {
    warmth: 0,
    sunElevation: 0,
    skyRadianceRed: 0,
    shots: 0,
    onSpur: false,
    outcome: "playing",
    bestShot: 0,
    sunDiscY: 0,
    sunDiscZ: 0,
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
            transmittance: { width: 256, height: 64 },
            multiScattering: { width: 32, height: 32 },
            skyView: { width: 192, height: 108 },
          },
        })
      : undefined;
    const solarAt = (hour: number) =>
      solarPosition({
        dayOfYear: 172,
        timeOfDay: hour,
        latitude: 49.28,
        longitude: -123.12,
        utcOffset: -8,
      });
    /**
     * The model's own sun direction, turned to the bearing this ridge overlooks.
     *
     * Only the compass bearing is the game's; the elevation is whatever `solarPosition` says. An
     * earlier version rebuilt the vector from `elevation` by hand and got it badly wrong — the
     * disc tracked to y = +6343 and then to -6472 at a 7 km radius, so the sun swung overhead and
     * then underground while the sky looked plausible the whole time. Read the vector, do not
     * re-derive it.
     */
    const BEARING = 0.26;
    const framed = new Vector3();
    const sunAt = (hour: number): Vector3 => {
      atmosphere?.setSunDirection(solarAt(hour));
      const direction = atmosphere?.getSunDirection();
      if (direction === undefined) return framed.set(Math.sin(BEARING), 0.1, -Math.cos(BEARING)).normalize();
      const horizontal = Math.hypot(direction.x, direction.z);
      return framed
        .set(Math.sin(BEARING) * horizontal, direction.y, -Math.cos(BEARING) * horizontal)
        .normalize();
    };
    atmosphere?.setSunDirection(sunAt(START_HOUR));
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
    camera.fov = 56;
    camera.near = 0.1;
    camera.far = 30_000;
    camera.position.set(0, 4.2, 8.6);
    camera.lookAt(Math.sin(0.26) * 160, 7.5, -Math.cos(0.26) * 160);
    camera.updateProjectionMatrix();
    const loading = createLoadingScreen(ctx);
    ctx.add(ctx.camera);
    const hud = ctx.entities.add("hud", createHud(camera, "TONE", "SHOT"));

    const valley = createValley();
    ctx.add(valley.group);

    const runner = new Mesh(
      new BoxGeometry(0.6, 1.5, 0.6),
      new MeshStandardMaterial({ color: palette.player, roughness: 0.5 }),
    );
    runner.position.set(-3.2, 0.75, 1.4);
    runner.castShadow = true;
    ctx.add(runner);
    ctx.entities.add("runner", { mesh: runner, debug: () => ({ x: runner.position.x }) });

    let elapsed = 0;
    let shots = 0;
    let bestShot = 0;
    let outcome = "playing";
    const transmittance = new Vector3();

    return (frameCtx, dt) => {
      loading.update();
      elapsed += dt;

      const hour = START_HOUR + elapsed * HOURS_PER_SECOND;
      const sun = sunAt(hour);
      atmosphere?.setSunDirection(sun);
      if (atmosphere !== undefined) lighting.updateSun(atmosphere.getSunDirection());

      // Warmth is not a clock and not a fudge: it is the atmosphere's own sun transmittance, the
      // colour sunlight arrives in after the air has taken the blue out of it. Delete the
      // atmosphere and there is no number here to fire on.
      let warmth = 0;
      let skyRadianceRed = 0;
      if (atmosphere !== undefined) {
        const value = atmosphere.sunTransmittance(atmosphere.getSunDirection());
        if (value instanceof Vector3) {
          transmittance.copy(value);
          // The disc is the game's mesh wearing the model's colour. Delete the atmosphere and it
          // has nothing to wear.
          const sunMaterial = valley.sun.material as MeshBasicMaterial;
          // Scaled up: the disc is additive against a lit sky, and transmittance is a 0-1
          // attenuation, so at unit scale it disappears into the background it is added to.
          sunMaterial.color.setRGB(
            transmittance.x * 3.4,
            transmittance.y * 3.1,
            transmittance.z * 2.6,
          );
          valley.sun.position.copy(sun).multiplyScalar(7_000);
          valley.sun.lookAt(camera.position);
          warmth = Math.max(0, Math.min(100, (transmittance.x - transmittance.z) * 140));
          skyRadianceRed = transmittance.x;
        }
      }

      if (outcome === "playing") {
        const move = frameCtx.input.vector("move");
        runner.position.x = Math.max(
          -RIDGE_HALF_WIDTH,
          Math.min(RIDGE_HALF_WIDTH, runner.position.x + move.x * WALK_SPEED * dt),
        );
      }
      const onSpur = Math.abs(runner.position.x - SPUR_X) <= SPUR_RANGE;

      if (outcome === "playing" && frameCtx.input.justPressed("signal") && onSpur) {
        shots += 1;
        bestShot = Math.max(bestShot, warmth);
        if (warmth >= BAND_LOW && warmth <= BAND_HIGH) outcome = "signalled";
        else if (shots >= SHOTS) outcome = "missed";
      }

      hud.update({ primary: Math.round(warmth), counter: SHOTS - shots, seconds: elapsed });
      frameCtx.state.set({
        warmth,
        sunElevation: solarAt(hour).elevation,
        skyRadianceRed,
        shots,
        onSpur,
        outcome,
        bestShot,
        sunDiscY: valley.sun.position.y,
        sunDiscZ: valley.sun.position.z,
      });
    };
  }
}
