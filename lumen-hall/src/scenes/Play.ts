import { AudioBus, type ICtx, Scene, type SceneFrame } from "@threenative/core";
import {
  Area3D,
  CharacterBody3D,
  CollisionShape3D,
  type IPhysicsContext,
  RigidBody3D,
} from "@threenative/physics";
import {
  BufferAttribute,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  NearestFilter,
  Box3,
  BoxGeometry,
  MeshStandardMaterial,
  Object3D,
  type PerspectiveCamera,
  type Texture,
  Vector3,
} from "three";
import { Crate } from "../entities/Crate.js";
import { Goal } from "../entities/Goal.js";
import { Player } from "../entities/Player.js";
import { pickupRiseEase } from "../render/easing.js";
import { NAVE, setupLighting } from "../render/lighting.js";
import { createMaterials } from "../render/materials.js";
import { setupPost } from "../render/postprocessing.js";
import { createCathedral } from "../render/cathedral.js";
import { createFurnishings } from "../render/furnishings.js";
import {
  BODY_HALF_HEIGHT,
  BODY_RADIUS,
  createFirstPerson,
  type IFirstPerson,
} from "../first-person.js";
import { buildStaticColliders } from "../collision.js";
import { applyFurnishings, applySurfaces, loadSurfaces } from "../render/surfaces.js";
import { ball, block, makeRandom, roundedBox, spike, tube } from "../render/shapes.js";
import { setupSky } from "../render/sky.js";
import type { GameState } from "../state.js";

export type GameCtx = ICtx<GameState, IPhysicsContext>;

const KILL_PLANE = -4;
const STARTING_LIVES = 3;

export class Play extends Scene<GameState, IPhysicsContext> {
  #assetProof: Group | undefined;
  #floorTexture: Texture | undefined;
  #walker: IFirstPerson | undefined;
  #engel: Group | undefined;

  static override readonly initialState: GameState = {
    characterName: "",
    coyoteJumps: 0,
    entityCount: 0,
    jumps: 0,
    levelX: -99,
    lives: STARTING_LIVES,
    odometer: 0,
    paused: false,
    peakRise: 0,
    playerX: -2,
    walkerZ: 22,
    walkerY: 1.7,
    walkerX: 2.6,
    respawns: 0,
    score: 0,
    screen: "playing",
    status: "playing",
    uiReady: false,
  };

  override async load(ctx: GameCtx): Promise<void> {
    const [texture, model, marble, engel] = await Promise.all([
      ctx.assets.texture("native-proof.png"),
      ctx.assets.model<{ scene: Group }>("native-proof.glb"),
      ctx.assets.texture("cathedral-floor.png"),
      ctx.assets.model<{ scene: Group }>("engel.glb"),
      // Resolved for its side effect: `loadSurfaces` caches the set, and `applySurfaces`
      // reads that cache in `enter`. Awaited here rather than in `enter` because the
      // screen-space passes gather from what is already on screen — a texture that lands
      // three frames late is three frames of GI computed against untextured stone.
      loadSurfaces(ctx.assets),
    ]);
    this.#floorTexture = marble;
    this.#engel = engel.scene;
    // A 16-pixel check filtered smoothly is a grey smear at flag size; nearest keeps the
    // squares square, which is the whole reason the finish flag is legible from the ledge.
    texture.magFilter = NearestFilter;
    model.scene.traverse((object) => {
      if (object instanceof Mesh) {
        object.material = new MeshBasicMaterial({ map: texture, side: DoubleSide });
        // The packaged proof carries positions and indices only. Without UVs the sampler
        // reads one corner texel for every fragment and the flag renders as flat white —
        // a loaded texture that proves nothing you can see. Plane-project the triangle.
        // Compiled models may be quantized (KHR_mesh_quantization): the attribute then holds
        // normalized integers, so measure each axis range from the array itself instead of
        // assuming float32 metres — the affine projection is identical either way.
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
      }
    });
    model.scene.name = "native-proof-assets";
    this.#assetProof = model.scene;
    console.info("TN_NATIVE_STARTER_ASSETS_LOADED:texture,glb");
  }

