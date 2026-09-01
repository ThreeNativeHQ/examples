import { type ICtx, Scene, type SceneFrame, isMobile, isWeb } from "@threenative/core";
import { CollisionShape3D, type IPhysicsContext, RigidBody3D } from "@threenative/physics";
import {
  BufferAttribute,
  Group,
  type InstancedMesh,
  Matrix4,
  Mesh,
  NearestFilter,
  NoColorSpace,
  type PerspectiveCamera,
  SRGBColorSpace,
  type Texture,
  Vector2,
} from "three";
import { Wanderer, capturePointerOnClick } from "../entities/Wanderer.js";
import { type IFoliageMaps, createFoliage } from "../render/foliage.js";
import { createLandmark, createTrailhead } from "../render/landmarks.js";
import { setupForestLighting } from "../render/lighting.js";
import { createLoadingScreen } from "../render/loading.js";
import { createBannerMaterial, createMaterials } from "../render/materials.js";
import { setupPost } from "../render/postprocessing.js";
import { setupSky } from "../render/sky.js";
import {
  type ITerrainMaps,
  LAKE,
  TERRAIN_SIZE,
  createTerrain,
  createTerrainMaterial,
  heightAt,
} from "../render/terrain.js";
import { createWater } from "../render/water.js";
import { LANDMARKS, TRAILHEAD, nearestUnfound, withinReach } from "../world/landmarks.js";
import type { GameState } from "../state.js";

export type GameCtx = ICtx<GameState, IPhysicsContext>;

/** How much space the scatter leaves around the trailhead, so the first frame can see out. */
const CLEARING = 9;
/** And around each landmark, so none of them is found by walking into a tree in front of it. */
const LANDMARK_CLEARING = 9;
/** Fall below this and you have left the world; the walk resets to the trailhead. */
const KILL_PLANE = -40;

/**
 * Where the walk starts, and where a capture or a proof can ask it to start instead.
 *
 * `?spawn=x,z,yaw` — a browser-only override, guarded by `isWeb()` and doing nothing anywhere
 * else. It exists because there is no other way to point a first-person camera from outside the
 * game: CDP mouse deltas read zero without OS focus, so a scripted look is not available, and a
 * proof that has to *walk* forty metres to reach the thing it is testing is a proof that fails
 * whenever the terrain is retuned. Aim is delivered here instead, once, at spawn.
 */
function spawnOverride(): { x: number; z: number; yaw: number } | undefined {
  if (!isWeb() || typeof window === "undefined") return undefined;
  const raw = new URLSearchParams(window.location.search).get("spawn");
  if (raw === null) return undefined;
  const parts = raw.split(",").map(Number);
  const [x, z, yaw] = parts;
  if (parts.length !== 3 || x === undefined || z === undefined || yaw === undefined) return undefined;
  if (!Number.isFinite(x) || !Number.isFinite(z) || !Number.isFinite(yaw)) return undefined;
  return { x, yaw, z };
}

export class Valley extends Scene<GameState, IPhysicsContext> {
  #banner: Mesh | undefined;
  #releasePointer: (() => void) | undefined;
  #ground: ITerrainMaps | undefined;
  #foliage: IFoliageMaps | undefined;

  static override readonly initialState: GameState = {
    canInspect: false,
    discovered: 0,
    fernCount: 0,
    grassCount: 0,
    groundGap: 0,
    heading: 0,
    inspectTarget: "",
    journal: [],
    landmarkTotal: LANDMARKS.length,
    nearest: "",
    nearestDistance: 0,
    objectiveComplete: false,
    odometer: 0,
    paused: false,
    terrainTriangles: 0,
    treeCount: 0,
    uiReady: false,
    valleyReady: false,
    wading: false,
    walkerX: TRAILHEAD.x,
    walkerY: 0,
    walkerZ: TRAILHEAD.z,
  };

