import { prewarm, type ICtx } from "@threenative/core";
import { CharacterBody3D, CollisionShape3D, type IPhysicsContext } from "@threenative/physics";
import { BoxGeometry, ConeGeometry, CylinderGeometry, Group, MathUtils, Mesh, MeshStandardMaterial, PlaneGeometry, SphereGeometry, Vector3, type BufferGeometry } from "three";
import type { GameState } from "../state.js";
type GameCtx = ICtx<GameState, IPhysicsContext>;
const START = new Vector3(0, 0.78, 18), FORWARD = new Vector3(), UP = new Vector3(0, 1, 0);
const wood = new MeshStandardMaterial({ color: 0x6a351d, roughness: 0.82 });
const dark = new MeshStandardMaterial({ color: 0x25130d, roughness: 0.92 });
const sail = new MeshStandardMaterial({ color: 0xffedc4, roughness: 0.95, side: 2 });
const red = new MeshStandardMaterial({ color: 0xb7272f, roughness: 0.75 });
function addPart(g: BufferGeometry, m: MeshStandardMaterial, root: Group) { const mesh = new Mesh(g, m); mesh.castShadow = true; root.add(mesh); return mesh; }
function createShip() {
  const root = new Group();
  const hull = addPart(new BoxGeometry(1.8, 0.65, 4), wood, root); hull.scale.z = 0.82;
  const bow = addPart(new ConeGeometry(0.92, 1.7, 4), wood, root); bow.rotation.set(Math.PI / 2, 0, Math.PI / 4); bow.position.z = -2.05;
  const deck = addPart(new BoxGeometry(1.55, 0.14, 3.15), dark, root); deck.position.y = 0.4;
  const cabin = addPart(new BoxGeometry(1.35, 0.72, 1.05), wood, root); cabin.position.set(0, 0.78, 1.05);
  const mast = addPart(new CylinderGeometry(0.07, 0.09, 4.2, 10), dark, root); mast.position.set(0, 2.25, -0.15);
  const cloth = addPart(new PlaneGeometry(2.25, 2.25), sail, root); cloth.position.set(0, 2.65, -0.08); cloth.rotation.y = Math.PI;
  const stripe = addPart(new BoxGeometry(2.28, 0.28, 0.04), red, root); stripe.position.set(0, 2.65, -0.105);
  const flag = addPart(new PlaneGeometry(0.9, 0.48), red, root); flag.position.set(0.48, 4.05, -0.05);
  root.scale.setScalar(0.8); return root;
}
type Foam = { mesh: Mesh; age: number; velocity: Vector3 };
export class Player {
  readonly mesh = createShip(); readonly body: CharacterBody3D; readonly foam: Foam[] = [];
  speed = 0; distanceTravelled = 0; #cursor = 0; #previous = START.clone();
  constructor(ctx: GameCtx) {
    this.mesh.position.copy(START); ctx.add(this.mesh);
    this.body = new CharacterBody3D({ object: this.mesh, physics: ctx.physics, shape: CollisionShape3D.box(0.8, 0.55, 1.7) });
    for (let i = 0; i < 28; i += 1) {
      const material = new MeshStandardMaterial({ color: 0xe9ffff, emissive: 0x8bcbd1, emissiveIntensity: 0.28, transparent: true, opacity: 0, depthWrite: false });
      const mesh = new Mesh(i % 4 === 0 ? new SphereGeometry(0.11, 7, 5) : new PlaneGeometry(0.34, 0.16), material);
      mesh.rotation.x = -Math.PI / 2; mesh.position.set(0, 0.05, 30); ctx.add(mesh); this.foam.push({ mesh, age: 99, velocity: new Vector3() });
    }
    prewarm(this.foam.map((drop) => drop.mesh));
  }
  update(ctx: GameCtx, dt: number, elapsed: number) {
    const move = ctx.input.vector("move"); this.speed = MathUtils.clamp(this.speed + move.y * 8 * dt, -2.2, 7.5); this.speed *= Math.pow(0.985, dt * 60);
    this.mesh.rotation.y += -move.x * (0.75 + Math.abs(this.speed) * 0.06) * dt;
    FORWARD.set(-Math.sin(this.mesh.rotation.y), 0, -Math.cos(this.mesh.rotation.y)); this.body.velocity.set(FORWARD.x * this.speed, 0, FORWARD.z * this.speed); this.body.moveAndSlide(dt);
    this.mesh.position.x = MathUtils.clamp(this.mesh.position.x, -30, 30); this.mesh.position.z = Math.max(this.mesh.position.z, -17.2 - Math.abs(this.mesh.position.x) * 0.08);
    this.mesh.position.y = 0.8 + Math.sin(this.mesh.position.x * 0.32 + elapsed * 1.8) * 0.11 + Math.cos(this.mesh.position.z * 0.22 - elapsed * 1.25) * 0.08;
    this.mesh.rotation.z = Math.sin(elapsed * 1.65) * 0.035; this.mesh.rotation.x = Math.cos(elapsed * 1.35) * 0.025;
    this.distanceTravelled += this.mesh.position.distanceTo(this.#previous); this.#previous.copy(this.mesh.position);
    if (Math.abs(this.speed) > 0.7) { this.#emit(elapsed, false); if (Math.abs(this.speed) > 4.2) this.#emit(elapsed, true); }
    for (const drop of this.foam) { drop.age += dt; drop.mesh.position.addScaledVector(drop.velocity, dt); drop.mesh.scale.setScalar(1 + drop.age * 1.7); (drop.mesh.material as MeshStandardMaterial).opacity = Math.max(0, 0.82 - drop.age * 0.72); }
  }
  #emit(elapsed: number, spray: boolean) { const drop = this.foam[this.#cursor++ % this.foam.length]!; const side = Math.sin(elapsed * 19 + this.#cursor) * 0.72; const local = new Vector3(side, spray ? 0.48 : 0.06, spray ? -1.75 : 1.65).applyAxisAngle(UP, this.mesh.rotation.y); drop.mesh.position.copy(this.mesh.position).add(local); drop.velocity.set(side * 0.18, spray ? 1.25 : 0, 0).applyAxisAngle(UP, this.mesh.rotation.y); drop.age = 0; }
  debug() { return { distanceTravelled: this.distanceTravelled, position: this.mesh.position.toArray(), rotation: [this.mesh.rotation.x, this.mesh.rotation.y, this.mesh.rotation.z], speed: this.speed, wakeActive: this.foam.filter((d) => d.age < 1).length }; }
  dispose() { this.body.dispose(); this.mesh.removeFromParent(); for (const d of this.foam) { d.mesh.geometry.dispose(); (d.mesh.material as MeshStandardMaterial).dispose(); d.mesh.removeFromParent(); } }
}
