import { Atmosphere, type ICtx, Scene, type SceneFrame, solarPosition } from "@threenative/core";
import { Area3D, CollisionShape3D, type IPhysicsContext, RigidBody3D } from "@threenative/physics";
import { BoxGeometry, ConeGeometry, CylinderGeometry, Group, IcosahedronGeometry, MathUtils, Mesh, MeshStandardMaterial, PlaneGeometry, type PerspectiveCamera, Vector3 } from "three";
import { Player } from "../entities/Player.js";
import { setupCamera } from "../render/camera.js";
import { createHud } from "../render/hud.js";
import { setupLighting } from "../render/lighting.js";
import { setupPost } from "../render/postprocessing.js";
import { setupSky } from "../render/sky.js";
import type { GameState } from "../state.js";
export type GameCtx = ICtx<GameState, IPhysicsContext>;
const TREASURE = new Vector3(0, 0.8, -15.6), UP = new Vector3(0, 1, 0);

function addIsland(ctx: GameCtx) {
  const island = new Group(), sand = new MeshStandardMaterial({ color: 0xe8bd68, roughness: 0.96 }), stone = new MeshStandardMaterial({ color: 0x596d62, roughness: 0.94 }), leaf = new MeshStandardMaterial({ color: 0x1d7b4d, roughness: 0.9 }), trunk = new MeshStandardMaterial({ color: 0x6f4024, roughness: 0.9 });
  const beach = new Mesh(new CylinderGeometry(16, 21, 3.2, 48), sand); beach.position.set(0, -0.75, -29); beach.scale.z = 0.72; beach.receiveShadow = true; island.add(beach);
  for (let i = 0; i < 13; i += 1) { const a = (i / 13) * Math.PI * 2, rock = new Mesh(new IcosahedronGeometry(1.2 + (i % 3) * 0.4, 1), stone); rock.position.set(Math.sin(a) * (11 + i % 2 * 2), 0.5, -28 + Math.cos(a) * 7); rock.scale.y = 0.7; rock.castShadow = true; island.add(rock); }
  for (const x of [-8, -3, 5, 9]) { const palm = new Group(), stem = new Mesh(new CylinderGeometry(0.22, 0.38, 5.2, 9), trunk); stem.position.y = 2.6; palm.add(stem); for (let i = 0; i < 6; i += 1) { const frond = new Mesh(new ConeGeometry(0.7, 4, 5), leaf); frond.scale.set(0.38, 1, 0.18); frond.position.y = 5.15; frond.rotation.set(0, i / 6 * Math.PI * 2, Math.PI / 2.5); palm.add(frond); } palm.position.set(x, 1, -27 - Math.abs(x) * 0.08); island.add(palm); }
  ctx.add(island);
}
function createTreasure(ctx: GameCtx) {
  const root = new Group(); root.position.copy(TREASURE);
  const gold = new MeshStandardMaterial({ color: 0xffc928, emissive: 0x8b4d00, emissiveIntensity: 0.5, metalness: 0.75, roughness: 0.28 });
  const chest = new Mesh(new BoxGeometry(1.5, 0.8, 1), new MeshStandardMaterial({ color: 0x6e351e, roughness: 0.85 })); chest.position.y = 0.2; root.add(chest);
  const lid = new Mesh(new CylinderGeometry(0.5, 0.5, 1.5, 16, 1, false, 0, Math.PI), gold); lid.rotation.set(0, Math.PI / 2, Math.PI / 2); lid.position.y = 0.62; root.add(lid);
  for (let i = 0; i < 9; i += 1) { const coin = new Mesh(new CylinderGeometry(0.13, 0.13, 0.06, 12), gold); coin.position.set((i % 3 - 1) * 0.28, 0.85 + Math.floor(i / 3) * 0.09, i % 2 * 0.18); root.add(coin); }
  const beam = new Mesh(new CylinderGeometry(0.07, 0.5, 7, 12, 1, true), new MeshStandardMaterial({ color: 0xffd55f, emissive: 0xffaf24, emissiveIntensity: 1.5, transparent: true, opacity: 0.32, depthWrite: false })); beam.position.y = 3.8; root.add(beam); ctx.add(root); return root;
}
function createOcean(ctx: GameCtx) {
  const geometry = new PlaneGeometry(120, 120, 64, 64); geometry.rotateX(-Math.PI / 2); const base = new Float32Array(geometry.attributes.position!.array);
  const mesh = new Mesh(geometry, new MeshStandardMaterial({ color: 0x0788a9, roughness: 0.26, metalness: 0.12, transparent: true, opacity: 0.94 })); mesh.position.z = -7; mesh.receiveShadow = true; ctx.add(mesh);
  return { update(time: number) { const p = geometry.attributes.position!; for (let i = 0; i < p.count; i += 1) p.setY(i, Math.sin(base[i * 3]! * 0.3 + time * 1.8) * 0.11 + Math.cos((base[i * 3 + 2]! - 7) * 0.22 - time * 1.25) * 0.08); p.needsUpdate = true; geometry.computeVertexNormals(); } };
}
export class Play extends Scene<GameState, IPhysicsContext> {
  static override readonly initialState: GameState = { playerX: 0, playerZ: 18, speed: 0, treasure: 0, objectiveDistance: 34 };
  override enter(ctx: GameCtx): SceneFrame<GameState, IPhysicsContext> {
    const atmosphere = ctx.renderer.kind === "webgpu" ? new Atmosphere({ rayleigh: [0.005802, 0.013558, 0.0331], mie: [0.004, 0.004, 0.004], ozone: [0.00065, 0.001881, 0.000085], planetRadius: 6360, atmosphereRadius: 6460, resolutions: { transmittance: { width: 128, height: 32 }, multiScattering: { width: 16, height: 16 }, skyView: { width: 128, height: 72 } } }) : undefined;
    const sun = solarPosition({ dayOfYear: 210, timeOfDay: 17.2, latitude: 18, longitude: -64, utcOffset: -4 }); atmosphere?.setSunDirection(sun); if (atmosphere) { ctx.add(atmosphere); atmosphere.attachRenderer(ctx.renderer); }
    setupSky(ctx.scene, atmosphere); const lighting = setupLighting(ctx.scene, ctx.renderer.raw as Parameters<typeof setupLighting>[1], atmosphere); if (atmosphere) lighting.updateSun(atmosphere.getSunDirection()); setupPost(ctx.renderer, ctx.scene, ctx.camera, atmosphere); setupCamera(ctx.camera as PerspectiveCamera); ctx.add(ctx.camera);
    const ocean = createOcean(ctx); addIsland(ctx); const player = ctx.entities.add("player", new Player(ctx)); const treasureView = createTreasure(ctx);
    const treasureEntity = ctx.entities.add("treasure", { collected: false, position: TREASURE.toArray(), debug() { return { collected: this.collected, position: this.position }; }, dispose() {} });
    const hud = ctx.entities.add("hud", createHud(ctx.camera as PerspectiveCamera, "TREASURE", "RANGE"));
    const floor = new Mesh(new BoxGeometry(120, 0.2, 120), new MeshStandardMaterial({ transparent: true, opacity: 0, depthWrite: false })); floor.position.set(0, -0.25, -7); ctx.add(floor); new RigidBody3D({ object: floor, physics: ctx.physics, shape: CollisionShape3D.fromMesh(floor), type: "fixed" });
    const pickup = new Area3D({ physics: ctx.physics, position: TREASURE, shape: CollisionShape3D.box(2.2, 2, 2.2) }); pickup.on("bodyEntered", (body) => { if (body !== player.body || treasureEntity.collected) return; treasureEntity.collected = true; treasureView.scale.setScalar(0.001); ctx.state.set({ treasure: 1, objectiveDistance: 0 }); ctx.state.flush(); });
    const camera = ctx.camera as PerspectiveCamera, desired = new Vector3(), lookAt = new Vector3(); let elapsed = 0;
    return (frameCtx, dt) => { elapsed += dt; ocean.update(elapsed); player.update(frameCtx, dt, elapsed); treasureView.rotation.y += dt * 0.42; desired.set(0, 7.2, 12).applyAxisAngle(UP, player.mesh.rotation.y).add(player.mesh.position); camera.position.lerp(desired, 1 - Math.pow(0.001, dt)); lookAt.copy(player.mesh.position).add(new Vector3(0, 1.2, -5).applyAxisAngle(UP, player.mesh.rotation.y)); camera.lookAt(lookAt); const distance = player.mesh.position.distanceTo(TREASURE), state = frameCtx.state.getState(); hud.update({ primary: state.treasure, counter: distance, seconds: elapsed }); frameCtx.state.set({ playerX: player.mesh.position.x, playerZ: player.mesh.position.z, speed: player.speed, objectiveDistance: state.treasure ? 0 : Math.round(distance) }); };
  }
}
