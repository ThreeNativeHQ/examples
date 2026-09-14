/** Pure deterministic game state. Rendering, audio and browser APIs stay outside this module. */
import { updateGunnery, updateEvasion } from "./gunnery.js";
import { chooseCarrierMission, rearGunner, strikeContact, updateTacticalAircraft } from "./tactics.js";
import {
  aircraftHit,
  aircraftWorld,
  applyAircraftHit,
  damageSummary,
  initDamage,
  stepDamage,
  stepWheels,
  DAMAGE_ZONES,
  ZONE_POSITIONS,
  type DamageZone,
} from "./damage.js";
import { applyLoadout, torpedoEnvelope, updateStores, type ILoadout, LOADOUTS } from "./armament.js";
import {
  ASSIGNMENTS,
  confirmPending,
  hitQualifies,
  isShort,
  newSortie,
  outcomeText,
  recordObjectiveHit,
  stamp,
  type Assignment,
  type IResult,
  type ISortie,
  type IStamp,
  type Outcome,
} from "./sortie.js";
import {
  approach,
  APPROACH_SPEED,
  CRUISE_SPEED,
  finalReady,
  GLIDE,
  GROOVE_FLARE,
  GROOVE_LEAD,
  recoveryDeck,
  reserveEstimate,
  routeLength,
  type IApproach,
  type IReserve,
} from "./recovery.js";
import { SPEAKERS, SPEECH, radioShipName, type ISpeechRequest } from "./radio-script.js";
import {
  applyLaunch,
  applyRecovery,
  canLaunch,
  stepService,
  suspendReason,
  totalAircraft,
  type CarrierAir,
  type DeckState,
  type ITimes,
} from "./carrier-ops.js";
import {
  canObserve,
  classify,
  estimatePosition,
  isDelivered,
  makeContact,
  mergeContact,
  STALE_SECONDS,
  type Classification,
  type Contact,
  type Team,
} from "./intel.js";
import { shipClass } from "./catalog.js";
import {
  AircraftFlight,
  airDensity,
  attitudeAxes,
  gearClearance,
  setAttitude,
  SEA_WIND,
} from "./flight.js";
import {
  angleDelta,
  bearing,
  bombImpact,
  clamp,
  contactEstimate,
  distance2,
  distance3,
  forward,
  lerp,
  localPoint,
  onDeck,
  overHull,
  rng,
  wrap,
} from "./math.js";

type Any = any;

/** Shared gameplay threshold: a carrier with a flight deck below this cannot launch aircraft. */
export const LAUNCH_DECK = 0.35;
/** Separate policy: a deck this damaged can still *recover* aircraft. Never a launch rule. */
export const RECOVERY_DECK = 0.25;
/** A deck below this has failed outright; the player's own carrier can neither launch nor land. */
export const DECK_FAILED = 0.2;
/** Impact records kept per ship for persistent damage visuals. */
export const MAX_IMPACTS = 8;

/**
 * Every ship's geometry, in metres, resolved here so a `Battle` knows how big its world is before
 * any renderer exists. Three different rectangles used to share two fields — `length`/`width` meant
 * the launch corridor on the player's own carrier and the damage bounds on every other ship — and
 * the renderer patched them in while building meshes, so the numbers depended on a `WorldView`
 * having been constructed. They are now three named things:
 *
 * - `hullLength`/`hullBeam`: the hull at the waterline, and the outline that is drawn. This is the
 *   lower half of the damage volume: a weapon that goes down outboard of the hull hits the sea.
 * - `deckBeam`: the drawn flight deck's own plan, which overhangs that hull — 26 m each side of
 *   Kaga's centreline against a 32.5 m waterline beam. It is the upper half of the damage volume,
 *   because at and above deck height the deck is what a bomb meets first. Every hull without a
 *   flight deck carries its own `hullBeam` here and answers as one box, as it always did.
 * - `deckLength`/`deckWidth`: the launch and recovery corridor, carriers only. Narrower than both
 *   of the above: the flight model rolls an aircraft down these numbers and calls an overrun from
 *   them, so it is deck an aircraft can actually use, not deck a bomb can hit.
 * - `deckHeight`: the horizontal surface above the sea — a carrier's own flight deck datum, and for
 *   every other hull the superstructure plane the weapon code has always used.
 */
interface IHull {
  hullLength: number;
  hullBeam: number;
}

/** Class references and measured GLB extents; the repaired model is `hullBeam` wide when drawn. */
const hullOf = (classId: string): IHull => {
  const cls = shipClass(classId);
  return { hullLength: cls.measuredLength, hullBeam: cls.hullBeam };
};

/**
 * Hulls by ship name. Enterprise, Hornet and Akagi are the models supplied with the project and
 * have no catalog class, so they keep the extents the renderer used to write in. Northampton,
 * Phelps and Balch have neither a class nor a model and keep the per-kind defaults below; giving
 * them a sister ship's numbers would be the substitution this change exists to remove.
 */
const HULLS: Readonly<Record<string, IHull>> = Object.freeze({
  "USS Enterprise": { hullLength: 251.58, hullBeam: 32.4 }, // Yorktown class, as drawn by hornet.glb
  "USS Hornet": { hullLength: 251.58, hullBeam: 32.4 },
  "USS Yorktown": hullOf("yorktown"),
  Akagi: { hullLength: 260.67, hullBeam: 31.3 }, // supplied akagi.glb
  Kaga: hullOf("kaga"),
  Soryu: hullOf("soryu"),
  Hiryu: hullOf("hiryu"),
  Tone: hullOf("tone"),
  Chikuma: hullOf("tone"),
  Arashi: hullOf("kagero"),
  Nowaki: hullOf("kagero"),
  "USS Hammann": hullOf("hammann"),
  "I-168": hullOf("i168"),
  "USS Nautilus": hullOf("nautilus"),
});

interface IDeck {
  deckLength: number;
  deckWidth: number;
  deckHeight: number;
  deckBeam: number;
}

/**
 * Flight decks by ship name. Every number is raycast off the model the ship is actually drawn with.
 *
 * Enterprise, Hornet and Akagi were surveyed in the running game (tools/capture-deck.mjs), which is
 * where their conservative 220 x 20 m corridor and 20.06 m datum come from. The four imported hulls
 * are surveyed the same way but off the shipped bytes and with no browser, by
 * `node tools/measure-decks.mjs`, which prints every station this table was filled from:
 *
 * - `deckLength` x `deckWidth` is the longest run of deck through amidships with at least 7 m of
 *   deck each side of the centreline, made symmetric about the ship's origin because `onDeck`
 *   measures the corridor from there, and then as wide as the narrowest station it crosses. It is a
 *   measurement of the deck, not of the ship: the class hull length and waterline beam that used to
 *   stand in here gave Kaga a 247.65 x 32.5 m launch rectangle — the whole ship, bow overhang and
 *   island included.
 * - `deckBeam` is the widest the drawn deck reaches, for the upper half of the damage volume.
 * - `deckHeight` is the deck's own elevation **in the world**: the midpoint of the range the deck
 *   covers along the corridor, less the class draught, because `src/render/world.ts` sinks each
 *   imported hull by its draught to put its waterline rather than its keel on the sea. The
 *   `keel + datum` column of the survey is therefore not this number; the subtraction is shown per
 *   ship below. The three supplied models are not sunk and keep the datum they were surveyed at.
 *
 * A single datum cannot describe a deck that slopes, and three of these four do: the residual is
 * reported as sheer per ship, and tools/capture-deck.mjs holds the datum to the centre of it rather
 * than pretending 0.1 m at every station (PRD-midway-asset-battle-integration AC-2).
 *
 * `src/render/imported-ships.ts` used to hold a second copy of this table. It does not any more: two
 * copies of a measurement is how they drift.
 */
const CARRIER_DECKS: Readonly<Record<string, IDeck>> = Object.freeze({
  "USS Enterprise": { deckLength: 220, deckWidth: 20, deckHeight: 20.06, deckBeam: 32.4 },
  "USS Hornet": { deckLength: 220, deckWidth: 20, deckHeight: 20.06, deckBeam: 32.4 },
  // Akagi's original stern deck slopes down ~1.4 m; the datum is its central deck.
  Akagi: { deckLength: 220, deckWidth: 20, deckHeight: 20.06, deckBeam: 31.3 },
  // Measured: deck 20.20..20.68 over the corridor, midpoint 20.44, less 7.9 m draught.
  "USS Yorktown": { deckLength: 240, deckWidth: 20, deckHeight: 12.54, deckBeam: 32 },
  // Measured: deck 22.91..23.61, midpoint 23.26, less 7.5 m draught.
  Kaga: { deckLength: 230, deckWidth: 18, deckHeight: 15.76, deckBeam: 52 },
  // Measured: deck 20.30..20.68, midpoint 20.49, less 7.6 m draught.
  Soryu: { deckLength: 220, deckWidth: 14, deckHeight: 12.89, deckBeam: 34 },
  // Measured: deck 19.91..21.50, midpoint 20.71, less 7.8 m draught.
  Hiryu: { deckLength: 210, deckWidth: 18, deckHeight: 12.91, deckBeam: 40 },
});

/** The plane a weapon strikes on a ship with no flight deck. What the hit code always assumed. */
const SUPERSTRUCTURE_TOP = 9;

/**
 * One ship's geometry by name. A carrier with no deck entry throws rather than taking a fleet-wide
 * default: a wrong launch corridor or deck datum is a silent 3 m error in where the wheels are, and
 * the whole point of resolving this here is that nothing downstream has to guess.
 */
export function shipGeometry(name: string, kind: string): IHull & IDeck {
  const sub = kind === "sub";
  const hull = HULLS[name] ?? { hullLength: sub ? 92 : 112, hullBeam: sub ? 9 : 13 };
  // No flight deck, so nothing overhangs: the damage volume is one box of the hull's own beam.
  if (kind !== "carrier")
    return { ...hull, deckLength: 0, deckWidth: 0, deckHeight: SUPERSTRUCTURE_TOP, deckBeam: hull.hullBeam };
  const deck = CARRIER_DECKS[name];
  if (!deck) throw new Error(`no flight deck geometry for carrier: ${name}`);
  return { ...hull, ...deck };
}

/** The live-aircraft ceiling. A launch at the cap is queued, not charged; nothing is consumed. */
export const ACTIVE_CAP = 68;

/**
 * Deck work, in seconds of simulated time. Explicit game tuning in the order and relative cost the
 * design asks for. `carrier-ops` uses each interval as the time the straight deck is *fouled*, so
 * `launchInterval` is how long one aircraft takes to roll and clear — not a launch cadence, which
 * comes from what the mission actually wants — and a recovery holds the deck for longer because the
 * wires and the landing area have to be cleared. Striking a returned aircraft below to refuel and
 * rearm it takes minutes, and repairing a damaged one takes longer again.
 */
const TIMES: ITimes = Object.freeze({
  launchInterval: 6,
  recoveryInterval: 20,
  serviceSeconds: 300,
  repairSeconds: 900,
});

/** Aviation gasoline one sortie costs its carrier, in the units of `CarrierAir.fuel`. */
const FUEL_PER_LAUNCH = 1;

/** How long a carrier stays with a chosen mission before re-evaluating it. */
const COMMIT_SECONDS = 120;

/** Operational re-evaluation cadence, in seconds. Movement and weapons keep the fixed step. */
const OPS_INTERVAL = 1;

/** One track update per target per this many seconds; a fleet does not re-file the same sighting. */
const TRACK_SECONDS = 25;

/**
 * Dawn over the Pacific, 1942: clear but hazy. `intel.canObserve` treats `visibility` as an on/off
 * gate rather than scaling with it, so the haze is applied here as a shortened `rangeLimit` and the
 * flag is passed as well — a later scaling implementation in the module needs no change here.
 */
const VISIBILITY = 0.85;

/** Metres of water an observer can see a hull through. A boat deeper than this is unobserved. */
const SIGHT_DEPTH = 20;

/** Seconds between an aircrew's sighting and the fleet holding the report, and a ship's by lamp/TBS. */
const AIR_REPORT_DELAY = 30;
const SHIP_REPORT_DELAY = 8;

/**
 * A flown airframe by role and team. The launch role never picks a *kind* of aircraft out of thin
 * air: it names the airframe a deck actually has, and the store family that arms it follows from the
 * airframe. A carrier search leg is flown by the dive bomber the ship carries — the cruiser
 * floatplanes are a separate, unbuilt airframe and are deliberately not faked here.
 */
const ROLE_AIRFRAMES: Readonly<Record<string, Readonly<Record<string, string>>>> = Object.freeze({
  fighter: { us: "wildcat", jp: "zero" },
  bomber: { us: "sbd", jp: "val" },
  torpedo: { us: "tbd", jp: "kate" },
  recon: { us: "sbd", jp: "val" },
});

