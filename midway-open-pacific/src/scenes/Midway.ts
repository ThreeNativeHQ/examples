import { Scene } from "@threenative/core";
import { AudioBus } from "@threenative/core";
import { Vector3 } from "three";
import type { ICtx } from "@threenative/core";
import type * as T from "three";
import { Battle } from "../sim/battle.js";
import { LOADOUTS } from "../sim/armament.js";
import { ASSIGNMENTS, type Assignment } from "../sim/sortie.js";
import { clamp, distance2 } from "../sim/math.js";
import { loadImportedShips } from "../render/imported-ships.js";
import { loadEnvironment } from "../render/environment.js";
import { loadImportedAircraft } from "../render/imported-aircraft.js";
import { loadImportedFleet } from "../render/imported-fleet.js";
import { loadDeckCrew } from "../render/deck-crew.js";
import { WorldView } from "../render/world.js";
import { nullShell, shell, type IHud, type Intent } from "../ui/port.js";
import { Soundscape } from "../audio.js";

export type GameState = Record<string, never>;

/**
 * Every key `action` reacts to, bound by name so the framework latches the press.
 *
 * A one-shot key has to survive a keydown and keyup that land in the same task — which is exactly
 * what a scripted run does — and only `justPressed` sees that. Continuous controls (throttle,
 * stick, guns, transit) are read as held keys instead, because a hold is what they mean.
 */
export const ACTION_KEYS = [
  "Escape", "KeyP", "KeyM", "KeyQ", "Tab",
  "KeyB", "KeyF", "KeyG", "KeyN", "KeyU", "KeyI", "KeyR", "KeyT", "KeyH", "KeyL", "KeyJ",
  "BracketLeft", "BracketRight",
  "KeyC", "F1", "F2", "F3",
  "Digit1", "Digit2", "Digit3", "Digit4",
] as const;

export const ACTION_BINDINGS = Object.fromEntries(ACTION_KEYS.map((code) => [code, { keys: [code] }]));

export class Midway extends Scene<GameState, undefined> {
  static override readonly initialState: GameState = {};

  battle!: Battle;
  world!: WorldView;
  hud!: IHud;
  audio!: Soundscape;
  ctx!: ICtx<GameState, undefined>;
  paused = false;
  overlay: string | null = null;
  wall = 0;
  ended = false;
  started = false;
  private mouseState = { fire: false, looking: false, lx: 0, ly: 0 };
  /**
   * Live pointer view for capture tools. `fire`/`looking` are computed from the framework pointer
   * rather than the last polled frame, so a button release reads false in the same turn the tool
   * asserts it (the previous listener cleared these synchronously and tests depend on that).
   */
  get mouse(): { fire: boolean; looking: boolean; lx: number; ly: number } {
    const buttons = this.ctx?.input?.raw?.pointer?.buttons ?? 0;
    const live = this.battle?.status === "playing" && !this.paused;
    const looking = live && (buttons & 2) !== 0;
    return { fire: live && (buttons & 1) !== 0 && !looking, looking, lx: this.mouseState.lx, ly: this.mouseState.ly };
  }
  /** The held keys the scene is acting on; exposed because capture tools read `midway.keys`. */
  get keys(): ReadonlySet<string> {
    return this.ctx?.input?.raw?.keys ?? new Set<string>();
  }
  /** Briefing selection, kept on the scene so it survives a restart into a fresh Battle. */
  assignment: Assignment = "strike";
  private audioBuffers: ReadonlyMap<string, AudioBuffer> = new Map();
  private camPos = new Vector3();
  private nextAlbatross = 0;
  private cleanups: Array<() => void> = [];

  async load(ctx: ICtx<GameState, undefined>): Promise<void> {
    const [, , , , , buffers] = await Promise.all([
      loadImportedAircraft(ctx),
      loadImportedShips(ctx),
      loadImportedFleet(ctx),
      loadDeckCrew(ctx),
      loadEnvironment(ctx),
      Soundscape.load(ctx.assets),
    ]);
    this.audioBuffers = buffers;
    // Keep the opaque loading layer up until the first update has built the world and placed the
    // camera; hiding it here showed a few frames of an unlit, half-built scene.
  }

