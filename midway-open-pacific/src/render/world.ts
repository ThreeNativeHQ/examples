/** The battle's Three.js world, built into the scene the framework owns. */
import * as T from "three";
import { shipClass } from "../sim/catalog.js";
import { attitudeAxes } from "../sim/flight.js";
import { distance2, forward, localPoint } from "../sim/math.js";
import { ellipsoid, mat, wakeTexture, makeAircraft, makeShip } from "./assets.js";
import { type CarrierModelId, createCarrier, createIjnCarrier, shipModelFor } from "./imported-ships.js";
import { createAirframe, createDouglas, animateDouglas, animateImportedAirframe, disposeAirframe, spinPropeller } from "./imported-aircraft.js";
import { createMidwayAtoll, createZero } from "./imported-fleet.js";
import { DeckCrew } from "./deck-crew.js";
import { animateDauntless, makeDauntless } from "./dauntless.js";
import { addDamageVisuals, makeTorpedoModel, updateDamageVisuals, updateShipScars } from "./model-damage.js";
import { dawnEnvironment, SKY_ROTATION, SUN_DIRECTION, SUN_COLOR } from "./environment.js";
import { createOcean } from "./ocean.js";
import { CombatParticles } from "./particles.js";
import { createRipples } from "./ripples.js";
import { shipMotion } from "./ship-motion.js";

/**
 * The imported airframe for an AI aircraft, where the game has one.
 *
 * Only two of the battle's types have a real model: the Douglas the player flies, and the Zero
 * supplied with the project. Everything else — Wildcat, Devastator, Val, Kate, Catalina — has no
 * source asset available, so it stays procedural at every range rather than wearing another
 * type's silhouette and claiming to be itself.
 */
function importedAircraftFor(a: { team: string; kind: string }): (() => T.Group) | undefined {
  if (a.team === "jp" && a.kind === "fighter") return createZero;
  if (a.team === "us" && a.kind === "bomber")
    return () => {
      const douglas = createDouglas();
      douglas.userData.douglas = true;
      return douglas;
    };
  return undefined;
}

/** Reused so the per-frame camera orbit allocates nothing. */
const WORLD_UP = new T.Vector3(0, 1, 0);

/**
 * Idle a parked aircraft's propeller. Imported airframes publish a `propeller` (and often a blur
 * disc); the procedural ones publish only the `prop` group every other aircraft animates, so the
 * same call cannot serve both.
 */
