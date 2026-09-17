/**
 * The UI state the game publishes to a native target's web view.
 *
 * Two channels, both plain JSON:
 *
 * - `ui` is exactly the arguments of the `IShell` calls the scene already makes. The web view
 *   replays them into `src/ui/dom.ts`, the same shell the web build installs, so the briefing, the
 *   loadout panels and the overlays behave identically on both and the look is still `index.html`
 *   plus `src/style.css`.
 * - `hud` is what `src/hud.ts` reads, and only that: the fields named in `IBattleView`, the answers
 *   its computed methods gave, and the camera matrix its canvas projects through. The renderer is
 *   the same file on both targets; only where it reads from differs.
 *
 * The one rule that keeps this honest: a type the simulation already declares as plain data
 * (`IReport`, `ISortie`, `IReserve`, `IBattleStatus`, `WreckMarker`) crosses as it stands, and
 * anything else is selected field by field. Nothing here walks an object it was not given the
 * shape of, so a field added to `IBattleView` fails the build here instead of vanishing in transit.
 */
import type {
  IAircraftView,
  IBattleView,
  IPlayerView,
  IRadioLine,
  IReport,
  IShipView,
  IViewSnapshot,
  IViewState,
} from "./hud-input.js";
import type { IHud, ILoadoutView, ScreenName } from "./port.js";

export type { IViewSnapshot };

export interface IUiSnapshot {
  screens: Record<ScreenName, boolean>;
  /** The id of the open modal (`pause-overlay`, `map-overlay`, `command-overlay`), or none. */
  overlay: string | null;
  cockpit: boolean;
  loadout: ILoadoutView;
  assignment: { id: string; brief: string };
}

/** The members of `IBattleView` the HUD calls rather than reads. Their answers cross as data. */
export type Computed = "approach" | "battleStatus" | "canAccelerate" | "replacementStatus" | "returnReserve" | "targetContacts" | "wingStatus";

export interface IBattleSnapshot extends Omit<IBattleView, Computed | "contacts"> {
  /** A `Map` is not JSON. Its entries are, and the web view rebuilds the same map from them. */
  contacts: Array<[string, IReport]>;
  /** Each computed answer keeps its method's own return type, so the two cannot drift apart. */
  computed: { [K in Computed]: ReturnType<IBattleView[K]> };
}

/**
 * What the scene did to the HUD object itself, as state — never as a call list.
 *
 * A call list does not survive the store: `game.state` coalesces at 100 ms, so two commands
 * published before one flush overwrite each other and the first is lost; and React re-renders
 * the same snapshot on unrelated `ui` changes, replaying old calls (`toggleFps` twice is off
 * again, a stale toast returns). Every field here is therefore idempotent:
 *
 * - `mapOpen` and `hitFlash` are plain values the web view assigns. `Hud.update` re-derives the map
 *   and the appraisal from them whenever the map is open, so the old `drawMap`/
 *   `updateBattleStatus` calls carried nothing `update` does not already do. `hitFlash` is an
 *   **event**, not a level: `hitSeq` stamps each hit and the web view raises its own value once per
 *   stamp, because the live `Hud.update` owns the decay. Re-sending the level every 100 ms pinned
 *   the damage overlay at full opacity forever; clearing it after a publish lost the hit when a
 *   later tick overwrote the staged snapshot before the store flushed.
 * - The three repaint caches (`lastRadio`, `lastContacts`, `lastBattleStatus`) are **invalidations**,
 *   not values. The scene writes `""` to force a rebuild, but the real key lives in the web view's
 *   `Hud` (`hud.ts:236, 312, 931`), which the bridge never computes. Publishing the assigned `""`
 *   as state therefore stomps that key on every snapshot — the contact list and radio log rebuild
 *   ~8.5x/s while the paused map is open — so `radioSeq`/`contactsSeq`/`statusSeq` stamp each
 *   assignment and the web view applies the string only when its stamp advances. A repeated `""`
 *   is still an invalidation; an unchanged steady-state snapshot is not.
 * - `toastText` keeps only the latest toast with its own sequence — which is exactly what the
 *   web build shows, since each `toast()` overwrites `#toast` immediately.
 * - `debriefSeq` counts debriefs (the scene fires it once per sortie end behind its `ended`
 *   flag); the web view runs it only when the count advances.
 * - `fpsOn` is the toggle's resulting state, not the toggle: the web view flips only to match.
 * - `elapsed` is a monotonically increasing total of live HUD seconds and `updateSpeed` the latest
 *   tick's speed. A per-publish delta cannot be used: a toast or a debrief publishes a fresh
 *   snapshot carrying the same interval, and two ticks coalesced before one flush would drop an
 *   interval. A cumulative total is applied by difference once per advance, so a replayed interval
 *   contributes zero and a coalesced one contributes the whole gap — never twice, never lost.
 *
 * Every publish carries the whole of this, so a newer staged patch overwriting an older one
 * before a flush loses nothing — the newer state already contains it.
 */
