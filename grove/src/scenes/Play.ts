import {
  Atmosphere,
  baseGeometryOf,
  type ICtx,
  loadAll,
  Scene,
  type SceneFrame,
  isMobile,
  solarPosition,
} from "@threenative/core";
import { CollisionShape3D, type IPhysicsContext, RigidBody3D } from "@threenative/physics";
import {
  BoxGeometry,
  type BufferGeometry,
  type Group,
  Mesh,
  type PerspectiveCamera,
  Vector3,
} from "three";
import { frameGrove, setupCamera } from "../render/camera.js";
import { setupLighting } from "../render/lighting.js";
import { createLoadingScreen } from "../render/loading.js";
import { floorMaterial } from "../render/materials.js";
import { setupPost } from "../render/postprocessing.js";
import { setupSky } from "../render/sky.js";
import { dressVariant, type TreeVariant, type TreeWind } from "../render/trees.js";
import type { GameState } from "../state.js";

export type GameCtx = ICtx<GameState, IPhysicsContext>;

/** The four cooked variants; every tree in the grove is a clone of one of them. */
const VARIANT_SEEDS = [11, 23, 37, 51] as const;
const TREE_COUNT = 22;

/** What `ctx.assets.model` hands back for a glTF; its default scene is the one the cook resolved. */
interface ICookedModel {
  readonly scene: Group;
}

export class Play extends Scene<GameState, IPhysicsContext> {
  static override readonly initialState: GameState = {
    treeCount: 0,
    treeVertices: 0,
    windTime: 0,
    sunAzimuth: 0,
    sunElevation: 0,
    sunTransmittanceRed: 0,
    lodBarkCoarse: 0,
    lodLeafCoarse: 0,
    lodBarkGeometries: 0,
  };

  private variants: TreeVariant[] = [];
  private bark: Mesh[] = [];
  private leaf: Mesh[] = [];
  /** Every bark geometry drawn so far: the four authored bases plus each baked level selected. */
  private readonly barkGeometries = new Set<BufferGeometry>();
  private far = false;
  private sweep = 0;

  /**
   * The trees are cooked data, not generated code: four GLBs from `pnpm trees`, fetched here so the
   * loop never blocks on bytes. `loadAll` writes results to each item's own index, so a seed's
   * variant is always at its own slot whatever order the bytes arrive in.
   */
  override async load(ctx: GameCtx): Promise<void> {
    const models = await loadAll(VARIANT_SEEDS, (seed) =>
      ctx.assets.model<ICookedModel>(`trees/tree-${seed}.glb`),
    );
    this.variants = models.map((model, index) => dressVariant(model.scene, index * 1.7));
  }