  override async load(ctx: GameCtx): Promise<void> {
    // The packaged proof asset. It earns its place on the trailhead waymarker rather than parked
    // in the scene as a debug object, and the console marker below is what the desktop asset gate
    // greps for — keep both.
    const [texture, model, ground, foliageMaps] = await Promise.all([
      ctx.assets.texture("native-proof.png"),
      ctx.assets.model<{ scene: Group }>("native-proof.glb"),
      loadGround(ctx),
      loadFoliage(ctx),
    ]);
    this.#ground = ground;
    this.#foliage = foliageMaps;
    // A 16-pixel check filtered smoothly is a grey smear at banner size; nearest keeps the squares
    // square, which is what makes the waymarker legible from across the clearing.
    texture.magFilter = NearestFilter;
    let banner: Mesh | undefined;
    model.scene.traverse((object) => {
      if (object instanceof Mesh) {
        if (banner !== undefined) throw new Error("The packaged proof glTF must contain one mesh.");
        object.material = createBannerMaterial(texture);
        // The packaged proof carries positions and indices only. Without UVs the sampler reads one
        // corner texel for every fragment and the banner renders flat white — a loaded texture
        // that proves nothing you can see. Plane-project the triangle. Compiled models may be
        // quantized, so measure each axis range from the array rather than assuming float metres.
        const position = object.geometry.getAttribute("position");
        let minX = Number.POSITIVE_INFINITY;
        let minY = Number.POSITIVE_INFINITY;
        let maxX = Number.NEGATIVE_INFINITY;
        let maxY = Number.NEGATIVE_INFINITY;
        for (let index = 0; index < position.count; index += 1) {
          minX = Math.min(minX, position.getX(index));
          maxX = Math.max(maxX, position.getX(index));
          minY = Math.min(minY, position.getY(index));
          maxY = Math.max(maxY, position.getY(index));
        }
        const spanX = Math.max(maxX - minX, Number.EPSILON);
        const spanY = Math.max(maxY - minY, Number.EPSILON);
        const uv = new Float32Array(position.count * 2);
        for (let index = 0; index < position.count; index += 1) {
          uv[index * 2] = (position.getX(index) - minX) / spanX;
          uv[index * 2 + 1] = (position.getY(index) - minY) / spanY;
        }
        object.geometry.setAttribute("uv", new BufferAttribute(uv, 2));
        banner = object;
      }
    });
    if (banner === undefined) throw new Error("The packaged proof glTF did not contain a mesh.");
    this.#banner = banner;
    console.info("TN_NATIVE_STARTER_ASSETS_LOADED:texture,glb");
  }