export interface IHudUiState {
  mapOpen: boolean;
  hitFlash: number;
  /** Counts damage hits; the web view applies `hitFlash` exactly once per stamp. */
  hitSeq: number;
  lastRadio: string;
  lastContacts: string;
  lastBattleStatus: string;
  /** Count a scene assignment of each repaint cache; the web view applies it once per stamp. */
  radioSeq: number;
  contactsSeq: number;
  statusSeq: number;
  toastText: string;
  toastSeq: number;
  debriefSeq: number;
  fpsOn: boolean;
  /** Total live HUD seconds published so far; the web view applies only the increase. */
  elapsed: number;
  updateSpeed: number;
}

export interface IHudSnapshot extends IHudUiState {
  /** Identifies the publishing HUD, so a replaced one does not inherit the old counters. */
  session: number;
  battle: IBattleSnapshot;
  view: IViewSnapshot;
  /** Increments per publish, so the web view can tell a fresh snapshot from a repeated render. */
  seq: number;
}

/** One patch of published state. Either half may be absent; they are written at different rates. */
export interface IUiPatch {
  hud?: IHudSnapshot;
  ui?: IUiSnapshot;
}

const aircraftView = (a: IAircraftView): IAircraftView => ({
  heading: a.heading,
  hp: a.hp,
  kind: a.kind,
  team: a.team,
  x: a.x,
  y: a.y,
  z: a.z,
});

/** Only what the instruments read. The player record also carries AI timers and gun bookkeeping. */
const playerView = (p: IPlayerView): IPlayerView => ({
  ...aircraftView(p),
  ammo: p.ammo,
  aoa: p.aoa,
  assist: p.assist,
  attitude: p.attitude && { w: p.attitude.w, x: p.attitude.x, y: p.attitude.y, z: p.attitude.z },
  autopilot: p.autopilot,
  bombs: p.bombs,
  brakes: p.brakes,
  flapPos: p.flapPos,
  fuel: p.fuel,
  gear: p.gear,
  gforce: p.gforce,
  gunner: p.gunner,
  ias: p.ias,
  loadout: p.loadout,
  mode: p.mode,
  nav: p.nav,
  pitch: p.pitch,
  rearAmmo: p.rearAmmo,
  rearBlocked: p.rearBlocked,
  rearLoaded: p.rearLoaded,
  rearReloadUntil: p.rearReloadUntil,
  serviceTime: p.serviceTime,
  speed: p.speed,
  stall: p.stall,
  throttle: p.throttle,
  torpedo: p.torpedo,
  vx: p.vx,
  vy: p.vy,
  vz: p.vz,
});

const shipView = (s: IShipView): IShipView => ({
  deck: s.deck,
  fire: s.fire,
  heading: s.heading,
  id: s.id,
  kind: s.kind,
  name: s.name,
  sunk: s.sunk,
  team: s.team,
  x: s.x,
  z: s.z,
});

const radioLine = (r: IRadioLine): IRadioLine => ({ from: r.from, id: r.id, priority: r.priority, text: r.text, time: r.time });

const point = (p: { x: number; y?: number; z: number }): { x: number; y?: number; z: number } => ({ x: p.x, y: p.y, z: p.z });

/**
 * Drop `undefined` properties, recursively. Native state is JSON, and a JSON value has no
 * `undefined`: `JSON.stringify` silently drops the key, and the native playtest sampler refuses a
 * state that carries one at all. An optional simulation field (`rearBlocked` before the first
 * flight, a report's `sunk` before anyone has seen the hull) must therefore cross as absent, which
 * is what the renderer's own `??` reads it as anyway.
 */