  override enter(ctx: GameCtx): SceneFrame<GameState, IPhysicsContext> {
    const useAtmosphere = ctx.renderer.kind === "webgpu";
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
    // Early afternoon, and it stays there. A moving sun was the template's proof that the
    // atmosphere was live; the wind now supplies every frame-to-frame change this scene has. At
    // 16.5 the canopy went muddy under a low sun, so a high one lights the leaves from above.
    const solarInput = {
      dayOfYear: 172,
      timeOfDay: 13.5,
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

    // 1200 m, not 400: the far (LOD) framing stands at z=170 and would otherwise look over the
    // edge of its own ground. The near framing never sees past 60 m of it.
    const ground = new Mesh(new BoxGeometry(1200, 0.2, 1200), floorMaterial);
    ground.position.y = -0.1;
    ground.receiveShadow = true;
    ctx.add(ground);
    new RigidBody3D({
      object: ground,
      physics: ctx.physics,
      shape: CollisionShape3D.fromMesh(ground),
      type: "fixed",
    });

    const { trees, winds, vertices } = this.buildGrove(ctx);
    const camera = ctx.camera as PerspectiveCamera;

    let elapsed = 0;
    const statePatch: Partial<GameState> = {
      treeCount: trees.length,
      treeVertices: vertices,
    };
    return (frameCtx, dt) => {
      loading.update();
      elapsed += dt;
      for (const wind of winds) wind.updateTime(elapsed);
      // A toggle, not a hold: one keypress starts a sixteen-second sweep out to the far end, so a
      // scenario holds nothing while the engine's chain walks through every level it baked.
      if (frameCtx.input.justPressed("far")) this.far = !this.far;
      this.sweep = this.far ? Math.min(1, this.sweep + dt / 16) : 0;
      frameGrove(camera, this.sweep);
      this.observeLod(statePatch);
      statePatch.windTime = elapsed;
      statePatch.sunAzimuth = sun.azimuth;
      statePatch.sunElevation = sun.elevation;
      if (atmosphere !== undefined) {
        // The sun's angle is plain arithmetic, so a scenario asserting only on it proves nothing.
        // This number cannot be produced without the node, which is what makes the atmosphere
        // playtest able to go red.
        const transmittance = atmosphere.sunTransmittance(atmosphere.getSunDirection());
        if (transmittance instanceof Vector3) statePatch.sunTransmittanceRed = transmittance.x;
      }
      frameCtx.state.set(statePatch);
    };
  }

  override exit(): void {
    for (const variant of this.variants) for (const wind of variant.winds) wind.dispose();
    this.variants = [];
    this.bark = [];
    this.leaf = [];
    this.barkGeometries.clear();
  }

  /**
   * What the engine's baked discrete chain is drawing right now. Selection belongs to the engine
   * and happens every frame, so this only reads `mesh.geometry` against the authored LOD0: a mesh
   * on anything else is coarse. The frame function runs before the render, so the level counted is
   * the one the last presented frame actually drew.
   */
  private observeLod(statePatch: Partial<GameState>): void {
    let barkCoarse = 0;
    let leafCoarse = 0;
    for (const mesh of this.bark) {
      this.barkGeometries.add(mesh.geometry);
      if (mesh.geometry !== baseGeometryOf(mesh)) barkCoarse += 1;
    }
    for (const mesh of this.leaf)
      if (mesh.geometry !== baseGeometryOf(mesh)) leafCoarse += 1;
    statePatch.lodBarkCoarse = barkCoarse;
    statePatch.lodLeafCoarse = leafCoarse;
    statePatch.lodBarkGeometries = this.barkGeometries.size;
  }

  /**
   * Place `TREE_COUNT` clones of the dressed variants in an irregular clump. A clone shares its
   * variant's geometry and materials, so the whole grove costs four cooked files and eight
   * materials — and the placement is what declares how small a world scale the wind's own bounds
   * have to cover, which is why `expandBounds` runs last, once per variant geometry.
   */
  private buildGrove(ctx: GameCtx): {
    trees: Group[];
    winds: TreeWind[];
    vertices: number;
  } {
    const variants = this.variants;
    const winds: TreeWind[] = [];
    let vertices = 0;
    for (const variant of variants) {
      winds.push(...variant.winds);
      vertices += variant.vertices;
    }

    const groveRandom = lcg(7_317_051);
    const trees: Group[] = [];
    const spacing = 5;
    const worldScale = new Vector3();
    // The smallest world scale each variant is drawn at: the sway is world metres, so the smallest
    // clone needs the largest local pad.
    const minWorldScale = new Map<TreeVariant, number>();
    for (let attempt = 0; trees.length < TREE_COUNT && attempt < 2_000; attempt += 1) {
      const angle = groveRandom() * Math.PI * 2;
      // Square-root radius: dense at the middle of the clump, thinning outward, never a ring.
      const radius = 3 + Math.sqrt(groveRandom()) * 19;
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius - 6;
      const tooClose = trees.some(
        (tree) => (tree.position.x - x) ** 2 + (tree.position.z - z) ** 2 < spacing * spacing,
      );
      if (tooClose) continue;
      const variant = variants[trees.length % variants.length];
      if (variant === undefined) break;
      const tree = variant.root.clone();
      tree.position.set(x, 0, z);
      tree.rotation.y = groveRandom() * Math.PI * 2;
      const scale = 0.8 + groveRandom() * 0.45;
      tree.scale.setScalar(scale);
      const barkWind = variant.winds[0]?.material;
      tree.traverse((object) => {
        if (!(object instanceof Mesh)) return;
        object.castShadow = true;
        object.receiveShadow = true;
        if (object.material === barkWind) this.bark.push(object);
        else this.leaf.push(object);
        object.getWorldScale(worldScale);
        const smallest = Math.min(worldScale.x, worldScale.y, worldScale.z);
        minWorldScale.set(variant, Math.min(minWorldScale.get(variant) ?? smallest, smallest));
      });
      ctx.add(tree);
      trees.push(tree);
    }

    const padded = new Set<BufferGeometry>();
    for (const variant of variants) {
      const smallest = minWorldScale.get(variant);
      if (smallest === undefined) continue;
      for (const mesh of [...variant.bark, ...variant.leaf]) {
        if (padded.has(mesh.geometry)) continue;
        padded.add(mesh.geometry);
        for (const wind of variant.winds) wind.expandBounds(mesh.geometry, smallest);
      }
    }
    return { trees, winds, vertices };
  }
}

/** A seeded 32-bit LCG, one per use: the same build frames the same skyline and grove every run. */
function lcg(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };
}