/**
 * The ordnance family an airframe re-arms with. `carrier-ops.ts` keeps the same table privately for
 * `stepService`, and does not export it, so the launch side has to name it again; the two must agree.
 */
function storeFamilyOf(airframe: string): string {
  if (airframe === "tbd" || airframe === "kate") return "torpedo";
  if (airframe === "sbd" || airframe === "val") return "bomb";
  return "ammo";
}

/** What a hull truly is, in the intel module's vocabulary. Degradation is `classify`'s business. */
function classOf(ship: Any): Classification {
  if (ship.kind === "carrier") return "carrier";
  if (ship.kind === "cruiser") return "cruiser";
  if (ship.kind === "sub") return "submarine";
  return "escort";
}

/** What a contact is called before anybody has identified it. Never a ship's name. */
const CLASS_LABELS: Readonly<Record<string, string>> = Object.freeze({
  unknown: "UNIDENTIFIED CONTACT",
  aircraft: "AIRCRAFT",
  small: "SMALL VESSEL",
  escort: "ESCORT VESSEL",
  cruiser: "HEAVY WARSHIP",
  carrier: "LARGE FLAT-DECK SHIP",
  submarine: "SUBMARINE",
});

/**
 * One air group, with the finite stores that arm it. Numbers are deliberately a playable roster, not
 * the historical order of battle: they differ per ship so that two decks facing the same contact make
 * different choices, and they total more than `ACTIVE_CAP` so the cap is a real constraint.
 */
interface IAirGroup {
  airframes: Record<string, number>;
  stores: Record<string, number>;
  fuel: number;
}

const AIR_GROUPS: Readonly<Record<string, IAirGroup>> = Object.freeze({
  "USS Enterprise": { airframes: { wildcat: 9, sbd: 11, tbd: 6 }, stores: { ammo: 30, bomb: 24, torpedo: 10 }, fuel: 120 },
  "USS Hornet": { airframes: { wildcat: 8, sbd: 10, tbd: 6 }, stores: { ammo: 26, bomb: 22, torpedo: 10 }, fuel: 110 },
  "USS Yorktown": { airframes: { wildcat: 7, sbd: 9, tbd: 5 }, stores: { ammo: 22, bomb: 18, torpedo: 8 }, fuel: 95 },
  Akagi: { airframes: { zero: 6, val: 6, kate: 7 }, stores: { ammo: 20, bomb: 16, torpedo: 12 }, fuel: 100 },
  Kaga: { airframes: { zero: 7, val: 7, kate: 9 }, stores: { ammo: 24, bomb: 18, torpedo: 14 }, fuel: 110 },
  Soryu: { airframes: { zero: 6, val: 6, kate: 6 }, stores: { ammo: 18, bomb: 14, torpedo: 10 }, fuel: 90 },
  Hiryu: { airframes: { zero: 6, val: 6, kate: 6 }, stores: { ammo: 18, bomb: 14, torpedo: 10 }, fuel: 90 },
});

/** The air group a carrier sails with. A carrier with no entry is a programming error, not a default. */
function airGroupFor(name: string): CarrierAir {
  const group = AIR_GROUPS[name];
  if (!group) throw new Error(`no air group for carrier: ${name}`);
  return {
    airframes: { ...group.airframes },
    // Every aircraft aboard starts armed and available; the stores are what repeat sorties spend.
    ready: { ...group.airframes },
    damaged: {},
    servicing: {},
    stores: { ...group.stores },
    fuel: group.fuel,
  };
}

function countOf(rec: Record<string, number>): number {
  let n = 0;
  for (const key in rec) n += rec[key];
  return n;
}

/** Is there anything on the deck for the crew to finish? Service and repair only run when there is. */
function deckHasWork(air: CarrierAir): boolean {
  return countOf(air.servicing) > 0 || countOf(air.damaged) > 0;
}

/**
 * One contact report: the intel module's record, plus the four display fields the HUD, the map and
 * `math.contactEstimate` have always read. `time` is `observedAt` under the name those consumers use,
 * and `kind` is the *classification* unless somebody actually identified the ship.
 */
export interface IReport extends Contact {
  name: string;
  kind: string;
  time: number;
  /** True once a crew has identified the hull; an identification is never unlearned by a vaguer one. */
  identified: boolean;
  source: string;
  reported: boolean;
}

export { LOADOUTS };
export type { ILoadout };

export class Battle {
  random: () => number;
  seed: number;
  serial = 0;
  time = 0;
  status = "briefing";
  ships: Any[] = [];
  aircraft: Any[] = [];
  bullets: Any[] = [];
  bombs: Any[] = [];
  torpedoes: Any[] = [];
  airTorpedoes: Any[] = [];
  effects: Any[] = [];
  /** What the player's own crew knows: their sightings, and the reports the fleet has passed them. */
  contacts = new Map<string, IReport>();
  /** Transmitted and not yet delivered. Killing the observer cannot recall what it already sent. */
  reports: IReport[] = [];
  /** When each side last filed on each hull, so a sweep re-files a track rather than every sighting. */
  filed: Record<string, Map<string, number>> = { us: new Map(), jp: new Map() };
  radio: Any[] = [];
  events: Any[] = [];
  reported = 0;
  score = 0;
  stats = {
    kills: 0,
    shipHits: 0,
    shipsSunk: 0,
    sorties: 1,
    bombsDropped: 0,
    torpedoesDropped: 0,
    friendlyHits: 0,
    nearMisses: 0,
    wingShipHits: 0,
    wingShipsSunk: 0,
  };
  /** Each side's delivered reports. Beliefs, not ships: no exact position and no deck health. */
  teamIntel: Record<string, Map<string, IReport>> = { us: new Map(), jp: new Map() };
  command = "cover";
  target: string | null = null;
  intelTick = 0;
  /** Countdown to the next operational re-evaluation: deck work, missions, observation, delivery. */
  opsTick = 0;
  reconNotice = false;
  threatNotice = false;
  island = { x: 9500, y: 0, z: 1500 };
  player: Any;
  playerFlight: AircraftFlight;
  wind = { ...SEA_WIND };
  search = { x: -4500, y: 1400, z: -9000 };
  reconLaunched = false;
  boundaryNotice = false;
  /** Edge/cooldown state for voiced alerts, so each speaks on change rather than every tick. */
  voiceFlags: Record<string, any> = {};
  /** The assignment the player chose in the briefing, and its progress. */
  sortie: ISortie = newSortie();

  constructor(seed = 19420604) {
    this.random = rng(seed);
    this.seed = seed;
    this.setupFleet();
    const home = this.ships[0];
    this.player = {
      id: "player",
      kind: "bomber",
      team: "us",
      home: home.id,
      x: home.x,
      y: 23,
      z: home.z + 95,
      heading: home.heading,
      pitch: 0,
      roll: 0,
      speed: 0,
      throttle: 0.18,
      hp: 100,
      fuel: 100,
      ammo: 1400,
      rearAmmo: 240,
      rearTimer: 0,
      bombs: 3,
      torpedo: 0,
      gear: true,
      gearManual: false,
      autoGearPending: false,
      gearClimbTime: 0,
      brakes: false,
      mode: "deck",
      deckOffset: -55,
      vx: 0,
      vy: 0,
      vz: 0,
      gunTimer: 0,
      autopilot: false,
      nav: "search",
      serviceTime: 0,
      takeoffGrace: 0,
      heat: 0,
      payloadMass: 0,
      payloadDrag: 0,
    };
    Object.assign(this.player, {
      flaps: 0.33,
      assist: true,
      deckOffset: -55,
      deckLateral: 0,
      deckSpeed: 0,
      chocks: true,
      pitch: 0.22,
    });
    applyLoadout(this.player, "bomb");
    initDamage(this.player);
    this.playerFlight = new AircraftFlight(this.player, "sbd", home.deckHeight);
    this.playerFlight.reset();
    this.playerFlight.stepDeck(home, 0.001, {});
  }

  /** Briefing-only: choose which sortie this is. Open Pacific keeps the existing operation. */
  selectAssignment(id: string): boolean {
    if (this.status !== "briefing" || !(id in ASSIGNMENTS)) return false;
    this.sortie = newSortie(id as Assignment, this.time, this.sortie.id);
    return true;
  }

  selectLoadout(id: string): boolean {
    const p = this.player;
    if (!["briefing", "playing"].includes(this.status) || p.mode !== "deck" || (p.deckSpeed || 0) >= 0.5 || !["bomb", "torpedo"].includes(id))
      return false;
    const ok = applyLoadout(p, id);
    if (ok) this.playerFlight.setAirframe(p.airframe);
    return ok;
  }

  toggleGear(): void {
    const p = this.player;
    p.gear = !p.gear;
    p.gearManual = true;
    p.autoGearPending = false;
  }

  releaseOrdnance(): boolean {
    return this.player.loadout === "torpedo" ? this.dropTorpedo(this.player) : this.dropBomb();
  }

  id(prefix: string): string {
    return `${prefix}-${++this.serial}`;
  }

  setupFleet(): void {
    const add = (name: string, team: string, kind: string, x: number, z: number, heading = 0) => {
      const cv = kind === "carrier";
      const sub = kind === "sub";
      const s = {
        id: this.id("ship"),
        name,
        team,
        kind,
        x,
        y: 0,
        z,
        heading,
        speed: sub ? 4 : cv ? 8 : 10,
        baseSpeed: sub ? 4 : cv ? 8 : 10,
        // Geometry, resolved before any renderer exists.
        ...shipGeometry(name, kind),
        hp: cv ? 340 : sub ? 90 : 145,
        maxHp: cv ? 340 : sub ? 90 : 145,
        deck: 1,
        engine: 1,
        aa: 1,
        fire: 0,
        /** Flooding, as a fraction of the heavy-list threshold the deck gate reads. */
        list: 0,
        /**
         * Conserved air inventory and the one straight-deck schedule, resolved here so a `Battle`
         * knows what its decks can fly before any renderer exists. Carriers only.
         */
        air: cv ? airGroupFor(name) : null,
        deckState: cv ? ({ mode: "available", since: 0, occupiedUntil: 0, suspended: null } as DeckState) : null,
        /** The mission this deck is committed to, and until when. Re-chosen at the ops cadence. */
        mission: null as Any,
        /** Why the last launch was refused, for the HUD. Null when the deck can work. */
        launchBlocked: null as string | null,
        /** Airframes that will never come home, and airframes a failed repair wrote off. */
        lostAircraft: 0,
        writtenOff: 0,
        /** Derived every ops tick from `air.ready`: the deck park draws this, never its own count. */
        reserve: 0,
        launchCount: 0,
        aaTimer: 1 + this.random() * 4,
        torpTimer: 40 + this.random() * 35,
        sunk: false,
        sink: 0,
        surfaced: true,
        baseX: x,
        baseZ: z,
      };
      this.ships.push(s);
      return s;
    };
    add("USS Enterprise", "us", "carrier", 0, 7000);
    add("USS Hornet", "us", "carrier", 1450, 7950);
    add("USS Yorktown", "us", "carrier", -1900, 7700);
    add("USS Northampton", "us", "cruiser", -950, 6150);
    add("USS Phelps", "us", "destroyer", 800, 5900);
    add("USS Hammann", "us", "destroyer", -2400, 6750);
    add("USS Balch", "us", "destroyer", 2200, 7350);
    add("Akagi", "jp", "carrier", -4300, -9200, 2.85);
    add("Kaga", "jp", "carrier", -6100, -8500, 2.85);
    add("Soryu", "jp", "carrier", -3550, -11150, 2.85);
    add("Hiryu", "jp", "carrier", -5700, -11400, 2.85);
    add("Tone", "jp", "cruiser", -2500, -8900, 2.85);
    add("Chikuma", "jp", "cruiser", -6900, -9950, 2.85);
    add("Arashi", "jp", "destroyer", -5000, -7300, 2.85);
    add("Nowaki", "jp", "destroyer", -7350, -7800, 2.85);
    add("I-168", "jp", "sub", -2100, 3000, 0.05);
    add("USS Nautilus", "us", "sub", -8000, -6400, 1.65);
  }

  start(airborne = false): void {
    if (this.status !== "briefing") return;
    this.status = "playing";
    this.voiceFlags = {};
    for (const s of this.ships.filter((s) => s.kind === "carrier")) this.launch(s, "fighter");
    if (airborne) {
      this.player.mode = "spectator";
      for (let i = 0; i < 900; i += 1) this.step(1 / 30, {});
      Object.assign(this.player, {
        x: -3000,
        y: 1550,
        z: -2600,
        heading: 6.08,
        pitch: 0,
        speed: this.player.airframe === "tbd" ? 84 : 103,
        throttle: 0.9,
        gear: false,
        mode: "flight",
        takeoffGrace: 0,
      });
      this.player.flaps = 0;
      this.playerFlight.reset();
      this.radio = [];
      this.events = [];
      this.sortie.startTime = this.time;
      this.say("SCOUT CONTROL", "Search the northwest sector. No confirmed carrier positions. Scan the horizon; use R to report sightings.");
    } else {
      this.sortie.startTime = this.time;
      this.say("ENTERPRISE TOWER", "Scout Two, cleared for launch. Hold W. Chocks release with power. Keep straight; ease the stick back (Down) through 90 knots. Lift, not the bow, gets you flying.");
    }
    this.say("SCOUT THREE", "Two, we have your wing. Orders on your command.");
  }

