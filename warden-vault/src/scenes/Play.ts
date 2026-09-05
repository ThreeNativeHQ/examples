import { type ICtx, type IRandom, Scene, type SceneFrame, isMobile } from "@threenative/core";
import { CollisionShape3D, type IPhysicsContext, RigidBody3D } from "@threenative/physics";
import {
  BufferAttribute,
  Color,
  type Group,
  type Material,
  Mesh,
  NearestFilter,
  type PerspectiveCamera,
  Quaternion,
  Vector3,
} from "three";
import { Crate, type CrateKind } from "../entities/Crate.js";
import { Seal } from "../entities/Seal.js";
import { WARDEN_SPAWN, Warden } from "../entities/Warden.js";
import { createVaultCamera } from "../render/camera.js";
import { CRATE_SIZE } from "../render/crateShape.js";
import { setupLighting } from "../render/lighting.js";
import { createLoadingScreen } from "../render/loading.js";
import { type IVaultMaterials, createBannerMaterial, createMaterials } from "../render/materials.js";
import { palette } from "../render/palette.js";
import { setupPost } from "../render/postprocessing.js";
import { SEAL, VAULT, createVaultRoom } from "../render/vault.js";
import type { GameState } from "../state.js";

export type GameCtx = ICtx<GameState, IPhysicsContext>;

/** Below this linear speed a body counts as at rest. */
const REST_SPEED = 0.06;
/** Consecutive at-rest ticks before the opening drop is declared over. */
const REST_TICKS = 24;
/** How far a crate must move after the drop before it counts as shoved. */
const PUSH_THRESHOLD = 0.25;

/** The deterministic check: this many fixed steps, twice, on the script below. */
const REPLAY_TICKS = 96;
const REPLAY_START = { x: -4.2, y: 0.62, z: 2.3 } as const;

/** The scripted input both replay passes are driven by. A pure function of the tick index. */
function replayInput(tick: number): { readonly x: number; readonly z: number } {
  if (tick < 42) return { x: 1, z: 0 };
  if (tick < 70) return { x: 0, z: -1 };
  return { x: 0.707, z: -0.707 };
}

interface ICrateAuthoring {
  readonly colour: number;
  readonly kind: CrateKind;
  readonly rotationY: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

interface IPose {
  readonly position: Vector3;
  readonly quaternion: Quaternion;
}

export class Play extends Scene<GameState, IPhysicsContext> {
  #materials: IVaultMaterials | undefined;
  #banner: Mesh | undefined;
  #statics: RigidBody3D[] = [];

  static override readonly initialState: GameState = {
    blockedTicks: 0,
    crates: 0,
    odometer: 0,
    passThroughs: 0,
    paused: false,
    phaseCrates: 0,
    playerX: WARDEN_SPAWN.x,
    playerZ: WARDEN_SPAWN.z,
    pushDistance: 0,
    pushedCrates: 0,
    replayMatch: false,
    replayPhase: "idle",
    replayTicks: REPLAY_TICKS,
    seed: 6132,
    sealContacts: 0,
    sealedBy: "none",
    settled: false,
    settledCrates: 0,
    status: "playing",
    uiReady: false,
  };

