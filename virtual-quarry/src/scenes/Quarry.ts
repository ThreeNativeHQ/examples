import { ClusteredMesh, type ICtx, Scene, type SceneFrame } from "@threenative/core";
import { type Group, Mesh, MeshStandardMaterial, Object3D, PerspectiveCamera } from "three";
import { AmbientLight, DirectionalLight } from "three";
import type { GameState } from "../state.js";

export type GameCtx = ICtx<GameState>;

/**
 * What `scripts/make-mesh.mjs` writes. Held here rather than read from the file because the
 * assertion this scene exists to support is "the frame submits less than the body holds", and a
 * source count read back from the clustered `.glb` would be reading the answer off the payload.
 */
const SOURCE_TRIANGLES = 524_288;

/** Camera stops along the walk, in the order they are reached. */
const MARKS = [
  { label: "near", z: 2.4, frames: 90 },
  { label: "mid", z: 9, frames: 90 },
  { label: "far", z: 40, frames: 90 },
] as const;

interface IRendererInfo {
  render?: { triangles?: number };
}

export class Quarry extends Scene<GameState> {
  static override readonly initialState: GameState = {
    clustered: false,
    frame: 0,
    loaded: false,
    mark: "start",
    peakTriangles: 0,
    sourceTriangles: SOURCE_TRIANGLES,
    triangles: 0,
  };

  #body: Group | undefined;
  #triangles = 0;

  override async load(ctx: GameCtx): Promise<void> {
    const model = await ctx.assets.model<{ scene: Group }>("face.glb");
    this.#body = model.scene;
  }

  override enter(ctx: GameCtx): SceneFrame<GameState> {
    const body = this.#body;
    if (body === undefined) throw new Error("TN_QUARRY_NOT_LOADED: enter ran before load resolved.");

    ctx.scene.add(new AmbientLight(0xffffff, 0.6));
    const key = new DirectionalLight(0xffffff, 2.2);
    key.position.set(4, 6, 6);
    ctx.scene.add(key);

    // The game's own material, on the loader's geometry. Nothing in the framework decides how
    // this is shaded — the cut only decides which triangles reach it.
    body.traverse((child: Object3D) => {
      if (child instanceof Mesh)
        child.material = new MeshStandardMaterial({ color: 0x9aa4b0, roughness: 0.75 });
    });
    ctx.scene.add(body);

    let clustered = false;
    body.traverse((child: Object3D) => {
      if (child instanceof ClusteredMesh) clustered = true;
    });

    const camera = ctx.camera as PerspectiveCamera;
    camera.position.set(0, 0, MARKS[0].z);
    camera.lookAt(0, 0, 0);

    let frame = 0;
    let peak = 0;
    ctx.state.set({ clustered, loaded: true, mark: "start" });
    ctx.state.flush();

    const last = MARKS[MARKS.length - 1] as (typeof MARKS)[number];
    return (frameCtx) => {
      let elapsed = frame;
      let current = last;
      for (const mark of MARKS) {
        if (elapsed < mark.frames) {
          current = mark;
          break;
        }
        elapsed -= mark.frames;
      }
      camera.position.set(0, 0, current.z);
      camera.lookAt(0, 0, 0);
      peak = Math.max(peak, this.#triangles);
      frameCtx.state.set({
        frame,
        mark: current.label,
        peakTriangles: peak,
        triangles: this.#triangles,
      });
      // Flushed on the frame a mark is first held for a while, so a scenario asserts the
      // submission at a stop rather than whenever the store next happened to publish.
      if (elapsed === current.frames - 1) frameCtx.state.flush();
      frame += 1;
    };
  }

  /**
   * `renderer.info` holds this frame's counters only immediately after `renderer.render()`, which
   * is exactly when `Scene.render` runs. Read a step earlier and the scene reports the frame
   * before it.
   */
  override render(ctx: GameCtx): void {
    this.#triangles = (ctx.renderer.info as IRendererInfo).render?.triangles ?? 0;
  }
}
