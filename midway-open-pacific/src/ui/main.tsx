/**
 * The UI entry the native web view loads.
 *
 * It does not draw a second HUD: it mounts this game's own `index.html` body and its stylesheet,
 * then installs the same `createDomShell()` the web build installs — and the same `src/hud.ts`,
 * running here against the snapshot the game publishes. The game runs beside it in the native
 * runtime and reaches it only through published state and intents, so one markup, one stylesheet,
 * one renderer and one set of click handlers serve both targets.
 *
 * `<UiLayer>` is not optional: `useUiState` reads its context and throws `TN_UI_LAYER_MISSING`
 * without it, so rendering bare left the attached web view completely blank.
 */
import { UiLayer, useUiIntent, useUiState } from "@threenative/ui";
import { useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import page from "../../index.html?raw";
import "../style.css";
import "./native.css";
import { createDomShell } from "./dom.js";
import type { GameState } from "../scenes/Midway.js";
import type { IHud, IShell, Intent, ScreenName } from "./port.js";
import { applyHudSnapshot, createHudMemory, createSnapshotView, fromHudSnapshot, type IHudMemory, type IHudSnapshot, type ISnapshotView, type IUiSnapshot } from "./state.js";

const root = document.getElementById("tn-ui");
if (root === null) throw new Error("Missing #tn-ui element.");
// The same file the browser loads, minus its `<script>` — `innerHTML` never runs one, so the game
// cannot boot a second time inside its own HUD. Taking the markup from index.html rather than
// copying it is the point: a screen added to the briefing appears on both targets at once.
root.innerHTML = page.slice(page.indexOf("<body>") + "<body>".length, page.indexOf("</body>"));

/**
 * Let the compositor route taps to the real controls.
 *
 * A native target has no cursor over the web view: the runtime publishes the rectangles of every
 * `[data-tn-interactive]` element and forwards a tap that lands inside one. The web markup has no
 * reason to carry the attribute, so it is applied here, to the controls that already exist, after
 * every update that can add one (the contact list is rebuilt as reports arrive).
 */
function markInteractive(): void {
  for (const el of document.querySelectorAll("button,select,[data-contact],[data-command],#big-map")) {
    el.setAttribute("data-tn-interactive", "");
  }
}

function NativeUi(): null {
  const ui = useUiState<GameState, IUiSnapshot | undefined>((state) => state.ui);
  const hud = useUiState<GameState, IHudSnapshot | undefined>((state) => state.hud);
  const intent = useUiIntent();
  const send = useRef(intent);
  send.current = intent;
  const shell = useRef<IShell>(null);
  const display = useRef<IHud>(null);
  const view = useRef<ISnapshotView>(null);
  useEffect(() => {
    const installed = createDomShell();
    shell.current = installed;
    markInteractive();
    const stop = installed.onIntent((value: Intent) => send.current("midway", value));
    // The markup is up and the handlers are attached: `uiReady` means this, not a stray click.
    send.current("ui-ready", null);
    return () => {
      stop();
      installed.dispose();
      shell.current = null;
      display.current = null;
      view.current = null;
    };
  }, []);
  useEffect(() => {
    const installed = shell.current;
    if (ui === undefined || installed === null) return;
    for (const [name, visible] of Object.entries(ui.screens)) installed.screen(name as ScreenName, visible);
    installed.overlay(ui.overlay);
    installed.loadout(ui.loadout);
    installed.loading(ui.loading);
    installed.assignment(ui.assignment.id, ui.assignment.brief);
    installed.cockpitView(ui.cockpit);
    markInteractive();
  }, [ui]);
  /**
   * The flight HUD, drawn here by the game's own renderer.
   *
   * The snapshot arrives at 10 Hz and carries the whole HUD-object state, so a newer staged patch
   * overwriting an older one before a flush loses nothing. `memory` drops a repeated render of the
   * same snapshot — React re-runs this effect when the unrelated `ui` half changes — and keeps a
   * toast, a debrief or an fps flip from firing twice.
   */
  const memory = useRef<IHudMemory | null>(null);
  if (memory.current === null) memory.current = createHudMemory();
  useEffect(() => {
    const installed = shell.current;
    if (hud === undefined || installed === null) return;
    if (view.current === null) view.current = createSnapshotView(hud.view);
    else view.current.apply(hud.view);
    if (display.current === null) display.current = installed.hud(fromHudSnapshot(hud.battle), view.current);
    if (memory.current !== null) applyHudSnapshot(display.current, hud, memory.current);
    markInteractive();
  }, [hud]);
  return null;
}

const mount = document.createElement("div");
document.body.append(mount);
createRoot(mount).render(
  <UiLayer>
    <NativeUi />
  </UiLayer>,
);