  override async load(ctx: GameCtx): Promise<void> {
    this.#materials = createMaterials();
    // The packaged proof pair still loads, and still prints the marker the desktop asset gate
    // greps for. In this game the triangle earns its place as the pennant on the east wall
    // rather than as a debug object parked over the level.
    const [texture, model] = await Promise.all([
      ctx.assets.texture("native-proof.png"),
      ctx.assets.model<{ scene: Group }>("native-proof.glb"),
    ]);
    // A 16-pixel check filtered smoothly is a grey smear at banner size; nearest keeps it square.
    texture.magFilter = NearestFilter;
    let banner: Mesh | undefined;
    model.scene.traverse((object) => {
      if (!(object instanceof Mesh)) return;
      if (banner !== undefined) throw new Error("Proof glTF must contain exactly one mesh.");
      object.material = createBannerMaterial(texture);
      // The packaged proof carries positions and indices only. Without UVs the sampler reads one
      // corner texel for every fragment and it renders flat white — a loaded texture that proves
      // nothing you can see. Plane-project the triangle, measuring each axis from the array so a
      // quantized (KHR_mesh_quantization) build projects identically.
      const position = object.geometry.getAttribute("position");
      let minX = Number.POSITIVE_INFINITY;
      let minY = Number.POSITIVE_INFINITY;
      let maxX = Number.NEGATIVE_INFINITY;
      let maxY = Number.NEGATIVE_INFINITY;
      for (let index = 0; index < position.count; index += 1) {
        minX = Math.min(minX, position.getX(index));
        maxX = Math.max(maxX, position.getX(index));
        minY = Math.min(minY, position.getY(index));
        maxY = Math.max(maxY, position.getY(index));
      }
      const spanX = Math.max(maxX - minX, Number.EPSILON);
      const spanY = Math.max(maxY - minY, Number.EPSILON);
      const uv = new Float32Array(position.count * 2);
      for (let index = 0; index < position.count; index += 1) {
        uv[index * 2] = (position.getX(index) - minX) / spanX;
        uv[index * 2 + 1] = (position.getY(index) - minY) / spanY;
      }
      object.geometry.setAttribute("uv", new BufferAttribute(uv, 2));
      banner = object;
    });
    if (banner === undefined) throw new Error("Proof glTF did not contain a mesh.");
    this.#banner = banner;
    console.info("TN_NATIVE_STARTER_ASSETS_LOADED:texture,glb");
  }

  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: the vault's one scene assembles the room, the bodies, the seal and the replay check; splitting it would only move the wiring.
  override enter(ctx: GameCtx): SceneFrame<GameState, IPhysicsContext> {
    const materials = this.#materials;
    const bannerMesh = this.#banner;
    if (materials === undefined || bannerMesh === undefined)
      throw new Error("Vault scene did not finish loading.");

    // --- room ------------------------------------------------------------------------------
    ctx.scene.background = new Color(palette.void);
    const sun = setupLighting(ctx.scene, ctx.renderer.raw as Parameters<typeof setupLighting>[1]);
    setupPost(ctx.renderer, ctx.scene, ctx.camera, { godraysLight: sun, mobile: isMobile() });
    const loading = createLoadingScreen(ctx);
    const room = createVaultRoom(materials);
    ctx.add(room.object);
    ctx.entities.add("seal", room.seal);
    // The room's solid boxes become fixed bodies here, in the scene, so `src/render/` never has
    // to import a framework package to describe what is walkable.
    this.#statics = room.solids.map(
      (solid) =>
        new RigidBody3D({
          physics: ctx.physics,
          position: { x: solid.x, y: solid.y, z: solid.z },
          shape: CollisionShape3D.box(solid.width, solid.height, solid.depth),
          type: "fixed",
        }),
    );

    bannerMesh.scale.setScalar(0.3);
    bannerMesh.position.set(VAULT.halfX - 0.1, 1.32, 2.5);
    bannerMesh.rotation.set(0, -Math.PI / 2, 0);
    ctx.add(bannerMesh);

    const camera = createVaultCamera(ctx.camera as PerspectiveCamera);
    camera.snap();
    ctx.add(ctx.camera);

    // --- bodies ----------------------------------------------------------------------------
    const authored = authorCrates(ctx.random);
    let crates: Crate[] = [];
    // The seal reports every body that overlaps it, and the floor slab is one of them: its top
    // face is exactly the plane the seal plate sits on, so an area authored from y = 0 upward is
    // *already* intersecting a fixed body on the first step and the run is won before the warden
    // moves. Keeping the live crate bodies in a set is what makes "was that a crate" answerable
    // without guessing from a body id.
    const crateBodies = new Set<unknown>();
    const buildCrates = (poses?: readonly IPose[]): void => {
      for (const crate of crates) crate.dispose();
      crateBodies.clear();
      crates = authored.map((plan, index) => {
        const pose = poses?.[index];
        return new Crate(ctx, crateMaterials(materials, plan), {
          kind: plan.kind,
          quaternion: pose?.quaternion,
          rotationY: plan.rotationY,
          x: pose?.position.x ?? plan.x,
          y: pose?.position.y ?? plan.y,
          z: pose?.position.z ?? plan.z,
        });
      });
      for (const crate of crates) crateBodies.add(crate.body);
    };
    buildCrates();
    const solidCount = authored.filter((plan) => plan.kind === "solid").length;
    const phaseCount = authored.length - solidCount;

