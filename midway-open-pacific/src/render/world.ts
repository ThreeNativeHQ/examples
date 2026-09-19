/** The battle's Three.js world, built into the scene the framework owns. */
import * as T from "three";
import { shipClass } from "../sim/catalog.js";
import { REAR_RELOAD_SECONDS } from "../sim/armament.js";
import { axesOf } from "../sim/flight.js";
import { distance2, forward, localPoint } from "../sim/math.js";
import { addFloats, ellipsoid, mat, wakeTexture } from "./assets.js";
import type { IViewSnapshot } from "../ui/hud-input.js";
import { type CarrierModelId, createCarrier, createIjnCarrier, createMitchell, shipModelFor } from "./imported-ships.js";
import { createAirframe, createDouglas, animateDouglas, animateImportedAirframe, disposeAirframe, spinPropeller } from "./imported-aircraft.js";
import { airframeLod } from "./airframe-lod.js";
import { createMidwayAtoll, createZero } from "./imported-fleet.js";
import { DeckCrew } from "./deck-crew.js";
import { animateDevastator, disposeDevastator } from "./devastator.js";
import { createRearStation, type RearStation } from "./rear-station.js";
import { addDamageVisuals, makeTorpedoModel, updateDamageVisuals, updateShipScars } from "./model-damage.js";
import { dawnEnvironment, SKY_ROTATION, SUN_DIRECTION, SUN_COLOR } from "./environment.js";
import { createOcean, REFLECTED_LAYER } from "./ocean.js";
import { CombatParticles } from "./particles.js";
import { createRipples } from "./ripples.js";
import { shipMotion, submarineMotion } from "./ship-motion.js";

/**
 * The real airframe drawn for an AI aircraft. Every battle type maps to a shipped model — no
 * procedural stand-ins anywhere in the scene. Where the project has no source asset for the exact
 * type, the closest same-team carrier aircraft stands in rather than a grey silhouette: the
 * Wildcat parks and flies as the Douglas SBD (US single-engine naval), the Val as the Nakajima
 * Kate (Japanese bomber), and the TBD flies its detailed ported Devastator. Scouts are
 * float-fitted Kates, the catapult type the cruisers actually carried.
 */
function douglas(): T.Group {
  const model = createDouglas();
  model.userData.douglas = true;
  return model;
}

function importedAircraftFor(a: { team: string; kind: string }): () => T.Group {
  if (a.team === "jp" && a.kind === "fighter") return createZero;
  if (a.team === "us" && a.kind === "bomber") return douglas;
  if (a.team === "us" && a.kind === "fighter") return douglas;
  if (a.kind === "torpedo") return a.team === "jp" ? () => createAirframe("b5n2", "ai") : () => createAirframe("tbd1", "ai");
  if (a.team === "jp" && a.kind === "bomber") return () => createAirframe("b5n2", "ai");
  if (a.kind === "recon") return a.team === "jp" ? () => createAirframe("b5n2", "ai") : douglas;
  return a.team === "jp" ? createZero : douglas;
}

/** Reused so the per-frame camera orbit allocates nothing. */
const WORLD_UP = new T.Vector3(0, 1, 0);

/** The tracer ellipsoid's long axis, rotated onto each round's velocity every frame. */
const TRACER_LONG = new T.Vector3(0, 0, 1);

/**
 * Distance past which a hull's full imported detail stops paying.
 *
 * The three US carriers are the case: ~347k triangles and ~280–300 meshes each, stationed at
 * 17.5–18.8 km where the whole hull covers 9–13 px — and mirrored past the water's own far cut
 * (8 km, `FAR_RANGE` in ocean.ts), so their reflection is not sampled either. At 15 km every hull
 * gated here measured under ~16 px; see report-X2 for the ladder. Hiding rather than swapping to a
 * stand-in, because the game ships no reduced hull and at this size a second model would be the same
 * specks with another thing to keep in sync. Midway Atoll is not in `b.ships`, so it is never gated:
 * an 18 km horizon feature worth 7,520 readable pixels.
 */
const FAR_HULL = 15000;

/** Beyond this player range an aircraft is a sub-pixel point on the horizon (0 px measured at 17–18 km). */
const FAR_AIRCRAFT = 12000;

/**
 * The projected-diameter aircraft cull is now the engine's.
 *
 * It was `MIN_AIRCRAFT_PIXELS = 2`: an aircraft below two projected render-camera pixels was not
 * drawn. The engine owns that decision now — `renderer.minimumProjectedPixels: 2` in
 * `threenative.config.ts` keeps the line this game measured, the render camera applies it per camera
 * and it is reported in `TN_PROJECTION.cull`. What stays here is the two distance caps above and
 * below, which a projected-size gate cannot express: `FAR_AIRCRAFT` bounds where an aircraft may be
 * culled at all, and `FAR_HULL` hides a hull the 2 px line would still draw for another hundred
 * kilometres. `MERGED_AIRFRAME_PIXELS` below is a lower-draw substitution, not a skip, and the
 * engine's cull does not substitute.
 */

/**
 * The projected size, in render-camera pixels, below which an aircraft draws its merged stand-in.
 *
 * The engine's cull above stops drawing a speck; this one stops paying 22–95 draw submits for an
 * aircraft whose whole merged silhouette is a few tens of pixels across (see `airframe-lod.ts`).
 * Above the line the full airframe keeps every animated node and every material. The number itself
 * comes from the report-REC ladder: each rung's main draws and same-build pixel diff against a
 * control, read at the recovery approach, the cockpit, chase and wide views.
 */
const MERGED_AIRFRAME_PIXELS = 36;

/**
 * The line `MERGED_AIRFRAME_PIXELS` sets, with a runtime override for the report-REC A/B ladder.
 *
 * The ladder needs the merged variant on and off within one build, so its probes set
 * `globalThis.MIDWAY_MERGED_PIXELS`; 0 turns it off entirely and an absent value is the constant.
 * Verification only — the game never writes it.
 */
function mergedAirframePixels(): number {
  const raw = (globalThis as { MIDWAY_MERGED_PIXELS?: unknown }).MIDWAY_MERGED_PIXELS;
  if (raw === undefined || raw === null) return MERGED_AIRFRAME_PIXELS;
  const override = Number(raw);
  return Number.isFinite(override) ? override : MERGED_AIRFRAME_PIXELS;
}

/**
 * The projected size, in render-camera pixels, below which a hull draws its merged stand-in.
 *
 * `FAR_HULL` already hides a hull the camera cannot resolve at all; this is the wider line where the
 * hull is still a resolvable speck and a stand-in is indistinguishable, but one draw instead of a
 * hundred. The number comes from the report-HULL ladder against a same-build control; the shipped
 * rung is the conservative one, chosen with margin below the range a player identifies or attacks a
 * ship, not the largest saving. The near carrier the player lands on and any hull close enough to
 * attack are far above the line and keep full detail.
 */
const MERGED_HULL_PIXELS = 24;

/**
 * The line `MERGED_HULL_PIXELS` sets, with the same runtime override the airframe gate uses so the
 * ladder can move it inside one build. 0 turns the stand-in off; an absent value is the constant.
 * Verification only — the game never writes it.
 */
function mergedHullPixels(): number {
  const raw = (globalThis as { MIDWAY_HULL_PIXELS?: unknown }).MIDWAY_HULL_PIXELS;
  if (raw === undefined || raw === null) return MERGED_HULL_PIXELS;
  const override = Number(raw);
  return Number.isFinite(override) ? override : MERGED_HULL_PIXELS;
}

/**
 * Idle a parked aircraft's propeller. Every parked airframe is a real model now: the Devastator
 * through its own animator, the rest through the `propeller` pivot they all publish.
 */
function spinParked(m: T.Group, dt: number): void {
  if (m.userData.devastator) {
    animateDevastator(m, { rpm: 0.12 }, dt);
    return;
  }
  if (m.userData.douglas) {
    animateDouglas(m, { rpm: 0.12 }, dt);
    return;
  }
  if (m.userData.propeller) {
    spinPropeller(m, 0.12, dt);
  }
}

/**
 * The model each carrier is drawn with, and the catalog class that model was measured as. Its hull,
 * corridor and deck datum are already on the ship record, resolved by `Battle.setupFleet`; this view
 * only picks the geometry that matches them, and writes nothing back. Yorktown draws its own hull
 * rather than a second Hornet, because the simulation carries Yorktown's own hull and deck datum and
 * the two must agree.
 *
 * `classId` is present exactly where the hull is an imported one, and it is what sinks the model by
 * that class's draught: the importer bakes the keel on y = 0, so a hull left where it loads floats
 * with its whole anti-fouling band above the sea. The three supplied models have no class and are
 * not sunk, because they already bake the waterline at y = 0 — `tools/inspect-glb.mjs` measures
 * `hornet.glb` at min.y -4.14 and `akagi.glb` at -7.55, which is their draught, below it.
 */
const CARRIER_MODEL: Readonly<Record<string, { id: CarrierModelId; classId?: string; lod?: string }>> = {
  // `lod` names the shared model a stand-in is keyed by. The three Yorktown class carriers all draw
  // `hornet.glb`, so they build one merged hull between them instead of one 347k-triangle copy each.
  "USS Enterprise": { id: "enterprise", lod: "hornet" },
  "USS Hornet": { id: "hornet", lod: "hornet" },
  Akagi: { id: "akagi" },
  // No `classId`, deliberately: CV-5 is drawn from the supplied `hornet.glb` like her two sisters,
  // and that model bakes its waterline at y = 0 rather than its keel, so sinking it by a class
  // draught would put her 7.9 m under.
  "USS Yorktown": { id: "yorktown", lod: "hornet" },
  Kaga: { id: "kaga", classId: "kaga" },
  Soryu: { id: "soryu", classId: "soryu" },
  Hiryu: { id: "hiryu", classId: "hiryu" },
};

