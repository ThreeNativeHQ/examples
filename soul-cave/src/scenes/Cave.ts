import { type ICtx, Scene, type SceneFrame } from "@threenative/core";
import type { IPhysicsContext } from "@threenative/physics";
import {
  Box3,
  Color,
  type DirectionalLight,
  type Group,
  Mesh,
  MeshStandardMaterial,
  type PerspectiveCamera,
  Vector3,
} from "three";
import { CAVE_PIECES } from "../render/caveLayout.js";
import { setupCaveLighting } from "../render/caveLighting.js";
import { setupCavePost } from "../render/postprocessing.js";
import { createCaveShell, createRockMaterial, inheritFrom } from "../render/rockMaterial.js";
import type { GameState } from "../state.js";

export type CaveCtx = ICtx<GameState, IPhysicsContext>;

/** Eye height, in the metres the Unreal pack was authored in. */
const EYE_HEIGHT = 1.7;
const WALK_SPEED = 6;

interface ILoadedPiece {
  readonly key: string;
  readonly scene: Group;
  readonly heightMetres: number;
  readonly texturedMeshes: number;
  readonly rebuiltMeshes: number;
}

export class Cave extends Scene<GameState, IPhysicsContext> {
  #pieces: readonly ILoadedPiece[] = [];
  readonly #position = new Vector3(0, EYE_HEIGHT, 5);
  #look = 0;
  #sun: DirectionalLight | undefined;
  #floorMasks: { maskMap: Awaited<ReturnType<CaveCtx["assets"]["texture"]>>; normalMap: null } | undefined;
  #postApplied = false;

  static override readonly initialState: GameState = {
    coyoteJumps: 0,
    entityCount: 0,
    fabPiecesLoaded: 0,
    fabPiecesTextured: 0,
    flagDisplacement: 0,
    flagGusts: 0,
    flagReadbacks: 0,
    flagSteps: 0,
    jumps: 0,
    levelX: 0,
    lives: 3,
    odometer: 0,
    paused: false,
    peakRise: 0,
    playerX: 0,
    playerZ: 5,
    respawns: 0,
    score: 0,
    status: "playing",
    uiReady: false,
  };