    const warden = ctx.entities.add("player", new Warden(ctx, materials));
    const seal = ctx.entities.add("seal.area", new Seal(ctx, room.seal));

    // --- the run's own bookkeeping ----------------------------------------------------------
    let status: GameState["status"] = "playing";
    let sealedBy: GameState["sealedBy"] = "none";
    let passThroughs = 0;
    let insidePhaseWall = false;
    let settled = false;
    let restTicks = 0;
    let replayPhase: GameState["replayPhase"] = "idle";
    let replayMatch = false;
    let replayTick = 0;
    let replayDigest = "";
    let snapshot: readonly IPose[] = [];
    let wardenSnapshot = new Vector3(WARDEN_SPAWN.x, WARDEN_SPAWN.y, WARDEN_SPAWN.z);
    /** V pressed before the opening drop finished: honoured as soon as it has. */
    let replayRequested = false;

    const unwatch = seal.watch({
      isCrate: (body) => crateBodies.has(body),
      onContact: (by) => {
        // The seal is switched off for the duration of the replay, so anything that reaches it
        // here reached it in the run the player is actually playing.
        if (status === "won") return;
        status = "won";
        sealedBy = by;
        room.setSealLit(true);
        ctx.state.set({ sealedBy: by, status: "won" });
        ctx.state.flush();
      },
      warden: warden.body,
    });

    const phaseWall = phaseWallBounds();
    const digest = (): string =>
      crates
        .map((crate) => {
          const p = crate.mesh.position;
          const q = crate.mesh.quaternion;
          return `${p.x.toFixed(5)},${p.y.toFixed(5)},${p.z.toFixed(5)},${q.x.toFixed(5)},${q.y.toFixed(5)},${q.z.toFixed(5)},${q.w.toFixed(5)}`;
        })
        .join("|");
    const capture = (): readonly IPose[] =>
      crates.map((crate) => ({
        position: crate.mesh.position.clone(),
        quaternion: crate.mesh.quaternion.clone(),
      }));

    const startReplayPass = (phase: "first" | "second"): void => {
      buildCrates();
      warden.teleport(REPLAY_START);
      replayPhase = phase;
      replayTick = 0;
    };

    ctx.state.set({
      ...Play.initialState,
      crates: solidCount,
      phaseCrates: phaseCount,
      replayTicks: REPLAY_TICKS,
      status,
    });

    const frameState: Partial<GameState> = {};

