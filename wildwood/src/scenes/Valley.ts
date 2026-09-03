import {
  type IAssetLoader,
  type ICtx,
  Scene,
  type SceneFrame,
  isMobile,
  isWeb,
} from "@threenative/core";
import { CollisionShape3D, type IPhysicsContext, RigidBody3D } from "@threenative/physics";
import {
  BufferAttribute,
  Fog,
  Group,
  type InstancedMesh,
  Matrix4,
  Mesh,
  NearestFilter,
  NoColorSpace,
  type Object3D,
  type PerspectiveCamera,
  SRGBColorSpace,
  Scene as ThreeScene,
  type Texture,
  Vector2,
  Vector3,
} from "three";
import { Wanderer, capturePointerOnClick } from "../entities/Wanderer.js";
import {
  type IFoliageSets,
  type ITreeSpecies,
  createFoliage,
  extractTreeSpecies,
  packSectionMaterial,
  retextureSpecies,
} from "../render/foliage.js";
import { type ILandmarkProps, createLandmark, createTrailhead } from "../render/landmarks.js";
import { createPond } from "../render/pond.js";
import { setupForestLighting } from "../render/lighting.js";
import { createLoadingScreen } from "../render/loading.js";
import { type ILandmarkMaps, createBannerMaterial, createMaterials } from "../render/materials.js";
import { setupPost } from "../render/postprocessing.js";
import { setupSkyHdri } from "../render/sky-hdri.js";
import { spawnWildwoodAnimals, type IWildwoodAnimals } from "../entities/animals/spawnWildwoodAnimals.js";
import {
  type ITerrainMaps,
  LAKE,
  TERRAIN_SIZE,
  createTerrain,
  createTerrainMaterial,
  heightAt,
} from "../render/terrain.js";
import { createWater, type IWater } from "../render/water.js";
import { LANDMARKS, TRAILHEAD, nearestUnfound, withinReach } from "../world/landmarks.js";
import type { GameState } from "../state.js";

export type GameCtx = ICtx<GameState, IPhysicsContext>;

/** Where the Landscape Pro import landed; every mesh GLB resolves through the asset manifest. */
const FAB = "fab/1ac647da-b1bc-4e72-a56d-60aaeb6918e1/Models";

/**
 * Every imported species, by niche.
 *
 * Conifers hold the high steep ground (five pack pines, and their saplings as the young generation);
 * broadleaves and dead snags the low flat ground; shrubs, flowers and nettles the open margins;
 * ferns the shade; grass the whole floor; boulders wherever soil gave up; and the cliff faces the
 * ridge wall, where the slope is already steeper than soil holds.
 *
 * Left out on purpose, with reasons: `SM_tree_dead` decodes to a 1.1 m stump rather than a tree;
 * `SM_waterPlane` is a 96-vertex plane this game's shader water supersedes; `SM_cliff_Mesh` is a
 * one-off mega-mesh the valley has no place for; `SM_new_farn_Inst` duplicates `SM_new_farn01`.
 */
const FLORA: Record<keyof IFoliageSets, readonly string[]> = {
  conifers: ["SM_pine01", "SM_pine02", "SM_pine03", "SM_pine04", "SM_pine05", "SM_pine-small01", "SM_pine-small02", "SM_pine-small03"],
  broadleaves: ["SM_green-tree01", "SM_green-tree02", "SM_dead-tree01", "SM_dead-tree02", "SM_dead-tree03", "SM_dead-tree04", "SM_dead-tree05"],
  shrubs: ["SM_bush01", "SM_FlowerGroup01", "SM_FlowerGroup02", "SM_NettleGroup01", "SM_NettleGroup02", "SM_PlantGroup01", "SM_LargePlant", "SM_WeathGroup01", "SM_WeathGroup02"],
  ferns: ["SM_FarnGroup01", "SM_FarnGroup02", "SM_FarnGroup03", "SM_new_farn01", "SM_new_farn02"],
  grasses: ["SM_GrassGroup01", "SM_GrassGroup02", "SM_GrassGroup03", "SM_grass_bush01_lod00", "SM_grass_bush02_lod00", "SM_grass_bush03_lod00", "SM_grass_bush04_lod00", "SM_clover01", "SM_clover02", "SM_clover03"],
  rocks: ["SM_rock01_lod000", "SM_rock02_lod000", "SM_rock03_lod000", "SM_rock04_lod000", "SM_RockGroup01", "SM_RockGroup02"],
  cliffs: ["SM_cliff01", "SM_cliff02", "SM_cliff03", "SM_cliffrock01_lod00", "SM_cliffrock02_lod00", "SM_cliffrock03_lod00", "SM_cliffrock04_lod00"],
};

/** The one source species in critical: an authored foreground pine, not a partial scatter. */
const CRITICAL_TREE = "SM_pine-small01";

/** The animal pack's import root; its GLBs resolve through the same manifest as everything else. */
const ANIMAL_LISTING = "2dd7964c-a601-4264-a53d-465dcae1644c";

/** The species the landmarks and the pond dress themselves from. */
const LANDMARK_STONE = {
  cliffs: ["SM_cliffrock01_lod00", "SM_cliffrock02_lod00"],
  boughs: ["SM_BoughGroup01", "SM_BoughGroup02", "SM_BoughGroup03"],
  rocks: ["SM_rock01_lod000", "SM_rock02_lod000", "SM_rock03_lod000", "SM_rock04_lod000", "SM_RockGroup01", "SM_RockGroup02"],
} as const;

/** How much space the scatter leaves around the trailhead, so the first frame can see out. */
const CLEARING = 9;
/** And around each landmark, so none of them is found by walking into a tree in front of it. */
const LANDMARK_CLEARING = 9;
/** Fall below this and you have left the world; the walk resets to the trailhead. */
const KILL_PLANE = -40;

/**
 * A standing trunk, as physics sees it.
 *
 * Until this existed the terrain heightfield was the *only* collider in the game, so the wood was
 * a painting: the walker strolled through pines, snags and the standing stone without touching
 * one. The radius is deliberately under the visible bark — a collider wider than the trunk stops
 * you in open air, which reads as a bug in a way that clipping a few centimetres of bark does not.
 * The capsule's rounded caps are also what let the character controller slide along a trunk
 * instead of sticking to it.
 */