/** How far below the sea a hull's own keel sits: the class draught, or nothing where none applies. */
const draughtOf = (classId: string | undefined): number => (classId ? shipClass(classId).draught : 0);

/**
 * The catalog class each non-carrier ship belongs to, so the imported hull can stand in for the
 * procedural silhouette at close range. Carriers are absent because the branch below already
 * resolves their own models, which reach the same catalog hulls through `createCarrier` and
 * `createIjnCarrier` — and only a carrier has a deck park and a `DECKS` corridor to key off.
 * Every other ship in the battle names its class below; anything new falls back to a same-team
 * hull of its kind through `FALLBACK_HULL_BY_KIND` rather than drawing a procedural silhouette.
 * Arashi and Nowaki were Kagero class and `src/sim/catalog.ts` sizes them as Kagero, so they take
 * that hull rather than the Shiratsuyu-class Samidare the view used to draw for any IJN
 * destroyer: the Samidare measures 111 m against the 118.5 m the simulation gives these two, so
 * the substitution also drew a hull 7.5 m shorter than its own collision volume.
 *
 * Northampton, Phelps and Balch have no supplied model, so they borrow same-team hulls rather
 * than drawing procedural silhouettes: the heavy cruiser takes the Tone hull, the two destroyers
 * the Hammann hull. A borrowed real hull at the wrong masthead beats a grey box at the right one.
 */
const HULL_CLASS_BY_NAME: Readonly<Record<string, string>> = {
  Tone: "tone",
  Chikuma: "tone", // Tone class; the two sisters were near-identical at Midway
  Mogami: "mogami",
  Mikuma: "mogami", // Mogami class; the derived hull is the only one that flies it
  Arashi: "kagero",
  Nowaki: "kagero",
  "USS Hammann": "hammann",
  "USS Phelps": "hammann", // Sims-class destroyer; no model supplied, same-team stand-in
  "USS Balch": "hammann", // Porter-class destroyer; no model supplied, same-team stand-in
  "USS Northampton": "tone", // Northampton-class heavy cruiser; no model supplied, cruiser stand-in
  "I-168": "i168",
  "USS Nautilus": "nautilus",
};

/**
 * Same-team hull a ship borrows when it names no class above. This is what keeps a ship the
 * roster adds tomorrow from ever drawing a procedural silhouette: a borrowed real hull of its
 * own kind and team, never a grey box.
 */
const FALLBACK_HULL_BY_KIND: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  us: { cruiser: "tone", destroyer: "hammann", sub: "nautilus" },
  jp: { cruiser: "tone", destroyer: "kagero", sub: "i168" },
};

/**
 * Put one object and everything under it in the water's reflection.
 *
 * `enable` adds the layer rather than replacing layer 0, so the main camera still draws these
 * exactly as before; the only camera that narrows is the mirrored pass's. What is marked is the
 * hulls and the atoll — the shapes a player reads in the water. Aircraft, the deck party, tracers,
 * spray and the parked deck load are deliberately left out: in the mirror they are a few pixels
 * each, and the second draw of sixty-eight of them is what put AC-23's frame over budget.
 *
 * A ship's deck crew is added to its mesh later and inherits nothing, because layers are per
 * object and this runs once at build time — which is the intent, not an oversight.
 */
function markReflected(root: T.Object3D): void {
  root.traverse((o) => o.layers.enable(REFLECTED_LAYER));
}

/**
 * A node whose own local matrix is rewritten after creation, or that carries an unnamed moving
 * child (the SBD gear legs), so it and its whole subtree must keep `matrixAutoUpdate`. Matched
 * case-insensitively as substrings. Everything else under a frozen root is composed once and then
 * never again; a node whose parent moves stays correct because Three forces the parent's matrix
 * down through the children.
 */
const MOVING_NODE = /threenativepivot|cockpit controls|propeller|aileron|rudder|flap|elevator|gear|wingport|wingstarboard|canopy|torpedo|hook|wheel|crew|gunner/i;

/** Scratch for one scout's seat on its ship, refilled per scout. */
const SCOUT_SEAT = new T.Vector3();
/** Where a flying scout is drawn. `SCOUT_ALTITUDE` in the simulation is its observation height. */
const SCOUT_DRAW_ALTITUDE = 2000;

/**
 * The parked deck load, by the simulation's own airframe name.
 *
 * The park is a bounded sample of the same `s.air.ready` inventory the launch gate spends, not a
 * second air count: one instance per airframe a ship actually carries. Every type is a real model
 * — the Wildcat stands in as the Douglas SBD and the Val as the Kate, the same substitutions the
 * AI flight path uses. The id is explicit so no team/kind guess can park a B-25 or an enemy type
 * on a deck.
 */
const PARK_FACTORY: Readonly<Record<string, () => T.Group>> = {
  wildcat: () => createAirframe("sbd3", "ai"),
  sbd: () => createAirframe("sbd3", "ai"),
  tbd: () => createAirframe("tbd1", "ai"),
  zero: () => createAirframe("a6m3", "ai"),
  val: () => createAirframe("b5n2", "ai"),
  kate: () => createAirframe("b5n2", "ai"),
};

/**
 * How far a parked airframe's origin stands above its wheel contact, in metres.
 *
 * The Kate's wheels land on y = 0 out of the import contract, so its root is the contact datum.
 * The others hang their gear below the origin: the Douglas main wheels reach -1.84 m
 * (`createDauntlessGear`: leg -0.3, wheel -1.19, radius 0.35), the Zero's reach -1.87 m
 * (`createZero`: wheel -1.55, radius 0.32), and the ported Devastator's rest on the same 1.82 m
 * datum the flight model's `gearClearance` assumes. A station adds this back so every type rests
 * on the same deck plane instead of sinking its undercarriage into it.
 */
const PARK_GROUND: Readonly<Record<string, number>> = {
  wildcat: 1.84,
  sbd: 1.84,
  tbd: 1.82,
  zero: 1.87,
  val: 0,
  kate: 0,
};

/**
 * One aft parking station per airframe, in ship-local metres.
 *
 * The park is spotted aft of the launch spot because the deck is narrow abeam and no aircraft is
 * drawn folded; a machine parked beside the launch lane hangs a wingtip over the sea. The three
 * stations are the row the old TBD park used, measured against the tightest deck edge
 * (`tools/capture-deck.mjs` finds port -10.6 m abreast z = 100): the widest parked airframe is the
 * Kate at 15.5 m, whose port tip at x = -1 reaches -8.75 m, 1.85 m inside the edge. Each airframe
 * has its own station so two types can never share a slot, and a carrier carries only its own
 * team's three, so the three slots are always distinct and 16 m apart in z.
 */
const PARK_STATION: Readonly<Record<string, number>> = {
  wildcat: 72,
  sbd: 88,
  tbd: 104,
  zero: 72,
  val: 88,
  kate: 104,
};

export interface IWorldHost {
  scene: T.Scene;
  camera: T.PerspectiveCamera;
  renderer: { raw: unknown };
  /** The engine's cached drawable size, updated by its resize observer — never a layout read. */
  viewport: { readonly size: { readonly width: number; readonly height: number } };
  add: (object: T.Object3D) => unknown;
}

export class WorldView {
  battle: any;
  host: IWorldHost;
  meshes = new Map<string, T.Object3D>();
  /** One drawn floatplane per cruiser scout, by the scout's own id. */
  scouts = new Map<string, T.Group>();
  fxMeshes = new Map<string, T.Object3D>();
  bombMeshes = new Map<string, T.Object3D>();
  torpMeshes = new Map<string, T.Object3D>();
  cameraMode = 0;
  rear = false;
  followBomb = false;
  /** True while the pilot view is the one being drawn. Read by the UI shell. */
  cockpitView = false;
  snap = true;
  quality = "balanced";
  wallTime = 0;
  scene: T.Scene;
  renderer: T.WebGLRenderer;
  camera: T.PerspectiveCamera;
  sun: T.DirectionalLight;
  sunDir: T.Vector3;
  wakeTex: T.Texture;
  ocean!: ReturnType<typeof createOcean>;
  sea!: T.Mesh;
  crew!: DeckCrew;
  playerMesh!: T.Group;
  /** Fixed eye point for the crash settle, chosen once at the moment of impact. */
  private wreckEye: T.Vector3 | null = null;
  /** Camera mode to restore when the player leaves the rear-gun station; null when not on the gun. */
  private gunnerPrevMode: number | null = null;
  /** Weapon-follow view state to restore on the same handback. */
  private gunnerPrevFollow = false;
  tracers!: T.InstancedMesh;
  // One instance of a unit sphere per round, stretched along its velocity: side-on a thin streak,
  // end-on a small round dot. A 1 px line seen down its own path — the player's own fire from the
  // cockpit or gunner — projects to nothing, and THREE.Points rasterizes zero fragments on the
  // WebGPU backend, so the round is a real head instead of a camera-facing cross. One pool, one
  // geometry and one draw; a frame only composes matrices and colours into them.
  private tracerMatrix = new T.Matrix4();
  private tracerQuat = new T.Quaternion();
  private tracerDir = new T.Vector3();
  private tracerPos = new T.Vector3();
  private tracerScale = new T.Vector3();
  private tracerTint = new T.Color();
  particles!: CombatParticles;
  ripples!: ReturnType<typeof createRipples>;
  private sky!: T.Texture;
  private surfaceFog!: T.FogExp2;
  private underwater = false;
  lookYaw = 0;
  lookPitch = 0;
  lookActive = false;
  crewAnchor = 15;
  private orbit = new T.Vector3();
  private orbitAxis = new T.Vector3();
  private tmp = new T.Vector3();
  private clip = new T.Matrix4();
  private look = new T.Vector3();
  private targetCamera = new T.Vector3();
  /** Composed-local-matrix freeze for static nodes, and the verification switch that reverses it. */
  freezeStatics = true;
  private frozen = new Set<T.Object3D>();

