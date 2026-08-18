import { type ICtx, Scene, type SceneFrame } from "@threenative/core";
import { CollisionShape3D, type IPhysicsContext, RigidBody3D } from "@threenative/physics";
import type { AnimationClip, Group, Object3D, PerspectiveCamera, Texture } from "three";
import {
  AdditiveBlending,
  Mesh as MeshClass,
  MeshBasicMaterial,
  Object3D as Object3DClass,
  PlaneGeometry,
  PointLight as PointLightClass,
  Raycaster,
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
import { Tracers } from "../render/tracers.js";
import type { GameState } from "../state.js";

export type GameCtx = ICtx<GameState, IPhysicsContext>;

const RUN_SECONDS = 60;
const TARGET_GOAL = 12;
const RANGE_METRES = 60;
const ROUND_DAMAGE = 10;
/** 4x in the top 12% of a body, 0.7x below a third of it. */
const HEAD_FRACTION = 0.88;
const LEG_FRACTION = 1 / 3;

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
    setupPost(ctx.renderer, ctx.scene, camera);
    ctx.add(camera);

    const materials = createMaterials({
      surface: assets.surface,
      targetFace: assets.targetFace,
      targetHit: assets.targetHit,
    });
    const range: Range = buildRange(materials);
    ctx.add(range.group);

    // One fixed body per solid so the player slides along the yard properly.
    // `RigidBody3D` has no `position` option — unlike `Area3D` — so each static
    // body needs a carrier Object3D holding the transform.
    const staticBody = (
      centreX: number,
      centreY: number,
      centreZ: number,
      sx: number,
      sy: number,
      sz: number,
    ): void => {
      const carrier = new Object3DClass();
      carrier.position.set(centreX, centreY, centreZ);
      new RigidBody3D({
        object: carrier,
        physics: ctx.physics,
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

    const player = new FpsPlayer(ctx, camera);
    ctx.entities.add("player", player);
    const rifle = new Rifle(
      camera,
      assets.viewmodel.scene as Object3D,
      assets.viewmodel.animations,
      ctx.scene,
    );
    ctx.entities.add("rifle", rifle);

    const enemy = new Enemy(
      assets.enemy.scene as Object3D,
      assets.enemy.animations,
      range.colliders,
      assets.weapon.scene as Object3D,
    );
    ctx.add(enemy.group);
    ctx.entities.add("enemy", enemy);

    // Hitscan picks against an explicit list: the yard, the plates and the enemy
    // proxy. Raycasting the whole scene would also hit the viewmodel welded to
    // the camera and score every shot as a miss at 0.4 m.
    const hittable: Object3D[] = [...range.hittable, enemy.hitbox];
    const raycaster = new Raycaster();
    raycaster.far = RANGE_METRES;
    const losCaster = new Raycaster();
    const occluders: Object3D[] = [...range.hittable];

    const lineOfSight = (from: Vector3, to: Vector3): boolean => {
      const direction = new Vector3().subVectors(to, from);
      const distance = direction.length();
      if (distance < 0.001) return true;
      losCaster.set(from, direction.multiplyScalar(1 / distance));
      losCaster.far = distance - 0.2;
      for (const hit of losCaster.intersectObjects(occluders, false)) {
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
      opacity: 0.85,
      transparent: true,
    });
    const impacts = Array.from({ length: 8 }, () => {
      const puff = new MeshClass(new PlaneGeometry(0.26, 0.26), impactMaterial);
      puff.visible = false;
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
      slot.mesh.visible = true;
      slot.life = 0.18;
    };

    let elapsed = 0;
    let hitFlash = 0;
    const eye = new Vector3();

    const fire = (frameCtx: GameCtx): void => {
      if (!rifle.fire()) return;
      const forward = player.forward;
      eye.set(player.eye.x, player.eye.y, player.eye.z);
      raycaster.set(eye, new Vector3(forward.x, forward.y, forward.z).normalize());
      raycaster.far = RANGE_METRES;
      const hits = raycaster.intersectObjects(hittable, false);
      enemy.hearShot(eye.clone());
      const hit = hits[0];
      // The trail is drawn whether or not the round connects — a miss you cannot see is a
      // miss you cannot correct.
      const muzzle = rifle.muzzleWorld();
      const end =
        hit === undefined
          ? new Vector3().copy(eye).addScaledVector(raycaster.ray.direction, RANGE_METRES)
          : hit.point.clone();
      playerTracers.spawn(muzzle, end);
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
        const local = (hit.point.y - struck.bodyBase) / struck.bodyHeight;
        const multiplier = local >= HEAD_FRACTION ? 4 : local < LEG_FRACTION ? 0.7 : 1;
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
    const enemyFlash = new MeshClass(new PlaneGeometry(0.72, 0.72), flashMaterial);
    enemyFlash.visible = false;
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
      puff.visible = false;
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
        slot.mesh.visible = true;
        slot.life = 0.75;
      }
    };

    const hooks = {
      lineOfSight,
      damagePlayer: (amount: number): void => player.hurt(amount),
      onMuzzleFlash: (at: Vector3): void => {
        const forward = new Vector3(
          Math.sin(enemy.group.rotation.y),
          0,
          Math.cos(enemy.group.rotation.y),
        );
        enemyFlash.position.copy(at).addScaledVector(forward, 0.22);
        enemyFlash.scale.setScalar(0.85 + ctx.random() * 0.5);
        enemyFlash.rotation.z = ctx.random() * Math.PI;
        enemyFlash.visible = true;
        enemyFlashLife = 0.075;
        enemyLight.position.copy(enemyFlash.position);
        enemyLight.intensity = 26;
        enemyTracers.spawn(enemyFlash.position, new Vector3(eye.x, eye.y - 0.12, eye.z));
        spawnSmoke(enemyFlash.position, forward, ctx);
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
      if (enemyFlashLife <= 0) enemyFlash.visible = false;
      enemyLight.intensity = Math.max(0, enemyLight.intensity - dt * 260);
      for (const puff of smoke) {
        if (puff.life <= 0) continue;
        puff.life -= dt;
        puff.mesh.position.addScaledVector(puff.drift, dt);
        puff.mesh.scale.setScalar(0.35 + (0.75 - puff.life) * 1.5);
        (puff.mesh.material as MeshBasicMaterial).opacity = Math.max(0, puff.life * 0.62);
        puff.mesh.lookAt(eye.x, eye.y, eye.z);
        if (puff.life <= 0) puff.mesh.visible = false;
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
        if (slot.life <= 0) slot.mesh.visible = false;
      }
      if (enemyFlash.visible) enemyFlash.lookAt(eye.x, eye.y, eye.z);
      const timeRemaining = Math.max(0, RUN_SECONDS - elapsed);

      player.update(frameCtx, dt, !rifle.reloading);
      if (frameCtx.input.justPressed("fire")) fire(frameCtx);
      if (frameCtx.input.justPressed("reload")) rifle.reload(frameCtx);
      const moveVector = frameCtx.input.vector("move");
      rifle.update(dt, player.aiming, Math.min(1, Math.hypot(moveVector.x, moveVector.y)));

      eye.set(player.eye.x, player.eye.y, player.eye.z);
      enemy.update(frameCtx, dt, eye, hooks);

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