  enter(ctx: ICtx<GameState, undefined>): void {
    this.ctx = ctx;
    this.battle = new Battle();
    this.world = new WorldView({ scene: ctx.scene, camera: ctx.camera as T.PerspectiveCamera, renderer: ctx.renderer, viewport: ctx.viewport, add: (object) => ctx.add(object) }, this.battle);
    this.hud = shell.hud(this.battle, this.world);
    this.audio = new Soundscape(
      this.audioBuffers,
      new AudioBus({ camera: ctx.camera, maxVoices: 48 }),
      new AudioBus({ camera: ctx.camera, maxVoices: 16 }),
    );
    this.cleanups.push(shell.onIntent((intent) => this.intent(intent)));
    this.updateLoadoutUI();
    this.updateAssignmentUI();
    shell.screen("flight", false);
    void ctx.startup.whenReady().then(() => {
      this.started = true;
      shell.screen("loading", false);
      if (this.battle.status !== "briefing") return;
      // Nothing on a native target can click "take the deck", so the sortie starts itself.
      if (shell === nullShell) this.begin(false);
      else shell.screen("briefing", true);
    });
  }

  exit(): void {
    this.audio.dispose();
    this.world.crew.dispose();
    for (const off of this.cleanups) off();
    this.cleanups = [];
  }

  /** One switch for everything the player asks for, whatever surface asked it. */
  private intent(intent: Intent): void {
    switch (intent.kind) {
      case "begin":
        this.begin(intent.airborne, intent.fresh);
        break;
      case "briefing":
        this.restartToBriefing();
        break;
      case "key":
        this.action(intent.code);
        break;
      case "close":
        this.hideOverlays();
        break;
      case "overlay":
        this.showOverlay(intent.id);
        break;
      case "loadout":
        this.selectLoadout(intent.id);
        break;
      case "assignment":
        this.selectAssignment(intent.id);
        break;
      case "quality":
        this.world.setQuality(intent.id);
        break;
      case "command":
        this.command(intent.id);
        break;
      case "next-target":
        this.cycleTarget();
        break;
      case "home":
        this.goHome();
        this.hideOverlays();
        break;
      case "audio":
        this.audio.start();
        this.audio.muted = !this.audio.muted;
        break;
      case "target":
        this.battle.target = intent.id;
        this.battle.player.nav = "search";
        this.hud.lastContacts = "";
        this.hud.updateContactList();
        this.hud.drawMap();
        break;
      case "suspend":
        this.clearInput();
        if (this.battle.status === "playing" && !this.paused) this.showOverlay("pause-overlay");
        break;
    }
  }

  /**
   * Reads this frame's input from the framework rather than the window.
   *
   * `ctx.input` is the one surface the desktop and playtest transports can drive, so the keyboard
   * and mouse work identically in a browser, in a native window and under a scripted run.
   */
  private pollInput(): { keys: ReadonlySet<string>; fire: boolean } {
    const input = this.ctx.input;
    for (const code of ACTION_KEYS) if (input.justPressed(code)) this.action(code);
    const raw = input.raw;
    const live = this.battle.status === "playing" && !this.paused;
    const looking = live && (raw.pointer.buttons & 2) !== 0;
    const fire = live && (raw.pointer.buttons & 1) !== 0 && !looking;
    if (fire && !this.mouseState.fire) this.audio.start();
    const { x, y } = raw.pointer.position;
    if (looking && this.mouseState.looking) {
      this.world.lookYaw = clamp((this.world.lookYaw || 0) + (x - this.mouseState.lx) * 0.005, -2.7, 2.7);
      this.world.lookPitch = clamp((this.world.lookPitch || 0) - (y - this.mouseState.ly) * 0.004, -0.8, 0.95);
    }
    this.mouseState.fire = fire;
    this.mouseState.looking = looking;
    this.mouseState.lx = x;
    this.mouseState.ly = y;
    this.world.lookActive = looking;
    return { keys: raw.keys, fire };
  }

