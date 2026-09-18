/**
 * The seam between the battle and whatever draws it.
 *
 * Nothing reachable from here may touch `document`: `src/game.ts` is the native entry and the
 * desktop bundle is scanned for DOM mounting (TN_NATIVE_WEB_ONLY_UI). The web build installs the
 * real shell from `src/main.ts`; a native build keeps `nullShell` and runs the simulation with no
 * UI, so the scene, the flight model and the world render identically on both.
 */
import type { IBattleView, IViewState } from "./hud-input.js";


/** What `Midway` needs of a HUD. `Hud` in `src/hud.ts` satisfies it; so does `NullHud`. */
export interface IHud {
  b: IBattleView;
  mapOpen: boolean;
  hitFlash: number;
  lastRadio: string;
  lastContacts: string;
  lastBattleStatus: string;
  readonly mapItems: Array<{ id: string; x: number; y: number }>;
  toast(text: string): void;
  update(dt: number, speed?: number): void;
  draw(): void;
  debrief(): void;
  drawMap(): void;
  updateContactList(): void;
  updateBattleStatus(): void;
  toggleFps(): void;
}

export type ScreenName = "loading" | "briefing" | "flight" | "debrief";

/** What the loadout panels show. The scene decides it; the shell only renders it. */
export interface ILoadoutView {
  readonly id: string;
  readonly name: string;
  readonly tagTitle: string;
  readonly tagRole: string;
  readonly note: string;
  readonly deckEnabled: boolean;
  readonly deckNote: string;
  /** A refusal the battle explained, shown in place of the deck note. */
  readonly deckNotice?: string;
}

/**
 * What the loading layer shows. `label` is the asset actually being loaded, from the engine's own
 * in-flight ledger — a bar with no name on it cannot tell "still working" from "stuck".
 * `failure` is a launch the engine reported as stalled or device-lost; it replaces the bar.
 */
export interface ILoadingView {
  /** 0..1, monotonic: `ctx.startup.progress`. */
  readonly progress: number;
  readonly label: string;
  readonly failure?: string;
}

/** Everything the player can ask for that the shell itself must not decide. */
export type Intent =
  | { kind: "begin"; airborne: boolean; fresh: boolean }
  | { kind: "briefing" }
  | { kind: "key"; code: string }
  /** Close the menus and give the stick back; on the gun this click also re-takes the lock. */
  | { kind: "resume" }
  | { kind: "overlay"; id: string }
  | { kind: "loadout"; id: string }
  | { kind: "assignment"; id: string }
  | { kind: "quality"; id: string }
  | { kind: "command"; id: string }
  | { kind: "target"; id: string }
  | { kind: "take-aircraft" }
  | { kind: "home" }
  | { kind: "audio" }
  /** The window lost focus: drop held input and pause if the battle is running. */
  | { kind: "suspend" };

export interface IShell {
  hud(battle: IBattleView, view: IViewState): IHud;
  screen(name: ScreenName, visible: boolean): void;
  /** How the launch is going, while the loading layer is up. */
  loading(view: ILoadingView): void;
  /** Show exactly this modal overlay, or none. */
  overlay(id: string | null): void;
  loadout(view: ILoadoutView): void;
  assignment(id: string, brief: string): void;
  cockpitView(on: boolean): void;
  onIntent(handler: (intent: Intent) => void): () => void;
}

export class NullHud implements IHud {
  declare b: IBattleView;
  mapOpen = false;
  hitFlash = 0;
  lastRadio = "";
  lastContacts = "";
  lastBattleStatus = "";
  readonly mapItems: Array<{ id: string; x: number; y: number }> = [];
  toast(): void {}
  update(): void {}
  draw(): void {}
  debrief(): void {}
  drawMap(): void {}
  updateContactList(): void {}
  updateBattleStatus(): void {}
  toggleFps(): void {}
}

export const nullShell: IShell = {
  hud: () => new NullHud(),
  screen: () => {},
  loading: () => {},
  overlay: () => {},
  loadout: () => {},
  assignment: () => {},
  cockpitView: () => {},
  onIntent: () => () => {},
};

/** The installed shell. A live binding, so `src/main.ts` can swap it in before the game starts. */
export let shell: IShell = nullShell;

export function setShell(next: IShell): void {
  shell = next;
}
