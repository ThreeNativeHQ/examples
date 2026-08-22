import { type ICtx, Scene, type SceneFrame } from "@threenative/core";
import { CollisionShape3D, type IPhysicsContext, RigidBody3D } from "@threenative/physics";
import type {
  AnimationClip,
  Group,
  Intersection,
  Material,
  Object3D,
  PerspectiveCamera,
  Quaternion,
  Texture,
} from "three";
import {
  AdditiveBlending,
  MathUtils,
  Mesh as MeshClass,
  MeshBasicMaterial,
  PlaneGeometry,
  PointLight as PointLightClass,
  Vector3,
} from "three";
import { GameAudio, type CueName, type ImpactSurface } from "../audio/GameAudio.js";
import { clone as cloneSkeleton } from "three/examples/jsm/utils/SkeletonUtils.js";
import { Enemy } from "../entities/Enemy.js";
import { FpsPlayer } from "../entities/FpsPlayer.js";
import { MAGAZINE, RESERVE, Rifle } from "../entities/Rifle.js";
import { Target } from "../entities/Target.js";
import { setupLighting } from "../render/lighting.js";
import { setupPost } from "../render/postprocessing.js";
import { softCircleTexture } from "../render/particles.js";
import { scale } from "../render/scale.js";
import { buildTown, TOWN_HALF, type Town } from "../render/town.js";
import { createTownMaterials, type TownTextures } from "../render/townMaterials.js";
import { setupSky } from "../render/sky.js";
import { Tracers } from "../render/tracers.js";
import { TARGET_GOAL, type GameState } from "../state.js";

export type GameCtx = ICtx<GameState, IPhysicsContext>;

/** The reference HUD reads 1:45 on the round clock. */
const RUN_SECONDS = 105;
const RANGE_METRES = 70;
const ROUND_DAMAGE = 10;

/**
 * Town-material member name → what a bullet hears when it lands there. Members
 * left out (water, shallows, fronds) have no honest cue and stay silent. The
 * plaster/brick walls are world-projected per-mesh materials, so they cannot be
 * tabled by identity — they are the resolver's default instead.
 */
const MATERIAL_SURFACES: Readonly<Record<string, ImpactSurface>> = {
  ground: "stone",
  dadoBand: "plaster",
  plasterTrim: "plaster",
  brickTrim: "plaster",
  doorBlue: "wood",
  shutter: "wood",
  rollerSteel: "steel",
  awningCanvas: "plaster",
  awningStripe: "plaster",
  crate: "wood",
  deckWood: "wood",
  barrel: "steel",
  palmTrunk: "wood",
  siteMark: "stone",
  plateFace: "steel",
  plateHit: "steel",
  plateFrame: "steel",
  steel: "steel",
  steelPost: "steel",
  steelMast: "steel",
  tankDark: "steel",
  quay: "stone",
  plazaWarm: "stone",
  plazaCool: "stone",
  plazaPale: "stone",
};

type LoadedModel = { scene: Group; animations: AnimationClip[] };

export class Play extends Scene<GameState, IPhysicsContext> {
  static override readonly initialState: GameState = {
    aiming: false,
    ammo: MAGAZINE,
    assetsLoaded: 0,
    assetsTotal: 0,
    blips: [],
    distanceMoved: 0,
    health: 100,
    hitFlash: 0,
    phase: "playing",
    playerX: 0,
    playerYaw: 0,
    playerZ: 32,
    ready: false,
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
        town: TownTextures;
      }
    | undefined;

  /** Decoded cue buffers from `load`; kept across restarts so replays stay instant. */
  #audioBuffers: ReadonlyMap<CueName, AudioBuffer> | undefined;
  /** Live bus for the current scene instance; rebuilt by every `enter`, dropped by `exit`. */
  #audio: GameAudio | undefined;