  update(_ctx: ICtx<GameState, undefined>, dt: number): void {
    this.wall += dt;
    const b = this.battle;
    const { keys, fire: mouseFire } = this.pollInput();
    const inFlight = b.status === "playing" && !this.paused;
    let speed = 1;
    if (inFlight) {
      const turn = (keys.has("ArrowRight") || keys.has("KeyD") ? 1 : 0) - (keys.has("ArrowLeft") || keys.has("KeyA") ? 1 : 0);
      // Inverted pitch, as a flight-sim stick: pulling back (Down) raises the nose. The mouse
      // never commands pitch or roll — it fires the guns and, held right, moves the view.
      const pitch = (keys.has("ArrowDown") ? 1 : 0) - (keys.has("ArrowUp") ? 1 : 0);
      const input = {
        turn,
        pitch,
        rudder: (keys.has("KeyE") ? 1 : 0) - (keys.has("KeyZ") ? 1 : 0),
        wheelBrake: keys.has("KeyK"),
        throttleUp: keys.has("KeyW"),
        throttleDown: keys.has("KeyS"),
        fire: keys.has("Space") || mouseFire,
      };
      this.world.rear = keys.has("KeyV");
      speed = (keys.has("ShiftLeft") || keys.has("ShiftRight")) && b.canAccelerate() ? 3 : 1;
      for (let i = 0; i < speed; i += 1) b.step(1 / 60, input);
      for (const e of b.events.splice(0)) {
        this.audio.event(e);
        if (e.type === "notice") this.hud.toast(e.text);
        if (e.type === "damage") this.hud.hitFlash = 1;
      }
    }
    this.world.update(this.paused ? 0 : dt, this.wall, b.status === "briefing");
    shell.cockpitView(this.world.cockpit);
    this.hud.update(dt, speed);
    const p = b.player;
    const onShip = p.mode === "deck" || p.mode === "launch" || p.mode === "arrest" || p.mode === "service";
    const nearShip = onShip || b.ships.some((s: any) => s.team === "us" && s.kind === "carrier" && !s.sunk && distance2(s, p) < 1800 * 1800);
    this.world.camera.getWorldPosition(this.camPos);
    this.audio.update(
      {
        cockpit: this.world.cameraMode === 1 && !this.world.followBomb,
        onDeck: onShip,
        nearPA: nearShip,
        listener: { x: this.camPos.x, y: this.camPos.y, z: this.camPos.z },
        deckSpeed: p.deckSpeed ?? p.speed ?? 0,
        engineCut: p.engineCut,
        damage: 1 - (p.damage?.engine?.integrity ?? 1),
        stall: p.stall ?? 0,
        gforce: p.gforce ?? 1,
        rpm: p.rpm ?? p.throttle ?? 0,
        throttle: p.throttle ?? 0,
        ias: p.ias ?? p.speed ?? 0,
      },
      this.paused || b.status !== "playing",
      dt,
    );
    // Continuous world loops follow the scene: a burning hull hisses where it is, the atoll surf
    // only exists near the atoll. Passing the full set each frame makes a stopped loop impossible.
    const emitters: Array<{ id: string; key: string; source: unknown; volume: number }> = [];
    for (const s of b.ships) {
      if (s.sunk || !(s.fire > 0.12)) continue;
      const mesh = this.world.meshes.get(s.id);
      if (mesh) emitters.push({ id: `fire-${s.id}`, key: "fuelFire", source: mesh, volume: Math.min(0.85, 0.35 + s.fire * 0.35) });
    }
    const island = b.island;
    if (island) {
      const range = Math.sqrt(distance2(island, p));
      if (range < 4000) emitters.push({ id: "reef", key: "reefSurf", source: { x: island.x, y: 0, z: island.z }, volume: Math.min(0.5, 0.5 * (1 - range / 4000)) });
    }
    // AI aircraft engines carry their airframe identity: a TBD, Wildcat, Catalina, Zero, Val or
    // Kate is heard as itself, at its own state band, not as the player's Dauntless.
    const AI_ENGINE: Record<string, { idle: string; cruise: string; power: string }> = {
      sbd: { idle: "engineExtIdle", cruise: "engineExtCruise", power: "engineExtPower" },
      tbd: { idle: "tbdEngineExtIdle", cruise: "tbdEngineExtCruise", power: "tbdEngineExtPower" },
      wildcat: { idle: "wildcatEngineExtIdle", cruise: "wildcatEngineExtCruise", power: "wildcatEngineExtPower" },
      catalina: { idle: "catalinaEngineExtIdle", cruise: "catalinaEngineExtCruise", power: "catalinaEngineExtPower" },
      zero: { idle: "zeroEngineExtIdle", cruise: "zeroEngineExtCruise", power: "zeroEngineExtPower" },
      val: { idle: "valEngineExtIdle", cruise: "valEngineExtCruise", power: "valEngineExtPower" },
      kate: { idle: "kateEngineExtIdle", cruise: "kateEngineExtCruise", power: "kateEngineExtPower" },
    };
    for (const a of b.aircraft) {
      if (a.hp <= 0 || a.mode === "crashing") continue;
      const banks = AI_ENGINE[a.airframe];
      const mesh = this.world.meshes.get(a.id);
      if (!banks || !mesh) continue;
      const range = Math.sqrt(distance2(a, p));
      if (range > 2600) continue;
      const rpm = a.rpm ?? 0.7;
      const key = rpm < 0.4 ? banks.idle : rpm < 0.72 ? banks.cruise : banks.power;
      emitters.push({ id: `eng-${a.id}`, key, source: mesh, volume: Math.min(0.5, 0.5 * (1 - range / 2600)) });
    }
    this.audio.syncEmitters(emitters);
    if (island && Math.sqrt(distance2(island, p)) < 3000 && this.wall > this.nextAlbatross) {
      this.nextAlbatross = this.wall + 9 + Math.random() * 12;
      this.audio.event({ cue: "albatross", at: { x: island.x + 150, y: 20, z: island.z + 150 } });
    }
    if ((b.status === "lost" || b.status === "won" || b.status === "debrief") && !this.ended) {
      this.ended = true;
      this.clearInput();
      this.hud.debrief();
    }
  }

