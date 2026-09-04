import { GroundSnap, type ICtx } from "@threenative/core";
import type { IPhysicsContext } from "@threenative/physics";
import { Box3, Group, type Material, Mesh, type Object3D, Vector3 } from "three";
import type { GameState } from "../state.js";

type GameCtx = ICtx<GameState, IPhysicsContext>;

interface IGltfLike {
  readonly scene: Object3D;
}

export interface IUnrealPropOptions {
  /** Logical asset path, as it sits under `assets/`. */
  readonly path: string;
  /** Where the prop stands, in metres. `y` is the surface its base rests on. */
  readonly position: { readonly x: number; readonly y: number; readonly z: number };
  readonly rotationY?: number;
}

/**
 * A prop imported from an Unreal `.uasset` by `asset_import_unreal`, loaded as the ordinary GLB
 * the importer wrote.
 *
 * Nothing here is Unreal-aware: the point of the proof is that once the importer has run, the
 * asset is an ordinary model on the ordinary loader. What this entity adds is measurement —
 * `debug()` publishes the facts a scenario asserts, so "the chair rendered" is a number rather
 * than a look at a screenshot.
 */
export class UnrealProp {
  readonly mesh: Group;
  readonly #snap: GroundSnap;
  readonly #surfaceY: number;
  readonly #triangles: number;
  readonly #materials: number;
  readonly #texturedMaps: number;
  readonly #height: number;

  private constructor(model: Object3D, options: IUnrealPropOptions) {
    this.mesh = new Group();
    this.mesh.add(model);
    this.mesh.position.set(options.position.x, options.position.y, options.position.z);
    this.mesh.rotation.y = options.rotationY ?? 0;
    this.mesh.updateWorldMatrix(true, true);

    let triangles = 0;
    const materials = new Set<Material>();
    const maps = new Set<unknown>();
    model.traverse((child) => {
      if (!(child instanceof Mesh)) return;
      child.castShadow = true;
      child.receiveShadow = true;
      const index = child.geometry.getIndex();
      const position = child.geometry.getAttribute("position");
      const count = index !== null ? index.count : (position?.count ?? 0);
      triangles += Math.floor(count / 3);
      for (const material of Array.isArray(child.material) ? child.material : [child.material]) {
        materials.add(material);
        // Count the texture slots the importer actually bound, not the slots glTF defines: an
        // Unreal material graph that reached none of them is the failure this measures.
        for (const slot of ["map", "normalMap", "roughnessMap", "metalnessMap", "aoMap"] as const) {
          const texture = (material as unknown as Record<string, unknown>)[slot];
          if (texture !== null && texture !== undefined) maps.add(texture);
        }
      }
    });
    this.#triangles = triangles;
    this.#materials = materials.size;
    this.#texturedMaps = maps.size;

    const bounds = new Box3().setFromObject(this.mesh);
    const size = bounds.getSize(new Vector3());
    this.#height = size.y;

    this.#surfaceY = options.position.y;
    this.#snap = new GroundSnap(this.mesh, { enabled: true });
  }

  static async load(ctx: GameCtx, options: IUnrealPropOptions): Promise<UnrealProp> {
    const gltf = await ctx.assets.model<IGltfLike>(options.path);
    return new UnrealProp(gltf.scene, options);
  }

  attach(ctx: GameCtx): void {
    ctx.add(this.mesh);
  }

  update(dt: number): void {
    this.#snap.apply(this.mesh, this.#surfaceY, dt);
  }

  debug(): Record<string, unknown> {
    return {
      groundClearance: this.#snap.clearance,
      heightMetres: this.#height,
      materialCount: this.#materials,
      texturedMaps: this.#texturedMaps,
      triangles: this.#triangles,
    };
  }

  dispose(): void {
    this.mesh.removeFromParent();
  }
}