  /** Detach the pointer-lock and mousemove listeners when the scene is torn down. */
  override exit(_ctx: GameCtx): void {
    this.#walker?.dispose();
    this.#walker = undefined;
  }

  override enter(ctx: GameCtx): SceneFrame<GameState, IPhysicsContext> {
    if (this.#assetProof === undefined) throw new Error("Starter proof assets did not load.");
    const audio = ctx.entities.add("audio", new AudioBus({ camera: ctx.camera }));
    const pickupAudio = ctx.assets.audio("pickup.wav");
    void pickupAudio.catch(() => undefined);
    setupSky(ctx.scene);
    const sun = setupLighting(ctx.scene, ctx.renderer.raw as Parameters<typeof setupLighting>[1]);
    try {
      setupPost(ctx.renderer, ctx.scene, ctx.camera, sun);
    } catch (error) {
      console.error("TN_SETUP_POST_FAILED:", error instanceof Error ? error.stack : error);
      throw error;
    }
    ctx.add(ctx.camera);
    // A fixed camera, not the starter's spring arm. The two GI captures must differ by one
    // post stage and nothing else; a camera that settles on a spring differs by where it
    // happened to be on the frame the shutter fired.
    const view = ctx.camera as PerspectiveCamera;
    view.fov = 63;
    view.near = 0.1;
    view.far = 220;
    // Inside the room. The hall runs z -4..+4, so anything past +4 is standing behind the
    // front wall looking at its unlit outside face — a black frame with a lit room behind it.
    // Standing in the nave, a few metres in from the west door, at eye height.
    // Dead on the nave axis. A cathedral reads because it is symmetric down the centre
    // line; two degrees off and the two colonnades stop rhyming and it reads as rubble.
    // Between the west door and the first bay. At z 17.5 the camera stood *inside* the
    // first column pair and two out-of-focus shafts of stone filled a third of the frame.
    // Standing in the nave a few bays west of the crossing, at eye height. The reference
    // is shot from about here: low enough that the floor reflection is half the frame.
    // Where the walker starts: a few bays in from the west door, off the axis so the
    // colonnade runs away to one side rather than framing a symmetrical postcard.
    view.position.set(2.6, 1.7, 22);
    view.lookAt(-1.4, 7.5, -31);
    view.updateProjectionMatrix();
    // Walk the cathedral. Bounds are the interior, not a physics body: the floor is one
    // flat plane and clamping to the building is the entire collision model this needs.
    // A kinematic capsule, so the player is stopped by piers and walls and can climb the
    // chancel stairs. `autostep` is what makes a step a step rather than a wall; without it a
    // 0.45 m riser stops a character dead and reads as a broken collider.
    const body = new Object3D();
    body.position.set(2.6, BODY_HALF_HEIGHT + BODY_RADIUS, 22);
    const character = new CharacterBody3D({
      autostep: { maxHeight: 0.6, minWidth: 0.2 },
      maxSlopeClimbAngle: Math.PI / 4,
      object: body,
      physics: ctx.physics,
      shape: CollisionShape3D.capsule(BODY_HALF_HEIGHT, BODY_RADIUS),
      snapToGround: 0.3,
    });
    const walker = createFirstPerson(
      view,
      ctx.renderer.domElement,
      {
        halfWidth: NAVE.width / 2 + NAVE.aisleWidth - 1.2,
        halfDepth: NAVE.depth * 0.5 - 3,
      },
      { character },
    );
    this.#walker = walker;

    // Camera vantages for `tools/look.mjs --vantage <name>=/`: named spots the screenshot
    // tool can move the walker to before the shutter. The walker rewrites the camera's
    // rotation from its own orientation every fixed step, so these go through
    // `walker.teleport` — a hook that moved the camera directly would be snapped back
    // before the frame was captured. Yaw 0 faces east, down the nave.
    (globalThis as { __LOOK_VANTAGES__?: Record<string, () => void> }).__LOOK_VANTAGES__ = {
      vault: () => walker.teleport(0, 6, 1.05, 0),
      axis: () => walker.teleport(0, 24, 0.06, 0),
      altar: () => walker.teleport(0, -12, 0.04, 0),
      aisle: () => walker.teleport(10.5, 14, 0.05, -Math.PI / 2),
    };

    const materials = createMaterials();
    const cathedral = applySurfaces(createCathedral(this.#floorTexture));
    ctx.add(cathedral);
    // Collision is read off the building rather than hand-listed, so it cannot drift out of
    // step with geometry this file does not own.
    buildStaticColliders(ctx, cathedral);
    // Dressed separately from the shell on purpose. `applySurfaces`'s stone rules classify
    // by metalness and colour luminance, and several furnishings materials — the carpet at
    // 0x51201d among them — are unmetallic and dark enough that they would be dressed as
    // vault stone.
    const furnishings = applyFurnishings(createFurnishings());
    // The authored glTF figure stands in the slot `furnishings.ts` leaves empty for it:
    // bay 7 on the +X side, x = 6.95, z = 21. Its procedural neighbours in bays 3 and 5 are
    // untouched, so the two kinds stand in the same aisle under the same light.
    if (this.#engel !== undefined) ctx.add(placeAuthoredStatue(this.#engel, 6.95, 21));
    ctx.add(furnishings);
    // Flames, halos and the two point lights breathe on seeded phases; the furnishing
    // group owns the animation, the scene owns the clock.
    const animateFires = furnishings.userData.animateFires as
      | ((time: number) => void)
      | undefined;
    let elapsed = 0;
    // Keep the initial -99 sentinel until seed.playtest samples it. If this draw is replaced with
    // Math.random, the unchanged seeded state reports an out-of-range value and seed.playtest
    // identifies the bypass instead of silently accepting an unseeded level.
    const randomStateBeforeLevel = ctx.random.state;
    const levelX = ctx.random.range(-1, 1);
    const seededLevelX = ctx.random.state === randomStateBeforeLevel ? 2 : levelX;
    const pickupX = 1.2 + makeRandom(Math.round((levelX + 1) * 1000))() * 0.8;
    const floorMesh = new Mesh(roundedBox(28, 0.2, 63, 0.08), materials.floor);
    floorMesh.position.y = -0.1;
    // `createCathedral` draws the floor the camera sees. This box is the collider under it,
    // and drawing both is a z-fight across the whole frame.
    floorMesh.visible = false;
    ctx.add(floorMesh);
    new RigidBody3D({
      object: floorMesh,
      physics: ctx.physics,
      shape: CollisionShape3D.fromMesh(floorMesh),
      type: "fixed",
    });
    // The starter's gameplay props stay in the scene graph so the state, physics and
    // playtest wiring keep working, but nothing in a cathedral capture should be a
    // floating orange crate. Hidden rather than deleted: deleting them means unpicking
    // the scene's state contract for no visual gain.
    const crate = new Crate(ctx, levelX, 4, -1.5, materials.crate);
    for (const object of [crate as unknown as { mesh?: { visible: boolean } }]) {
      if (object.mesh !== undefined) object.mesh.visible = false;
    }
    const state = ctx.state.getState();
    const player = new Player(ctx, materials.player, {
      x: Number.isFinite(state.playerX) ? state.playerX : Play.initialState.playerX,
      y: 0.5,
      z: 0,
    });
    const pickupBase = block(0.42, 0.14, 0.42, materials.player);
    const pickupStem = tube(0.08, 0.08, 0.3, materials.player);
    const pickupOrb = ball(0.16, materials.player);
    const pickupTip = spike(0.14, 0.26, materials.player);
    pickupBase.position.y = -0.16;
    pickupStem.position.y = 0.06;
    pickupOrb.position.y = 0.32;
    pickupTip.position.y = 0.53;
    const pickupVisual = new Group();
    pickupVisual.add(pickupBase, pickupStem, pickupOrb, pickupTip);
    pickupVisual.position.set(pickupX, 0.5, 0);
    pickupVisual.visible = false;
    pickupVisual.castShadow = true;
    ctx.add(pickupVisual);
    ctx.entities.add("pickup", pickupVisual);
    void ctx.tween(pickupVisual.position, { y: 0.65 }, 0.4, { ease: pickupRiseEase });
    player.mesh.visible = false;
    ctx.entities.add("player", player);
    // The packaged proof asset earns its place here: it is the pennant on the finish flag,
    // not a debug object parked over the level. The texture and the glTF still load in
    // `load()` above, which is what the native asset gate greps for.
    const goal = ctx.entities.add("goal", new Goal(ctx, materials, this.#assetProof));
    // The area says the character is over the island; the run is only won once it is also
    // standing on it. Ending on the overlap alone freezes the character in mid-air at the
    // lip of the island, half a metre short of a landing, which is what it looks like.
    let overGoal = false;
    goal.area.on("bodyEntered", (body) => {
      if (body === player.body) overGoal = true;
    });
    let entityCount = 4;
    ctx.state.set({ entityCount });
    const pickup = new Area3D({
      physics: ctx.physics,
      position: { x: pickupX, y: 0.5, z: 0 },
      shape: CollisionShape3D.box(1, 1, 1),
    });
    pickup.on("bodyEntered", (body) => {
      if (body !== player.body) return;
      ctx.state.set((state) => ({ score: state.score + 1 }));
      ctx.entities.remove("pickup");
      entityCount -= 1;
      ctx.state.set({ entityCount });
      pickup.monitoring = false;
      pickupVisual.visible = false;
      ctx.after(3, () => {
        ctx.entities.add("pickup", pickupVisual);
        entityCount += 1;
        ctx.state.set({ entityCount });
        pickupVisual.visible = true;
        pickup.monitoring = true;
      });
      void pickupAudio.then((buffer) => audio.play(buffer)).catch(() => undefined);
    });
    if (state.score > 0) {
      ctx.entities.remove("pickup");
      entityCount -= 1;
      ctx.state.set({ entityCount });
      pickup.monitoring = false;
      pickupVisual.visible = false;
    }

    ctx.after(0.25, () => ctx.state.set({ levelX: seededLevelX }));
    const frameState: Partial<GameState> = {};
    return (frameCtx, dt) => {
      // Restart resets the store before clearing entities and scheduled callbacks.
      if (frameCtx.input.justPressed("restart")) {
        frameCtx.state.set(Play.initialState);
        frameCtx.state.flush();
        void frameCtx.goto("play");
        return;
      }
      walker.update(frameCtx.input.vector("move"), dt, frameCtx.input.pressed?.("jump") === true);
      // Publish where the walker actually ended up. This is the observable a collision test
      // needs: a screenshot cannot tell "stopped by the chancel screen" from "walked through
      // it and is looking back at a lit building from outside".
      frameState.walkerZ = view.position.z;
      elapsed += dt;
      animateFires?.(elapsed);

      const previous = frameCtx.state.getState();
      // A finished run stops simulating the character and keeps drawing the world behind
      // the banner. R, or the restart button, rebuilds the scene from `initialState`.
      if (previous.status !== "playing") return;
      player.update(frameCtx, dt);
      let respawned = false;
      let lives = previous.lives;
      if (player.mesh.position.y < KILL_PLANE) {
        lives -= 1;
        player.respawn();
        respawned = true;
      }
      // `status` is written only on the frame that ends the run, and never in the bulk
      // write below, which would stamp this frame's stale copy back over it.
      if (lives <= 0) frameCtx.state.set({ status: "lost" });
      else if (overGoal && player.grounded) {
        frameCtx.state.set({ status: "won" });
        frameCtx.state.flush();
      }
      frameState.walkerZ = view.position.z;
      frameState.walkerY = view.position.y;
      frameState.walkerX = view.position.x;
      frameState.coyoteJumps = player.coyoteJumps;
      frameState.jumps = player.jumps;
      frameState.lives = lives;
      frameState.odometer = player.odometer;
      frameState.peakRise = Math.max(previous.peakRise, player.mesh.position.y - 0.5);
      frameState.playerX = player.mesh.position.x;
      frameState.respawns = previous.respawns + (respawned ? 1 : 0);
      const current = frameCtx.state.getState();
      const changed =
        frameState.coyoteJumps !== current.coyoteJumps ||
        frameState.jumps !== current.jumps ||
        frameState.lives !== current.lives ||
        frameState.odometer !== current.odometer ||
        frameState.peakRise !== current.peakRise ||
        frameState.playerX !== current.playerX ||
        frameState.walkerZ !== current.walkerZ ||
        frameState.walkerY !== current.walkerY ||
        frameState.walkerX !== current.walkerX ||
        frameState.respawns !== current.respawns;
      if (changed) frameCtx.state.set(frameState);
      if (respawned) frameCtx.state.flush();
    };
  }
}

/**
 * Stands an authored glTF figure on a plinth beside the procedural statuary.
 *
 * Scale and footing are computed from the model's own bounds rather than hand-tuned, because
 * a glTF arrives in whatever units its author used — metres, centimetres or none — and a
 * hard-coded factor silently breaks the moment the model is replaced. Normalising to a target
 * height and seating the measured base on the plinth is the only version of this that
 * survives someone dropping in a different file.
 */
function placeAuthoredStatue(source: Group, x: number, z: number): Group {
  /** Plinth top, matching the procedural statue's 1.5 m box plus its 0.12 m cap. */
  const PLINTH_TOP = 1.62;
  /** Slightly over life size, as carved figures on plinths tend to be. */
  const TARGET_HEIGHT = 2.1;

  const figure = source.clone(true);
  const bounds = new Box3().setFromObject(figure);
  const size = bounds.getSize(new Vector3());
  const scale = size.y > 0 ? TARGET_HEIGHT / size.y : 1;
  figure.scale.setScalar(scale);

  // Re-measure after scaling: the base offset has to be in final units, and the model's
  // origin is very unlikely to sit at its own feet.
  const scaled = new Box3().setFromObject(figure);
  figure.position.set(x - scaled.min.x - (scaled.max.x - scaled.min.x) / 2, PLINTH_TOP - scaled.min.y, z);
  figure.position.x = x;
  figure.position.z = z;
  // Face the nave, matching the procedural statues on this side.
  figure.rotation.y = -Math.PI / 2;
  figure.traverse((object) => {
    if (object instanceof Mesh) {
      object.castShadow = true;
      object.receiveShadow = true;
    }
  });

  const plinth = new Mesh(
    new BoxGeometry(0.9, 1.5, 0.9),
    new MeshStandardMaterial({ color: 0x6d6558, roughness: 0.9, metalness: 0 }),
  );
  plinth.position.set(x, 0.75, z);
  plinth.castShadow = true;
  plinth.receiveShadow = true;

  const group = new Group();
  group.name = "authored-statue";
  group.add(plinth, figure);
  group.updateMatrixWorld(true);
  const placed = new Box3().setFromObject(figure);
  let triangles = 0;
  figure.traverse((o) => {
    if (o instanceof Mesh) triangles += (o.geometry.index?.count ?? o.geometry.getAttribute("position").count) / 3;
  });
  console.info(
    `TN_AUTHORED_STATUE:${JSON.stringify({
      scale: +scale.toFixed(4),
      sourceHeight: +size.y.toFixed(3),
      min: [+placed.min.x.toFixed(2), +placed.min.y.toFixed(2), +placed.min.z.toFixed(2)],
      max: [+placed.max.x.toFixed(2), +placed.max.y.toFixed(2), +placed.max.z.toFixed(2)],
      triangles: Math.round(triangles),
    })}`,
  );
  return group;
}