  say(from: string, text: string, priority = false): void {
    this.radio.unshift({ id: this.id("radio"), from, text, time: this.time, priority });
    this.radio.length = Math.min(7, this.radio.length);
    this.events.push({ type: "radio", priority });
  }

  event(type: string, data: Record<string, unknown> = {}): void {
    this.events.push({ type, ...data });
    if (this.events.length > 80) this.events.shift();
  }

  /**
   * Queue a friendly voiced line: push its caption into the radio log and hand the delivery queue a
   * request. The text is the script's, never a caller's paraphrase, so the caption and voice match.
   */
  voice(id: string, opts: { direction?: string; ship?: string; identity?: string; valid?: () => boolean; channel?: ISpeechRequest["channel"] } = {}): void {
    const row = SPEECH[id];
    if (!row) return;
    const text = row.variants === "direction" && opts.direction ? row.text.replace("{direction}", opts.direction) : row.variants === "ship" && opts.ship ? row.text.replace("{ship}", opts.ship) : row.text;
    this.radio.unshift({ id: this.id("radio"), from: SPEAKERS[row.voice], text, time: this.time, priority: row.priority <= 2 });
    this.radio.length = Math.min(7, this.radio.length);
    this.events.push({ type: "speech", request: { id, ...opts } });
  }

  /**
   * Voice the alerts the emergent battle actually produces. Each fires on a transition and carries a
   * predicate the queue rechecks, so an attack that breaks off before its line starts is dropped.
   */
  updateRadio(): void {
    const p = this.player;
    if (p.mode === "spectator") return;
    const enterprise = this.ships.find((s: Any) => s.team === "us" && s.kind === "carrier" && radioShipName(s.name) === "Enterprise") ?? this.ships.find((s: Any) => s.team === "us" && s.kind === "carrier");
    const eid = enterprise?.id;
    const near = (a: Any) => (enterprise ? distance3(a, enterprise) < 1600 : false);
    const liveZero = this.aircraft.some((a: Any) => a.team === "jp" && a.kind === "fighter" && a.airframe === "zero" && a.hp > 0 && a.mode === "flight" && a.tactic !== "rtb" && near(a));
    const liveDive = eid ? this.aircraft.some((a: Any) => a.team === "jp" && a.kind === "bomber" && a.hp > 0 && a.tactic === "dive" && a.target === eid) : false;
    const liveTorp = eid ? this.aircraft.some((a: Any) => a.team === "jp" && a.kind === "torpedo" && a.hp > 0 && a.tactic === "torpedo-run" && (a.torpedo ?? 0) > 0 && a.target === eid) : false;
    const flags = this.voiceFlags;
    const edge = (key: string, condition: boolean, id: string, valid: () => boolean) => {
      if (condition && !flags[key]) {
        flags[key] = true;
        this.voice(id, { valid });
      } else if (!condition) flags[key] = false;
    };
    edge("r06", liveZero, "R06", () => this.aircraft.some((a: Any) => a.team === "jp" && a.kind === "fighter" && a.airframe === "zero" && a.hp > 0 && a.mode === "flight" && near(a)));
    edge("r07", liveDive, "R07", () => (eid ? this.aircraft.some((a: Any) => a.team === "jp" && a.kind === "bomber" && a.hp > 0 && a.tactic === "dive" && a.target === eid) : false));
    edge("r08", liveTorp, "R08", () => (eid ? this.aircraft.some((a: Any) => a.team === "jp" && a.kind === "torpedo" && a.hp > 0 && a.tactic === "torpedo-run" && (a.torpedo ?? 0) > 0 && a.target === eid) : false));
    if (liveZero || liveDive || liveTorp) {
      flags.lastAttack = this.time;
      flags.r10 = false;
    } else if (flags.lastAttack > 0 && this.time - flags.lastAttack > 15 && !flags.r10) {
      flags.r10 = true;
      this.voice("R10");
    }
    const integrity = p.damage?.engine?.integrity ?? 1;
    if (!flags.r13 && integrity < 0.55) {
      flags.r13 = true;
      this.voice("R13", { valid: () => (this.player.damage?.engine?.integrity ?? 1) < 0.75 });
    }
    if (!flags.r14 && p.fuel < 22) {
      flags.r14 = true;
      this.voice("R14", { valid: () => this.player.fuel < 30 });
    }
    if (this.time > (flags.r19next ?? 0)) {
      const f = forward(p.heading, p.pitch);
      const rear = this.aircraft.find((a: Any) => {
        if (a.team !== "jp" || a.hp <= 0) return false;
        const d = distance3(a, p);
        return d < 650 && d > 25 && ((a.x - p.x) * f.x + (a.y - p.y) * f.y + (a.z - p.z) * f.z) / (d || 1) < -0.6;
      });
      if (rear) {
        flags.r19next = this.time + 12;
        const id = rear.id;
        this.voice("R19", {
          valid: () => {
            const q = this.aircraft.find((a: Any) => a.id === id && a.hp > 0);
            if (!q) return false;
            const g = forward(this.player.heading, this.player.pitch);
            const d = distance3(q, this.player);
            return d < 900 && ((q.x - this.player.x) * g.x + (q.y - this.player.y) * g.y + (q.z - this.player.z) * g.z) / (d || 1) < -0.4;
          },
        });
      }
    }
    if (!flags.p01 && this.time > 3) {
      flags.p01 = true;
      this.voice("P01");
    }
    if (!flags.p04 && enterprise && enterprise.fire > 0.2) {
      flags.p04 = true;
      this.voice("P04", { valid: () => (enterprise.fire ?? 0) > 0.05 });
    }
    if (!flags.r11 && enterprise && enterprise.deck < 0.25) {
      flags.r11 = true;
      this.voice("R11");
    }
  }

  fx(type: string, p: Any, size = 1): void {
    this.effects.push({
      id: this.id("fx"),
      type,
      x: p.x,
      y: p.y ?? 0,
      z: p.z,
      size,
      age: 0,
      life: type === "muzzle" ? 0.18 : type === "splash" ? 5 : type === "flak" ? 8 : type === "hit" ? 1.5 : 9,
    });
    if (this.effects.length > 140) this.effects.shift();
  }

  get home(): Any {
    return this.ships.find((s) => s.id === this.player.home);
  }

  get operationalEnemyCarriers(): Any[] {
    return this.ships.filter((s) => s.team === "jp" && s.kind === "carrier" && !s.sunk && s.deck >= LAUNCH_DECK);
  }

  /** The deck this aircraft is actually being recovered by: the assigned one while it is usable. */
  get recoveryCarrier(): Any {
    const p = this.player;
    const chosen = this.ships.find((s: Any) => s.id === p.home);
    if (chosen && !chosen.sunk && chosen.team === "us" && chosen.kind === "carrier" && chosen.deck > RECOVERY_DECK)
      return chosen;
    return recoveryDeck(this.ships, p, RECOVERY_DECK);
  }

  approach(): IApproach {
    return approach(this.player, this.recoveryCarrier);
  }

  /** H: pick a live friendly deck and set the return course through the astern setup point. */
  goHome(): Any {
    const s = recoveryDeck(this.ships, this.player, RECOVERY_DECK);
    if (!s) {
      this.event("notice", { text: "NO OPERATIONAL FRIENDLY FLIGHT DECK" });
      return null;
    }
    Object.assign(this.player, { home: s.id, nav: "home", autopilot: true, divertNotice: false });
    return s;
  }

  /**
   * Observed normalized burn, so a fuel leak shows up in the reserve estimate without the engine
   * physics or the tank being touched.
   */
  observeFuel(): void {
    const p = this.player;
    const prev = (p.fuelSample ??= { time: this.time, fuel: p.fuel });
    const span = this.time - prev.time;
    if (span < 2) return;
    const rate = (prev.fuel - p.fuel) / span;
    if (Number.isFinite(rate) && rate > 0) p.burnRate = p.burnRate ? p.burnRate + (rate - p.burnRate) * 0.4 : rate;
    p.fuelSample = { time: this.time, fuel: p.fuel };
  }

  returnReserve(): IReserve {
    const p = this.player;
    return reserveEstimate(p.fuel, p.burnRate ?? 0, routeLength(p, this.recoveryCarrier), Math.hypot(p.vx || 0, p.vz || 0));
  }

  /**
   * Re-evaluate the deck during transit and final. A deck lost underneath the aircraft diverts it
   * to another; with none left the assist is cancelled and the pilot is told once, truthfully.
   */
  updateRecovery(): void {
    const p = this.player;
    if (p.mode !== "flight" || p.nav !== "home") return;
    const current = this.ships.find((s: Any) => s.id === p.home);
    if (current && !current.sunk && current.team === "us" && current.deck > RECOVERY_DECK) {
      p.divertNotice = false;
      return;
    }
    const next = recoveryDeck(this.ships, p, RECOVERY_DECK);
    if (next) {
      p.home = next.id;
      if (p.landingAssist && p.landingAssist !== next.id) {
        p.landingAssist = null;
        this.say("LSO", "Wave off! That deck is gone. Take it around to the new carrier.", true);
      }
      if (!p.divertNotice) {
        p.divertNotice = true;
        this.say("LSO", `Deck unavailable. Divert to ${next.name}.`, true);
      }
    } else if (!p.divertNotice) {
      p.divertNotice = true;
      p.landingAssist = null;
      p.autopilot = false;
      this.say("BATTLE CONTROL", "No friendly flight deck remains. You have control.", true);
    }
  }

  get navigationPoint(): Any {
    if (this.player.nav === "home") {
      const a = this.approach();
      if (a.carrier) return { ...a.point, y: a.altitude };
    }
    if (this.target) {
      const c = this.contacts.get(this.target);
      if (c) return { ...contactEstimate(c, this.time), y: 1800 };
    }
    return this.search;
  }

  /**
   * What the wing is actually doing, not what it was told. An accepted order is never reported as
   * an executed attack: the counts come from live aircraft, their tactic and their real target.
   */
  wingStatus(): string {
    const wing = this.aircraft.filter((a: Any) => a.wing === true && a.team === "us" && a.hp > 0);
    if (!wing.length) return "No wing aircraft airborne.";
    const designated = this.sortie.target;
    const counts = new Map<string, number>();
    for (const a of wing) {
      const attacking = a.tactic === "dive" || a.tactic === "torpedo-run";
      const state = ["launch", "muster", "formation"].includes(a.tactic)
        ? "forming"
        : a.tactic === "rtb" || a.tactic === "landing" || a.tactic === "ditching"
          ? "returning"
          : attacking && designated && a.target === designated
            ? "attacking the designated carrier"
            : attacking
              ? "attacking other shipping"
              : a.tactic === "intercept" || a.tactic === "evade" || a.tactic === "extend"
                ? "engaged"
                : a.tactic === "escort"
                  ? "escorting"
                  : "en route";
      counts.set(state, (counts.get(state) ?? 0) + 1);
    }
    const summary = [...counts].map(([state, n]) => `${n} ${state}`).join(" · ");
    if (this.command === "strike" && !designated)
      return `${summary}. No valid strike target designated.`;
    return `${summary}.`;
  }

  setCommand(cmd: string): void {
    this.command = cmd;
    const texts: Record<string, string> = {
      cover: "Stay on my wing. Cover the Dauntless.",
      strike: "Attack the designated carrier. Break by sections.",
      engage: "Clear those fighters off our tails.",
      rtb: "All aircraft, return to your carriers.",
    };
    this.say("SCOUT TWO", texts[cmd] || cmd);
  }

  /** Live aircraft, which is what the active cap is measured against. */
  get activeAircraft(): number {
    return this.aircraft.filter((a: Any) => a.hp > 0).length;
  }

  /**
   * Refresh the three derived fields the deck gate reads, then ask `carrier-ops.suspendReason` for
   * the one readable reason. Nothing else anywhere decides whether a deck can work, and the parked
   * aircraft the renderer draws are this same inventory rather than a second count.
   */
  refreshDeck(s: Any): void {
    if (!s?.deckState) return;
    // `carrier-ops` returns a deck to `available` only when a service or repair completes, but the
    // deck itself is clear the moment the interval a launch or recovery charged has elapsed: the
    // aircraft still waiting are below in the hangar. Releasing the mode here is what lets one deck
    // launch and service at the same time while a launch and a recovery still conflict on the wires.
    if (s.deckState.mode !== "available" && s.deckState.occupiedUntil <= this.time) s.deckState.mode = "available";
    s.evading = (s.evadeUntil || 0) > this.time;
    s.corridorFire = s.fire > 0.6;
    s.deckState.suspended = suspendReason(s);
    s.reserve = countOf(s.air.ready);
  }