  /** Drops the mouse state only: held keys are the framework's, and it clears them on blur. */
  private clearInput(): void {
    this.mouseState.fire = false;
    this.mouseState.looking = false;
    this.world.rear = false;
    this.world.lookActive = false;
  }

  private hideOverlays(): void {
    shell.overlay(null);
    this.overlay = null;
    this.hud.mapOpen = false;
    this.paused = false;
    this.clearInput();
  }

  private showOverlay(id: string): void {
    if (this.overlay === id) {
      this.hideOverlays();
      return;
    }
    this.hideOverlays();
    this.overlay = id;
    this.paused = true;
    shell.overlay(id);
    this.hud.mapOpen = id === "map-overlay";
    this.updateLoadoutUI();
    if (this.hud.mapOpen) {
      this.hud.drawMap();
      this.hud.lastContacts = "";
      this.hud.updateContactList();
    }
  }

  private begin(airborne = false, fresh = false): void {
    this.hideOverlays();
    shell.screen("debrief", false);
    this.ended = false;
    if (fresh) {
      const choice = this.battle.player.loadout;
      this.battle = new Battle();
      this.battle.selectAssignment(this.assignment);
      this.battle.selectLoadout(choice);
      this.world.reset(this.battle);
      this.hud.b = this.battle;
      this.hud.lastRadio = "";
      this.hud.lastContacts = "";
      this.hud.hitFlash = 0;
    }
    this.audio.start();
    this.battle.start(airborne);
    this.updateLoadoutUI();
    shell.screen("briefing", false);
    shell.screen("flight", true);
    this.clearInput();
    this.world.snap = true;
    this.world.followBomb = false;
    this.hud.toast(airborne ? "SCOUT TWO — SEARCH THE NORTHWEST SECTOR" : "HOLD W TO ADVANCE THE THROTTLE");
  }

