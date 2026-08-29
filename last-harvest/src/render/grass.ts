import { GPUReadback, type IComputeDriven } from "@threenative/core";
import { Mesh, PlaneGeometry } from "three";
import {
  Fn,
  If,
  atomicAdd,
  atomicLoad,
  atomicStore,
  color,
  float,
  instanceIndex,
  instancedArray,
  mix,
  positionLocal,
  storage,
  uint,
  uniform,
  vec3,
} from "three/tsl";
import {
  type ComputeNode,
  IndirectStorageBufferAttribute,
  MeshBasicNodeMaterial,
  type StorageBufferNode,
} from "three/webgpu";

type ComputeRenderer = Parameters<IComputeDriven["process"]>[0];

/**
 * Every number, shape and colour below is this game's.
 *
 * The framework contributes no grass vocabulary at all. It sees an `Object3D` that implements
 * `IComputeDriven`, plus a `GPUReadback` for the survivor count. The candidate grid, the hash that
 * places a blade, the acceptance rule, the blade geometry, its material and its palette are all
 * here, and a different game would write completely different ones against the same seam.
 */
export const FIELD = {
  /** 1024 × 1024 — the count the PRD names, and the count the proof reads back. */
  candidates: 1_024 * 1_024,
  gridSide: 1_024,
  /** Metres across; blade spacing falls out of this and the grid. */
  size: 120,
  /** Blades within this radius of the harvester are cut, permanently. */
  harvestRadius: 4.6,
  /** Blades further than this from the harvester are not drawn at all. */
  drawDistance: 30,
  bladeWidth: 0.11,
  bladeHeight: 0.85,
} as const;

const BLADE_ROOT = 0x24571c;
const BLADE_TIP = 0xa6d95e;

/** Vertices in one blade, which is what the indirect draw's index count has to agree with. */
const BLADE_INDEX_COUNT = 12;

/**
 * A million candidate blades, culled and compacted on the GPU, drawn from a count the GPU wrote.
 *
 * The CPU never touches a blade. It writes two uniforms — where the harvester is — and reads one
 * float back every few frames for the HUD. Everything else lives in GPU memory: which blades are
 * cut, which survived this frame, and how many there were.
 */
export class GrassField extends Mesh implements IComputeDriven {
  readonly warmupNodes: readonly ComputeNode[];
  readonly survivors: GPUReadback;
  /** Candidate records the CPU wrote this frame. Stays zero, and the proof asserts that. */
  cpuCandidateWrites = 0;
  #harvesterX = uniform(0);
  #harvesterZ = uniform(0);
  #cut: StorageBufferNode<"uint">;
  #visible: StorageBufferNode<"uint">;
  #countView: StorageBufferNode<"float">;
  #counters: StorageBufferNode<"uint">;
  #indirect: IndirectStorageBufferAttribute;
  #reset: ComputeNode;
  #cull: ComputeNode;
  #report: ComputeNode;
  #renderer: ComputeRenderer | undefined;
  #released = false;
  #resetDispatches = 0;
  #cullDispatches = 0;

