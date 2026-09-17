/** Pure deterministic game state. Rendering, audio and browser APIs stay outside this module. */
import { updateGunnery, updateEvasion } from "./gunnery.js";
import { chooseCarrierMission, DESTROYED_MODIFIERS, fireRearManual, REAR_GUN_DOT, REAR_GUN_ELEVATION, rearGunner, strikeContact, updateTacticalAircraft } from "./tactics.js";
import {
  aircraftHit,
  aircraftWorld,
  applyAircraftHit,
  classCapacity,
  damageSummary,
  initDamage,
  stepDamage,
  stepWheels,
  DAMAGE_ZONES,
  ZONE_POSITIONS,
  type DamageZone,
} from "./damage.js";
import {
  ASSIST_FACTOR,
  assistBenefit,
  assistCost,
  canAssist,
  detach,
  stepRescue,
  stepWrecks,
  wreckMarker,
  DEFAULT_RESCUE_LIMITS,
  type Survivors,
  type WreckMarker,
} from "./rescue.js";
import {
  actualRunDepth,
  applyLoadout,
  initRearState,
  REAR_BELT_LOADED,
  rearReloading,
  rearRoundsFor,
  startRearReload,
  torpedoEnvelope,
  torpedoVariant,
  torpedoVariantForAirframe,
  updateStores,
  type ILoadout,
  LOADOUTS,
} from "./armament.js";
import { screenIntercept, stepRun } from "./torpedo-run.js";
import {
  ASSIGNMENTS,
  concludeOperation,
  confirmPending,
  hitQualifies,
  isShort,
  newSortie,
  operationOutcome,
  outcomeText,
  pendingOpportunities,
  recordObjectiveHit,
  stamp,
  targetEligible,
  type Assignment,
  type IOperationOutcome,
  type IOperationWorld,
  type IResult,
  type ISortie,
  type IStamp,
  type Outcome,
} from "./sortie.js";
import {
  offerBriefing,
  retaskOnUnavailable,
  validateSelection,
  type BriefingOption,
  type IBriefingWorld,
} from "./briefing.js";
import {
  approach,
  APPROACH_SPEED,
  CRUISE_SPEED,
  finalReady,
  GLIDE,
  GROOVE_FLARE,
  recoveryDeck,
  reserveEstimate,
  routeLength,
  type IApproach,
  type IReserve,
} from "./recovery.js";
import {
  assignSector,
  canLaunchScout,
  pickupWindow,
  reconnaissanceCapacity as scoutReconnaissance,
  stepScout,
  PICKUP_MAX_SHIP_SPEED,
  SCOUT_FULL_FUEL,
  SCOUT_RESERVE,
  type ScoutAircraft,
  type ScoutLimits,
  type SearchSector,
} from "./scouting.js";
import { SPEAKERS, SPEECH, SPEECH_DIRECTIONS, radioShipName, type ISpeechRequest } from "./radio-script.js";
import {
  applyLaunch,
  applyRecovery,
  canLaunch,
  canRecover,
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
  isStale,
  makeContact,
  mergeContact,
  STALE_SECONDS,
  type Classification,
  type Contact,
  type Team,
} from "./intel.js";
import { shipClass } from "./catalog.js";
import {
  baseAviationLost,
  damageFacility,
  japaneseFollowUp,
  observedCapability,
  radarWarning,
  radioDelivery,
  repairPlan,
  spreadFire,
  stepFacility,
  type Facility,
  type FacilityKind,
  type FacilityRates,
  type FollowUp,
  type ObservedSnapshot,
} from "./facilities.js";
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
import {
  avoidanceHeading,
  chooseTask,
  clearOfHazard,
  courseAuthority,
  rejoinCourse,
  rescueWindow,
  stationTarget,
  type FormationStation,
  steerToStation,
  type ICourseShip,
  type IHazard,
  type ISteerLimits,
} from "./naval.js";
import {
  coverageLost,
  groupCourse,
  reformAfter,
  type Group,
} from "./formation.js";
import {
  applyFire,
  batteryDrain,
  canFire,
  chargeDamage,
  interceptCourse,
  maxSpeed,
  stepCharge,
  stepDepth,
  strafeDamage,
  SURFACED_MAX,
  subY,
  type DepthCharge,
  type SubMode,
  type SubState,
} from "./submarine.js";
import {
  ASW_SALVO,
  stepHunt,
  type AswContact,
  type AswLimits,
  type AswState,
  type AttackSolution,
} from "./asw.js";

type Any = any;

/** Shared gameplay threshold: a carrier with a flight deck below this cannot launch aircraft. */
export const LAUNCH_DECK = 0.35;
/** Separate policy: a deck this damaged can still *recover* aircraft. Never a launch rule. */
export const RECOVERY_DECK = 0.25;
/** A deck below this has failed outright; the player's own carrier can neither launch nor land. */
export const DECK_FAILED = 0.2;
/** Impact records kept per ship for persistent damage visuals. */
export const MAX_IMPACTS = 8;

/** The supplied Midway atoll is an 8 km disc; the fringing reef is its rim, so one circle holds both. */
const ATOLL_HAZARD_RADIUS = 4000;
/** A guide samples this far ahead for the atoll when it plans the group's course. */
const GROUP_LOOKAHEAD = 6000;
/** Clearance kept from the reef, and the angular step used to search for a clear course. */
const GROUP_MARGIN = 400;
const GROUP_STEP = 0.1;
/** Rudder rates, radians per second: carriers turn slower than escorts, as evasion already assumes. */
const CARRIER_TURN = 0.02;
const ESCORT_TURN = 0.045;
/** Full speed is made once this far off station; the residual station-keeping lag is bounded by it. */
const STATION_SLOW_RADIUS = 350;
/** Separation lookahead and minimum passing distance for surface ships. */
const SURFACE_LOOKAHEAD = 30;
const MIN_SEPARATION = 900;
/** A ship arcs back onto its station for this long after an evasion rather than resuming instantly. */
const REJOIN_SECONDS = 8;
/** A support group's own route: arrival at its destination and its hold anchor, in metres. */
const SUPPORT_APPROACH_RADIUS = 1200;
const SUPPORT_HOLD_RADIUS = 600;
/** A support guide whose engine falls below this retires along its withdrawal bearing. */
const SUPPORT_WITHDRAW_ENGINE = 0.75;

/** Escort rescue and alongside thresholds. Any qualifying escort, never a named hull. */
const RESCUE_RANGE = 6000;
const RESCUE_MIN_COUNT = 5;
const RESCUE_ABANDON_SECONDS = 300;
/** Furthest an escort will leave the screen to work alongside a damaged carrier. */
const ASSIST_RANGE = 5000;
/** Closing range at which an escort counts as alongside and its pumps take effect. */
const ASSIST_DISTANCE = 220;
/** A running torpedo this close to the carrier is a detected threat that aborts the alongside. */
const ASSIST_THREAT_RANGE = 2500;
/** Crew a hull of each class puts in the water, before the seeded draw varies it. */
const SURVIVOR_CREW: Record<string, number> = { carrier: 420, cruiser: 200, destroyer: 140, sub: 40 };

/** Midway's five facilities, one of each kind, as offsets in metres from the atoll centre. */
const FACILITY_LAYOUT: Array<{ id: string; kind: FacilityKind; dx: number; dz: number; radius: number }> = [
  { id: "midway-runway", kind: "airstrip", dx: 0, dz: 0, radius: 900 },
  { id: "midway-stores", kind: "stores", dx: -1250, dz: 450, radius: 500 },
  { id: "midway-radar", kind: "radar", dx: 1550, dz: -650, radius: 400 },
  { id: "midway-radio", kind: "radio", dx: 950, dz: 1000, radius: 350 },
  { id: "midway-seaplane", kind: "seaplane", dx: -2050, dz: -950, radius: 650 },
];
/** Per-second health lost while alight and regained by a crewed repair. */
const FACILITY_BURN_RATE = 0.05;
const FACILITY_REPAIR_RATE = 0.02;
/** One facility's worth of repair work is earned per this many seconds, banked up to the cap. */
const FACILITY_WORK_PER_SECOND = 1 / 15;
const FACILITY_WORK_CAP = 3;
/** A facility with no crew on it this tick still burns: the constant step rates, reused, never built. */
const NO_REPAIR_RATES: FacilityRates = { repair: 0, burn: FACILITY_BURN_RATE };
/** Reported capability at or above this still justifies a repeat island strike. */
const FOLLOW_UP_THRESHOLD = 0.5;

/** Any surface escort, by class, never by name: destroyers and cruisers stand the screen. */
function isEscort(s: Any): boolean {
  return s.kind === "destroyer" || s.kind === "cruiser";
}

/**
 * A detached support group's own route. Plain state read by the guide's helm: approach the
 * destination, hold at the anchor, and retire along the bearing once damaged. No carrier steers
 * this group and nothing branches on a ship's name to decide any of it.
 */
interface ISupportRoute {
  /** The approach waypoint made for while the group is fit. */
  destination: { x: number; z: number };
  /** The loiter anchor used once the destination is reached. */
  hold: { x: number; z: number };
  /** The course retired along once the group is damaged, radians like `Group.course`. */
  withdrawBearing: number;
}

/** A surface group: `formation.Group` plus the coverage its absent escorts have removed. */
interface ISurfaceGroup extends Group {
  coverageLost: number;
  /** Set when an evasion ended and `reformAfter` still has to restore the held stations. */
  reform: boolean;
  /** Present on a detached support group; a carrier screen has none. */
  route?: ISupportRoute;
}

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
  /** m; class draught, positive down. A torpedo running deeper than this passes under the hull. */
  draught: number;
}

/** Class references and measured GLB extents; the repaired model is `hullBeam` wide when drawn. */
const hullOf = (classId: string): IHull => {
  const cls = shipClass(classId);
  return { hullLength: cls.measuredLength, hullBeam: cls.hullBeam, draught: cls.draught };
};

/**
 * Hulls by ship name. Enterprise, Hornet and Akagi are the models supplied with the project and
 * have no catalog class, so they keep the extents the renderer used to write in. Northampton,
 * Phelps and Balch have neither a class nor a model and keep the per-kind defaults below; giving
 * them a sister ship's numbers would be the substitution this change exists to remove.
 */
const HULLS: Readonly<Record<string, IHull>> = Object.freeze({
  "USS Enterprise": { hullLength: 251.58, hullBeam: 32.4, draught: 7.9 }, // Yorktown class, as drawn by hornet.glb
  "USS Hornet": { hullLength: 251.58, hullBeam: 32.4, draught: 7.9 },
  // CV-5 is drawn from the supplied `hornet.glb` sister hull, not from the catalog's
  // `carrier.yorktown.glb`, so her collision hull is the sisters' literal rather than
  // `hullOf("yorktown")`. The catalog class is still a correct measurement of that import
  // (246.74 m); it just describes a model this ship is no longer drawn from, and leaving the
  // 4.6 m gap between the drawn hull and the collision hull would be a gap a bomb can land in.
  // See the CV-5 note in src/render/imported-ships.ts for why the import was retired.
  "USS Yorktown": { hullLength: 251.58, hullBeam: 32.4, draught: 7.9 },
  Akagi: { hullLength: 260.67, hullBeam: 31.3, draught: 7.55 }, // supplied akagi.glb keel depth, src/render/world.ts
  Kaga: hullOf("kaga"),
  Soryu: hullOf("soryu"),
  Hiryu: hullOf("hiryu"),
  Tone: hullOf("tone"),
  Chikuma: hullOf("tone"),
  Mogami: hullOf("mogami"),
  Mikuma: hullOf("mogami"),
  Arashi: hullOf("kagero"),
  Nowaki: hullOf("kagero"),
  "USS Hammann": hullOf("hammann"),
  "I-168": hullOf("i168"),
  "USS Nautilus": hullOf("nautilus"),
});

/** The hull class that carries cruiser scouts. Matched on measured extents, never on a ship name. */
const SCOUT_HULL = hullOf("tone");

/** Cruiser-scout sortie tuning, passed whole to `scouting.ts`. */
const SCOUT_LIMITS: ScoutLimits = {
  burn: 4,
  outboundFuel: 2400,
  searchFuel: 1800,
  reserve: SCOUT_RESERVE,
  pickupFuel: 300,
};
/** Metres a cruiser sends its scout out along a sector bearing. */
const SCOUT_SECTOR_DEPTH = 16000;
/** A sector may be re-flown once its last search is this old, in seconds. */
const SCOUT_STALE_SECONDS = 900;
/** The search altitude a scout observer is credited with, in metres. */
const SCOUT_ALTITUDE = 2000;
/** Metres a scout observer's own search reaches, before the visibility scale. */
const SCOUT_SEARCH_RANGE = 9000;
/** No scout leaves before the battle has settled, so the opening contacts stay the lookouts' own. */
const SCOUT_LAUNCH_DELAY = 12;
/** The states in which a scout is flying and therefore an observer. */
const SCOUT_AIRBORNE_STATES: ReadonlySet<string> = new Set(["catapult", "outbound", "searching", "returning"]);

interface IDeck {
  deckLength: number;
  deckWidth: number;
  deckHeight: number;
  deckBeam: number;
  /** Metres the usable corridor is shifted to starboard of the ship's origin; 0 when the deck is clear on centreline. */
  deckOffset: number;
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
 *   deck each side of the centreline — half a Devastator's span, so a narrower station ends the
 *   corridor rather than narrowing it — made symmetric about the ship's origin because `onDeck`
 *   measures the corridor from there, then as wide as the narrowest station it crosses. tools/
 *   capture-deck.mjs re-measures the same edges in the running game and holds the two surveys to
 *   AC-2's own 0.1 m, which is the resolution either of them can claim. It is a
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
  "USS Enterprise": { deckLength: 220, deckWidth: 20, deckHeight: 20.06, deckBeam: 32.4, deckOffset: 0 },
  "USS Hornet": { deckLength: 220, deckWidth: 20, deckHeight: 20.06, deckBeam: 32.4, deckOffset: 0 },
  // Akagi's original stern deck slopes down ~1.4 m; the datum is its central deck.
  Akagi: { deckLength: 220, deckWidth: 20, deckHeight: 20.06, deckBeam: 31.3, deckOffset: 0 },
  // CV-5 is drawn from the same `hornet.glb` sister hull as CV-6 and CV-8 — see the note in
  // src/render/imported-ships.ts — so she carries their deck, not the imported Tripo Yorktown's.
  "USS Yorktown": { deckLength: 220, deckWidth: 20, deckHeight: 20.06, deckBeam: 32.4, deckOffset: 0 },
  // Measured: deck 22.91..23.61, midpoint 23.26, less 7.5 m draught. Kaga's Tripo island is a
  // 20 m wide, 48 m long, 23 m tall block whose inboard face touches the centreline — above
  // deck+6 m it spans X -20.44..-0.43, Y -39.9..+7.8 — so the clear deck is not centred: amidships
  // it is clear only ~4 m to port against ~22 m to starboard, and two stations abaft that the port
  // clearance is 0. The usable rectangle is X -4..+22, ~26 m wide and centred ~+9 m to starboard,
  // so the 18 m corridor is shifted there rather than widened. (The real ship's island was about
  // 5 m wide at the deck edge; this reconstruction is wrong but it is what is shipped.)
  Kaga: { deckLength: 230, deckWidth: 18, deckHeight: 15.76, deckBeam: 52, deckOffset: 9 },
  // Measured: deck 20.30..20.68, midpoint 20.49, less 7.6 m draught.
  Soryu: { deckLength: 220, deckWidth: 14, deckHeight: 12.89, deckBeam: 34, deckOffset: 0 },
  // Measured: deck 19.91..21.54, midpoint 20.72, less 7.8 m draught. The 1.64 m of sheer over the
  // corridor is the largest of the four, and the reason AC-2's flat 0.1 m bound cannot hold here.
  Hiryu: { deckLength: 220, deckWidth: 14, deckHeight: 12.92, deckBeam: 40, deckOffset: 0 },
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
  const hull = HULLS[name] ?? { hullLength: sub ? 92 : 112, hullBeam: sub ? 9 : 13, draught: sub ? 4.6 : 4.5 };
  // No flight deck, so nothing overhangs: the damage volume is one box of the hull's own beam.
  if (kind !== "carrier")
    return { ...hull, deckLength: 0, deckWidth: 0, deckHeight: SUPERSTRUCTURE_TOP, deckBeam: hull.hullBeam, deckOffset: 0 };
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
 * Dawn over the Pacific, 1942: clear but hazy. `intel.canObserve` now scales the range limit by this
 * (`range > rangeLimit * visibility`), so every `rangeLimit` below is the observer's own unreduced
 * limit. Shortening it here as well, which is what this file did while the module treated visibility
 * as an on/off gate, applied the haze twice and let a lookout see visibility-squared as far.
 */
const VISIBILITY = 0.85;

/** Metres of water an observer can see a hull through. A boat deeper than this is unobserved. */
const SIGHT_DEPTH = 20;

/**
 * A submarine's own numbers: the finite magazine and the rates its depth and bow change at.
 * `submarine.ts` owns the rules; these are the game's tuning. Tubes and reloads are spent, never
 * reset, so a boat that has fired them all is out of the fight.
 */
const SUB_TUBES = 4;
const SUB_RELOADS = 2;
const SUB_RELOAD_SECONDS = 45;
const SUB_DIVE_RATE = 2;
const SUB_TURN_RATE = 0.05;
const SUB_TORPEDO_RANGE = 4800;
const SUB_FIRE_INTERVAL = 25;
/**
 * How close a hostile aircraft must be before a boat puts itself under. 1,000 m is about half a
 * nautical mile — near enough to be overhead, which is what a crash dive answers. A CAP orbiting
 * the task force a mile and a half away is a sighting to evade, not yet an attack: the gate's
 * "hostile aircraft overhead" is 200 m, and the observed-carrier attack keeps its CAP at ~1,700 m.
 * Reasoned from `SUB_DIVE_RATE` and the two gate cases, not a cited figure.
 */
const SUB_AIR_THREAT_RANGE = 1000;

/**
 * Escort anti-submarine tuning. A hunt runs on the ops cadence: a held contact is studied, an attack
 * track is flown, a finite salvo goes into the water, and the escort reassesses or rejoins.
 * `submarine.ts`'s own fuse and falloff decide every hit; these are only the phase timings.
 */
const ASW_LIMITS: AswLimits = Object.freeze({
  investigateSeconds: 12,
  attackSeconds: 6,
  holdSeconds: 30,
  searchSeconds: 120,
  spreadRate: 8,
  assumedSpeed: 6,
});
/** Three salvoes per U.S. escort: the finite magazine that eventually sends the hunt home. */
const ASW_CHARGES = ASW_SALVO * 3;
/** How fast a depth charge sinks to its fuse setting, metres per second. */
const ASW_SINK_RATE = 5;
/** A charge's lethal radius, metres: the 3D falloff inside it is `submarine.chargeDamage`. */
const ASW_LETHAL_RADIUS = 40;
/** Hull damage a co-located charge does, before the falloff scales it. */
const ASW_CHARGE_DAMAGE = 90;
/**
 * A destroyer's own sonar holds a shallow boat inside this range. ASDIC on a 1942 destroyer had an
 * effective echo range of roughly 1,000-2,500 yards (900-2,300 m) against a submarine; 2,000 m sits
 * inside that band. Unlike a lookout's report this is the escort's own sensor, so no transmission
 * delay applies — but it still pays out only a range and a bearing, and the believed depth stays 0.
 */
const ASW_SONAR_RANGE = 2000;

/** Seconds between an aircrew's sighting and the fleet holding the report, and a ship's by lamp/TBS. */
const AIR_REPORT_DELAY = 30;
const SHIP_REPORT_DELAY = 8;

/**
 * The player's rear-gun station aims in the aircraft's own frame — yaw measured from dead astern,
 * pitch up. Its envelope is the AI gunner's one tail cone (`REAR_GUN_DOT`, 127° from the nose) and
 * depression (`REAR_GUN_ELEVATION`), not an arbitrary box: yaw alone reaches the cone edge at level
 * pitch, and closes toward zero as the gun is raised because the cone is circular in the frame.
 * One clamp serves the keys, the pointer and the camera.
 */
const REAR_GUN_FULL_YAW = Math.acos(-REAR_GUN_DOT);
const REAR_GUN_PITCH_MIN = Math.asin(REAR_GUN_ELEVATION);
const REAR_GUN_PITCH_MAX = Math.acos(-REAR_GUN_DOT);
const REAR_GUN_YAW_RATE = 1.5;
const REAR_GUN_PITCH_RATE = 1.0;

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
  // A Kate carrying bombs for a shore target, flown level, is the same airframe as the torpedo
  // Kate but a different store: the role, not the airframe, picks the family.
  level: { jp: "kate" },
  recon: { us: "sbd", jp: "val" },
});

