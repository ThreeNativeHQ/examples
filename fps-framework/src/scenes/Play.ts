import { type ICtx, Scene, type SceneFrame } from "@threenative/core";
import { CollisionShape3D, type IPhysicsContext, RigidBody3D } from "@threenative/physics";
import type { AnimationClip, Group, Object3D, PerspectiveCamera, Texture } from "three";
import {
  AdditiveBlending,
  Mesh as MeshClass,
  MeshBasicMaterial,
  PlaneGeometry,
  PointLight as PointLightClass,
  Vector3,
} from "three";
import { Enemy } from "../entities/Enemy.js";
import { FpsPlayer } from "../entities/FpsPlayer.js";
import { MAGAZINE, RESERVE, Rifle } from "../entities/Rifle.js";
import type { Target } from "../entities/Target.js";
import { setupLighting } from "../render/lighting.js";
import { createMaterials } from "../render/materials.js";
import { setupPost } from "../render/postprocessing.js";
import { buildRange, type Range } from "../render/range.js";
import { setupSky } from "../render/sky.js";
import { softCircleTexture } from "../render/particles.js";
import { scale } from "../render/scale.js";
import { Tracers } from "../render/tracers.js";
import { TARGET_GOAL, type GameState } from "../state.js";

export type GameCtx = ICtx<GameState, IPhysicsContext>;

const RUN_SECONDS = 60;
const RANGE_METRES = 60;
const ROUND_DAMAGE = 10;

type LoadedModel = { scene: Group; animations: AnimationClip[] };

export class Play extends Scene<GameState, IPhysicsContext> {
  static override readonly initialState: GameState = {
    aiming: false,
    ammo: MAGAZINE,
    distanceMoved: 0,
    health: 100,
    hitFlash: 0,
    phase: "playing",
    reloads: 0,
    reserve: RESERVE,
    score: 0,
    shots: 0,
    targetsHit: 0,
    timeRemaining: RUN_SECONDS,
  };

  #assets:
    | {
        enemy: LoadedModel;
        viewmodel: LoadedModel;
        weapon: LoadedModel;
        sky: Texture;
        surface: Texture;
        targetFace: Texture;
        targetHit: Texture;
      }
    | undefined;

  override async load(ctx: GameCtx): Promise<void> {
    const [enemy, viewmodel, weapon, sky, surface, targetFace, targetHit] = await Promise.all([
      ctx.assets.model<LoadedModel>("assets/enemy-terrorist.glb"),
      ctx.assets.model<LoadedModel>("assets/player-viewmodel.glb"),
      ctx.assets.model<LoadedModel>("assets/weapon-ak47.glb"),
      ctx.assets.texture("assets/sky.jpg"),
      ctx.assets.texture("assets/ue-test-surface.jpg"),
      ctx.assets.texture("assets/range-target-face.png"),
      ctx.assets.texture("assets/range-target-face-hit.png"),
    ]);
    this.#assets = { enemy, viewmodel, weapon, sky, surface, targetFace, targetHit };
    console.info(
      `TN_FPS_ASSETS_LOADED:enemy(${enemy.animations.length} clips),viewmodel,sky,3 textures`,
    );
  }