  private restartToBriefing(): void {
    this.hideOverlays();
    this.battle = new Battle();
    this.battle.selectAssignment(this.assignment);
    this.world.reset(this.battle);
    this.hud.b = this.battle;
    this.hud.lastRadio = "";
    this.hud.lastContacts = "";
    this.hud.hitFlash = 0;
    this.ended = false;
    this.updateAssignmentUI();
    shell.screen("flight", false);
    shell.screen("briefing", true);
    shell.screen("debrief", false);
    this.updateLoadoutUI();
  }

  private updateLoadoutUI(): void {
    const p = this.battle.player;
    const id = p.loadout || "bomb";
    const torpedo = id === "torpedo";
    const can = p.mode === "deck" && (p.deckSpeed || 0) < 0.5;
    shell.loadout({
      id,
      name: LOADOUTS[id].name,
      tagTitle: torpedo ? "DOUGLAS TBD DEVASTATOR" : "DOUGLAS SBD DAUNTLESS",
      tagRole: torpedo ? "TORPEDO BOMBER · PROCEDURAL TBD-INSPIRED MODEL" : "SCOUT BOMBER · BOMBING SQUADRON SIX",
      note: torpedo ? "Low, slow, straight run · 1 aerial torpedo · no dive brakes" : "Steep dive attack · perforated dive brakes · lighter wing stores",
      deckEnabled: can,
      deckNote: can ? "Changes aircraft and payload." : "Stop on the flight deck to change loadout.",
    });
  }

  /** The briefing choice outlives a restart, so replay launches the assignment the player picked. */
  private selectAssignment(id: string): void {
    if (!this.battle.selectAssignment(id)) return;
    this.assignment = id as Assignment;
    this.updateAssignmentUI();
  }

  private updateAssignmentUI(): void {
    shell.assignment(this.assignment, ASSIGNMENTS[this.assignment].brief);
  }

  private selectLoadout(id: string): void {
    if (!this.battle.selectLoadout(id)) {
      this.hud.toast("LOADOUT LOCKED — STOP ON DECK FIRST");
      this.updateLoadoutUI();
      return;
    }
    this.world.setAirframe();
    this.updateLoadoutUI();
  }

  private setCamera(mode: number): void {
    this.world.setCamera(mode);
    this.hud.toast(["CHASE CAMERA", "PILOT COCKPIT — HOLD RIGHT MOUSE TO LOOK", "WIDE CHASE CAMERA"][mode]);
  }

  private goHome(): void {
    const home = this.battle.goHome();
    if (!home) {
      this.hud.toast("NO OPERATIONAL FRIENDLY FLIGHT DECK");
      return;
    }
    this.hud.toast(`RETURN COURSE — ${home.name.toUpperCase()}`);
  }

  private cycleTarget(): void {
    const cs = [...this.battle.contacts.values()].filter((c) => c.kind === "carrier");
    if (!cs.length) {
      this.hud.toast("NO KNOWN CARRIER CONTACTS");
      return;
    }
    const index = cs.findIndex((c) => c.id === this.battle.target);
    const next = cs[(index + 1) % cs.length];
    this.battle.target = next.id;
    this.battle.player.nav = "search";
    this.hud.toast(`DESIGNATED: ${next.name.toUpperCase()}`);
  }

  private command(cmd: string): void {
    this.battle.setCommand(cmd);
    this.hideOverlays();
    this.hud.toast(`SQUADRON ORDER: ${cmd.toUpperCase()}`);
  }

