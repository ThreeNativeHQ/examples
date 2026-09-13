import { Scene } from "@threenative/core";
import { AudioBus } from "@threenative/core";
import type { ICtx } from "@threenative/core";
import type * as T from "three";
import { Battle } from "../sim/battle.js";
import { LOADOUTS } from "../sim/armament.js";
import { clamp, distance2 } from "../sim/math.js";
import { loadImportedShips } from "../render/imported-ships.js";
import { loadEnvironment } from "../render/environment.js";
import { loadImportedAircraft } from "../render/imported-aircraft.js";
import { loadImportedFleet } from "../render/imported-fleet.js";
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
  started = false;
  keys = new Set<string>();
  mouse = { fire: false, looking: false, lx: 0, ly: 0 };
  private audioBuffers: ReadonlyMap<string, AudioBuffer> = new Map();
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
    this.world = new WorldView({ scene: ctx.scene, camera: ctx.camera as T.PerspectiveCamera, renderer: ctx.renderer, add: (object) => ctx.add(object) }, this.battle);
    this.hud = new Hud(this.battle, this.world);
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
    });
  }

  exit(): void {
    this.audio.dispose();
    this.world.crew.dispose();
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
      "btn-command": () => this.showOverlay("command-overlay"),
      "close-pause": () => this.hideOverlays(),
      "close-map": () => this.hideOverlays(),
      "close-command": () => this.hideOverlays(),
      resume: () => this.hideOverlays(),
      "btn-report": () => this.action("KeyR"),
      "btn-bomb": () => this.action("KeyB"),
      "btn-next-target": () => this.cycleTarget(),
      "restart-deck": () => this.begin(false, true),
      "restart-air": () => this.begin(true, true),
      "restart-pause": () => this.restartToBriefing(),
      "map-home": () => {
        this.goHome();
        this.hideOverlays();
      },
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
      if (btn) {
        this.battle.target = (btn as HTMLElement).dataset.contact as string;
        this.battle.player.nav = "search";
        this.hud.lastContacts = "";
        this.hud.updateContactList();
        this.hud.drawMap();
      }
    });
    this.onElement($("big-map"), "click", (e) => {
      const canvas = e.target as HTMLCanvasElement;
      const rect = canvas.getBoundingClientRect();
      const x = ((e as MouseEvent).clientX - rect.left) / rect.width * canvas.width;
      const y = ((e as MouseEvent).clientY - rect.top) / rect.height * canvas.height;
      const nearest = this.hud.mapItems.map((p) => ({ ...p, d: Math.hypot(p.x - x, p.y - y) })).sort((a, b) => a.d - b.d)[0];
      if (nearest && nearest.d < 55) {
        this.battle.target = nearest.id;
        this.battle.player.nav = "search";
        this.hud.lastContacts = "";
        this.hud.drawMap();
        this.hud.updateContactList();
      }
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
    let speed = 1;
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
      speed = (this.keys.has("ShiftLeft") || this.keys.has("ShiftRight")) && b.canAccelerate() ? 3 : 1;
      for (let i = 0; i < speed; i += 1) b.step(1 / 60, input);
      for (const e of b.events.splice(0)) {
        this.audio.event(e);
        if (e.type === "notice") this.hud.toast(e.text);
        if (e.type === "damage") this.hud.hitFlash = 1;
      }
    }
    this.world.update(this.paused ? 0 : dt, this.wall, b.status === "briefing");
    this.hud.update(dt, speed);
    const p = b.player;
    const onShip = p.mode === "deck" || p.mode === "launch" || p.mode === "arrest" || p.mode === "service";
    const nearShip = onShip || b.ships.some((s: any) => s.team === "us" && s.kind === "carrier" && !s.sunk && distance2(s, p) < 1800 * 1800);
    this.audio.update(
      {
        cockpit: this.world.cameraMode === 1 && !this.world.followBomb,
        onDeck: onShip,
        nearPA: nearShip,
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
    if ((b.status === "lost" || b.status === "won") && !this.ended) {
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
    $(id).classList.remove("hidden");
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
    $("debrief").classList.add("hidden");
    this.ended = false;
    if (fresh) {
      const choice = this.battle.player.loadout;
      this.battle = new Battle();
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
    this.world.reset(this.battle);
    this.hud.b = this.battle;
    this.hud.lastRadio = "";
    this.hud.lastContacts = "";
    this.hud.hitFlash = 0;
    this.ended = false;
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
    $("aircraft-tag-role").textContent = torpedo ? "TORPEDO BOMBER · PROCEDURAL TBD-INSPIRED MODEL" : "SCOUT BOMBER · BOMBING SQUADRON SIX";
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
    const home = this.battle.ships
      .filter((s: any) => s.team === "us" && s.kind === "carrier" && !s.sunk && s.deck > 0.25)
      .sort((a: any, b: any) => distance2(a, this.battle.player) - distance2(b, this.battle.player))[0];
    if (!home) {
      this.hud.toast("NO OPERATIONAL FRIENDLY FLIGHT DECK");
      return;
    }
    this.battle.player.home = home.id;
    this.battle.player.nav = "home";
    this.battle.player.autopilot = true;
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
    if (code === "Escape" || code === "KeyP") {
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
