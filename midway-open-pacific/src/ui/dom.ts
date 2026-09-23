/**
 * Every `document` call the game makes.
 *
 * Imported from `src/main.ts` only, never from `src/game.ts`: the native entry must stay free of
 * DOM mounting, and the desktop build fails TN_NATIVE_WEB_ONLY_UI if it is not.
 */
import { Hud } from "../hud.js";
import type { IBattleView, IViewState } from "./hud-input.js";
import type { IHud, ILoadingView, ILoadoutView, IShell, Intent, ScreenName } from "./port.js";

const $ = (id: string) => document.getElementById(id) as HTMLElement;
const $$ = (id: string) => document.getElementById(id);

const SCREENS: Record<ScreenName, string> = {
  loading: "loading",
  briefing: "briefing",
  flight: "flight-ui",
  debrief: "debrief",
};
const OVERLAYS = ["pause-overlay", "map-overlay", "command-overlay"];
/** Keys the game flies with. The browser's own Space, Tab and arrow behaviour would steal them. */
/**
 * `navigator.clipboard` is missing on an insecure origin and rejects when the page is not focused,
 * which is exactly the state a failed launch leaves it in; the selection path is the fallback
 * every browser and the native web view still honour.
 */
async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    /* falls through */
  }
  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.style.cssText = "position:fixed;top:-1000px;opacity:0";
    document.body.append(area);
    area.select();
    const copied = document.execCommand("copy");
    area.remove();
    return copied;
  } catch {
    return false;
  }
}

const CLAIMED = new Set(["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Tab", "F1", "F2", "F3"]);

class DomShell implements IShell {
  private handlers = new Set<(intent: Intent) => void>();
  private cleanups: Array<() => void> = [];
  private view: Hud | undefined;
  private muted = false;

  constructor() {
    const emit = (intent: Intent): void => {
      for (const handler of this.handlers) handler(intent);
    };
    const key = (code: string) => () => emit({ kind: "key", code });
    const buttons: Record<string, () => void> = {
      "start-deck": () => emit({ kind: "begin", airborne: false, fresh: false }),
      "start-air": () => emit({ kind: "begin", airborne: true, fresh: false }),
      "restart-deck": () => emit({ kind: "begin", airborne: false, fresh: true }),
      "restart-air": () => emit({ kind: "begin", airborne: true, fresh: true }),
      "restart-pause": () => emit({ kind: "briefing" }),
      "brief-help": () => emit({ kind: "overlay", id: "pause-overlay" }),
      "btn-pause": () => emit({ kind: "overlay", id: "pause-overlay" }),
      "btn-map": () => emit({ kind: "overlay", id: "map-overlay" }),
      "close-pause": () => emit({ kind: "resume" }),
      "close-map": () => emit({ kind: "resume" }),
      "close-command": () => emit({ kind: "resume" }),
      resume: () => emit({ kind: "resume" }),
      "btn-camera": key("KeyC"),
      "btn-gunner": key("KeyY"),
      "take-aircraft": () => emit({ kind: "take-aircraft" }),
      "map-home": () => emit({ kind: "home" }),
      "btn-audio": () => {
        emit({ kind: "audio" });
        this.muted = !this.muted;
        $("btn-audio").textContent = this.muted ? "SOUND OFF" : "SOUND ON";
      },
      fullscreen: () => void this.fullscreen(),
    };
    for (const [id, fn] of Object.entries(buttons)) {
      const el = $$(id);
      if (el) this.on(el, "click", fn);
    }
    for (const id of ["bomb", "torpedo"]) {
      const el = $$(`loadout-${id}`);
      if (el) this.on(el, "click", () => emit({ kind: "loadout", id }));
    }
    const select = (id: string, make: (value: string) => Intent): void => {
      const el = $$(id) as HTMLSelectElement | null;
      if (el) this.on(el, "change", () => emit(make(el.value)));
    };
    select("assignment-select", (id) => ({ kind: "assignment", id }));
    select("deck-loadout", (id) => ({ kind: "loadout", id }));
    select("quality", (id) => ({ kind: "quality", id }));
    const picked = (attribute: string, make: (value: string) => Intent) => (event: Event) => {
      const button = (event.target as HTMLElement).closest(`[data-${attribute}]`) as HTMLElement | null;
      const value = button?.dataset[attribute];
      if (value) emit(make(value));
    };
    const commands = $$("command-buttons");
    if (commands) this.on(commands, "click", picked("command", (id) => ({ kind: "command", id })));
    const contacts = $$("contact-list");
    if (contacts) this.on(contacts, "click", picked("contact", (id) => ({ kind: "target", id })));
    const map = $$("big-map");
    if (map) {
      this.on(map, "click", (event) => {
        const canvas = event.currentTarget as HTMLCanvasElement;
        const rect = canvas.getBoundingClientRect();
        const x = (((event as MouseEvent).clientX - rect.left) / rect.width) * canvas.width;
        const y = (((event as MouseEvent).clientY - rect.top) / rect.height) * canvas.height;
        const nearest = (this.view?.mapItems ?? [])
          .map((p: { id: string; x: number; y: number }) => ({ ...p, d: Math.hypot(p.x - x, p.y - y) }))
          .sort((a, b) => a.d - b.d)[0];
        if (nearest && nearest.d < 55) emit({ kind: "target", id: nearest.id });
      });
    }
    // The scene reads held keys from `ctx.input`, so all this listener owes it is suppressing the
    // browser's own meaning for them — and leaving a focused form control alone.
    this.on(window, "keydown", (event) => {
      const e = event as KeyboardEvent;
      if ((e.target as HTMLElement | null)?.matches?.("select,input,textarea")) return;
      if (CLAIMED.has(e.code)) e.preventDefault();
    });
    this.on(window, "contextmenu", (event) => event.preventDefault());
    this.on(window, "blur", () => emit({ kind: "suspend" }));
    this.on(document, "visibilitychange", () => {
      if (document.hidden) emit({ kind: "suspend" });
    });
  }