  /** The single suspension gate, for the HUD as much as for the simulation. */
  deckSuspension(s: Any): string | null {
    this.refreshDeck(s);
    return s.deckState?.suspended ?? null;
  }

  /**
   * Fly one aircraft off a deck. `role` names what the mission wants; the airframe, the store it
   * burns and the aircraft's kind all follow from the deck's own inventory. Every refusal — the
   * active cap, an occupied deck, a suspended deck, an empty rack, no ready airframe, no aviation
   * fuel — leaves the aircraft, its store and its fuel aboard, so a queued launch costs nothing and
   * happens later when a slot frees.
   */
  launch(s: Any, role = "fighter"): Any {
    if (!s || s.sunk || !s.air || !s.deckState) return null;
    this.refreshDeck(s);
    const airframe = ROLE_AIRFRAMES[role]?.[s.team];
    if (!airframe) return null;
    const store = storeFamilyOf(airframe);
    const check = canLaunch(s.air, s.deckState, airframe, store, this.time, this.activeAircraft, ACTIVE_CAP);
    if (!check.ok || s.air.fuel < FUEL_PER_LAUNCH) {
      s.launchBlocked = check.ok ? "no aviation fuel" : check.reason;
      return null;
    }
    s.launchBlocked = null;
    const applied = applyLaunch(s.air, s.deckState, airframe, store, this.time, TIMES);
    s.air = applied.air;
    s.air.fuel -= FUEL_PER_LAUNCH;
    s.deckState = applied.deck;
    this.refreshDeck(s);
    const kind = role;
    s.launchCount += 1;
    const f = forward(s.heading);
    const a: Any = {
      id: this.id("air"),
      team: s.team,
      kind,
      home: s.id,
      x: s.x + f.x * 100,
      y: 23,
      z: s.z + f.z * 100,
      heading: s.heading,
      pitch: 0.08,
      roll: 0,
      speed: 42,
      hp: kind === "fighter" ? 70 : 95,
      maxHp: kind === "fighter" ? 70 : 95,
      fuel: 520 + this.random() * 120,
      ammo: 350,
      bombs: kind === "bomber" ? 1 : 0,
      torpedo: kind === "torpedo" ? 1 : 0,
      mode: "launch",
      age: 0,
      think: 0,
      target: null,
      gunTimer: this.random(),
      attackCooldown: 0,
      wing: s.id === this.player?.home,
      phase: this.random() * 6.28,
      vx: 0,
      vy: 0,
      vz: 0,
    };
    initDamage(a);
    a.section = Math.floor((s.launchCount - 1) / 4);
    s.waveTimes ??= {};
    s.waveTimes[a.section] ??= this.time;
    a.musterUntil = s.waveTimes[a.section] + 85;
    a.fuelCapacity = a.fuel;
    a.airframe = airframe;
    a.rearAmmo = kind === "fighter" ? 0 : 240;
    a.rearTimer = 0;
    this.aircraft.push(a);
    return a;
  }

  launchRecon(): void {
    const s = this.island;
    this.aircraft.push({
      id: this.id("air"),
      team: "us",
      kind: "recon",
      airframe: "catalina",
      home: "midway",
      x: s.x,
      y: 25,
      z: s.z,
      heading: bearing(s, this.search),
      pitch: 0.15,
      roll: 0,
      speed: 66,
      hp: 85,
      maxHp: 85,
      fuel: 1200,
      ammo: 100,
      bombs: 0,
      torpedo: 0,
      mode: "launch",
      age: 0,
      think: 0,
      target: null,
      gunTimer: 0,
      attackCooldown: 0,
      wing: false,
      phase: 0,
      vx: 0,
      vy: 0,
      vz: 0,
    });
  }

  /**
   * Take one aircraft back aboard, or refuse because the deck is not free. `carrier-ops` has a
   * `canLaunch` but no `canRecover`, so the occupancy and suspension test for the recovery side lives
   * here; `navigateHome` holds the aircraft in the pattern until it passes. A recovered aircraft is
   * counted again immediately but is *not* ready and carries no store: it waits for the crew.
   */
  recoverAircraft(s: Any, a: Any): boolean {
    if (!s?.air || !s.deckState) return true;
    this.refreshDeck(s);
    if (s.deckState.suspended || s.deckState.occupiedUntil > this.time) return false;
    const damaged = a.hp < (a.maxHp || 100) * 0.5 || (a.damage?.engine?.integrity ?? 1) < 0.6;
    const applied = applyRecovery(s.air, s.deckState, a.airframe, this.time, TIMES, damaged);
    s.air = applied.air;
    s.deckState = applied.deck;
    this.refreshDeck(s);
    return true;
  }

  /**
   * Move up to `n` aircraft on deck out of the ready line and into the damaged line. They are still
   * this ship's airframes — a repair may return them, and a failed repair is where one is finally
   * written off — so nothing here invents or destroys an identity.
   */
  wreckAircraft(s: Any, n: number): void {
    if (!s.air) return;
    const air = s.air;
    if (!deckHasWork(air)) air.serviceSince = this.time;
    for (let i = 0; i < n; i += 1) {
      let pick: string | null = null;
      for (const airframe in air.ready) if (air.ready[airframe] > 0 && (!pick || air.ready[airframe] > air.ready[pick])) pick = airframe;
      if (!pick) return;
      air.ready[pick] -= 1;
      air.damaged[pick] = (air.damaged[pick] ?? 0) + 1;
    }
    this.refreshDeck(s);
  }

  /** Ordnance and aviation fuel destroyed outright. Nothing replaces these for the rest of the day. */
  burnStores(s: Any, rounds: number, fuel: number): void {
    if (!s.air) return;
    const stores = s.air.stores;
    for (let i = 0; i < rounds; i += 1) {
      let pick: string | null = null;
      for (const family in stores) if (stores[family] > 0 && (!pick || stores[family] > stores[pick])) pick = family;
      if (!pick) break;
      stores[pick] -= 1;
    }
    s.air.fuel = Math.max(0, s.air.fuel - fuel);
  }

  /** One airframe that will never come home, charged to the deck that launched it. */
  recordLoss(a: Any): void {
    if (!a || a === this.player || a.lossCounted) return;
    a.lossCounted = true;
    const h = this.ships.find((s: Any) => s.id === a.home);
    if (h) h.lostAircraft = (h.lostAircraft || 0) + 1;
  }

  /**
   * One carrier's cycle at the operational cadence: finish deck work, re-evaluate the mission when
   * its commitment window has run out, then put up at most one aircraft — the role the mission is
   * furthest short of. There is no launch timer and no type sequence; a deck that wants nothing
   * launches nothing.
   */
  updateCarrier(s: Any): void {
    this.refreshDeck(s);
    if (deckHasWork(s.air)) {
      const before = totalAircraft(s.air);
      const stepped = stepService(s.air, s.deckState, this.time, TIMES, this.random());
      s.air = stepped.air;
      s.deckState = stepped.deck;
      s.writtenOff += before - totalAircraft(s.air);
      this.refreshDeck(s);
    }
    if (s.deckState.suspended) return;
    if (!s.mission || this.time >= s.mission.until) {
      const ready: Record<string, number> = {};
      for (const role in ROLE_AIRFRAMES) {
        const airframe = ROLE_AIRFRAMES[role][s.team];
        const store = storeFamilyOf(airframe);
        ready[role] = (s.air.stores[store] ?? 0) > 0 ? (s.air.ready[airframe] ?? 0) : 0;
      }
      s.mission = chooseCarrierMission(this, s, ready, COMMIT_SECONDS);
    }
    const want: Record<string, number> = s.mission?.want ?? {};
    let role: string | null = null;
    let shortest = 0;
    for (const key in want) {
      const flying = this.aircraft.filter((a: Any) => a.hp > 0 && a.home === s.id && a.kind === key).length;
      const deficit = want[key] - flying;
      if (deficit > shortest) {
        shortest = deficit;
        role = key;
      }
    }
    // Nothing wanted is not a blocked deck: the reason the HUD reads must not outlive its attempt.
    if (role) this.launch(s, role);
    else s.launchBlocked = null;
  }

  /** Every observer of one side that could see anything at all, with its own height and reach. */
  observersFor(team: string): Any[] {
    const out: Any[] = [];
    for (const a of this.aircraft)
      if (a.team === team && a.hp > 0 && a.mode !== "crashing" && a.mode !== "launch")
        out.push({
          id: a.id,
          x: a.x,
          z: a.z,
          altitude: Math.max(0, a.y),
          range: (a.kind === "recon" ? 7200 : 6000) * VISIBILITY,
          delay: AIR_REPORT_DELAY,
        });
    for (const s of this.ships)
      if (s.team === team && !s.sunk && (s.kind !== "sub" || s.surfaced))
        out.push({
          id: s.id,
          x: s.x,
          z: s.z,
          // A masthead lookout, or a boat's bridge with its deck awash.
          altitude: s.kind === "sub" ? 5 : s.deckHeight,
          range: 6000 * VISIBILITY,
          delay: SHIP_REPORT_DELAY,
        });
    return out;
  }

  /**
   * One observation sweep per side. What a sweep produces is a *report* — dated, classified by range,
   * delayed by its transmission and carrying an error radius — never a copy of a live ship record.
   * A target already tracked recently is left alone, so the seeded draws stay proportional to real
   * reports rather than to the frame rate.
   */
  observeFleet(): void {
    for (const team of ["us", "jp"]) {
      const observers = this.observersFor(team);
      if (!observers.length) continue;
      for (const target of this.ships) {
        if (target.team === team || target.sunk) continue;
        // The last time this side put anything on the air about this hull, delivered or still in
        // transit: a fleet files a track update, not one report per observer per second.
        const held = this.teamIntel[team].get(target.id);
        const last = Math.max(held?.observedAt ?? -Infinity, this.filed[team].get(target.id) ?? -Infinity);
        if (this.time - last < TRACK_SECONDS) continue;
        const targetAltitude = target.kind === "sub" ? (target.surfaced ? 2 : -40) : target.deckHeight;
        for (const o of observers) {
          if (
            !canObserve({
              observer: o,
              target,
              observerAltitude: o.altitude,
              targetAltitude,
              rangeLimit: o.range,
              visibility: VISIBILITY,
              sightDepth: SIGHT_DEPTH,
            })
          )
            continue;
          this.fileReport(team, o, target);
          break;
        }
      }
    }
  }

  /** Classify what was seen by the range it was seen at, date it, and put it on the air. */
  fileReport(team: string, observer: Any, target: Any): void {
    const range = distance2(observer, target);
    const truth = classOf(target);
    const { classification, confidence } = classify({ truth, range, random: this.random() });
    const identified = classification === truth;
    this.filed[team].set(target.id, this.time);
    this.reports.push({
      ...makeContact({
        id: target.id,
        team: team as Team,
        observerId: observer.id,
        targetId: target.id,
        observedAt: this.time,
        delay: observer.delay,
        x: target.x,
        z: target.z,
        heading: target.heading,
        speed: target.speed,
        errorRadius: 60 + range * 0.05,
        classification,
        confidence,
      }),
      name: identified ? target.name : CLASS_LABELS[classification],
      kind: classification,
      time: this.time,
      identified,
      source: observer.id.startsWith("air") ? "aircraft report" : "fleet lookout",
      reported: true,
    });
  }

  /**
   * Hand over every report whose transmission time has come. A report already on the air is
   * delivered whether or not the observer that filed it is still alive, and the fresher of two
   * reports on the same hull wins. An identification once made is never lost to a vaguer sighting.
   */
  deliverReports(): void {
    if (!this.reports.length) return;
    const waiting: IReport[] = [];
    for (const r of this.reports) {
      if (!isDelivered(r, this.time)) {
        waiting.push(r);
        continue;
      }
      const store = this.teamIntel[r.team];
      const prev = store.get(r.id);
      const won = prev ? (mergeContact(prev, r) as IReport) : r;
      store.set(r.id, this.keepIdentity(prev, won));
      if (r.team === "us") {
        const shown = this.contacts.get(r.id);
        if (!shown || shown.time < won.time) this.contacts.set(r.id, this.keepIdentity(shown, won));
      }
    }
    this.reports = waiting;
  }

  /** A newer, vaguer report improves the position but cannot un-identify a hull already named. */
  keepIdentity(prev: IReport | undefined, next: IReport): IReport {
    if (!prev?.identified || next.identified) return next;
    return { ...next, name: prev.name, kind: prev.kind, identified: true };
  }