  override enter(ctx: GameCtx): SceneFrame<GameState, IPhysicsContext> {
    const assets = this.#assets;
    if (assets === undefined) throw new Error("Range assets did not load.");

    const camera = ctx.camera as PerspectiveCamera;
    setupSky(ctx.scene, assets.sky);
    setupLighting(ctx.scene, ctx.renderer.raw as Parameters<typeof setupLighting>[1]);
    setupPost(ctx.renderer);
    ctx.add(camera);

    const materials = createMaterials({
      surface: assets.surface,
      targetFace: assets.targetFace,
      targetHit: assets.targetHit,
    });
    const range: Range = buildRange(materials);
    ctx.add(range.group);
    range.targets.forEach((target, index) => {
      const entity = `target-${index}`;
      ctx.entities.remove(entity);
      ctx.entities.add(entity, target);
    });

    // One fixed body per solid so the player slides along the yard properly. These
    // colliders have no visual, so they take a bare `position` and never allocate a
    // carrier Object3D to hold a transform nothing reads.
    const staticBody = (
      centreX: number,
      centreY: number,
      centreZ: number,
      sx: number,
      sy: number,
      sz: number,
    ): void => {
      new RigidBody3D({
        physics: ctx.physics,
        position: { x: centreX, y: centreY, z: centreZ },
        shape: CollisionShape3D.box(sx, sy, sz),
        type: "fixed",
      });
    };
    for (const box of range.colliders) {
      staticBody(
        (box.min[0] + box.max[0]) / 2,
        (box.min[1] + box.max[1]) / 2,
        (box.min[2] + box.max[2]) / 2,
        box.max[0] - box.min[0],
        box.max[1] - box.min[1],
        box.max[2] - box.min[2],
      );
    }
    staticBody(0, -0.5, 0, 40, 1, 40);

    const playerSetup = ctx.entities.get<{
      readonly isObject3D?: boolean;
      readonly position: Vector3;
    }>("player");
    ctx.entities.remove("player");
    const player = new FpsPlayer(ctx, camera);
    if (playerSetup?.isObject3D === true && playerSetup.position.lengthSq() > 1e-6) {
      player.mesh.position.copy(playerSetup.position);
      player.body.teleport(player.mesh.position);
      player.syncCamera();
    }
    ctx.entities.add("player", player);
    const rifle = new Rifle(
      camera,
      assets.viewmodel.scene as Object3D,
      assets.viewmodel.animations,
      ctx.scene,
    );
    ctx.entities.add("rifle", rifle);

    const enemySetup = ctx.entities.get<{
      readonly isObject3D?: boolean;
      readonly position: Vector3;
    }>("enemy");
    ctx.entities.remove("enemy");
    const enemy = new Enemy(
      ctx,
      assets.enemy.scene as Object3D,
      assets.enemy.animations,
      range.colliders,
      assets.weapon.scene as Object3D,
    );
    if (enemySetup?.isObject3D === true && enemySetup.position.lengthSq() > 1e-6) {
      enemy.group.position.copy(enemySetup.position);
      enemy.group.updateWorldMatrix(true, true);
    }
    ctx.add(enemy.group);
    ctx.entities.add("enemy", enemy);

    // Hitscan picks against an explicit list: the yard, the plates and the enemy
    // proxy. Raycasting the whole scene would also hit the viewmodel welded to
    // the camera and score every shot as a miss at 0.4 m.
    const hittable: Object3D[] = [...range.hittable, enemy.hitbox];
    const occluders: Object3D[] = [...range.hittable];

    const lineOfSight = (from: Vector3, to: Vector3): boolean => {
      const direction = new Vector3().subVectors(to, from);
      const distance = direction.length();
      if (distance < 0.001) return true;
      for (const hit of ctx.raycastAll({
        direction: direction.multiplyScalar(1 / distance),
        far: distance - 0.2,
        origin: from,
        targets: occluders,
      })) {
        // Plates and the paint are thin dressing; only solids block sight.
        if (hit.object.userData.target !== undefined) continue;
        return false;
      }
      return true;
    };

    // Impact puffs: a small ring of additive quads reused round-robin, so a
    // shot that lands on concrete reads as a hit even at 30 m.
    const impactMaterial = new MeshBasicMaterial({
      blending: AdditiveBlending,
      color: 0xdfe4ea,
      depthWrite: false,
      map: softCircleTexture(64, 0.18),
      opacity: 0.85,
      transparent: true,
    });
    const impacts = Array.from({ length: 8 }, () => {
      const puff = new MeshClass(new PlaneGeometry(0.26, 0.26), impactMaterial.clone());
      (puff.material as MeshBasicMaterial).opacity = 0;
      puff.visible = true;
      ctx.add(puff);
      return { life: 0, mesh: puff };
    });
    // Player rounds trail warm white; the enemy's are red so you can tell incoming from
    // outgoing at a glance, which is the whole point of seeing a trajectory at all.
    const playerTracers = new Tracers(ctx.scene, 12, 0xffe6b0);
    const enemyTracers = new Tracers(ctx.scene, 12, 0xff6a4d);
    let impactCursor = 0;
    const spawnImpact = (at: Vector3, normal: Vector3): void => {
      const slot = impacts[impactCursor % impacts.length];
      if (slot === undefined) return;
      impactCursor += 1;
      slot.mesh.position.copy(at).addScaledVector(normal, 0.02);
      slot.mesh.lookAt(at.clone().add(normal));
      slot.mesh.scale.setScalar(0.6);
      (slot.mesh.material as MeshBasicMaterial).opacity = 0.85;
      slot.life = 0.18;
    };

    let elapsed = 0;
    let hitFlash = 0;
    const eye = new Vector3();

    const fire = (frameCtx: GameCtx, aimRay: { origin: Vector3; direction: Vector3 }): void => {
      if (!rifle.fire()) return;
      eye.copy(aimRay.origin);
      const direction = aimRay.direction.clone().normalize();
      player.recordFiringDirection(direction);
      const hit = frameCtx.raycast({
        direction,
        far: RANGE_METRES,
        origin: eye,
        targets: hittable,
      });
      enemy.hearShot(eye.clone());
      // The trail is drawn whether or not the round connects — a miss you cannot see is a
      // miss you cannot correct.
      const barrel = rifle.barrelRay();
      const distance = hit === undefined ? RANGE_METRES : hit.point.distanceTo(eye);
      playerTracers.spawn(barrel.origin, barrel.direction, distance);
      if (hit === undefined) return;

      const target = hit.object.userData.target as Target | undefined;
      if (target !== undefined) {
        if (!target.scorable) return;
        const value = target.strike(frameCtx);
        if (value > 0) {
          frameCtx.state.set((state) => ({
            score: state.score + value,
            targetsHit: state.targetsHit + 1,
          }));
          hitFlash = 0.12;
        }
        return;
      }
      spawnImpact(hit.point, hit.face?.normal ?? new Vector3(0, 1, 0));
      const struck = hit.object.userData.enemy as Enemy | undefined;
      if (struck !== undefined) {
        const multiplier =
          hit.point.y >= struck.headZoneMinY ? 4 : hit.point.y < struck.legZoneMaxY ? 0.7 : 1;
        struck.recordHit(multiplier);
        const earned = struck.hurt(frameCtx, ROUND_DAMAGE * multiplier);
        if (earned > 0) {
          frameCtx.state.set((state) => ({
            score: state.score + earned,
            targetsHit: state.targetsHit + 1,
          }));
          hitFlash = 0.12;
        }
      }
    };

    // A muzzle flash is three things at once: a bright card, a light that touches the world,
    // and smoke that outlives both. One card alone reads as a decal pasted on the scene.
    const flashSprite = softCircleTexture(64, 0.45);
    const smokeSprite = softCircleTexture(64, 0.05);
    const flashMaterial = new MeshBasicMaterial({
      blending: AdditiveBlending,
      color: 0xffd79a,
      depthWrite: false,
      map: flashSprite,
      transparent: true,
    });
    const enemyFlash = new MeshClass(
      new PlaneGeometry(scale.muzzleFlash, scale.muzzleFlash),
      flashMaterial,
    );
    enemyFlash.name = "muzzle-flash";
    // Same prewarm as the tracers and the impact puffs: in the scene from the first frame,
    // driven by opacity. Toggling `visible` rebuilds the pipeline on the first shot.
    flashMaterial.opacity = 0;
    enemyFlash.visible = true;
    ctx.add(enemyFlash);
    let enemyFlashLife = 0;

    // The light is what makes it read at 30 m: it puts a warm kick on the soldier and the
    // concrete for two frames, which no additive quad can do on its own.
    // Always in the scene, intensity driven to zero — see the note in Rifle: toggling a
    // light's visibility rebuilds pipelines and stalls the frame.
    const enemyLight = new PointLightClass(0xffc46a, 0, 9, 2);
    ctx.add(enemyLight);

    const smokeMaterial = new MeshBasicMaterial({
      color: 0xb9bec6,
      depthWrite: false,
      map: smokeSprite,
      opacity: 0.5,
      transparent: true,
    });
    const smoke = Array.from({ length: 10 }, () => {
      const puff = new MeshClass(new PlaneGeometry(0.4, 0.4), smokeMaterial.clone());
      (puff.material as MeshBasicMaterial).opacity = 0;
      puff.visible = true;
      ctx.add(puff);
      return { life: 0, drift: new Vector3(), mesh: puff };
    });
    let smokeCursor = 0;
    const spawnSmoke = (at: Vector3, forward: Vector3, ctxFrame: GameCtx): void => {
      for (let index = 0; index < 2; index += 1) {
        const slot = smoke[smokeCursor % smoke.length];
        smokeCursor += 1;
        if (slot === undefined) continue;
        slot.mesh.position.copy(at).addScaledVector(forward, 0.3 + index * 0.16);
        slot.drift.set(
          (ctxFrame.random() - 0.5) * 0.5,
          0.55 + ctxFrame.random() * 0.35,
          (ctxFrame.random() - 0.5) * 0.5,
        );
        slot.mesh.scale.setScalar(0.35);
        (slot.mesh.material as MeshBasicMaterial).opacity = 0.5;
        slot.life = 0.75;
      }
    };

    const hooks = {
      lineOfSight,
      damagePlayer: (amount: number): void => player.hurt(amount),
      onMuzzleFlash: (at: Vector3, direction: Vector3, distance: number): void => {
        enemyFlash.position.copy(at).addScaledVector(direction, 0.22);
        enemyFlash.scale.setScalar(0.85 + ctx.random() * 0.5);
        enemyFlash.rotation.z = ctx.random() * Math.PI;
        flashMaterial.opacity = 1;
        enemyFlashLife = 0.075;
        enemyLight.position.copy(enemyFlash.position);
        enemyLight.intensity = 26;
        enemyTracers.spawn(enemyFlash.position, direction, distance);
        spawnSmoke(enemyFlash.position, direction, ctx);
      },
    };

    return (frameCtx, dt) => {
      if (frameCtx.input.justPressed("restart")) {
        frameCtx.state.set(Play.initialState);
        frameCtx.state.flush();
        void frameCtx.goto("play");
        return;
      }

      // The muzzle flash decays outside the phase gate: an early return with the
      // quad still visible leaves it frozen in the world behind the end screen.
      enemyFlashLife = Math.max(0, enemyFlashLife - dt);
      if (enemyFlashLife <= 0) flashMaterial.opacity = 0;
      enemyLight.intensity = Math.max(0, enemyLight.intensity - dt * 260);
      for (const puff of smoke) {
        if (puff.life <= 0) continue;
        puff.life -= dt;
        puff.mesh.position.addScaledVector(puff.drift, dt);
        puff.mesh.scale.setScalar(0.35 + (0.75 - puff.life) * 1.5);
        (puff.mesh.material as MeshBasicMaterial).opacity = Math.max(0, puff.life * 0.62);
        puff.mesh.lookAt(eye.x, eye.y, eye.z);
        if (puff.life <= 0) (puff.mesh.material as MeshBasicMaterial).opacity = 0;
      }
      rifle.updateSmoke(dt, eye);
      playerTracers.update(dt);
      enemyTracers.update(dt);

      const state = frameCtx.state.getState();
      if (state.phase !== "playing") {
        // The run is over: hold the frame, keep looking around, wait for Enter.
        player.update(frameCtx, dt, false);
        return;
      }

      elapsed += dt;
      hitFlash = Math.max(0, hitFlash - dt * 2.4);
      for (const slot of impacts) {
        if (slot.life <= 0) continue;
        slot.life -= dt;
        slot.mesh.scale.setScalar(0.6 + (0.18 - slot.life) * 4);
        (slot.mesh.material as MeshBasicMaterial).opacity = Math.max(0, slot.life * 4.7);
        if (slot.life <= 0) (slot.mesh.material as MeshBasicMaterial).opacity = 0;
      }
      if (enemyFlashLife > 0) enemyFlash.lookAt(eye.x, eye.y, eye.z);
      const timeRemaining = Math.max(0, RUN_SECONDS - elapsed);

      // Any press on the surface buys the pointer, which is what makes the mouse steer.
      // This is deliberately not folded into the `fire` branch: gating it on the fire action
      // means the view stays stuck until you take a shot, and aiming or simply clicking to
      // start would leave the camera dead. Keyboard shots never reach here, so the playtests
      // never ask for a lock they did not earn.
      const pointer = frameCtx.input.raw.pointer;
      if (pointer.down && !pointer.captured) frameCtx.input.captureMouse();

      player.update(frameCtx, dt, !rifle.reloading);
      const moveVector = frameCtx.input.vector("move");
      const aimRay = player.aimRay();
      rifle.converge(aimRay.origin, aimRay.direction);
      rifle.update(dt, player.aiming, Math.min(1, Math.hypot(moveVector.x, moveVector.y)));
      if (frameCtx.input.justPressed("fire")) fire(frameCtx, aimRay);
      if (frameCtx.input.justPressed("reload")) rifle.reload(frameCtx);

      eye.set(player.eye.x, player.eye.y, player.eye.z);
      enemy.update(frameCtx, dt, eye, 0, hooks);

      const hitCount = frameCtx.state.getState().targetsHit;
      let phase: GameState["phase"] = "playing";
      if (hitCount >= TARGET_GOAL) phase = "complete";
      else if (player.health <= 0 || timeRemaining <= 0) phase = "failed";

      frameCtx.state.set({
        aiming: player.aiming,
        ammo: rifle.ammo,
        distanceMoved: player.distanceMoved,
        health: player.health,
        hitFlash,
        phase,
        reloads: rifle.reloads,
        reserve: rifle.reserve,
        shots: rifle.shots,
        timeRemaining,
      });
      if (phase !== "playing") frameCtx.state.flush();
    };
  }
}
