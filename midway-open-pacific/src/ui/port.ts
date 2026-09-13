/**
 * The seam between the battle and whatever draws it.
 *
 * Nothing reachable from here may touch `document`: `src/game.ts` is the native entry and the
 * desktop bundle is scanned for DOM mounting. The web build installs the real shell from
 * `src/main.ts`; a native build keeps `nullShell` and runs the simulation with no UI.
 */

/** What `Midway` needs of a HUD. `Hud` in `src/hud.ts` satisfies it; so does `NullHud`. */
export interface IHud {
  b: any;
  mapOpen: boolean;
  hitFlash: number;
  lastRadio: string;
  lastContacts: string;
  toast(text: string): void;
  update(dt: number, speed?: number): void;
  debrief(): void;
  drawMap(): void;
  updateContactList(): void;
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
}

/** Everything the player can ask for that the shell itself must not decide. */
export type Intent =
  | { kind: "begin"; airborne: boolean; fresh: boolean }
  | { kind: "briefing" }
  | { kind: "key"; code: string }
  | { kind: "close" }
  | { kind: "overlay"; id: string }
  | { kind: "loadout"; id: string }
  | { kind: "assignment"; id: string }
  | { kind: "quality"; id: string }
  | { kind: "command"; id: string }
  | { kind: "target"; id: string }
  | { kind: "next-target" }
  | { kind: "home" }
  | { kind: "audio" }
  /** The window lost focus: drop held input and pause if the battle is running. */
  | { kind: "suspend" };

export interface IShell {
  hud(battle: unknown, view: unknown): IHud;
  screen(name: ScreenName, visible: boolean): void;
  /** Show exactly this modal overlay, or none. */
  overlay(id: string | null): void;
  loadout(view: ILoadoutView): void;
  assignment(id: string, brief: string): void;
  cockpitView(on: boolean): void;
  onIntent(handler: (intent: Intent) => void): () => void;
}

export class NullHud implements IHud {
  b: any;
  mapOpen = false;
  hitFlash = 0;
  lastRadio = "";
  lastContacts = "";
  toast(): void {}
  update(): void {}
  debrief(): void {}
  drawMap(): void {}
  updateContactList(): void {}
}

export const nullShell: IShell = {
  hud: () => new NullHud(),
  screen: () => {},
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
