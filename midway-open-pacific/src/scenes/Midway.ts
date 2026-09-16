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
import { loadImportedFleet, loadImportedHulls } from "../render/imported-fleet.js";
import { loadDeckCrew } from "../render/deck-crew.js";
import { WorldView } from "../render/world.js";
import { Hud } from "../hud.js";
import { Soundscape } from "../audio.js";

export type GameState = Record<string, never>;

const $ = (id: string) => document.getElementById(id) as HTMLElement;

export class Midway extends Scene<GameState, undefined> {
  static override readonly initialState: GameState = {};

  battle!: Battle;
  world!: WorldView;
  hud!: Hud;
  audio!: Soundscape;
  ctx!: ICtx<GameState, undefined>;
  paused = false;
  overlay: string | null = null;
  wall = 0;
  ended = false;
  private crashCam = false;
  started = false;
  keys = new Set<string>();
  mouse = { fire: false, looking: false, lx: 0, ly: 0 };
  /** Briefing selection, kept on the scene so it survives a restart into a fresh Battle. */
  assignment: Assignment = "strike";
  private audioBuffers: ReadonlyMap<string, AudioBuffer> = new Map();
  private camPos = new Vector3();
  private nextAlbatross = 0;
  private cleanups: Array<() => void> = [];

  async load(ctx: ICtx<GameState, undefined>): Promise<void> {
    const [, , , , , , buffers] = await Promise.all([
      loadImportedAircraft(ctx),
      loadImportedShips(ctx),
      loadImportedFleet(ctx),
      // The imported hulls the fleet is built from — Yorktown, the three Japanese carriers, the
      // cruisers, destroyers and submarines. Their sizes come from src/sim/catalog.ts, which
      // `Battle` has already read; this only brings in the geometry to draw them with.
      loadImportedHulls(ctx),
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
    // The combat particle buffers are repacked for the camera once per actual world draw. The
    // engine's own beforeRender phase keeps the packing off the particle meshes: an own mesh
    // onBeforeRender marks the whole scene un-batchable at the full roster.
    this.cleanups.push(ctx.beforeRender(() => this.world.particles.prepare(this.world.camera.position)));
    // Midway has one main camera and buffer-only draw hooks. Prepare world transforms once per
    // world draw in the engine's beforeRender seam, which runs before the render projection
    // reconciles and hands the renderer the mirror scene; an authored-scene onBeforeRender never
    // fires while projecting, so the walk would go stale. Shadow and reflection passes (which draw
    // through their own cameras) reuse the transforms prepared here.
    const scene = ctx.scene;
    const savedAutoUpdate = scene.matrixWorldAutoUpdate;
    if (savedAutoUpdate) {
      scene.matrixWorldAutoUpdate = false;
      this.cleanups.push(ctx.beforeRender(() => scene.updateMatrixWorld()));
      this.cleanups.push(() => {
        scene.matrixWorldAutoUpdate = savedAutoUpdate;
      });
    }
    this.hud = new Hud(this.battle, this.world);
    // HUD state, timers and input feedback update on every fixed simulation tick; the canvas is
    // drawn once per presented frame from the latest state. `hud.update` used to clear and redraw
    // here for every fixed tick, so catch-up ticks repainted states that were never presented.
    this.cleanups.push(ctx.beforeRender(() => this.hud.draw()));
    this.audio = new Soundscape(
      this.audioBuffers,
      new AudioBus({ camera: ctx.camera, maxVoices: 48 }),
      new AudioBus({ camera: ctx.camera, maxVoices: 16 }),
    );
    this.attachInput();
    this.updateLoadoutUI();
    $("flight-ui").classList.add("hidden");
    void ctx.startup.whenReady().then(() => {
      this.started = true;
      $("loading").classList.add("hidden");
      if (this.battle.status === "briefing") $("briefing").classList.remove("hidden");
      // Compile the unseen views now, while the briefing is up and the player is reading it —
      // never on the way to the briefing. Precompiling these subtrees is genuinely expensive
      // (measured in tens of seconds on this scene, whether through the engine's whole-scene
      // `warmUpScene` or a targeted `compileAsync`), so putting it in front of the loading gate
      // trades a one-second stall for a minute of launch. Unawaited on purpose: the briefing is
      // idle time, the compile yields, and a player who presses on before it finishes is no worse
      // off than they were without it.
      void this.world.warmUpViews();
    });
  }

  exit(): void {
    this.audio.dispose();
    this.world.crew.dispose();
    this.world.ripples.dispose();
    this.world.ocean.dispose();
    this.world.particles.dispose();
    for (const off of this.cleanups) off();
    this.cleanups = [];
    this.keys.clear();
  }

  private on<K extends keyof WindowEventMap>(target: Window, type: K, handler: (event: WindowEventMap[K]) => void): void {
    target.addEventListener(type, handler);
    this.cleanups.push(() => target.removeEventListener(type, handler));
  }

  private onElement(target: HTMLElement, type: string, handler: (event: Event) => void): void {
    this.onTarget(target, type, handler);
  }

  /** Every listener the scene takes out has to come back on exit, document ones included. */
  private onTarget(target: EventTarget, type: string, handler: (event: Event) => void): void {
    target.addEventListener(type, handler);
    this.cleanups.push(() => target.removeEventListener(type, handler));
  }

  private attachInput(): void {
    const buttons: Record<string, () => void> = {
      "start-deck": () => this.begin(false),
      "start-air": () => this.begin(true),
      "brief-help": () => this.showOverlay("pause-overlay"),
      "btn-camera": () => this.action("KeyC"),
      "btn-pause": () => this.showOverlay("pause-overlay"),
      "btn-map": () => this.showOverlay("map-overlay"),
      "close-pause": () => this.hideOverlays(),
      "close-map": () => this.hideOverlays(),
      "close-command": () => this.hideOverlays(),
      resume: () => this.hideOverlays(),
      "restart-deck": () => this.begin(false, true),
      "restart-air": () => this.begin(true, true),
      "restart-pause": () => this.restartToBriefing(),
      "map-home": () => {
        this.goHome();
        this.hideOverlays();
      },
      "take-aircraft": () => this.takeAnotherAircraft(),
      "btn-audio": () => {
        this.audio.start();
        this.audio.muted = !this.audio.muted;
        $("btn-audio").textContent = this.audio.muted ? "SOUND OFF" : "SOUND ON";
      },
      fullscreen: async () => {
        try {
          if (!document.fullscreenElement) await document.documentElement.requestFullscreen();
          else await document.exitFullscreen();
        } catch {
          this.hud.toast("FULLSCREEN IS NOT AVAILABLE IN THIS VIEW");
        }
      },
    };
    for (const [id, fn] of Object.entries(buttons)) {
      const el = document.getElementById(id);
      if (el) this.onElement(el, "click", fn);
    }
    for (const id of ["bomb", "torpedo"]) {
      const el = $("loadout-" + id);
      if (el) this.onElement(el, "click", () => this.selectLoadout(id));
    }
    const assignment = document.getElementById("assignment-select") as HTMLSelectElement | null;
    if (assignment) {
      assignment.value = this.assignment;
      this.onElement(assignment, "change", (e) => this.selectAssignment((e.target as HTMLSelectElement).value));
    }
    const deckLoadout = $("deck-loadout") as HTMLSelectElement;
    this.onElement(deckLoadout, "change", (e) => this.selectLoadout((e.target as HTMLSelectElement).value));
    const quality = $("quality") as HTMLSelectElement;
    this.onElement(quality, "change", (e) => this.world.setQuality((e.target as HTMLSelectElement).value));
    this.onElement($("command-buttons"), "click", (e) => {
      const btn = (e.target as HTMLElement).closest("[data-command]") as HTMLElement | null;
      if (btn) this.command((btn as HTMLElement).dataset.command as string);
    });
    this.onElement($("contact-list"), "click", (e) => {
      const btn = (e.target as HTMLElement).closest("[data-contact]") as HTMLElement | null;
      if (btn) this.designateTarget(btn.dataset.contact as string);
    });
    this.onElement($("big-map"), "click", (e) => {
      const canvas = e.target as HTMLCanvasElement;
      const rect = canvas.getBoundingClientRect();
      const x = ((e as MouseEvent).clientX - rect.left) / rect.width * canvas.width;
      const y = ((e as MouseEvent).clientY - rect.top) / rect.height * canvas.height;
      const nearest = this.hud.mapItems.map((p) => ({ ...p, d: Math.hypot(p.x - x, p.y - y) })).sort((a, b) => a.d - b.d)[0];
      if (nearest && nearest.d < 55) this.designateTarget(nearest.id);
    });
    this.on(window, "keydown", (e) => {
      if ((e.target as HTMLElement).matches("select,input,textarea")) return;
      if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Tab", "F1", "F2", "F3"].includes(e.code)) e.preventDefault();
      if (!e.repeat) {
        this.keys.add(e.code);
        this.action(e.code);
      } else this.keys.add(e.code);
    });
    this.on(window, "keyup", (e) => {
      this.keys.delete(e.code);
      if (e.code === "KeyV") this.world.rear = false;
    });
    this.on(window, "blur", () => {
      this.clearInput();
      if (this.battle.status === "playing" && !this.paused) this.showOverlay("pause-overlay");
    });
    this.onTarget(document, "visibilitychange", () => {
      if (document.hidden) {
        this.clearInput();
        if (this.battle.status === "playing" && !this.paused) this.showOverlay("pause-overlay");
      }
    });
    this.on(window, "pointerdown", (e) => {
      if ((e.target as HTMLElement).closest("button,select,.dialog") || this.battle.status !== "playing" || this.paused) return;
      if (e.button === 2) {
        this.mouse.looking = true;
        this.mouse.lx = e.clientX;
        this.mouse.ly = e.clientY;
        this.world.lookActive = true;
        return;
      }
      if (e.button !== 0 || this.mouse.looking) return;
      this.audio.start();
      this.mouse.fire = true;
    });
    this.on(window, "pointerup", (e) => {
      if (e.button === 0) this.mouse.fire = false;
      if (e.button === 2) {
        this.mouse.looking = false;
        this.world.lookActive = false;
      }
    });
    this.on(window, "pointermove", (e) => {
      if (this.paused) return;
      if (this.mouse.looking) {
        this.world.lookYaw = clamp((this.world.lookYaw || 0) + (e.clientX - this.mouse.lx) * 0.005, -2.7, 2.7);
        this.world.lookPitch = clamp((this.world.lookPitch || 0) - (e.clientY - this.mouse.ly) * 0.004, -0.8, 0.95);
        this.mouse.lx = e.clientX;
        this.mouse.ly = e.clientY;
      }
    });
    this.on(window, "contextmenu", (e) => {
      if (this.battle.status === "playing") e.preventDefault();
    });
  }

  update(_ctx: ICtx<GameState, undefined>, dt: number): void {
    this.wall += dt;
    const b = this.battle;
    const inFlight = b.status === "playing" && !this.paused;
    if (inFlight) {
      let turn = (this.keys.has("ArrowRight") || this.keys.has("KeyD") ? 1 : 0) - (this.keys.has("ArrowLeft") || this.keys.has("KeyA") ? 1 : 0);
      // Inverted pitch, as a flight-sim stick: pulling back (Down) raises the nose. The mouse
      // never commands pitch or roll — it fires the guns and, held right, moves the view.
      const pitch = (this.keys.has("ArrowDown") ? 1 : 0) - (this.keys.has("ArrowUp") ? 1 : 0);
      const input = {
        turn,
        pitch,
        rudder: (this.keys.has("KeyE") ? 1 : 0) - (this.keys.has("KeyZ") ? 1 : 0),
        wheelBrake: this.keys.has("KeyK"),
        throttleUp: this.keys.has("KeyW"),
        throttleDown: this.keys.has("KeyS"),
        fire: this.keys.has("Space") || this.mouse.fire,
      };
      this.world.rear = this.keys.has("KeyV");
      // Shift is a simulation control only: it runs extra fixed steps, and never touches
      // thrust, the camera, animation rates or audio. `canAccelerate()` gates it to level
      // flight above 120 m, undamaged, with no enemy aircraft within 2400 m or ship within
      // 2800 m, so it can never fast-forward a fight.
      const speed =
        (this.keys.has("ShiftLeft") || this.keys.has("ShiftRight")) && b.canAccelerate() ? 3 : 1;
      for (let i = 0; i < speed; i += 1) b.step(1 / 60, input);
      for (const e of b.events.splice(0)) {
        this.audio.event(e);
        if (e.type === "notice") this.hud.toast(e.text);
        if (e.type === "damage") this.hud.hitFlash = 1;
      }
    }
    this.world.update(this.paused ? 0 : dt, this.wall, b.status === "briefing");
    this.hud.update(dt);
    const p = b.player;
    const onShip = p.mode === "deck" || p.mode === "launch" || p.mode === "arrest" || p.mode === "service";
    const nearShip = onShip || b.ships.some((s: any) => s.team === "us" && s.kind === "carrier" && !s.sunk && distance2(s, p) < 1800 * 1800);
    this.world.camera.getWorldPosition(this.camPos);
    this.audio.update(
      {
        cockpit: this.world.cameraMode === 1 && !this.world.followBomb,
        airframe: p.airframe,
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
        brakes: p.brakes,
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
    // The player's own aircraft burns like any other wreck once it is going down, and the chase
    // camera is right on top of it — the fire has to be heard there, not only on distant hulls.
    const ownFire = p.mode === "wreck" ? 0 : Math.max(p.damage?.engine?.fire ?? 0, p.mode === "crashing" ? 0.7 : 0);
    if (ownFire > 0.12 && this.world.playerMesh)
      emitters.push({ id: "fire-player", key: "fuelFire", source: this.world.playerMesh, volume: Math.min(0.8, 0.3 + ownFire * 0.5) });
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
    // The pilot's own view ends with the aircraft. From the moment it is a wreck the camera watches
    // it go in from outside, the way the player watches the ones they shoot down.
    if ((p.mode === "crashing" || p.mode === "wreck" || p.mode === "downed") && !this.crashCam) {
      this.crashCam = true;
      if (this.world.cameraMode === 1) this.world.setCamera(0);
    } else if (p.mode !== "crashing" && p.mode !== "wreck" && p.mode !== "downed" && this.crashCam) this.crashCam = false;
    if ((b.status === "lost" || b.status === "won" || b.status === "debrief") && !this.ended) {
      this.ended = true;
      this.clearInput();
      this.hud.debrief();
    }
  }

  private clearInput(): void {
    this.keys.clear();
    this.mouse.fire = false;
    this.mouse.looking = false;
    this.world.lookActive = false;
  }

  private hideOverlays(): void {
    for (const id of ["pause-overlay", "map-overlay", "command-overlay"]) $(id).classList.add("hidden");
    $("debrief").classList.toggle("hidden", !["lost", "won", "debrief"].includes(this.battle.status));
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
    $("debrief").classList.add("hidden");
    $(id).classList.remove("hidden");
    this.hud.mapOpen = id === "map-overlay";
    this.updateLoadoutUI();
    if (this.hud.mapOpen) {
      this.hud.drawMap();
      this.hud.lastContacts = "";
      this.hud.updateContactList();
      this.hud.lastBattleStatus = "";
      this.hud.updateBattleStatus();
    }
  }

  private begin(airborne = false, fresh = false): void {
    this.hideOverlays();
    $("debrief").classList.add("hidden");
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
    if (!airborne) this.audio.event({ type: "engineStart", airframe: this.battle.player.airframe });
    this.updateLoadoutUI();
    $("briefing").classList.add("hidden");
    $("flight-ui").classList.remove("hidden");
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
    $("flight-ui").classList.add("hidden");
    $("briefing").classList.remove("hidden");
    $("debrief").classList.add("hidden");
    this.updateLoadoutUI();
  }

  private updateLoadoutUI(): void {
    const p = this.battle.player;
    const torpedo = p.loadout === "torpedo";
    const can = p.mode === "deck" && (p.deckSpeed || 0) < 0.5;
    $("selected-aircraft").textContent = LOADOUTS[p.loadout || "bomb"].name;
    $("aircraft-tag-title").textContent = torpedo ? "DOUGLAS TBD DEVASTATOR" : "DOUGLAS SBD DAUNTLESS";
    $("aircraft-tag-role").textContent = torpedo ? "TORPEDO BOMBER · DOUGLAS TBD-1 DEVASTATOR" : "SCOUT BOMBER · BOMBING SQUADRON SIX";
    $("loadout-note").textContent = torpedo ? "Low, slow, straight run · 1 aerial torpedo · no dive brakes" : "Steep dive attack · perforated dive brakes · lighter wing stores";
    for (const id of ["bomb", "torpedo"]) {
      const el = $("loadout-" + id);
      el.classList.toggle("selected", p.loadout === id);
      el.setAttribute("aria-pressed", String(p.loadout === id));
    }
    const deck = $("deck-loadout") as HTMLSelectElement;
    deck.value = p.loadout;
    deck.disabled = !can;
    $("deck-loadout-note").textContent = can ? "Changes aircraft and payload." : "Stop on the flight deck to change loadout.";
  }

  /** The briefing choice outlives a restart, so replay launches the assignment the player picked. */
  private selectAssignment(id: string): void {
    if (!this.battle.selectAssignment(id)) return;
    this.assignment = id as Assignment;
    this.updateAssignmentUI();
  }

  private updateAssignmentUI(): void {
    const select = document.getElementById("assignment-select") as HTMLSelectElement | null;
    if (select) select.value = this.assignment;
    const note = document.getElementById("assignment-note");
    if (note) note.textContent = ASSIGNMENTS[this.assignment].brief;
  }

  private selectLoadout(id: string): void {
    if (!this.battle.selectLoadout(id)) {
      const notice = this.battle.events.at(-1);
      this.updateLoadoutUI();
      if (notice?.type === "notice") {
        this.hud.toast(notice.text);
        $("deck-loadout-note").textContent = notice.text;
      }
      return;
    }
    this.world.setAirframe();
    // A different airframe is a different cockpit, and the new one has never been drawn. Warm it
    // here on the deck, where the compile is invisible, instead of in the first cockpit frame aloft.
    void this.world.warmUpViews();
    this.updateLoadoutUI();
  }

  private setCamera(mode: number): void {
    this.world.setCamera(mode);
    this.hud.toast(["CHASE CAMERA", "PILOT COCKPIT — HOLD RIGHT MOUSE TO LOOK", "WIDE CHASE CAMERA", "OVERHEAD ATTACK CAMERA — LOOKING DOWN ON YOUR AIRCRAFT"][mode]);
  }

  private goHome(): void {
    const home = this.battle.goHome();
    if (!home) {
      this.hud.toast("NO OPERATIONAL FRIENDLY FLIGHT DECK");
      return;
    }
    this.hud.toast(`RETURN COURSE — ${home.name.toUpperCase()}`);
  }

  /** Take a replacement aircraft after a shoot-down. A refusal is surfaced by the battle's notice. */
  private takeAnotherAircraft(): void {
    if (!this.battle.takeAnotherAircraft()) return;
    this.world.snap = true;
    this.world.followBomb = false;
    this.audio.event({ type: "engineStart", airframe: this.battle.player.airframe });
    this.updateLoadoutUI();
    this.hud.toast("NEW AIRCRAFT ON DECK — HOLD W TO LAUNCH");
  }

  private designateTarget(id: string): void {
    if (!this.battle.designateTarget(id)) {
      this.hud.toast("CONTACT NOT ELIGIBLE FOR THIS ASSIGNMENT");
      return;
    }
    this.hud.lastContacts = "";
    this.hud.updateContactList();
    this.hud.drawMap();
    this.hud.toast(`DESIGNATED: ${this.battle.contacts.get(id)!.name.toUpperCase()}`);
  }

  private cycleTarget(): void {
    const cs = this.battle.targetContacts();
    if (!cs.length) {
      this.hud.toast("NO ELIGIBLE KNOWN CONTACTS");
      return;
    }
    const index = cs.findIndex((c) => c.id === this.battle.target);
    this.designateTarget(cs[(index + 1) % cs.length].id);
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
    if (code === "F4") {
      this.hud.toggleFps();
      return;
    }
    if (this.overlay === "command-overlay" && /^Digit[1-4]$/.test(code)) {
      this.command(["cover", "strike", "engage", "rtb"][Number(code.slice(-1)) - 1]);
      return;
    }
    if (this.paused || this.battle.status !== "playing") return;
    const p = this.battle.player;
    // A wrecked aircraft takes no more orders; the keys go dead until it hits the water.
    if (p.mode === "crashing" || p.mode === "wreck") return;
    // Downed: no aircraft to command. The replacement order is the only one that lands; the map and
    // manual were already handled above, on their own paths.
    if (p.mode === "downed") {
      if (code === "Enter") this.takeAnotherAircraft();
      return;
    }
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
        this.audio.event({ type: "flap" });
        this.hud.toast(`DIVE BRAKES ${p.brakes ? "EXTENDED" : "RETRACTED"}`);
        break;
      case "KeyG":
        if (p.mode === "deck" || p.mode === "arrest") {
          this.hud.toast("GEAR LOCKED WHILE ON DECK");
          break;
        }
        this.battle.toggleGear();
        this.audio.event({ type: "gear" });
        this.hud.toast(`LANDING GEAR ${p.gear ? "DOWN" : "UP"}`);
        break;
      case "KeyN":
        p.flaps = p.flaps < 0.15 ? 0.33 : p.flaps < 0.7 ? 1 : 0;
        // The SBD's dive brakes ARE its split flaps: one surface driven by
        // max(flapPos, brakePos). A flap-up order must release the brakes too, or the
        // panels (and their drag) stay out against the command and the wing never
        // comes clean. The TBD has no dive brakes, so it keeps its own state.
        if (p.flaps === 0 && p.airframe !== "tbd") p.brakes = false;
        this.audio.event({ type: "flap" });
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
        this.setCamera((this.world.cameraMode + 1) % 4);
        break;
      case "KeyO":
        // Direct jump to the overhead attack view, wherever the C cycle left off.
        this.setCamera(3);
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
        this.audio.event({ type: "engine", action: p.engineCut ? "stop" : "start", airframe: p.airframe });
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
