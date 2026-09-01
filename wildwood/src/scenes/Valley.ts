import { type ICtx, Scene, type SceneFrame, isMobile, isWeb } from "@threenative/core";
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
  type PerspectiveCamera,
  SRGBColorSpace,
  type Scene as ThreeScene,
  type Texture,
  Vector2,
} from "three";
import { Wanderer, capturePointerOnClick } from "../entities/Wanderer.js";
import { type IFoliageSets, type ITreeSpecies, createFoliage, extractTreeSpecies, retextureSpecies } from "../render/foliage.js";
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
import { createWater } from "../render/water.js";
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
  #flora: IFoliageSets | undefined;
  #props: ILandmarkProps | undefined;
  #stoneMaps: ILandmarkMaps | undefined;
  #wavesNormal: Texture | undefined;
  #animals: IWildwoodAnimals | undefined;

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
    const [texture, model, ground, flora, props, stoneMaps, wavesNormal] = await Promise.all([
      ctx.assets.texture("native-proof.png"),
      ctx.assets.model<{ scene: Group }>("native-proof.glb"),
      loadGround(ctx),
      loadFlora(ctx),
      loadLandmarkStone(ctx),
      loadStoneMaps(ctx),
      ctx.assets.texture("landscape/waves_normal.jpg"),
    ]);
    this.#ground = ground;
    this.#flora = flora;
    this.#props = props;
    this.#stoneMaps = stoneMaps;
    // The wood's fauna, from the Animal Variety pack: six animals placed away from water and
    // landmarks, each with its own idle/graze/wander/flee machine over the pack's real clips.
    console.info("TN_ANIMALS_SPAWN_START");
    this.#animals = await spawnWildwoodAnimals({
      load: (path) => ctx.assets.model(`fab/${ANIMAL_LISTING}/raw/${path}`),
      ground: heightAt,
      parent: ctx.scene,
      placements: [
        { id: "fox", x: 28, z: 8 },
        { id: "husky", x: 8, z: 18 },
        { id: "pig", x: 20, z: 36 },
        { id: "stag", x: 28, z: 2 },
        { id: "doe", x: 54, z: 2 },
        { id: "wolf", x: -6, z: -30 },
      ],
    });
    console.info(`TN_ANIMALS_LIVE:${String(this.#animals.animals.length)}`);
    // The stone species wear the scene's own rock maps: the importer could only bind their packed
    // height/AO/curvature data texture as a base colour, which glows radioactive under a gain.
    // `cliffrocks` is the diffuse the terrain's rock layer already uses, so every stone now
    // matches the ground it sits in.
    const rockMap = stoneMaps.rock;
    const rockNormalMap = stoneMaps.rockNormal;
    if (rockMap === undefined || rockNormalMap === undefined) {
      throw new Error("The rock maps did not load; the stone species cannot be retextured.");
    }
    const restone = (species: ITreeSpecies): ITreeSpecies =>
      retextureSpecies(species, rockMap, rockNormalMap);
    this.#flora = {
      ...flora,
      cliffs: flora.cliffs.map(restone),
      rocks: flora.rocks.map(restone),
    };
    this.#props = {
      cliffs: props.cliffs.map(restone),
      rocks: props.rocks.map(restone),
      boughs: props.boughs,
    };
    // A normal map is three signed numbers pretending to be a colour: it must not decode as sRGB.
    wavesNormal.colorSpace = NoColorSpace;
    this.#wavesNormal = wavesNormal;
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

    // The sky is Poly Haven's "Forest Slope" photograph now — ambient and view from the real
    // thing, key light still the game's own. Fire-and-forget: the loading screen covers the
    // frames before the .hdr lands, and a failure names itself rather than killing the scene.
    // The URL is the compiler's hashed one on purpose: Vite's SPA fallback answers 200 with
    // index.html for an unhashed path, and HDRLoader reports that as a bad file format.
    void setupSkyHdri(ctx.scene, ctx.renderer, "/hdri/kloofendal_48d_2k.23d73b43.hdr").catch(
      (error: unknown) => console.error("TN_SKY_HDRI_FAILED", error),
    );
    if (new URLSearchParams(window.location.search).has("nosky") === true) {
      // Capture-environment bisect hook: ?nosky isolates whether the HDRI environment pass is
      // what the Vulkan-on-Xvfb capture driver fails to present. Gameplay never sets it.
      sceneNoSky(ctx.scene);
    }
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

    const water = createWater(new Vector2(LAKE.x, LAKE.z), LAKE.radius, { wavesNormal: this.#wavesNormal });
    ctx.add(water.mesh);

    const flora = this.#flora;
    if (flora === undefined) throw new Error("The flora meshes did not load.");
    const props = this.#props;
    if (props === undefined) throw new Error("The landmark stone did not load.");
    const foliage = createFoliage(TERRAIN_SIZE / 2 - 4, CLEARING, flora);
    for (const mesh of foliage.meshes) ctx.add(mesh);
    // Clear the trees standing inside a landmark. Scattering first and clearing after is cheaper
    // in code than teaching the scatter about the landmarks, and instanced meshes cannot drop an
    // instance without a rebuild — so the clearing is done by pushing the offenders under the
    // ground, where the terrain hides them. A visible tree inside the standing stone is worse
    // than a buried one nobody can reach.
    hideFoliageNearLandmarks(foliage.meshes);

    const materials = createMaterials(this.#stoneMaps);
    // The pond, on the eastern walk between the standing stone and the charcoal ring: water, rock
    // ring, reeds, and the wet margin, all dressed from the same species the wood is built from.
    const pond = createPond(materials, props.rocks, flora.ferns, flora.shrubs, this.#wavesNormal);
    ctx.add(pond.water.mesh);
    ctx.add(pond.group);
    for (const landmark of LANDMARKS) {
      ctx.add(
        createLandmark(landmark.id, materials, props, landmark.x, heightAt(landmark.x, landmark.z), landmark.z),
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
      boulderCount: foliage.boulderCount,
      fernCount: foliage.fernCount,
      grassCount: foliage.grassCount,
      landmarkTotal: LANDMARKS.length,
      terrainTriangles: terrain.triangles,
      treeCount: foliage.treeCount,
      valleyReady: true,
    });
    ctx.state.flush();
    console.info(
      `TN_VALLEY_BUILT trees=${String(foliage.treeCount)} ferns=${String(foliage.fernCount)} grass=${String(foliage.grassCount)} boulders=${String(foliage.boulderCount)} terrain=${String(terrain.triangles)}`,
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
      // The wood is inhabited: every animal runs its state machine each frame with the walker as
      // the threat that flips grazing into fleeing.
      this.#animals?.update(dt, walker.object.position);
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
    this.#animals?.dispose();
    this.#animals = undefined;
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
    // Extension matters here, and not for size. A cut-out atlas keyed on a black background must
    // be lossless: JPEG puts ringing halos around every frond edge, `alphaTest` keeps the brighter
    // half of that ringing, and the result is white speckles and vertical smears that look like a
    // particle bug. Ground tiles have no alpha key and stay JPEG.
    const path = `landscape/${file}`;
    let map: Texture;
    try {
      map = await ctx.assets.texture(path);
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
async function loadFlora(ctx: GameCtx): Promise<IFoliageSets> {
  const niches = Object.keys(FLORA) as (keyof IFoliageSets)[];
  const sets = await Promise.all(
    niches.map(async (niche): Promise<[keyof IFoliageSets, ITreeSpecies[]]> => {
      const species: ITreeSpecies[] = [];
      for (const name of FLORA[niche]) {
        const model = await ctx.assets.model<{ scene: Group }>(`${FAB}/${name}.glb`);
        species.push(extractTreeSpecies(name, model));
      }
      console.info(`TN_FLORA_LOADED:${niche}=${String(species.length)}species`);
      return [niche, species];
    }),
  );
  return Object.fromEntries(sets) as unknown as IFoliageSets;
}

/** The cliff faces, bough piles, and boulders the landmarks are dressed from. */
async function loadLandmarkStone(ctx: GameCtx): Promise<ILandmarkProps> {
  const load = async (name: string): Promise<ITreeSpecies> =>
    extractTreeSpecies(name, await ctx.assets.model<{ scene: Group }>(`${FAB}/${name}.glb`));
  const [cliffs, boughs, rocks] = await Promise.all([
    Promise.all(LANDMARK_STONE.cliffs.map(load)),
    Promise.all(LANDMARK_STONE.boughs.map(load)),
    Promise.all(LANDMARK_STONE.rocks.map(load)),
  ]);
  console.info("TN_LANDMARK_STONE_LOADED:cliffs,boughs,rocks");
  return { boughs, cliffs, rocks };
}

/** The two pack maps the landmark *procedural* pieces still wear: dead bark, and cliff rock. */
async function loadStoneMaps(ctx: GameCtx): Promise<ILandmarkMaps> {
  const load = async (file: string, data: boolean): Promise<Texture> => {
    const path = `landscape/${file}`;
    let map: Texture;
    try {
      map = await ctx.assets.texture(path);
    } catch (cause) {
      // A texture loader rejects with a DOM `Event`, whose `toString` is "[object Event]" — so the
      // loading screen shows exactly that and names neither the file nor the reason. Re-throw with
      // the path attached; it is the difference between a five-second fix and a hunt.
      throw new Error(`Failed to load texture ${path}.`, { cause });
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

/** Bisect helper for the capture harness: strip the HDRI environment and background. */
function sceneNoSky(scene: ThreeScene): void {
  scene.environment = null;
  scene.background = null;
  scene.fog = new Fog(0xd8d4cc, 110, 400);
}
