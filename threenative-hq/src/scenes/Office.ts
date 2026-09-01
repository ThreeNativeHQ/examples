import { type ICtx, Scene, type SceneFrame, isMobile, isWeb } from "@threenative/core";
import type { IPhysicsContext } from "@threenative/physics";
import { CollisionShape3D, RigidBody3D } from "@threenative/physics";
import { NavigationAgent3D, NavigationRegion3D } from "@threenative/physics/navigation";
import type { AnimationClip, Group, PerspectiveCamera } from "three";
import { Color, Mesh, MeshStandardMaterial, Vector3 } from "three";
import { BridgeClient } from "../office/bridge-client.js";
import { Worker } from "../office/Worker.js";
import {
  type ActorPhase,
  activityForSession,
  assignDesks,
  hashSession,
  workerStateFor,
} from "../office/floor.js";
import { requiredClips } from "../office/states.js";
import { setupOfficeLighting } from "../render/lighting.js";
import {
  type IActivitySpot,
  type IOffice,
  type IOfficeAssets,
  SEAT_HEIGHT,
  createOffice,
} from "../render/office.js";
import { setupPost } from "../render/postprocessing.js";
import { setupSky } from "../render/sky.js";
import { type IActorReport, deriveChecks, vectorOf, worldOf } from "../office/inspect.js";
import { Visitor, capturePointerOnClick } from "../office/Visitor.js";
import type { GameState, SessionRow } from "../state.js";

export type GameCtx = ICtx<GameState, IPhysicsContext>;

const DESK_COUNT = 16;
/** Metres per second a worker walks across the floor. An office is not a race. */
const WALK_SPEED = 2.1;
/** How close counts as arrived. */
const ARRIVED_METRES = 0.45;
/** How fast a keyboard slides under the hands that are reaching for it. */
const BOARD_EASE = 0.08;
/**
 * How long a session state must hold before its worker adopts it.
 *
 * The bridge re-derives session state from live process activity every heartbeat, and a session
 * that flips between snapshots — working, idle, working — used to flip its worker's clip with it.
 * A worker changing pose every heartbeat looks broken and never settles long enough for the
 * keyboard to align. Half a second eats the flaps and delays real changes imperceptibly.
 * "blocked" is exempt: it is the one state whose whole job is to be noticed, and noticing late
 * reads as not noticing at all.
 */
const STATE_HOLD_SECONDS = 0.5;

interface IActor {
  readonly worker: Worker;
  readonly agent: NavigationAgent3D | undefined;
  phase: ActorPhase;
  deskIndex: number;
  /** The furniture this worker uses while its session idles, if any. */
  activity: IActivitySpot | undefined;
  /** A session state seen but not yet held long enough to act on. */
  candidate: string;
  /** Seconds the candidate state has held. */
  candidateAge: number;
}

export class Office extends Scene<GameState, IPhysicsContext> {
  #rig: Group | undefined;
  #clips: readonly AnimationClip[] = [];
  #officeAssets: IOfficeAssets = {};

  static override readonly initialState: GameState = {
    arrivals: 0,
    blockedSeen: false,
    bridgeOnline: false,
    departures: 0,
    deskCount: 0,
    focusClip: "",
    focusProject: "",
    focusState: "none",
    officeReady: false,
    requestedSelection: "",
    visitorX: 0,
    visitorZ: 0,
    selectedHost: "",
    selectedId: "",
    selectedProject: "",
    selectedSource: "",
    selectedState: "",
    selectedTool: "",
    paused: false,
    sessions: [],
    uiReady: false,
    workerCount: 0,
  };

