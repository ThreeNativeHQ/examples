/**
 * What the HUD reads, named.
 *
 * `src/hud.ts` is the only display implementation and both targets run it: on the web it reads the
 * live `Battle`, and on a native target it reads a copy of the same shape that crossed the process
 * boundary as plain state. These interfaces are that shape — chosen field by field, never cloned,
 * so `tsc` fails the moment the renderer reads something the snapshot does not carry, and so no
 * simulation internal crosses just because it happened to sit on the same object.
 *
 * Types the simulation already states as plain data (`ISortie`, `IReport`, `IReserve`,
 * `IBattleStatus`, `WreckMarker`) are reused, not restated.
 */
import type { IBattleStatus, IReport } from "../sim/battle.js";
import type { IReserve } from "../sim/recovery.js";
import type { WreckMarker } from "../sim/rescue.js";
import type { ISortie } from "../sim/sortie.js";

export type { IBattleStatus, IReport, IReserve, ISortie, WreckMarker };

/** A world point the HUD projects; `y` is metres of altitude, not a screen coordinate. */
export interface IPoint {
  x: number;
  y?: number;
  z: number;
}

/** Every aircraft but the player's is drawn as a mark: position, side, and whether it still flies. */
export interface IAircraftView extends IPoint {
  y: number;
  heading: number;
  hp: number;
  kind: string;
  team: string;
}

/**
 * The player's aircraft. Only the instruments' own inputs — no timers, no AI state, no gun
 * bookkeeping. `attitude` is the airframe quaternion the gunsight reticle needs.
 */
export interface IPlayerView extends IAircraftView {
  aoa: number;
  ammo: number;
  assist: boolean;
  attitude?: { x: number; y: number; z: number; w: number };
  autopilot: boolean;
  bombs: number;
  brakes: boolean;
  flapPos: number;
  fuel: number;
  gear: boolean;
  gforce: number;
  gunner: boolean;
  ias: number;
  loadout: string;
  mode: string;
  nav: string;
  pitch: number;
  rearAmmo: number;
  rearBlocked: boolean;
  /** Rounds in the belt, not a flag: the panel prints LOADED/RESERVE. */
  rearLoaded: number;
  rearReloadUntil: number;
  serviceTime: number;
  speed: number;
  stall: number;
  throttle: number;
  torpedo: number;
  vx: number;
  vy: number;
  vz: number;
}

export interface IShipView extends IPoint {
  deck: number;
  fire: number;
  heading: number;
  id: string;
  kind: string;
  name: string;
  sunk: boolean;
  team: string;
}

export interface IRadioLine {
  from: string;
  id: string;
  priority: boolean;
  text: string;
  time: number;
}

export interface IStatsView {
  kills: number;
  shipHits: number;
  sorties: number;
}

export interface IReplacementStatus {
  available: boolean;
  carrier: string;
  last: string;
  reason: string;
}

/** The recovery cue line. `carrier` is read for presence only, so the deck itself never crosses. */
export interface IApproachView {
  carrier: unknown;
  corrections: string[];
  cues: string[];
  descent: number;
  phase: string;
  speed: number;
}

export interface IBattleView {
  aircraft: IAircraftView[];
  command: string;
  contacts: Map<string, IReport>;
  home: { name: string } | undefined;
  island: IPoint;
  navigationPoint: IPoint;
  player: IPlayerView;
  radio: IRadioLine[];
  reason: string;
  reported: number | boolean;
  score: number;
  search: IPoint;
  ships: IShipView[];
  sortie: ISortie;
  stats: IStatsView;
  status: string;
  strikeComplete: boolean;
  target: string | null;
  time: number;
  wrecks: WreckMarker[];
  /** Computed on the battle rather than stored: published as the answer, never as the code. */
  approach(): IApproachView;
  battleStatus(): IBattleStatus;
  canAccelerate(): boolean;
  replacementStatus(): IReplacementStatus;
  returnReserve(): IReserve;
  targetContacts(): IReport[];
  wingStatus(): string;
}

/**
 * The camera, as the HUD canvas needs it: a world→clip matrix and a viewport, so a HUD in another
 * process reproduces `World.project` exactly without a renderer or a scene graph of its own.
 */
export interface IViewSnapshot {
  cameraMode: number;
  followBomb: boolean;
  /** `camera.projectionMatrix * camera.matrixWorldInverse`, column-major, as Three stores it. */
  matrix: number[];
  height: number;
  width: number;
}

/** The camera-dependent part: the HUD projects world points onto the canvas it paints. */
export interface IViewState {
  cameraMode: number;
  followBomb: unknown;
  project(p: IPoint): { x: number; y: number; visible: boolean; depth: number };
  /** What a HUD one process away needs to project for itself. */
  viewSnapshot(): IViewSnapshot;
}