function spinParked(m: T.Group, dt: number): void {
  if (m.userData.propeller) {
    spinPropeller(m, 0.12, dt);
    return;
  }
  const prop = m.userData.prop as T.Object3D | undefined;
  if (prop) prop.rotation.z += dt * 28;
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
const CARRIER_MODEL: Readonly<Record<string, { id: CarrierModelId; classId?: string }>> = {
  "USS Enterprise": { id: "enterprise" },
  "USS Hornet": { id: "hornet" },
  Akagi: { id: "akagi" },
  "USS Yorktown": { id: "yorktown", classId: "yorktown" },
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
 *
 * Northampton, Phelps and Balch are absent on purpose: no class and no model was supplied for
 * either ship, and lending one a sister's hull would draw a ship this battle does not contain.
 *
 * Arashi and Nowaki were Kagero class and `src/sim/catalog.ts` sizes them as Kagero, so they take
 * that hull rather than the Shiratsuyu-class Samidare the view used to draw for any IJN
 * destroyer: the Samidare measures 111 m against the 118.5 m the simulation gives these two, so
 * the substitution also drew a hull 7.5 m shorter than its own collision volume.
 */
const HULL_CLASS_BY_NAME: Readonly<Record<string, string>> = {
  Tone: "tone",
  Chikuma: "tone", // Tone class; the two sisters were near-identical at Midway
  Mogami: "mogami",
  Mikuma: "mogami", // Mogami class; the derived hull is the only one that flies it
  Arashi: "kagero",
  Nowaki: "kagero",
  "USS Hammann": "hammann",
  "I-168": "i168",
  "USS Nautilus": "nautilus",
};

/**
 * Metres at which each imported hull hands back to the procedural silhouette.
 *
 * The two numbers already here are the carriers at 1200 m and the IJN destroyer at 2600 m, and
 * that ordering is a triangle bill rather than a size one: a carrier carries up to 200k triangles
 * (Yorktown, src/sim/catalog.ts) and there are seven of them in the battle, a destroyer 23k.
 *
 * - `cruiser` 2200 m: 201.6 m of hull, within 20% of a carrier's length, so the silhouette stays
 *   worth drawing a long way out — but ~48k triangles against Yorktown's 200k, so two of them cost
 *   a quarter of one carrier and can be carried well past the carriers' 1200 m.
 * - `destroyer` 2600 m: the same 106-118 m hull and the same ~23k triangles as the IJN destroyer
 *   this view already held to 2600 m, so the number is inherited rather than invented.
 * - `sub` 1300 m: a destroyer's triangle count, but 13.5-15 m of masthead above the sea against a
 *   destroyer's 28 m. Half the visible silhouette reaches a destroyer's switch-point apparent size
 *   at half its range, and a surfaced boat is mostly conning tower — there is no superstructure
 *   left to resolve further out.
 */
const HULL_LOD_RANGE: Readonly<Record<string, number>> = {
  cruiser: 2200,
  destroyer: 2600,
  sub: 1300,
};

/**
 * The parked deck load, by the simulation's own airframe name.
 *
 * The park is a bounded sample of the same `s.air.ready` inventory the launch gate spends, not a
 * second air count: one instance per airframe a ship actually carries. The models are the ones the
 * game already loads — the imported TBD, Kate and Zero, the imported Douglas for the SBD, and the
 * procedural fighter/bomber for the two airframes with no source asset. The id is explicit so no
 * team/kind guess can park a B-25 or an enemy type on a deck.
 */
const PARK_FACTORY: Readonly<Record<string, () => T.Group>> = {
  wildcat: () => makeAircraft("us", "fighter", false),
  sbd: () => createAirframe("sbd3", "ai"),
  tbd: () => createAirframe("tbd1", "ai"),
  zero: () => createAirframe("a6m3", "ai"),
  val: () => makeAircraft("jp", "bomber", false),
  kate: () => createAirframe("b5n2", "ai"),
};

/**
 * How far a parked airframe's origin stands above its wheel contact, in metres.
 *
 * The import contract lands the TBD's and Kate's wheels on y = 0, so their root is the contact
 * datum. The other three are not: the Douglas main wheels reach -1.84 m below its root
 * (`createDauntlessGear`: leg -0.3, wheel -1.19, radius 0.35), the Zero's reach -1.87 m
 * (`createZero`: wheel -1.55, radius 0.32), and the procedural hull's reach -2.36 m
 * (`makeAircraft`: wheel -1.85, radius 0.51). A station adds this back so every type rests on the
 * same deck plane instead of sinking its undercarriage into it.
 */
const PARK_GROUND: Readonly<Record<string, number>> = {
  wildcat: 2.36,
  sbd: 1.84,
  tbd: 0,
  zero: 1.87,
  val: 2.36,
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
  add: (object: T.Object3D) => unknown;
}

export class WorldView {
  battle: any;
  host: IWorldHost;
  meshes = new Map<string, T.Object3D>();
  fxMeshes = new Map<string, T.Object3D>();
  bombMeshes = new Map<string, T.Object3D>();
  torpMeshes = new Map<string, T.Object3D>();
  cameraMode = 0;
  rear = false;
  followBomb = false;
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
  tracers!: T.LineSegments;
  tracerPositions = new Float32Array(1000 * 6);
  tracerColors = new Float32Array(1000 * 6);
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
  private look = new T.Vector3();
  private targetCamera = new T.Vector3();

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
    this.makeOcean();
    this.makeWorld();
    this.makeTracers();
    this.particles = new CombatParticles(this.scene);
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
      let mesh: T.Group = makeShip(s);
      const classId = HULL_CLASS_BY_NAME[s.name];
      if (classId) {
        // The ship's own imported hull near the player, the procedural silhouette beyond it.
        const far = HULL_LOD_RANGE[s.kind];
        if (far === undefined)
          throw new Error(`no imported-hull LOD range for a ${s.kind}: ${s.name}`);
        const detailed = shipModelFor(classId);
        // The class creators name their lead ship; this is the sister actually being built.
        detailed.name = s.name;
        // Float it at its own waterline. The import contract lands the keel on y = 0, so an
        // imported hull drawn at the ship's own y shows its whole underwater body above the sea —
        // a destroyer standing on the water with its full anti-fouling band in daylight. The
        // procedural hull at the far level uses the other convention: `makeShip` in assets.ts puts
        // the WATERLINE on y = 0, lifts the hull band to y = 8 and models no submerged body at
        // all. So only the imported level moves, by its own class draught, and the two levels then
        // float on the same line. A submerged boat needs nothing further here: the wrapper already
        // drops to y = -7 and ocean.ts skips a dived boat's wake slot.
        detailed.position.y = -shipClass(classId).draught;
        const lod = new T.LOD();
        lod.addLevel(detailed, 0);
        lod.addLevel(mesh, far);
        mesh = new T.Group();
        mesh.add(lod);
        mesh.userData.importedShip = true;
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
        const lod = new T.LOD();
        lod.addLevel(detailed, 0);
        lod.addLevel(mesh, 1200);
        mesh = new T.Group();
        mesh.add(lod);
        mesh.userData.importedShip = true;
        mesh.userData.parked = [];
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
      }
      this.scene.add(mesh);
      this.meshes.set(s.id, mesh);

    }
    this.crew = new DeckCrew();
    this.meshes.get(b.player.home)?.add(this.crew.group);
    const island = createMidwayAtoll();
    island.position.set(b.island.x, 0, b.island.z);
    this.scene.add(island);
    this.setAirframe();
  }

  setAirframe(): void {
    const type = this.battle.player.airframe || "sbd";
    if (this.playerMesh?.userData.airframe === type) return;
    if (this.playerMesh) {
      this.playerMesh.removeFromParent();
      if (this.playerMesh.userData.importedAircraft) disposeAirframe(this.playerMesh);
      this.disposeModel(this.playerMesh);
    }
    // The player's Devastator is the imported TBD-1, driven by its own shipped clips; the SBD
    // keeps the Douglas constructor, and the procedural Dauntless is gone from the player's seat.
    this.playerMesh =
      type === "sbd" ? createDouglas(true) : createAirframe("tbd1", "hero", true);
    this.playerMesh.userData.airframe = type;
    addDamageVisuals(this.playerMesh);
    this.scene.add(this.playerMesh);
    this.snap = true;
  }

  setCamera(mode: number): void {
    this.cameraMode = mode;
    this.snap = true;
    this.followBomb = false;
    this.lookYaw = this.lookPitch = 0;
    this.lookActive = false;
  }

  makeTracers(): void {
    const geom = new T.BufferGeometry();
    geom.setAttribute("position", new T.BufferAttribute(this.tracerPositions, 3).setUsage(T.DynamicDrawUsage));
    geom.setAttribute("color", new T.BufferAttribute(this.tracerColors, 3).setUsage(T.DynamicDrawUsage));
    geom.setDrawRange(0, 0);
    this.tracers = new T.LineSegments(geom, new T.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.95, depthWrite: false, blending: T.AdditiveBlending }));
    this.tracers.frustumCulled = false;
    this.scene.add(this.tracers);
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
      this.disposeModel(m);
      this.meshes.delete(id);
    }
    this.setAirframe();
  }

  project(p: any): { x: number; y: number; visible: boolean; depth: number } {
    const v = this.tmp.set(p.x, p.y || 0, p.z).project(this.camera);
    const w = this.renderer.domElement.clientWidth || window.innerWidth;
    const h = this.renderer.domElement.clientHeight || window.innerHeight;
    return { x: (v.x * 0.5 + 0.5) * w, y: (-0.5 * v.y + 0.5) * h, visible: v.z > -1 && v.z < 1 && Math.abs(v.x) < 1.15 && Math.abs(v.y) < 1.15, depth: v.z };
  }

  update(dt: number, wallTime: number, briefing = false): void {
    const b = this.battle;
    const p = b.player;
    this.setAirframe();
    this.wallTime = wallTime;
    const time = briefing ? wallTime : b.time;
    for (const s of b.ships) {
      const m = this.meshes.get(s.id);
      if (!m) continue;
      // Depth already became y through `subY` in the simulation; the renderer never converts it.
      const moving = s.kind !== "sub" || s.surfaced;
      const motion = moving ? shipMotion(s, time, this.ripples.heightAt) : {x:0,y:0,z:0,pitch:0,roll:0};
      m.position.set(s.x + motion.x, s.y + motion.y, s.z + motion.z);
      m.rotation.set(motion.pitch, -s.heading, s.sunk ? s.sink * .35 : motion.roll + (s.list ?? 0), "YXZ");
      m.visible = s.sink < 0.95;
      const d = distance2(s, p);
      // The park is a visual LOD: it is worth drawing while the camera is close, wherever the
      // player is, exactly as the hull's own LOD range is read from the camera. A carrier a
      // player never approaches keeps its park out of the draw.
      const camD = distance2(s, this.camera.position);
      updateShipScars(m, s, d, this.quality);
      for (const a of (m.userData.parked ?? []) as T.Group[]) {
        const type = a.userData.simAirframe as string;
        // The park is the ready line: an airframe with none ready is below in the hangar, so its
        // parked instance hides and the other types stay spotted.
        a.visible = camD < 1900 && (s.air?.ready?.[type] ?? 0) > 0;
        // Turning over on the spot, waiting for the flag. One airframe, one animator.
        spinParked(a, dt);
      }
      if (m.userData.elevator) (m.userData.elevator as T.Object3D).position.y = 19.85 - (d < 800 && Math.sin(time * 0.12) > 0 ? Math.sin(time * 0.12) * 5 : 0);

    }
    // The deck party works the launch spot, so it is anchored where the aircraft was standing and
    // does not taxi away with it once the deck run starts.
    const onDeck = p.mode === "deck" || p.mode === "service" || p.mode === "arrest";
    this.crew.group.visible = onDeck || briefing;
    if (this.crew.group.visible) {
      const home = b.home;
      if (briefing) this.crewAnchor = 15;
      else if (home && (p.mode !== "deck" || (p.speed ?? 0) < 2))
        this.crewAnchor = -localPoint(p, home).forward;
      // The party stands on whichever deck the player is actually on, at that carrier's own datum:
      // a diversion to Yorktown otherwise left the crew on Enterprise, 0.39 m too low.
      const deck = home ? this.meshes.get(home.id) : undefined;
      if (deck && this.crew.group.parent !== deck) deck.add(this.crew.group);
      this.crew.group.position.set(0, home?.deckHeight ?? 0, this.crewAnchor);
      this.crew.update(dt);
    }
    const live = new Set<string>();
    let detailed = 0;
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
      const gearDown = (a.mode === "launch" && a.age < 4) || (a.mode === "rtb" && a.y < 80);
      if (m.userData.douglas) {
        // The imported Douglas drives its propeller, gear and control surfaces through its own
        // clips rather than the generic prop/gear handles.
        animateDouglas(m, { rpm: a.engineCut ? 0.1 : 0.82, gearPos: gearDown ? 1 : 0 }, dt);
      } else {
        (m.userData.prop as T.Object3D).rotation.z += dt * (a.engineCut ? 8 : 55);
        (m.userData.gear as T.Object3D).visible = gearDown;
      }
      const load = m.userData.load as T.Object3D | undefined;
      if (load) load.visible = a.bombs > 0;
      if (m.userData.torpedoLoad) (m.userData.torpedoLoad as T.Object3D).visible = a.torpedo > 0;
      updateDamageVisuals(m, a);
      m.visible = range < 18000;
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
    if (this.playerMesh.userData.animatedAirframe) animateImportedAirframe(this.playerMesh, p, dt);
    else if (this.playerMesh.userData.importedAircraft) animateDouglas(this.playerMesh, p, dt);
    else animateDauntless(this.playerMesh, p, dt);
    updateDamageVisuals(this.playerMesh, p);
    this.playerMesh.visible = b.status !== "lost";
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
    const axes = p.attitude ? attitudeAxes(p) : { f: forward(p.heading, p.pitch), u: { x: 0, y: 1, z: 0 }, r: { x: 1, y: 0, z: 0 } };
    const f = axes.f;
    const u = axes.u;
    const ownBomb = [...this.battle.bombs, ...this.battle.airTorpedoes, ...this.battle.torpedoes].filter((a: any) => a.owner === "player").at(-1);
    let cockpit = false;
    if (briefing) {
      const focus = this.playerMesh.getWorldPosition(this.tmp);
      this.targetCamera.set(focus.x + 17 + Math.sin(time * 0.055) * 2, focus.y + 6.5, focus.z + 21);
      this.look.set(focus.x - 5, focus.y - 0.1, focus.z - 4);
      this.camera.fov = 49;
    } else if (this.followBomb && ownBomb) {
      this.targetCamera.set(ownBomb.x + 12, ownBomb.y + 16, ownBomb.z + 28);
      this.look.set(ownBomb.x + ownBomb.vx * 0.6, ownBomb.y + (ownBomb.vy ?? 0) * 0.6, ownBomb.z + ownBomb.vz * 0.6);
      this.camera.fov = 65;
    } else if (this.cameraMode === 1) {
      cockpit = true;
      this.playerMesh.updateMatrixWorld(true);
      if (this.playerMesh.userData.cockpit) this.targetCamera.copy(this.playerMesh.userData.cockpit);
      else this.targetCamera.set(0, 1.235, -0.57);
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
      // wheels are down on deck the view is taken abeam (port, clear of the island) and above,
      // still in the aircraft's own moving frame; rolling launch and airborne chase are unchanged.
      const onDeck =
        !briefing && (p.mode === "deck" || p.mode === "arrest" || p.mode === "service");
      const wide = this.cameraMode === 2;
      const distance = onDeck ? (wide ? 26 : 13) : wide ? 58 : 18;
      const sign = this.rear ? 1 : -1;
      const up = onDeck ? (wide ? 9 : 5.5) : wide ? 12 : 4.2;
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
      const lead = onDeck ? framing * 3 : (this.rear ? -35 : 40) * framing;
      this.look.set(p.x + f.x * lead, p.y + f.y * lead + (onDeck ? 1.2 : 1.5), p.z + f.z * lead);
      this.camera.fov = wide ? 60 : 56;
    }
    if (this.playerMesh.userData.crew) this.playerMesh.userData.crew[0].visible = !cockpit;
    // The detailed interior and the supplied canopy shell are alternatives: show the interior in
    // the pilot view, the exterior canopy every other time.
    if (this.playerMesh.userData.cockpitInterior) this.playerMesh.userData.cockpitInterior.visible = cockpit;
    if (this.playerMesh.userData.cockpitShell)
      for (const shell of this.playerMesh.userData.cockpitShell) shell.visible = !cockpit;
    document.body.classList.toggle("cockpit-view", cockpit);
    if (this.snap || briefing || cockpit) {
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
    this.camera.near = cockpit ? 0.045 : 0.35;
    if (cockpit) this.camera.up.set(u.x, u.y, u.z);
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
    let i = 0;
    for (const a of b.bullets) {
      if (i >= 1000) break;
      const k = i * 6;
      const length = a.type === "flak" ? 0.02 : 0.012;
      this.tracerPositions.set([a.x, a.y, a.z, a.x - a.vx * length, a.y - a.vy * length, a.z - a.vz * length], k);
      const color = a.team === "us" ? [1, 0.83, 0.4] : [1, 0.42, 0.18];
      this.tracerColors.set([...color, ...color.map((x) => x * 0.4)], k);
      i += 1;
    }
    this.tracers.geometry.setDrawRange(0, i * 2);
    (this.tracers.geometry.attributes.position as T.BufferAttribute).needsUpdate = true;
    (this.tracers.geometry.attributes.color as T.BufferAttribute).needsUpdate = true;
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
   * Which AI aircraft get their imported airframe instead of the procedural one.
   *
   * Detail is a loan, not a property: it is granted inside `near`, kept until the aircraft falls
   * past `far` so a machine weaving around that boundary does not rebuild every frame, and capped
   * so a whole strike arriving together cannot put sixty full airframes in the scene at once.
   */
  private wantsDetail(a: any, range: number, had: boolean, granted: number): boolean {
    if (!importedAircraftFor(a)) return false;
    if (had) return range < 1500;
    return range < 1100 && granted < 10;
  }

  private buildAircraft(a: any, detail: boolean): T.Group {
    const imported = detail ? importedAircraftFor(a) : undefined;
    const m = imported ? imported() : makeAircraft(a.team, a.kind, false);
    if (!imported) {
      // The procedural airframe is modelled a little under size; the imported ones are metre-true.
      m.scale.multiplyScalar(1.15);
    }
    m.userData.detailed = !!imported;
    addDamageVisuals(m);
    if (a.kind === "torpedo") {
      const load = m.userData.load as T.Object3D | undefined;
      if (load) load.visible = false;
      const torpedo = makeTorpedoModel();
      torpedo.position.set(0, -1.03, -0.1);
      m.add(torpedo);
      m.userData.torpedoLoad = torpedo;
    }
    m.userData.kind = a.kind;
    return m;
  }

  /** Give up one aircraft's mesh without touching geometry another instance still shares. */
  private releaseAircraft(m: T.Object3D): void {
    if (m.userData.douglas || m.userData.importedAircraft) disposeAirframe(m as T.Group);
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
    if (group.userData.detailed || group.userData.importedAircraft || group.userData.importedShip)
      return;
    group.traverse((o) => {
      if (o.userData.importedAircraft || o.userData.importedShip) return;
      const mesh = o as T.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
    });
  }
}