  dropBomb(a: Any = this.player): boolean {
    if (a.mode !== "flight" && a.mode !== "attack") return false;
    if (a.bombs <= 0) {
      if (a === this.player) this.event("notice", { text: "NO BOMBS — RETURN TO A FRIENDLY CARRIER" });
      return false;
    }
    a.bombs -= 1;
    updateStores(a);
    const mark = this.releaseStamp(a);
    const f = forward(a.heading, a.pitch);
    const physical = Number.isFinite(a.vx);
    const heavy = a !== this.player || a.bombs >= 2;
    this.bombs.push({
      id: this.id("bomb"),
      x: a.x,
      y: a.y - 1.6,
      z: a.z,
      vx: physical ? a.vx : f.x * a.speed,
      vy: (physical ? a.vy : f.y * a.speed) - 2,
      vz: physical ? a.vz : f.z * a.speed,
      team: a.team,
      owner: a.id,
      age: 0,
      damage: heavy ? 155 : 55,
      stamp: mark,
    });
    if (a === this.player) {
      this.stats.bombsDropped += 1;
      this.event("bomb", { weapon: "bomb" });
      this.voice("R17");
    }
    return true;
  }

  /**
   * Snapshot objective eligibility on the rack, not on impact: a recall or retask after release can
   * neither revoke nor grant this weapon's credit. Only the player and an actually ordered wing
   * aircraft carry a stamp; every other allied weapon damages the ship without scoring the sortie.
   */
  releaseStamp(a: Any): IStamp | null {
    const ordered = a !== this.player && a.wing === true && this.command === "strike";
    if (a !== this.player && !ordered) return null;
    return stamp(this.sortie, this.sortie.target, ordered);
  }

  /**
   * Keep the designated target honest: follow what the player designated while it is a known live
   * enemy carrier, say so when it is lost, and never silently reveal an unknown replacement.
   */
  updateSortie(): void {
    const s = this.sortie;
    confirmPending(s, (id: string) => this.contacts.get(id));
    if (s.assignment !== "strike") return;
    const live = (id: string | null) => {
      if (!id || !this.contacts.has(id)) return null;
      const ship = this.ships.find((x: Any) => x.id === id);
      return ship && !ship.sunk && ship.kind === "carrier" && ship.team === "jp" ? ship : null;
    };
    if (live(this.target)) s.target = this.target;
    else if (s.target && !live(s.target)) {
      const lost = this.ships.find((x: Any) => x.id === s.target);
      s.target = null;
      if (s.objective === "pending")
        this.say("STRIKE CONTROL", `${lost?.name ?? "Your target"} is out of the fight. Designate another carrier with TAB.`, true);
    }
    if (s.objective !== "pending") return;
    if (!s.target && !this.ships.some((x: Any) => x.team === "jp" && x.kind === "carrier" && !x.sunk)) {
      s.objective = "unavailable";
      this.say("STRIKE CONTROL", "No enemy carrier remains. Return to the task force and report.", true);
    }
  }

  /** Freeze what actually came home, before the deck crew resets fuel, damage and stores. */
  snapshotResult(outcome: Outcome, carrier: Any): IResult {
    const s = this.sortie;
    const p = this.player;
    return {
      assignment: s.assignment,
      outcome: outcome === "recovered" && s.objective !== "achieved" ? "incomplete" : outcome,
      objective: s.objective === "achieved",
      elapsed: Math.max(0, this.time - s.startTime),
      personalHits: s.personalHits,
      wingHits: s.wingHits,
      nearMisses: this.stats.nearMisses,
      reportedCarriers: s.reportedCarriers,
      fuel: p.fuel,
      hp: p.hp,
      damage: damageSummary(p),
      carrier: carrier?.name ?? "",
    };
  }

  fire(a: Any, aim: Any = null): void {
    if (a.ammo <= 0 || a.gunTimer > 0 || a.hp <= 0) return;
    a.gunTimer = a === this.player ? 0.075 : 0.2;
    a.ammo = Math.max(0, a.ammo - 2);
    let f = a === this.player && a.attitude ? attitudeAxes(a).f : forward(a.heading, a.pitch);
    if (aim) {
      const d = distance3(a, aim);
      const lead = d / 850;
      const tx = aim.x + (aim.vx || 0) * lead - a.x;
      const ty = aim.y + (aim.vy || 0) * lead - a.y;
      const tz = aim.z + (aim.vz || 0) * lead - a.z;
      const n = Math.hypot(tx, ty, tz) || 1;
      f = { x: tx / n, y: ty / n, z: tz / n };
    }
    const spread = a === this.player ? 0.003 : 0.012;
    // The player's guns are in the wings: offset along the body's own right axis so the tracers
    // leave the wing leading edge rather than the fuselage. AI aircraft keep the generic offset.
    const axes = a === this.player && a.attitude ? attitudeAxes(a) : null;
    const right = axes ? axes.r : { x: Math.cos(a.heading), y: 0, z: Math.sin(a.heading) };
    const up = axes ? axes.u : { x: 0, y: 1, z: 0 };
    const lateral = a === this.player ? 3.0 : 1.7;
    for (const side of [-1, 1]) {
      const ox = a.x + right.x * side * lateral + f.x * 5 + up.x * 0.05;
      const oy = a.y + right.y * side * lateral + f.y * 5 + up.y * 0.05;
      const oz = a.z + right.z * side * lateral + f.z * 5 + up.z * 0.05;
      this.bullets.push({
        id: this.id("bullet"),
        x: ox,
        y: oy,
        z: oz,
        vx: (f.x + (this.random() - 0.5) * spread) * 950,
        vy: (f.y + (this.random() - 0.5) * spread) * 950,
        vz: (f.z + (this.random() - 0.5) * spread) * 950,
        team: a.team,
        owner: a.id,
        ttl: 2.0,
        type: "gun",
      });
      if (a === this.player)
        this.fx("muzzle", {
          x: a.x + right.x * side * lateral + f.x * 1.7,
          y: a.y + right.y * side * lateral + f.y * 1.7,
          z: a.z + right.z * side * lateral + f.z * 1.7,
        }, 0.55);
    }
    if (a === this.player) {
      a.heat = 1;
      this.event("gun", { weapon: this.gunFamily(a) });
    } else if (distance3(a, this.player) < 2600) {
      // AI guns are only worth a cue when they can be heard; the family carries the identity.
      this.event("gun", {
        at: { x: a.x, y: a.y, z: a.z },
        vel: { x: a.vx || 0, y: a.vy || 0, z: a.vz || 0 },
        source: a.id,
        weapon: this.gunFamily(a),
      });
    }
  }

  /** The weapon identity a firing aircraft emits: player .50, Zero cannon/MG, other Japanese rifle. */
  gunFamily(a: Any): string {
    if (a === this.player) return "gun50";
    if (a.airframe === "zero") {
      a.cannonToggle = !a.cannonToggle;
      return a.cannonToggle ? "cannon20" : "gun77";
    }
    if (a.team === "jp") return "gun77";
    return "gun50";
  }

  report(): number {
    let count = 0;
    let carriers = 0;
    for (const [, c] of this.contacts)
      if (this.time - c.time < 4 && !c.reported) {
        c.reported = true;
        count += 1;
        if (c.kind === "carrier") carriers += 1;
        this.reported += 1;
        this.score += 75;
        // Transmitting is what puts the sighting on the air; the task force holds it one radio delay
        // later, and the strike aircraft can only steer at what the fleet holds.
        this.reports.push({ ...c, deliveredAt: this.time + SHIP_REPORT_DELAY, source: "own report" });
      }
    if (carriers) {
      this.sortie.reportedCarriers += carriers;
      if (this.sortie.assignment === "recon" && this.sortie.objective === "pending") {
        this.sortie.objective = "achieved";
        this.say("SCOUT CONTROL", "Carrier contact acknowledged. Assignment complete — return and recover.", true);
      }
    }
    if (count) {
      this.say("SCOUT TWO", `Enemy fleet confirmed. ${count} vessels. Transmitting bearing and course to the task force.`, true);
      this.say("ENTERPRISE", "Contact received. Strike groups are launching. Mark your target and press 2 to order the attack.");
    } else this.event("notice", { text: "NO NEW VISUAL CONTACTS TO REPORT" });
    return count;
  }

  /**
   * A crew close enough to identify a hull, seeing it: the player's own aircraft, or a scout over the
   * target. This is an identified, dated observation **held by the crew** — not yet a transmitted
   * report. `R` is what hands it to the fleet, and only then does the AI know anything about it.
   */
  recordContact(s: Any, source = "visual"): void {
    const prev = this.contacts.get(s.id);
    this.contacts.set(s.id, {
      ...makeContact({
        id: s.id,
        team: "us",
        observerId: "player",
        targetId: s.id,
        observedAt: this.time,
        delay: 0,
        x: s.x,
        z: s.z,
        heading: s.heading,
        speed: s.speed,
        errorRadius: 60,
        classification: classOf(s),
        confidence: source === "visual" ? 1 : 0.83,
      }),
      // The true hull kind, because this crew identified it. Every unidentified contact carries the
      // degraded classification `intel.classify` gave it instead.
      name: s.name,
      kind: s.kind,
      time: this.time,
      identified: true,
      source,
      reported: prev?.reported || false,
    });
    if (!prev && source === "visual" && s.kind === "carrier") {
      this.say("REAR GUNNER", `Carrier off the nose! ${s.name}, bearing ${String(Math.round((bearing(this.player, s) * 180) / Math.PI) % 360).padStart(3, "0")}. Press R to send the contact.`, true);
      this.voice("R04", { identity: s.id });
      if (!this.target) this.target = s.id;
    }
  }

  damagePlane(a: Any, amount: number, owner: string, zone: DamageZone = "fuselage", point: Any = null, incendiary = true): void {
    if (a.hp <= 0) return;
    const result = applyAircraftHit(a, amount, zone, this.random, incendiary);
    a.lastAttacker = owner;
    this.fx("hit", point || aircraftWorld(a, ZONE_POSITIONS[zone] || ZONE_POSITIONS.fuselage), 0.6);
    if (owner === "player" && a.team === "us") {
      this.stats.friendlyHits += 1;
      this.event("notice", { text: "CHECK FIRE — FRIENDLY AIRCRAFT" });
    }
    if (a === this.player) {
      this.event("damage");
      const summary = damageSummary(a).join(" · ");
      if (summary && this.time > (a.nextDamageRadio || 0)) {
        a.nextDamageRadio = this.time + 8;
        this.say("REAR GUNNER", `${summary}. Keep it flying. H for home; I cuts engine fuel.`, true);
      }
    }
    if (result?.killed) this.planeDestroyed(a, owner);
  }

  planeDestroyed(a: Any, owner: string): void {
    if (a.killCredited) return;
    a.killCredited = true;
    if (a === this.player) {
      this.lose("Aircraft lost to battle damage.");
      return;
    }
    this.recordLoss(a);
    a.hp = 0;
    a.mode = "crashing";
    a.crashAge = 0;
    a.vy = Math.min(-7, a.vy || 0);
    this.fx("explosion", a, 1.15);
    this.event("explosion", { distance: distance3(this.player, a), at: { x: a.x, y: a.y, z: a.z }, material: "air" });
    if (a.damage) a.damage.engine.fire = Math.max(0.55, a.damage.engine.fire);
    if (owner === "player" && a.team === "jp") {
      this.score += 150;
      this.stats.kills += 1;
      this.event("notice", { text: "ENEMY AIRCRAFT DESTROYED  +150" });
    }
  }