  constructor(host: IWorldHost, battle: any) {
    this.host = host;
    this.battle = battle;
    this.scene = host.scene;
    this.camera = host.camera;
    this.renderer = host.renderer.raw as T.WebGLRenderer;
    this.renderer.outputColorSpace = T.SRGBColorSpace;
    this.renderer.toneMapping = T.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.95;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = T.PCFShadowMap;
    this.surfaceFog = new T.FogExp2(new T.Color(0x8fa9b4).convertLinearToSRGB(), 0.000028);
    this.scene.fog = this.surfaceFog;
    // The reference used r140 legacy light units (PI brighter) and linear hex colours.
    const hemi = new T.HemisphereLight(0xb5cedd, 0x243745, 0.9);
    this.scene.add(hemi);
    this.freezeNode(hemi);
    this.sun = new T.DirectionalLight(SUN_COLOR, 2.6);
    this.sun.position.set(-200, 140, -240);
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    Object.assign(this.sun.shadow.camera, { left: -80, right: 80, top: 80, bottom: -80, near: 1, far: 850 });
    this.sun.shadow.bias = -0.000035;
    this.sun.shadow.normalBias = 0.018;
    this.sunDir = SUN_DIRECTION.clone();
    this.wakeTex = wakeTexture();
    this.makeSky();
    this.ripples = createRipples();
    this.scene.add(this.ripples.effects.group);
    this.freezeNode(this.ripples.effects.group);
    this.makeOcean();
    this.makeWorld();
    this.makeTracers();
    this.particles = new CombatParticles(this.scene);
    this.freezeNode(this.particles.smokeBatch.mesh);
    this.freezeNode(this.particles.glowBatch.mesh);
  }

  makeSky(): void {
    const sky = dawnEnvironment();
    this.sky = sky;
    this.scene.background = sky;
    this.scene.environment = sky;
    this.scene.backgroundRotation.copy(SKY_ROTATION);
    this.scene.environmentRotation.copy(SKY_ROTATION);
    this.scene.backgroundIntensity = 0.65;
    this.scene.environmentIntensity = 0.65;
  }

  makeOcean(): void {
    this.ocean = createOcean({ rippleHeight: this.ripples.heightNode, rippleNormal: this.ripples.normalNode, rippleFoam: this.ripples.foamNode, rippleFlow: this.ripples.flowNode });
    this.sea = this.ocean.mesh;
    this.scene.add(this.sea);
  }

  makeWorld(): void {
    const b = this.battle;
    for (const s of b.ships) {
      let mesh: T.Group;
      const classId = HULL_CLASS_BY_NAME[s.name] ?? FALLBACK_HULL_BY_KIND[s.team as string]?.[s.kind as string];
      if (classId) {
        const detailed = shipModelFor(classId);
        // The class creators name their lead ship; this is the sister actually being built.
        detailed.name = s.name;
        // Float it at its own waterline. The import contract lands the keel on y = 0, so an
        // imported hull drawn at the ship's own y shows its whole underwater body above the sea —
        // a destroyer standing on the water with its full anti-fouling band in daylight. A
        // submerged boat needs nothing further here: the wrapper already drops to y = -7 and
        // ocean.ts skips a dived boat's wake slot.
        detailed.position.y = -shipClass(classId).draught;
        mesh = new T.Group();
        mesh.add(detailed);
        mesh.userData.importedShip = true;
        this.addHullLod(mesh, detailed, classId);
      } else if (s.kind === "carrier") {
        const model = CARRIER_MODEL[s.name];
        const detailed = model ? createCarrier(model.id) : createIjnCarrier(s.name);
        // A carrier floats at its draught like everything else above. The reason it could not
        // before is that its flight deck is the one drawn surface the simulation also stands on:
        // the imported models are surveyed from the keel, so sinking the hull moves the drawn deck
        // away from a `deckHeight` measured in the same frame and recovery would touch down in mid
        // air. `CARRIER_DECKS` in src/sim/battle.ts now carries each imported deck datum in the
        // world's frame — the surveyed elevation less this same draught — so the two move together
        // and `sink` is the only place the two frames meet.
        const sink = draughtOf(model?.classId);
        detailed.position.y = -sink;
        mesh = new T.Group();
        mesh.add(detailed);
        mesh.userData.importedShip = true;
        mesh.userData.parked = [];
        mesh.userData.decor = [];
        // The stand-in is baked here, before the park and the decorative B-25 are added, so it never
        // carries them — they already hide past `camD < 1900`, and baking their spinning propellers
        // into a frozen far hull would draw the parked deck load at a range the park gate excludes.
        this.addHullLod(mesh, detailed, model?.lod ?? model?.classId ?? model?.id ?? s.name);
        // The park draws this ship's own ready inventory, one airframe per type it carries. A type
        // that leaves the ready line — launched, wrecked, written off — hides its own parked
        // aircraft and nothing else; the surviving types stay spotted. `ai` is the reduced build
        // where the airframe has one. `sink` is added back because the park is a child of the hull,
        // which has just been lowered by it, while `deckHeight` is in the world's frame.
        for (const type in PARK_STATION) {
          if ((s.air?.ready?.[type] ?? 0) <= 0) continue;
          const plane = PARK_FACTORY[type]();
          plane.userData.simAirframe = type;
          plane.position.set(-1, s.deckHeight + sink + PARK_GROUND[type], PARK_STATION[type]);
          detailed.add(plane);
          mesh.userData.parked.push(plane);
        }
        // A decorative B-25 on US decks, spotted aft of the park. Dressing only: no simAirframe,
        // never in `parked`, engines off. Ahistorical for June 1942 (Doolittle sailed in April).
        if (s.team === "us") {
          const mitchell = createMitchell();
          mitchell.position.set(-1, s.deckHeight + sink, 120);
          mitchell.userData.decorative = true;
          detailed.add(mitchell);
          mesh.userData.decor.push(mitchell);
        }
      } else {
        throw new Error(`no model for ship: ${s.name} (${s.team} ${s.kind})`);
      }
      // A cruiser that carries scouts gets one drawn floatplane per scout. The simulation has flown
      // these since the AC-11 wiring went in — launched from the catapult, searched a sector, filed
      // a report, come back alongside — and none of it was visible, because nothing in this folder
      // drew a scout at all. A capture of Tone showed her catapult empty while her scout sat aboard.
      // The scout is a float-fitted Kate, the catapult type these cruisers carried — a real model
      // with floats, never the procedural recon silhouette.
      if (s.scouts?.length) {
        for (const scout of s.scouts) {
          const plane = addFloats(createAirframe("b5n2", "ai"));
          plane.scale.setScalar(0.86);
          markReflected(plane);
          // Range-gated, so it starts out of the draw: the first world frame can be submitted
          // before any fixed-step update has run, and `placeScouts` is what turns it on.
          plane.visible = false;
          this.scene.add(plane);
          this.scouts.set(scout.id, plane);
        }
      }
      markReflected(mesh);
      // Parked aircraft are hull children, but the water reflection excludes the deck load.
      for (const planes of [mesh.userData.parked ?? [], mesh.userData.decor ?? []] as T.Object3D[][])
        for (const plane of planes) plane.traverse((o) => o.layers.disable(REFLECTED_LAYER));
      // Range-gated, and this hull has no position or visibility yet: the engine's fixed-step loop
      // can submit its first world frame with zero updates elapsed (the loop is released the frame
      // the loader clears), so a hull left at the default `visible = true` draws — at the origin —
      // for that one frame. `update` places it and applies the far-field gate from then on.
      mesh.visible = false;
      this.scene.add(mesh);
      this.meshes.set(s.id, mesh);
      this.freezeStatic(mesh);

    }
    this.crew = new DeckCrew();
    this.meshes.get(b.player.home)?.add(this.crew.group);
    const island = createMidwayAtoll();
    island.position.set(b.island.x, 0, b.island.z);
    markReflected(island);
    this.scene.add(island);
    this.freezeNode(island);
    this.setAirframe();
  }

  /**
   * The player airframes that have been built this session, by type.
   *
   * A switch used to dispose the aircraft and build the other one from scratch, which threw away
   * every pipeline WebGPU had compiled for it: picking the torpedo loadout and then the bomb
   * loadout paid the same multi-second compile twice, and every time after that. Both airframes
   * are two aircraft of geometry — cheap next to the fleet already resident — so the one being
   * left is detached and kept, and coming back to it is a `scene.add`.
   */
  private readonly builtAirframes = new Map<string, T.Group>();