  /**
   * The rock masks the importer refused to bind, loaded as plain textures. Unreal composed its
   * rock surface in a material graph rather than in a texture, so the scene composes it too.
   */
  static readonly #MASKS = {
    stalactite: "fab/soul-cave/textures/T_Cave_Rock_Stalactite_M.png",
    path: "fab/soul-cave/textures/T_Cave_Rock_Path_M.png",
    pillar: "fab/soul-cave/textures/T_Cave_Rock_Pillar_M.png",
  } as const;

  static #maskFor(materialName: string): keyof typeof Cave.MASK_LOOKUP {
    if (materialName.includes("Pillar")) return "pillar";
    if (materialName.includes("Path_Moss")) return "path";
    return "stalactite";
  }

  static readonly MASK_LOOKUP = Cave.#MASKS;

  override async load(ctx: CaveCtx): Promise<void> {
    const masks = Object.fromEntries(
      await Promise.all(
        Object.entries(Cave.#MASKS).map(async ([key, path]) => {
          const map = await ctx.assets.texture(path);
          map.wrapS = 1000;
          map.wrapT = 1000;
          map.flipY = false;
          return [key, map] as const;
        }),
      ),
    ) as Record<keyof typeof Cave.MASK_LOOKUP, Awaited<ReturnType<CaveCtx["assets"]["texture"]>>>;

    this.#floorMasks = { maskMap: masks.path, normalMap: null };

    this.#pieces = await Promise.all(
      CAVE_PIECES.map(async (piece) => {
        const model = await ctx.assets.model<{ scene: Group }>(piece.path);
        const root = model.scene.clone(true);
        root.name = piece.key;
        if (piece.rotationY !== undefined) root.rotation.y = piece.rotationY;
        if (piece.rotationX !== undefined) root.rotation.x = piece.rotationX;
        if (piece.rotationZ !== undefined) root.rotation.z = piece.rotationZ;
        root.updateMatrixWorld(true);
        let texturedMeshes = 0;
        let rebuiltMeshes = 0;
        root.traverse((object) => {
          if (!(object instanceof Mesh)) return;
          object.castShadow = piece.castShadow ?? true;
          object.receiveShadow = true;
          // Photoscanned rock is never shiny except where it is wet. The pack's own roughness
          // maps only cover some sections, so the rest is pinned rough rather than left at the
          // glTF default of 1.0 with a metalness that would read as plastic.
          const material = object.material;
          if (!(material instanceof MeshStandardMaterial)) return;
          if (material.map === null) {
            // No albedo survived the import: this is one of the mask-driven rock materials.
            const rebuilt = createRockMaterial({
              maskMap: masks[Cave.#maskFor(material.name)],
              normalMap: material.normalMap,
              ...(material.name.includes("Moss") ? { tint: new Color(0.86, 0.94, 0.78) } : {}),
            });
            inheritFrom(material, rebuilt);
            object.material = rebuilt;
            rebuiltMeshes += 1;
            return;
          }
          material.metalness = 0;
          if (material.roughnessMap === null) material.roughness = 0.85;
          texturedMeshes += 1;
        });
        // Placed by measurement rather than by a hand-computed offset: these pivots are wherever
        // the original Unreal level left them, and guessing one wrong buries a pillar in the floor.
        const box = new Box3().setFromObject(root);
        const size = box.getSize(new Vector3());
        const centre = box.getCenter(new Vector3());
        const anchorY =
          piece.mode === "base" ? box.min.y : piece.mode === "top" ? box.max.y : centre.y;
        root.position.set(
          piece.anchor[0] - centre.x,
          piece.anchor[1] - anchorY,
          piece.anchor[2] - centre.z,
        );
        return { key: piece.key, scene: root, heightMetres: size.y, texturedMeshes, rebuiltMeshes };
      }),
    );

    const bare = this.#pieces.filter(
      (piece) => piece.texturedMeshes === 0 && piece.rebuiltMeshes === 0,
    );
    if (bare.length > 0) {
      throw new Error(
        `Cave pieces with neither a texture nor a rebuilt surface: ${bare.map((p) => p.key).join(", ")}.`,
      );
    }
    console.info(
      `TN_CAVE_LOADED:${this.#pieces.length} pieces, ${this.#pieces.reduce((sum, p) => sum + p.texturedMeshes, 0)} textured, ${this.#pieces.reduce((sum, p) => sum + p.rebuiltMeshes, 0)} rebuilt from masks`,
    );
  }

  override enter(ctx: CaveCtx): SceneFrame<GameState, IPhysicsContext> {
    for (const piece of this.#pieces) ctx.add(piece.scene);
    if (this.#floorMasks) {
      ctx.add(
        createCaveShell({
          ...this.#floorMasks,
          sizeMetres: 88,
          heightMetres: 19,
          // Rotating the shape flat maps its local +Y to world +Z, so the room in front of the
          // camera is negative z here too. Two openings, as the reference has: the main shaft
          // ahead, and a smaller one over the left aisle that keeps that side out of pure black.
          holes: [
            { x: 2, z: -24, width: 15, depth: 11 },
            { x: -21, z: -13, width: 8, depth: 6 },
          ],
        }),
      );
    }

    const lighting = setupCaveLighting(ctx.scene, ctx.renderer.raw as Parameters<typeof setupCaveLighting>[1]);
    this.#sun = lighting.sun;
    const camera = ctx.camera as PerspectiveCamera;
    camera.fov = 68;
    camera.near = 0.1;
    camera.far = 260;
    camera.updateProjectionMatrix();
    ctx.add(camera);

    ctx.state.set({
      fabPiecesLoaded: this.#pieces.length,
      fabPiecesTextured: this.#pieces.reduce(
        (sum, piece) => sum + piece.texturedMeshes + piece.rebuiltMeshes,
        0,
      ),
    });

    return (frame, dt) => {
      // The godrays stage raymarches against the sun's shadow map, and three.js does not allocate
      // that map until the renderer has run a shadow pass. Building the chain in `enter` reads a
      // null map and throws inside the TSL graph — with the chain still reporting the stage as
      // applied. Wait for the map to exist, then build once.
      if (!this.#postApplied && this.#sun?.shadow.map != null) {
        this.#postApplied = true;
        setupCavePost(frame.renderer, frame.scene, camera, this.#sun);
      }

      const move = frame.input.vector("move");
      // Walking, not flying: the camera stays at eye height so the pillars keep their scale.
      this.#position.x += move.x * WALK_SPEED * dt;
      this.#position.z -= move.y * WALK_SPEED * dt;
      this.#position.y = EYE_HEIGHT;
      this.#look += dt * 0.06;
      camera.position.copy(this.#position);
      camera.lookAt(
        this.#position.x + Math.sin(this.#look) * 2.5,
        EYE_HEIGHT + 2.6,
        this.#position.z - 26,
      );
      frame.state.set({
        playerX: Number(this.#position.x.toFixed(3)),
        playerZ: Number(this.#position.z.toFixed(3)),
      });
    };
  }
}
