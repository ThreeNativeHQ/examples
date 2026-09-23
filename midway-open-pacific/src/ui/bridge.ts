/**
 * The shell the native entry installs: the scene's UI calls, published as plain state.
 *
 * The game process on a native target has no DOM, so it cannot run `src/ui/dom.ts` — but the web
 * view can, and does. This records what the scene asked for and hands it across the process
 * boundary; `src/ui/main.tsx` replays it into the real shell and the real `Hud`. Intents come back
 * the same way, as the very `Intent` values the DOM shell emits, so the scene cannot tell which
 * target it is on.
 */
import { type IHud, type IShell, type ILoadoutView, type Intent, type ScreenName } from "./port.js";
import type { IBattleView, IViewState } from "./hud-input.js";
import { toHudSnapshot, type IHudSnapshot, type IHudUiState, type IUiPatch, type IUiSnapshot } from "./state.js";

export interface IUiBridge {
  shell: IShell;
  /** Hand an intent from the web view to the scene. */
  emit(intent: Intent): void;
}

/**
 * The scene's HUD, one process away.
 *
 * Every publish carries the complete HUD-object state (`IHudUiState`), never a list of calls to
 * replay: the store coalesces at 100 ms, so a second command staged before a flush overwrites the
 * first, and replaying a list would lose it. Overwriting complete state loses nothing — the newer
 * snapshot already contains what the older one did. `update` publishes every frame, and the store
 * coalesces that to one publication per frame; the event methods publish immediately so a toast or
 * debrief never waits for the next frame's update.
 */
