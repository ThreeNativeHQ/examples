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
  readonly #pool: { life: number; mesh: Mesh }[];
  #cursor = 0;
  readonly #from = new Vector3();
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
      mesh.visible = false;
      mesh.frustumCulled = false;
      parent.add(mesh);
      return { life: 0, mesh };
    });
  }

  /** Draw one round travelling from `from` to `to`. */
  spawn(from: Vector3, to: Vector3): void {
    const slot = this.#pool[this.#cursor % this.#pool.length];
    this.#cursor += 1;
    if (slot === undefined) return;
    this.#from.copy(from);
    this.#direction.subVectors(to, from);
    const distance = this.#direction.length();
    if (distance < 0.05) return;
    this.#direction.divideScalar(distance);
    this.#quaternion.setFromUnitVectors(UP, this.#direction);
    slot.mesh.position.copy(this.#from);
    slot.mesh.quaternion.copy(this.#quaternion);
    slot.mesh.scale.set(1, distance, 1);
    (slot.mesh.material as MeshBasicMaterial).opacity = 0.9;
    slot.mesh.visible = true;
    slot.life = 0.055;
  }

  update(dt: number): void {
    for (const slot of this.#pool) {
      if (slot.life <= 0) continue;
      slot.life -= dt;
      (slot.mesh.material as MeshBasicMaterial).opacity = Math.max(0, slot.life * 16);
      if (slot.life <= 0) slot.mesh.visible = false;
    }
  }
}
