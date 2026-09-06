import {
  type ICtx,
  Scene,
  type SceneFrame,
  isMobile,
  isTouchscreenAvailable,
} from "@threenative/core";
import type { IPhysicsContext } from "@threenative/physics";
import { Fog, type Group, type PerspectiveCamera } from "three";
import { Ship } from "../entities/Ship.js";
import { followShip, setupCamera } from "../render/camera.js";
import { followSun, setupLighting } from "../render/lighting.js";
import { createLoadingScreen } from "../render/loading.js";
import { createMaterials } from "../render/materials.js";
import { palette } from "../render/palette.js";
import { setupPost } from "../render/postprocessing.js";
import { createBuoy, createIsland } from "../render/props.js";
import { setupSky } from "../render/sky.js";
import { TouchControls } from "../render/touch-controls.js";
import { createOcean, createWaterMesh, surfaceHeight } from "../render/ocean.js";
import type { GameState } from "../state.js";

export type GameCtx = ICtx<GameState, IPhysicsContext>;

/**
 * The passage: four marks to be rounded in order, laid out as a circuit around the headland.
 *
 * What this replaces was four buoys strung along the z axis between 5 and -1, two metres apart,
 * with the ship starting at z = 7 — a course shorter than the ship was long, sailed in under three
 * seconds without touching the helm once. There is no passage in that, and no reason for a rudder.
 * These four are about thirty metres apart and each one is on a different bearing from the last,
 * so every mark is a turn, and the headland at (-13, -17) has to be sailed around rather than
 * through.
 */
const COURSE = [
  { x: 12, z: -10 },
  { x: 2, z: -40 },
  { x: -30, z: -46 },
  { x: -34, z: -6 },
] as const;

/** How close the ship must pass to a mark for it to count as rounded, in metres. */
const ROUNDING_RADIUS = 7;
/**
 * How far a mark's origin sits below the surface it floats on, in metres.
 *
 * The buoy model is built about its own waterline, not its keel, so putting its origin *at* the
 * sea height floated the whole float clear of the water — a barrel hanging in the air with its
 * shadow on the sea beside it. This is the draught that puts the paint line where the water is.
 */
const BUOY_DRAUGHT = 0.32;
/** Seconds of fair wind. Run out of it before the last mark and the passage is lost. */
const WIND_DURATION = 120;

export class Sailing extends Scene<GameState, IPhysicsContext> {
  static override readonly initialState: GameState = {
    buoysRounded: 0,
    elapsed: 0,
    markBearing: 0,
    markDistance: 0,
    paused: false,
    shipZ: 7,
    speed: 0,
    status: "sailing",
    submergedFraction: 0,
    uiReady: false,
    wind: 1,
  };