const TRUNK_RADIUS = 0.34;
/** Total capsule height is `2 * (halfHeight + radius)`: 6.7 m, taller than the walker can climb. */
const TRUNK_HALF_HEIGHT = 3;

type AssetKind = "model" | "texture";

interface IStartupControls {
  readonly animalsCritical: boolean;
  readonly criticalDelayMs: number;
  readonly detailHoldMs: number;
  readonly rejectDetail: string | undefined;
}

interface IAssetRecord {
  readonly id: number;
  readonly kind: AssetKind;
  readonly path: string;
}

class StaleGenerationError extends Error {
  constructor(readonly generation: number) {
    super(`Valley generation ${String(generation)} is no longer active.`);
  }
}

class DetailAssetError extends Error {
  constructor(
    readonly logicalAsset: string,
    cause?: unknown,
  ) {
    super(`Detail asset '${logicalAsset}' failed.`, { cause });
  }
}

/** One scene generation's direct loader references, released once by their acquisition id. */
class AssetLease {
  readonly #records: IAssetRecord[] = [];
  readonly #assets: IAssetLoader;
  readonly #generation: number;
  readonly #tier: "critical" | "detail";
  readonly #isLive: () => boolean;
  #closed = false;
  #nextId = 0;

  constructor(
    assets: IAssetLoader,
    generation: number,
    tier: "critical" | "detail",
    isLive: () => boolean,
  ) {
    this.#assets = assets;
    this.#generation = generation;
    this.#tier = tier;
    this.#isLive = isLive;
  }

  async model<T>(path: string): Promise<T> {
    return this.#acquire("model", path, () => this.#assets.model<T>(path));
  }

  async texture(path: string): Promise<Texture> {
    return this.#acquire("texture", path, () => this.#assets.texture(path));
  }

  releaseAll(reason: string): void {
    if (this.#closed) return;
    this.#closed = true;
    for (const record of this.#records.splice(0)) this.#release(record, reason);
  }

  async #acquire<T>(kind: AssetKind, path: string, load: () => Promise<T>): Promise<T> {
    const id = ++this.#nextId;
    const value = await load();
    const record = { id, kind, path } as const;
    console.info(
      `TN_ASSET_ACQUIRE generation=${String(this.#generation)} tier=${this.#tier} id=${String(id)} kind=${kind} path=${path}`,
    );
    if (this.#closed || !this.#isLive()) {
      this.#release(record, "stale-resolution");
      throw new StaleGenerationError(this.#generation);
    }
    this.#records.push(record);
    return value;
  }

  #release(record: IAssetRecord, reason: string): void {
    const result = this.#assets.release(record.kind, record.path);
    console.info(
      `TN_ASSET_RELEASE generation=${String(this.#generation)} tier=${this.#tier} id=${String(record.id)} kind=${record.kind} path=${record.path} reason=${reason} result=${String(result)}`,
    );
  }
}

interface IValleyGeneration {
  id: number;
  critical: AssetLease;
  criticalAnimals?: IWildwoodAnimals;
  criticalWaters: IWater[];
  detail: AssetLease;
  detailObjects: Object3D[];
  /**
   * Every physics body this generation put into the world, so restart can take them out again.
   *
   * `RigidBody3D` is not owned by the scene graph — removing a mesh leaves its collider standing —
   * and the physics context outlives the scene. Before trunks that was one leaked heightfield per
   * restart, invisible because a second heightfield describes the same surface. It is now one
   * heightfield plus ~900 capsules, which a player would feel on the second restart.
   */
  bodies: RigidBody3D[];
  detailAnimals?: IWildwoodAnimals;
  detailWaters: IWater[];
  hdri?: Texture;
  live: boolean;
}

let valleyGenerationSerial = 0;

function startupControls(): IStartupControls {
  if (!isWeb() || typeof window === "undefined") {
    return { animalsCritical: false, criticalDelayMs: 0, detailHoldMs: 0, rejectDetail: undefined };
  }
  const query = new URLSearchParams(window.location.search);
  const milliseconds = (name: string): number => {
    const raw = query.get(name);
    if (raw === null) return 0;
    const value = Number(raw);
    if (!Number.isFinite(value) || value < 0 || value > 30_000) {
      throw new Error(`${name} must be a finite number from 0 through 30000.`);
    }
    return value;
  };
  return {
    animalsCritical: query.has("tnDevAnimalsCritical"),
    criticalDelayMs: milliseconds("tnCriticalDelayMs"),
    detailHoldMs: milliseconds("tnDetailHoldMs"),
    rejectDetail: query.get("tnRejectDetail") ?? undefined,
  };
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

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
  #criticalTree: ITreeSpecies | undefined;
  #loading: ReturnType<typeof createLoadingScreen> | undefined;
  #generation: IValleyGeneration | undefined;
  #scene: ThreeScene | undefined;
  /**
   * The curtain's second phase, owned here because the framework's readiness cannot express it.
   *
   * `ctx.startup.whenReady()` covers the framework's own work and nothing after it, so a game that
   * streams a detail tier reveals a bald valley and lets the player watch the wood grow. These
   * three fields let the loading screen wait for `#loadDetail` instead: `#detailSettled` is the
   * promise it holds on, `#settleDetail` is called once from every exit path of that method —
   * done, rejected, or stale, because a curtain that only lifts on success is a hang — and
   * `#detailProgress` drives the second half of the bar.
   */
  /**
   * Where the standing trunks are, for the per-frame "am I inside a tree" measurement.
   *
   * The colliders make the wood solid; this list is how the game can *prove* it, because a proof
   * that only watches the player's position cannot tell being blocked by a trunk from having
   * walked somewhere there was no trunk to begin with.
   */
  #trunks: readonly Vector3[] = [];
  #detailSettled: Promise<void> | undefined;
  #settleDetail: (() => void) | undefined;
  #detailProgress = 0;

  static override readonly initialState: GameState = {
    canInspect: false,
    discovered: 0,
    boulderCount: 0,
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
    insideTrunkTicks: 0,
    revealFernCount: -1,
    revealTreeCount: -1,
    trunkColliders: 0,
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
    this.#invalidateGeneration("reentry-before-load");
    const id = ++valleyGenerationSerial;
    const generation = {} as IValleyGeneration;
    generation.id = id;
    generation.live = true;
    generation.bodies = [];
    generation.criticalWaters = [];
    generation.detailObjects = [];
    generation.detailWaters = [];
    generation.critical = new AssetLease(
      ctx.assets,
      id,
      "critical",
      () => this.#generation === generation && generation.live,
    );
    generation.detail = new AssetLease(
      ctx.assets,
      id,
      "detail",
      () => this.#generation === generation && generation.live,
    );
    this.#generation = generation;
    const controls = startupControls();

    this.#detailProgress = 0;
    this.#detailSettled = new Promise<void>((resolve) => {
      this.#settleDetail = resolve;
    });