  override enter(ctx: GameCtx): SceneFrame<GameState, IPhysicsContext> {
    const banner = this.#banner;
    if (banner === undefined) throw new Error("The valley did not finish loading.");

    setupSky(ctx.scene);
    const sun = setupForestLighting(
      ctx.scene,
      ctx.renderer.raw as Parameters<typeof setupForestLighting>[1],
    );
    // isMobile() arrives as an argument because src/render/ imports no framework package: the
    // platform decision is made here, in portable game code.
    setupPost(ctx.renderer, ctx.scene, ctx.camera, { godraysLight: sun, mobile: isMobile() });
    const loading = createLoadingScreen(ctx);
    ctx.add(ctx.camera);

    const ground = this.#ground;
    if (ground === undefined) throw new Error("The ground textures did not load.");
    const terrain = createTerrain(createTerrainMaterial(ground));
    ctx.add(terrain.mesh);
    // A heightfield collider, not a trimesh. The same 190 m valley as a trimesh is 72,000
    // triangles for Rapier to broadphase against; as a heightfield it is a grid lookup, and the
    // surface it describes is the same function the mesh was built from. `scale` is the world
    // extent of the whole field with y left at 1, because `heights` is already in metres.
    new RigidBody3D({
      physics: ctx.physics,
      position: { x: 0, y: 0, z: 0 },
      shape: CollisionShape3D.heightfield(terrain.rows, terrain.columns, terrain.heights, {
        x: terrain.size,
        y: 1,
        z: terrain.size,
      }),
      type: "fixed",
    });

    const water = createWater(new Vector2(LAKE.x, LAKE.z), LAKE.radius);
    ctx.add(water.mesh);

    const foliageMaps = this.#foliage;
    if (foliageMaps === undefined) throw new Error("The foliage textures did not load.");
    const foliage = createFoliage(TERRAIN_SIZE / 2 - 4, CLEARING, foliageMaps);
    for (const mesh of foliage.meshes) ctx.add(mesh);
    // Clear the trees standing inside a landmark. Scattering first and clearing after is cheaper
    // in code than teaching the scatter about the landmarks, and instanced meshes cannot drop an
    // instance without a rebuild — so the clearing is done by pushing the offenders under the
    // ground, where the terrain hides them. A visible tree inside the standing stone is worse
    // than a buried one nobody can reach.
    hideFoliageNearLandmarks(foliage.meshes);

    const materials = createMaterials();
    for (const landmark of LANDMARKS) {
      ctx.add(
        createLandmark(landmark.id, materials, landmark.x, heightAt(landmark.x, landmark.z), landmark.z),
      );
    }
    ctx.add(createTrailhead(materials, banner, heightAt(TRAILHEAD.x, TRAILHEAD.z)));

    // Facing north-east by default, which puts the standing stone, the ridge and the trailhead
    // post all in the first frame — a spawn looking at nothing reads as a broken load.
    const start = spawnOverride() ?? { x: TRAILHEAD.x, yaw: -0.6, z: TRAILHEAD.z };
    const walker = ctx.entities.add("walker", new Wanderer(ctx, start.x, start.z, start.yaw));
    // Torn down in `exit` below. A pointer-lock listener left on a canvas the next scene reuses
    // grabs the mouse for a scene that never asked for it.
    this.#releasePointer = capturePointerOnClick();

    ctx.state.set({
      fernCount: foliage.fernCount,
      grassCount: foliage.grassCount,
      landmarkTotal: LANDMARKS.length,
      terrainTriangles: terrain.triangles,
      treeCount: foliage.treeCount,
      valleyReady: true,
    });
    ctx.state.flush();
    console.info(
      `TN_VALLEY_BUILT trees=${String(foliage.treeCount)} ferns=${String(foliage.fernCount)} grass=${String(foliage.grassCount)} terrain=${String(terrain.triangles)}`,
    );

    const found = new Set<string>();
    const journal: string[] = [];
    const frameState: Partial<GameState> = {};

    return (frameCtx, dt) => {
      loading.update();
      if (frameCtx.input.justPressed("restart")) {
        frameCtx.state.set(Valley.initialState);
        frameCtx.state.flush();
        void frameCtx.goto("valley");
        return;
      }

      walker.update(frameCtx, dt, frameCtx.camera as PerspectiveCamera);
      if (walker.object.position.y < KILL_PLANE) walker.respawn(TRAILHEAD.x, TRAILHEAD.z);

      const { x, z } = walker.object.position;
      const reachable = withinReach(x, z, found);
      if (reachable !== undefined && frameCtx.input.justPressed("inspect")) {
        found.add(reachable.id);
        journal.push(reachable.name);
        // Flushed on the frame it happens: discovering a landmark is the one event in this game a
        // person is waiting to see acknowledged, and the store's ~100 ms publish cadence is long
        // enough for the HUD to feel like it missed the keypress.
        frameCtx.state.set({
          discovered: found.size,
          journal: [...journal],
          objectiveComplete: found.size === LANDMARKS.length,
        });
        frameCtx.state.flush();
        console.info(`TN_LANDMARK_FOUND:${reachable.id}`);
      }

      const nearest = nearestUnfound(x, z, found);
      frameState.canInspect = reachable !== undefined;
      frameState.groundGap = round(walker.groundGap);
      frameState.heading = Math.round(walker.heading);
      frameState.inspectTarget = reachable?.name ?? "";
      frameState.nearest = nearest?.landmark.name ?? "";
      frameState.nearestDistance = nearest === undefined ? 0 : round(nearest.distance);
      frameState.odometer = round(walker.odometer);
      frameState.wading = walker.wading;
      frameState.walkerX = round(x);
      frameState.walkerY = round(walker.feetY);
      frameState.walkerZ = round(z);

      const current = frameCtx.state.getState();
      const changed =
        frameState.canInspect !== current.canInspect ||
        frameState.groundGap !== current.groundGap ||
        frameState.heading !== current.heading ||
        frameState.inspectTarget !== current.inspectTarget ||
        frameState.nearest !== current.nearest ||
        frameState.nearestDistance !== current.nearestDistance ||
        frameState.odometer !== current.odometer ||
        frameState.wading !== current.wading ||
        frameState.walkerX !== current.walkerX ||
        frameState.walkerY !== current.walkerY ||
        frameState.walkerZ !== current.walkerZ;
      if (changed) frameCtx.state.set(frameState);
    };
  }