  override async load(ctx: GameCtx): Promise<void> {
    // Every town surface is colour + OpenGL normal + roughness. The normals are
    // what stopped the walls reading as painted cardboard: a stucco photograph
    // with no relief takes the key light perfectly evenly however good the
    // photograph is. `bayview-brick` is the one map with no PBR set of its own,
    // so it borrows the whitewash relief — both are rough lime render at the
    // same grain, and the alternative is the only flat wall in the town.
    // Boot progress is counted, not faked: each asset ticks the HUD's bar as it
    // resolves, so a slow cold load shows movement instead of a black canvas.
    let loaded = 0;
    let total = 0;
    const track = <T,>(job: Promise<T>): Promise<T> => {
      total += 1;
      return job.then((value) => {
        loaded += 1;
        ctx.state.set({ assetsLoaded: loaded, assetsTotal: total });
        return value;
      });
    };
    const texture = (file: string): Promise<Texture> =>
      track(ctx.assets.texture(`assets/${file}`));
    const [
      enemy,
      viewmodel,
      weapon,
      sky,
      plaster,
      plasterNormal,
      plasterRough,
      brick,
      floor,
      floorNormal,
      floorRough,
      floorAo,
      concrete,
      concreteNormal,
      concreteRough,
      quaystone,
      quaystoneNormal,
      quaystoneRough,
      steel,
      steelNormal,
      steelRough,
      wood,
      woodNormal,
      paving,
      pavingNormal,
      pavingRough,
    ] = await Promise.all([
      track(ctx.assets.model<LoadedModel>("assets/enemy-terrorist.glb")),
      track(ctx.assets.model<LoadedModel>("assets/player-viewmodel.glb")),
      track(ctx.assets.model<LoadedModel>("assets/weapon-ak47.glb")),
      texture("bayview-sky.jpg"),
      texture("bayview-whitewash.jpg"),
      texture("bayview-whitewash-normal.jpg"),
      texture("bayview-whitewash-rough.jpg"),
      texture("bayview-brick.jpg"),
      texture("bayview-flagstone.jpg"),
      texture("bayview-flagstone-normal.jpg"),
      texture("bayview-flagstone-rough.jpg"),
      texture("bayview-flagstone-ao.jpg"),
      texture("bayview-concrete.jpg"),
      texture("bayview-concrete-normal.jpg"),
      texture("bayview-concrete-rough.jpg"),
      texture("bayview-quaystone.jpg"),
      texture("bayview-quaystone-normal.jpg"),
      texture("bayview-quaystone-rough.jpg"),
      texture("bayview-steel.jpg"),
      texture("bayview-steel-normal.jpg"),
      texture("bayview-steel-rough.jpg"),
      texture("bayview-wood.jpg"),
      texture("bayview-wood-normal.jpg"),
      texture("bayview-paving.jpg"),
      texture("bayview-paving-normal.jpg"),
      texture("bayview-paving-rough.jpg"),
    ]);
    const town: TownTextures = {
      plaster: { map: plaster, normal: plasterNormal, rough: plasterRough },
      brick: { map: brick, normal: plasterNormal, rough: plasterRough },
      floor: { map: floor, normal: floorNormal, rough: floorRough, ao: floorAo },
      concrete: { map: concrete, normal: concreteNormal, rough: concreteRough },
      quaystone: { map: quaystone, normal: quaystoneNormal, rough: quaystoneRough },
      steel: { map: steel, normal: steelNormal, rough: steelRough },
      wood: { map: wood, normal: woodNormal },
      paving: { map: paving, normal: pavingNormal, rough: pavingRough },
    };
    this.#assets = { enemy, viewmodel, weapon, sky, town };
    // Audio loads through the same tracked pipeline, so the boot bar covers it too.
    this.#audioBuffers = await GameAudio.load(ctx.assets);
    console.info(
      `TN_FPS_ASSETS_LOADED:enemy(${enemy.animations.length} clips),viewmodel,sky,town textures,audio(${this.#audioBuffers.size})`,
    );
  }

  override exit(): void {
    // Every enter builds a fresh bus. Without this the old one survives a restart
    // with its window gesture listeners and its looping ambience still live.
    this.#audio?.dispose();
    this.#audio = undefined;
  }