    // This synchronous game-owned view exists before the first `ctx.assets` request below.
    this.#loading = createLoadingScreen(ctx, {
      until: this.#detailSettled,
      // Long enough for a cold cache on this valley's ~70 GLBs, short enough that a detail tier
      // which never settles costs seconds rather than a game that never starts. When it expires
      // the player gets the critical world — thinner, and playable.
      holdBudgetMs: 45_000,
      holdProgress: () => this.#detailProgress,
      onReveal: () => {
        // Sampled once, on the frame the curtain lifts. This is the whole world the player is
        // first shown, and the only number that can prove they were not shown a bald valley.
        const seen = ctx.state.getState();
        ctx.state.set({
          revealFernCount: seen.fernCount,
          revealTreeCount: seen.treeCount,
        });
        ctx.state.flush();
        console.info(
          `TN_VALLEY_REVEAL generation=${String(id)} trees=${String(seen.treeCount)} ferns=${String(seen.fernCount)}`,
        );
        // The signal a capture harness actually wants. `__TN_STARTUP_READY__` is the framework's
        // and it now flips several seconds before the curtain lifts, so anything waiting on it
        // screenshots the loading screen and reads the result as a broken scene.
        (globalThis as { __TN_WORLD_REVEALED__?: boolean }).__TN_WORLD_REVEALED__ = true;
      },
    });
    // Cleared here, at the start of every generation, not just set at the end of one.
    //
    // A latched flag with no reset is worse than no flag: it survives a scene re-enter, so after an
    // HMR reload, the restart key, or any second generation it is *already* true when a harness
    // starts polling, `waitForFunction` returns on its first tick, and the capture is whatever
    // curtain happens to be up. Lane D caught this as a screenshot of "BUILDING TERRAIN 65%" taken
    // by a wait that had been told the world was already on screen.
    (globalThis as { __TN_WORLD_REVEALED__?: boolean }).__TN_WORLD_REVEALED__ = false;
    console.info(`TN_VALLEY_CRITICAL_START generation=${String(id)}`);
    const groundPromise = (async (): Promise<ITerrainMaps> => {
      if (controls.criticalDelayMs > 0) {
        console.info(
          `TN_VALLEY_CRITICAL_DELAY generation=${String(id)} milliseconds=${String(controls.criticalDelayMs)}`,
        );
        await delay(controls.criticalDelayMs);
      }
      return loadGround(generation.critical);
    })();
    // The packaged proof asset. It earns its place on the trailhead waymarker rather than parked
    // in the scene as a debug object, and the console marker below is what the desktop asset gate
    // greps for — keep both.
    try {
      const [texture, model, ground, criticalTree] = await Promise.all([
        generation.critical.texture("native-proof.png"),
        generation.critical.model<{ scene: Group }>("native-proof.glb"),
        groundPromise,
        generation.critical
          .model<{ scene: Group }>(`${FAB}/${CRITICAL_TREE}.glb`)
          .then((tree) => extractTreeSpecies(CRITICAL_TREE, tree)),
      ]);
      this.#ground = ground;
      this.#criticalTree = criticalTree;
      if (controls.animalsCritical) {
        console.info(`TN_DEV_ANIMALS_CRITICAL generation=${String(id)}`);
        generation.criticalAnimals = await spawnAnimals(ctx, generation.critical, ctx.scene);
      }
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
    } catch (error) {
      generation.live = false;
      generation.critical.releaseAll("critical-rejected");
      generation.detail.releaseAll("critical-rejected");
      throw error;
    }
  }

  override enter(ctx: GameCtx): SceneFrame<GameState, IPhysicsContext> {
    const banner = this.#banner;
    if (banner === undefined) throw new Error("The valley did not finish loading.");
    const generation = this.#generation;
    if (generation === undefined || !generation.live) {
      throw new Error("The valley generation was invalidated before enter.");
    }

    // Critical uses the inexpensive authored fallback. The photographic environment is staged
    // with the rest of detail and cannot attach until its generation is still current.
    sceneNoSky(ctx.scene);
    this.#scene = ctx.scene;
    // The scene, for the capture harness and the geometry probes in tools/. Nothing in the game
    // reads it; it is the same kind of hook as `sceneNoSky` above, and it is what lets a probe ask
    // "which instanced mesh is that" instead of a person guessing from a screenshot.
    (globalThis as { __TN_SCENE__?: ThreeScene }).__TN_SCENE__ = ctx.scene;
    // Ask the picture what it is looking at. A probe that walks the graph can only rank objects by
    // how odd their numbers look, and this valley has 46,000 instances whose numbers all look odd
    // in isolation; a ray through the pixel names the thing on screen and ends the guessing.
    (
      globalThis as {
        __TN_PICK__?: (
          x: number,
          y: number,
        ) => { dims: number[]; distance: number; name: string; tris: number }[];
      }
    ).__TN_PICK__ = (x, y) =>
      ctx
        .raycastAll({ screen: new Vector2(x, y) })
        .slice(0, 8)
        .map((hit) => {
          const trail: string[] = [];
          for (let node: Object3D | null = hit.object; node !== null; node = node.parent) {
            trail.unshift(node.name === "" ? node.type : node.name);
          }
          const geometry = (hit.object as Mesh).geometry;
          geometry.computeBoundingBox();
          const box = geometry.boundingBox;
          const scale = new Vector3();
          hit.object.getWorldScale(scale);
          const position = geometry.getAttribute("position");
          return {
            dims:
              box === null
                ? []
                : [
                    Number(((box.max.x - box.min.x) * scale.x).toFixed(3)),
                    Number(((box.max.y - box.min.y) * scale.y).toFixed(3)),
                    Number(((box.max.z - box.min.z) * scale.z).toFixed(3)),
                  ],
            distance: Number(hit.distance.toFixed(2)),
            name: trail.join("/"),
            tris: Math.round((geometry.index?.count ?? position.count) / 3),
          };
        });
    const sun = setupForestLighting(
      ctx.scene,
      ctx.renderer.raw as Parameters<typeof setupForestLighting>[1],
    );
    // isMobile() arrives as an argument because src/render/ imports no framework package: the
    // platform decision is made here, in portable game code. `?lowtier` is the capture harness's
    // hook for the same path — the Vulkan-on-Xvfb driver fails to present the high tier's
    // SSGI/SSR pass over skinned meshes, and the gate still needs screenshots (gameplay never
    // sets the flag).
    const lowTier = isWeb() && new URLSearchParams(window.location.search).has("lowtier");
    setupPost(ctx.renderer, ctx.scene, ctx.camera, { godraysLight: sun, mobile: isMobile() || lowTier });
    const loading = this.#loading ?? createLoadingScreen(ctx);
    ctx.add(ctx.camera);

    const ground = this.#ground;
    if (ground === undefined) throw new Error("The ground textures did not load.");
    const terrain = createTerrain(createTerrainMaterial(ground));
    ctx.add(terrain.mesh);
    // A heightfield collider, not a trimesh. The same 190 m valley as a trimesh is 72,000
    // triangles for Rapier to broadphase against; as a heightfield it is a grid lookup, and the
    // surface it describes is the same function the mesh was built from. `scale` is the world
    // extent of the whole field with y left at 1, because `heights` is already in metres.
    generation.bodies.push(
      new RigidBody3D({
        physics: ctx.physics,
        position: { x: 0, y: 0, z: 0 },
        shape: CollisionShape3D.heightfield(terrain.rows, terrain.columns, terrain.heights, {
          x: terrain.size,
          y: 1,
          z: terrain.size,
        }),
        type: "fixed",
      }),
    );

    const water = createWater(new Vector2(LAKE.x, LAKE.z), LAKE.radius);
    generation.criticalWaters.push(water);
    ctx.add(water.mesh);

    const criticalTree = this.#criticalTree;
    if (criticalTree === undefined) throw new Error("The critical tree did not load.");
    ctx.add(createCriticalTree(criticalTree));
    const materials = createMaterials();
    ctx.add(createTrailhead(materials, banner, heightAt(TRAILHEAD.x, TRAILHEAD.z)));

    // Facing north-east by default, which puts the standing stone, the ridge and the trailhead
    // post all in the first frame — a spawn looking at nothing reads as a broken load.
    const start = spawnOverride() ?? { x: TRAILHEAD.x, yaw: -0.6, z: TRAILHEAD.z };
    const walker = ctx.entities.add("walker", new Wanderer(ctx, start.x, start.z, start.yaw));
    // Torn down in `exit` below. A pointer-lock listener left on a canvas the next scene reuses
    // grabs the mouse for a scene that never asked for it.
    this.#releasePointer = capturePointerOnClick();

    ctx.state.set({
      boulderCount: 0,
      fernCount: 0,
      grassCount: 0,
      landmarkTotal: LANDMARKS.length,
      terrainTriangles: terrain.triangles,
      treeCount: 1,
      valleyReady: true,
    });
    ctx.state.flush();
    void ctx.startup.whenReady().then(() => {
      if (this.#generation !== generation || !generation.live) return;
      // The engine holds input updates through first-use compilation. This is the first moment the
      // entered valley is actually controllable, so it is the critical-ready marker and the detail
      // boundary—not the earlier scene-graph construction point.
      console.info(
        `TN_VALLEY_BUILT generation=${String(generation.id)} trees=1 ferns=0 grass=0 boulders=0 terrain=${String(terrain.triangles)}`,
      );
      void this.#loadDetail(ctx, generation, startupControls());
    });

    const found = new Set<string>();
    const journal: string[] = [];
    const frameState: Partial<GameState> = {};
    let insideTrunkTicks = 0;

    return (frameCtx, dt) => {
      loading.update();
      if (frameCtx.input.justPressed("restart")) {
        frameCtx.state.set(Valley.initialState);
        frameCtx.state.flush();
        void frameCtx.goto("valley");
        return;
      }

      walker.update(frameCtx, dt, frameCtx.camera as PerspectiveCamera);
      // The wood is inhabited: every animal runs its state machine each frame with the walker as
      // the threat that flips grazing into fleeing.
      (generation.detailAnimals ?? generation.criticalAnimals)?.update(
        dt,
        walker.object.position,
      );
      if (walker.object.position.y < KILL_PLANE) walker.respawn(TRAILHEAD.x, TRAILHEAD.z);

      const { x, z } = walker.object.position;
      // Inside a trunk, measured against the trunk axis rather than the collider. A few hundred
      // squared distances per frame against 2,340 trunks is nothing next to the wood it checks,
      // and it stops at the first hit.
      for (const trunk of this.#trunks) {
        const dx = x - trunk.x;
        const dz = z - trunk.z;
        if (dx * dx + dz * dz < TRUNK_RADIUS * TRUNK_RADIUS) {
          insideTrunkTicks += 1;
          break;
        }
      }
      frameState.insideTrunkTicks = insideTrunkTicks;
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
        frameState.insideTrunkTicks !== current.insideTrunkTicks ||
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

  /**
   * Lift the curtain exactly once, however the detail tier ends.
   *
   * `#loadDetailInner` has eight exit paths — done, five stale checks, a rejection, and a throw
   * that escapes the try — and the loading screen is waiting on all of them. A settle placed at
   * the happy path alone is a game that hangs on a black screen the first time an asset 404s, so
   * the settle lives in a `finally` where no future path can miss it. Rethrows, so the caller's
   * error behaviour is unchanged.
   */
  async #loadDetail(
    ctx: GameCtx,
    generation: IValleyGeneration,
    controls: IStartupControls,
  ): Promise<void> {
    try {
      await this.#loadDetailInner(ctx, generation, controls);
    } finally {
      this.#detailProgress = 1;
      this.#settleDetail?.();
    }
  }

  /** Stage every optional result off-scene, then attach only while this generation is current. */
  async #loadDetailInner(
    ctx: GameCtx,
    generation: IValleyGeneration,
    controls: IStartupControls,
  ): Promise<void> {
    const live = (): boolean => this.#generation === generation && generation.live;
    const generationLabel = `generation=${String(generation.id)}`;
    console.info(`TN_VALLEY_DETAIL_START ${generationLabel}`);
    const animalStage = new Group();
    animalStage.name = `animals-stage-${String(generation.id)}`;
    const hdriStage = new ThreeScene();
    const skipAnimals = isWeb() && new URLSearchParams(window.location.search).has("noanimals");
    const skipSky = isWeb() && new URLSearchParams(window.location.search).has("nosky");

    const floraPromise = loadFlora(generation.detail, controls);
    const boughPromise = loadLandmarkBoughs(generation.detail, controls);
    const mapsPromise = loadStoneMaps(generation.detail, controls);
    const animalsPromise =
      controls.animalsCritical || skipAnimals
        ? Promise.resolve(undefined)
        : spawnAnimals(ctx, generation.detail, animalStage, controls);
    const hdriPromise = skipSky
      ? Promise.resolve(undefined)
      : stageHdri(ctx, hdriStage, controls);
    // The bar's second half, driven by the milestones this method actually reaches rather than by
    // a timer. Five sources settle independently, so each one that lands moves the fill.
    this.#detailProgress = 0.04;
    const sources = [floraPromise, boughPromise, mapsPromise, animalsPromise, hdriPromise] as const;
    let landed = 0;
    for (const source of sources) {
      // Typed as `unknown` on purpose: this loop only counts, and widening the five differently
      // typed sources into one array is what cost `allSettled` its positional result types below.
      void (source as Promise<unknown>).then(
        () => {
          landed += 1;
          this.#detailProgress = Math.max(
            this.#detailProgress,
            0.04 + (landed / sources.length) * 0.56,
          );
        },
        () => undefined,
      );
    }
    const staged = await Promise.allSettled([
      floraPromise,
      boughPromise,
      mapsPromise,
      animalsPromise,
      hdriPromise,
    ]);
    const stagedAnimals =
      staged[3]?.status === "fulfilled"
        ? (staged[3].value as IWildwoodAnimals | undefined)
        : undefined;
    if (!live()) {
      stagedAnimals?.dispose();
      disposeStagedHdri(hdriStage, generation.id, "stale-generation");
      console.info(`TN_VALLEY_DETAIL_STALE ${generationLabel}`);
      return;
    }
    const rejected = staged.find(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    if (rejected !== undefined) {
      const logicalAsset = detailAssetName(rejected.reason);
      generation.detail.releaseAll("detail-rejected");
      stagedAnimals?.dispose();
      disposeStagedHdri(hdriStage, generation.id, "detail-rejected");
      const expected = controls.rejectDetail === logicalAsset;
      console[expected ? "info" : "error"](
        `TN_VALLEY_DETAIL_REJECTED ${generationLabel} asset=${logicalAsset}`,
        rejected.reason,
      );
      return;
    }

    const floraResult = staged[0];
    const boughResult = staged[1];
    const mapsResult = staged[2];
    const animalsResult = staged[3];
    if (
      floraResult.status !== "fulfilled" ||
      boughResult.status !== "fulfilled" ||
      mapsResult.status !== "fulfilled" ||
      animalsResult.status !== "fulfilled"
    ) {
      throw new Error("Settled detail results changed after rejection handling.");
    }
    const flora = floraResult.value;
    const boughs = boughResult.value;
    const stoneMaps = mapsResult.value;
    const animals = animalsResult.value;
    this.#detailProgress = Math.max(this.#detailProgress, 0.62);
    console.info(`TN_VALLEY_DETAIL_STAGED ${generationLabel}`);
    if (controls.detailHoldMs > 0) {
      console.info(
        `TN_VALLEY_DETAIL_PENDING ${generationLabel} milliseconds=${String(controls.detailHoldMs)}`,
      );
      await delay(controls.detailHoldMs);
    }
    if (!live()) {
      animals?.dispose();
      disposeStagedHdri(hdriStage, generation.id, "stale-generation");
      console.info(`TN_VALLEY_DETAIL_STALE ${generationLabel}`);
      return;
    }

    try {
      const rockMap = stoneMaps.rock;
      const rockNormalMap = stoneMaps.rockNormal;
      if (rockMap === undefined || rockNormalMap === undefined) {
        throw new DetailAssetError("landmark-map:rock-pair");
      }
      const restone = (species: ITreeSpecies): ITreeSpecies =>
        retextureSpecies(species, rockMap, rockNormalMap);
      const dressedFlora: IFoliageSets = {
        ...flora,
        cliffs: flora.cliffs.map(restone),
        rocks: flora.rocks.map(restone),
      };
      const props: ILandmarkProps = {
        boughs,
        cliffs: LANDMARK_STONE.cliffs.map((name) => requiredSpecies(dressedFlora.cliffs, name)),
        rocks: LANDMARK_STONE.rocks.map((name) => requiredSpecies(dressedFlora.rocks, name)),
      };
      const foliage = createFoliage(TERRAIN_SIZE / 2 - 4, CLEARING, dressedFlora);
      hideFoliageNearLandmarks(foliage.meshes);
      // The wood becomes solid here. `foliage.trunks` has been recorded by the scatter since it was
      // written and nothing had ever read it.
      this.#trunks = foliage.trunks;
      let standing = 0;
      for (const trunk of foliage.trunks) {
        standing += 1;
        generation.bodies.push(
          new RigidBody3D({
            physics: ctx.physics,
            // The capsule is centred on its body, so the body sits half a capsule up from the
            // trunk's base or the collider's bottom cap floats above the ground.
            position: {
              x: trunk.x,
              y: trunk.y + TRUNK_HALF_HEIGHT + TRUNK_RADIUS,
              z: trunk.z,
            },
            shape: CollisionShape3D.capsule(TRUNK_HALF_HEIGHT, TRUNK_RADIUS),
            type: "fixed",
          }),
        );
      }
      // Counted from the bodies actually built, not from the list they were built out of. A count
      // taken off the source list still reads 880 when the loop that consumes it does nothing,
      // which is exactly the state a negative control puts the game in — the number would agree
      // that the wood is solid while the player walks through it.
      console.info(`TN_TRUNK_COLLIDERS:${String(standing)}`);
      ctx.state.set({ trunkColliders: standing });
      const detailObjects: Object3D[] = [...foliage.meshes];

      const materials = createMaterials(stoneMaps);
      const pond = createPond(materials, props.rocks, dressedFlora.ferns, dressedFlora.shrubs);
      generation.detailWaters.push(pond.water);
      detailObjects.push(pond.water.mesh, pond.group);
      const skipLandmarks =
        isWeb() && new URLSearchParams(window.location.search).has("nolandmarks");
      for (const landmark of skipLandmarks ? [] : LANDMARKS) {
        detailObjects.push(
          createLandmark(
            landmark.id,
            materials,
            props,
            landmark.x,
            heightAt(landmark.x, landmark.z),
            landmark.z,
          ),
        );
      }
      if (animals !== undefined) {
        generation.detailAnimals = animals;
        detailObjects.push(animals.group);
        console.info(`TN_ANIMALS_LIVE:${String(animals.animals.length)}`);
      }
      // Install the environment before the first sliced attachment. Adding it last invalidates
      // every newly compiled lit material at once and turns detail completion into a long frame.
      generation.hdri = installStagedHdri(ctx.scene, hdriStage);
      // Slices of ATTACH_PER_FRAME, not one object per frame. The slicing exists so the renderer
      // compiles a few newly visible families per presented frame instead of all of them in one
      // multi-second first-detail frame — that part still holds. What changed is who is watching:
      // the loading curtain is up for the whole of this loop now, so the only thing a slice has to
      // stay smooth for is the progress bar, not a player mid-stride. One-per-frame cost 6.5 s of
      // the 16.5 s load with nothing on screen to spend it on.
      const ATTACH_PER_FRAME = 6;
      let attached = 0;
      for (const object of detailObjects) {
        if (!live()) throw new StaleGenerationError(generation.id);
        this.#addDetail(ctx, generation, object);
        attached += 1;
        // The sliced attachment is the longest visible stretch of the hold, so it owns the last
        // third of the bar rather than a frozen 0.62.
        this.#detailProgress = 0.66 + (attached / detailObjects.length) * 0.34;
        if (attached % ATTACH_PER_FRAME === 0) await delay(16);
      }
      if (!live()) throw new StaleGenerationError(generation.id);
      ctx.state.set({
        boulderCount: foliage.boulderCount,
        fernCount: foliage.fernCount,
        grassCount: foliage.grassCount,
        treeCount: foliage.treeCount + 1,
      });
      ctx.state.flush();
      console.info(
        `TN_VALLEY_DETAIL_DONE ${generationLabel} trees=${String(foliage.treeCount)} ferns=${String(foliage.fernCount)} grass=${String(foliage.grassCount)} boulders=${String(foliage.boulderCount)}`,
      );
    } catch (error) {
      this.#clearGenerationDetail(generation, "attachment-rejected");
      disposeStagedHdri(hdriStage, generation.id, "attachment-rejected");
      generation.detail.releaseAll("attachment-rejected");
      if (!live() || error instanceof StaleGenerationError) {
        console.info(`TN_VALLEY_DETAIL_STALE ${generationLabel}`);
        return;
      }
      const logicalAsset = detailAssetName(error);
      console.error(
        `TN_VALLEY_DETAIL_REJECTED ${generationLabel} asset=${logicalAsset}`,
        error,
      );
    }
  }

  #addDetail(ctx: GameCtx, generation: IValleyGeneration, object: Object3D): void {
    generation.detailObjects.push(object);
    ctx.add(object);
  }

  #clearGenerationDetail(generation: IValleyGeneration, reason: string): void {
    for (const object of generation.detailObjects.splice(0)) object.removeFromParent();
    for (const body of generation.bodies.splice(0)) body.dispose();
    this.#trunks = [];
    generation.detailAnimals?.dispose();
    generation.detailAnimals = undefined;
    for (const water of generation.detailWaters.splice(0)) water.dispose();
    const hdri = generation.hdri;
    if (hdri !== undefined) {
      if (this.#scene?.environment === hdri) this.#scene.environment = null;
      if (this.#scene?.background === hdri) this.#scene.background = null;
      hdri.dispose();
      generation.hdri = undefined;
      console.info(
        `TN_HDRI_DISPOSE generation=${String(generation.id)} reason=${reason} count=1`,
      );
    }
  }

  #invalidateGeneration(reason: string): void {
    const generation = this.#generation;
    if (generation === undefined || !generation.live) return;
    generation.live = false;
    generation.critical.releaseAll(reason);
    generation.detail.releaseAll(reason);
    this.#clearGenerationDetail(generation, reason);
    generation.criticalAnimals?.dispose();
    generation.criticalAnimals = undefined;
    for (const water of generation.criticalWaters.splice(0)) water.dispose();
  }

  override exit(): void {
    this.#invalidateGeneration("scene-exit");
    this.#loading?.finish();
    this.#loading = undefined;
    this.#releasePointer?.();
    this.#releasePointer = undefined;
    this.#scene = undefined;
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
async function loadGround(assets: AssetLease): Promise<ITerrainMaps> {
  const load = async (file: string, data: boolean): Promise<Texture> => {
    // Extension matters here, and not for size. A cut-out atlas keyed on a black background must
    // be lossless: JPEG puts ringing halos around every frond edge, `alphaTest` keeps the brighter
    // half of that ringing, and the result is white speckles and vertical smears that look like a
    // particle bug. Ground tiles have no alpha key and stay JPEG.
    const path = `landscape/${file}`;
    let map: Texture;
    try {
      map = await assets.texture(path);
    } catch (cause) {
      // A texture loader rejects with a DOM `Event`, whose `toString` is "[object Event]" — so the
      // loading screen shows exactly that and names neither the file nor the reason. Re-throw with
      // the path attached; it is the difference between a five-second fix and a hunt.
      throw new Error(`Failed to load texture ${path}.`, { cause });
    }
    map.colorSpace = data ? NoColorSpace : SRGBColorSpace;
    return map;
  };
  const [
    grassDiffuse, grassNormal,
    litterDiffuse, litterNormal,
    rockDiffuse, rockNormal,
    dirtDiffuse, dirtNormal,
  ] = await Promise.all([
    load("ground_grass_01_diffuse.jpg", false), load("ground_grass_01_normal.jpg", true),
    load("ground_forest_diffuse.jpg", false), load("ground_forest_normal.jpg", true),
    load("ground_rock_01_diffuse.jpg", false), load("ground_rock_01_normal.jpg", true),
    load("ground_dirt_01_diffuse.jpg", false), load("ground_dirt_01_normal.jpg", true),
  ]);
  console.info("TN_GROUND_LAYERS_LOADED:grass,forest,rock,dirt");
  return {
    dirtDiffuse, dirtNormal,
    grassDiffuse, grassNormal,
    litterDiffuse, litterNormal,
    rockDiffuse, rockNormal,
  } as ITerrainMaps;
}

/**
 * Load every imported flora species, by niche.
 *
 * The GLB materials arrive as plain `MeshStandardMaterial`s; the maps and alpha thresholds travel
 * with them, and `extractTreeSpecies` records both plus the species' measured size, so
 * `createFoliage` can rebuild each section as a wind-blown node material without the look
 * decisions leaking into the scene. None of these meshes is rigged, so nothing here needs
 * `SkeletonUtils`.
 */
async function loadFlora(
  assets: AssetLease,
  controls: IStartupControls,
): Promise<IFoliageSets> {
  const niches = Object.keys(FLORA) as (keyof IFoliageSets)[];
  const loaded = Object.fromEntries(niches.map((niche) => [niche, []])) as unknown as {
    [K in keyof IFoliageSets]: ITreeSpecies[];
  };
  // These were once loaded one at a time, on purpose: forty-five parallel GLTF callbacks coalesced
  // into 100–200 ms tasks, and the walker was already entered and being driven while they arrived,
  // so a serial read bought a responsive player at the cost of a slow fill-in.
  //
  // The walker is no longer out there. The loading curtain now holds until this whole tier lands,
  // so there is nothing to keep responsive and the serialisation became pure latency: measured at
  // **31.7 s of staging** for 52 models on the production build — about 600 ms each, back to back,
  // almost all of it waiting rather than working.
  //
  // Bounded concurrency instead of unbounded, because the old measurement is still true about task
  // coalescing: the only thing that must stay smooth now is the progress bar, and a full-width
  // fan-out would freeze it in exactly the way a stalled loading screen reads as a hang.
  const FLORA_CONCURRENCY = 6;
  // Each result is written to its declared slot, never pushed. Completion order under concurrency
  // is whatever the network returns, and `createFoliage` picks species out of these arrays
  // positionally — so pushing would reshuffle which species stands where on every single load, and
  // the valley would never be the same wood twice.
  const queue = niches.flatMap((niche) =>
    FLORA[niche].map((name, slot) => ({ name, niche, slot })),
  );
  // Slots, not chunks: a chunked loop runs at the speed of the slowest model in each chunk, and
  // these range from a 40 kB clover to a 4 MB pine.
  let next = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const index = next;
      next += 1;
      const task = queue[index];
      if (task === undefined) return;
      const logical = `flora:${task.name}`;
      rejectDetailControl(controls, logical);
      try {
        const model = await assets.model<{ scene: Group }>(`${FAB}/${task.name}.glb`);
        loaded[task.niche][task.slot] = extractTreeSpecies(task.name, model);
      } catch (error) {
        if (error instanceof StaleGenerationError) throw error;
        throw new DetailAssetError(logical, error);
      }
      await delay(0);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(FLORA_CONCURRENCY, queue.length) }, () => worker()),
  );
  // Emitted in niche order after the fact. The counts are what the markers always meant; only the
  // order in which the species arrived changed, and no caller of `IFoliageSets` depends on it —
  // `createFoliage` picks species by name and `requiredSpecies` looks them up by name.
  for (const niche of niches) {
    console.info(`TN_FLORA_LOADED:${niche}=${String(loaded[niche].length)}species`);
  }
  return loaded;
}

