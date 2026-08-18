import {
  AdditiveBlending,
  CylinderGeometry,
  Mesh,
  MeshBasicMaterial,
  type Object3D,
  Quaternion,
  Vector3,
} from "three";

const UP = new Vector3(0, 1, 0);

/**
 * Bullet trails: a short bright streak from the muzzle to whatever the round reached.
 *
 * Hitscan gives you no bullet to look at, so without a trail a shot is only a sound and a
 * number — you cannot tell where a round went, whether the enemy is shooting at you, or from
 * where. The streak is a stretched cylinder rather than a `Line`, because line width is not
 * portable across renderers and a one-pixel line is invisible at 30 m.
 *
 * The pool is allocated once and reused round-robin; nothing is created while firing.
 */
export class Tracers {
  readonly #pool: {
    direction: Vector3;
    life: number;
    maxTravel: number;
    mesh: Mesh;
    travel: number;
  }[];
  #cursor = 0;
  readonly #direction = new Vector3();
  readonly #quaternion = new Quaternion();

  constructor(parent: Object3D, count = 12, colour = 0xffe6b0) {
    // Unit-length cylinder along +Y: scaling y to the shot distance stretches it end to end.
    const geometry = new CylinderGeometry(0.012, 0.012, 1, 6, 1, true);
    geometry.translate(0, 0.5, 0);
    const material = new MeshBasicMaterial({
      blending: AdditiveBlending,
      color: colour,
      depthWrite: false,
      opacity: 0.9,
      transparent: true,
    });
    this.#pool = Array.from({ length: count }, () => {
      const mesh = new Mesh(geometry, material.clone());
      // Zero-opacity pool members prewarm the WebGPU pipeline at load time.
      (mesh.material as MeshBasicMaterial).opacity = 0;
      mesh.visible = true;
      mesh.frustumCulled = false;
      parent.add(mesh);
      return { direction: new Vector3(), life: 0, maxTravel: 0, mesh, travel: 0 };
    });
  }

  /** Draw one round travelling from `from` along `direction` for `distance` metres. */
  spawn(from: Vector3, direction: Vector3, distance: number): void {
    const slot = this.#pool[this.#cursor % this.#pool.length];
    this.#cursor += 1;
    if (slot === undefined) return;
    if (distance < 0.05) return;
    this.#direction.copy(direction).normalize();
    this.#quaternion.setFromUnitVectors(UP, this.#direction);
    // A short travelling streak reads as a round leaving the barrel. Stretching
    // one cylinder all the way to the target looked like a laser and hid the
    // actual muzzle angle.
    const segmentLength = Math.min(3.2, distance);
    const lead = Math.min(0.16, Math.max(0, distance - segmentLength));
    slot.direction.copy(this.#direction);
    slot.travel = lead;
    slot.maxTravel = Math.max(lead, distance - segmentLength);
    slot.mesh.position.copy(from).addScaledVector(this.#direction, lead);
    slot.mesh.quaternion.copy(this.#quaternion);
    slot.mesh.scale.set(1, segmentLength, 1);
    (slot.mesh.material as MeshBasicMaterial).opacity = 0.9;
    slot.life = Math.min(0.11, distance / 360);
  }

  update(dt: number): void {
    for (const slot of this.#pool) {
      if (slot.life <= 0) continue;
      slot.life -= dt;
      const movement = Math.min(dt * 360, slot.maxTravel - slot.travel);
      slot.travel += movement;
      slot.mesh.position.addScaledVector(slot.direction, movement);
      (slot.mesh.material as MeshBasicMaterial).opacity = Math.min(0.9, slot.life * 14);
      if (slot.life <= 0 || slot.travel >= slot.maxTravel) {
        slot.life = 0;
        (slot.mesh.material as MeshBasicMaterial).opacity = 0;
      }
    }
  }
}