  private action(code: string): void {
    if (code === "Escape" || code === "KeyP" || code === "Slash") {
      if (this.overlay) this.hideOverlays();
      else this.showOverlay("pause-overlay");
      return;
    }
    if (code === "KeyM") {
      this.showOverlay("map-overlay");
      return;
    }
    if (code === "KeyQ") {
      this.showOverlay("command-overlay");
      return;
    }
    if (this.overlay === "command-overlay" && /^Digit[1-4]$/.test(code)) {
      this.command(["cover", "strike", "engage", "rtb"][Number(code.slice(-1)) - 1]);
      return;
    }
    if (this.paused || this.battle.status !== "playing") return;
    const p = this.battle.player;
    switch (code) {
      case "KeyB":
        this.battle.releaseOrdnance();
        break;
      case "KeyF":
        if (p.airframe === "tbd") {
          this.hud.toast("TBD HAS NO DIVE BRAKES — REDUCE THROTTLE");
          break;
        }
        p.brakes = !p.brakes;
        this.hud.toast(`DIVE BRAKES ${p.brakes ? "EXTENDED" : "RETRACTED"}`);
        break;
      case "KeyG":
        if (p.mode === "deck" || p.mode === "arrest") {
          this.hud.toast("GEAR LOCKED WHILE ON DECK");
          break;
        }
        this.battle.toggleGear();
        this.hud.toast(`LANDING GEAR ${p.gear ? "DOWN" : "UP"}`);
        break;
      case "KeyN":
        p.flaps = p.flaps < 0.15 ? 0.33 : p.flaps < 0.7 ? 1 : 0;
        this.hud.toast(`FLAPS ${p.flaps === 0 ? "UP" : p.flaps < 0.7 ? "TAKEOFF" : "LANDING"}`);
        break;
      case "KeyU":
        p.assist = !p.assist;
        this.hud.toast(p.assist ? "STABILITY ASSIST ON" : "DIRECT FLIGHT — ROLL AND TRIM ARE YOURS");
        break;
      case "BracketLeft":
        p.trim = clamp(p.trim - 0.012, -0.1, 0.18);
        this.hud.toast(`PITCH TRIM ${(p.trim * 57.3).toFixed(1)}°`);
        break;
      case "BracketRight":
        p.trim = clamp(p.trim + 0.012, -0.1, 0.18);
        this.hud.toast(`PITCH TRIM ${(p.trim * 57.3).toFixed(1)}°`);
        break;
      case "KeyC":
        this.setCamera((this.world.cameraMode + 1) % 3);
        break;
      case "F1":
        this.setCamera(1);
        break;
      case "F2":
        this.setCamera(0);
        break;
      case "F3":
        this.setCamera(2);
        break;
      case "KeyI":
        p.engineCut = !p.engineCut;
        this.hud.toast(p.engineCut ? "ENGINE FUEL CUTOFF — ENGINE STOPPING / WING FIRES UNAFFECTED" : "ENGINE FUEL VALVE OPEN");
        break;
      case "KeyR":
        this.battle.report();
        break;
      case "KeyT":
        p.autopilot = !p.autopilot;
        if (p.autopilot) {
          p.nav = "search";
        }
        this.hud.toast(`COURSE HOLD ${p.autopilot ? "ENGAGED" : "OFF"}`);
        break;
      case "KeyH":
        this.goHome();
        break;
      case "KeyL":
        this.battle.assistRecovery();
        break;
      case "KeyJ":
        this.world.followBomb = !this.world.followBomb;
        this.world.snap = true;
        this.hud.toast(this.world.followBomb ? "WEAPON FOLLOW CAMERA" : "AIRCRAFT CAMERA");
        break;
      case "Tab":
        this.cycleTarget();
        break;
      case "Digit1":
        this.command("cover");
        break;
      case "Digit2":
        this.command("strike");
        break;
      case "Digit3":
        this.command("engage");
        break;
      case "Digit4":
        this.command("rtb");
        break;
    }
  }
}
