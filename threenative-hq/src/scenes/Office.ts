import { type ICtx, Scene, type SceneFrame, isMobile, isWeb } from "@threenative/core";
import type { IPhysicsContext } from "@threenative/physics";
import { CollisionShape3D, RigidBody3D } from "@threenative/physics";
import { NavigationAgent3D, NavigationRegion3D } from "@threenative/physics/navigation";
import type { AnimationClip, Group, PerspectiveCamera } from "three";
import { Color, Mesh, MeshStandardMaterial, Vector3 } from "three";
import { BridgeClient } from "../office/bridge-client.js";
import { Worker } from "../office/Worker.js";
import { type ActorPhase, assignDesks, workerStateFor } from "../office/floor.js";
import { requiredClips } from "../office/states.js";
import { setupOfficeLighting } from "../render/lighting.js";
import { type IOffice, createOffice } from "../render/office.js";
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

interface IActor {
  readonly worker: Worker;
  readonly agent: NavigationAgent3D | undefined;
  phase: ActorPhase;
  deskIndex: number;
}

export class Office extends Scene<GameState, IPhysicsContext> {
  #rig: Group | undefined;
  #clips: readonly AnimationClip[] = [];

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
    // Two CC0 libraries, one rig: library 1 carries the mannequin and the walk and sitting clips,
    // library 2 the phone call. Both were authored on the same 65-joint skeleton, so the clips
    // merge onto one mixer without retargeting — checked here rather than assumed.
    const [base, extra] = await Promise.all([
      ctx.assets.model<{ scene: Group; animations: AnimationClip[] }>("worker.glb"),
      ctx.assets.model<{ scene: Group; animations: AnimationClip[] }>("worker-clips-2.glb"),
    ]);
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

    const room: IOffice = createOffice(DESK_COUNT);
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
    // except now you can walk out of it.
    const visitor = new Visitor(ctx, new Vector3(11.6, 1.0, 4.6), 1.19, {
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
      visitor.update(frameCtx, dt, camera);
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
          actor = { agent, deskIndex, phase: walks ? "walkingIn" : "seated", worker };
          actors.set(session.id, actor);
        }
        if (actor.deskIndex !== deskIndex) {
          actor.deskIndex = deskIndex;
          if (actor.phase === "walkingIn") actor.agent?.setTargetPosition(desk.stand);
        }
        const state = workerStateFor(session);
        if (state === "blocked") blockedSeen = true;
        if (actor.phase === "walkingIn") {
          actor.worker.setState("arriving");
          if (step(actor, desk.stand, dt)) {
            actor.phase = "seated";
            actor.worker.setState(state);
          }
        } else {
          actor.worker.setState(state);
          // A standing worker steps back from the chair; a seated one sits in it.
          actor.worker.object.position.copy(actor.worker.standing ? desk.stand : desk.seat);
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
            const hand = actor.worker.handPosition(HAND);
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
        (globalThis as Record<string, unknown>).__hq = () => {
          const reports: IActorReport[] = [];
          for (const [id, entry] of actors) {
            const board = room.desks[entry.deskIndex]?.keyboard;
            reports.push({
              advancedFrames: entry.worker.animation.advancedFrames,
              clip: entry.worker.clip ?? "",
              hand: worldOf(
                entry.worker.object.getObjectByName("hand_r") ??
                  entry.worker.object.getObjectByName("hand_l"),
              ),
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
          const headAt = worldOf(visitor.object.getObjectByName("Head"));
          const chestAt = worldOf(visitor.object.getObjectByName("spine_03"));
          const cameraReport = {
            chestY: chestAt?.[1],
            headDistance:
              headAt === undefined
                ? undefined
                : Math.hypot(camera.position.x - headAt[0], camera.position.z - headAt[2]),
            headY: headAt?.[1],
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
  object.position.addScaledVector(toward, Math.min(WALK_SPEED * dt, here.distanceTo(flat)));
  object.rotation.y = Math.atan2(toward.x, toward.z);
  return false;
}

const HAND = new Vector3();
const SCRATCH = new Vector3();
const SCRATCH_GOAL = new Vector3();
const SCRATCH_HERE = new Vector3();
const SCREEN_ON = new Color(0x9fd4e8);
const SCREEN_OFF = new Color(0x14161a);

/** Light or darken one desk's monitor. The material is the desk's own, cloned by `createOffice`. */
function setScreen(screen: Mesh, lit: boolean): void {
  const material = screen.material;
  if (!(material instanceof MeshStandardMaterial)) return;
  const wanted = lit ? SCREEN_ON : SCREEN_OFF;
  if (material.emissive.equals(wanted)) return;
  material.emissive.copy(wanted);
  material.emissiveIntensity = lit ? 1.4 : 0;
  material.color.copy(lit ? SCREEN_ON : SCREEN_OFF);
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
