// Generated-project source. The framework sees an Object3D that implements IComputeDriven; it
// knows nothing about motes, their count, their drift or their colour. All of that is here.
import type { IComputeDriven } from "@threenative/core";
import { AdditiveBlending, InstancedMesh, PlaneGeometry } from "three";
import { Fn, float, instanceIndex, instancedArray, positionLocal, uniform, vec3 } from "three/tsl";
import { type ComputeNode, MeshBasicNodeMaterial, type StorageBufferNode } from "three/webgpu";

const MOTE_COUNT = 2_048;
type ComputeRenderer = Parameters<IComputeDriven["process"]>[0];

function seedPositions(): Float32Array {
  const data = new Float32Array(MOTE_COUNT * 3);
  for (let index = 0; index < MOTE_COUNT; index += 1) {
    // A fixed hash, so two runs of the same build seed the same field.
    const hash = Math.sin(index * 12.9898) * 43_758.545_3;
    const a = hash - Math.floor(hash);
    const b = (Math.sin(index * 78.233) * 43_758.545_3) % 1;
    const c = (Math.sin(index * 39.425) * 43_758.545_3) % 1;
    data[index * 3] = (a - 0.5) * 22;
    data[index * 3 + 1] = Math.abs(b) * 5.5 + 0.15;
    data[index * 3 + 2] = (Math.abs(c) - 0.5) * 16 - 1;
  }
  return data;
}

/**
 * A game-owned GPU field of drifting motes, dispatched through the shared compute lifetime.
 *
 * The single pass advances every mote and wraps it, so the buffer is both read and written every
 * fixed step. `warmupNodes` puts the kernel in the startup compile window instead of paying for it
 * on the first visible frame.
 */
export class MoteField extends InstancedMesh implements IComputeDriven {
  readonly warmupNodes: readonly ComputeNode[];
  #positions: StorageBufferNode<"vec3">;
  #pass: ComputeNode;
  #time = uniform(0);
  #renderer: ComputeRenderer | undefined;
  #released = false;
  #steps = 0;

  constructor() {
    const positions = instancedArray(seedPositions(), "vec3");
    const time = uniform(0);
    const material = new MeshBasicNodeMaterial({
      blending: AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
      transparent: true,
    });
    material.positionNode = positionLocal.add(positions.element(instanceIndex));
    material.colorNode = vec3(0.42, 0.78, 0.95).mul(
      float(instanceIndex).mul(0.017).sin().mul(0.35).add(0.65),
    );

    const pass = Fn(() => {
      const current = positions.element(instanceIndex);
      const drift = float(instanceIndex).mul(0.031).add(time).sin().mul(0.0035);
      const rise = current.y.add(0.006);
      positions
        .element(instanceIndex)
        .assign(
          vec3(current.x.add(drift), rise.greaterThan(5.7).select(float(0.15), rise), current.z),
        );
    })().compute(MOTE_COUNT);

    super(new PlaneGeometry(0.035, 0.035), material, MOTE_COUNT);
    this.#positions = positions;
    this.#pass = pass;
    this.#time = time;
    this.warmupNodes = [pass];
    this.frustumCulled = false;
    this.renderOrder = 2;
    this.addEventListener("removed", this.#onRemoved);
  }

  get released(): boolean {
    return this.#released;
  }

  get steps(): number {
    return this.#steps;
  }

  debug(): Record<string, unknown> {
    return { moteCount: MOTE_COUNT, released: this.#released, steps: this.#steps };
  }

  attachRenderer(renderer: ComputeRenderer): void {
    if (this.#released) throw new Error("MoteField cannot be attached after release.");
    this.#renderer = renderer;
  }

  process(renderer = this.#renderer): void {
    if (this.#released) return;
    if (renderer === undefined) throw new Error("MoteField is not attached to a renderer.");
    this.#time.value += 1 / 60;
    renderer.compute(this.#pass);
    this.#steps += 1;
  }

  detach(): void {
    if (this.#released) return;
    this.removeEventListener("removed", this.#onRemoved);
    this.#renderer = undefined;
    this.#pass.dispose();
    this.#positions.value.dispose();
    this.geometry.dispose();
    const material = this.material;
    if (Array.isArray(material)) {
      for (const entry of material) entry.dispose();
    } else {
      material.dispose();
    }
    this.#released = true;
  }

  #onRemoved = (): void => this.detach();
}