  /**
   * Resolve a hit on a ship. `owner` is the projectile's own attacker ID, so the player's counters
   * only move for the player's own weapons: an allied AI hit still damages the ship without
   * awarding a personal hit. `nearMiss` keeps splash damage from being reported as a direct hit.
   */
  damageShip(
    s: Any,
    amount: number,
    point: Any,
    weapon = "bomb",
    team = "us",
    opts: { owner?: string | null; nearMiss?: boolean; stamp?: IStamp | null } = {},
  ): void {
    if (s.sunk) return;
    const owner = opts.owner ?? null;
    const nearMiss = opts.nearMiss === true;
    const hostile = team !== s.team;
    const attacker = owner && owner !== "player" ? this.aircraft.find((a: Any) => a.id === owner) : null;
    const byPlayer = owner === "player" && hostile;
    const byWing = !!attacker && attacker.wing === true && hostile;
    // Preserve who last did effective hostile damage, so a fire that finishes the ship later
    // credits that attacker rather than fabricating a fresh weapon hit.
    if (hostile && amount > 0) s.lastHostileHit = { owner, team, weapon, time: this.time };
    if (owner === "player" && !hostile && amount > 0 && weapon !== "strafe") {
      this.stats.friendlyHits += 1;
      this.event("notice", { text: `CHECK FIRE — ${s.name.toUpperCase()} IS FRIENDLY` });
    }
    if (weapon !== "strafe") this.recordImpact(s, point, { owner, team, weapon, nearMiss, damage: amount });
    const mark: IStamp | null = opts.stamp ?? null;
    // The debrief reports what this crew actually did, so every direct hit counts — including the
    // ones after the assignment is already satisfied.
    if (amount > 0 && !nearMiss && hostile && (weapon === "bomb" || weapon === "torpedo")) {
      if (byPlayer) this.sortie.personalHits += 1;
      else if (byWing && mark?.ordered) this.sortie.wingHits += 1;
    }
    const wasPending = this.sortie.objective === "pending";
    if (amount > 0 && wasPending && hitQualifies(this.sortie, mark, s, weapon, nearMiss)) {
      recordObjectiveHit(this.sortie, s, weapon, mark!.ordered, this.contacts.get(s.id), this.time);
      this.say(
        "SCOUT TWO",
        this.sortie.objective === "achieved"
          ? `${s.name} hit and burning. Assignment complete — returning to the task force.`
          : `${s.name} hit. No eyes on the target — confirmation pending.`,
        true,
      );
    }
    s.hp = Math.max(0, s.hp - amount);
    if (weapon === "bomb") {
      s.deck = Math.max(0, s.deck - amount / 220);
      s.aa = Math.max(0.12, s.aa - amount / 600);
      s.fire = clamp(s.fire + amount / 160, 0, 2);
      // A bomb on a working deck wrecks specific aircraft and burns specific stores, rather than
      // taking points off one generic reserve. The aircraft are repairable; the stores are gone.
      this.wreckAircraft(s, Math.ceil(amount / 40));
      this.burnStores(s, Math.ceil(amount / 60), amount * 0.15);
      s.engine = Math.max(0.12, s.engine - amount / 600);
      this.fx("explosion", point, weapon === "bomb" ? 3.2 : 1);
      this.event("explosion", { distance: distance3(this.player, point), at: { x: point.x, y: point.y, z: point.z }, material: s.kind === "carrier" ? "deck" : "steel", outcome: "hit" });
      if (byPlayer && nearMiss) {
        this.stats.nearMisses += 1;
        this.score += 60;
        this.event("notice", { text: `NEAR MISS — ${s.name.toUpperCase()}  +60` });
      } else if (byPlayer) {
        this.stats.shipHits += 1;
        this.score += 250;
        this.event("notice", { text: `DIRECT HIT — ${s.name.toUpperCase()}  +250` });
      } else if (byWing && !nearMiss) this.stats.wingShipHits += 1;
      if (s.kind === "carrier" && s.deck < LAUNCH_DECK && !s.deckNotified) {
        s.deckNotified = true;
        this.say("BATTLE CONTROL", `${s.name}'s flight deck is out of action. Aircraft launches interrupted.`, true);
      }
    } else if (weapon === "torpedo") {
      if (byPlayer) {
        this.stats.shipHits += 1;
        this.score += 250;
        this.event("notice", { text: `TORPEDO HIT — ${s.name.toUpperCase()} +250` });
      } else if (byWing) this.stats.wingShipHits += 1;
      s.engine = Math.max(0.1, s.engine - 0.3);
      s.fire = clamp(s.fire + 0.3, 0, 2);
      // Flooding. Three hits put the deck past the heavy-list threshold; counter-flooding brings it
      // back slowly, which reopens limited operations without repairing the hull or the stores.
      s.list = clamp((s.list ?? 0) + 0.14, 0, 0.7);
      this.fx("explosion", point, 2.8);
      this.event("explosion", { distance: distance3(this.player, point), at: { x: point.x, y: point.y, z: point.z }, material: "steel", outcome: "torpedo" });
    } else {
      s.aa = Math.max(0.1, s.aa - 0.005);
      s.deck = Math.max(0, s.deck - 0.0008);
      if (this.random() < 0.03) this.wreckAircraft(s, 1);
      this.fx("hit", point, 0.5);
    }
    // A friendly observer sees an enemy carrier burning; a friendly ship reports its own fire.
    if (s.team === "jp" && s.kind === "carrier" && s.fire > 0.5 && !s.burnReported) {
      s.burnReported = true;
      this.voice("R18", { identity: s.id });
    }
    if (s.team === "us" && s.fire > 0.3 && !s.fireReported) {
      s.fireReported = true;
      this.voice("R12", { ship: radioShipName(s.name), identity: s.id });
    }
    if (s.hp <= 0) this.sinkShip(s);
  }

  /**
   * Sink a ship once, crediting whoever last did effective hostile damage — including a fire lit
   * minutes earlier. No weapon hit is invented for a ship that burns down.
   */
  sinkShip(s: Any): void {
    if (s.sunk) return;
    s.sunk = true;
    s.speed = 0;
    this.fx("explosion", s, 5);
    this.say("BATTLE CONTROL", `${s.name} is going down.`, true);
    if (s.team === "us") this.voice("R15", { ship: radioShipName(s.name), identity: s.id });
    const credit = s.lastHostileHit;
    if (!credit) return;
    if (credit.owner === "player") {
      this.score += 700;
      this.stats.shipsSunk += 1;
    } else if (this.aircraft.find((a: Any) => a.id === credit.owner)?.wing === true)
      this.stats.wingShipsSunk += 1;
  }

  /**
   * Keep a bounded list of where a ship was actually hit, in the ship's own frame, so persistent
   * scars and fires can follow the moving hull instead of blooming at its centre.
   */
  recordImpact(s: Any, point: Any, meta: Any): void {
    if (!point || !Number.isFinite(point.x)) return;
    const local = localPoint(point, s);
    (s.impacts ??= []).push({
      forward: local.forward,
      right: local.right,
      height: (point.y ?? 0) - (s.y ?? 0),
      time: this.time,
      ...meta,
    });
    if (s.impacts.length > MAX_IMPACTS) s.impacts.shift();
  }

  lose(reason: string): void {
    if (this.status !== "playing") return;
    if (isShort(this.sortie) && !this.sortie.result) this.sortie.result = this.snapshotResult("lost", this.home);
    this.status = "lost";
    this.reason = reason;
    this.event("explosion");
    this.fx("explosion", this.player, 2.5);
  }

  reason = "";

  step(dt: number, input: Any = {}): void {
    if (this.status !== "playing") return;
    if (!Number.isFinite(dt) || dt <= 0) return;
    // Substep large caller deltas rather than letting bullets/landings tunnel through targets.
    if (dt > 0.05) {
      const n = Math.ceil(dt / 0.04);
      for (let i = 0; i < n; i += 1) this.step(dt / n, input);
      return;
    }
    this.time += dt;
    for (const fx of this.effects) fx.age += dt;
    this.effects = this.effects.filter((f) => f.age < f.life);
    this.updateShips(dt);
    this.updatePlayer(dt, input);
    this.observeFuel();
    this.updateRecovery();
    stepWheels(this.player, dt);
    this.updateAircraft(dt);
    this.updateWeapons(dt);
    this.updateRadio();
    this.intelTick -= dt;
    if (this.intelTick <= 0) {
      this.updateIntel();
      this.updateSortie();
      this.intelTick = 0.35;
    }
    // Strategy runs at a coarse cadence of its own; movement, weapons and hits stay on the fixed
    // step above, so pausing or accelerating time cannot change an inventory or a decision.
    this.opsTick -= dt;
    if (this.opsTick <= 0) {
      this.opsTick = OPS_INTERVAL;
      this.observeFleet();
      this.deliverReports();
      for (const s of this.ships) if (s.kind === "carrier" && !s.sunk && s.air) this.updateCarrier(s);
    }
    if (this.time > 7 && !this.reconLaunched) {
      this.reconLaunched = true;
      this.launchRecon();
    }
    if (this.time > 35 && !this.reconNotice) {
      this.reconNotice = true;
      this.say("PATROL CONTROL", "Reports place the enemy northwest of the task force. Use T for course hold; hold Shift above 400 ft to accelerate quiet transit.");
    }
    if (this.time > 130 && !this.threatNotice) {
      this.threatNotice = true;
      const near = this.aircraft.some((a) => a.team === "jp" && a.kind !== "fighter" && distance2(a, this.home) < 7000);
      if (near) this.say("ENTERPRISE RADAR", "Inbound strike aircraft. Fighters, intercept before they reach the carriers.", true);
    }
    if (this.ships.filter((s) => s.kind === "carrier" && s.team === "us").every((s) => s.sunk)) this.lose("The U.S. carrier force has been lost.");
    if (this.operationalEnemyCarriers.length === 0 && !this.strikeComplete) {
      this.strikeComplete = true;
      this.say("ENTERPRISE", "All four enemy flight decks are neutralized. Return and recover to complete the operation.", true);
    }
  }

  strikeComplete = false;

  updateShips(dt: number): void {
    for (const s of this.ships) {
      if (s.sunk) {
        s.sink = Math.min(1, s.sink + dt * 0.012);
        s.y = -s.sink * 34;
        continue;
      }
      updateEvasion(this, s, dt);
      s.speed = s.baseSpeed * (0.35 + 0.65 * s.engine);
      const f = forward(s.heading);
      s.x += f.x * s.speed * dt;
      s.z += f.z * s.speed * dt;
      if (s.fire > 0) {
        s.fire = Math.max(0, s.fire - dt * 0.0018);
        s.hp = Math.max(0, s.hp - s.fire * 0.35 * dt);
        if (s.fire < 0.35) s.deck = Math.min(1, s.deck + dt * 0.001);
        if (s.hp <= 0) this.sinkShip(s);
      }
      if (s.kind === "carrier") {
        // Counter-flooding, and the deck gate the HUD reads. The launch cycle itself is decided on
        // the operational cadence in `updateCarrier`, not on a per-ship timer.
        if ((s.list ?? 0) > 0) s.list = Math.max(0, s.list - dt * 0.004);
        this.refreshDeck(s);
      }
      if (s.kind === "sub") {
        s.surfaced = Math.sin(this.time / 70 + s.baseX) > 0.1;
        s.torpTimer -= dt;
        // A boat attacks what it has been told about, through the same delivered contacts every other
        // attacker uses. With no report it has nothing to steer at, and a stale one puts the spread
        // where the ship was going rather than where it is.
        const contact = strikeContact(this, s);
        if (contact) {
          const e = estimatePosition(contact, this.time);
          s.heading = wrap(s.heading + clamp(angleDelta(bearing(s, e), s.heading), -0.06 * dt, 0.06 * dt));
          if (s.torpTimer <= 0 && distance2(s, e) < 4800) {
            const aim = bearing(s, e);
            for (const off of [-0.025, 0, 0.025]) this.spawnTorpedo(s, aim + off);
            s.torpTimer = 78;
            if (s.team === "jp" && distance2(s, this.player) < 3000) this.say("LOOKOUT", "Torpedo wakes! Submarine attack near the task force!", true);
          }
        }
        continue;
      }
      updateGunnery(this, s, dt);
    }
  }