  override enter(ctx: GameCtx): SceneFrame<GameState, IPhysicsContext> {
    const assets = this.#assets;
    if (assets === undefined) throw new Error("Town assets did not load.");

    const camera = ctx.camera as PerspectiveCamera;
    setupSky(ctx.scene, assets.sky);
    setupLighting(ctx.scene, ctx.renderer.raw as Parameters<typeof setupLighting>[1]);
    setupPost(ctx.renderer);
    ctx.add(camera);

    // The bus rides the camera's listener and registers as an entity so the dev
    // overlay and playtests can read its counters. It queues until the first
    // key/click gesture unlocks the WebAudio context, then flushes.
    const audio = new GameAudio(camera, this.#audioBuffers ?? new Map());
    this.#audio = audio;
    ctx.entities.remove("audio");
    ctx.entities.add("audio", audio);
    audio.startAmbience();

    const materials = createTownMaterials(assets.town);
    const town: Town = buildTown(materials);
    ctx.add(town.group);
    // Plates are raycast targets like any solid: without them in the list a round flies
    // straight through and scores whatever soldier happens to stand behind the plate.
    const plateMeshes: Object3D[] = [];
    town.targets.forEach((spec, index) => {
      const entity = `target-${index}`;
      ctx.entities.remove(entity);
      // The spec list is data; the plates themselves are entities so playtests can read them.
      const plate = new Target(
        {
          face: materials.plateFace,
          hit: materials.plateHit,
          frame: materials.plateFrame,
          steel: materials.steel,
        },
        spec,
      );
      // Plates live inside the town group like every other prop, so scene-wide
      // audits that traverse the town find them where they belong.
      town.group.add(plate.group);
      ctx.entities.add(entity, plate);
      plateMeshes.push(plate.plate);
    });

    // One fixed body per solid so the player slides along walls properly. These
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
    for (const box of town.colliders) {
      staticBody(
        (box.min[0] + box.max[0]) / 2,
        (box.min[1] + box.max[1]) / 2,
        (box.min[2] + box.max[2]) / 2,
        box.max[0] - box.min[0],
        box.max[1] - box.min[1],
        box.max[2] - box.min[2],
      );
    }
    staticBody(0, -0.5, 0, TOWN_HALF * 2 + 4, 1, TOWN_HALF * 2 + 4);

    const playerSetup = ctx.entities.get<{
      readonly isObject3D?: boolean;
      readonly position: Vector3;
      readonly quaternion?: Quaternion;
    }>("player");
    ctx.entities.remove("player");
    const player = new FpsPlayer(ctx, camera);
    if (playerSetup?.isObject3D === true && playerSetup.position.lengthSq() > 1e-6) {
      player.mesh.position.copy(playerSetup.position);
      player.body.teleport(player.mesh.position);
      // A scenario can aim the spawn through the placeholder's rotation. Only the
      // look angles are taken (the body stays upright): forward's height is the
      // pitch, its heading the yaw — identity falls out as the constructor defaults.
      if (playerSetup.quaternion !== undefined) {
        const forward = new Vector3(0, 0, -1).applyQuaternion(playerSetup.quaternion);
        player.look.pitch = Math.asin(MathUtils.clamp(forward.y, -1, 1));
        player.look.yaw = Math.atan2(-forward.x, -forward.z);
      }
      player.syncCamera();
    }
    ctx.entities.add("player", player);
    // Strides are distance-driven inside the player; the scene owns where they sound.
    player.onFootstep = () => audio.localStep();
    const rifle = new Rifle(
      camera,
      assets.viewmodel.scene as Object3D,
      assets.viewmodel.animations,
      ctx.scene,
    );
    ctx.entities.add("rifle", rifle);
    rifle.onMagOut = () => audio.magOut();
    rifle.onMagIn = () => audio.magIn();

    // Five soldiers patrol the ground lanes, one per route — a full T side holding
    // the town. The model asset is shared; each Enemy normalises its own copy out of
    // the cached scene only once, so later soldiers clone the prepared rig.
    const enemySetup = ctx.entities.get<{
      readonly isObject3D?: boolean;
      readonly position: Vector3;
    }>("enemy");
    ctx.entities.remove("enemy");
    // A scenario that shoots a soldier needs one who does not patrol. Placing the
    // optional "enemy-frozen" placeholder turns soldier 0 into a sentry standing at
    // that spot for the whole round: presence is the flag, position is the spawn
    // (facing +z, toward a player placed north of him). It takes precedence over the
    // plain "enemy" placement when both are present. The placeholder parks off-map
    // until placed (see game.ts), so an origin spawn is still a real placement.
    const frozenSetup = ctx.entities.get<{
      readonly isObject3D?: boolean;
      readonly position: Vector3;
    }>("enemy-frozen");
    ctx.entities.remove("enemy-frozen");
    const frozenSpawn =
      frozenSetup?.isObject3D === true && frozenSetup.position.y > -100
        ? frozenSetup.position.clone()
        : undefined;
    console.info(
      `TN_FPS_FROZEN_DEBUG:isObject3D=${frozenSetup?.isObject3D} pos=${JSON.stringify(frozenSetup?.position)} frozen=${frozenSpawn !== undefined}`,
    );
    const navBounds = { min: -TOWN_HALF - 1, max: TOWN_HALF + 1 };
    const enemies: Enemy[] = [];
    for (let index = 0; index < town.enemyRoutes.length; index += 1) {
      // Every soldier needs its own fully retargeted rig: the class mutates scale and pose.
      const model = cloneSkeleton(assets.enemy.scene);
      const soldier = new Enemy(
        ctx,
        model,
        assets.enemy.animations,
        town.colliders,
        // The rifle is rigged too (it carries Grip_Bone), so it needs a retargeted
        // clone as well — a plain clone shares the original's skeleton and renders
        // the bind pose at authored scale, which reads as a giant floating AK.
        cloneSkeleton(assets.weapon.scene),
        index === 0 && frozenSpawn !== undefined
          ? {
              route: [frozenSpawn],
              navBounds,
              decks: town.decks,
              frozen: true,
            }
          : {
              route: town.enemyRoutes[index],
              navBounds,
              decks: town.decks,
            },
      );
      if (index === 0 && frozenSpawn !== undefined) {
        soldier.group.position.copy(frozenSpawn);
        soldier.group.updateWorldMatrix(true, true);
      } else if (
        index === 0 &&
        enemySetup?.isObject3D === true &&
        enemySetup.position.lengthSq() > 1e-6
      ) {
        soldier.group.position.copy(enemySetup.position);
        soldier.group.updateWorldMatrix(true, true);
      }
      ctx.add(soldier.group);
      ctx.entities.add(index === 0 ? "enemy" : `enemy-${index}`, soldier);
      enemies.push(soldier);
    }

    // Hitscan picks against an explicit list: the town solids, the plates and the
    // soldier proxies. Raycasting the whole scene would also hit the viewmodel welded
    // to the camera and score every shot as a miss at 0.4 m.
    const hittable: Object3D[] = [
      ...town.hittable,
      ...plateMeshes,
      ...enemies.map((e) => e.hitbox),
    ];
    // Sight lines treat a standing plate like the old range did: thin dressing the
    // LOS check skips by its userData, but a solid that can still stop a round.
    const occluders: Object3D[] = [...town.hittable, ...plateMeshes];

    // Impact sounds by surface. Named solids classify by name; everything else by
    // material identity off the town palette; whitewash (world-projected per mesh,
    // so untabled) is both the dominant wall and the honest default.
    const materialSurface = new Map<Material, ImpactSurface>();
    for (const [key, surface] of Object.entries(MATERIAL_SURFACES)) {
      const value = (materials as unknown as Record<string, unknown>)[key];
      if (
        typeof value === "object" &&
        value !== null &&
        (value as { isMaterial?: boolean }).isMaterial === true
      ) {
        materialSurface.set(value as Material, surface);
      }
    }
    const resolveSurface = (hit: Intersection): ImpactSurface => {
      const name = hit.object.name;
      if (/crate|deck|pier|rail|stair/.test(name)) return "wood";
      if (/barrel|bollard|post|mast|tank|roller|shutter/.test(name)) return "steel";
      if (/quay|plaza|ground/.test(name)) return "stone";
      // Only meshes carry a material; every hittable here is one.
      const meshMaterial = (hit.object as MeshClass).material;
      const first = Array.isArray(meshMaterial) ? meshMaterial[0] : meshMaterial;
      if (first !== undefined) {
        const mapped = materialSurface.get(first);
        if (mapped !== undefined) return mapped;
      }
      return "plaster";
    };

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
        // Plates and paint are thin dressing; only solids block sight.
        if (hit.object.userData.target !== undefined) continue;
        return false;
      }
      return true;
    };