/** Only boughs are unique landmark models; cliff and rock variants reuse the full flora stage. */
async function loadLandmarkBoughs(
  assets: AssetLease,
  controls: IStartupControls,
): Promise<readonly ITreeSpecies[]> {
  const boughs = await Promise.all(
    LANDMARK_STONE.boughs.map(async (name) => {
      const logical = `landmark-bough:${name}`;
      rejectDetailControl(controls, logical);
      try {
        const model = await assets.model<{ scene: Group }>(`${FAB}/${name}.glb`);
        return extractTreeSpecies(name, model);
      } catch (error) {
        if (error instanceof StaleGenerationError) throw error;
        throw new DetailAssetError(logical, error);
      }
    }),
  );
  console.info(`TN_LANDMARK_BOUGHS_LOADED:${String(boughs.length)}species`);
  return boughs;
}

/** The two pack maps the landmark *procedural* pieces still wear: dead bark, and cliff rock. */
async function loadStoneMaps(
  assets: AssetLease,
  controls: IStartupControls,
): Promise<ILandmarkMaps> {
  const load = async (file: string, data: boolean): Promise<Texture> => {
    const path = `landscape/${file}`;
    const logical = `landmark-map:${file}`;
    rejectDetailControl(controls, logical);
    let map: Texture;
    try {
      map = await assets.texture(path);
    } catch (cause) {
      if (cause instanceof StaleGenerationError) throw cause;
      throw new DetailAssetError(logical, cause);
    }
    map.colorSpace = data ? NoColorSpace : SRGBColorSpace;
    return map;
  };
  const [rock, rockNormal, deadBark, deadBarkNormal] = await Promise.all([
    // `cliffrocks_diffuse`, not `cliffrock01_moss_diffuse`. The latter measures mean 0.091 with a
    // maximum of 0.56 — it never reaches half brightness, because in the pack it is a moss overlay
    // layered onto a base, not a base itself. Used as a base colour it renders every rock in the
    // valley as a black silhouette, and no amount of gain fixes a texture with no highlights.
    load("cliffrocks_diffuse.jpg", false),
    load("cliffrocks_normal.jpg", true),
    load("dead_tree_trunk_diffuse.jpg", false),
    load("dead_tree_trunk_normal.jpg", true),
  ]);
  console.info("TN_LANDMARK_MAPS_LOADED:rock,deadBark");
  return { deadBark, deadBarkNormal, rock, rockNormal };
}