  override async load(ctx: GameCtx): Promise<void> {
    // Two libraries, one rig: library 1 carries the mannequin and the walk and sitting clips,
    // library 3 the retargeted Mixamo takes (typing, texting, furniture). Both were authored or
    // retargeted onto the same 65-joint skeleton, so the clips merge onto one mixer without
    // further work — checked here rather than assumed.
    const [base, extra] = await Promise.all([
      ctx.assets.model<{ scene: Group; animations: AnimationClip[] }>("worker.glb"),
      ctx.assets.model<{ scene: Group; animations: AnimationClip[] }>("worker-mixamo.glb"),
    ]);
    const baseAssetNames = ["SM_Table_1", "SM_Chair_1", "SM_Cabinet_1"] as const;
    const expandedAssetNames = [
      "SM_Bar_1",
      "SM_Bench_1",
      "SM_Counter_1",
      "SM_Decoration_1",
      "SM_Door_1_A",
      "SM_Door_Frame_1",
      "SM_Elevator_1",
      "SM_Monitor_1",
      "SM_Sofa_2",
      "SM_Table_2",
      "SM_Table_3",
      "SM_Trash",
      "SM_flower_pot_1",
      "SM_lamp_2",
    ] as const;
    const loadedBase = await Promise.all(
      baseAssetNames.map((name) =>
        ctx.assets.model<{ scene: Group }>(`fab/office-pack-vol-1/Models/${name}.glb`),
      ),
    );
    const loadedExpanded = await Promise.all(
      expandedAssetNames.map((name) =>
        ctx.assets.model<{ scene: Group }>(`fab/office-pack-vol-1-expanded/Models/${name}.glb`),
      ),
    );
    const clips: AnimationClip[] = [];
    const names = new Set<string>();
    for (const clip of [...base.animations, ...extra.animations]) {
      // Both libraries ship an `A_TPose`, and a mixer keyed by name cannot hold two. First file
      // wins, and the drop is reported rather than silently resolved.
      if (names.has(clip.name)) {
        console.info(`TN_HQ_DUPLICATE_CLIP:${clip.name}`);
        continue;
      }
      names.add(clip.name);
      clips.push(clip);
    }
    const missing = requiredClips().filter((clip) => !names.has(clip));
    // Fail closed. A missing clip renders as a mannequin frozen in its bind pose, which looks
    // exactly like a worker that is simply idle — the one failure this office must never fake.
    if (missing.length > 0)
      throw new Error(`worker.glb is missing required clips: ${missing.join(", ")}.`);
    this.#rig = base.scene;
    this.#clips = clips;
    this.#officeAssets = Object.fromEntries([
      ...baseAssetNames.map((name, index) => [name, loadedBase[index]?.scene]),
      ...expandedAssetNames.map((name, index) => [name, loadedExpanded[index]?.scene]),
    ]);
    console.info("TN_HQ_FAB_OFFICE_LOADED:Office Pack Vol.1:17 models");
    console.info(`TN_HQ_CLIPS_LOADED:${String(clips.length)}`);
  }

  override enter(ctx: GameCtx): SceneFrame<GameState, IPhysicsContext> {
    const rig = this.#rig;
    if (rig === undefined) throw new Error("The office rig did not load.");

    setupSky(ctx.scene);
    const key = setupOfficeLighting(
      ctx.scene,
      ctx.renderer.raw as Parameters<typeof setupOfficeLighting>[1],
    );
    setupPost(ctx.renderer, ctx.scene, ctx.camera, { godraysLight: key, mobile: isMobile() });

    const room: IOffice = createOffice(DESK_COUNT, this.#officeAssets);
    ctx.add(room.root);

    // The room is solid: one static body per simplified box, so a visitor bumps into desks and
    // columns rather than walking through the furniture.
    for (const box of room.colliders) {
      new RigidBody3D({
        physics: ctx.physics,
        position: { x: box.x, y: box.y, z: box.z },
        shape: CollisionShape3D.box(box.width, box.height, box.depth),
        type: "fixed",
      });
    }
    ctx.add(ctx.camera);
    const camera = ctx.camera as PerspectiveCamera;
    // You start by the door, looking down the floor — the same framing the reference frames use,
    // except now you can walk out of it. `?spawn=x,z,yaw` pins the start for captures, the same
    // way the inspector global pins the numbers: web-only, read once at enter, never on native.
    let spawn = new Vector3(11.6, 1.0, 4.6);
    let spawnYaw = 1.19;
    if (isWeb() && typeof location !== "undefined") {
      const pinned = new URLSearchParams(location.search).get("spawn");
      if (pinned !== null) {
        const parts = pinned.split(",").map((part) => Number.parseFloat(part));
        if (parts.length === 3 && parts.every((n) => Number.isFinite(n))) {
          spawn = new Vector3(parts[0] as number, 1.0, parts[1] as number);
          spawnYaw = parts[2] as number;
        }
      }
    }
    const visitor = new Visitor(ctx, spawn, spawnYaw, {
      clips: this.#clips,
      source: rig,
    });
    const releasePointer = capturePointerOnClick();
    ctx.entities.add("visitor", visitor.object);
    visitor.update(ctx, 0, camera);

    // Bake before any agent exists: the region is the floor the workers walk on, and an agent
    // created against an unbaked navmesh has nowhere to path.
    const navigation = ctx.physics.navigation;
    if (navigation !== undefined) new NavigationRegion3D({ meshes: [room.floor], navigation });

    const bridge = new BridgeClient();
    const workers = new Map<string, Worker>();
    const actors = new Map<string, IActor>();
    const leaving: IActor[] = [];
    // Clicking a worker asks "what is this one doing", so the answer is the session's own summary
    // — repository, host, state, last tool. Never a prompt: the bridge does not carry one, and the
    // office is a wall display.
    let selectedId = "";
    // Clicking the floor closes the card, which is the only way to dismiss it without a button.
    ctx.pointer.on(room.floor, "tapped", () => {
      selectedId = "";
    });
    let seating = new Map<string, number>();
    let arrivals = 0;
    let logTick = 0;
    // The sessions already running when the office opens were not born at the door. Only the ones
    // that start after the first snapshot walk in — otherwise every reload stages a fake commute.
    let seenFirstSnapshot = false;
    let lastDt = 0;
    /** Desks whose keyboard has been measured against a seated worker's hands. */
    const alignedDesks = new Set<number>();
    let alignAttempts = 0;
    const alignSkips = new Map<string, number>();
    let departures = 0;
    let blockedSeen = false;

    ctx.state.set({ deskCount: room.desks.length, officeReady: true });
    ctx.state.flush();

    return (frameCtx, dt) => {
      const store = frameCtx.state.getState();
      if (store.paused) return;
      // The workers are solid to you, and you are solid to them. The list is last frame's
      // positions — a walking worker covers three centimetres a frame, which no push notices.
      VISITOR_AT.copy(visitor.object.position);
      obstacleScratch.length = 0;
      for (const actor of actors.values()) obstacleScratch.push(actor.worker.object.position);
      for (const actor of leaving) obstacleScratch.push(actor.worker.object.position);
      visitor.update(frameCtx, dt, camera, obstacleScratch);
      // The panel can ask for a selection; the scene is the only thing that owns one.
      if (store.requestedSelection !== "") {
        selectedId = store.requestedSelection === selectedId ? "" : store.requestedSelection;
        frameCtx.state.set({ requestedSelection: "" });
      }
      logTick += 1;
      lastDt = dt;
      bridge.tick();
      const sessions = bridge.sessions();
      const assignment = assignDesks(sessions, room.desks.length, seating);
      seating = new Map(assignment.desks);

      // Arrivals: a session the floor has not seated before gets a mannequin and a desk.
      for (const session of sessions) {
        const deskIndex = assignment.desks.get(session.id);
        if (deskIndex === undefined) continue;
        const desk = room.desks[deskIndex];
        if (desk === undefined) continue;
        let actor = actors.get(session.id);
        if (actor === undefined) {
          const worker = new Worker({ clips: this.#clips, host: session.host, source: rig });
          // Everyone comes in through the door and walks to their desk. Placing them in the chair
          // would be one line shorter and would make a busy machine look like a photograph.
          // Fan the doorway out a little so four arrivals in one second do not walk as one body.
          worker.object.position.copy(room.entrance);
          worker.object.position.x -= (arrivals % 4) * 0.55;
          worker.object.position.z -= ((arrivals + 1) % 3) * 0.5;
          frameCtx.add(worker.object);
          frameCtx.entities.add(entityId(session.id), worker);
          workers.set(session.id, worker);
          arrivals += 1;
          const clicked = session.id;
          for (const pick of worker.picks) {
            frameCtx.pointer.on(pick, "tapped", () => {
              selectedId = selectedId === clicked ? "" : clicked;
            });
          }
          const agent =
            navigation === undefined
              ? undefined
              : new NavigationAgent3D({ maxSpeed: WALK_SPEED, navigation, object: worker.object });
          agent?.setTargetPosition(desk.stand);
          const walks = seenFirstSnapshot;
          if (!walks) worker.object.position.copy(desk.seat);
          actor = {
            activity: undefined,
            agent,
            candidate: "",
            candidateAge: 0,
            deskIndex,
            phase: walks ? "walkingIn" : "seated",
            worker,
          };
          actors.set(session.id, actor);
        }
        if (actor.deskIndex !== deskIndex) {
          actor.deskIndex = deskIndex;
          if (actor.phase === "walkingIn") actor.agent?.setTargetPosition(desk.stand);
        }
        const raw = workerStateFor(session);
        if (raw === "blocked") blockedSeen = true;
        // A session state must hold before its worker adopts it; see STATE_HOLD_SECONDS. While a
        // candidate is pending the worker keeps doing what it is already doing.
        let state = raw;
        if (raw !== "blocked" && raw !== actor.worker.state) {
          if (actor.candidate === raw) actor.candidateAge += dt;
          else {
            actor.candidate = raw;
            actor.candidateAge = 0;
          }
          if (actor.candidateAge < STATE_HOLD_SECONDS) state = actor.worker.state;
        } else {
          actor.candidate = "";
          actor.candidateAge = 0;
        }
        if (actor.phase === "walkingIn") {
          actor.worker.setState("arriving");
          if (step(actor, desk.stand, dt)) {
            actor.phase = "seated";
            actor.worker.setState(state);
          }
        } else if (actor.phase === "walkingToActivity" && actor.activity !== undefined) {
          actor.worker.setState("arriving");
          if (step(actor, actor.activity.stand, dt)) {
            actor.phase = "atActivity";
            actor.worker.setState(state);
          }
        } else if (actor.phase === "atActivity") {
          if (state !== "filing" && state !== "faxing") {
            // The session needs its worker back at the desk; the walkingIn branch carries it there.
            actor.phase = "walkingIn";
          } else if (actor.activity !== undefined) {
            actor.worker.object.position.copy(actor.activity.stand);
            actor.worker.object.rotation.y = actor.activity.facing;
          }
        } else {
          // Seated at the desk. An idle session may send its worker to the furniture instead: the
          // state change stands the worker up (the Worker owns its stand-up one-shot), and the walk
          // starts once that one-shot has finished moving its legs.
          const spot =
            state === "filing" || state === "faxing" ? spotFor(session.id, room) : undefined;
          actor.activity = spot;
          if (spot !== undefined && actor.worker.standing && !actor.worker.transitioning) {
            actor.phase = "walkingToActivity";
            actor.agent?.setTargetPosition(spot.stand);
          } else {
            actor.worker.setState(state);
          // A standing worker steps back from the chair; a seated one sits in it.
          actor.worker.object.position.copy(actor.worker.standing ? desk.stand : desk.seat);
          // Land the seated pose on the actual seat. The clip decides where the hips are relative
          // to the body; the room decides where the seat is; only the game knows both, so the
          // difference is taken here rather than baked into either. Measured against the body's
          // own origin, so subtracting it is a one-step correction and not a feedback loop.
          if (!actor.worker.standing) {
            const rise = actor.worker.pelvisRise;
            if (rise !== undefined) {
              const onSeat = SEAT_HEIGHT - rise;
              // The seat wins unless it would bury the shoes: the seated clips do not agree on how
              // far below the hips the feet reach, and a worker standing 1.3 cm inside the carpet
              // reads as badly as one hovering above the chair. Hips give way, never the floor.
              const feet = actor.worker.lowestFootRise;
              actor.worker.object.position.y =
                feet === undefined ? onSeat : Math.max(onSeat, -feet);
            }
          }
          actor.worker.object.rotation.y = desk.facing;
          // Put the keyboard under the hands rather than the hands over the keyboard: the clip is
          // fixed and the desk is not. Eased every frame rather than measured once, because the
          // arms bend into place over half a second and a single early sample lands the board
          // where the hands were passing through.
          // Why an alignment did not run is worth reporting: "the keyboard never moved" and
          // "the keyboard moved to the wrong place" look identical on screen and are different
          // bugs. `pnpm inspect` prints this tally.
          const alignBlocker = actor.worker.standing
            ? "standing"
            : !actor.worker.settled
              ? "pose-not-settled"
              : state !== "working"
                ? `state:${state}`
                : "none";
          alignSkips.set(alignBlocker, (alignSkips.get(alignBlocker) ?? 0) + 1);
          if (alignBlocker === "none") alignAttempts += 1;
          if (!actor.worker.standing && actor.worker.settled && state === "working") {
            const hand = actor.worker.handCentre(HAND);
            const parent = desk.keyboard.parent;
            if (hand !== undefined && parent !== null) {
              // Horizontally only. The board stays on the desk at desk height; the driving pose
              // holds the hands a little above it, which is what the pose is and what it looked
              // like before anything tried to correct it.
              parent.worldToLocal(hand);
              desk.keyboard.position.x += (hand.x - desk.keyboard.position.x) * BOARD_EASE;
              desk.keyboard.position.z += (hand.z + 0.02 - desk.keyboard.position.z) * BOARD_EASE;
              alignedDesks.add(deskIndex);
            }
          }
          }
        }
        // A working session lights its own monitor. It is the cheapest way to read the floor at a
        // glance — a room of dark screens with three lit ones says where the work is.
        setScreen(desk.screen, actor.phase === "seated" && (state === "working" || state === "thinking"));
      }

      // Departures: a worker whose session is gone walks out. Its desk frees immediately — the
      // count on the wall is about sessions, and the walk is about the room.
      for (const [id, actor] of actors) {
        if (assignment.desks.has(id)) continue;
        actor.phase = "walkingOut";
        actor.worker.setState("leaving");
        actor.agent?.setTargetPosition(room.entrance);
        setScreen(room.desks[actor.deskIndex]?.screen ?? room.desks[0]!.screen, false);
        actors.delete(id);
        workers.delete(id);
        seating.delete(id);
        leaving.push(actor);
        departures += 1;
      }

      for (let index = leaving.length - 1; index >= 0; index -= 1) {
        const actor = leaving[index] as IActor;
        if (!step(actor, room.entrance, dt)) continue;
        actor.worker.object.removeFromParent();
        actor.worker.dispose();
        leaving.splice(index, 1);
      }

      for (const actor of actors.values()) actor.worker.update(dt);
      for (const actor of leaving) actor.worker.update(dt);

      if (selectedId !== "" && !workers.has(selectedId)) selectedId = "";
      const selected = sessions.find((session) => session.id === selectedId);
      // The numeric window onto this scene. Web only, read by `tools/inspect.mjs`, and the first
      // thing to reach for when something looks wrong — a screenshot cannot tell you that a
      // keyboard is four centimetres inside a desk.
      if (isWeb() && typeof globalThis !== "undefined") {
        // A size audit of every drawn mesh, for "something huge and dark is in the frame" — the
        // question a screenshot cannot answer and a radius list can.
        (globalThis as Record<string, unknown>).__hqSizes = () => {
          const report: { name: string; kind: string; radius: number; at: number[] }[] = [];
          frameCtx.scene.traverse((object) => {
            const mesh = object as Mesh;
            if (!mesh.isMesh && !(object as { isSkinnedMesh?: boolean }).isSkinnedMesh) return;
            const geometry = mesh.geometry;
            if (geometry === undefined) return;
            if (geometry.boundingSphere === null) geometry.computeBoundingSphere();
            const radius = (geometry.boundingSphere?.radius ?? 0) * mesh.getWorldScale(tmpScale).x;
            if (radius < 1.2) return;
            const at = mesh.getWorldPosition(tmpVec);
            report.push({
              at: [Math.round(at.x), Math.round(at.y), Math.round(at.z)],
              kind: (object as { isSkinnedMesh?: boolean }).isSkinnedMesh ? "skinned" : "mesh",
              name: mesh.name || mesh.parent?.name || "(unnamed)",
              radius: Math.round(radius * 10) / 10,
            });
          });
          return report;
        };
        (globalThis as Record<string, unknown>).__hq = () => {
          const reports: IActorReport[] = [];
          for (const [id, entry] of actors) {
            const board = room.desks[entry.deskIndex]?.keyboard;
            reports.push({
              advancedFrames: entry.worker.animation.advancedFrames,
              clip: entry.worker.clip ?? "",
              // The midpoint of both hands, which is what the keyboard is aligned to. Reporting
              // one hand instead made the inspector's own keyboard-under-hands check measure
              // against a point nothing tracks, so it failed by a quarter of a metre for as long
              // as the board was correct.
              hand: (() => {
                const centre = entry.worker.handCentre(HAND);
                return centre === undefined ? undefined : vectorOf(centre);
              })(),
              id,
              keyboard: worldOf(board),
              boardLocal: board === undefined ? undefined : vectorOf(board.position),
              deskIndex: entry.deskIndex,
              phase: entry.phase,
              position: vectorOf(entry.worker.object.position),
              clipAge: Math.round(entry.worker.clipAge * 100) / 100,
              settled: entry.worker.settled,
              stateChanges: entry.worker.stateChanges,
              transitioning: entry.worker.transitioning,
              state: entry.worker.state,
            });
          }
          const cameraReport = {
            pitch: Math.round(camera.rotation.x * 1000) / 1000,
            x: Math.round(camera.position.x * 1000) / 1000,
            y: Math.round(camera.position.y * 1000) / 1000,
            yaw: Math.round(camera.rotation.y * 1000) / 1000,
            z: Math.round(camera.position.z * 1000) / 1000,
          };
          return {
            actors: reports,
            camera: cameraReport,
            alignAttempts,
            alignSkips: Object.fromEntries(alignSkips),
            checks: deriveChecks(reports, camera, cameraReport),
            dt: Math.round(lastDt * 100000) / 100000,
            frames: logTick,
          };
        };
      }
      const focus = sessions[0];
      const focusWorker = focus === undefined ? undefined : workers.get(focus.id);
      if (sessions.length > 0) seenFirstSnapshot = true;
      const roster: SessionRow[] = sessions.map((session) => ({
        host: session.host,
        id: session.id,
        project: session.project,
        state: session.state,
      }));
      const next = {
        arrivals,
        blockedSeen,
        bridgeOnline: bridge.connected,
        departures,
        focusClip: focusWorker?.clip ?? "",
        focusProject: focus?.project ?? "",
        focusState: focusWorker?.state ?? ("none" as const),
        selectedHost: selected?.host ?? "",
        selectedId: selected?.id ?? "",
        selectedProject: selected?.project ?? "",
        selectedSource: selected?.source ?? "",
        selectedState: selected?.state ?? "",
        selectedTool: selected?.tool ?? "",
        visitorX: Math.round(visitor.object.position.x * 100) / 100,
        visitorZ: Math.round(visitor.object.position.z * 100) / 100,
        workerCount: workers.size,
      };
      const current = frameCtx.state.getState();
      const changed = (Object.keys(next) as (keyof typeof next)[]).some(
        (field) => current[field] !== next[field],
      );
      // The roster is an array, so it is compared by content rather than by identity — publishing
      // an equal array every frame would wake every React subscriber ten times a second.
      const rosterChanged = JSON.stringify(current.sessions) !== JSON.stringify(roster);
      if (changed || rosterChanged) frameCtx.state.set({ ...next, sessions: roster });
      void releasePointer;
    };
  }
}

/**
 * Move one actor toward a point and report arrival.
 *
 * The navmesh supplies the next position on the path; the game moves the body, because the walk
 * cycle's rate is matched to the ground the body actually covers and a crowd that teleports its
 * agents would leave the feet skating.
 */
function step(actor: IActor, goal: Vector3, dt: number): boolean {
  const object = actor.worker.object;
  const next = actor.agent?.getNextPathPosition(SCRATCH) ?? SCRATCH.copy(goal);
  next.y = 0;
  const flat = SCRATCH_GOAL.copy(goal);
  flat.y = 0;
  const here = SCRATCH_HERE.copy(object.position);
  here.y = 0;
  if (here.distanceTo(flat) <= ARRIVED_METRES) return true;
  const toward = next.sub(here);
  if (toward.lengthSq() < 1e-6) toward.copy(flat).sub(here);
  if (toward.lengthSq() < 1e-6) return true;
  toward.normalize();
  const stride = Math.min(WALK_SPEED * dt, here.distanceTo(flat));
  // Give way: a worker whose next step would end inside you stops and waits — the office politely
  // queues behind a body instead of walking through one. It resumes the moment you move.
  const nextX = here.x + toward.x * stride;
  const nextZ = here.z + toward.z * stride;
  const fromVisitor = Math.hypot(nextX - VISITOR_AT.x, nextZ - VISITOR_AT.z);
  if (fromVisitor < VISITOR_MARGIN) {
    object.rotation.y = Math.atan2(toward.x, toward.z);
    return false;
  }
  object.position.x = nextX;
  object.position.z = nextZ;
  object.rotation.y = Math.atan2(toward.x, toward.z);
  return false;
}

const HAND = new Vector3();
const SCRATCH = new Vector3();
const SCRATCH_GOAL = new Vector3();
const SCRATCH_HERE = new Vector3();
/** Where you are standing, so walking workers give way instead of crossing the lens. */
const VISITOR_AT = new Vector3();
const obstacleScratch: Vector3[] = [];
/** How close a walking worker will come to you before it stops and waits. */
const VISITOR_MARGIN = 0.6;
/** Scratch for the size audit's world measurements. */
const tmpScale = new Vector3();
const tmpVec = new Vector3();
/**
 * A lit screen glows; it does not become a lamp.
 *
 * The first version drove a near-white emissive at 1.4 and set the panel's diffuse to the same
 * colour, so the two stacked and every monitor clipped to a flat white slab that blew out the
 * worker behind it — bright enough, from two metres, to hide the hands it was supposed to light.
 * The glow is carried by the emissive alone now, over a panel that stays as dark as an unlit one,
 * which is also how a real screen looks: dark glass with an image on it.
 */
const SCREEN_ON = new Color(0x6aa8c4);
const SCREEN_OFF = new Color(0x14161a);
/** Bright enough to pick a working desk out from across the room, dim enough not to clip. */
const SCREEN_GLOW = 0.55;

/** Light or darken one desk's monitor. The material is the desk's own, cloned by `createOffice`. */
function setScreen(screen: Mesh, lit: boolean): void {
  const candidates = Array.isArray(screen.material) ? screen.material : [screen.material];
  const material =
    candidates.find((candidate) => candidate.name === "M_Display_1") ?? candidates[0];
  if (!(material instanceof MeshStandardMaterial)) return;
  const wanted = lit ? SCREEN_ON : SCREEN_OFF;
  if (material.emissive.equals(wanted)) return;
  material.emissive.copy(wanted);
  material.emissiveIntensity = lit ? SCREEN_GLOW : 0;
  // The panel itself stays dark whether lit or not; only the emissive changes.
  material.color.copy(SCREEN_OFF);
  material.needsUpdate = true;
}

/**
 * Entity ids are how a playtest names a worker, so they must be stable, readable and plain.
 *
 * Plain matters: a session id carries a colon, and an entity id that carries one is silently
 * absent from the runner's observations — a scenario that clicks it fails with "no observed
 * screen bounds" and nothing says why.
 */
function entityId(sessionId: string): string {
  return `worker-${sessionId.replace(/[^a-zA-Z0-9]+/g, "-")}`;
}

/**
 * Where a session's worker stands while it idles at the furniture, or nothing to stay seated.
 *
 * Sessions that draw the same piece of furniture still draw their own stand point: the point is
 * fanned out sideways by a stable offset from the id, so two workers at the cabinet stand side by
 * side rather than inside each other.
 */
function spotFor(sessionId: string, room: IOffice): IActivitySpot | undefined {
  const activity = activityForSession(sessionId);
  if (activity === "desk") return undefined;
  const base = room.activities.find((spot) => spot.kind === activity);
  if (base === undefined) return undefined;
  const lateral = ((hashSession(sessionId) % 3) - 1) * 0.45;
  const stand = base.stand.clone();
  stand.x += Math.cos(base.facing) * lateral;
  stand.z -= Math.sin(base.facing) * lateral;
  return { kind: base.kind, facing: base.facing, stand };
}