  private on(target: EventTarget, type: string, handler: (event: Event) => void): void {
    target.addEventListener(type, handler);
    this.cleanups.push(() => target.removeEventListener(type, handler));
  }

  private async fullscreen(): Promise<void> {
    try {
      if (!document.fullscreenElement) await document.documentElement.requestFullscreen();
      else await document.exitFullscreen();
    } catch {
      this.view?.toast("FULLSCREEN IS NOT AVAILABLE IN THIS VIEW");
    }
  }

  hud(battle: IBattleView, view: IViewState): IHud {
    // The framework appends its canvas last, which would leave the HUD's own 2D canvas as the
    // page's first one — and the playtest runner reads `document.querySelector("canvas")` to
    // decide which renderer drew the frame. Moving it to the front keeps that answer honest and
    // puts the world underneath every overlay, which is where it belongs anyway.
    const world = document.querySelector("canvas:not([id])");
    if (world) document.body.prepend(world);
    this.view = new Hud(battle, view);
    return this.view;
  }

  screen(name: ScreenName, visible: boolean): void {
    $(SCREENS[name]).classList.toggle("hidden", !visible);
  }

  /**
   * The launch, as the player sees it: a bar that moves with the bytes and the name of the file
   * being loaded. A failure replaces both — with the message and a button that copies it, because
   * the first thing anyone is asked for is the text, and it cannot be selected over a canvas.
   */
  loading(view: ILoadingView): void {
    const bar = $$("load-bar");
    if (bar) bar.style.width = `${Math.round(Math.max(0, Math.min(1, view.progress)) * 100)}%`;
    const status = $$("load-status");
    if (status) status.textContent = `${Math.round(view.progress * 100)}% — ${view.label}`;
    const failure = $$("load-failure");
    if (!failure) return;
    failure.classList.toggle("hidden", view.failure === undefined);
    if (view.failure === undefined) return;
    const text = $$("load-failure-text");
    if (text) text.textContent = view.failure;
    const copy = $$("load-copy") as HTMLButtonElement | null;
    if (copy && copy.dataset.wired !== "1") {
      copy.dataset.wired = "1";
      copy.addEventListener("click", () => {
        void copyToClipboard($("load-failure-text").textContent ?? "").then((ok) => {
          copy.textContent = ok ? "COPIED" : "PRESS CTRL+C";
        });
      });
    }
  }

  overlay(id: string | null): void {
    for (const overlay of OVERLAYS) $(overlay).classList.toggle("hidden", overlay !== id);
  }

  loadout(view: ILoadoutView): void {
    $("selected-aircraft").textContent = view.name;
    $("aircraft-tag-title").textContent = view.tagTitle;
    $("aircraft-tag-role").textContent = view.tagRole;
    $("loadout-note").textContent = view.note;
    for (const id of ["bomb", "torpedo"]) {
      const el = $(`loadout-${id}`);
      el.classList.toggle("selected", view.id === id);
      el.setAttribute("aria-pressed", String(view.id === id));
    }
    const deck = $("deck-loadout") as HTMLSelectElement;
    deck.value = view.id;
    deck.disabled = !view.deckEnabled;
    $("deck-loadout-note").textContent = view.deckNotice ?? view.deckNote;
  }

  assignment(id: string, brief: string): void {
    const select = $$("assignment-select") as HTMLSelectElement | null;
    if (select) select.value = id;
    const note = $$("assignment-note");
    if (note) note.textContent = brief;
  }

  cockpitView(on: boolean): void {
    document.body.classList.toggle("cockpit-view", on);
  }

  onIntent(handler: (intent: Intent) => void): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  dispose(): void {
    for (const off of this.cleanups) off();
    this.cleanups = [];
    this.handlers.clear();
  }
}

/** One shell per page: a hot update re-runs `src/main.ts`, and a second one would double every click. */
let installed: DomShell | undefined;

export function createDomShell(): IShell & { dispose(): void } {
  installed?.dispose();
  installed = new DomShell();
  return installed;
}