function rejectDetailControl(controls: IStartupControls, logicalAsset: string): void {
  if (controls.rejectDetail === logicalAsset) {
    throw new DetailAssetError(logicalAsset, new Error("injected detail rejection"));
  }
}

function detailAssetName(error: unknown): string {
  if (error instanceof DetailAssetError) return error.logicalAsset;
  if (error instanceof StaleGenerationError) return "stale-generation";
  return "detail-composition";
}

function requiredSpecies(
  species: readonly ITreeSpecies[],
  name: string,
): ITreeSpecies {
  const found = species.find((candidate) => candidate.name === name);
  if (found === undefined) throw new DetailAssetError(`flora:${name}`);
  return found;
}

/** One authored foreground tree. Its position is not part of the seeded detail scatter. */
function createCriticalTree(species: ITreeSpecies): Group {
  const group = new Group();
  group.name = `critical-tree-${species.name}`;
  for (const section of species.sections) {
    const material = packSectionMaterial(
      section,
      section.cutout
        ? { speed: 0.1, stiffness: 1.6, strength: 0.013 }
        : { speed: 0.11, stiffness: 1.8, strength: 0.011 },
      [3.9, 3.4, 2.7],
    );
    const mesh = new Mesh(section.geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  const x = 7;
  const z = -9;
  const height = 7.5;
  group.scale.setScalar(height / species.maxDim);
  group.position.set(x, heightAt(x, z), z);
  group.rotation.y = 0.42;
  return group;
}

async function spawnAnimals(
  ctx: GameCtx,
  assets: AssetLease,
  parent: Object3D,
  controls?: IStartupControls,
): Promise<IWildwoodAnimals> {
  console.info("TN_ANIMALS_SPAWN_START");
  return spawnWildwoodAnimals({
    load: async (path) => {
      const logical = `animal:${path}`;
      if (controls !== undefined) rejectDetailControl(controls, logical);
      try {
        return await assets.model(`fab/${ANIMAL_LISTING}/ue/Models/${path}`);
      } catch (error) {
        if (error instanceof StaleGenerationError) throw error;
        throw new DetailAssetError(logical, error);
      }
    },
    ground: heightAt,
    parent,
    placements: [
      { id: "fox", x: 28, z: 8 },
      { id: "stag", x: 28, z: 2 },
      { id: "doe", x: 54, z: 2 },
      { id: "wolf", x: -6, z: -30 },
      { id: "pig", x: 20, z: 36 },
      { id: "crow", x: 14, z: 26 },
    ],
  });
}

async function stageHdri(
  ctx: GameCtx,
  scene: ThreeScene,
  controls: IStartupControls,
): Promise<void> {
  const logical = "hdri:kloofendal_48d_2k.hdr";
  rejectDetailControl(controls, logical);
  try {
    const url = await resolveServedUrl("hdri/kloofendal_48d_2k.hdr");
    await setupSkyHdri(scene, ctx.renderer, url);
  } catch (error) {
    throw new DetailAssetError(logical, error);
  }
}

function stagedTextures(scene: ThreeScene): Texture[] {
  const textures = new Set<Texture>();
  for (const value of [scene.environment, scene.background]) {
    if (value !== null && "isTexture" in value && value.isTexture === true) {
      textures.add(value as Texture);
    }
  }
  return [...textures];
}

function disposeStagedHdri(scene: ThreeScene, generation: number, reason: string): void {
  const textures = stagedTextures(scene);
  scene.environment = null;
  scene.background = null;
  for (const texture of textures) texture.dispose();
  if (textures.length > 0) {
    console.info(
      `TN_HDRI_DISPOSE generation=${String(generation)} reason=${reason} count=${String(textures.length)}`,
    );
  }
}

function installStagedHdri(target: ThreeScene, staged: ThreeScene): Texture | undefined {
  const texture = stagedTextures(staged)[0];
  if (texture === undefined) return undefined;
  target.environment = staged.environment;
  target.background = staged.background;
  target.environmentIntensity = staged.environmentIntensity;
  target.backgroundIntensity = staged.backgroundIntensity;
  target.backgroundBlurriness = staged.backgroundBlurriness;
  target.backgroundRotation.copy(staged.backgroundRotation);
  target.environmentRotation.copy(staged.environmentRotation);
  target.fog = staged.fog;
  staged.environment = null;
  staged.background = null;
  console.info("TN_SKY_HDRI_ATTACHED");
  return texture;
}

/** The served url of a logical asset path, from the compiled manifest, else the path itself. */
async function resolveServedUrl(logical: string): Promise<string> {
  const response = await fetch("/assets.manifest.json");
  if (!response.ok) return `/${logical}`;
  const manifest = (await response.json()) as { entries?: Record<string, { output?: string }> };
  const output = manifest.entries?.[logical]?.output;
  if (output === undefined) throw new Error(`'${logical}' is not in the asset manifest.`);
  return `/${output}`;
}

/** A tenth of a metre is finer than anything here needs, and keeps the published state readable. */
function round(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * Sink the instances that would *hide* a landmark, and only those.
 *
 * The clearing exists so no landmark is found by walking into a tree standing in front of it. A
 * trunk, a snag, a thicket or a boulder can do that; grass cannot, and neither can leaf litter, a
 * fern or a flower at the margin. The original pass did not distinguish, which was invisible while
 * the wood was sparse and became the largest bare patch in the game once it was not: five 18 m
 * discs of bare terrain texture reading as mown lawn.
 *
 * Layer names come from `foliage.ts`, which names every mesh `<layer>-<species>-<section>`.
 *
 * `InstancedMesh` has no way to remove one instance, and rebuilding the buffer to drop a few dozen
 * of eleven thousand is not worth the code. Scaling to zero would work but leaves a degenerate
 * triangle the shadow pass still walks; dropping them a hundred metres puts them under the
 * terrain, out of the frustum the player is ever in, and costs one matrix write each at build
 * time.
 */
const WALKED_OVER = /^(grass|litter|margin|fern|sapling)-/;

function hideFoliageNearLandmarks(meshes: readonly InstancedMesh[]): void {
  const matrix = new Matrix4();
  for (const mesh of meshes) {
    // Knee-height and below: it never stands between the player and a landmark, so mowing it buys
    // nothing and costs the floor the wood just grew.
    if (WALKED_OVER.test(mesh.name)) continue;
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

/** Bisect helper for the capture harness: strip the HDRI environment and background. */
function sceneNoSky(scene: ThreeScene): void {
  scene.environment = null;
  scene.background = null;
  scene.fog = new Fog(0xd8d4cc, 110, 400);
}