/**
 * The ordnance family an airframe re-arms with. `carrier-ops.ts` keeps the same table privately for
 * `stepService`, and does not export it, so the launch side has to name it again; the two must agree.
 * A Kate flies either a torpedo or a bomb depending on the role the deck armed it for.
 */
function storeFamilyOf(airframe: string, role?: string): string {
  if (role === "level") return "bomb";
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
  /** The observer's kind when it was an aircraft, so a delivered track can name its source role. */
  observerKind?: string;
  reported: boolean;
  /**
   * Deck condition *as this observation saw it*: true when the observer looked at an enemy carrier
   * whose deck was already unable to launch. Set only by `recordContact`, so a hit nobody observed
   * never becomes a map claim, and a later observation of a repaired deck clears it.
   */
  deckOut?: boolean;
  /**
   * True once an observation looked at this hull already under the sea. A confirmed sinking is
   * terminal: it is a wreck the crew can still see, so unlike `deckOut` it is never cleared by a
   * later report and it counts on the map even after the positional track has gone stale. Set only
   * by `recordContact`, never read from an unobserved ship's own state.
   */
  sunk?: boolean;
}

/**
 * The tactical map's appraisal of the battle, from friendly records and the crew's own observations.
 * It never reads a hidden hull's health, so damage nobody reported cannot move the label. Only
 * *confirmed* enemy carrier attrition is compared against friendly decks out of action; a reported
 * but intact contact establishes no enemy strength, so it can never on its own create an allied lead.
 */
export interface IBattleStatus {
  /** Friendly carriers still afloat, and how many of those can still launch (deck condition). */
  friendlyAfloat: number;
  friendlyOperational: number;
  friendlySunk: number;
  /** Enemy carriers the crew currently holds a contact on. */
  enemyReported: number;
  /**
   * Of those, the carriers an observation has confirmed out of action — sunk, or seen unable to
   * launch. A confirmed sinking is terminal and still counts after its track ages.
   */
  enemyDecksOut: number;
  /** Friendly aircraft lost (fleet decks plus the player's own), and the player's confirmed kills. */
  airLosses: number;
  airKills: number;
  appraisal: "ALLIES LEADING" | "ENEMY LEADING" | "CONTESTED" | "INSUFFICIENT INTELLIGENCE";
  line: string;
  /** Plain statement of what the appraisal is and is not based on. */
  basis: string;
}

export { LOADOUTS };
export type { ILoadout };

export class Battle {
  random: () => number;
  /** A second seeded stream for scout draws, so cruiser sorties never perturb the battle's own. */
  scoutRandom: () => number;
  seed: number;
  serial = 0;
  time = 0;
  status = "briefing";
  ships: Any[] = [];
  /** Surface groups and their stations, built once when the fleet is created. */
  surfaceGroups: ISurfaceGroup[] = [];
  aircraft: Any[] = [];
  bullets: Any[] = [];
  bombs: Any[] = [];
  torpedoes: Any[] = [];
  airTorpedoes: Any[] = [];
  /** Boatloads in the water from sunk hulls; a recovered group leaves once emptied. */
  survivors: Survivors[] = [];
  /** Aircraft that went into the sea, as fading minimap pings. `stepWrecks` drops the old ones. */
  wrecks: WreckMarker[] = [];
  /** The atoll's individually hittable facilities: one of each kind, built by `setupFleet`. */
  facilities: Facility[] = [];
  /** Banked repair work, in facility-slots, capped at `FACILITY_WORK_CAP`. */
  facilityWork = 0;
  /** What the Japanese last *reported* about Midway, by facility id. Never the live health. */
  observedFacilities: ObservedSnapshot = {};
  /** Facility reports still in transit: each applies to `observedFacilities` at `at`. */
  facilityReports: Array<{ at: number; snapshot: ObservedSnapshot }> = [];
  /**
   * A delivered report the staff have not yet answered. A follow-up is a decision taken *on* a
   * report, so exactly one strike can be ordered per report that arrives — a standing intention
   * instead would hold every Japanese deck on the island for the whole battle and the carriers
   * would never be answered, which is the opposite of the dilemma this models.
   */
  followUpPending = false;
  /** Whether the Japanese staff still think Midway is worth striking again, and why. */
  get followUp(): FollowUp {
    return japaneseFollowUp(observedCapability(this.facilities, this.observedFacilities), FOLLOW_UP_THRESHOLD);
  }
  /** True while a repeat strike on the atoll is the standing Japanese intention. */
  get islandStrike(): boolean {
    return this.facilities.length > 0 && this.followUp.worthwhile;
  }
  effects: Any[] = [];
  /** Reused per step so the hot path never allocates a fresh list: surface hulls, the per-ship
   *  separation list and the repair slots. Cleared before each use, never read across a step. */
  private surfaceScratch: Any[] = [];
  private avoidScratch: Any[] = [];
  private planesScratch: Any[] = [];
  private chosenScratch = new Set<string>();
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
    playerLosses: 0,
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
  /** The last sortie frozen before a replacement aircraft opened a new one; the debrief's record. */
  lastResult: IResult | null = null;