  setAirframe(): void {
    const type = this.battle.player.airframe || "sbd";
    if (this.playerMesh?.userData.airframe === type) return;
    if (this.playerMesh) {
      this.playerMesh.removeFromParent();
      this.forgetFrozen(this.playerMesh);
    }
    const built = this.builtAirframes.get(type);
    if (built) {
      this.playerMesh = built;
      this.scene.add(this.playerMesh);
      this.freezeStatic(this.playerMesh);
      this.snap = true;
      return;
    }
    // The player's Devastator is the imported TBD-1, driven by its own shipped clips; the SBD
    // keeps the Douglas constructor, and the procedural Dauntless is gone from the player's seat.
    this.playerMesh =
      type === "sbd" ? createDouglas(true) : createAirframe("tbd1", "hero", true);
    this.playerMesh.userData.airframe = type;
    this.builtAirframes.set(type, this.playerMesh);
    addDamageVisuals(this.playerMesh);
    // The player's own first-person rear station, built here and nowhere else: an AI aircraft never
    // allocates one. It reads the same published eye the gunner camera uses, so shell and camera
    // share one anchor.
    const rearEye = this.playerMesh.userData.gunnerEye as T.Vector3 | undefined;
    if (rearEye) {
      const station = createRearStation(type, [rearEye.x, rearEye.y, rearEye.z]);
      if (station) {
        this.playerMesh.add(station.group);
        this.playerMesh.userData.rearStation = station;
      }
    }
    this.scene.add(this.playerMesh);
    this.freezeStatic(this.playerMesh);
    this.snap = true;
  }

  /**
   * Compile the views the player has not looked at yet, while the loading layer is still up.
   *
   * The cockpit interior is built at load and then kept `visible = false` until the player chooses
   * the cockpit, so WebGPU had never been asked to build a pipeline for any of its materials. It
   * built all of them inside the first cockpit frame: a measured **~1000 ms stall**, once per view
   * per session. Switching back was always cheap, which is how a one-time compile tells itself
   * apart from work the switch is doing.
   *
   * This compiles the player's own view subtrees and nothing else. The engine's `warmUpScene` is
   * the wrong tool here and was measured to be: it compiles the whole scene, which on this scene
   * added **13 s to the launch** to save 250 ms of stall, and raised a WebGPU validation error
   * besides. It is built for a native launch that must pay that cost once for everything; Midway
   * needs three views warmed, not 2,205 meshes. `compileAsync`'s three-argument form is the
   * targeted equivalent — the subtree compiles against the real scene, so it takes the scene's
   * lights and its cache keys match the ones `render` will look up.
   *
   * Both the object walk and the light gather skip invisible nodes, so each root is revealed for
   * its own compile and put back immediately. Revealing the whole scene instead also drags in the
   * reflector's depth target and fails bind-group validation.
   */
  /** Airframes whose views are already compiled; warming one twice buys nothing and costs seconds. */
  private readonly warmedAirframes = new Set<string>();

  async warmUpViews(): Promise<void> {
    const renderer = this.renderer as unknown as {
      compileAsync?: (object: T.Object3D, camera: T.Camera, scene: T.Object3D) => Promise<void>;
    };
    if (typeof renderer.compileAsync !== "function") return;
    const airframe = this.playerMesh?.userData.airframe as string | undefined;
    if (airframe !== undefined && this.warmedAirframes.has(airframe)) return;
    if (airframe !== undefined) this.warmedAirframes.add(airframe);
    const data = this.playerMesh?.userData as
      | { cockpitInterior?: T.Object3D; cockpitShell?: T.Object3D[]; crew?: T.Object3D[] }
      | undefined;
    if (!data) return;
    const roots = [data.cockpitInterior, ...(data.cockpitShell ?? []), ...(data.crew ?? [])].filter(
      (root): root is T.Object3D => root !== undefined,
    );
    for (const root of roots) {
      const hidden: T.Object3D[] = [];
      root.traverse((object) => {
        if (!object.visible) {
          hidden.push(object);
          object.visible = true;
        }
      });
      try {
        await renderer.compileAsync(root, this.camera, this.scene);
      } catch {
        // A view that will not precompile still draws; it just pays the stall it would have paid
        // anyway. Never let warming a camera angle stop the game starting.
      } finally {
        for (const object of hidden) object.visible = false;
      }
    }
  }

  setCamera(mode: number): void {
    // The rear-gun station owns the view: a camera order must not take it, or leave it.
    const p = this.battle?.player;
    if (p?.gunner === true && p.mode === "flight") return;
    this.cameraMode = mode;
    this.snap = true;
    this.followBomb = false;
    this.lookYaw = this.lookPitch = 0;
    this.lookActive = false;
  }

  /**
   * Compose a static subtree once, then stop Three recomposing its local matrix every frame.
   *
   * Only the subtree below `root` is frozen: the moving root (a ship, an aircraft, the player) must
   * keep composing its own matrix. `freezeNode` bakes each node's current transform with
   * `updateMatrix()` before it opts out, which is why this must run at creation, after the
   * transform is placed. `MOVING_NODE` protects every node a later animator writes.
   */
  private freezeStatic(root: T.Object3D): void {
    for (const child of root.children) this.freezeNode(child);
  }

  private freezeNode(node: T.Object3D): void {
    if (!this.freezeStatics || MOVING_NODE.test(node.name)) return;
    node.updateMatrix();
    node.matrixAutoUpdate = false;
    this.frozen.add(node);
    for (const child of node.children) this.freezeNode(child);
  }

  /** Drop a released subtree from the freeze set, so a LOD rebuild cannot accumulate stale nodes. */
  private forgetFrozen(root: T.Object3D): void {
    root.traverse((o) => this.frozen.delete(o));
  }

  /**
   * Reverse (or reapply) the static freeze for a same-page A/B.
   *
   * Turning the freeze off restores per-frame composition for every node already frozen and marks
   * them dirty; turning it back on only re-freezes nodes frozen before, so it is a verification
   * switch for a fixed population, never a game path. Game code never calls this.
   */
  setStaticFreeze(on: boolean): void {
    if (on === this.freezeStatics) return;
    this.freezeStatics = on;
    for (const node of this.frozen)
      if (on) {
        node.updateMatrix();
        node.matrixAutoUpdate = false;
      } else {
        node.matrixAutoUpdate = true;
        node.matrixWorldNeedsUpdate = true;
      }
  }

  makeTracers(): void {
    const geom = new T.SphereGeometry(1, 8, 6);
    const mat = new T.MeshBasicMaterial({ transparent: true, opacity: 0.95, depthWrite: false, blending: T.AdditiveBlending });
    this.tracers = new T.InstancedMesh(geom, mat, 1000);
    this.tracers.instanceMatrix.setUsage(T.DynamicDrawUsage);
    this.tracers.instanceColor = new T.InstancedBufferAttribute(new Float32Array(1000 * 3), 3).setUsage(T.DynamicDrawUsage);
    this.tracers.count = 0;
    this.tracers.frustumCulled = false;
    this.scene.add(this.tracers);
    this.freezeNode(this.tracers);
  }

  setQuality(q: string): void {
    this.quality = q;
    this.renderer.setPixelRatio(q === "low" ? Math.min(devicePixelRatio, 1) : Math.min(devicePixelRatio, q === "high" ? 2 : 1.5));
    this.renderer.shadowMap.enabled = q !== "low";
  }

  reset(b: any): void {
    this.battle = b;
    this.snap = true;
    this.followBomb = false;
    this.lookYaw = this.lookPitch = 0;
    this.particles.reset();
    this.ripples.reset();
    for (const [id, m] of this.meshes) if (id.startsWith("air-")) {
      this.scene.remove(m);
      this.forgetFrozen(m);
      this.disposeModel(m);
      this.meshes.delete(id);
    }
    this.setAirframe();
  }