    return (frame, dt) => {
      loading.update();
      if (frame.input.justPressed("restart")) {
        frame.state.set(Play.initialState);
        frame.state.flush();
        void frame.goto("play");
        return;
      }

      // --- the deterministic double run -----------------------------------------------------
      if (replayPhase === "first" || replayPhase === "second") {
        warden.update(dt, replayInput(replayTick));
        replayTick += 1;
        if (replayTick >= REPLAY_TICKS) {
          if (replayPhase === "first") {
            replayDigest = digest();
            startReplayPass("second");
          } else {
            replayMatch = digest() === replayDigest;
            replayPhase = "done";
            // Put the vault back exactly as the player left it, then let the seal watch again.
            buildCrates(snapshot);
            warden.teleport(wardenSnapshot);
            seal.area.monitoring = true;
            frame.state.set({ replayMatch, replayPhase });
            frame.state.flush();
          }
        }
        camera.follow(warden.mesh.position, dt);
        return;
      }

      if (frame.input.justPressed("verify")) replayRequested = true;
      if (replayRequested && replayPhase === "idle" && settled) {
        replayRequested = false;
        snapshot = capture();
        wardenSnapshot = warden.mesh.position.clone();
        // Nothing that happens during the two passes may end the run.
        seal.area.monitoring = false;
        startReplayPass("first");
        frame.state.set({ replayPhase: "first" });
        frame.state.flush();
        return;
      }

      // --- ordinary play --------------------------------------------------------------------
      const move = frame.input.vector("move");
      // `input.vector("move").y` is +up on the screen, which is -Z in the world.
      warden.update(dt, { x: move.x, z: -move.y });
      camera.follow(warden.mesh.position, dt);

      let atRest = 0;
      let pushed = 0;
      let pushDistance = 0;
      for (const crate of crates) {
        if (crate.speed < REST_SPEED) atRest += 1;
        if (settled && crate.kind === "solid") {
          const moved = crate.displacement();
          if (moved > PUSH_THRESHOLD) pushed += 1;
          pushDistance = Math.max(pushDistance, moved);
        }
      }
      if (!settled) {
        restTicks = atRest === crates.length ? restTicks + 1 : 0;
        if (restTicks >= REST_TICKS) {
          settled = true;
          for (const crate of crates) crate.markRest();
        }
      }

      // Pass-through is counted as an event, not a frame: the warden's capsule centre entering
      // the glowing wall's volume once is one pass, however long it stands inside it.
      const inside =
        warden.mesh.position.x > phaseWall.minX &&
        warden.mesh.position.x < phaseWall.maxX &&
        warden.mesh.position.z > phaseWall.minZ &&
        warden.mesh.position.z < phaseWall.maxZ;
      if (inside && !insidePhaseWall) passThroughs += 1;
      insidePhaseWall = inside;

      frameState.blockedTicks = warden.blockedTicks;
      frameState.odometer = warden.odometer;
      frameState.passThroughs = passThroughs;
      frameState.playerX = warden.mesh.position.x;
      frameState.playerZ = warden.mesh.position.z;
      frameState.pushDistance = pushDistance;
      frameState.pushedCrates = pushed;
      frameState.sealContacts = seal.contacts;
      frameState.sealedBy = sealedBy;
      frameState.settled = settled;
      frameState.settledCrates = atRest;
      frameState.status = status;
      frame.state.set(frameState);
    };
  }