function jsonSafe<T>(value: T): T {
  if (Array.isArray(value)) return value.map(jsonSafe) as unknown as T;
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) if (item !== undefined) out[key] = jsonSafe(item);
    return out as T;
  }
  return value;
}

/**
 * The live battle, as the HUD reads it.
 *
 * Called once per published snapshot — ten times a second, not per frame. The computed answers are
 * taken here because the web view has no battle to ask, and `approach().carrier` becomes the one
 * thing the HUD does with it, a presence test, so no ship crosses the boundary.
 */
export function toHudSnapshot(b: IBattleView, view: IViewState, ui: IHudUiState, seq: number, session = 0): IHudSnapshot {
  const approach = b.approach();
  const battle = jsonSafe<IBattleSnapshot>({
    aircraft: b.aircraft.map(aircraftView),
    command: b.command,
    computed: {
      approach: {
        carrier: Boolean(approach.carrier),
        corrections: approach.corrections,
        cues: approach.cues,
        descent: approach.descent,
        phase: approach.phase,
        speed: approach.speed,
      },
      battleStatus: b.battleStatus(),
      canAccelerate: b.canAccelerate(),
      replacementStatus: b.replacementStatus(),
      returnReserve: b.returnReserve(),
      targetContacts: b.targetContacts(),
      wingStatus: b.wingStatus(),
    },
    contacts: [...b.contacts],
    home: b.home && { name: b.home.name },
    island: point(b.island),
    navigationPoint: point(b.navigationPoint),
    player: playerView(b.player),
    radio: b.radio.map(radioLine),
    reason: b.reason,
    reported: b.reported,
    score: b.score,
    search: point(b.search),
    ships: b.ships.map(shipView),
    sortie: b.sortie,
    stats: { kills: b.stats.kills, shipHits: b.stats.shipHits, sorties: b.stats.sorties },
    status: b.status,
    strikeComplete: b.strikeComplete,
    target: b.target,
    time: b.time,
    wrecks: b.wrecks,
  });
  return {
    battle,
    ...ui,
    seq,
    session,
    view: view.viewSnapshot(),
  };
}

/** The same shape again on the other side: the computed answers become the methods that gave them. */
export function fromHudSnapshot(s: IBattleSnapshot): IBattleView {
  const { computed, contacts, ...rest } = s;
  return {
    ...rest,
    approach: () => computed.approach,
    battleStatus: () => computed.battleStatus,
    canAccelerate: () => computed.canAccelerate,
    contacts: new Map(contacts),
    replacementStatus: () => computed.replacementStatus,
    returnReserve: () => computed.returnReserve,
    targetContacts: () => computed.targetContacts,
    wingStatus: () => computed.wingStatus,
  };
}

/** A view the web view can re-aim: one object the HUD keeps, pointed at each snapshot's camera. */
export interface ISnapshotView extends IViewState {
  apply(v: IViewSnapshot): void;
}

/**
 * `World.project` without the renderer: the same matrix Three would have applied, the same
 * perspective divide, the same viewport and the same visibility margin.
 */
export function createSnapshotView(initial: IViewSnapshot): ISnapshotView {
  let v = initial;
  return {
    apply(next) {
      v = next;
    },
    get cameraMode() {
      return v.cameraMode;
    },
    get followBomb() {
      return v.followBomb;
    },
    project(p) {
      const m = v.matrix;
      const y = p.y ?? 0;
      const w = m[3] * p.x + m[7] * y + m[11] * p.z + m[15] || 1e-9;
      const x = (m[0] * p.x + m[4] * y + m[8] * p.z + m[12]) / w;
      const ny = (m[1] * p.x + m[5] * y + m[9] * p.z + m[13]) / w;
      const nz = (m[2] * p.x + m[6] * y + m[10] * p.z + m[14]) / w;
      return {
        depth: nz,
        visible: nz > -1 && nz < 1 && Math.abs(x) < 1.15 && Math.abs(ny) < 1.15,
        x: (x * 0.5 + 0.5) * v.width,
        y: (-0.5 * ny + 0.5) * v.height,
      };
    },
    viewSnapshot: () => v,
  };
}