  constructor(seed = 19420604) {
    this.random = rng(seed);
    this.scoutRandom = rng(seed + 0x9e3779b9);
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
      rearAmmo: rearRoundsFor("sbd"),
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
      // The rear-gun station. `gunner` is the player's seat; the two aim fields are its bounded
      // angles in the airframe's frame, and `gunnerPrevAutopilot` remembers whether the pilot was
      // on course hold before manning the gun, so leaving restores exactly that.
      gunner: false,
      gunnerYaw: 0,
      gunnerPitch: 0,
      gunnerPrevAutopilot: false,
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
    initRearState(this.player);
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

  /**
   * The plain battle records the briefing, the one validator and the Open Pacific end conditions
   * read. Contacts are the crew's own beliefs, never a hull's live position, and nothing here
   * reaches into a ship for identity that was not first delivered to the fleet.
   */
  briefingWorld(): IBriefingWorld {
    return {
      ships: this.ships,
      aircraft: this.aircraft,
      contacts: [...this.contacts.values()],
      survivors: this.survivors,
      facilities: this.facilities,
    };
  }

  /** The same world, named for the Open Pacific end conditions that also read the fleet's beliefs. */
  operationWorld(): IOperationWorld {
    return this.briefingWorld();
  }

  /**
   * The assignment categories the world can actually offer, through the one briefing contract, so
   * surface strike and fleet support reach the player with their real feasibility and their reasons
   * rather than a hard-coded list.
   */
  briefingOptions(): BriefingOption[] {
    return offerBriefing(this.briefingWorld(), this.time);
  }

  /** The one `{kind,id}` option for a designation, read off the hull record, never stored twice. */
  private designationOption(id: string, assignment: Assignment): BriefingOption | null {
    const ship = this.byId(id);
    if (!ship) return null;
    return {
      kind: assignment,
      targetKind: ship.kind as BriefingOption["targetKind"],
      targetId: id,
      label: ship.name,
      detail: "",
      feasible: true,
      reason: "",
    };
  }

  /** Any enemy hull this assignment could still be pointed at; a submerged boat may surface again. */
  private eligibleHullRemains(assignment: Assignment): boolean {
    return this.ships.some((x: Any) => targetEligible(assignment, { ...x, surfaced: true }));
  }

  /**
   * Known eligible contacts; recon and Open Pacific retain carrier navigation targets. Only a hull
   * this crew has actually identified is offered — a classified but unnamed report establishes no
   * target — and the one validator then answers whether the sighting is still current.
   */
  targetContacts(): IReport[] {
    const assignment: Assignment = this.sortie.assignment === "surface" ? "surface" : "strike";
    const world = this.briefingWorld();
    const out: IReport[] = [];
    for (const contact of this.contacts.values()) {
      // A lost track is still a transmitted belief: usable, but ranked and drawn as uncertain.
      const ship = this.byId(contact.id);
      if (!ship || contact.kind !== ship.kind) continue;
      const option = this.designationOption(contact.id, assignment);
      if (option && validateSelection(option, world, this.time).ok) out.push(contact);
    }
    return out;
  }

  designateTarget(id: string, navigate = true): boolean {
    if (!this.targetContacts().some((c) => c.id === id)) return false;
    const assignment: Assignment = this.sortie.assignment === "surface" ? "surface" : "strike";
    const option = this.designationOption(id, assignment);
    if (!option || !validateSelection(option, this.briefingWorld(), this.time).ok) return false;
    this.target = id;
    if (navigate) this.player.nav = "search";
    this.updateSortie();
    return true;
  }

  selectLoadout(id: string): boolean {
    const p = this.player;
    if (!["briefing", "playing"].includes(this.status) || p.mode !== "deck" || (p.deckSpeed || 0) >= 0.5 || !["bomb", "torpedo"].includes(id)) {
      this.event("notice", { text: "LOADOUT LOCKED — STOP ON DECK FIRST" });
      return false;
    }
    if (p.loadout === id) return true;
    const air = this.home?.air;
    if (this.status === "playing") {
      const family = storeFamilyOf(LOADOUTS[id].airframe);
      if (!air || (air.stores[family] ?? 0) < 1) {
        this.event("notice", { text: `NO ${family === "torpedo" ? "TORPEDOES" : "BOMBS"} ABOARD — LOADOUT UNCHANGED` });
        return false;
      }
      air.stores[family] -= 1;
      const old = LOADOUTS[p.loadout];
      // ponytail: inventory counts complete mission loads; partial returned racks are expended.
      if (old && p.bombs === old.bombs && p.torpedo === old.torpedo) {
        const returned = storeFamilyOf(old.airframe);
        air.stores[returned] = (air.stores[returned] ?? 0) + 1;
      }
    }
    const carriedRear = p.rearAmmo ?? 0;
    const beforeAirframe = p.airframe;
    const ok = applyLoadout(p, id);
    if (!ok) return false;
    // A swap to a different airframe loads that aircraft's own gun battery, and on deck that load
    // comes out of the same finite ammunition store the rearm uses. With the store empty the rounds
    // already carried are capped to the new gun's capacity, so a deck swap is never a free top-up.
    if (this.status === "playing" && beforeAirframe !== p.airframe) {
      const rear = rearRoundsFor(p.airframe);
      if (rear > 0 && air && (air.stores.ammo ?? 0) >= 1) {
        air.stores.ammo -= 1;
        p.rearAmmo = rear;
      } else {
        p.rearAmmo = Math.min(carriedRear, rear);
      }
      initRearState(p);
    }
    this.playerFlight.setAirframe(p.airframe);
    return true;
  }

  /**
   * R at the rear station: begin a belt change. A full belt is a no-op, and with the sortie total
   * exhausted there is nothing to load, so a depleted gun can never be refilled for free. Returns
   * whether a belt change actually started. Ignored when the pilot, not the gunner, has the aircraft.
   */
  reloadRear(): boolean {
    const p = this.player;
    if (!p.gunner) return false;
    // A second R during a change is a no-op: it neither restarts the clock nor spends a round, and
    // it must not claim the belt is dry while reserve is still behind it.
    if (rearReloading(p, this.time)) {
      this.event("notice", { text: "FEEDING BELT — STAND BY" });
      return false;
    }
    if (startRearReload(p, this.time)) {
      this.event("notice", { text: "CHARGING — FEEDING BELT" });
      return true;
    }
    this.event("notice", {
      text: (p.rearLoaded ?? 0) >= REAR_BELT_LOADED ? "REAR BELT FULL" : "REAR GUN — NO ROUNDS IN RESERVE",
    });
    return false;
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
      const geometry = shipGeometry(name, kind);
      // A scout-carrying cruiser is found by its hull class (the Tone's measured extents), not its name.
      const scoutCruiser =
        kind === "cruiser" && geometry.hullLength === SCOUT_HULL.hullLength && geometry.hullBeam === SCOUT_HULL.hullBeam;
      const s: Any = {
        id: this.id("ship"),
        name,
        team,
        kind,
        x,
        y: 0,
        z,
        heading,
        speed: sub ? SURFACED_MAX : cv ? 8 : 10,
        baseSpeed: sub ? SURFACED_MAX : cv ? 8 : 10,
        // Geometry, resolved before any renderer exists.
        ...geometry,
        hp: cv ? 340 : sub ? 90 : 145,
        maxHp: cv ? 340 : sub ? 90 : 145,
        deck: 1,
        engine: 1,
        aa: 1,
        fire: 0,
        /** Flooding, as a fraction of the heavy-list threshold the deck gate reads. */
        list: 0,
        /** Scout-carrying cruisers only: 0..1 aviation capability and their finite floatplanes. */
        aviation: scoutCruiser ? 1 : 0,
        scouts: null as ScoutAircraft[] | null,
        sectors: null as SearchSector[] | null,
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
        /** Why the last recovery was refused, for the HUD. Null when the deck can take an aircraft. */
        recoverBlocked: null as string | null,
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
        /** The boat's own depth, battery and finite tubes. Null for every surface hull. */
        sub: sub
          ? ({
              depth: 0,
              depthRate: 0,
              mode: "surfaced",
              battery: 1,
              tubes: SUB_TUBES,
              reloads: SUB_RELOADS,
              reloadUntil: 0,
              lastLook: 0,
            } as SubState)
          : null,
        baseX: x,
        baseZ: z,
      };
      if (scoutCruiser) this.equipScoutCruiser(s);
      // A U.S. escort hunts submarines; it is the only hull that carries depth charges, so no other
      // ship gets a hunt state. Identified by class through the one `isEscort`, never by name.
      if (s.team === "us" && isEscort(s))
        s.hunt = {
          phase: "searching",
          charges: ASW_CHARGES,
          phaseTime: 0,
          salvoes: 0,
          solution: null,
          search: null,
          lastContact: null,
        } as AswState;
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
    // The Mogami-class supporting cruisers (PRD AC-15). They sail in their own detached group on the
    // approach/hold/withdraw route built in `setupSupportGroup`, west of the atoll and between the
    // two carrier forces, so a later recon or anti-shipping sortie has a real target there that is
    // neither a carrier nor behind the player. Marked here; `setupSurfaceGroups` reads the mark.
    const mogami: Any = add("Mogami", "jp", "cruiser", -9300, 0, 1.75);
    const mikuma: Any = add("Mikuma", "jp", "cruiser", -9650, -600, 1.75);
    mogami.support = true;
    mikuma.support = true;
    this.facilities = FACILITY_LAYOUT.map((f) => ({
      id: f.id,
      kind: f.kind,
      x: this.island.x + f.dx,
      z: this.island.z + f.dz,
      radius: f.radius,
      health: 1,
      burning: false,
      repairProgress: 0,
      repairBlocked: null,
    }));
    for (const f of this.facilities) this.observedFacilities[f.id] = f.health;
    this.setupSurfaceGroups();
  }

  start(airborne = false): void {
    if (this.status !== "briefing") return;
    this.status = "playing";
    this.voiceFlags = {};
    this.leaveGunnerStation();
    this.player.gunnerPrevAutopilot = false;
    // The player's own deck holds its aircraft until the player is off it: a wingman that launches
    // while Scout Two is still chocked does not have his wing. `updateCarrier` opens this gate on
    // liftoff. Every other carrier launches as before.
    for (const s of this.ships.filter((s) => s.kind === "carrier" && s.id !== this.player.home)) this.launch(s, "fighter");
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
      this.say("SCOUT THREE", "Two, we have your wing. Orders on your command.");
    } else {
      this.sortie.startTime = this.time;
      this.say("ENTERPRISE TOWER", "Scout Two, cleared for launch. Hold W. Chocks release with power. Keep straight; ease the stick back (Down) through 90 knots. Lift, not the bow, gets you flying.");
    }
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
    // The wingman is the only crew who can see the player's aircraft from outside. He reports what
    // is visible from his position — smoke, streaming fuel, flame, a dying engine — in the order a
    // section leader would want to hear it, one call at a time and never twice for the same state.
    const dmg = p.damage;
    if (dmg && p.mode === "flight" && this.time > (flags.wingDamageNext ?? 0) && this.wingmanNear()) {
      let fire = 0;
      for (const zone of DAMAGE_ZONES) fire = Math.max(fire, dmg[zone].fire);
      // Every call names something the wingman can actually see on the aircraft: the flame, the
      // smoke a damaged engine trails, the fuel streaming from a holed tank, the oil from the
      // engine. Each threshold is the one the renderer draws that effect at.
      const fuelLeak = Math.max(dmg.leftWing.leak, dmg.rightWing.leak, dmg.fuselage.leak);
      const crippled = p.engineCut === true || dmg.engine.integrity < 0.25;
      const call = !flags.r28 && fire > 0.12
        ? "R28"
        : !flags.r29 && crippled
          ? "R29"
          : !flags.r27 && fuelLeak > 0.12
            ? "R27"
            : !flags.r31 && dmg.engine.leak > 0.2
              ? "R31"
              : !flags.r26 && dmg.engine.integrity < 0.75
                ? "R26"
                : null;
      if (call) {
        flags[call.toLowerCase()] = true;
        flags.wingDamageNext = this.time + 11;
        this.voice(call, { valid: () => this.player.mode === "flight" && this.wingmanNear() });
      }
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
    // The wingman's proximity tips: states the simulation already computes, voiced only while he is
    // on the wing and only on a fresh change of state. One shared cooldown spaces them exactly the way
    // `wingDamageNext` spaces the damage calls, and each row is edge-triggered so a held state is not
    // repeated. No tip is faked: a condition the sim does not track is simply not in the list.
    if (p.mode === "flight" && this.wingmanNear()) {
      if (!flags.r32 && this.enemyOnMyTail()) {
        flags.r32 = true;
        this.voice("R32", { valid: () => this.player.mode === "flight" && this.wingmanNear() && this.enemyOnMyTail() });
      }
      if (!flags.r33 && p.pitch < -0.35 && p.vy < -18 && p.y < 260) {
        flags.r33 = true;
        this.voice("R33", { valid: () => this.player.mode === "flight" && this.wingmanNear() && this.player.pitch < -0.2 && this.player.vy < -10 && this.player.y < 400 });
      }
      if (!flags.r34 && this.targetCrowded()) {
        flags.r34 = true;
        this.voice("R34", { valid: () => this.targetCrowded() });
      }
      if (!flags.r35 && this.overAAEnvelope()) {
        flags.r35 = true;
        this.voice("R35", { valid: () => this.player.mode === "flight" && this.wingmanNear() && this.overAAEnvelope() });
      }
      if (!flags.r36 && p.fuel < 18) {
        flags.r36 = true;
        this.voice("R36", { valid: () => this.player.mode === "flight" && this.wingmanNear() && this.player.fuel < 25 });
      }
      if (!flags.r37) {
        const leak = Math.max(p.damage?.leftWing?.leak ?? 0, p.damage?.rightWing?.leak ?? 0, p.damage?.fuselage?.leak ?? 0);
        if (leak > 0.3) {
          flags.r37 = true;
          this.voice("R37", { valid: () => this.player.mode === "flight" && this.wingmanNear() && this.player.damage && Math.max(this.player.damage.leftWing.leak, this.player.damage.rightWing.leak, this.player.damage.fuselage.leak) > 0.2 });
        }
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
    // The rest of the script: the scout's sighting calls, the target run-in, the lost track, the
    // diversion and the deck announcement. Same edge/one-shot machinery as above, no new state.
    const compass = (h: number) => SPEECH_DIRECTIONS[Math.round(wrap(h) / (Math.PI / 4)) % 8];
    const hostileFighter = (range: number) =>
      this.aircraft.some((a: Any) => a.team === "jp" && a.kind === "fighter" && a.hp > 0 && a.mode === "flight" && distance3(a, p) < range);
    if (!flags.r01 && p.mode === "flight" && this.aircraft.some((a: Any) => a.team === "jp" && a.hp > 0 && a.mode === "flight" && distance3(a, p) < 4000)) {
      flags.r01 = true;
      this.voice("R01", {
        valid: () => this.aircraft.some((a: Any) => a.team === "jp" && a.hp > 0 && a.mode === "flight" && distance3(a, this.player) < 4500),
      });
    }
    const intruder = enterprise
      ? this.aircraft.find((a: Any) => a.team === "jp" && a.hp > 0 && a.mode === "flight" && distance3(a, enterprise) < 8000)
      : null;
    if (!flags.r02 && intruder) {
      flags.r02 = true;
      const id = intruder.id;
      this.voice("R02", {
        direction: compass(bearing(enterprise, intruder)),
        valid: () => this.aircraft.some((a: Any) => a.id === id && a.hp > 0 && a.mode === "flight" && distance3(a, enterprise) < 9000),
      });
    }
    if (!flags.r03 && p.mode === "flight" && this.aircraft.some((a: Any) => a.team === "jp" && a.airframe === "zero" && a.hp > 0 && a.mode === "flight" && distance3(a, p) < 3000)) {
      flags.r03 = true;
      this.voice("R03", {
        valid: () => this.aircraft.some((a: Any) => a.team === "jp" && a.airframe === "zero" && a.hp > 0 && a.mode === "flight" && distance3(a, this.player) < 3500),
      });
    }
    if (!flags.r05 && flags.r04id) {
      flags.r05 = true;
      const contacted = this.byId(flags.r04id);
      if (contacted) this.voice("R05", { direction: compass(contacted.heading), valid: () => { const q = this.byId(flags.r04id); return !!q && !q.sunk; } });
    }
    edge("r09", this.wingmanNear() && hostileFighter(3000), "R09", () => this.wingmanNear() && hostileFighter(3500));
    const designated = this.sortie.target ? this.byId(this.sortie.target) : null;
    if (!flags.r16 && designated && !designated.sunk && this.wingmanNear() && distance3(p, designated) < 4000) {
      flags.r16 = true;
      this.voice("R16", {
        identity: designated.id,
        valid: () => { const q = this.sortie.target ? this.byId(this.sortie.target) : null; return !!q && this.wingmanNear() && distance3(this.player, q) < 4500; },
      });
    }
    const r04Lost = () => {
      const q = flags.r04id ? this.byId(flags.r04id) : null;
      const spot = clamp(2900 + this.player.y * 1.8, 2900, 6200);
      return this.player.mode === "flight" && (!q || q.sunk || distance2(q, this.player) >= spot);
    };
    if (flags.r04id) edge("r20", r04Lost(), "R20", r04Lost);
    const altDeck = this.recoveryCarrier;
    const home = this.home;
    edge(
      "r23",
      !!home && !!altDeck && altDeck.id !== home.id && (home.sunk || home.deck <= RECOVERY_DECK),
      "R23",
      () => { const h = this.home; const a = this.recoveryCarrier; return !!h && !!a && a.id !== h.id && (h.sunk || h.deck <= RECOVERY_DECK); },
    );
    edge("r24", p.mode === "flight" && this.wingmanNear(), "R24", () => this.player.mode === "flight" && this.wingmanNear());
    if (!flags.p02 && (p.mode === "deck" || p.mode === "launch")) {
      flags.p02 = true;
      this.voice("P02", { valid: () => this.player.mode === "deck" || this.player.mode === "launch" });
    }
    const deckThreat = () =>
      this.aircraft.some((a: Any) => a.team === "jp" && a.hp > 0 && a.mode === "flight" && this.ships.some((s: Any) => s.team === "us" && s.kind === "carrier" && !s.sunk && distance3(a, s) < 2500));
    edge("p03", deckThreat(), "P03", deckThreat);
    const torpedoInbound = () =>
      this.torpedoes.some((t: Any) => {
        if (t.team !== "jp") return false;
        const f = forward(t.heading);
        return this.ships.some((s: Any) => {
          if (s.team !== "us" || s.sunk) return false;
          const dx = s.x - t.x;
          const dz = s.z - t.z;
          const d = Math.hypot(dx, dz);
          return d < 6000 && (dx * f.x + dz * f.z) / (d || 1) > 0.8;
        });
      });
    edge("p05", torpedoInbound(), "P05", torpedoInbound);
  }

  /**
   * A squadron aircraft close enough to see the player's and still flying. Without one, nobody is
   * on that wing to make the call, and the radio stays quiet rather than voicing an empty sky.
   */
  wingmanNear(range = 3200): boolean {
    const p = this.player;
    return this.aircraft.some(
      (a: Any) => a.wing === true && a.team === "us" && a.hp > 0 && a.mode === "flight" && a.tactic !== "ditching" && distance3(a, p) < range,
    );
  }

  /**
   * A live enemy fighter astern of the player inside gun range, with the player still not turning
   * into him. `airTarget === player.id` is the AI's own commitment, so this reads a decision the
   * tactical layer already made rather than re-deriving who is chasing whom.
   */
  enemyOnMyTail(): boolean {
    const p = this.player;
    const f = forward(p.heading, p.pitch);
    return this.aircraft.some((a: Any) => {
      if (a.team !== "jp" || a.kind !== "fighter" || a.hp <= 0 || a.mode !== "flight" || a.airTarget !== p.id) return false;
      const d = distance3(a, p);
      if (d > 1400 || d < 25) return false;
      const behind = ((a.x - p.x) * f.x + (a.y - p.y) * f.y + (a.z - p.z) * f.z) / (d || 1) < -0.5;
      // Turned into: the player's nose is within 45° of the bandit, so the call is stale.
      const into = Math.abs(angleDelta(bearing(p, a), p.heading)) < Math.PI / 4;
      return behind && !into;
    });
  }

  /** A wing or nearby friendly already committed to the sortie's designated target. */
  targetCrowded(): boolean {
    const id = this.sortie.target;
    if (!id) return false;
    const q = this.byId(id);
    if (!q || q.sunk) return false;
    return this.aircraft.some(
      (a: Any) => a.wing === true && a.team === "us" && a.hp > 0 && a.mode === "flight" && a.target === id && (a.tactic === "dive" || a.tactic === "torpedo-run" || a.tactic === "egress"),
    );
  }

  /** A live enemy hull whose heavy AA can already reach the player's height and position. */
  overAAEnvelope(): boolean {
    const p = this.player;
    if (p.y < 100) return false;
    return this.ships.some((s: Any) => {
      if (s.team !== "jp" || s.sunk || s.kind === "sub" || s.aa < 0.08) return false;
      return distance3({ ...s, y: 16 }, p) < 4350;
    });
  }

  fx(type: string, p: Any, size = 1, underwater = false): void {
    this.effects.push({
      id: this.id("fx"),
      type,
      x: p.x,
      y: p.y ?? 0,
      z: p.z,
      size,
      underwater,
      waterKind: p.waterKind,
      waterDepth: p.waterDepth,
      waterDirection: p.waterDirection,
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

  /** Every enemy hull still afloat, of any class. The mission is won only when none is left. */
  get operationalEnemyShips(): Any[] {
    return this.ships.filter((s) => s.team === "jp" && !s.sunk);
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
            ? "attacking the designated target"
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
      strike: "Attack the designated ship. Break by sections.",
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
    const store = storeFamilyOf(airframe, role);
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
    // A level role is the bomber kind flown by the level-bomber airframe.
    const kind = role === "level" ? "bomber" : role;
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
    // The rear mount's own capacity from the gun table; zero for a single-seater. A rear gun on an
    // airframe with no battery entry yet (the Val) keeps the old 240 rather than losing it silently.
    a.rearAmmo = kind === "fighter" ? 0 : rearRoundsFor(airframe) || 240;
    a.rearTimer = 0;
    initRearState(a);
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
   * Take one aircraft back aboard, or refuse because the deck is not free. `carrier-ops.canRecover`
   * is the single gate, exactly as `canLaunch` is on the launch side, so the occupancy, mode and
   * suspension test lives in one place and every refusal carries the same readable reason the launch
   * side records. `navigateHome` holds the aircraft in the pattern until it passes. A recovered
   * aircraft is counted again immediately but is *not* ready and carries no store: it waits for the
   * crew.
   */
  recoverAircraft(s: Any, a: Any): boolean {
    if (!s?.air || !s.deckState) return true;
    this.refreshDeck(s);
    const check = canRecover(s.air, s.deckState, a.airframe, this.time);
    if (!check.ok) {
      s.recoverBlocked = check.reason;
      return false;
    }
    s.recoverBlocked = null;
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
    if (rounds > 0) this.event("explosion", { distance: distance3(this.player, s), at: { x: s.x, y: s.deckHeight ?? 15, z: s.z }, outcome: "secondary" });
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
        if (!airframe) {
          ready[role] = 0;
          continue;
        }
        const store = storeFamilyOf(airframe, role);
        ready[role] = (s.air.stores[store] ?? 0) > 0 ? (s.air.ready[airframe] ?? 0) : 0;
      }
      s.mission = chooseCarrierMission(this, s, ready, COMMIT_SECONDS);
      // The Nagumo decision: with no ship contact to answer, a Japanese deck arms for the island
      // again — but only while the *reported* capability still says the base is working. A shore
      // target is a level-bombing job, so the deck arms Kates with bombs rather than Vals.
      if (s.team === "jp" && !s.mission.target && this.followUpPending && this.islandStrike) {
        this.followUpPending = false;
        s.mission = {
          ...s.mission,
          kind: "island-strike",
          want: { ...s.mission.want, level: Math.min(ready.level, 3), fighter: Math.min(ready.fighter, (s.mission.want.fighter ?? 0) + 2) },
        };
      }
    }
    const want: Record<string, number> = s.mission?.want ?? {};
    let role: string | null = null;
    let shortest = 0;
    for (const key in want) {
      let flying = 0;
      for (const a of this.aircraft) {
        if (a.hp <= 0 || a.home !== s.id) continue;
        // The level role shares the Kate airframe with the torpedo role, so it counts the same hull
        // flying in its bomber configuration rather than an "level" kind no aircraft ever has.
        if (key === "level" ? a.airframe === "kate" && a.kind === "bomber" : a.kind === key) flying += 1;
      }
      const deficit = want[key] - flying;
      if (deficit > shortest) {
        shortest = deficit;
        role = key;
      }
    }
    // Nothing wanted is not a blocked deck: the reason the HUD reads must not outlive its attempt.
    // The player's own deck holds every launch while the player is still chocked on it — a wingman
    // rolling while the player stands on deck has no one to join. A spectator or airborne player
    // is not on the deck, so the deck operates normally. Recovery and service are unaffected.
    const onPlayerDeck = this.player.mode === "deck" || this.player.mode === "service";
    const held = s.id === this.player.home && onPlayerDeck;
    if (role && !held) this.launch(s, role);
    else s.launchBlocked = null;
  }

  /** One finite scout and its search sectors, built for a hull that carries them. */
  equipScoutCruiser(s: Any): void {
    s.scouts = [
      {
        id: `${s.id}-scout`,
        homeShipId: s.id,
        state: "aboard",
        sectorId: null,
        fuel: SCOUT_FULL_FUEL,
        launchedAt: null,
        recoveredAt: null,
      },
    ];
    s.sectors = [-0.6, 0.4].map((offset, i) => {
      const from = s.heading + offset;
      return {
        id: `${s.id}-sector-${i}`,
        origin: { x: s.x, z: s.z },
        fromBearing: from,
        toBearing: from + Math.PI / 2,
        depth: SCOUT_SECTOR_DEPTH,
        lastSearchedAt: null,
      };
    });
  }

  /** The `scouting.ts` view of a hull: its capability, with anything under half damaged grounding it. */
  scoutView(s: Any): { id: string; sunk: boolean; speed: number; aviation: number; aviationDamage: boolean } {
    const aviation = clamp(s.aviation ?? 0, 0, 1);
    return { id: s.id, sunk: !!s.sunk, speed: s.speed ?? 0, aviation, aviationDamage: aviation < 0.5 };
  }

  /**
   * The group's remaining search endurance, summed by `scouting.ts`. A lost scout or a damaged
   * aviation fitting lowers it; no delivered report is stored here, so none can be erased by it.
   */
  reconnaissanceCapacity(team = "jp"): number {
    let total = 0;
    for (const s of this.ships) if (s.scouts && s.team === team) total += scoutReconnaissance(s.scouts);
    return total;
  }

  /** Where an airborne scout's report comes from: its assigned sector, advanced along the centre bearing. */
  scoutPosition(scout: ScoutAircraft, s: Any): { x: number; z: number } {
    const sector = (s.sectors as SearchSector[] | null)?.find((x) => x.id === scout.sectorId);
    if (!sector) return { x: s.x, z: s.z };
    const mid = (sector.fromBearing + sector.toBearing) / 2;
    const reach = sector.depth * (scout.state === "searching" ? 0.75 : 0.4);
    return { x: sector.origin.x + Math.sin(mid) * reach, z: sector.origin.z - Math.cos(mid) * reach };
  }

  /**
   * One fixed step of the cruiser-scout sortie: burn fuel, launch a rested scout at the stalest
   * sector, and take one back alongside when the ship is slow enough. The scout files no contact
   * here — `observersFor` hands it to the ordinary observation sweep, so its sighting is a normal
   * delivered report and nothing else can reach into the other side's knowledge.
   */
  updateScouts(dt: number): void {
    for (const s of this.ships) {
      if (!s.scouts || s.team !== "jp" || s.sunk) continue;
      for (const scout of s.scouts as ScoutAircraft[]) {
        const wasLost = scout.state === "lost";
        Object.assign(scout, stepScout(scout, dt, SCOUT_LIMITS, this.scoutRandom()));
        // A scout that runs dry has transmitted its last report; the tracks it filed become lost
        // beliefs the fleet dead-reckons, never reports it can recall.
        if (!wasLost && scout.state === "lost") this.loseObserver(`air-scout-${scout.id}`);
        if (scout.state === "alongside") {
          // `stepScout` reaches the water at the pickup fuel; `pickupWindow` answers whether the
          // ship is slow enough, keying on the return leg that state has just left.
          if (pickupWindow({ ...scout, state: "returning" }, this.scoutView(s)).ok) {
            scout.state = "aboard";
            scout.recoveredAt = this.time;
            scout.fuel = SCOUT_FULL_FUEL;
            scout.sectorId = null;
          }
          continue;
        }
        if (scout.state !== "aboard" || this.time < SCOUT_LAUNCH_DELAY) continue;
        // No reconnaissance left in the group is no sortie worth launching.
        if (this.reconnaissanceCapacity("jp") <= 0) continue;
        const sector = assignSector(s.sectors as SearchSector[], this.time, SCOUT_STALE_SECONDS);
        if (!sector) continue;
        if (!canLaunchScout(this.scoutView(s), scout, this.time).ok) continue;
        scout.state = "catapult";
        scout.sectorId = sector.id;
        scout.launchedAt = this.time;
        sector.lastSearchedAt = this.time;
      }
    }
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
    for (const s of this.ships)
      if (s.scouts && s.team === team && !s.sunk)
        for (const scout of s.scouts as ScoutAircraft[]) {
          if (!SCOUT_AIRBORNE_STATES.has(scout.state)) continue;
          const at = this.scoutPosition(scout, s);
          out.push({
            id: `air-scout-${scout.id}`,
            x: at.x,
            z: at.z,
            altitude: SCOUT_ALTITUDE,
            range: SCOUT_SEARCH_RANGE * VISIBILITY,
            delay: AIR_REPORT_DELAY,
            scout: true,
          });
        }
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
        // The boat's own depth, through the one conversion: a periscope is seen, a deep hull is not.
        const targetAltitude = target.sub ? subY(target.sub) : target.deckHeight;
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

  /**
   * What the Japanese can see of the atoll, filed as a report rather than read off the island. A
   * facility no observer could pick out is simply absent from the snapshot, so its last report
   * survives untouched — the decision this feeds must be allowed to run on stale knowledge, which
   * is the whole of the Nagumo problem. The delay is the fastest observer's, because one aircraft
   * already on its way home does not wait for a slower lookout.
   */
  observeFacilities(): void {
    if (!this.facilities.length) return;
    const snapshot: ObservedSnapshot = {};
    let delay = Infinity;
    for (const o of this.observersFor("jp")) {
      for (const f of this.facilities) {
        if (f.id in snapshot) continue;
        if (!canObserve({ observer: o, target: f, observerAltitude: o.altitude, targetAltitude: 0,
                          rangeLimit: o.range, visibility: VISIBILITY, sightDepth: SIGHT_DEPTH })) continue;
        snapshot[f.id] = f.health;
        delay = Math.min(delay, o.delay);
      }
    }
    if (!Object.keys(snapshot).length) return;
    this.facilityReports.push({ at: this.time + delay, snapshot });
  }

  /** Classify what was seen by the range it was seen at, date it, and put it on the air. */
  fileReport(team: string, observer: Any, target: Any): void {
    const range = distance2(observer, target);
    const truth = classOf(target);
    const { classification, confidence } = classify({ truth, range, random: observer.scout === true ? this.scoutRandom() : this.random() });
    const identified = classification === truth;
    this.filed[team].set(target.id, this.time);
    // A damaged Midway radio only slows the U.S. side's traffic; it is the delay's sole modifier.
    const delay = observer.delay * (team === "us" && this.facilities.length ? radioDelivery(this.facilities) : 1);
    this.reports.push({
      ...makeContact({
        id: target.id,
        team: team as Team,
        observerId: observer.id,
        targetId: target.id,
        observedAt: this.time,
        delay,
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
      observerKind: this.aircraft.find((a: Any) => a.id === observer.id)?.kind,
      reported: true,
    });
  }

  /**
   * Hand over every report whose transmission time has come. A report already on the air is
   * delivered whether or not the observer that filed it is still alive, and the fresher of two
   * reports on the same hull wins. An identification once made is never lost to a vaguer sighting.
   */
  deliverReports(): void {
    for (let i = this.facilityReports.length - 1; i >= 0; i -= 1) {
      const r = this.facilityReports[i];
      if (r.at > this.time) continue;
      Object.assign(this.observedFacilities, r.snapshot);
      this.facilityReports.splice(i, 1);
      this.followUpPending = true;
    }
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
      const kept = this.keepIdentity(prev, won);
      store.set(r.id, kept);
      if (r.team === "us") {
        const shown = this.contacts.get(r.id);
        if (!shown || shown.time < won.time) this.contacts.set(r.id, this.keepIdentity(shown, won));
        // The two duties the fleet's own reconnaissance picture earns at the moment a report
        // reaches it: a boat's contact passed on, and a reconnaissance aircraft's contact arriving
        // under friendly fighter cover. Both report an observation; neither steers anything.
        if (kept.classification === "submarine") this.event("support", { duty: "sub-report" });
        else if (
          kept.observerKind === "recon" &&
          this.aircraft.some(
            (a: Any) => a.team === "us" && a.kind === "fighter" && a.hp > 0 && a.mode !== "launch" && a.mode !== "crashing",
          )
        )
          this.event("support", { duty: "scout-cover" });
      }
    }
    this.reports = waiting;
    this.designateKnownCarrier();
  }

  /**
   * An observer that can no longer correct the tracks it filed. Every report it put on the air —
   * delivered or still in transmission — becomes a lost contact: the fleet keeps the sighting and
   * must dead-reckon it, with uncertainty growing three times as fast, because nobody is correcting
   * it. Nothing is withdrawn, so a report already transmitted outlives the observer that sent it.
   */
  loseObserver(observerId: string): void {
    if (!observerId) return;
    for (const team of ["us", "jp"]) {
      for (const c of this.teamIntel[team].values()) if (c.observerId === observerId) c.lost = true;
    }
    for (const c of this.contacts.values()) if (c.observerId === observerId) c.lost = true;
    for (const r of this.reports) if (r.observerId === observerId) r.lost = true;
  }

  /** A newer, vaguer report improves the position but cannot un-identify a hull already named. */
  keepIdentity(prev: IReport | undefined, next: IReport): IReport {
    if (!prev) return next;
    // A confirmed sinking is terminal truth; a later, vaguer report cannot put the hull back afloat.
    const sunk = prev.sunk || next.sunk;
    if (!prev.identified || next.identified) return sunk ? { ...next, sunk: true } : next;
    return { ...next, name: prev.name, kind: prev.kind, identified: true, deckOut: next.deckOut ?? prev.deckOut, sunk };
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
   * Reconcile known targets without silently choosing a replacement after a loss. A dead or gone
   * designation is answered by the one retask contract: it is cleared, and the crew is told to
   * retask when any legal hull remains or that none does — never handed a different target.
   */
  updateSortie(): void {
    const s = this.sortie;
    confirmPending(s, (id: string) => this.contacts.get(id));
    if (s.assignment !== "strike" && s.assignment !== "surface") return;
    const contacts = this.targetContacts();
    const live = (id: string | null) => contacts.some((c) => c.id === id);
    if (live(this.target)) {
      s.target = this.target;
    } else if (s.target && !live(s.target)) {
      const option = this.designationOption(s.target, s.assignment);
      const verdict = option ? retaskOnUnavailable(option, this.briefingWorld(), this.time) : { result: "unavailable" as const };
      if (this.target === s.target) this.target = null;
      s.target = null;
      if (s.objective === "pending") {
        if (this.eligibleHullRemains(s.assignment)) {
          this.say(
            "STRIKE CONTROL",
            verdict.result === "retask"
              ? "Your target is no longer eligible. Designate another contact with TAB."
              : "Your target is gone. Designate another contact with TAB.",
            true,
          );
        } else {
          s.objective = "unavailable";
          this.say("STRIKE CONTROL", "No eligible enemy ship remains. Return to the task force and report.", true);
        }
      }
    }
    if (s.objective !== "pending") return;
    this.designateKnownCarrier();
    // A submerged boat can surface again; its dive must not permanently end Surface Strike.
    if (!s.target && !this.eligibleHullRemains(s.assignment)) {
      s.objective = "unavailable";
      this.say("STRIKE CONTROL", "No eligible enemy ship remains. Return to the task force and report.", true);
    }
  }

  /**
   * A carrier strike is pointed at the first delivered, fresh contact the crew has classified as a
   * carrier. The trigger is the held sighting — a belief with a classification — never the hull's
   * true identity or position, so a carrier nobody has reported is never designated.
   */
  designateKnownCarrier(): void {
    const s = this.sortie;
    if (s.assignment !== "strike" || s.target || s.objective !== "pending") return;
    const sighting = this.targetContacts().find(
      (c) => c.kind === "carrier" && !isStale(c, this.time, STALE_SECONDS),
    );
    if (sighting) this.designateTarget(sighting.id, false);
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

  /**
   * Man or leave the rear gun. Only the two-seat Douglas airframes have a rear station: a
   * single-seat fighter has none, and honouring the order on the deck, in a wreck or after the
   * sortie would hide the pilot's own aircraft. Manning hands the aircraft to its existing
   * course-hold autopilot, the same flight law the player already flies, so the stick can work the
   * gun without also steering. An empty gun is still admitted — the station is inspectable and Y
   * always returns to the pilot.
   */
  setGunner(on: boolean): boolean {
    const p = this.player;
    if (!on) {
      if (!p.gunner) return false;
      p.gunner = false;
      p.gunnerYaw = 0;
      p.gunnerPitch = 0;
      p.autopilot = p.gunnerPrevAutopilot === true;
      return true;
    }
    if (p.gunner) return true;
    if (this.status !== "playing" || p.mode !== "flight" || (p.airframe !== "sbd" && p.airframe !== "tbd")) return false;
    p.gunnerPrevAutopilot = p.autopilot === true;
    p.gunner = true;
    p.autopilot = true;
    p.gunnerYaw = 0;
    p.gunnerPitch = 0;
    return true;
  }

  /** The one clamp for the manned station, shared by held keys and pointer drag. */
  aimRear(dYaw: number, dPitch: number): void {
    const p = this.player;
    if (!p.gunner) return;
    if (!Number.isFinite(dYaw) || !Number.isFinite(dPitch)) return;
    const pitch = clamp(p.gunnerPitch + dPitch, REAR_GUN_PITCH_MIN, REAR_GUN_PITCH_MAX);
    // Stay inside the shared tail cone: dot with the nose < REAR_GUN_DOT, i.e. `cos(yaw)·cos(pitch)
    // > -REAR_GUN_DOT`. Raising the gun narrows the yaw window rather than letting a fixed box cut
    // a corner outside the envelope the AI fires from.
    const cosPitch = Math.cos(pitch);
    const maxYaw = Math.min(REAR_GUN_FULL_YAW, Math.acos(Math.min(1, -REAR_GUN_DOT / cosPitch)));
    p.gunnerYaw = clamp(p.gunnerYaw + dYaw, -maxYaw, maxYaw);
    p.gunnerPitch = pitch;
  }

  /** Where the rear gun points in world space, off the airframe's real attitude. */
  gunnerAim(): { x: number; y: number; z: number } {
    const p = this.player;
    const axes = p.attitude
      ? attitudeAxes(p)
      : { f: forward(p.heading, p.pitch), u: { x: 0, y: 1, z: 0 }, r: { x: 1, y: 0, z: 0 } };
    const cy = Math.cos(p.gunnerYaw);
    const sy = Math.sin(p.gunnerYaw);
    const ct = Math.cos(p.gunnerPitch);
    const st = Math.sin(p.gunnerPitch);
    return {
      x: -axes.f.x * cy * ct + axes.r.x * sy * ct + axes.u.x * st,
      y: -axes.f.y * cy * ct + axes.r.y * sy * ct + axes.u.y * st,
      z: -axes.f.z * cy * ct + axes.r.z * sy * ct + axes.u.z * st,
    };
  }

  /**
   * The visual rear-gun pivot's Euler angles. The pivot's rest barrel is local +Z (aft) and
   * Three's positive X rotation pitches +Z down, so the station's up-positive pitch enters negated.
   * Kept beside the sim aim, and shared with the renderer, so the sight and the barrel cannot drift.
   */
  rearGunPivotEuler(): { x: number; y: number; z: number } {
    return { x: -this.player.gunnerPitch, y: this.player.gunnerYaw, z: 0 };
  }

  /** Leave the station for any reason, without touching the aircraft's flight. */
  private leaveGunnerStation(): void {
    const p = this.player;
    p.gunner = false;
    p.gunnerYaw = 0;
    p.gunnerPitch = 0;
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
      // The flash belongs at the muzzle, i.e. exactly where the round leaves the wing — not 3.3 m
      // back beside the pilot's eye, where the cockpit's own field of view cannot see it at all.
      if (a === this.player) this.fx("muzzle", { x: ox, y: oy, z: oz }, 0.55);
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

  /** The weapon identity a firing aircraft emits: SBD .50 pair, TBD single cowl .30, Zero cannon/MG, other Japanese rifle. */
  gunFamily(a: Any): string {
    if (a === this.player) return a.airframe === "tbd" ? "gun30" : "gun50";
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
      // The observer is looking at the hull now, so it can see whether the deck is fit to launch, and
      // whether the hull is already under the sea.
      deckOut: s.kind === "carrier" ? s.deck < LAUNCH_DECK : undefined,
      sunk: s.sunk === true,
      reported: prev?.reported || false,
    });
    if (!prev && !s.sunk && source === "visual" && s.kind === "carrier") {
      this.say("REAR GUNNER", `Carrier off the nose! ${s.name}, bearing ${String(Math.round((bearing(this.player, s) * 180) / Math.PI) % 360).padStart(3, "0")}. Press R to send the contact.`, true);
      this.voice("R04", { identity: s.id });
      this.voiceFlags.r04id = s.id;
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
      this.crashPlayer("Aircraft lost to battle damage.");
      return;
    }
    this.recordLoss(a);
    // Whatever this aircraft was the eyes for is now somebody else's guess; the reports it already
    // transmitted stay in the fleet's hands, dead-reckoned, rather than being erased with it.
    this.loseObserver(a.id);
    a.hp = 0;
    a.mode = "crashing";
    a.crashAge = 0;
    a.vy = Math.min(-7, a.vy || 0);
    this.fx("explosion", a, 1.15);
    this.event("explosion", { distance: distance3(this.player, a), at: { x: a.x, y: a.y, z: a.z }, material: "air" });
    if (a.damage) a.damage.engine.fire = Math.max(0.55, a.damage.engine.fire);
    // A friendly airframe going into the sea nearby: the wingman marks the pilot's position. The
    // speech queue's own dedup bounds one kill from turning into a chorus.
    if (a.team === "us" && this.player.mode === "flight" && a.mode !== "launch" && this.wingmanNear() && distance3(a, this.player) < 5000)
      this.voice("R25");
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
      if (!nearMiss) this.fx("explosion", point, 3.2);
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
      const local = localPoint(point, s), side = Math.sign(local.right) || 1;
      const right = side * (s.hullBeam * .5 + 2.5), c = Math.cos(s.heading), sn = Math.sin(s.heading);
      this.fx("splash", {x:s.x + sn * local.forward + c * right, z:s.z - c * local.forward + sn * right,
        y:-3, waterKind:"torpedo", waterDepth:3, waterDirection:{x:c*side,z:sn*side}}, 3.6, true);
      this.event("explosion", { distance: distance3(this.player, point), at: { x: point.x, y: point.y, z: point.z }, material: "steel", outcome: "torpedo" });
    } else {
      s.aa = Math.max(0.1, s.aa - 0.005);
      s.deck = Math.max(0, s.deck - 0.0008);
      if (this.random() < 0.03) this.wreckAircraft(s, 1);
      this.fx("hit", point, 0.5);
    }
    // A direct hit on a scout cruiser's handling area erodes its future reconnaissance. It grounds
    // later launches; every report already on the air or delivered is untouched.
    if (hostile && s.scouts && amount > 0 && !nearMiss && (weapon === "bomb" || weapon === "torpedo"))
      s.aviation = clamp((s.aviation ?? 1) - amount / 300, 0, 1);
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
    // A sinking hull's lookouts stop correcting their tracks, exactly as a dead aircrew does.
    this.loseObserver(s.id);
    // A sunk scout cruiser loses its floatplanes; reports already delivered are not its to recall,
    // they simply become lost tracks nobody is left to correct.
    if (s.scouts)
      for (const scout of s.scouts as ScoutAircraft[]) {
        if (scout.state !== "lost") this.loseObserver(`air-scout-${scout.id}`);
        scout.state = "lost";
        scout.fuel = 0;
      }
    // The crew is in the water where the hull went down. The seeded draw varies the count; a later
    // rescue genuinely saves fewer because exposure decays the group every step it waits.
    const crew = SURVIVOR_CREW[s.kind] ?? 100;
    this.survivors.push({
      id: this.id("survivors"),
      x: s.x,
      z: s.z,
      since: this.time,
      fromShipId: s.id,
      count: Math.max(10, Math.round(crew * (0.6 + this.random() * 0.4))),
    });
    this.fx("explosion", s, 5);
    this.event("collapse", { distance: distance3(this.player, s), at: { x: s.x, y: 0, z: s.z } });
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

  /** The nearest facility whose footprint contains a weapon impact, or null over open water. */
  facilityAt(p: Any): Facility | null {
    let best: Facility | null = null;
    let bestD = Infinity;
    for (const f of this.facilities) {
      const d = Math.hypot(p.x - f.x, p.z - f.z);
      if (d <= f.radius && d < bestD) {
        bestD = d;
        best = f;
      }
    }
    return best;
  }

  /**
   * One weapon's damage on the facility it actually landed on. `amount` is a 0..1 fraction of a whole
   * structure, and the one seeded draw is the roll `damageFacility` needs to decide ignition.
   */
  hitFacility(f: Facility, amount: number, p: Any): void {
    const dealt = clamp(amount, 0, 1);
    const next = damageFacility(f, dealt, this.random());
    for (let i = 0; i < this.facilities.length; i += 1) {
      if (this.facilities[i].id === f.id) {
        this.facilities[i] = next;
        break;
      }
    }
    this.event("facility", { kind: next.kind, damage: dealt });
    this.fx("explosion", p, 1.6);
  }

  /**
   * Fire, repair and the finite work budget. A single seeded draw gates `spreadFire` for the whole
   * tick; `repairPlan` decides which damaged facilities a crew can reach, and only those receive the
   * repair rate, so the atoll cannot rebuild itself for free. Unspent slots bank up to the cap.
   */
  updateFacilities(dt: number): void {
    if (!this.facilities.length) return;
    const rates: FacilityRates = { repair: FACILITY_REPAIR_RATE, burn: FACILITY_BURN_RATE };
    this.facilities = spreadFire(this.facilities, dt, rates, this.random());
    this.facilityWork = Math.min(FACILITY_WORK_CAP, this.facilityWork + FACILITY_WORK_PER_SECOND * dt);
    const chosen = this.chosenScratch;
    chosen.clear();
    for (const o of repairPlan(this.facilities, this.facilityWork, this.time)) chosen.add(o.id);
    this.facilityWork -= chosen.size;
    for (let i = 0; i < this.facilities.length; i += 1) {
      const f = this.facilities[i];
      this.facilities[i] = stepFacility(f, dt, chosen.has(f.id) ? rates : NO_REPAIR_RATES);
    }
  }

  /** Midway's air arm is lost only when both the airstrip and the seaplane route are gone. */
  get baseAviationLost(): boolean {
    return this.facilities.length > 0 && baseAviationLost(this.facilities);
  }

  /**
   * A destroyed player aircraft goes down the way every other one does: dead stick, no lift and no
   * control authority, trailing its engine fire, until it meets the sea. The debrief is the report
   * of a crash that already happened, so it waits for the impact rather than interrupting it.
   */
  crashPlayer(reason: string): void {
    const p = this.player;
    if (this.status !== "playing" || p.mode === "crashing" || p.mode === "wreck" || p.mode === "downed") return;
    if (p.mode !== "flight") {
      // No fall to animate: the aircraft was lost on a surface or deck already, so it goes straight to
      // the downed wait and is counted there exactly once.
      this.losePlayerAircraft(reason);
      return;
    }
    // The player's own airframe is a fleet loss too; `recordLoss` deliberately skips the player,
    // so this is the one place it is counted.
    this.stats.playerLosses += 1;
    p.mode = "crashing";
    p.crashAge = 0;
    p.hp = 0;
    p.throttle = 0;
    p.autopilot = false;
    p.landingAssist = null;
    p.engineCut = true;
    this.leaveGunnerStation();
    this.crashReason = reason;
    if (p.damage) p.damage.engine.fire = Math.max(0.7, p.damage.engine.fire);
    this.fx("explosion", p, 1.4);
    // The engine dies first and the airframe cracks with it; the crash cue itself belongs to the
    // sea, seconds later. Everything between is the slipstream, the windmilling prop and the fire.
    this.event("engineSeize", { cue: "engineSeize", distance: 0, at: { x: p.x, y: p.y, z: p.z } });
    this.event("damage");
    this.event("notice", { text: "AIRCRAFT LOST — GOING DOWN" });
    this.say("REAR GUNNER", "She's finished! We're going in — brace!", true);
    if (this.wingmanNear()) this.voice("R30");
  }

  crashReason = "";

  /** The fall itself: the engine integrates it, and the impact ends the sortie. */
  private updateCrash(dt: number): void {
    const p = this.player;
    p.crashAge = (p.crashAge || 0) + dt;
    // A steady aileron keeps the wreck turning as it falls rather than gliding straight down.
    p.aileron = 1;
    this.playerFlight.step(dt, { autopilot: true, pitch: -0.35, rudder: 0, turn: 0 }, DESTROYED_MODIFIERS);
    if (p.y > 0.6 && p.crashAge < 30) return;
    // In the water. The sortie is over, but the report waits for the splash to be seen: the
    // simulation keeps running through the settle so the impact animates instead of freezing
    // under the debrief.
    p.y = 0;
    p.mode = "wreck";
    p.crashSettle = 0;
    p.vx = 0;
    p.vy = 0;
    p.vz = 0;
    p.speed = 0;
    this.wrecks.push(wreckMarker(p.x, p.z, p.team));
    this.fx("splash", { ...p, y: 0 }, 3);
    this.fx("explosion", { ...p, y: 1 }, 1.6);
    this.event("explosion", { distance: 0, at: { x: p.x, y: 0, z: p.z }, material: "air" });
    this.event("splash", { distance: 0, at: { x: p.x, y: 0, z: p.z }, fragments: true });
  }

  /** `blast` is the loss's own explosion; a crash that already hit the sea has sounded its own. */
  /** The seconds between the splash and the after-action report. */
  private updateWreck(dt: number): void {
    const p = this.player;
    p.crashSettle = (p.crashSettle || 0) + dt;
    p.y = 0;
    if (p.crashSettle < 2.2) return;
    // A shoot-down freezes the sortie, not the battle. While a friendly carrier is still afloat the
    // pilot can be spotted another aircraft; only losing the whole carrier force is a defeat.
    this.goDownedOrLose(this.crashReason || "Aircraft lost.");
  }

  /**
   * One player airframe is gone without a fall to animate — it was destroyed on deck, in an
   * arrestment, or on the sea. That is the same single loss `crashPlayer` counts: the pilot waits
   * downed while any friendly deck is afloat, and only a genuine fleet defeat ends the battle.
   */
  private losePlayerAircraft(reason: string): void {
    const p = this.player;
    if (this.status !== "playing" || p.mode === "downed" || p.mode === "wreck") return;
    this.stats.playerLosses += 1;
    this.crashReason = reason;
    this.goDownedOrLose(reason);
  }

  /**
   * The one share of the after-loss transition every aircraft loss routes through: freeze the lost
   * sortie under its own id, and park the pilot downed if a friendly deck remains, otherwise hand the
   * loss to `lose`. A no-friendly-carrier condition is a defeat either way, so the global check in
   * `step` and this call can never disagree — they both read `friendlyCarrierAfloat`.
   */
  private goDownedOrLose(reason: string): void {
    const p = this.player;
    p.hp = 0;
    p.engineCut = true;
    p.throttle = 0;
    if (!this.friendlyCarrierAfloat) {
      this.lose(reason, false);
      return;
    }
    // Freeze the lost sortie under its own id whatever the assignment: the replacement opens a new
    // id, so no weapon stamped for this flight can score in the next one.
    if (!this.sortie.result) this.sortie.result = this.snapshotResult("lost", this.home);
    p.mode = "downed";
    this.event("notice", { text: "AIRCRAFT LOST — TAKE ANOTHER AIRCRAFT FROM A FRIENDLY DECK" });
    this.say("BATTLE CONTROL", "We still have decks. Another aircraft is being spotted for you.", true);
  }

  /** Is any friendly flight deck still in the water? The one defeat condition a shoot-down can meet. */
  get friendlyCarrierAfloat(): boolean {
    return this.ships.some((s: Any) => s.kind === "carrier" && s.team === "us" && !s.sunk);
  }

  lose(reason: string, blast = true): void {
    if (this.status !== "playing") return;
    this.leaveGunnerStation();
    if (isShort(this.sortie) && !this.sortie.result) this.sortie.result = this.snapshotResult("lost", this.home);
    else if (this.sortie.assignment === "operation" && !this.sortie.result)
      concludeOperation(this.sortie, { state: "defeat", reason }, this.time);
    this.status = "lost";
    this.reason = reason;
    if (blast) this.event("explosion");
    this.fx("explosion", this.player, 2.5);
  }

  /**
   * The one victory: the whole enemy fleet is on the bottom. A successful recovery ends only the
   * sortie, so this is checked for every assignment and every flight state rather than at the deck,
   * and it names any salvage still outstanding so the crew knows what it did not wait for.
   */
  win(reason = "All enemy shipping has been sunk."): void {
    if (this.status !== "playing") return;
    const remaining = pendingOpportunities(this.operationWorld(), this.time).length;
    if (remaining) reason += ` ${remaining} rescue task${remaining === 1 ? "" : "s"} remain.`;
    this.leaveGunnerStation();
    this.reason = reason;
    if (this.sortie.assignment === "operation" && !this.sortie.result)
      concludeOperation(this.sortie, { state: "success", reason }, this.time);
    this.status = "won";
    this.event("operation", { state: "success" });
  }

  reason = "";

  /**
   * The nearest friendly carrier that can put the player's own aircraft type up right now: a free
   * deck, a ready airframe of that type, a store for it and aviation fuel. `canLaunch` is the only
   * gate, so this refuses for exactly the reasons the AI launch side does. The player's type is
   * fixed: changing airframe mid-battle is not offered here rather than silently substituted.
   */
  private chooseReplacementDeck(): { deck: Any; reason: string } {
    const p = this.player;
    const airframe = p.airframe || "sbd";
    const store = storeFamilyOf(airframe);
    let reason = "no operational friendly flight deck";
    let best: Any = null;
    for (const s of this.ships) {
      if (s.team !== "us" || s.kind !== "carrier" || s.sunk || !s.air || !s.deckState) continue;
      this.refreshDeck(s);
      const check = canLaunch(s.air, s.deckState, airframe, store, this.time, this.activeAircraft, ACTIVE_CAP);
      if (!check.ok) {
        reason = check.reason;
        continue;
      }
      if (s.air.fuel < FUEL_PER_LAUNCH) {
        reason = "no aviation fuel";
        continue;
      }
      // The nearest deck is the one the pilot would be flown to; ties keep the first found.
      if (!best || distance2(s, p) < distance2(best, p)) best = s;
    }
    return { deck: best, reason };
  }

  /** What the downed panel shows: the frozen flight-loss outcome plus the replacement deck or a refusal. */
  replacementStatus(): { available: boolean; carrier: string; reason: string; last: string } {
    const found = this.chooseReplacementDeck();
    const frozen = this.sortie.result;
    const last = frozen ? outcomeText(frozen) : this.crashReason || "Aircraft lost.";
    if (found.deck)
      return { available: true, carrier: found.deck.name, reason: `A fresh ${this.player.airframe.toUpperCase()} is ready on ${found.deck.name}.`, last };
    return { available: false, carrier: "", reason: `No replacement available — ${found.reason}.`, last };
  }

  /**
   * Take a replacement aircraft while downed. `applyLaunch` charges the conserved inventory — one
   * ready airframe and one store — exactly once; the deck run that follows (`W`) charges nothing
   * more, and `resetPlayerForLaunch` draws the one fuel load. A second call while already flying is a
   * no-op, so a repeated click cannot double-debit the deck.
   */
  takeAnotherAircraft(): boolean {
    const p = this.player;
    if (this.status !== "playing" || p.mode !== "downed") return false;
    const found = this.chooseReplacementDeck();
    if (!found.deck) {
      this.event("notice", { text: `NO REPLACEMENT AIRCRAFT — ${found.reason.toUpperCase()}` });
      return false;
    }
    const s = found.deck;
    const airframe = p.airframe || "sbd";
    const applied = applyLaunch(s.air, s.deckState, airframe, storeFamilyOf(airframe), this.time, TIMES);
    s.air = applied.air;
    s.deckState = applied.deck;
    this.refreshDeck(s);
    // The failed sortie's record and every release stamp it owns are frozen under its own id; the
    // next sortie gets a new one, so no old weapon can score in it.
    this.lastResult = this.sortie.result ?? this.lastResult;
    this.sortie = newSortie(this.sortie.assignment, this.time, this.sortie.id + 1, this.sortie.duty);
    this.resetPlayerForLaunch(s, true);
    this.event("notice", { text: `NEW AIRCRAFT READY — ${s.name.toUpperCase()}` });
    return true;
  }

  /**
   * Leave a short sortie's after-action report and go back to work. The recovery already put the
   * pilot aboard and started the deck service; resuming play lets that service finish and
   * `resetPlayerForLaunch` rearm the aircraft. A new sortie id keeps the next flight's weapon stamps
   * from scoring against the record just frozen, so the debrief cannot be rewritten by a later hit.
   */
  continueAfterRecovery(): boolean {
    if (this.status !== "debrief") return false;
    this.lastResult = this.sortie.result ?? this.lastResult;
    this.sortie = newSortie(this.sortie.assignment, this.time, this.sortie.id + 1, this.sortie.duty);
    this.status = "playing";
    return true;
  }

  /**
   * The tactical map's honest appraisal. Enemy carriers are the crew's observed contacts and the
   * confirmed losses among them — a sinking an observation looked at, or a deck an observation saw
   * unable to launch. A hull nobody reported is absent, and a reported but intact contact establishes
   * no enemy strength. The comparison is therefore confirmed enemy attrition against friendly decks
   * out of action, never reported-contact counts.
   */
  battleStatus(): IBattleStatus {
    const carriers = this.ships.filter((s: Any) => s.kind === "carrier");
    const friendly = carriers.filter((s: Any) => s.team === "us");
    const friendlyAfloat = friendly.filter((s: Any) => !s.sunk).length;
    const friendlyOperational = friendly.filter((s: Any) => !s.sunk && s.deck >= LAUNCH_DECK).length;
    const friendlySunk = friendly.length - friendlyAfloat;
    const friendlyOut = friendlySunk + (friendlyAfloat - friendlyOperational);
    const airLosses = friendly.reduce((n: number, s: Any) => n + (s.lostAircraft ?? 0), 0) + this.stats.playerLosses;
    const observed = [...this.contacts.values()].filter((c: IReport) => c.kind === "carrier");
    const reported = observed.filter((c: IReport) => !isStale(c, this.time, STALE_SECONDS));
    const enemyReported = reported.length;
    // A confirmed sinking is terminal and counts even after the positional track ages; a deck merely
    // observed out still needs a current sighting, and a later observation of a repaired deck clears it.
    const enemySunk = observed.filter((c: IReport) => c.sunk === true).length;
    const enemyDecksOut = enemySunk + reported.filter((c: IReport) => c.sunk !== true && c.deckOut === true).length;
    let appraisal: IBattleStatus["appraisal"];
    if (enemyReported === 0 && enemyDecksOut === 0) appraisal = "INSUFFICIENT INTELLIGENCE";
    else if (enemyDecksOut > friendlyOut) appraisal = "ALLIES LEADING";
    else if (enemyDecksOut < friendlyOut) appraisal = "ENEMY LEADING";
    else appraisal = "CONTESTED";
    return {
      friendlyAfloat,
      friendlyOperational,
      friendlySunk,
      enemyReported,
      enemyDecksOut,
      airLosses,
      airKills: this.stats.kills,
      appraisal,
      basis: "BASIS: CONFIRMED ENEMY CARRIERS DISABLED OR SUNK (VISUALLY OBSERVED) VS FRIENDLY DECKS OUT OF ACTION — REPORTED BUT INTACT CONTACTS DO NOT REVEAL ENEMY STRENGTH.",
      line: `ALLIED DECKS ${friendlyOperational}/${friendly.length} OPERATIONAL · ${friendlyOut} OUT OF ACTION · ENEMY ${enemyDecksOut} CONFIRMED OUT (${enemyReported} REPORTED) · AIR ${airLosses} LOST / ${this.stats.kills} YOUR CONFIRMED KILLS`,
    };
  }

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
    let kept = 0;
    for (let i = 0; i < this.effects.length; i += 1) {
      const f = this.effects[i];
      if (f.age < f.life) this.effects[kept++] = f;
    }
    this.effects.length = kept;
    this.wrecks = stepWrecks(this.wrecks, dt);
    this.updateRescue(dt);
    this.updateShips(dt);
    this.updateFacilities(dt);
    this.updateScouts(dt);
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
      this.observeFacilities();
      this.deliverReports();
      this.updateHunts();
      for (const s of this.ships) if (s.kind === "carrier" && !s.sunk && s.air) this.updateCarrier(s);
      this.updateOperation();
    }
    if (this.time > 7 && !this.reconLaunched) {
      this.reconLaunched = true;
      this.launchRecon();
    }
    if (this.time > 35 && !this.reconNotice) {
      this.reconNotice = true;
      this.say("PATROL CONTROL", "Reports place the enemy northwest of the task force. Use T for course hold.");
    }
    if (this.time > 130 && !this.threatNotice) {
      this.threatNotice = true;
      // Air warning is the radar's one job: its mean health sets how far a raid is picked up. It never
      // names a ship or reports deck health, and one dead set of several only shortens the reach.
      const warning = this.facilities.length ? radarWarning(this.facilities) : 1;
      const reach = 7000 * warning;
      const near =
        warning > 0 &&
        this.aircraft.some((a) => a.team === "jp" && a.kind !== "fighter" && distance2(a, this.home) < reach * reach);
      if (near) this.say("ENTERPRISE RADAR", "Inbound strike aircraft. Fighters, intercept before they reach the carriers.", true);
    }
    let usCarriersAfloat = false;
    let enemyDecksOperational = false;
    for (const s of this.ships) {
      if (s.kind === "carrier" && s.team === "us" && !s.sunk) usCarriersAfloat = true;
      if (s.team === "jp" && s.kind === "carrier" && !s.sunk && s.deck >= LAUNCH_DECK) enemyDecksOperational = true;
    }
    if (!usCarriersAfloat) this.lose("The U.S. carrier force has been lost.");
    if (!enemyDecksOperational && !this.strikeComplete) {
      this.strikeComplete = true;
      this.say("ENTERPRISE", "All four enemy flight decks are neutralized. Finish the fleet — no enemy hull afloat is the operation complete.", true);
    }
    // Losing the decks is not winning the war: victory needs every enemy hull, of every class, sunk.
    if (!this.operationalEnemyShips.length) this.win();
  }

  strikeComplete = false;

  /**
   * Is a hostile aircraft close enough to menace this boat? The one trigger that puts a boat under
   * without a shipping contact. `distance2` is a plain distance in metres. A crashing or still
   * launching airframe is not a threat: it has its own problems.
   */
  airThreatNear(s: Any): boolean {
    for (const a of this.aircraft) {
      if (a.team === s.team || a.hp <= 0 || a.mode === "crashing" || a.mode === "launch") continue;
      if (distance2(s, a) <= SUB_AIR_THREAT_RANGE) return true;
    }
    return false;
  }

  updateShips(dt: number): void {
    const surface = this.surfaceScratch;
    surface.length = 0;
    for (const s of this.ships) if (!s.sunk && s.kind !== "sub") surface.push(s);
    const hazards = [{ x: this.island.x, z: this.island.z, radius: ATOLL_HAZARD_RADIUS }];
    for (const s of this.ships) {
      if (s.sunk) {
        s.sink = Math.min(1, s.sink + dt * 0.012);
        s.y = -s.sink * 34;
        continue;
      }
      updateEvasion(this, s, dt);
      // A submarine's own state caps it: swift on the surface, slow and battery-hungry under it.
      s.speed =
        s.kind === "sub" && s.sub
          ? Math.min(s.baseSpeed * (0.35 + 0.65 * s.engine), maxSpeed(s.sub))
          : s.baseSpeed * (0.35 + 0.65 * s.engine);
      // A submarine runs its own attack logic and is never station-kept; every surface hull hands
      // its helm to the group, where station keeping, course authority and evasion all resolve.
      if (s.kind !== "sub") this.steerSurface(s, dt, surface, hazards);
      // Scout handling slows the cruiser into the water-pickup envelope unless it is evading, when
      // survival outranks recovery and the floatplane waits on the water. This follows the helm so
      // the group's own station-keeping speed cannot overwrite it.
      if (
        s.scouts &&
        (s.evadeUntil || 0) <= this.time &&
        (s.scouts as ScoutAircraft[]).some((sc) => sc.state === "alongside")
      )
        s.speed = Math.min(s.speed, PICKUP_MAX_SHIP_SPEED);
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
        const state: SubState = s.sub;
        // A boat attacks what it has been told about, through the same delivered contacts every
        // other attacker uses. No ship name and no live hull are read: with no report it has nothing
        // to steer at, and a stale one puts the aim where the ship was going, not where it is.
        const contact = strikeContact(this, s);
        const fire = canFire(state, this.time);
        // Pick a depth, then earn it. `stepDepth` converges on the wanted mode and `mode` flips only
        // when the hull is within a metre of it. Nothing surfaces a boat on a timer. A hostile
        // aircraft close overhead puts an idle boat under; a boat already holding a firing solution
        // presses the attack instead, so the crash dive never starves the torpedo run (AC-16).
        const wanted: SubMode = this.airThreatNear(s) && !contact
          ? "deep"
          : !contact
            ? "surfaced"
            : fire.ok || fire.reason === "too deep"
              ? "periscope"
              : "deep";
        Object.assign(state, stepDepth(state, wanted, dt, SUB_DIVE_RATE));
        // A reload is finite and its clock belongs to the boat: when it runs out the tubes are ready
        // again, but only while a spare load remains. `applyFire` spends the reload and starts the
        // clock; clearing it once served stops a stale clock from re-arming the tubes for free.
        if (state.tubes <= 0 && state.reloadUntil > 0 && this.time >= state.reloadUntil) {
          if (state.reloads > 0) state.tubes = SUB_TUBES;
          state.reloadUntil = 0;
        }
        state.battery = Math.max(0, state.battery - batteryDrain(state, s.speed, dt));
        // Only a deep boat is unobserved; a periscope still breaks the surface.
        s.surfaced = state.depth < SIGHT_DEPTH;
        // The one and only depth-to-y conversion.
        s.y = subY(state);
        if (contact) {
          const e = estimatePosition(contact, this.time);
          const range = distance2(s, e);
          const course = interceptCourse(s.x, s.z, s.speed, e.x, e.z, contact.heading, contact.speed);
          const aim = course ? course.heading : bearing(s, e);
          s.heading = wrap(s.heading + clamp(angleDelta(aim, s.heading), -SUB_TURN_RATE * dt, SUB_TURN_RATE * dt));
          s.torpTimer -= dt;
          const shot = canFire(state, this.time);
          if (s.torpTimer <= 0 && shot.ok && range < SUB_TORPEDO_RANGE) {
            this.spawnTorpedo(s, aim);
            Object.assign(state, applyFire(state, this.time, SUB_RELOAD_SECONDS));
            s.torpTimer = SUB_FIRE_INTERVAL;
            if (s.team === "jp" && distance2(s, this.player) < 3000) this.say("LOOKOUT", "Torpedo wakes! Submarine attack near the task force!", true);
          }
        }
        continue;
      }
      updateGunnery(this, s, dt);
    }
    // A group re-forms after an evasion ends, and the coverage it has lost is exactly its absent
    // escorts' stations — the number a removed escort now costs.
    for (const group of this.surfaceGroups) {
      if (group.reform) {
        this.reformGroup(group);
        group.reform = false;
      }
      const absent = group.memberIds.filter((id) => {
        const m = this.byId(id);
        return !m || m.sunk || (m.evadeUntil || 0) > this.time || !!m.assist;
      });
      group.coverageLost = coverageLost(group, absent);
    }
  }

  /**
   * Survivors, rescue and the alongside, all through `rescue.ts`. Exposure and pickup run every
   * step, so a group left in the water loses people before it is reached; the alongside is gated by
   * `canAssist`, its pumps are `assistBenefit` and its cost is `assistCost`. No hull is named: an
   * escort is any destroyer or cruiser and a carrier is any damaged friendly one.
   */
  updateRescue(dt: number): void {
    const now = this.time;
    for (const s of this.ships) {
      if (s.sunk) continue;
      if (s.assist) {
        const carrier = this.byId(s.assist.carrierId);
        if (!carrier || carrier.sunk) {
          this.recordAssistAbort(s, detach(s.assist, "carrier lost", now));
          continue;
        }
        const check = canAssist(this.escortView(s), this.carrierView(carrier), this.threatsNear(carrier));
        if (!check.ok) {
          // A detected torpedo threat is the abort that must be recorded, reason and time.
          this.recordAssistAbort(s, detach(s.assist, check.reason, now));
          continue;
        }
        if (distance2(s, carrier) <= ASSIST_DISTANCE) {
          s.assist = { ...s.assist, phase: "alongside" };
          // Assisting gives up the screen station: the ship is tied to the carrier's flank.
          s.station = null;
          s.stationSlot = null;
          const cost = assistCost(this.escortView(s));
          s.manoeuvrable = cost.manoeuvrable;
          s.screenCoverageLost = cost.screenCoverageLost;
          const benefit = assistBenefit(this.carrierView(carrier), this.escortView(s), dt);
          carrier.list = Math.max(0, (carrier.list ?? 0) - benefit.floodingDelta);
          if ((carrier.fire ?? 0) > 0) carrier.fire = Math.max(0, carrier.fire - benefit.fireDelta);
          s.assistBenefit = benefit;
        } else {
          s.assist = { ...s.assist, phase: "approaching" };
        }
        continue;
      }
      if (s.rescue) {
        const step = stepRescue(
          s.rescue,
          { x: s.x, z: s.z, speed: s.speed },
          this.survivors,
          dt,
          DEFAULT_RESCUE_LIMITS,
        );
        s.rescue = step.state;
        this.survivors = step.survivors;
        if (s.rescue.phase === "done" || s.rescue.phase === "aborted") {
          s.recovered = (s.recovered ?? 0) + s.rescue.recovered;
          // People are actually aboard: the one occurrence the rescue-cover duty names. An aborted
          // run or a group lost before the ship reached it brings nobody home and emits nothing.
          if (s.rescue.phase === "done" && s.rescue.recovered > 0) this.event("support", { duty: "rescue-cover" });
          this.endTask(s);
        }
        continue;
      }
      // An escort takes a new job only when its screen station is its sole duty.
      if (!isEscort(s) || !s.task || s.task.task !== "station") continue;
      const carrier = this.assistCandidate(s);
      if (carrier) {
        s.assist = { carrierId: carrier.id, phase: "approaching", startedAt: now };
        s.task = { task: "assist", targetId: carrier.id, startedAt: now, reason: "alongside damaged carrier" };
        continue;
      }
      const window = rescueWindow(this.survivors, now, {
        fromX: s.x,
        fromZ: s.z,
        range: RESCUE_RANGE,
        minCount: RESCUE_MIN_COUNT,
        abandonAfter: RESCUE_ABANDON_SECONDS,
      });
      if (!window) continue;
      // One escort per group, so the exposure decay is not applied several times over per step.
      if (this.ships.some((o: Any) => o.rescue && o.rescue.targetId === window.targetId)) continue;
      // The nearest eligible escort takes the boatload, not whichever hull happens to sit first in
      // the fleet array. Array order let a carrier's own screen escort leave station for survivors a
      // nearer escort — the survivors' own group in particular — could reach just as well.
      const boat = this.survivors.find((g: Any) => g.id === window.targetId);
      if (boat) {
        const mine = Math.hypot(boat.x - s.x, boat.z - s.z);
        const nearer = this.ships.some(
          (o: Any) =>
            o !== s &&
            !o.sunk &&
            isEscort(o) &&
            !o.rescue &&
            !o.assist &&
            o.task?.task === "station" &&
            Math.hypot(boat.x - o.x, boat.z - o.z) < mine - 1e-6,
        );
        if (nearer) continue;
      }
      s.rescue = { targetId: window.targetId, phase: "approaching", startedAt: now, recovered: 0 };
      s.task = { task: "rescue", targetId: window.targetId, startedAt: now, reason: "survivors in the water" };
    }
    // A group recovered down to nothing is no longer in the water.
    let kept = 0;
    for (let i = 0; i < this.survivors.length; i += 1) {
      const g = this.survivors[i];
      if (g.count > 0.5) this.survivors[kept++] = g;
    }
    this.survivors.length = kept;
  }

  /**
   * The anti-submarine hunt, one ops tick at a time. Each U.S. escort advances its own `hunt`
   * against the submarine contact its fleet actually holds — a delivered report, never a live hull —
   * through `asw.stepHunt`, which is pure. When a pass puts a salvo in the water the escort resolves
   * it: `submarine.ts`'s own fuse and falloff decide whether a charge is close enough and fuzed deep
   * enough to damage the boat, so a too-deep or too-distant contact survives the miss. The escort
   * never reads the boat's true depth or position to decide to attack, and draws no random of its own.
   */
  updateHunts(): void {
    for (const s of this.ships) {
      const hunt: AswState | null = s.hunt;
      if (!hunt || s.sunk || s.team !== "us" || !isEscort(s)) continue;
      const report = this.huntedContact(s);
      const contact: AswContact = report
        ? this.aswContact(s, report)
        : { bearing: 0, bearingUncertainty: 1, range: null, depth: 0, held: false, lastHeld: hunt.phaseTime + 1 };
      const next = stepHunt(hunt, contact, { x: s.x, z: s.z, heading: s.heading, speed: s.speed }, OPS_INTERVAL, ASW_LIMITS);
      s.hunt = next;
      const dropped = next.salvoes - hunt.salvoes;
      if (dropped > 0 && report && next.solution) {
        this.resolveSalvo(report, next.solution);
        this.event("hunt", { phase: next.phase, salvoes: dropped });
      }
    }
  }

  /**
   * The escort's own sonar: a resident sensor, not a report on the air. With an enemy boat inside
   * `ASW_SONAR_RANGE` it hands back a fix carrying a RANGE and a BEARING — the two things ASDIC
   * measures — with a small positional error. It is deliberately no better than that: the believed
   * DEPTH is still zero (`aswContact`), so a boat that is actually deep draws a shallow-fuzed salvo
   * and survives. This is what lets the hunt open when no lookout has yet called the boat a
   * submarine, and it owes no transmission delay because the sensor never leaves the ship.
   */
  sonarContact(s: Any): IReport | null {
    let best: Any = null;
    let bestD = Infinity;
    for (const boat of this.ships) {
      if (boat.team === s.team || boat.sunk || boat.kind !== "sub" || !boat.sub) continue;
      const d = distance2(s, boat);
      if (d > ASW_SONAR_RANGE) continue;
      if (d < bestD) {
        bestD = d;
        best = boat;
      }
    }
    if (!best) return null;
    const range = bestD;
    return {
      ...makeContact({
        id: best.id,
        team: "us",
        observerId: s.id,
        targetId: best.id,
        observedAt: this.time,
        delay: 0,
        x: best.x,
        z: best.z,
        heading: best.heading,
        speed: best.speed,
        // An echo is an uncertain fix: a few tens of metres, growing with range.
        errorRadius: 25 + range * 0.05,
        classification: "submarine",
        confidence: 0.8,
      }),
      name: CLASS_LABELS.submarine,
      kind: "submarine",
      time: this.time,
      identified: false,
      source: "sonar",
      reported: false,
    };
  }

  /**
   * The freshest submarine contact the escort can act on: its own sonar first, then the nearest
   * delivered report its fleet holds. Both feed the same `aswContact` belief, so the hunt is still
   * built from a range and a bearing, never from the boat's true state.
   */
  huntedContact(s: Any): IReport | null {
    const sonar = this.sonarContact(s);
    if (sonar) return sonar;
    let best: IReport | null = null;
    let bestD = Infinity;
    for (const c of this.teamIntel.us.values()) {
      if (c.kind !== "sub" && c.classification !== "submarine") continue;
      if (isStale(c, this.time, STALE_SECONDS)) continue;
      const d = distance2(s, estimatePosition(c, this.time));
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    return best;
  }

  /**
   * The escort's belief about the boat, built only from the delivered report. Its dead-reckoned
   * estimate gives the bearing and the range, and the track's age is how long it has gone
   * unrefreshed. `depth` is the escort's own estimate — a report carries none — so the fuse ladder
   * follows a belief, never the boat's true depth.
   */
  aswContact(s: Any, c: IReport): AswContact {
    const estimate = estimatePosition(c, this.time);
    const range = distance2(s, estimate);
    const age = this.time - c.observedAt;
    return {
      bearing: bearing(s, estimate),
      bearingUncertainty: clamp(estimate.radius / Math.max(range, 1), 0.05, 1.2),
      range,
      depth: 0,
      held: !isStale(c, this.time, STALE_SECONDS),
      lastHeld: age,
    };
  }

  /**
   * Resolve one dropped salvo against the boat through `submarine.ts`'s charge arithmetic. Each drop
   * point sinks to the fuse's preset and detonates; the 3D falloff to the boat's real position
   * decides the damage, so a charge that is too shallow, too far, or fuzed for another depth does
   * nothing at all. Damage goes through `damageShip`; nothing invents a hit beyond the falloff.
   */
  resolveSalvo(c: IReport, solution: AttackSolution): void {
    const boat = this.byId(c.id);
    if (!boat || boat.sunk || !boat.sub) return;
    const targetY = subY(boat.sub);
    let total = 0;
    for (const point of solution.dropPoints) {
      let charge: DepthCharge = {
        x: point.x,
        y: 0,
        z: point.z,
        presetDepth: solution.presetDepth,
        sinkRate: ASW_SINK_RATE,
        armed: false,
      };
      while (!charge.armed) charge = stepCharge(charge, 0.1);
      const damage = chargeDamage(charge, boat.x, targetY, boat.z, ASW_LETHAL_RADIUS);
      if (damage > 0) total += damage;
    }
    if (total > 0) this.damageShip(boat, total * ASW_CHARGE_DAMAGE, { x: boat.x, y: targetY, z: boat.z }, "depth-charge", "us");
  }

  /** The rescue module's view of an escort: its screen contribution is the whole station. */
  escortView(s: Any): Any {
    return { id: s.id, neededElsewhere: false, assistFactor: ASSIST_FACTOR, screenCoverage: 1 };
  }

  /**
   * The rescue module's damage view of a hull. `Battle` tracks a ship as hp plus the live `list`
   * and `fire` severities and its class capacity, not a `damage.ts` zone record, so the flooding
   * rate the alongside offsets is the hull's own list and its fire rate its own fire.
   */
  carrierView(s: Any): Any {
    return {
      id: s.id,
      sunk: !!s.sunk,
      damage: {
        hull: clamp(1 - s.hp / (s.maxHp || s.hp || 1), 0, 1),
        propulsion: 0,
        fire: Math.max(0, s.fire ?? 0),
        aviation: 0,
        weapons: 0,
        flooding: Math.max(0, s.list ?? 0),
        fireRate: Math.max(0, s.fire ?? 0),
        capacity: classCapacity(s.kind),
      },
    };
  }

  /** A running hostile torpedo near the carrier: the one detected threat that aborts an alongside. */
  threatsNear(carrier: Any): Any[] {
    const out: Any[] = [];
    for (const t of this.torpedoes) {
      if (t.team !== carrier.team && distance2(t, carrier) <= ASSIST_THREAT_RANGE)
        out.push({ kind: "torpedo", team: t.team, x: t.x, z: t.z });
    }
    return out;
  }

  /** The nearest damaged friendly carrier in reach that no other escort is already working. */
  assistCandidate(escort: Any): Any {
    let best: Any = null;
    let nearest = ASSIST_RANGE;
    for (const c of this.ships) {
      if (c.kind !== "carrier" || c.team !== escort.team || c.sunk) continue;
      if (this.ships.some((o: Any) => o !== escort && o.assist && o.assist.carrierId === c.id)) continue;
      const d = distance2(escort, c);
      if (d >= nearest) continue;
      if (!canAssist(this.escortView(escort), this.carrierView(c), this.threatsNear(c)).ok) continue;
      best = c;
      nearest = d;
    }
    return best;
  }

  /** Drop a finished rescue/assist and send the escort back to reform on the screen. */
  endTask(s: Any): void {
    s.rescue = null;
    s.assist = null;
    s.task = null;
    this.rejoinScreen(s);
  }

  /** Record why an alongside ended, then send the escort back to the screen. */
  recordAssistAbort(s: Any, left: Any): void {
    s.assistAbort = left;
    if (left.reason === "torpedo threat detected") {
      this.say("BATTLE CONTROL", `${s.name} breaks off alongside — torpedo threat.`, true);
    }
    s.assist = null;
    s.task = null;
    this.rejoinScreen(s);
  }

  rejoinScreen(s: Any): void {
    const group = this.surfaceGroups.find((gr) => gr.id === s.groupId);
    if (group) group.reform = true;
  }

  /**
   * One surface ship's helm for this frame. The guide holds the group's course, routed clear of the
   * atoll and reef by `formation.groupCourse`; every other hull steers onto its station in the
   * guide's moving frame with `naval.steerToStation`, and a ship whose evasion has just ended arcs
   * back with `naval.rejoinCourse` rather than snapping. `naval.courseAuthority` decides who owns
   * the course, so no ship overwrites another's. Applies heading and speed; `updateShips` moves.
   */
  steerSurface(s: Any, dt: number, surface: Any[], hazards: IHazard[]): void {
    const now = this.time;
    s.task ??= { task: "station", targetId: null, startedAt: now, reason: "station keeping" };
    // Survival outranks station keeping, so a torpedo evasion is expressed as a withdraw task and
    // skips the helm below. It is an emergency, not a commitment: it ends with the evasion, so the
    // ship rejoins at once instead of running on through `COMMIT_SECONDS`.
    const survival = (s.evadeUntil || 0) > now;
    if (!survival && s.task.task === "withdraw") s.task = null;
    const chosen = chooseTask(
      { task: s.task },
      { survival, taskFeasible: true, opportunity: null, stationFeasible: true },
      now,
    );
    const detaching = chosen?.task === "withdraw";
    if (chosen) {
      s.task = {
        task: chosen.task,
        targetId: chosen.targetId,
        startedAt: s.task && s.task.task === chosen.task ? s.task.startedAt : now,
        reason: chosen.reason,
      };
    }
    if (s.wasEvading && !detaching) {
      s.rejoinUntil = now + REJOIN_SECONDS;
      const g = this.surfaceGroups.find((gr) => gr.id === s.groupId);
      if (g) g.reform = true;
    }
    s.wasEvading = detaching;
    if (detaching) return; // `updateEvasion` already owns the heading and the base speed stands.

    const group = this.surfaceGroups.find((gr) => gr.id === s.groupId);
    const base = s.baseSpeed * (0.35 + 0.65 * s.engine);
    const limits: ISteerLimits = {
      maxSpeed: base || 1,
      turnRate: s.kind === "carrier" ? CARRIER_TURN : ESCORT_TURN,
      slowRadius: STATION_SLOW_RADIUS,
    };
    let heading = s.heading;
    let speed = base;

    const rescueGroup = s.rescue ? this.survivors.find((g: Any) => g.id === s.rescue.targetId) : null;
    const assistCarrier = s.assist ? this.byId(s.assist.carrierId) : null;
    if (rescueGroup) {
      // Bear down on the boatload; `steerToStation` bleeds speed off inside its slow radius, which
      // is what lets `stepRescue` recover people once the ship is close and slow.
      const steer = steerToStation(s, { x: rescueGroup.x, z: rescueGroup.z }, dt, limits);
      heading = steer.heading;
      speed = steer.speed;
      s.cruiseHeading = heading;
    } else if (assistCarrier && !assistCarrier.sunk) {
      const station: FormationStation = {
        shipId: s.id,
        groupId: s.groupId,
        offsetX: (assistCarrier.hullBeam ?? 30) / 2 + 40,
        offsetZ: 0,
      };
      const alongside = stationTarget(assistCarrier.x, assistCarrier.z, assistCarrier.heading, station);
      const steer = steerToStation(s, alongside, dt, limits);
      heading = steer.heading;
      speed = steer.speed;
      s.cruiseHeading = heading;
    } else if (s.guide) {
      if (group) {
        const planned = groupCourse(
          group,
          { kind: "transit", course: this.supportCourse(group, s), speed: base, guideX: s.x, guideZ: s.z },
          hazards,
          { maxSpeed: base || 1, lookahead: GROUP_LOOKAHEAD, margin: GROUP_MARGIN, step: GROUP_STEP },
        );
        let course = planned.course;
        const authorityId = courseAuthority(
          { id: s.id, groupId: s.groupId, guide: true, evading: false },
          this.courseRecords(group, s.id),
        );
        if (authorityId) {
          const holder = this.byId(authorityId);
          if (holder && !holder.sunk) course = wrap(holder.heading);
        }
        group.course = course;
        group.speed = base;
        s.cruiseHeading = course;
        const ahead = { x: s.x + Math.sin(course) * GROUP_LOOKAHEAD, z: s.z - Math.cos(course) * GROUP_LOOKAHEAD };
        const steer = steerToStation(s, ahead, dt, { ...limits, slowRadius: GROUP_LOOKAHEAD * 0.5 });
        heading = steer.heading;
        speed = steer.speed;
      }
    } else if (s.station && group) {
      const guide = this.byId(group.guideId);
      if (guide && !guide.sunk) {
        let world = stationTarget(guide.x, guide.z, guide.heading, s.station as FormationStation);
        // Never station-keep into the reef: a station inside a hazard falls back to the ship's own
        // track until the group has routed clear.
        if (!clearOfHazard(world.x, world.z, hazards, 0)) {
          world = { x: s.x + Math.sin(s.heading) * 1000, z: s.z - Math.cos(s.heading) * 1000 };
        }
        const steer =
          s.rejoinUntil > now
            ? rejoinCourse(s, { x: world.x, z: world.z, dt }, limits)
            : steerToStation(s, world, dt, limits);
        heading = steer.heading;
        speed = steer.speed;
        s.cruiseHeading = heading;
      }
    }

    const others = this.avoidScratch;
    others.length = 0;
    for (const o of surface) if (o !== s) others.push(o);
    const avoid = avoidanceHeading(s, others, SURFACE_LOOKAHEAD, MIN_SEPARATION);
    if (avoid !== null) {
      const turn = limits.turnRate * dt;
      heading = wrap(heading + clamp(angleDelta(avoid, heading), -turn, turn));
    }
    s.heading = heading;
    s.speed = speed;
  }

  /** The course identities a group's authority is resolved against: living members only. */
  courseRecords(group: ISurfaceGroup, excludeId: string): ICourseShip[] {
    const out: ICourseShip[] = [];
    for (const id of group.memberIds) {
      if (id === excludeId) continue;
      const m = this.byId(id);
      if (!m || m.sunk) continue;
      out.push({ id: m.id, groupId: group.id, guide: !!m.guide, evading: (m.evadeUntil || 0) > this.time });
    }
    return out;
  }

  /** Put every member back on the station it held, through `formation.reformAfter`. */
  reformGroup(group: ISurfaceGroup): void {
    const disrupted = group.memberIds.map((id) => {
      const m = this.byId(id);
      return { id, slot: (m?.stationSlot as string | null) ?? null };
    });
    for (const a of reformAfter(group, disrupted, this.time)) {
      const m = this.byId(a.shipId);
      if (!m) continue;
      m.station = { shipId: a.shipId, groupId: group.id, offsetX: a.offsetX, offsetZ: a.offsetZ };
      m.stationSlot = a.slot;
    }
  }

  /** A ship by id; the group records name their members, so this is the one lookup. */
  byId(id: string): Any {
    return this.ships.find((s: Any) => s.id === id);
  }

  /**
   * The course a group's guide should steer. A normal screen holds its committed `cruiseHeading`;
   * a detached support group instead advances its own route — toward its destination, then its hold
   * anchor, and along its withdrawal bearing once its engine is damaged — with no carrier input.
   */
  supportCourse(group: ISurfaceGroup, guide: Any): number {
    const route = group.route;
    if (!route) return wrap(guide.cruiseHeading ?? guide.heading);
    // Any damaged member turns the whole group for home: the sisters retire together, taking their
    // hurt ship with them rather than leaving one to press on alone.
    const damaged = [group.guideId, ...group.memberIds].some((id) => {
      const m = this.byId(id);
      return m && !m.sunk && m.engine < SUPPORT_WITHDRAW_ENGINE;
    });
    if (damaged) return wrap(route.withdrawBearing);
    const toDestination = Math.hypot(guide.x - route.destination.x, guide.z - route.destination.z);
    if (toDestination > SUPPORT_APPROACH_RADIUS)
      return Math.atan2(route.destination.x - guide.x, -(route.destination.z - guide.z));
    const toHold = Math.hypot(guide.x - route.hold.x, guide.z - route.hold.z);
    if (toHold > SUPPORT_HOLD_RADIUS) return Math.atan2(route.hold.x - guide.x, -(route.hold.z - guide.z));
    return wrap(guide.heading);
  }

  /**
   * Form each team's surface escorts into carrier groups. The guide is the nearest carrier, decided
   * by position rather than name; the stations come from `formation.reformAfter`, so the offsets are
   * the module's tables, not a second copy. Pure data: nothing here moves a ship.
   */
  setupSurfaceGroups(): void {
    const surface = this.ships.filter((s: Any) => s.kind !== "sub");
    const carriers = surface.filter((s: Any) => s.kind === "carrier");
    this.surfaceGroups = carriers.map((guide: Any): ISurfaceGroup => ({
      id: `group-${guide.id}`,
      guideId: guide.id,
      memberIds: [],
      formationId: "screen",
      course: wrap(guide.heading),
      speed: guide.baseSpeed,
      coverageLost: 0,
      reform: false,
    }));
    for (const s of surface) {
      s.wasEvading = false;
      s.rejoinUntil = 0;
      s.task = { task: "station", targetId: null, startedAt: 0, reason: "station keeping" };
      // A marked support hull is left out of every carrier screen and picked up by
      // `setupSupportGroup` below; every other surface ship is assigned exactly as before.
      if (s.support) {
        s.groupId = null;
        s.guide = false;
        s.station = null;
        s.stationSlot = null;
        continue;
      }
      let best: ISurfaceGroup | null = null;
      let nearest = Infinity;
      for (const g of this.surfaceGroups) {
        const guide = this.byId(g.guideId);
        if (!guide || guide.team !== s.team) continue;
        const d = distance2(s, guide);
        if (d < nearest) {
          nearest = d;
          best = g;
        }
      }
      if (best && best.guideId !== s.id) {
        best.memberIds.push(s.id);
        s.groupId = best.id;
        s.guide = false;
      } else {
        s.groupId = best?.id ?? null;
        s.guide = true;
        s.station = null;
        s.stationSlot = null;
      }
    }
    // Build the detached support group before the shared station pass, so its members receive
    // stations through the same `reformAfter` table as every screen.
    this.setupSupportGroup(surface.filter((s: Any) => s.support));
    for (const group of this.surfaceGroups) {
      const assigned = reformAfter(group, group.memberIds.map((id) => ({ id, slot: null })), 0);
      for (const a of assigned) {
        const s = this.byId(a.shipId);
        if (!s) continue;
        s.station = { shipId: a.shipId, groupId: group.id, offsetX: a.offsetX, offsetZ: a.offsetZ };
        s.stationSlot = a.slot;
      }
    }
  }

  /**
   * One detached support group: its own guide and route, outside every carrier screen. The route is
   * plain data read by the guide's helm in `supportCourse`, so the group advances itself and a
   * carrier never steers it.
   */
  setupSupportGroup(ships: Any[]): void {
    if (!ships.length) return;
    const guide = ships[0];
    const group: ISurfaceGroup = {
      id: `group-${guide.id}`,
      guideId: guide.id,
      memberIds: [],
      formationId: "line-ahead",
      course: wrap(guide.heading),
      speed: guide.baseSpeed,
      coverageLost: 0,
      reform: false,
      route: {
        // Approach a standoff west of the atoll, hold there, and retire west if damaged. Its own
        // sector, between the two carrier forces and clear of the reef.
        destination: { x: -6200, z: 500 },
        hold: { x: -5600, z: 700 },
        withdrawBearing: -Math.PI / 2,
      },
    };
    guide.groupId = group.id;
    guide.guide = true;
    for (const s of ships.slice(1)) {
      s.groupId = group.id;
      s.guide = false;
      group.memberIds.push(s.id);
    }
    this.surfaceGroups.push(group);
  }

  /**
   * Put the player back on a flight deck ready to launch, from the same finite inventory as every
   * other aircraft. The post-recovery service completion and a downed replacement both route
   * through here. `replacement` is true for a fresh airframe: the deck run that follows `applyLaunch`
   * must not draw a second store, and a new aircraft starts with a full tank.
   */
  private resetPlayerForLaunch(h: Any, replacement: boolean): void {
    const p = this.player;
    // Re-arming on deck starts another sortie, so the calls that belong to one sortie re-arm with it:
    // the deck announcement before this launch, the sighting calls for the aircraft this trip meets,
    // and the run-in on the target. The contact report (R04/R05) stands — the fleet was told once.
    for (const k of ["r01", "r02", "r03", "r16", "p02"]) this.voiceFlags[k] = false;
    Object.assign(p, {
      home: h.id,
      // A fresh airframe carries none of the flight state of the one it replaces. Control-surface
      // deflections, attitude, body rates, pitch trim and the stability-assist toggle all survive on
      // the pilot's own record across a crash, so without this a replacement rolls or drifts down the
      // deck with no input — and the same reset covers the post-recovery rearm, which routes here too.
      heading: h.heading,
      pitch: 0.22,
      roll: 0,
      aileron: 0,
      elevator: 0,
      rudder: 0,
      controlAileron: 0,
      rollRate: 0,
      pitchRate: 0,
      yawRate: 0,
      trim: 0.04,
      assist: true,
      beta: 0,
      aoa: 0,
      stall: 0,
      gforce: 1,
      speed: 0,
      vy: 0,
      hp: 100,
      rearTimer: 0,
      bombs: 3,
      torpedo: 0,
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
      autopilot: false,
      nav: "search",
      engineCut: false,
      takeoffGrace: 0,
      launchAssist: 0,
      crashAge: 0,
      crashSettle: 0,
      divertNotice: false,
      gunner: false,
      gunnerYaw: 0,
      gunnerPitch: 0,
      gunnerPrevAutopilot: false,
      killCredited: false,
    });
    if (replacement) {
      // A fresh airframe inherits nothing from the one that went down: it draws its own full load
      // from the carrier's finite ammo store, or flies with empty guns if the store is dry.
      p.fuel = 0;
      p.ammo = 0;
      p.rearAmmo = 0;
    }
    applyLoadout(p, p.loadout || "bomb");
    // The player rearms out of the same finite stores as every other aircraft on the ship. With the
    // racks empty the aircraft still flies; it just has nothing to drop.
    const family = storeFamilyOf(p.airframe);
    const supplies = [];
    if (h.air) {
      const fuel = Math.min(Math.max(0, 100 - p.fuel), Math.max(0, h.air.fuel) * 100 / FUEL_PER_LAUNCH);
      p.fuel += fuel;
      h.air.fuel = Math.max(0, h.air.fuel - fuel * FUEL_PER_LAUNCH / 100);
      if (p.fuel < 100) supplies.push(`Fuel ${Math.floor(p.fuel)}% — carrier tanks exhausted.`);
      const rear = rearRoundsFor(p.airframe);
      if (p.ammo < 1400 || p.rearAmmo < rear) {
        if ((h.air.stores.ammo ?? 0) >= 1) {
          h.air.stores.ammo -= 1;
          p.ammo = 1400;
          p.rearAmmo = rear;
        } else supplies.push(replacement ? "No gun ammunition available." : "No gun ammunition available; remaining rounds retained.");
      }
      // A fresh gun is loaded from whatever the total holds; a rearm never creates rounds.
      initRearState(p);
      // A replacement's store was already drawn by `applyLaunch`, so only the service path draws it.
      if (!replacement) {
        if ((h.air.stores[family] ?? 0) > 0) {
          h.air.stores[family] -= 1;
        } else {
          p.bombs = 0;
          p.torpedo = 0;
          updateStores(p);
          supplies.push(`No ${family === "torpedo" ? "torpedoes" : "bombs"} left aboard. Racks empty.`);
        }
      }
    }
    this.playerFlight.setAirframe(p.airframe);
    initDamage(p);
    p.killCredited = false;
    this.playerFlight.reset();
    this.stats.sorties += 1;
    this.say("DECK CREW", `${supplies.length ? `Repairs complete. ${supplies.join(" ")}` : "Refueled, repaired and rearmed."} Takeoff flaps set. Advance power when ready.`, supplies.length > 0);
  }

  updatePlayer(dt: number, input: Any): void {
    const p = this.player;
    if (p.mode === "spectator") return;
    // Downed: the airframe is gone and the pilot waits for a replacement. The battle, the clock and
    // the AI keep running; the player takes no orders until `takeAnotherAircraft`. Losing the last
    // friendly carrier during the wait is a real defeat, not an indefinite pause.
    if (p.mode === "downed") return;
    if (p.mode === "crashing") {
      this.updateCrash(dt);
      return;
    }
    if (p.mode === "wreck") {
      this.updateWreck(dt);
      return;
    }
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
        this.losePlayerAircraft("The carrier was destroyed during recovery.");
        return;
      }
      p.serviceTime -= dt;
      const f = forward(h.heading);
      p.x = h.x + f.x * -105;
      p.z = h.z + f.z * -105;
      // Hold the aircraft on the deck it actually recovered onto: a fleet-wide height floated a
      // diversion to the lower Yorktown deck 7.8 m above it, exactly the class of error AC-6 exists
      // to catch. The arrestment uses this same clearance.
      p.y = h.deckHeight + gearClearance(p);
      p.speed = 0;
      setAttitude(p, h.heading, 0.22, 0);
      if (p.serviceTime <= 0) {
        this.resetPlayerForLaunch(h, false);
        if (this.sortie.assignment === "operation" && !this.sortie.result) {
          // Open Pacific ends on its own conditions, not on one neutralized deck: full success needs
          // the threats resolved and the fleet able to fly, and the conclusion is frozen once.
          const outcome = operationOutcome(this.operationWorld(), this.time);
          if (outcome.state === "success") {
            this.reason = outcomeText(concludeOperation(this.sortie, outcome, this.time));
            this.status = "won";
          } else if (outcome.state === "running") {
            this.say("BATTLE CONTROL", `Open Pacific continues: ${outcome.reason}.`, true);
          }
        }
      }
      return;
    }
    if (p.mode === "arrest") {
      if (!h || h.sunk || h.deck < DECK_FAILED) {
        this.losePlayerAircraft("The carrier deck failed during arrestment.");
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
        this.losePlayerAircraft("The arresting run overran the bow. Touch down farther aft and slower.");
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
        this.losePlayerAircraft("Your carrier can no longer launch aircraft.");
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
        if (departure === "liftoff") {
          this.say("ENTERPRISE TOWER", "Positive climb, Scout Two. Gear retracts after a safe climb; G overrides it. N cycles flap settings. Build speed before turning.");
          // Scout Three was held on deck until this moment; he rolls and joins as the player climbs.
          this.say("SCOUT THREE", "Two, we have your wing. Orders on your command.");
        } else this.say("SCOUT THREE", "Off the deck. Watch your airspeed — do not haul back on the stick.", true);
      }
      return;
    }
    if (p.mode !== "flight") return;
    // The AI rear gunner works the gun only while the player is flying the aircraft. Manning the
    // station takes the gun over with no second trigger and no double fire.
    if (!p.gunner) rearGunner(this, p, dt);
    const controls = p.gunner ? { autopilot: true, turn: 0, pitch: 0, rudder: 0 } : { ...input };
    if (p.launchAssist > 0) {
      p.launchAssist -= dt;
      if (!input.pitch && !input.turn && !p.autopilot && p.assist) {
        const climb = 3.5 * clamp(((p.ias || p.speed) - 43) / 9, 0, 1);
        controls.pitch = clamp((climb - p.vy) * 0.032, -0.12, 0.08);
        controls.autopilot = true;
      }
    }
    if (!p.gunner && p.autopilot && (Math.abs(input.turn || 0) > 0.25 || Math.abs(input.pitch || 0) > 0.25 || Math.abs(input.rudder || 0) > 0.25)) {
      p.autopilot = false;
      p.landingAssist = null;
      this.event("notice", { text: "COURSE HOLD DISENGAGED — YOU HAVE CONTROL" });
    }
    if (p.autopilot) {
      const nav = this.navigationPoint;
      let finalBank: number | undefined;
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
          // Brake lateral motion before reaching the centreline. Chasing a shrinking lookahead
          // point oscillated across the narrow deck even while the HUD still promised a final.
          const lateralSpeed = p.vx * Math.cos(s.heading) + p.vz * Math.sin(s.heading);
          finalBank = clamp((-loc.right * 0.1 - lateralSpeed) * 0.1, -0.3, 0.3);
          // The glide path aims at the deck and keeps descending through it, because an assist that
          // levels at deck height never touches: it floats the length of the ship and off the bow.
          const touch = s.deckHeight + gearClearance(p) - 3;
          desiredAlt = touch + Math.max(0, -loc.forward - GROOVE_FLARE) * GLIDE;
          // The assist configures the aircraft like the pilot would: gear, full flaps, brakes in —
          // and each actuator movement sounds, on its travel edge only, like the manual keys do.
          if (!p.gear) {
            p.gear = true;
            this.event("gear");
          }
          if (p.flaps !== 1) {
            p.flaps = 1;
            this.event("flap");
          }
          if (p.brakes) {
            p.brakes = false;
            this.event("flap");
          }
          p.throttle = clamp(0.59 + (50 - (p.ias || p.speed)) * 0.027, 0.12, 0.98);
          if (loc.forward > s.deckLength / 2 - 10) {
            // A bolter goes round again on the same guidance. Handing back an unattended aircraft
            // or keeping a low miss on final descent both turn a missed wire into a ditching.
            p.landingAssist = null;
            p.nav = "home";
            p.throttle = 1;
            finalBank = undefined;
            desiredAlt = this.approach().altitude;
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
          if (!p.gear) {
            p.gear = true;
            this.event("gear");
          }
          p.autoGearPending = false;
          if (p.flaps !== 1) {
            p.flaps = 1;
            this.event("flap");
          }
          if (p.brakes) {
            p.brakes = false;
            this.event("flap");
          }
          p.throttle = clamp(0.55 + (APPROACH_SPEED - (p.ias || p.speed)) * 0.025, 0.15, 0.95);
        } else {
          p.brakes = false;
          p.throttle = clamp(0.78 + (CRUISE_SPEED - (p.ias || p.speed)) * 0.012, 0.4, 1);
        }
        // Whatever the phase, never hold a stalled aircraft at approach power.
        if ((p.stall ?? 0) > 0.25 || (p.ias ?? p.speed) < 42) p.throttle = 1;
      }
      if (p.autopilot) {
        const desiredBank = finalBank ?? clamp(angleDelta(bearing(p, nav), p.heading) * 0.9, -0.62, 0.62);
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
        this.event("gear");
        this.event("notice", { text: "POSITIVE CLIMB — GEAR RETRACTING · G FOR MANUAL CONTROL" });
      }
    }
    if (p.takeoffGrace > 0) p.takeoffGrace -= dt;
    if (p.gunner) {
      // Aim and fire are the rear station's only commands; they never touch the forward guns, the
      // throttle or the autopilot the AI pilot is flying. The cooldown is advanced by the shared
      // firing path on every tick, so a released trigger does not freeze it.
      this.aimRear((input.aimYaw || 0) * REAR_GUN_YAW_RATE * dt, (input.aimPitch || 0) * REAR_GUN_PITCH_RATE * dt);
      fireRearManual(this, p, this.gunnerAim(), input.fire === true, dt);
    } else if (input.fire) {
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
        this.crashPlayer("Structural failure. Reduce airspeed and use gentler control inputs.");
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
          this.losePlayerAircraft("Hard deck impact. Lower gear, align from astern, keep wings level and reduce descent below 1,000 ft/min.");
          return;
        }
        if (p.y < s.deckHeight) {
          this.losePlayerAircraft("Impact with the carrier. Fly the approach from astern.");
          return;
        }
      }
    }
    if (p.y < 1.1) {
      this.losePlayerAircraft("Your aircraft ditched in the Pacific. Unload the wing and regain airspeed before pulling up.");
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
    this.leaveGunnerStation();
    // Wheels thump onto the planks first, then the hook grabs a wire: two cues, in order.
    this.event("land", { wire: false });
    this.event("land", { wire: true });
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
    this.leaveGunnerStation();
    this.score += 200;
    if (isShort(this.sortie) && !this.sortie.result) {
      this.sortie.result = this.snapshotResult("recovered", s);
      this.reason = outcomeText(this.sortie.result);
      this.status = "debrief";
      this.say("LANDING SIGNAL OFFICER", "Aboard and safe. That is the sortie.", true);
      return;
    }
    if (this.sortie.assignment === "operation" && !this.sortie.result) {
      // Recovering is the crew's explicit choice to end Open Pacific; the pure end conditions decide
      // whether that choice is a win, and one conclusion freezes exactly one record.
      const outcome = operationOutcome(this.operationWorld(), this.time);
      if (outcome.state === "success") {
        this.reason = outcomeText(concludeOperation(this.sortie, outcome, this.time));
      }
    }
    this.say("DECK CREW", "Welcome aboard. Fuel, ammunition and repairs are under way.", true);
  }

  /**
   * Open Pacific's own clock. The pure end condition still supplies the defeat reasons and the
   * running explanation; victory itself is the all-ships check in `step`, because a flight deck
   * neutralized is not a war won and the campaign may be flown under any briefing assignment.
   * `concludeOperation` freezes exactly one result record, so a second tick can never rewrite it.
   */
  updateOperation(): void {
    if (this.sortie.assignment !== "operation" || this.sortie.result) return;
    const outcome = operationOutcome(this.operationWorld(), this.time);
    if (outcome.state === "defeat") this.lose(outcome.reason);
  }

  assistRecovery(): boolean {
    const p = this.player;
    const s = this.recoveryCarrier;
    if (s && finalReady(p, s)) {
      p.home = s.id;
      p.landingAssist = s.id;
      p.autopilot = true;
      p.nav = "home";
      if (p.flaps !== 1) {
        p.flaps = 1;
        this.event("flap");
      }
      this.say("LSO", "Final approach assist engaged. Stay ready to take over. Any stick input cancels.");
      this.voice("R21", { identity: s.id });
      return true;
    }
    const cues = this.approach().cues;
    this.event("notice", { text: `FINAL ASSIST: ${cues.length ? cues.join(" · ") : "UNAVAILABLE"}` });
    return false;
  }

  updateAircraft(dt: number): void {
    // `updateTacticalAircraft` filters the roster in place, but a removed aircraft is still a
    // reference on the array we handed in. Reading that same array back is how a splash that
    // happened deep in the tactical layer becomes a minimap ping without a second removal path.
    const roster = this.aircraft;
    updateTacticalAircraft(this, dt);
    for (const a of roster) if (a.removed) this.wrecks.push(wreckMarker(a.x, a.z, a.team));
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

  /**
   * Put a torpedo in the water. Every running figure — speed, range, running depth and arming
   * distance — comes from the launcher's own variant in ./armament.ts: an aircraft by its airframe
   * (a TBD carries a Mark 13, a Kate a Type 91), a boat by its side (a US submarine a Mark 14, IJN
   * torpedoes a Type 95). The release stamp in `a.stamp` is copied through untouched, as is the
   * `owner`, so `./sortie.ts` credit can neither be granted nor revoked later.
   */
  spawnTorpedo(a: Any, heading: number, options: Any = {}): Any {
    const variant =
      a.kind === "sub"
        ? torpedoVariant(a.team === "jp" ? "type95" : "mk14")
        : torpedoVariantForAirframe(a.airframe) ?? torpedoVariant(a.team === "jp" ? "type91" : "mk13");
    const setting = variant.settings[0];
    const runDepth = actualRunDepth(variant.id, options.depth ?? variant.runDepth.min);
    const f = forward(heading);
    const t: Any = {
      id: this.id("torpedo"),
      variantId: variant.id,
      x: a.x,
      y: -runDepth,
      z: a.z,
      heading,
      runDepth,
      vx: f.x * setting.speed,
      vz: f.z * setting.speed,
      speed: setting.speed,
      range: setting.range,
      team: a.team,
      owner: a.owner || a.id,
      stamp: a.stamp ?? null,
      age: 0,
      ttl: options.aerial ? 240 : 200,
      distanceRun: 0,
      armedAt: null,
      armedDistance: variant.armingDistance,
    };
    this.torpedoes.push(t);
    return t;
  }

  updateWeapons(dt: number): void {
    const planes = this.planesScratch;
    planes.length = 0;
    for (const a of this.aircraft) planes.push(a);
    if (this.player.mode === "flight") planes.push(this.player);
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
      if (!nearest && this.player.mode === "flight" && b.owner !== "player" && distance3(this.player, b) < 22) {
        this.event("bulletNear", { at: { x: b.x, y: b.y, z: b.z } });
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
            // Ordinary strafing reaches a boat only inside the shallow blast band; a deep hull is
            // missed outright rather than sharing a surface ship's damage rectangle.
            const scale = s.kind === "sub" && s.sub ? strafeDamage(s.sub, 0) : 1;
            if (scale <= 0) continue;
            this.damageShip(s, 0.7 * scale, at, "strafe", b.team, { owner: b.owner });
            // A round clanging on steel is an impact cue, not the player's own damage. The HUD
            // flashes on "damage", so a strafe hit on any hull must carry the impact event instead.
            this.event("hit", { distance: distance3(this.player, at), at: { x: at.x, y: at.y, z: at.z }, material: "steel" });
            b.ttl = 0;
            break;
          }
        }
      }
      if (b.y <= 0) {
        if (this.random() < 0.4) this.fx("splash", b, 0.18);
        if (distance3(this.player, b) < 180) this.event("splash", { distance: distance3(this.player, b), at: { x: b.x, y: 0, z: b.z }, fragments: true });
        b.ttl = 0;
      }
    }
    let liveBullets = 0;
    for (let i = 0; i < this.bullets.length; i += 1) {
      const b = this.bullets[i];
      if (b.ttl > 0) this.bullets[liveBullets++] = b;
    }
    if (liveBullets > 850) {
      const drop = liveBullets - 850;
      for (let i = drop; i < liveBullets; i += 1) this.bullets[i - drop] = this.bullets[i];
      liveBullets = 850;
    }
    this.bullets.length = liveBullets;
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
            // A boat below the shallow blast band is not reached by a bomb that bursts on the
            // surface: `strafeDamage` returns zero, so the bomb is a miss and the water takes it.
            if (s.kind === "sub" && strafeDamage(s.sub, 0) <= 0) continue;
            hit = s;
            point = at;
            break;
          }
        }
      }
      if (hit) {
        const scale = hit.kind === "sub" ? strafeDamage(hit.sub, 0) : 1;
        this.damageShip(hit, (b.damage || 155) * scale, point, "bomb", b.team, { owner: b.owner, stamp: b.stamp });
        b.dead = true;
      } else if (b.y <= 0) {
        // A bomb that lands on the atoll hits the one facility it fell on — the radar's hit never
        // touches the runway. Midway is American, so only a hostile weapon does any damage.
        const facility = b.team === "jp" ? this.facilityAt(b) : null;
        if (facility) {
          this.hitFacility(facility, (b.damage || 155) / 155, b);
        } else {
          // A heavy bomb that misses the hull is fused to burst under the surface, not on it. The
          // sea is what the crew hears and sees: a deep concussion first, the column a moment later.
          this.fx("splash", b, 3.5, true);
          this.event("splash", { distance: distance3(this.player, b), at: { x: b.x, y: b.y, z: b.z }, material: "underwater" });
          for (const s of this.ships) {
            const l = localPoint(b, s);
            const d = Math.hypot(Math.max(0, Math.abs(l.right) - s.hullBeam / 2), Math.max(0, Math.abs(l.forward) - s.hullLength / 2));
            // A near miss reaches a boat only as far as the same shallow band does.
            const scale = s.kind === "sub" && s.sub ? strafeDamage(s.sub, 0) : 1;
            if (d < 55 && !s.sunk && scale > 0)
              this.damageShip(s, (b.damage || 155) * 0.4 * (1 - d / 55) * scale, b, "bomb", b.team, { owner: b.owner, nearMiss: true, stamp: b.stamp });
          }
        }
        b.dead = true;
      }
      if (b.age > 80) b.dead = true;
    }
    let liveBombs = 0;
    for (let i = 0; i < this.bombs.length; i += 1) {
      const b = this.bombs[i];
      if (!b.dead) this.bombs[liveBombs++] = b;
    }
    this.bombs.length = liveBombs;
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
        this.event("splash", { distance: distance3(this.player, entry), at: { x: entry.x, y: 0, z: entry.z }, outcome: "torpedoEntry" });
        if (t.safe) {
          this.spawnTorpedo(entry, Math.atan2(t.vx, -t.vz), { aerial: true });
          if (t.owner === "player") this.event("notice", { text: "TORPEDO RUNNING — STRAIGHT COURSE / ARMING" });
        } else if (t.owner === "player") this.event("notice", { text: "TORPEDO BROKE UP ON ENTRY — CHECK HEIGHT / SPEED / BANK" });
        t.dead = true;
      }
      if (t.age > 35) t.dead = true;
    }
    let liveAirTorpedoes = 0;
    for (let i = 0; i < this.airTorpedoes.length; i += 1) {
      const t = this.airTorpedoes[i];
      if (!t.dead) this.airTorpedoes[liveAirTorpedoes++] = t;
    }
    this.airTorpedoes.length = liveAirTorpedoes;
    for (const t of this.torpedoes) {
      const prev = { x: t.x, z: t.z };
      // ./torpedo-run.ts advances the run: straight at the variant's speed, armed at its arming
      // distance, stopped at its range. Depth is the weapon's own; keep it in step with `y` before
      // the hit test so a run set deeper than a hull draws passes under it.
      Object.assign(t, stepRun(t, dt));
      t.runDepth = -t.y;
      t.age += dt;
      t.ttl -= dt;
      // One depth-aware screening test for the whole step: a shallow escort is passed under by a
      // deeper-running weapon, which then carries on to the first hull it can actually reach. The
      // run's own side never screens it, or a boat would detonate on its own hull at launch.
      const hitId = screenIntercept(t, prev, this.ships, null, dt, t.team);
      if (!hitId) continue;
      const s = this.ships.find((ship: Any) => ship.id === hitId);
      if (!s) continue;
      const impact = { x: t.x, y: 2, z: t.z };
      if (t.armedAt !== null)
        this.damageShip(s, 145, impact, "torpedo", t.team, { owner: t.owner, stamp: t.stamp });
      else this.fx("splash", impact, 0.7);
      t.ttl = 0;
    }
    let liveTorpedoes = 0;
    for (let i = 0; i < this.torpedoes.length; i += 1) {
      const t = this.torpedoes[i];
      if (t.ttl > 0) this.torpedoes[liveTorpedoes++] = t;
    }
    this.torpedoes.length = liveTorpedoes;
  }

  /**
   * The player's own eyes, a scout close enough over a hull to identify it, and a strike crew with its
   * target in sight. Detection by radius that copied a live ship's name, course and exact deck health
   * into both sides' knowledge is gone: every other observer files a dated, range-classified, delayed
   * report in `observeFleet`, and the AI reads nothing else. A crew looking straight at the hull it is
   * attacking still holds that sighting itself, though — it does not wait on the fleet's radio net —
   * so the observation is recorded at once and a hit the crew watched land can be confirmed.
   */
  updateIntel(): void {
    const p = this.player;
    for (const s of this.ships) {
      if (s.team === "us" || (s.kind === "sub" && !s.surfaced)) continue;
      const d = distance2(s, p);
      const angle = Math.abs(angleDelta(bearing(p, s), p.heading));
      const visualRange = clamp(2900 + p.y * 1.8, 2900, 6200);
      const byPlayer = p.mode === "flight" && d < visualRange && (angle < 1.45 || d < 1300);
      const byRecon = !byPlayer && this.aircraft.some((a) => a.team === "us" && a.kind === "recon" && distance2(a, s) < 4300);
      const seen =
        byPlayer ||
        byRecon ||
        this.aircraft.some((a) => a.team === "us" && a.wing && a.hp > 0 && a.target === s.id && distance2(a, s) < 4300);
      if (s.sunk) {
        // Match the visible sinking hull's lifetime; visiting its submerged position proves nothing.
        if (seen && s.sink < 0.95 && !this.contacts.get(s.id)?.sunk)
          this.recordContact(s, byPlayer ? "visual" : byRecon ? "PBY reconnaissance" : "aircraft visual");
        continue;
      }
      if (byPlayer) this.recordContact(s);
      else if (byRecon) {
        const was = this.contacts.has(s.id);
        this.recordContact(s, "PBY reconnaissance");
        if (!was && s.kind === "carrier") this.say("CATALINA FIVE", `Carrier contact northwest. ${s.name} sighted. Position entered on your intelligence map.`, true);
      } else if (seen) this.recordContact(s, "aircraft visual");
    }
  }

  /**
   * Whether the simulation may run at 3x.
   *
   * Simulation-only: the caller runs extra fixed steps and nothing else changes — not thrust, not
   * the camera, not animation rates, not audio. Gated so a fight can never be fast-forwarded:
   * level flight above 120 m, undamaged, no enemy aircraft within 2400 m and no enemy ship within
   * 2800 m.
   */
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