    // Impact puffs: a small ring of additive quads reused round-robin, so a shot that
    // lands on plaster reads as a hit even across mid.
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
    const enemyTracers = new Tracers(ctx.scene, 16, 0xff6a4d);
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
    let lastPhase: GameState["phase"] = "playing";
    let lastTickSecond = Number.POSITIVE_INFINITY;
    const eye = new Vector3();

    const fire = (frameCtx: GameCtx, aimRay: { origin: Vector3; direction: Vector3 }): void => {
      if (!rifle.fire()) return;
      audio.playerShot();
      eye.copy(aimRay.origin);
      const direction = aimRay.direction.clone().normalize();
      player.recordFiringDirection(direction);
      const hit = frameCtx.raycast({
        direction,
        far: RANGE_METRES,
        origin: eye,
        targets: hittable,
      });
      // Every soldier within earshot reacts, not just the closest one.
      for (const soldier of enemies) soldier.hearShot(eye.clone());
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
          audio.plateChime(hit.point);
        }
        return;
      }
      const struck = hit.object.userData.enemy as Enemy | undefined;
      if (struck !== undefined) {
        audio.bodyImpact(hit.point);
        const multiplier =
          hit.point.y >= struck.headZoneMinY ? 4 : hit.point.y < struck.legZoneMaxY ? 0.7 : 1;
        struck.recordHit(multiplier, direction);
        const earned = struck.hurt(frameCtx, ROUND_DAMAGE * multiplier);
        if (earned > 0) {
          frameCtx.state.set((state) => ({
            score: state.score + earned,
            targetsHit: state.targetsHit + 1,
          }));
          hitFlash = 0.12;
        }
        return;
      }
      spawnImpact(hit.point, hit.face?.normal ?? new Vector3(0, 1, 0));
      audio.impact(resolveSurface(hit), hit.point);
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

    // The light is what makes it read across a lane: it puts a warm kick on the soldier and
    // the wall behind them for two frames, which no additive quad can do on its own.
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
        audio.enemyShot(at);
        audio.nearMiss(distance);
      },
      onFootstep: (at: Vector3): void => audio.soldierStep(at),
    };

    // The scene is built: geometry, physics, soldiers and the viewmodel all
    // exist. Flip the boot flag here rather than when the last byte arrived,
    // because the black canvas lasts until the first frame actually draws.
    ctx.state.set({ ready: true });

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
      // Peak-voice tracking runs outside the phase gate so the end screen still samples.
      audio.sample();

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
      if (pointer.down && !pointer.captured) {
        frameCtx.input.captureMouse();
        // The click that buys the mouse also confirms it: the UI cue's one home,
        // since this game's only "menu" is the pointer lock itself.
        audio.uiClick();
      }

      player.update(frameCtx, dt, !rifle.reloading);
      const moveVector = frameCtx.input.vector("move");
      const aimRay = player.aimRay();
      rifle.converge(aimRay.origin, aimRay.direction);
      rifle.update(dt, player.aiming, Math.min(1, Math.hypot(moveVector.x, moveVector.y)));
      if (frameCtx.input.justPressed("fire")) fire(frameCtx, aimRay);
      if (frameCtx.input.justPressed("reload")) rifle.reload(frameCtx);

      eye.set(player.eye.x, player.eye.y, player.eye.z);
      for (const soldier of enemies) {
        soldier.update(frameCtx, dt, eye, 0, hooks);
      }

      const hitCount = frameCtx.state.getState().targetsHit;
      let phase: GameState["phase"] = "playing";
      if (hitCount >= TARGET_GOAL) phase = "complete";
      else if (player.health <= 0 || timeRemaining <= 0) phase = "failed";

      // The clock's last ten seconds tick once per remaining second, and the round
      // ends on its own sting. Both fire exactly once per transition.
      const tickSecond = Math.ceil(timeRemaining);
      if (timeRemaining > 0 && timeRemaining <= 10 && tickSecond !== lastTickSecond) {
        lastTickSecond = tickSecond;
        audio.tick();
      }
      if (phase !== lastPhase) {
        if (phase === "complete") audio.roundEnd(true);
        else if (phase === "failed") audio.roundEnd(false);
        lastPhase = phase;
      }

      frameCtx.state.set({
        aiming: player.aiming,
        ammo: rifle.ammo,
        blips: enemies.map((soldier) => ({
          alive: soldier.alive,
          x: soldier.group.position.x,
          z: soldier.group.position.z,
        })),
        distanceMoved: player.distanceMoved,
        health: player.health,
        hitFlash,
        phase,
        playerX: player.mesh.position.x,
        playerYaw: player.look.yaw,
        playerZ: player.mesh.position.z,
        reloads: rifle.reloads,
        reserve: rifle.reserve,
        score: frameCtx.state.getState().score,
        shots: rifle.shots,
        timeRemaining,
      });
      if (phase !== "playing") frameCtx.state.flush();
    };
  }
}