  override exit(ctx: GameCtx): void {
    for (const body of this.#statics) body.dispose();
    this.#statics = [];
    super.exit(ctx);
  }
}

/** Which of the three crate colours this plan wears, plus the shared brace timber. */
function crateMaterials(materials: IVaultMaterials, plan: ICrateAuthoring): readonly Material[] {
  if (plan.kind === "phase") return [materials.phase, materials.phaseCore];
  const colour = materials.crate[plan.colour % materials.crate.length];
  if (colour === undefined) throw new Error("Crate colour index fell outside the palette.");
  return [colour, materials.crateBrace];
}

/** The glowing ward's footprint, used to count the warden walking through it. */
function phaseWallBounds(): {
  readonly maxX: number;
  readonly maxZ: number;
  readonly minX: number;
  readonly minZ: number;
} {
  return { maxX: 5.5, maxZ: 0.85 + CRATE_SIZE / 2, minX: 2.69, minZ: 0.85 - CRATE_SIZE / 2 };
}

/**
 * Where every body starts, drawn from the seeded source so two loads of seed 6132 build the same
 * vault. Nothing is authored at its resting height: the whole field is dropped a few centimetres
 * so the opening seconds are a real settle, and three of them are authored off-balance so
 * something visibly topples while it happens.
 *
 * Two lanes are deliberately empty. The warden's spawn row (z about 3.0) is clear all the way
 * east, and the approach to the seal carries nothing solid — the only thing standing in it is the
 * glowing ward, which is the one wall the warden can walk through.
 */
function authorCrates(random: IRandom): readonly ICrateAuthoring[] {
  const plans: ICrateAuthoring[] = [];
  const colour = (): number => Math.floor(random.range(0, 2.999));
  const jitter = (amount: number): number => random.range(-amount, amount);

  // The pile: four columns, two deep, three high, in the middle of the room.
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 2; row += 1) {
      for (let level = 0; level < 3; level += 1) {
        // Two gaps knocked out of the top course. A four-by-three block with every cell filled
        // reads as a wall, and the silhouette is most of what makes a pile look like a pile.
        if (level === 2 && ((column === 3 && row === 0) || (column === 0 && row === 1))) continue;
        plans.push({
          colour: colour(),
          kind: "solid",
          rotationY: jitter(0.05),
          x: -2.55 + column * 0.95 + jitter(0.03),
          y: 0.5 + level * 0.95,
          z: -1.45 + row * 0.95 + jitter(0.03),
        });
      }
    }
  }

  // The crate the warden is already leaning on when the vault opens. It is directly in the lane,
  // so the first press of ArrowRight shoves it — which is the mechanic, not decoration.
  plans.push({ colour: 0, kind: "solid", rotationY: jitter(0.1), x: -2.9, y: 0.5, z: 2.3 });

  // Singles around the room, clear of the seal's footprint.
  const singles: readonly (readonly [number, number])[] = [
    [-4.5, -2.6],
    [-3.5, -0.4],
    [-1.1, 3.1],
    [1.3, 3.0],
    [1.4, -2.7],
    [-0.3, -3.1],
    [4.6, 2.9],
    [5.05, 0.25],
    [2.3, 2.0],
    [-0.9, 1.9],
    [-4.3, 0.9],
    [1.25, -3.4],
  ];
  for (const [x, z] of singles)
    plans.push({
      colour: colour(),
      kind: "solid",
      rotationY: random.range(-0.5, 0.5),
      x: x + jitter(0.05),
      y: 0.52,
      z: z + jitter(0.05),
    });

  // Three off-balance crates: authored above and beside a neighbour so the drop tips them over.
  const topplers: readonly (readonly [number, number, number])[] = [
    [-2.0, 1.55, 1.3],
    [0.5, 1.5, -2.9],
    [0.55, 2.45, -1.3],
  ];
  for (const [x, y, z] of topplers)
    plans.push({ colour: colour(), kind: "solid", rotationY: random.range(0.3, 0.45), x, y, z });

  // The ward: three wide, two high, standing across the seal's approach. Every route from the
  // warden's lane to the seal goes through it, and none of it stops the warden.
  for (let column = 0; column < 3; column += 1)
    for (let level = 0; level < 2; level += 1)
      plans.push({
        colour: 0,
        kind: "phase",
        rotationY: 0,
        x: 3.15 + column * 0.94,
        y: 0.5 + level * 0.95,
        z: 0.85,
      });

  assertClearOfSeal(plans);
  return plans;
}

/**
 * Refuses a layout in which any authored crate already overlaps the seal.
 *
 * This is not defensive tidiness — it is the third time this exact bug shipped. A crate authored
 * with up to half a radian of yaw has a footprint half-extent of 0.46 * (|cos| + |sin|), which is
 * 0.62 m, not 0.46 m; three separate singles cleared the seal on paper and clipped it by a
 * centimetre or two in the world, and the run reported `won` on the opening drop with the warden
 * still standing at its spawn. Reading the number off the screenshot took a build each time.
 * Fail closed at authoring instead, and name the crate.
 */
function assertClearOfSeal(plans: readonly ICrateAuthoring[]): void {
  for (const [index, plan] of plans.entries()) {
    const reach = (CRATE_SIZE / 2) * (Math.abs(Math.cos(plan.rotationY)) + Math.abs(Math.sin(plan.rotationY)));
    const overlapsX = Math.abs(plan.x - SEAL.x) < SEAL.half + reach;
    const overlapsZ = Math.abs(plan.z - SEAL.z) < SEAL.half + reach;
    if (overlapsX && overlapsZ)
      throw new Error(
        `Crate ${index} is authored inside the seal: (${plan.x.toFixed(2)}, ${plan.z.toFixed(2)}) with a ${reach.toFixed(2)} m footprint reaches the seal at (${SEAL.x}, ${SEAL.z}) half ${SEAL.half}. The run would report won before the warden moves.`,
      );
  }
}
