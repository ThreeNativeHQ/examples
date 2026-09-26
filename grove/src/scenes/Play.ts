import {
  Atmosphere,
  type ICtx,
  Scene,
  type SceneFrame,
  isMobile,
  solarPosition,
} from "@threenative/core";
import { CollisionShape3D, type IPhysicsContext, RigidBody3D } from "@threenative/physics";
import { BoxGeometry, Group, Mesh, type PerspectiveCamera, Vector3 } from "three";
import { setupCamera } from "../render/camera.js";
import { setupLighting } from "../render/lighting.js";
import { createLoadingScreen } from "../render/loading.js";
import { floorMaterial } from "../render/materials.js";
import { setupPost } from "../render/postprocessing.js";
import { setupSky } from "../render/sky.js";
import { barkMaterial, type TreeWind, leafMaterial, windVariant } from "../render/trees.js";
import type { GameState } from "../state.js";
import { generateTree, type TreeOptions } from "../vegetation/tree.js";

export type GameCtx = ICtx<GameState, IPhysicsContext>;

/** Four generated variants; every tree in the grove is a clone of one of them. */
const VARIANT_SEEDS = [11, 23, 37, 51] as const;
const TREE_COUNT = 22;

/**
 * A deciduous tree at grove scale, in metres. The donor's own defaults are a 20 m trunk with 20 m
 * primary branches, so only the fields that set size are touched: length, radius and leaf size.
 * Everything else — branch angle, gnarliness, taper, leaf placement — stays at the donor's values,
 * which already describe a believable broadleaf tree.
 */
function configureDeciduous(options: TreeOptions, levels: number): void {
  options.branch.levels = levels;
  options.branch.length = { 0: 5.4, 1: 4.2, 2: 2.6, 3: 1.2 };
  options.branch.radius = { 0: 0.42, 1: 0.24, 2: 0.13, 3: 0.07 };
  options.branch.children = { 0: 6, 1: 4, 2: 3 };
  options.branch.sections = { 0: 10, 1: 8, 2: 6, 3: 4 };
  options.branch.segments = { 0: 8, 1: 6, 2: 4, 3: 3 };
  options.leaves.count = 12;
  options.leaves.size = 1.15;
  options.leaves.sizeVariance = 0.6;
}

export class Play extends Scene<GameState, IPhysicsContext> {
  static override readonly initialState: GameState = {
    treeCount: 0,
    treeVertices: 0,
    windTime: 0,
    sunAzimuth: 0,
    sunElevation: 0,
    sunTransmittanceRed: 0,
  };

  private winds: TreeWind[] = [];
  private variants: ReturnType<typeof generateTree>[] = [];

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

    const ground = new Mesh(new BoxGeometry(400, 0.2, 400), floorMaterial);
    ground.position.y = -0.1;
    ground.receiveShadow = true;
    ctx.add(ground);
    new RigidBody3D({
      object: ground,
      physics: ctx.physics,
      shape: CollisionShape3D.fromMesh(ground),
      type: "fixed",
    });

    const grove = this.buildGrove(ctx);
    this.winds = grove.winds;
    this.variants = grove.variants;

    let elapsed = 0;
    const statePatch: Partial<GameState> = {
      treeCount: grove.trees.length,
      treeVertices: grove.vertices,
    };
    return (frameCtx, dt) => {
      loading.update();
      elapsed += dt;
      for (const wind of this.winds) wind.updateTime(elapsed);
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
    for (const wind of this.winds) wind.dispose();
    for (const variant of this.variants) variant.dispose();
    this.winds = [];
    this.variants = [];
  }

  /**
   * Generate the variants once, then place `TREE_COUNT` clones of them in an irregular clump. A
   * clone shares its variant's geometry and materials, so the whole grove costs four generations
   * and eight materials.
   */
  private buildGrove(ctx: GameCtx): {
    trees: Group[];
    winds: TreeWind[];
    variants: ReturnType<typeof generateTree>[];
    vertices: number;
  } {
    const variants: ReturnType<typeof generateTree>[] = [];
    const winds: TreeWind[] = [];
    let vertices = 0;
    VARIANT_SEEDS.forEach((seed, index) => {
      const variant = generateTree({
        seed,
        trunkMaterial: barkMaterial,
        leafMaterial,
        maxVertices: 120_000,
        configure: (options) => configureDeciduous(options, index % 2 === 0 ? 2 : 3),
      });
      variants.push(variant);
      vertices += variant.vertices;
      // One phase per variant, so neighbouring trees never sway in lockstep.
      winds.push(...windVariant(variant, index * 1.7));
    });

    const groveRandom = lcg(7_317_051);
    const trees: Group[] = [];
    const spacing = 5;
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
      tree.traverse((object) => {
        if (object instanceof Mesh) {
          object.castShadow = true;
          object.receiveShadow = true;
        }
      });
      ctx.add(tree);
      trees.push(tree);
    }
    return { trees, winds, variants, vertices };
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