  override exit(): void {
    this.#releasePointer?.();
    this.#releasePointer = undefined;
  }
}

/**
 * Load the four ground layers imported from Landscape Pro 2.0.
 *
 * **Colour space is the whole reason this function exists.** A diffuse map holds colour and must be
 * decoded from sRGB; a normal map holds three signed numbers pretending to be a colour and must
 * not. Get the second one wrong and nothing errors — every lit surface just goes subtly flat and
 * washed out, in a way that reads as bad lighting and sends you off tuning lights for an hour.
 * `ctx.assets.texture()` returns the texture without an opinion, so the game states it here, once,
 * for every map it loads.
 */
async function loadGround(ctx: GameCtx): Promise<ITerrainMaps> {
  const load = async (file: string, data: boolean): Promise<Texture> => {
    const map = await ctx.assets.texture(`landscape/${file}.jpg`);
    map.colorSpace = data ? NoColorSpace : SRGBColorSpace;
    return map;
  };
  const [
    grassDiffuse, grassNormal,
    litterDiffuse, litterNormal,
    rockDiffuse, rockNormal,
    dirtDiffuse, dirtNormal,
  ] = await Promise.all([
    load("ground_grass_01_diffuse", false), load("ground_grass_01_normal", true),
    load("ground_forest_diffuse", false), load("ground_forest_normal", true),
    load("ground_rock_01_diffuse", false), load("ground_rock_01_normal", true),
    load("ground_dirt_01_diffuse", false), load("ground_dirt_01_normal", true),
  ]);
  console.info("TN_GROUND_LAYERS_LOADED:grass,forest,rock,dirt");
  return {
    dirtDiffuse, dirtNormal,
    grassDiffuse, grassNormal,
    litterDiffuse, litterNormal,
    rockDiffuse, rockNormal,
  } as ITerrainMaps;
}

/** Bark for the trunks, and the two cut-out atlases the undergrowth is stamped from. */
async function loadFoliage(ctx: GameCtx): Promise<IFoliageMaps> {
  const load = async (file: string, data: boolean): Promise<Texture> => {
    const map = await ctx.assets.texture(`landscape/${file}.jpg`);
    map.colorSpace = data ? NoColorSpace : SRGBColorSpace;
    return map;
  };
  const [bark, barkNormal, frond, plants] = await Promise.all([
    load("pine_bark_diffuse", false),
    load("pine_bark_normal", true),
    load("farn_diffuse", false),
    load("grassgroup_diffuse", false),
  ]);
  console.info("TN_FOLIAGE_MAPS_LOADED:bark,frond,plants");
  return { bark, barkNormal, frond, plants };
}

/** A tenth of a metre is finer than anything here needs, and keeps the published state readable. */
function round(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * Sink every instance standing inside a landmark's clearing.
 *
 * `InstancedMesh` has no way to remove one instance, and rebuilding the buffer to drop a few dozen
 * of eleven thousand is not worth the code. Scaling to zero would work but leaves a degenerate
 * triangle the shadow pass still walks; dropping them a hundred metres puts them under the
 * terrain, out of the frustum the player is ever in, and costs one matrix write each at build
 * time.
 */
function hideFoliageNearLandmarks(meshes: readonly InstancedMesh[]): void {
  const matrix = new Matrix4();
  for (const mesh of meshes) {
    let moved = 0;
    for (let index = 0; index < mesh.count; index += 1) {
      mesh.getMatrixAt(index, matrix);
      const x = matrix.elements[12] ?? 0;
      const z = matrix.elements[14] ?? 0;
      const inside = LANDMARKS.some(
        (landmark) => Math.hypot(x - landmark.x, z - landmark.z) < LANDMARK_CLEARING,
      );
      if (!inside) continue;
      matrix.elements[13] = -400;
      mesh.setMatrixAt(index, matrix);
      moved += 1;
    }
    if (moved > 0) mesh.instanceMatrix.needsUpdate = true;
  }
}