class BridgeHud implements IHud {
  declare b: IBattleView;
  readonly mapItems: Array<{ id: string; x: number; y: number }> = [];
  #ui: IHudUiState = {
    mapOpen: false,
    hitFlash: 0,
    hitSeq: 0,
    lastRadio: "",
    lastContacts: "",
    lastBattleStatus: "",
    radioSeq: 0,
    contactsSeq: 0,
    statusSeq: 0,
    toastText: "",
    toastSeq: 0,
    debriefSeq: 0,
    // `VITE_MIDWAY_FPS=1` at build time opens the F4 frame-time panel from the first frame (native builds).
    fpsOn: import.meta.env.VITE_MIDWAY_FPS === "1",
    elapsed: 0,
    updateSpeed: 1,
  };
  #since = 0;
  #seq = 0;

  constructor(
    private view: IViewState,
    private publish: (hud: IHudSnapshot) => void,
    private readonly session: number,
  ) {}

  // The scene writes these directly — `hud.mapOpen = true` to open the map, `hud.lastRadio = ""` to
  // force the log to repaint. The three repaint caches are different: the bridge never computes
  // their real key (the web view's `Hud` does), so the assignment is the whole signal. Each one
  // therefore stamps a monotonic sequence, and the web view clears its own cached key only when a
  // stamp advances — never on every snapshot, which would rebuild the list at publish rate.
  get mapOpen(): boolean {
    return this.#ui.mapOpen;
  }
  set mapOpen(value: boolean) {
    this.#ui.mapOpen = value;
  }
  get hitFlash(): number {
    return this.#ui.hitFlash;
  }
  set hitFlash(value: number) {
    this.#ui.hitFlash = value;
    // A hit is an event, not a level: stamp it so the web view applies each one exactly once.
    // Clearing the value after a publish would lose the hit whenever a later `update` overwrote
    // the staged snapshot before the store flushed.
    if (value > 0) this.#ui.hitSeq += 1;
  }
  get lastRadio(): string {
    return this.#ui.lastRadio;
  }
  set lastRadio(value: string) {
    this.#ui.lastRadio = value;
    // A repeated assignment of the same empty string is still an invalidation: the scene writes ""
    // when it needs the log rebuilt, and the web view cannot tell a repeat from the first.
    this.#ui.radioSeq += 1;
  }
  get lastContacts(): string {
    return this.#ui.lastContacts;
  }
  set lastContacts(value: string) {
    this.#ui.lastContacts = value;
    this.#ui.contactsSeq += 1;
  }
  get lastBattleStatus(): string {
    return this.#ui.lastBattleStatus;
  }
  set lastBattleStatus(value: string) {
    this.#ui.lastBattleStatus = value;
    this.#ui.statusSeq += 1;
  }

  #send(): void {
    this.publish(toHudSnapshot(this.b, this.view, this.#ui, ++this.#seq, this.session));
  }

  update(dt: number, speed = 1): void {
    // Every frame, not at 10 Hz: the engine store already coalesces to one publication per frame,
    // and a 100 ms gate here made the native HUD move in visible steps beside a smooth scene.
    this.#since += dt;
    if (this.#since <= 0) return;
    // Add to a running total, never a per-publish delta: the consumer applies the increase since
    // its last apply, so an event publish repeating the total adds nothing and two publishes
    // coalesced into one flush still carry the whole interval exactly once.
    this.#ui.elapsed += this.#since;
    this.#ui.updateSpeed = speed;
    this.#since = 0;
    this.#send();
  }

  /**
   * Nothing to paint here: the HUD's 2D canvas is in the web view, and the real `Hud.draw()` runs
   * there against each snapshot as it arrives. The markers therefore move at the snapshot's rate (every frame)
   * rather than the render's 60 — raise the publish rate of `view` alone if that reads as a stutter.
   */
  draw(): void {}

  toast(text: string): void {
    this.#ui.toastText = text;
    this.#ui.toastSeq += 1;
    this.#send();
  }
  debrief(): void {
    this.#ui.debriefSeq += 1;
    this.#send();
  }
  drawMap(): void {
    // The web view's `Hud.update` redraws the map from the battle whenever it is open, so this is
    // only a repaint-now hint: publish the state as it stands.
    this.#send();
  }
  updateContactList(): void {
    this.#send();
  }
  updateBattleStatus(): void {
    this.#send();
  }
  toggleFps(): void {
    this.#ui.fpsOn = !this.#ui.fpsOn;
    this.#send();
  }
}

export function createUiBridge(publish: (patch: IUiPatch) => void): IUiBridge {
  const snapshot: IUiSnapshot = {
    assignment: { brief: "", id: "strike" },
    cockpit: false,
    loading: { label: "Preparing the Pacific theatre…", progress: 0 },
    loadout: { deckEnabled: false, deckNote: "", id: "bomb", name: "", note: "", tagRole: "", tagTitle: "" },
    overlay: null,
    screens: { briefing: false, debrief: false, flight: false, loading: true },
  };
  const handlers = new Set<(intent: Intent) => void>();
  let sessions = 0;
  const push = (): void => publish({ ui: snapshot });
  return {
    emit(intent) {
      for (const handler of handlers) handler(intent);
    },
    shell: {
      assignment(id: string, brief: string) {
        if (snapshot.assignment.id === id && snapshot.assignment.brief === brief) return;
        snapshot.assignment = { brief, id };
        push();
      },
      cockpitView(on: boolean) {
        if (snapshot.cockpit === on) return;
        snapshot.cockpit = on;
        push();
      },
      hud(battle: IBattleView, view: IViewState) {
        const hud = new BridgeHud(view, (snap) => publish({ hud: snap }), ++sessions);
        hud.b = battle;
        return hud;
      },
      loading(view) {
        if (
          snapshot.loading.progress === view.progress &&
          snapshot.loading.label === view.label &&
          snapshot.loading.failure === view.failure
        )
          return;
        snapshot.loading = view.failure === undefined
          ? { label: view.label, progress: view.progress }
          : { failure: view.failure, label: view.label, progress: view.progress };
        push();
      },
      loadout(view: ILoadoutView) {
        // An absent refusal must be absent, not `undefined`: `JSON.stringify` drops an undefined
        // value silently, so the web view would keep showing the last refusal it was told about.
        const { deckNotice, ...rest } = view;
        const next = deckNotice === undefined ? rest : { ...rest, deckNotice };
        if (JSON.stringify(next) === JSON.stringify(snapshot.loadout)) return;
        snapshot.loadout = next;
        push();
      },
      onIntent(handler) {
        handlers.add(handler);
        return () => handlers.delete(handler);
      },
      overlay(id: string | null) {
        if (snapshot.overlay === id) return;
        snapshot.overlay = id;
        push();
      },
      screen(name: ScreenName, visible: boolean) {
        if (snapshot.screens[name] === visible) return;
        snapshot.screens[name] = visible;
        push();
      },
    },
  };
}