  /**
   * The camera, for a HUD that is not in this process.
   *
   * A native target draws the HUD in the web view, which has no scene graph to project through, so
   * it gets the one matrix `project` applies and the viewport it lands in. Read from the live
   * camera each time it is asked for, which is once per published snapshot.
   */
  viewSnapshot(): IViewSnapshot {
    this.clip.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse);
    return {
      cameraMode: this.cameraMode,
      followBomb: this.followBomb,
      height: this.host.viewport.size.height,
      matrix: [...this.clip.elements],
      width: this.host.viewport.size.width,
    };
  }

  project(p: any): { x: number; y: number; visible: boolean; depth: number } {
    const v = this.tmp.set(p.x, p.y || 0, p.z).project(this.camera);
    // The cached viewport size, not `clientWidth`/`clientHeight`: reading those after the HUD's own
    // DOM/text writes dirtied layout forced a synchronous re-layout on every projected marker.
    const w = this.host.viewport.size.width;
    const h = this.host.viewport.size.height;
    return { x: (v.x * 0.5 + 0.5) * w, y: (-0.5 * v.y + 0.5) * h, visible: v.z > -1 && v.z < 1 && Math.abs(v.x) < 1.15 && Math.abs(v.y) < 1.15, depth: v.z };
  }

  update(dt: number, wallTime: number, briefing = false): void {
    const b = this.battle;
    const p = b.player;
    this.setAirframe();
    this.wallTime = wallTime;
    const time = briefing ? wallTime : b.time;
    // Pixels per radian for the render camera: an object's projected diameter is twice its
    // bounding-sphere radius times this over its distance. Read once, before both the hull and the
    // aircraft gates, because both are the same camera's projection.
    const focalPx = (this.host.viewport.size.height * 0.5) / Math.tan((this.camera.fov * Math.PI) / 360);
    const hullPixels = mergedHullPixels();
    for (const s of b.ships) {
      const m = this.meshes.get(s.id);
      if (!m) continue;
      // A submarine carries its own pose: the sim's keel depth becomes a waterline offset, the
      // swell fades with depth, and the dive angle comes from the sim's own `depthRate`. A surface
      // hull is unchanged. A wreck takes no pose — it is going down, not riding anything.
      const motion =
        s.kind === "sub"
          ? s.sub && !s.sunk
            ? submarineMotion(s, time, this.ripples.heightAt)
            : { x: 0, y: 0, z: 0, pitch: 0, roll: 0 }
          : shipMotion(s, time, this.ripples.heightAt);
      m.position.set(s.x + motion.x, s.y + motion.y, s.z + motion.z);
      m.rotation.set(motion.pitch, -s.heading, s.sunk ? s.sink * .35 : motion.roll + (s.list ?? 0), "YXZ");
      // The camera, not the player, is what decides whether a hull is a speck: it is also the pass
      // that has to pay for the geometry. This is the hull's distance LOD, and the only one it has.
      const camD = distance2(s, this.camera.position);
      m.visible = s.sink < 0.95 && camD < FAR_HULL;
      // Below `MERGED_HULL_PIXELS` the whole hull collapses to one merged draw. Two hulls are never
      // swapped: the carrier the player lands on (`b.home`, which must keep its deck and island exact)
      // and any hull the player is close enough to attack — both sit far above the pixel line. A
      // sinking hull changes shape with `s.sink` and is watched from close up, so it too keeps detail.
      const low = m.userData.hullLow as T.Mesh | undefined;
      if (low) {
        const px = (2 * (m.userData.hullRadius as number) * focalPx) / Math.max(1, camD);
        const merged = m.visible && s !== b.home && s.sink <= 0 && px < hullPixels;
        (m.userData.hullBody as T.Object3D).visible = !merged;
        low.visible = merged;
      }
      // The scouts this hull carries, each drawn where its own state puts it. Aboard and alongside
      // are on the ship and ride her motion; the airborne states are over the sector the simulation
      // is searching, at the same `SCOUT_ALTITUDE` the observation sweep files reports from. A lost
      // scout is not drawn, because it is not there.
      if (s.scouts?.length) this.placeScouts(s, m as T.Object3D);
      const d = distance2(s, p);
      // The park is a visual LOD: it is worth drawing while the camera is close, wherever the
      // player is, exactly as the hull's own LOD range is read from the camera. A carrier a
      // player never approaches keeps its park out of the draw.
      updateShipScars(m, s, d, this.quality);
      for (const a of (m.userData.parked ?? []) as T.Group[]) {
        const type = a.userData.simAirframe as string;
        // The park is the ready line: an airframe with none ready is below in the hangar, so its
        // parked instance hides and the other types stay spotted.
        a.visible = camD < 1900 && (s.air?.ready?.[type] ?? 0) > 0;
        // Turning over on the spot, waiting for the flag. One airframe, one animator.
        spinParked(a, dt);
      }
      // Decorative deck dressing follows the same visual LOD with no inventory tie.
      for (const d of (m.userData.decor ?? []) as T.Group[]) d.visible = camD < 1900;
      if (m.userData.elevator) (m.userData.elevator as T.Object3D).position.y = 19.85 - (d < 800 && Math.sin(time * 0.12) > 0 ? Math.sin(time * 0.12) * 5 : 0);

    }
    // The deck party works the launch spot, so it is anchored where the aircraft was standing and
    // does not taxi away with it once the deck run starts. The party stays visible for the whole
    // deck run — stood clear at the deck edge, not under the aircraft — and only leaves with the
    // briefing's default once the aircraft is airborne. `deckSpeed`, not `speed`, is the deck run's
    // own speed — `speed` carries the ship's way too, so it was never below 2 and the anchor never
    // left the briefing's default.
    const onDeck = p.mode === "service" || p.mode === "arrest" || p.mode === "deck" || p.mode === "launch";
    this.crew.group.visible = onDeck || briefing;
    // Throttle advancing counts as starting, not just rolling: at full power against the brakes the
    // slipstream is already lethal, so the men are at the edge before the chocks are pulled.
    const rolling =
      !briefing &&
      (p.mode === "launch" ||
        (p.mode === "deck" && ((p.deckSpeed ?? 0) > 0.4 || (p.throttle ?? 0) > 0.3)));
    if (this.crew.group.visible) {
      const home = b.home;
      if (briefing) this.crewAnchor = 15;
      else if (home && (p.mode !== "deck" || (p.deckSpeed ?? 0) < 2))
        this.crewAnchor = -localPoint(p, home).forward;
      // The party stands on whichever deck the player is actually on, at that carrier's own datum:
      // a diversion to Yorktown otherwise left the crew on Enterprise, 0.39 m too low.
      const deck = home ? this.meshes.get(home.id) : undefined;
      if (deck && this.crew.group.parent !== deck) deck.add(this.crew.group);
      this.crew.group.position.set(0, home?.deckHeight ?? 0, this.crewAnchor);
      this.crew.update(dt, rolling ? 1 : 0);
    }
    const live = new Set<string>();
    let detailed = 0;
    const camPos = this.camera.position;
    const mergedPixels = mergedAirframePixels();
    for (const a of b.aircraft) {
      live.add(a.id);
      const range = distance2(a, p);
      let m = this.meshes.get(a.id) as T.Group | undefined;
      const want = this.wantsDetail(a, range, m?.userData.detailed === true, detailed);
      if (m && (m.userData.detailed === true) !== want) {
        this.scene.remove(m);
        this.releaseAircraft(m);
        this.meshes.delete(a.id);
        m = undefined;
      }
      if (!m) {
        m = this.buildAircraft(a, want);
        this.scene.add(m);
        this.meshes.set(a.id, m);
      }
      if (m.userData.detailed) detailed += 1;
      m.position.set(a.x, a.y, a.z);
      m.rotation.set(a.pitch, -a.heading, a.roll, "YXZ");
      // A visible AI gun rides the angle it last fired at, so the drawn barrel points where its
      // rounds went instead of resetting to the rest position every frame.
      const aiGun = m.userData.rearGun as T.Object3D | undefined;
      if (aiGun) {
        if (typeof a.rearYaw === "number") aiGun.rotation.set(-(a.rearPitch ?? 0), a.rearYaw, 0, "YXZ");
        else aiGun.rotation.set(0, 0, 0);
      }
      const camD = Math.hypot(a.x - camPos.x, a.y - camPos.y, a.z - camPos.z);
      const projectedPx = (2 * (m.userData.radius as number) * focalPx) / Math.max(1, camD);
      // Below the merged line the airframe is one draw: hide the full content — model, gear, stores
      // and damage, all under `body` — in a single write and show the static stand-in instead. Above
      // it nothing changes and every animator runs, so a resolvable aircraft is never frozen.
      const merged = Boolean(m.userData.low) && projectedPx < mergedPixels;
      if (m.userData.low) {
        (m.userData.body as T.Object3D).visible = !merged;
        (m.userData.low as T.Object3D).visible = merged;
      }
      if (!merged) {
        const gearDown = (a.mode === "launch" && a.age < 4) || (a.mode === "rtb" && a.y < 80);
        if (m.userData.devastator) {
          animateDevastator(m, { rpm: a.engineCut ? 0.1 : 0.82, gearPos: gearDown ? 1 : 0, torpedo: a.torpedo ?? 0 }, dt);
        } else if (m.userData.douglas) {
          // The imported Douglas drives its propeller, gear and control surfaces through its own
          // clips rather than the generic prop/gear handles.
          animateDouglas(m, { rpm: a.engineCut ? 0.1 : 0.82, gearPos: gearDown ? 1 : 0 }, dt);
        } else {
          const prop = m.userData.prop as T.Object3D | undefined;
          if (prop) prop.rotation.z += dt * (a.engineCut ? 8 : 55);
          const gear = m.userData.gear as T.Object3D | undefined;
          if (gear) gear.visible = gearDown;
        }
        const load = m.userData.load as T.Object3D | undefined;
        if (load) load.visible = a.bombs > 0;
        if (m.userData.torpedoLoad) (m.userData.torpedoLoad as T.Object3D).visible = a.torpedo > 0;
        updateDamageVisuals(m, a);
      }
      m.visible = range < FAR_AIRCRAFT;
    }
    for (const [id, m] of this.meshes) if (id.startsWith("air-") && !live.has(id)) {
      this.scene.remove(m);
      this.releaseAircraft(m);
      this.meshes.delete(id);
    }
    // While the wheels are down the aircraft rides the carrier: parent it to the ship mesh and
    // place it in the ship's own frame, so it inherits the hull's bob and stays on the deck.
    const homeShip = b.home;
    const homeMesh = homeShip ? (this.meshes.get(homeShip.id) as T.Object3D | undefined) : undefined;
    const wheelsDown = briefing || p.mode === "deck" || p.mode === "arrest" || p.mode === "service";
    if (wheelsDown && homeMesh) {
      if (this.playerMesh.parent !== homeMesh) homeMesh.add(this.playerMesh);
      const local = localPoint(p, homeShip);
      this.playerMesh.position.set(local.right, p.y - homeShip.y, briefing ? 15 : -local.forward);
      this.playerMesh.rotation.set(p.pitch, 0, 0, "YXZ");
    } else {
      if (this.playerMesh.parent !== this.scene) this.scene.add(this.playerMesh);
      this.playerMesh.position.set(p.x, p.y, p.z);
      if (p.attitude) this.playerMesh.quaternion.set(p.attitude.x, p.attitude.y, p.attitude.z, p.attitude.w);
      else this.playerMesh.rotation.set(p.pitch, -p.heading, p.roll, "YXZ");
    }
    if (this.playerMesh.userData.devastator) animateDevastator(this.playerMesh, p, dt);
    else if (this.playerMesh.userData.animatedAirframe) animateImportedAirframe(this.playerMesh, p, dt);
    else animateDouglas(this.playerMesh, p, dt);
    updateDamageVisuals(this.playerMesh, p);
    // The wreck is under the splash from the moment it hits: the airframe goes with the impact,
    // not two seconds later when the report opens.
    this.playerMesh.visible = b.status !== "lost" && p.mode !== "wreck" && p.mode !== "downed";
    this.updateProjectiles();
    this.updateCamera(dt, briefing, time);
    // The eye below the surface is in a different medium: the dawn sky behind a submerged hull
    // reads as a hole punched through the sea. Tint the background and thicken the fog while the
    // camera is under, and restore the surface medium on the way up.
    const submerged = this.camera.position.y < 0;
    if (submerged !== this.underwater) {
      this.underwater = submerged;
      if (submerged) {
        const water = new T.Color(0x0b2f38).convertLinearToSRGB();
        this.scene.background = water;
        this.scene.fog = new T.FogExp2(water, 0.032);
      } else {
        this.scene.background = this.sky;
        this.scene.fog = this.surfaceFog;
      }
    }
    this.ripples.update(b, this.camera.position, dt);
    this.particles.update(b, this.camera.position);
    this.ocean.update(this.camera.position, time, b.ships);
    this.sun.position.copy(this.sunDir).multiplyScalar(500).add(this.playerMesh.getWorldPosition(this.tmp));
    this.sun.target.position.copy(this.playerMesh.getWorldPosition(this.tmp));
  }

  updateCamera(dt: number, briefing: boolean, time: number): void {
    const p = this.battle.player;
    const axes = axesOf(p);
    const f = axes.f;
    const u = axes.u;
    // The rear-gun station is a camera the player can leave: remember the view they came from and
    // restore it on the way back, so gunning never silently changes their camera choice.
    const gunnerView = p.gunner === true && p.mode === "flight";
    if (gunnerView && this.gunnerPrevMode === null) {
      this.gunnerPrevMode = this.cameraMode;
      this.gunnerPrevFollow = this.followBomb;
      this.cameraMode = 1;
      this.followBomb = false;
      this.snap = true;
    } else if (!gunnerView && this.gunnerPrevMode !== null) {
      this.cameraMode = this.gunnerPrevMode;
      this.followBomb = this.gunnerPrevFollow;
      this.gunnerPrevMode = null;
      this.snap = true;
    }
    const ownBomb = [...this.battle.bombs, ...this.battle.airTorpedoes, ...this.battle.torpedoes].filter((a: any) => a.owner === "player").at(-1);
    let cockpit = false;
    // The wreck is in the water and the camera is not: it stops at the surface, backs off and
    // watches the splash from outside it rather than descending into its own plume. A downed pilot
    // waits for a replacement from that same offshore eye, so the shot does not snap back inside.
    if (p.mode === "wreck" || p.mode === "downed") {
      if (!this.wreckEye) {
        const dx = this.camera.position.x - p.x;
        const dz = this.camera.position.z - p.z;
        const len = Math.hypot(dx, dz) || 1;
        this.wreckEye = new T.Vector3(p.x + (dx / len) * 85, 46, p.z + (dz / len) * 85);
      }
      this.targetCamera.copy(this.wreckEye);
      this.look.set(p.x, 3, p.z);
      this.camera.fov = 58;
      this.camera.position.lerp(this.targetCamera, 1 - Math.exp(-dt * 2.6));
      this.camera.up.set(0, 1, 0);
      this.camera.near = 0.35;
      this.camera.lookAt(this.look);
      this.camera.updateProjectionMatrix();
      this.camera.updateMatrixWorld();
      return;
    }
    this.wreckEye = null;
    if (briefing) {
      const focus = this.playerMesh.getWorldPosition(this.tmp);
      this.targetCamera.set(focus.x + 17 + Math.sin(time * 0.055) * 2, focus.y + 6.5, focus.z + 21);
      this.look.set(focus.x - 5, focus.y - 0.1, focus.z - 4);
      this.camera.fov = 49;
    } else if (gunnerView) {
      // The gunner's own eye, from the visual contract: `userData.gunnerEye` is the station in
      // aircraft-root coordinates. An authored framing offset is added in that same frame — 0.32 m
      // toward the nose and 3 cm up — so the externally-scaled gun sits low in the lens instead of
      // filling it; it is a camera anchor, not a claim about an exact eye bone, and the world gun
      // scale, pivot and ballistics are untouched. Still inside the open rear station. The 0.32 m
      // offset and 72° lens hold the externally-scaled gun low in frame and cut the extreme
      // foreshortening on the breech boxes without changing the aim direction.
      const eye = this.playerMesh.userData.gunnerEye as T.Vector3 | undefined;
      if (eye) this.targetCamera.set(eye.x, eye.y + 0.03, eye.z - 0.32);
      this.playerMesh.localToWorld(this.targetCamera);
      // The sight and the camera are one ray: the sim's own aim, off the airframe's real attitude,
      // so a banked or pitched aircraft keeps the eye, the gun pivot and the bullet agreeing.
      const dir = this.battle.gunnerAim();
      this.look.set(
        this.targetCamera.x + dir.x * 1000,
        this.targetCamera.y + dir.y * 1000,
        this.targetCamera.z + dir.z * 1000,
      );
      this.camera.fov = 72;
    } else if (this.followBomb && ownBomb) {
      this.targetCamera.set(ownBomb.x + 12, ownBomb.y + 16, ownBomb.z + 28);
      this.look.set(ownBomb.x + ownBomb.vx * 0.6, ownBomb.y + (ownBomb.vy ?? 0) * 0.6, ownBomb.z + ownBomb.vz * 0.6);
      this.camera.fov = 65;
    } else if (this.cameraMode === 1) {
      cockpit = true;
      if (this.playerMesh.userData.cockpit) this.targetCamera.copy(this.playerMesh.userData.cockpit);
      else this.targetCamera.set(0, 1.235, -0.57);
      // `localToWorld` calls `updateWorldMatrix(true, false)`: it refreshes this object's ancestor
      // chain and its own world matrix, which is all the eye point needs. The recursive
      // `updateMatrixWorld(true)` that used to precede it additionally walked every instrument,
      // fastener and control in the cockpit — several hundred transforms — to place one point.
      this.playerMesh.localToWorld(this.targetCamera);
      if (!this.lookActive) {
        this.lookYaw *= Math.exp(-dt * 7);
        this.lookPitch *= Math.exp(-dt * 7);
      }
      const yaw = this.rear ? Math.PI : this.lookYaw;
      const pitch = this.lookPitch - 0.055;
      const cp = Math.cos(pitch);
      const cy = Math.cos(yaw);
      const sy = Math.sin(yaw);
      const sp = Math.sin(pitch);
      const r = axes.r;
      this.look.set(
        this.targetCamera.x + (f.x * cy * cp + r.x * sy * cp + u.x * sp) * 1000,
        this.targetCamera.y + (f.y * cy * cp + r.y * sy * cp + u.y * sp) * 1000,
        this.targetCamera.z + (f.z * cy * cp + r.z * sy * cp + u.z * sp) * 1000,
      );
      this.camera.fov = 70;
    } else {
      // A stationary aircraft on its deck sits ahead of the aft deck park, so a centreline chase
      // camera lands inside that parked row and its near wing/body fills the frame. While the
      // aircraft is *parked* on deck the view is taken abeam (port, clear of the island) and
      // above. The moment the deck run starts the aft park is behind the camera, so the takeoff
      // roll uses the regular chase, exactly as it does once airborne; only a stopped deck,
      // an arrestment and a service stay abeam.
      const onDeck =
        !briefing &&
        (p.mode === "arrest" || p.mode === "service" || (p.mode === "deck" && (p.deckSpeed ?? 0) < 2));
      const wide = this.cameraMode === 2;
      // Mode 3 is the "look down on your aircraft" view: high above and astern, pitched down onto
      // the machine and the sea it is attacking, so a bomb hit or a ship going up stays in shot.
      const overhead = this.cameraMode === 3;
      const distance = onDeck ? (wide ? 26 : 13) : overhead ? 24 : wide ? 58 : 18;
      const sign = this.rear ? 1 : -1;
      const up = onDeck ? (wide ? 9 : 5.5) : overhead ? 30 : wide ? 12 : 4.2;
      if (!this.lookActive) {
        this.lookYaw *= Math.exp(-dt * 7);
        this.lookPitch *= Math.exp(-dt * 7);
      }
      // Free-look outside the cockpit orbits the viewpoint around the aircraft instead of turning
      // a head. Without this the chase views simply ignored right-drag, which the controls claimed
      // to support; the look target slides onto the aircraft as the orbit opens so the framing
      // stays on the machine rather than on empty sky ahead of it.
      if (onDeck) this.orbit.set(-axes.r.x * distance, up, -axes.r.z * distance);
      else this.orbit.set(f.x * distance * sign, f.y * distance * sign + up, f.z * distance * sign);
      this.orbit.applyAxisAngle(WORLD_UP, -this.lookYaw);
      this.orbitAxis.set(this.orbit.z, 0, -this.orbit.x);
      if (this.orbitAxis.lengthSq() > 1e-6)
        this.orbit.applyAxisAngle(this.orbitAxis.normalize(), -this.lookPitch);
      this.targetCamera.set(p.x + this.orbit.x, p.y + this.orbit.y, p.z + this.orbit.z);
      const framing = 1 - Math.min(1, (Math.abs(this.lookYaw) + Math.abs(this.lookPitch)) * 2.2);
      const lead = onDeck ? framing * 3 : overhead ? (this.rear ? -16 : 14) * framing : (this.rear ? -35 : 40) * framing;
      this.look.set(p.x + f.x * lead, p.y + f.y * lead + (onDeck ? 1.2 : 1.5), p.z + f.z * lead);
      this.camera.fov = overhead ? 64 : wide ? 60 : 56;
    }
    if (this.playerMesh.userData.crew) this.playerMesh.userData.crew[0].visible = !cockpit;
    // The player's own gunner figure is hidden only in his first-person station; the pilot and
    // chase views show the crew exactly as before.
    if (this.playerMesh.userData.gunner) (this.playerMesh.userData.gunner as T.Object3D).visible = !gunnerView;
    // One mapping for the gun's one pivot, in every view: the station aims it, and leaving the gun
    // returns it to its rest barrel instead of freezing where the player let go.
    const rearGun = this.playerMesh.userData.rearGun as T.Object3D | undefined;
    if (rearGun) {
      // The supplied exterior gun yields its place to the first-person twin in the rear station;
      // every other view (pilot, chase, external) draws it exactly as before.
      rearGun.visible = !gunnerView;
      if (gunnerView) {
        const e = this.battle.rearGunPivotEuler();
        rearGun.rotation.set(e.x, e.y, e.z, "YXZ");
      } else if (typeof p.rearYaw === "number") {
        // The AI gunner works the same gun while the pilot flies: show the angle it last fired at,
        // so the drawn barrel points where the rounds went instead of snapping back to rest.
        rearGun.rotation.set(-(p.rearPitch ?? 0), p.rearYaw, 0, "YXZ");
      } else rearGun.rotation.set(0, 0, 0);
    }
    // The player's first-person rear station: shell and visible twin gun show only while the gun
    // owns the view, and the gun pivot rides the same sim euler the rounds leave from.
    const rearStation = this.playerMesh.userData.rearStation as RearStation | undefined;
    if (rearStation) {
      rearStation.shell.visible = gunnerView;
      rearStation.pivot.visible = gunnerView;
      if (gunnerView) {
        const e = this.battle.rearGunPivotEuler();
        rearStation.pivot.rotation.set(e.x, e.y, e.z, "YXZ");
      } else rearStation.pivot.rotation.set(0, 0, 0);
      // The visible barrels kick back only from a round that actually left the player's gun: the sim
      // sets `rearTimer` on a successful shot and to zero on a refused or empty trigger, and the AI
      // gunner never runs while this station owns the view.
      rearStation.setRecoil(gunnerView ? Math.min(1, (p.rearTimer || 0) / 0.08) * 0.05 : 0);
      // The belt change is a render-only cycle over the sim's own countdown: it opens with the
      // change, peaks at the midpoint and closes as the belt is loaded. Outside a change it rests.
      const reloadLeft = Math.max(0, (p.rearReloadUntil ?? 0) - this.battle.time);
      rearStation.setReload(reloadLeft > 0 ? Math.sin(Math.PI * (1 - reloadLeft / REAR_RELOAD_SECONDS)) : 0);
    }
    // The detailed interior and the supplied canopy shell are alternatives: show the interior in
    // the pilot view, the exterior canopy every other time the rear station is not inside it.
    if (this.playerMesh.userData.cockpitInterior) this.playerMesh.userData.cockpitInterior.visible = cockpit;
    if (this.playerMesh.userData.cockpitShell)
      for (const shell of this.playerMesh.userData.cockpitShell) shell.visible = !cockpit && !gunnerView;
    // The look of the page is the shell's business, not the renderer's: `Midway` publishes this
    // through `shell.cockpitView`, so the native build has no DOM call to make.
    this.cockpitView = cockpit;
    if (this.snap || briefing || cockpit || gunnerView) {
      this.camera.position.copy(this.targetCamera);
      this.snap = false;
    } else {
      if (p.mode === "flight" && !(this.followBomb && ownBomb)) {
        this.camera.position.x += p.vx * dt;
        this.camera.position.y += p.vy * dt;
        this.camera.position.z += p.vz * dt;
      }
      this.camera.position.lerp(this.targetCamera, 1 - Math.exp(-dt * 6));
    }
    this.camera.near = cockpit || gunnerView ? 0.045 : 0.35;
    if (cockpit || gunnerView) this.camera.up.set(u.x, u.y, u.z);
    else this.camera.up.set(u.x * 0.13, 0.87 + u.y * 0.13, u.z * 0.13).normalize();
    if (!briefing && p.mode === "flight") {
      const buffet = Math.min(0.12, (p.stall || 0) * 0.045 + Math.max(0, Math.abs(p.gforce || 1) - 4) * 0.008);
      this.camera.position.x += Math.sin(time * 51) * buffet;
      this.camera.position.y += Math.sin(time * 43) * buffet;
    }
    this.camera.lookAt(this.look);
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();
  }

  updateProjectiles(): void {
    const b = this.battle;
    // Camera basis for the head cross: each round's streak is a 1 px line along its own velocity,
    // which has no screen footprint at all when the round flies straight away from the eye — the
    // player's own wing guns from the cockpit. So each round also carries a camera-facing cross.
    // Its arm grows with range instead of being a fixed world length: 0.7 m at 400 m is 1 px, which
    // is why a fixed 0.7 m cross is invisible from the pilot's seat. A few pixels here is a
    // near-constant angular size at the muzzle and at the target, and the converging markers are
    // what make the pilot's own fire readable.
    const me = this.camera.matrixWorld.elements;
    const ex = me[12], ey = me[13], ez = me[14];
    const focalPx = (this.host.viewport.size.height * 0.5) / Math.tan((this.camera.fov * Math.PI) / 360);
    let i = 0;
    for (const a of b.bullets) {
      if (i >= 1000) break;
      // A round with no velocity (a just-spawned or resolved bullet) still gets a valid instance
      // rather than a degenerate quaternion: the streak points along +Z and keeps a positive length.
      const speed = Math.hypot(a.vx, a.vy, a.vz);
      if (speed > 1e-6) this.tracerDir.set(a.vx, a.vy, a.vz).multiplyScalar(1 / speed);
      else this.tracerDir.set(0, 0, 1);
      const half = Math.max((a.type === "flak" ? 0.02 : 0.012) * speed, 0.02) * 0.5;
      // The head holds ~1.25 px whatever the range (a world length that grows with distance), so a
      // far round is a dot and never a balloon: the only clamp is a sane floor and ceiling.
      const radius = T.MathUtils.clamp((Math.hypot(a.x - ex, a.y - ey, a.z - ez) * 1.25) / focalPx, 0.015, 0.45);
      this.tracerQuat.setFromUnitVectors(TRACER_LONG, this.tracerDir);
      // The ellipsoid is centred half a length BEHIND the ballistic head, so the visible streak
      // trails the round instead of reaching past it.
      this.tracerPos.set(a.x - this.tracerDir.x * half, a.y - this.tracerDir.y * half, a.z - this.tracerDir.z * half);
      this.tracerScale.set(radius, radius, half);
      this.tracerMatrix.compose(this.tracerPos, this.tracerQuat, this.tracerScale);
      this.tracers.setMatrixAt(i, this.tracerMatrix);
      if (a.team === "us") this.tracerTint.setRGB(1, 0.83, 0.4);
      else this.tracerTint.setRGB(1, 0.42, 0.18);
      this.tracers.setColorAt(i, this.tracerTint);
      i += 1;
    }
    this.tracers.count = i;
    this.tracers.instanceMatrix.needsUpdate = true;
    if (this.tracers.instanceColor) this.tracers.instanceColor.needsUpdate = true;
    const ids = new Set<string>();
    for (const a of [...b.bombs, ...b.airTorpedoes]) {
      ids.add(a.id);
      let m = this.bombMeshes.get(a.id) as T.Object3D | undefined;
      if (!m) {
        m = a.safe !== undefined ? makeTorpedoModel() : new T.Group();
        if (a.safe === undefined) ellipsoid(m, 0, 0, 0, 0.32, 0.32, 1.2, mat(0x68674f), 10);
        this.scene.add(m);
        this.bombMeshes.set(a.id, m);
      }
      m.position.set(a.x, a.y, a.z);
      m.quaternion.setFromUnitVectors(new T.Vector3(0, 0, -1), new T.Vector3(a.vx, a.vy, a.vz).normalize());
    }
    for (const [id, m] of this.bombMeshes) if (!ids.has(id)) {
      this.scene.remove(m);
      this.disposeModel(m);
      this.bombMeshes.delete(id);
    }
    const tids = new Set<string>();
    for (const a of b.torpedoes) {
      tids.add(a.id);
      let m = this.torpMeshes.get(a.id) as T.Mesh | undefined;
      if (!m) {
        m = new T.Mesh(new T.PlaneGeometry(16, 170), new T.MeshBasicMaterial({ map: this.wakeTex, transparent: true, opacity: 0.65, depthWrite: false }));
        m.rotation.x = -Math.PI / 2;
        this.scene.add(m);
        this.torpMeshes.set(a.id, m);
      }
      m.position.set(a.x - a.vx * 1.5, 0.9, a.z - a.vz * 1.5);
      m.rotation.set(-Math.PI / 2, 0, a.heading, "XYZ");
    }
    for (const [id, m] of this.torpMeshes) if (!tids.has(id)) {
      this.scene.remove(m);
      const mesh = m as T.Mesh;
      mesh.geometry.dispose();
      (mesh.material as T.Material).dispose();
      this.torpMeshes.delete(id);
    }
  }

  /**
   * Which AI aircraft hold the detail loan instead of keeping the mesh they have.
   *
   * Every type maps to a real model, so both levels build the same airframe — the loan no longer
   * chooses between a model and a silhouette. The flag is still granted up close, kept until the
   * aircraft falls past `far` so a machine weaving around that boundary does not rebuild every
   * frame, and capped so a whole strike arriving together cannot put sixty fresh builds in the
   * scene at once; the rebuild path is what exercises the disposal dispatch.
   */
  private wantsDetail(a: any, range: number, had: boolean, granted: number): boolean {
    void a;
    if (had) return range < 1500;
    return range < 1100 && granted < 10;
  }

  /**
   * Give one hull a merged stand-in, grouped the way the airframe gate groups its full model.
   *
   * `detailed` is the imported hull and nothing else at this point: the park, the decor, the crew and
   * the deck scars are added to `mesh` afterwards, so `body` holds exactly the static hull — and the
   * moving elevator, were one ever published on `mesh.userData.elevator`, is a `mesh` child too and
   * stays live. The gate in `update` hides `body` and shows `low` below `MERGED_HULL_PIXELS`; above
   * it nothing changes and the hull keeps every material, turret and cable.
   */
  private addHullLod(mesh: T.Group, detailed: T.Group, key: string): void {
    const lod = airframeLod(detailed, key);
    if (!lod) return;
    const low = new T.Mesh(lod.geometry, lod.material);
    low.name = `${detailed.name} (merged)`;
    low.castShadow = true;
    low.receiveShadow = true;
    low.visible = false;
    const body = new T.Group();
    body.name = "hull";
    for (const child of [...detailed.children]) body.add(child);
    detailed.add(body);
    // A sibling of `body`, not of `detailed`: it shares `detailed`'s frame, which is where the merge
    // was baked, and is hidden and shown against `body` alone.
    detailed.add(low);
    mesh.userData.hullBody = body;
    mesh.userData.hullLow = low;
    mesh.userData.hullRadius = lod.geometry.boundingSphere?.radius ?? 0;
  }

  private buildAircraft(a: any, detail: boolean): T.Group {
    const m = importedAircraftFor(a)();
    // The merged stand-in, built once per airframe type from this first instance and shared by every
    // later one. It is a sibling of the full model so the per-frame gate can show either without a
    // rebuild; `airframe-lod.ts` owns the geometry's lifetime because every instance shares it.
    const lod = airframeLod(m);
    if (lod) {
      const low = new T.Mesh(lod.geometry, lod.material);
      low.name = `${m.name} (merged)`;
      low.castShadow = true;
      low.receiveShadow = true;
      low.visible = false;
      m.add(low);
      m.userData.low = low;
    }
    // The loan marker, not the model: both levels draw the same real airframe.
    m.userData.detailed = detail;
    // Range-gated like the hulls: out of the draw until `update` places it and reads its range.
    m.visible = false;
    // What sim airframe this mesh draws, so captures and the identity read never guess from names.
    m.userData.airframe = a.airframe;
    addDamageVisuals(m);
    if (a.kind === "torpedo" && !m.userData.torpedoLoad) {
      const load = m.userData.load as T.Object3D | undefined;
      if (load) load.visible = false;
      const torpedo = makeTorpedoModel();
      torpedo.position.set(0, -1.03, -0.1);
      m.add(torpedo);
      m.userData.torpedoLoad = torpedo;
    }
    m.userData.kind = a.kind;
    // The full airframe under one child, so the gate hides all of it — model, gear, stores and
    // damage — with a single write and shows the merged stand-in instead.
    if (m.userData.low) {
      const body = new T.Group();
      body.name = "airframe";
      for (const child of [...m.children]) if (child !== m.userData.low) body.add(child);
      body.updateMatrix();
      m.add(body);
      m.userData.body = body;
    }
    // The radius the pixel gate reads, measured once from the built model rather than guessed from
    // an airframe table: a Zero, a Kate and a Douglas span differently, and a stand-in must not
    // inherit another type's size.
    m.updateMatrixWorld(true);
    m.userData.radius = new T.Box3().setFromObject(m).getBoundingSphere(new T.Sphere()).radius || 6.5;
    this.freezeStatic(m);
    return m;
  }

  /**
   * Draw this hull's scouts where the simulation has them.
   *
   * The states come straight from `src/sim/scouting.ts` and nothing is inferred: "aboard" and
   * "alongside" sit on the ship, the four airborne states fly, and "lost" is not drawn. An airborne
   * scout is placed at `Battle.scoutPosition` — the same sector midpoint its reports are filed
   * from — so what a player sees and what the other side's intelligence says came from one place.
   * Heading follows the track out and back, which is the only cue that tells outbound from
   * returning at this range.
   */
  private placeScouts(ship: any, hull: T.Object3D): void {
    for (const scout of ship.scouts as Array<{ id: string; state: string }>) {
      const plane = this.scouts.get(scout.id);
      if (!plane) continue;
      if (scout.state === "lost") {
        plane.visible = false;
        continue;
      }
      plane.visible = true;
      if (scout.state === "aboard" || scout.state === "alongside") {
        // On the quarterdeck, in the hull's own frame, so she carries it through pitch and roll.
        // Alongside is in the water off the quarter, waiting on the crane.
        const aboard = scout.state === "aboard";
        SCOUT_SEAT.set(aboard ? 0 : ship.hullBeam * 0.62, aboard ? (ship.deckHeight ?? 9) + 0.6 : 0.6, ship.hullLength * 0.3);
        hull.localToWorld(SCOUT_SEAT);
        plane.position.copy(SCOUT_SEAT);
        plane.rotation.set(0, -ship.heading, 0);
        continue;
      }
      const at = this.battle.scoutPosition(scout, ship);
      plane.position.set(at.x, SCOUT_DRAW_ALTITUDE, at.z);
      // Facing along the leg it is flying: out from the ship, or back towards her.
      const towards = scout.state === "returning" ? { x: ship.x - at.x, z: ship.z - at.z } : { x: at.x - ship.x, z: at.z - ship.z };
      plane.rotation.set(0, -Math.atan2(towards.x, -towards.z), 0);
    }
  }

  /** Give up one aircraft's mesh without touching geometry another instance still shares. */
  private releaseAircraft(m: T.Object3D): void {
    this.forgetFrozen(m);
    if (m.userData.devastator) disposeDevastator(m as T.Group);
    else if (m.userData.douglas || m.userData.importedAircraft) disposeAirframe(m as T.Group);
    this.disposeModel(m);
  }

  /**
   * Dispose what this object alone owns, and nothing else.
   *
   * Imported models are cloned from one shared GLTF scene: their geometry, materials and textures
   * belong to `ctx.assets` and outlive every instance. Disposing those here would take the
   * geometry out from under every other aircraft and ship still drawing it, so a clone only ever
   * gives back the parts built for it — its scorch decals, its stores, and any procedural branch
   * it declared as its own.
   */
  disposeModel(group: T.Object3D): void {
    const stains = group.userData.damageVisuals as Record<string, T.Mesh> | undefined;
    for (const mesh of Object.values(stains ?? {})) {
      mesh.geometry.dispose();
      (mesh.material as T.Material).dispose();
    }
    for (const branch of (group.userData.owned ?? []) as T.Object3D[])
      branch.traverse((o) => (o as T.Mesh).geometry?.dispose());
    const torpedo = group.userData.torpedoLoad as T.Object3D | undefined;
    torpedo?.traverse((o) => (o as T.Mesh).geometry?.dispose());
    (group.userData.cockpitRig as { dispose?: () => void } | undefined)?.dispose?.();
    (group.userData.rearStation as RearStation | undefined)?.dispose?.();
    // The Devastator's own parts are given back by `disposeDevastator` in `releaseAircraft`
    // before this runs; traversing them here would dispose geometry twice.
    if (group.userData.detailed || group.userData.importedAircraft || group.userData.importedShip || group.userData.devastator)
      return;
    group.traverse((o) => {
      if (o.userData.importedAircraft || o.userData.importedShip) return;
      const mesh = o as T.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
    });
  }
}