  override enter(ctx: GameCtx): SceneFrame<GameState, IPhysicsContext> {
    setupSky(ctx.scene);
    // Fog to the horizon colour, and starting far enough out that the island is not eaten. At
    // 30..100 against a dark navy the sea went to slate a boat-length away.
    ctx.scene.fog = new Fog(palette.skyLow, 95, 330);
    const sun = setupLighting(ctx.scene, ctx.renderer.raw as Parameters<typeof setupLighting>[1]);
    setupPost(ctx.renderer, ctx.scene, ctx.camera, { godraysLight: sun, mobile: isMobile() });
    const loading = createLoadingScreen(ctx);
    const camera = ctx.camera as PerspectiveCamera;
    setupCamera(camera);
    ctx.add(camera);
    const showTouchControls = isMobile() && isTouchscreenAvailable();
    const touchControls = showTouchControls
      ? ctx.entities.add("touch-controls", new TouchControls(camera))
      : undefined;

    // `SpectralOcean` is a compute-driven node: `ctx.add` hands it the renderer and puts its
    // passes in the warmup set. It draws nothing — the mesh and its material are this game's, and
    // both live in `src/render/ocean.ts`.
    const ocean = ctx.add(createOcean());
    const sea = createWaterMesh(ocean);
    ctx.add(sea.mesh);

    const materials = createMaterials();
    ctx.add(createIsland(materials));
    const marks: Group[] = [];
    for (const mark of COURSE) {
      const buoy = createBuoy(materials);
      buoy.position.set(mark.x, 0, mark.z);
      marks.push(ctx.add(buoy));
    }

    const ship = new Ship(ctx, ocean);
    ctx.entities.add("player", ship);
    let elapsed = 0;
    let buoysRounded = 0;
    let markBearing = 0;
    let markDistance = 0;
    let status: GameState["status"] = "sailing";

    const advanceSailing = (frameCtx: GameCtx, deltaTime: number, wind: number): void => {
      if (frameCtx.input.justPressed("capsize")) {
        ship.capsize();
        status = "lost";
        return;
      }
      ship.update(
        frameCtx,
        deltaTime,
        wind,
        touchControls?.update(frameCtx.input.raw.pointers, frameCtx.viewport.size),
      );
      const next = COURSE[buoysRounded];
      if (next === undefined) return;
      // Bearing to the next mark **relative to the bow**, which is what the HUD arrow points
      // along: a compass bearing would be right and useless, because the player is looking down
      // the ship's centreline and not at a compass rose.
      const toMarkX = next.x - ship.mesh.position.x;
      const toMarkZ = next.z - ship.mesh.position.z;
      markDistance = Math.hypot(toMarkX, toMarkZ);
      const forward = ship.forward;
      const starboard = ship.starboard;
      markBearing = Math.atan2(
        toMarkX * starboard.x + toMarkZ * starboard.z,
        toMarkX * forward.x + toMarkZ * forward.z,
      );
      // Rounded by sailing close to it, not by crossing a line of latitude. The old test was
      // `position.z > mark`, which the ship passed by drifting sideways past a buoy it never came
      // near, and which no course that turns can even express.
      if (markDistance > ROUNDING_RADIUS) {
        if (wind <= 0) status = "lost";
        return;
      }
      buoysRounded += 1;
      if (buoysRounded === COURSE.length) status = "won";
      else if (wind <= 0) status = "lost";
    };

    return (frameCtx, deltaTime) => {
      loading.update();
      if (frameCtx.input.justPressed("restart")) {
        frameCtx.state.set(Sailing.initialState);
        frameCtx.state.flush();
        void frameCtx.goto("sailing");
        return;
      }

      elapsed += deltaTime;
      // The sea's clock. `SpectralOcean` dispatches its transform every frame regardless, but it
      // transforms the spectrum *at the time it was last given* — so an ocean that is never
      // advanced recomputes t = 0 forever: the compute passes run, the readback lands, and the
      // bytes that come back are identical to sixteen significant figures. That is what a still
      // photograph of a sea looks like from the inside, and it is why the hull sat at one constant
      // height with `oceanSteps` climbing past 400. The game owns this clock, so a paused game has
      // a paused sea.
      ocean.advance(elapsed);
      const wind = Math.max(0, 1 - elapsed / WIND_DURATION);
      if (status === "sailing") advanceSailing(frameCtx, deltaTime, wind);

      // The marks float. They are moored to the sea bed, not nailed to y = 0: left at a fixed
      // height they stood in a hole when the swell rose past them and hung in the air over every
      // trough, which reads as the buoys being the only things in the frame that are not in the
      // water they are floating in.
      for (const [index, mark] of COURSE.entries()) {
        const buoy = marks[index];
        if (buoy === undefined) continue;
        buoy.position.y = (surfaceHeight(ocean, mark.x, mark.z, deltaTime) ?? 0) - BUOY_DRAUGHT;
      }

      const state = frameCtx.state.getState();
      frameCtx.state.set({
        buoysRounded,
        elapsed,
        markBearing,
        markDistance,
        paused: state.paused,
        shipZ: ship.mesh.position.z,
        speed: ship.speed,
        status,
        submergedFraction: ship.immersion,
        uiReady: state.uiReady,
        wind,
      });
      // The **visual**, not the body. `Ship` draws the hull from `ship.visual`, whose y is the sea
      // surface; `ship.mesh` is the physics body, whose y wanders on a throttled height copy and
      // is no longer what anything is drawn at. Following the body pointed the camera somewhere
      // the ship was not: the horizon slid up and down behind a hull that was itself steady, so
      // the ship read as bobbing out of the water and back into it.
      sea.follow(ship.visual.position.x, ship.visual.position.z);
      followShip(camera, ship.visual.position, ship.heading, deltaTime);
      followSun(sun, ship.visual.position);
    };
  }
}