/**
 * What the web view has already applied. `hudSeq` drops a repeated render of the same snapshot
 * (React re-runs the effect when the unrelated `ui` half changes); the event counters make a
 * repeated snapshot unable to re-fire a toast, a debrief or an fps flip. `session` is the
 * publishing HUD's id: a replaced HUD restarts its own counters at zero, so the memory resets
 * with it instead of dropping every event until the new counters catch up.
 */
export interface IHudMemory {
  session: number;
  hudSeq: number;
  toastSeq: number;
  debriefSeq: number;
  hitSeq: number;
  radioSeq: number;
  contactsSeq: number;
  statusSeq: number;
  fpsOn: boolean;
  /** The last cumulative HUD seconds applied; the next snapshot's increase is the tick's `dt`. */
  elapsed: number;
}

export function createHudMemory(): IHudMemory {
  return { session: 0, hudSeq: 0, toastSeq: 0, debriefSeq: 0, hitSeq: 0, radioSeq: 0, contactsSeq: 0, statusSeq: 0, fpsOn: false, elapsed: 0 };
}

/**
 * One snapshot, applied for real against the web view's `Hud`. The same snapshot applied twice
 * is a no-op the second time; a newer snapshot supersedes rather than replays.
 */
export function applyHudSnapshot(display: IHud, snap: IHudSnapshot, mem: IHudMemory): void {
  if (snap.session !== mem.session) {
    mem.session = snap.session;
    mem.hudSeq = 0;
    mem.toastSeq = 0;
    mem.debriefSeq = 0;
    mem.hitSeq = 0;
    // The new HUD's repaint stamps restart at zero, so the reset memory must sit below zero for its
    // first snapshot to clear the previous session's cached keys instead of being read as old news.
    mem.radioSeq = -1;
    mem.contactsSeq = -1;
    mem.statusSeq = -1;
    // The new HUD counts its own `elapsed` from zero, so the baseline resets with it; leaving the
    // old total would drop the replacement's first intervals until it caught up.
    mem.elapsed = 0;
    // `fpsOn` is deliberately NOT reset: it tracks the display's real state, which a new session
    // does not change. Resetting it to the new session's default (off) would make the comparison
    // below agree and leave the display's overlay switched on forever.
  }
  if (snap.seq === mem.hudSeq) return;
  mem.hudSeq = snap.seq;
  display.b = fromHudSnapshot(snap.battle);
  display.mapOpen = snap.mapOpen;
  // Once per hit, and only ever up: the live HUD decays the flash in `update`, and a later
  // snapshot with the same stamp must not re-raise it or fight that decay.
  if (snap.hitSeq > mem.hitSeq) {
    mem.hitSeq = snap.hitSeq;
    if (snap.hitFlash > display.hitFlash) display.hitFlash = snap.hitFlash;
  }
  // The three repaint caches clear only on a fresh assignment stamp. Assigning them on every
  // snapshot would overwrite the key the web view's `Hud` computed and rebuild the radio log and
  // the contact list at publish rate; a repeat of the same "" is still a stamp, so it still lands.
  if (snap.radioSeq > mem.radioSeq) {
    mem.radioSeq = snap.radioSeq;
    display.lastRadio = snap.lastRadio;
  }
  if (snap.contactsSeq > mem.contactsSeq) {
    mem.contactsSeq = snap.contactsSeq;
    display.lastContacts = snap.lastContacts;
  }
  if (snap.statusSeq > mem.statusSeq) {
    mem.statusSeq = snap.statusSeq;
    display.lastBattleStatus = snap.lastBattleStatus;
  }
  if (snap.toastSeq > mem.toastSeq) {
    mem.toastSeq = snap.toastSeq;
    if (snap.toastText) display.toast(snap.toastText);
  }
  if (snap.fpsOn !== mem.fpsOn) {
    mem.fpsOn = snap.fpsOn;
    display.toggleFps();
  }
  // Only the increase since the last apply is real time; a non-tick publish repeats the total, so
  // its delta is zero and cannot double-decay the flash or over-advance the DOM tick.
  const dt = snap.elapsed - mem.elapsed;
  if (dt > 0) {
    mem.elapsed = snap.elapsed;
    display.update(dt, snap.updateSpeed);
  }
  if (snap.debriefSeq > mem.debriefSeq) {
    mem.debriefSeq = snap.debriefSeq;
    display.debrief();
  }
  display.draw();
}