  updatePlayer(dt: number, input: Any): void {
    const p = this.player;
    if (p.mode === "spectator") return;
    if (p.mode === "flight") {
      stepDamage(p, dt);
      if (p.hp <= 0) {
        this.planeDestroyed(p, p.lastAttacker);
        return;
      }
    }
    p.gunTimer = Math.max(0, p.gunTimer - dt);
    p.heat = Math.max(0, p.heat - dt * 6);
    const h = this.home;
    // The engine takes the deck datum as a construction-time environment option, so the wrapper is
    // rebound whenever the player's deck changes — a diversion to a carrier 0.4 m taller otherwise
    // rolls and touches down on the previous ship's deck height.
    if (h) this.playerFlight.setDeck(h.deckHeight);
    if (p.mode === "service") {
      if (!h || h.sunk || h.deck < DECK_FAILED) {
        this.lose("The carrier was destroyed during recovery.");
        return;
      }
      p.serviceTime -= dt;
      const f = forward(h.heading);
      p.x = h.x + f.x * -105;
      p.z = h.z + f.z * -105;
      p.y = 22;
      p.speed = 0;
      setAttitude(p, h.heading, 0.22, 0);
      if (p.serviceTime <= 0) {
        Object.assign(p, {
          hp: 100,
          fuel: 100,
          ammo: 1400,
          rearAmmo: 240,
          rearTimer: 0,
          bombs: 3,
          mode: "deck",
          deckOffset: -55,
          deckLateral: 0,
          deckSpeed: 0,
          chocks: true,
          throttle: 0.18,
          brakes: false,
          gear: true,
          gearManual: false,
          autoGearPending: false,
          gearClimbTime: 0,
          flaps: 0.33,
          landingAssist: null,
        });
        applyLoadout(p, p.loadout || "bomb");
        // The player rearms out of the same finite stores as every other aircraft on the ship. With
        // the racks empty the aircraft still flies; it just has nothing to drop.
        const family = storeFamilyOf(p.airframe);
        if (h.air) {
          if ((h.air.stores[family] ?? 0) > 0) {
            h.air.stores[family] -= 1;
            h.air.fuel = Math.max(0, h.air.fuel - FUEL_PER_LAUNCH);
          } else {
            p.bombs = 0;
            p.torpedo = 0;
            updateStores(p);
            this.say("DECK CREW", `No ${family === "torpedo" ? "torpedoes" : "bombs"} left aboard. You are going up empty.`, true);
          }
        }
        this.playerFlight.setAirframe(p.airframe);
        initDamage(p);
        p.killCredited = false;
        this.playerFlight.reset();
        this.stats.sorties += 1;
        this.say("DECK CREW", "Refueled, repaired and rearmed. Takeoff flaps set. Advance power when ready.");
        if (this.strikeComplete) {
          this.status = "won";
          this.reason = "Enemy carrier aviation neutralized. You brought your crew home.";
        }
      }
      return;
    }
    if (p.mode === "arrest") {
      if (!h || h.sunk || h.deck < DECK_FAILED) {
        this.lose("The carrier deck failed during arrestment.");
        return;
      }
      p.deckSpeed = Math.max(0, p.deckSpeed - dt * 19);
      p.deckOffset += p.deckSpeed * dt;
      const f = forward(h.heading);
      p.x = h.x + f.x * p.deckOffset + Math.cos(h.heading) * p.deckLateral;
      p.z = h.z + f.z * p.deckOffset + Math.sin(h.heading) * p.deckLateral;
      setAttitude(p, h.heading, lerp(p.pitch, 0.22, dt * 1.5), 0);
      p.y = h.deckHeight + gearClearance(p);
      p.throttle = 0;
      p.rpm = lerp(p.rpm, 0, dt);
      p.vy = 0;
      p.vx = f.x * (p.deckSpeed + h.speed);
      p.vz = f.z * (p.deckSpeed + h.speed);
      p.speed = Math.hypot(p.vx - this.wind.x, p.vz - this.wind.z);
      p.ias = p.speed * Math.sqrt(airDensity(p.y) / 1.225);
      if (p.deckOffset > h.deckLength / 2) {
        this.lose("The arresting run overran the bow. Touch down farther aft and slower.");
        return;
      }
      if (p.deckSpeed < 0.4) this.recover(h);
      return;
    }
    if (input.throttleUp) p.throttle = clamp(p.throttle + dt * 0.38, 0, 1);
    if (input.throttleDown) p.throttle = clamp(p.throttle - dt * 0.38, 0, 1);
    if (p.fuel <= 0 || p.engineCut) p.throttle = 0;
    p.fuel = Math.max(0, p.fuel - dt * (0.009 + p.throttle * 0.018));
    if (p.mode === "deck") {
      if (!h || h.sunk || h.deck < DECK_FAILED) {
        this.lose("Your carrier can no longer launch aircraft.");
        return;
      }
      const departure = this.playerFlight.stepDeck(h, dt, input);
      if (departure !== null) {
        // Leave the wheels-on-deck regime. `stepDeck` returns the departure but the game owns
        // `mode`, so without this the aircraft stays pinned to the deck and never climbs.
        p.mode = "flight";
        p.takeoffGrace = 2;
        p.departureTime = p.flightTime;
        p.rollRate = 0;
        p.pitchRate = 0;
        p.yawRate = 0;
        p.launchAssist = p.assist ? 9 : 0;
        p.autoGearPending = !p.gearManual;
        p.gearClimbTime = 0;
        if (departure === "liftoff") this.say("ENTERPRISE TOWER", "Positive climb, Scout Two. Gear retracts after a safe climb; G overrides it. N cycles flap settings. Build speed before turning.");
        else this.say("SCOUT THREE", "Off the deck. Watch your airspeed — do not haul back on the stick.", true);
      }
      return;
    }
    if (p.mode !== "flight") return;
    rearGunner(this, p, dt);
    const controls = { ...input };
    if (p.launchAssist > 0) {
      p.launchAssist -= dt;
      if (!input.pitch && !input.turn && !p.autopilot && p.assist) {
        const climb = 3.5 * clamp(((p.ias || p.speed) - 43) / 9, 0, 1);
        controls.pitch = clamp((climb - p.vy) * 0.032, -0.12, 0.08);
        controls.autopilot = true;
      }
    }
    if (p.autopilot && (Math.abs(input.turn || 0) > 0.25 || Math.abs(input.pitch || 0) > 0.25 || Math.abs(input.rudder || 0) > 0.25)) {
      p.autopilot = false;
      p.landingAssist = null;
      this.event("notice", { text: "COURSE HOLD DISENGAGED — YOU HAVE CONTROL" });
    }
    if (p.autopilot) {
      let nav = this.navigationPoint;
      let desiredAlt = p.nav === "home" ? (nav.y ?? 350) : 1800;
      if (p.landingAssist) {
        const s = this.ships.find((s: Any) => s.id === p.landingAssist);
        if (!s || s.sunk || s.deck < RECOVERY_DECK) {
          // Cancel the final, but keep flying the aircraft: `updateRecovery` picks the next
          // available deck and the guidance takes it round again rather than dropping control.
          p.landingAssist = null;
          p.nav = "home";
          this.say("LSO", "Wave off! Deck unavailable.", true);
          this.voice("R22");
        } else {
          const loc = localPoint(p, s);
          const f = forward(s.heading);
          // Chase a point on the centreline ahead of the aircraft. A fixed waypoint is either
          // passed — and the assist banks hard away at deck height — or so far off that a
          // thirty-metre lineup error produces no correction at all. The lead therefore closes with
          // the deck: held at 400 m all the way in, the groove arrived 16 m off the centreline,
          // which is abeam a 20 m deck rather than on it.
          const lead = loc.forward + clamp(-loc.forward * 0.5, 60, GROOVE_LEAD);
          nav = { x: s.x + f.x * lead, z: s.z + f.z * lead };
          // The glide path aims at the deck and keeps descending through it, because an assist that
          // levels at deck height never touches: it floats the length of the ship and off the bow.
          const touch = s.deckHeight + gearClearance(p) - 3;
          desiredAlt = touch + Math.max(0, -loc.forward - GROOVE_FLARE) * GLIDE;
          p.gear = true;
          p.flaps = 1;
          p.brakes = false;
          p.throttle = clamp(0.59 + (50 - (p.ias || p.speed)) * 0.027, 0.12, 0.98);
          if (loc.forward > 100 && p.y > s.deckHeight + 6) {
            // A bolter goes round again on the same guidance. Handing back an unattended aircraft
            // at full power and no autopilot is how a missed wire became a ditching.
            p.landingAssist = null;
            p.nav = "home";
            p.throttle = 1;
            this.say("LSO", "Bolter! Full power; climb out and circle for another approach.", true);
          }
        }
      }
      if (p.autopilot && p.nav === "home" && !p.landingAssist) {
        // Bridge the gap the player used to have to guess: configure the aircraft for the groove so
        // it arrives inside the same envelope `assistRecovery` will accept, and no further. Power is
        // managed across the whole return, because approach power left set after the groove is lost
        // mushes the aircraft into the sea on the way back round.
        const state = this.approach();
        if (state.phase === "groove" || state.phase === "final") {
          p.gear = true;
          p.autoGearPending = false;
          p.flaps = 1;
          p.brakes = false;
          p.throttle = clamp(0.55 + (APPROACH_SPEED - (p.ias || p.speed)) * 0.025, 0.15, 0.95);
        } else {
          p.brakes = false;
          p.throttle = clamp(0.78 + (CRUISE_SPEED - (p.ias || p.speed)) * 0.012, 0.4, 1);
        }
        // Whatever the phase, never hold a stalled aircraft at approach power.
        if ((p.stall ?? 0) > 0.25 || (p.ias ?? p.speed) < 42) p.throttle = 1;
      }
      if (p.autopilot) {
        const desiredBank = clamp(angleDelta(bearing(p, nav), p.heading) * 0.9, -0.62, 0.62);
        const currentBank = -p.roll;
        controls.turn = clamp((desiredBank - currentBank) * 2.5 - p.rollRate * 0.7, -1, 1);
        // The return leg tracks a glide path rather than a cruise altitude, so it needs to close a
        // height error instead of drifting towards one: a lazy gain arrives high and bolters.
        const climbGain = p.nav === "home" ? 0.25 : 0.09;
        // The arrestment gate rejects a descent steeper than 5 m/s, so the assist stays inside it.
        let desiredVY = clamp((desiredAlt - p.y) * climbGain, p.landingAssist ? -4.5 : -12, p.landingAssist ? 3 : 8);
        if ((p.ias || p.speed) < 47) desiredVY = Math.min(desiredVY, 0);
        const baseLoad = clamp(1 / Math.max(0.45, Math.cos(currentBank)), 1, 2.2);
        controls.pitch = clamp((baseLoad - 1) / 4.5 + (desiredVY - p.vy) * 0.02, -0.45, 0.6);
        controls.rudder = 0;
        controls.autopilot = true;
      }
    }
    if (!controls.autopilot) {
      // Keep low-speed stick authority; limit pulling past stall without commanding a push.
      const authority = clamp((p.ias ?? p.speed) / 95, 0.75, 1);
      controls.turn = (controls.turn ?? 0) * 0.6;
      controls.pitch = (controls.pitch ?? 0) * 0.6 * authority;
      if ((p.stall ?? 0) > 0.3) controls.pitch = Math.min(controls.pitch, 0);
    }
    const previousY = p.y;
    this.playerFlight.step(dt, controls);
    if (p.autoGearPending && !p.landingAssist) {
      const safeClimb = p.y > (this.home?.deckHeight ?? 0) + gearClearance(p) + 5 && p.vy > 0.5 && p.stall < 0.1;
      p.gearClimbTime = safeClimb ? p.gearClimbTime + dt : 0;
      if (p.gearClimbTime >= 1) {
        p.gear = false;
        p.autoGearPending = false;
        this.event("notice", { text: "POSITIVE CLIMB — GEAR RETRACTING · G FOR MANUAL CONTROL" });
      }
    }
    if (p.takeoffGrace > 0) p.takeoffGrace -= dt;
    if (input.fire) {
      const f = attitudeAxes(p).f;
      const aim = this.aircraft
        .filter((a: Any) => a.team === "jp" && a.hp > 0 && distance3(p, a) < 1400)
        .find((a: Any) => {
          const d = distance3(p, a);
          return ((a.x - p.x) * f.x + (a.y - p.y) * f.y + (a.z - p.z) * f.z) / (d || 1) > 0.996;
        });
      this.fire(p, aim);
    }
    // Structural stresses accumulate, rather than clamping airspeed or load factor.
    if (p.speed > 177 || Math.abs(p.gforce) > 7.5) {
      p.hp = Math.max(0, p.hp - dt * (Math.max(0, p.speed - 177) * 0.2 + Math.max(0, Math.abs(p.gforce) - 7.5) * 2));
      if (p.hp <= 0) {
        this.lose("Structural failure. Reduce airspeed and use gentler control inputs.");
        return;
      }
    }
    if (p.y < 30 && p.takeoffGrace <= 0) {
      for (const s of this.ships) {
        if (s.kind !== "carrier" || s.sunk || !onDeck(p, s, 0)) continue;
        const contactY = s.deckHeight + gearClearance(p);
        const aligned = Math.abs(angleDelta(p.heading, s.heading)) < 0.23;
        const f = forward(s.heading);
        const relativeSpeed = Math.hypot(p.vx - f.x * s.speed, p.vz - f.z * s.speed);
        const sideSpeed = Math.abs(p.vx * Math.cos(s.heading) + p.vz * Math.sin(s.heading));
        if (p.y <= contactY + 0.12 && previousY >= contactY - 0.6) {
          if (s.team === "us" && s.deck > RECOVERY_DECK && p.gearPos > 0.95 && relativeSpeed < 60 && aligned && Math.abs(p.roll) < 0.18 && p.vy > -5 && p.vy <= 1.1 && sideSpeed < 7) {
            this.touchdown(s);
            return;
          }
          this.lose("Hard deck impact. Lower gear, align from astern, keep wings level and reduce descent below 1,000 ft/min.");
          return;
        }
        if (p.y < s.deckHeight) {
          this.lose("Impact with the carrier. Fly the approach from astern.");
          return;
        }
      }
    }
    if (p.y < 1.1) {
      this.lose("Your aircraft ditched in the Pacific. Unload the wing and regain airspeed before pulling up.");
      return;
    }
    if (Math.abs(p.x) > 28000 || Math.abs(p.z) > 28000) {
      p.autopilot = true;
      p.nav = "home";
      if (!this.boundaryNotice) {
        this.boundaryNotice = true;
        this.say("NAVIGATOR", "Leaving the operation area. Setting a return course.");
      }
    }
  }

  touchdown(s: Any): void {
    const p = this.player;
    const local = localPoint(p, s);
    const f = forward(s.heading);
    Object.assign(p, {
      home: s.id,
      mode: "arrest",
      deckOffset: local.forward,
      deckLateral: local.right,
      deckSpeed: Math.max(0, p.vx * f.x + p.vz * f.z - s.speed),
      autopilot: false,
      landingAssist: null,
      throttle: 0,
    });
    this.event("land");
    this.say("LANDING SIGNAL OFFICER", "Wire caught. Power idle. Hold straight through arrestment.", true);
  }