  constructor() {
    const count = FIELD.candidates;
    const cut = instancedArray(count, "uint") as StorageBufferNode<"uint">;
    const visible = instancedArray(count, "uint") as StorageBufferNode<"uint">;
    const countView = instancedArray(2, "float") as StorageBufferNode<"float">;
    // A second atomic counter, for the blades this harvester has cut in total.
    //
    // The drawn survivor count is nearly constant however far the harvester drives: the cull circle
    // is a fixed radius, so it leaves cut grass behind and takes in fresh grass at the same rate.
    // It is the right number to *draw* with and a useless number to *play* with. This one only
    // ever goes up, and only because the player drove somewhere.
    const counters = (instancedArray(1, "uint") as StorageBufferNode<"uint">).toAtomic();

    // (indexCount, instanceCount, firstIndex, baseVertex, firstInstance). The second field is the
    // one the compute pass writes and the draw obeys — the whole point of the exercise.
    const indirect = new IndirectStorageBufferAttribute(
      new Uint32Array([BLADE_INDEX_COUNT, 0, 0, 0, 0]),
      5,
    );
    const indirectStorage = storage(indirect, "uint", 5).setPBO(true).toAtomic();

    const geometry = new PlaneGeometry(FIELD.bladeWidth, FIELD.bladeHeight, 1, 2);
    geometry.translate(0, FIELD.bladeHeight / 2, 0);
    geometry.setIndirect(indirect);

    const harvesterX = uniform(0);
    const harvesterZ = uniform(0);
    const gridSide = float(FIELD.gridSide);
    const spacing = float(FIELD.size / FIELD.gridSide);
    const half = float(FIELD.size / 2);

    /** Where candidate `index` sits, jittered off the lattice so the field is not a grid. */
    const candidatePosition = (index: ReturnType<typeof float>) => {
      const column = index.mod(gridSide);
      const row = index.div(gridSide).floor();
      const jitterX = column.mul(12.9898).add(row.mul(78.233)).sin().mul(43_758.5453).fract();
      const jitterZ = column.mul(39.3467).add(row.mul(11.135)).sin().mul(24_634.6345).fract();
      return {
        x: column.mul(spacing).sub(half).add(jitterX.sub(0.5).mul(spacing)),
        z: row.mul(spacing).sub(half).add(jitterZ.sub(0.5).mul(spacing)),
      };
    };

    // Pass 1: one thread clears the survivor count. A separate pass because every thread of the
    // next one adds to it, and a counter reset inside that pass would race with the additions.
    const reset = Fn(() => {
      // `atomicStore`, not `.assign()`. An atomic buffer element is `atomic<u32>` in WGSL and a
      // plain assignment fails to compile with "cannot assign 'u32' to 'atomic<u32>'" — at
      // pipeline-creation time, in the browser, long after everything on the CPU typechecked.
      atomicStore(indirectStorage.element(uint(1)), uint(0));
      atomicStore(counters.element(uint(0)), uint(0));
    })().compute(1);

    // Pass 2: a million threads. Each decides whether its own blade survives and, if it does,
    // claims the next slot in the compacted list with one atomic add. No CPU loop, no visibility
    // list, no matrix upload — the draw count comes out of this and nothing else.
    const cull = Fn(() => {
      const index = float(instanceIndex);
      const place = candidatePosition(index);
      const dx = place.x.sub(harvesterX);
      const dz = place.z.sub(harvesterZ);
      const distance = dx.mul(dx).add(dz.mul(dz)).sqrt();

      // Cutting is permanent: the harvester leaves a swathe behind it, and the swathe is state
      // that lives only in GPU memory.
      If(distance.lessThan(float(FIELD.harvestRadius)), () => {
        cut.element(instanceIndex).assign(uint(1));
      });

      const standing = cut.element(instanceIndex).equal(uint(0));
      If(standing.not(), () => {
        atomicAdd(counters.element(uint(0)), uint(1));
      });
      If(standing.and(distance.lessThan(float(FIELD.drawDistance))), () => {
        const slot = atomicAdd(indirectStorage.element(uint(1)), uint(1));
        visible.element(slot).assign(instanceIndex);
      });
    })().compute(count);

    // Pass 3: copy the count somewhere a float readback can reach it. The draw does not need this;
    // the HUD and the win condition do.
    const report = Fn(() => {
      countView.element(uint(0)).assign(float(atomicLoad(indirectStorage.element(uint(1)))));
      countView.element(uint(1)).assign(float(atomicLoad(counters.element(uint(0)))));
    })().compute(1);

    const material = new MeshBasicNodeMaterial({ toneMapped: false });
    const candidate = float(visible.element(instanceIndex));
    const place = candidatePosition(candidate);
    // Blades lean by their own hash, so the field has some disorder in it.
    const lean = candidate.mul(7.13).sin().mul(0.18);
    const sway = positionLocal.y.div(float(FIELD.bladeHeight));
    material.positionNode = positionLocal.add(
      vec3(place.x.add(lean.mul(sway)), float(0), place.z.add(lean.mul(sway).mul(0.6))),
    );
    material.colorNode = mix(color(BLADE_ROOT), color(BLADE_TIP), sway);

    super(geometry, material);
    this.#harvesterX = harvesterX;
    this.#harvesterZ = harvesterZ;
    this.#cut = cut;
    this.#visible = visible;
    this.#countView = countView;
    this.#counters = counters;
    this.#indirect = indirect;
    this.#reset = reset;
    this.#cull = cull;
    this.#report = report;
    this.warmupNodes = [reset, cull, report];
    this.survivors = new GPUReadback({ attribute: countView.value, everyFrames: 2 });
    this.frustumCulled = false;
    this.addEventListener("removed", this.#onRemoved);
  }

  get released(): boolean {
    return this.#released;
  }

  get resetDispatches(): number {
    return this.#resetDispatches;
  }

  get cullDispatches(): number {
    return this.#cullDispatches;
  }

  /** True when the geometry still carries the indirect buffer the compute pass writes. */
  get indirectBound(): boolean {
    return this.geometry.indirect === this.#indirect;
  }

  /** Blades drawn this frame, as the GPU counted them, or `undefined` before the first copy. */
  get standing(): number | undefined {
    return this.survivors.sample?.data[0];
  }

  /** Blades cut so far, as the GPU counted them. The only number that says what the player did. */
  get cutTotal(): number | undefined {
    return this.survivors.sample?.data[1];
  }

  /** What the shader's uniform actually holds, to tell "not moving" from "not arriving". */
  get harvesterUniform(): { x: number; z: number } {
    return { x: this.#harvesterX.value as number, z: this.#harvesterZ.value as number };
  }

  moveHarvester(x: number, z: number): void {
    this.#harvesterX.value = x;
    this.#harvesterZ.value = z;
  }

  attachRenderer(renderer: ComputeRenderer): void {
    if (this.#released) throw new Error("GrassField cannot be attached after release.");
    this.#renderer = renderer;
  }

  process(renderer = this.#renderer): void {
    if (this.#released) return;
    if (renderer === undefined) throw new Error("GrassField is not attached to a renderer.");
    // Reset strictly before the cull: the order is the contract, not an implementation detail.
    renderer.compute(this.#reset);
    this.#resetDispatches += 1;
    renderer.compute(this.#cull);
    this.#cullDispatches += 1;
    renderer.compute(this.#report);
    this.survivors.request(renderer);
  }

  detach(): void {
    if (this.#released) return;
    this.removeEventListener("removed", this.#onRemoved);
    this.#renderer = undefined;
    this.#reset.dispose();
    this.#cull.dispose();
    this.#report.dispose();
    this.#cut.value.dispose();
    this.#visible.value.dispose();
    this.#countView.value.dispose();
    this.#counters.value.dispose();
    this.survivors.dispose();
    this.geometry.dispose();
    const material = this.material;
    if (Array.isArray(material)) for (const entry of material) entry.dispose();
    else material.dispose();
    this.#released = true;
  }

  #onRemoved = (): void => this.detach();
}