  recover(s: Any): void {
    // The player's aircraft fouls the straight deck exactly as an AI recovery does, so nothing else
    // launches or lands across it while the crew clears the wires.
    if (s.deckState) s.deckState = { ...s.deckState, mode: "servicing", since: this.time, occupiedUntil: this.time + TIMES.recoveryInterval };
    Object.assign(this.player, {
      home: s.id,
      mode: "service",
      serviceTime: 12,
      speed: 0,
      pitch: 0.22,
      roll: 0,
      autopilot: false,
      landingAssist: null,
    });
    this.score += 200;
    if (isShort(this.sortie) && !this.sortie.result) {
      this.sortie.result = this.snapshotResult("recovered", s);
      this.reason = outcomeText(this.sortie.result);
      this.status = "debrief";
      this.say("LANDING SIGNAL OFFICER", "Aboard and safe. That is the sortie.", true);
      return;
    }
    this.say("DECK CREW", "Welcome aboard. Fuel, ammunition and repairs are under way.", true);
  }

  assistRecovery(): boolean {
    const p = this.player;
    const s = this.recoveryCarrier;
    if (s && finalReady(p, s)) {
      p.home = s.id;
      p.landingAssist = s.id;
      p.autopilot = true;
      p.nav = "home";
      p.flaps = 1;
      this.say("LSO", "Final approach assist engaged. Stay ready to take over. Any stick input cancels.");
      this.voice("R21", { identity: s.id });
      return true;
    }
    const cues = this.approach().cues;
    this.event("notice", { text: `FINAL ASSIST: ${cues.length ? cues.join(" · ") : "UNAVAILABLE"}` });
    return false;
  }

  updateAircraft(dt: number): void {
    updateTacticalAircraft(this, dt);
  }

  dropTorpedo(a: Any = this.player): boolean {
    if (!["flight", "attack"].includes(a.mode) || !a.torpedo) return false;
    const envelope = torpedoEnvelope(a);
    const f = forward(a.heading, a.pitch);
    a.torpedo -= 1;
    updateStores(a);
    const mark = this.releaseStamp(a);
    this.airTorpedoes.push({
      id: this.id("airtorp"),
      x: a.x,
      y: a.y - 1.25,
      z: a.z,
      vx: Number.isFinite(a.vx) ? a.vx : f.x * a.speed,
      vy: (a.vy || 0) - 0.8,
      vz: Number.isFinite(a.vz) ? a.vz : f.z * a.speed,
      heading: a.heading,
      team: a.team,
      owner: a.id,
      age: 0,
      safe: envelope.safe,
      stamp: mark,
    });
    if (a === this.player) {
      this.stats.torpedoesDropped += 1;
      this.event("bomb", { weapon: "torpedo" });
      this.event("notice", { text: envelope.safe ? "TORPEDO AWAY — HOLD COURSE, THEN BREAK CLEAR" : `TORPEDO AWAY / BAD ENTRY: ${envelope.problems.join(" · ")}` });
      this.voice("R17");
    }
    return true;
  }

  spawnTorpedo(a: Any, heading: number, options: Any = {}): Any {
    const f = forward(heading);
    const air = options.aerial || false;
    const speed = air ? (a.team === "jp" ? 21 : 17.25) : 24;
    const t = {
      id: this.id("torpedo"),
      x: a.x,
      y: -1.6,
      z: a.z,
      heading,
      vx: f.x * speed,
      vz: f.z * speed,
      speed,
      team: a.team,
      owner: a.owner || a.id,
      stamp: a.stamp ?? null,
      age: 0,
      ttl: air ? 240 : 200,
      run: 0,
      armedDistance: options.armedDistance ?? (air ? 180 : 90),
    };
    this.torpedoes.push(t);
    return t;
  }

  updateWeapons(dt: number): void {
    const planes = [...this.aircraft, ...(this.player.mode === "flight" ? [this.player] : [])];
    for (const b of this.bullets) {
      const prev = { x: b.x, y: b.y, z: b.z };
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.z += b.vz * dt;
      b.ttl -= dt;
      if (b.type === "flak") {
        if (b.ttl <= 0) {
          this.fx("flak", b, 1.5);
          this.event("flak", { distance: distance3(this.player, b), at: { x: b.x, y: b.y, z: b.z } });
          for (const a of planes) {
            if (a.hp <= 0) continue;
            const dist = distance3(a, b);
            if (dist < 58) {
              const zone = DAMAGE_ZONES[Math.floor(this.random() * DAMAGE_ZONES.length)];
              this.damagePlane(a, Math.max(0.5, 24 * (1 - dist / 58) ** 2), b.owner, zone, null, true);
            }
          }
        }
        continue;
      }
      let nearest: Any = null;
      for (const a of planes) {
        if (a.id === b.owner || a.hp <= 0) continue;
        const h = aircraftHit(a, prev, b);
        if (h && (!nearest || h.t < nearest.t)) nearest = { ...h, a };
      }
      if (nearest) {
        this.damagePlane(nearest.a, b.damage ?? (b.owner === "player" ? 8 : 5), b.owner, nearest.zone, nearest.point, true);
        b.ttl = 0;
      }
      if (!nearest && Math.min(prev.y, b.y) < 30) {
        for (const s of this.ships) {
          if (s.sunk || s.id === b.owner) continue;
          const top = s.deckHeight;
          let at = b;
          if (prev.y > top && b.y <= top) {
            const u = (prev.y - top) / (prev.y - b.y || 1);
            at = { x: lerp(prev.x, b.x, u), y: top, z: lerp(prev.z, b.z, u) };
          }
          if (at.y > 0 && at.y <= top + 0.2 && overHull(at, s, 1)) {
            this.damageShip(s, 0.7, at, "strafe", b.team, { owner: b.owner });
            b.ttl = 0;
            break;
          }
        }
      }
      if (b.y <= 0) {
        if (this.random() < 0.4) this.fx("splash", b, 0.18);
        b.ttl = 0;
      }
    }
    this.bullets = this.bullets.filter((b) => b.ttl > 0).slice(-850);
    for (const b of this.bombs) {
      const prev = { x: b.x, y: b.y, z: b.z };
      b.age += dt;
      b.x += b.vx * dt;
      b.y += b.vy * dt - 0.5 * 9.81 * dt * dt;
      b.z += b.vz * dt;
      b.vy -= 9.81 * dt;
      let hit: Any = null;
      let point = b;
      for (const s of this.ships) {
        if (s.sunk) continue;
        // A submarine has no deck worth bombing: its hit plane is the water it is sitting in.
        const top = s.kind === "sub" ? 0 : s.deckHeight;
        if (prev.y >= top && b.y <= top) {
          const u = (prev.y - top) / (prev.y - b.y || 1);
          const at = { x: lerp(prev.x, b.x, u), y: top, z: lerp(prev.z, b.z, u) };
          if (overHull(at, s, 3)) {
            hit = s;
            point = at;
            break;
          }
        }
      }
      if (hit) {
        this.damageShip(hit, b.damage || 155, point, "bomb", b.team, { owner: b.owner, stamp: b.stamp });
        b.dead = true;
      } else if (b.y <= 0) {
        this.fx("splash", b, 3.5);
        this.event("splash", { distance: distance3(this.player, b), at: { x: b.x, y: b.y, z: b.z } });
        for (const s of this.ships) {
          const l = localPoint(b, s);
          const d = Math.hypot(Math.max(0, Math.abs(l.right) - s.hullBeam / 2), Math.max(0, Math.abs(l.forward) - s.hullLength / 2));
          if (d < 55 && !s.sunk)
            this.damageShip(s, (b.damage || 155) * 0.4 * (1 - d / 55), b, "bomb", b.team, { owner: b.owner, nearMiss: true, stamp: b.stamp });
        }
        b.dead = true;
      }
      if (b.age > 80) b.dead = true;
    }
    this.bombs = this.bombs.filter((b) => !b.dead);
    for (const t of this.airTorpedoes) {
      const prev = { x: t.x, y: t.y, z: t.z };
      t.age += dt;
      t.x += t.vx * dt;
      t.y += t.vy * dt - 4.905 * dt * dt;
      t.z += t.vz * dt;
      t.vy -= 9.81 * dt;
      for (const s of this.ships) {
        const top = s.deckHeight;
        if (s.sunk || prev.y < top || t.y > top) continue;
        const u = (prev.y - top) / (prev.y - t.y || 1);
        const hit = { x: lerp(prev.x, t.x, u), y: top, z: lerp(prev.z, t.z, u) };
        if (overHull(hit, s)) {
          t.dead = true;
          this.fx("hit", hit, 1.3);
          break;
        }
      }
      if (t.y <= 0 && !t.dead) {
        const u = clamp(prev.y / (prev.y - t.y || 1), 0, 1);
        const entry = { ...t, x: lerp(prev.x, t.x, u), z: lerp(prev.z, t.z, u) };
        this.fx("splash", entry, 0.8);
        if (t.safe) {
          this.spawnTorpedo(entry, Math.atan2(t.vx, -t.vz), { aerial: true });
          if (t.owner === "player") this.event("notice", { text: "TORPEDO RUNNING — STRAIGHT COURSE / ARMING" });
        } else if (t.owner === "player") this.event("notice", { text: "TORPEDO BROKE UP ON ENTRY — CHECK HEIGHT / SPEED / BANK" });
        t.dead = true;
      }
      if (t.age > 35) t.dead = true;
    }
    this.airTorpedoes = this.airTorpedoes.filter((t) => !t.dead);
    for (const t of this.torpedoes) {
      const prev = { ...t };
      t.x += t.vx * dt;
      t.z += t.vz * dt;
      t.age += dt;
      t.ttl -= dt;
      t.run += Math.hypot(t.vx, t.vz) * dt;
      for (const s of this.ships) {
        if (s.sunk) continue;
        const b = localPoint(t, s);
        const a = localPoint(prev, s);
        let lo = 0;
        let hi = 1;
        for (const [key, extent] of [["right", s.hullBeam / 2 + 1], ["forward", s.hullLength / 2]] as [string, number][]) {
          const d = (b as Any)[key] - (a as Any)[key];
          if (Math.abs(d) < 1e-9) {
            if (Math.abs((a as Any)[key]) > extent) {
              lo = 2;
              break;
            }
          } else {
            let u = (-extent - (a as Any)[key]) / d;
            let v = (extent - (a as Any)[key]) / d;
            if (u > v) [u, v] = [v, u];
            lo = Math.max(lo, u);
            hi = Math.min(hi, v);
          }
        }
        if (lo <= hi && lo <= 1 && hi >= 0) {
          const impact = { x: lerp(prev.x, t.x, Math.max(0, lo)), y: 2, z: lerp(prev.z, t.z, Math.max(0, lo)) };
          if (t.run >= t.armedDistance) this.damageShip(s, 145, impact, "torpedo", t.team, { owner: t.owner, stamp: t.stamp });
          else this.fx("splash", impact, 0.7);
          t.ttl = 0;
          break;
        }
      }
    }
    this.torpedoes = this.torpedoes.filter((t) => t.ttl > 0);
  }

  /**
   * The player's own eyes, and a scout close enough over a hull to identify it. Detection by radius
   * that copied a live ship's name, course and exact deck health into both sides' knowledge is gone:
   * every other observer files a dated, range-classified, delayed report in `observeFleet`, and the
   * AI reads nothing else.
   */
  updateIntel(): void {
    const p = this.player;
    for (const s of this.ships) {
      if (s.team === "us" || s.sunk || (s.kind === "sub" && !s.surfaced)) continue;
      const d = distance2(s, p);
      const angle = Math.abs(angleDelta(bearing(p, s), p.heading));
      const visualRange = clamp(2900 + p.y * 1.8, 2900, 6200);
      if (p.mode === "flight" && d < visualRange && (angle < 1.45 || d < 1300)) this.recordContact(s);
      else if (this.aircraft.some((a) => a.team === "us" && a.kind === "recon" && distance2(a, s) < 4300)) {
        const was = this.contacts.has(s.id);
        this.recordContact(s, "PBY reconnaissance");
        if (!was && s.kind === "carrier") this.say("CATALINA FIVE", `Carrier contact northwest. ${s.name} sighted. Position entered on your intelligence map.`, true);
      }
    }
  }

  canAccelerate(): boolean {
    return (
      this.player.mode === "flight" &&
      this.player.y > 120 &&
      damageSummary(this.player).length === 0 &&
      !this.aircraft.some((a) => a.team === "jp" && distance3(a, this.player) < 2400) &&
      !this.ships.some((s) => s.team === "jp" && !s.sunk && distance2(s, this.player) < 2800)
    );
  }
}
