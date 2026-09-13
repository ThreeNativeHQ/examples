/** The battle's Three.js world, built into the scene the framework owns. */
import * as T from "three";
import { attitudeAxes } from "../sim/flight.js";
import { clamp, distance2, forward, localPoint } from "../sim/math.js";
import { ellipsoid, mat, wakeTexture, makeAircraft, makeCrew, makeIsland, makeShip } from "./assets.js";
import { createCarrier, createMitchell, DECKS } from "./imported-ships.js";
import { createDouglas, animateDouglas, disposeDouglas } from "./imported-aircraft.js";
import { animateDauntless, makeDauntless } from "./dauntless.js";
import { addDamageVisuals, makeTorpedoModel, updateDamageVisuals } from "./model-damage.js";
import { dawnEnvironment, SKY_ROTATION, SUN_DIRECTION, SUN_COLOR } from "./environment.js";
import { createOcean } from "./ocean.js";
import { CombatParticles } from "./particles.js";

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
  crew!: T.Group;
  playerMesh!: T.Group;
  tracers!: T.LineSegments;
  tracerPositions = new Float32Array(1000 * 6);
  tracerColors = new Float32Array(1000 * 6);
  particles!: CombatParticles;
  lookYaw = 0;
  lookPitch = 0;
  lookActive = false;
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
    this.scene.fog = new T.FogExp2(new T.Color(0x8fa9b4).convertLinearToSRGB(), 0.000028);
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
    this.makeOcean();
    this.makeWorld();
    this.makeTracers();
    this.particles = new CombatParticles(this.scene);
  }

  makeSky(): void {
    const sky = dawnEnvironment();
    this.scene.background = sky;
    this.scene.environment = sky;
    this.scene.backgroundRotation.copy(SKY_ROTATION);
    this.scene.environmentRotation.copy(SKY_ROTATION);
    this.scene.backgroundIntensity = 0.65;
    this.scene.environmentIntensity = 0.65;
  }

  makeOcean(): void {
    this.ocean = createOcean();
    this.sea = this.ocean.mesh;
    this.scene.add(this.sea);
  }

  makeWorld(): void {
    const b = this.battle;
    for (const s of b.ships) {
      let mesh: T.Group = makeShip(s);
      if (s.kind === "carrier" && (s.team === "us" || s.name === "Akagi")) {
        const id = s.team !== "us" ? "akagi" : s.name === "USS Enterprise" ? "enterprise" : "hornet";
        const detailed = createCarrier(id);
        const lod = new T.LOD();
        lod.addLevel(detailed, 0);
        lod.addLevel(mesh, 1200);
        mesh = new T.Group();
        mesh.add(lod);
        mesh.userData.importedShip = true;
        mesh.userData.parked = [];
        s.length = DECKS[id].length;
        s.width = DECKS[id].width;
        s.visualLength = DECKS[id].visualLength;
        for (let i = 0; i < (s.team === "us" ? (id === "enterprise" ? 2 : 3) : 0); i++) {
          const plane = id === "hornet" ? createMitchell() : createDouglas();
          plane.userData.parkedDouglas = id !== "hornet";
          plane.position.set(id === "enterprise" ? -13 : 10, 20.06 + (id === "enterprise" ? 1.82 : 0), -30 + i * 30);
          if (id === "enterprise") plane.rotation.x = .22;
          detailed.add(plane);
          mesh.userData.parked.push(plane);
        }
      }
      this.scene.add(mesh);
      this.meshes.set(s.id, mesh);

    }
    const h = this.meshes.get(b.player.home);
    this.crew = makeCrew();
    h?.add(this.crew);
    const island = makeIsland();
    island.position.set(b.island.x, 0, b.island.z);
    this.scene.add(island);
    this.setAirframe();
  }

  setAirframe(): void {
    const type = this.battle.player.airframe || "sbd";
    if (this.playerMesh?.userData.airframe === type) return;
    if (this.playerMesh) {
      this.playerMesh.removeFromParent();
      this.playerMesh.userData.instruments?.texture.dispose();
      if (this.playerMesh.userData.importedAircraft) disposeDouglas(this.playerMesh);
      else this.disposeModel(this.playerMesh);
    }
    this.playerMesh = type === "sbd" ? createDouglas(true) : makeDauntless(true);
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
    for (const ship of b.ships) if (ship.kind === "carrier" && (ship.team === "us" || ship.name === "Akagi")) {
      const deck = DECKS[ship.team !== "us" ? "akagi" : ship.name === "USS Enterprise" ? "enterprise" : "hornet"];
      ship.length = deck.length;
      ship.width = deck.width;
      ship.visualLength = deck.visualLength;
    }
    this.snap = true;
    this.followBomb = false;
    this.lookYaw = this.lookPitch = 0;
    this.particles.reset();
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
      m.position.set(s.x, s.kind === "sub" && !s.surfaced ? -7 : s.y, s.z);
      m.rotation.set(Math.sin(time * 0.3 + s.baseZ) * 0.004, -s.heading, s.sunk ? s.sink * 0.35 : Math.sin(time * 0.22 + s.baseX) * 0.004 + (1 - s.hp / s.maxHp) * 0.035);
      m.visible = s.sink < 0.95;
      const d = distance2(s, p);
      for (const [i, a] of ((m.userData.parked ?? []) as T.Object3D[]).entries()) {
        a.visible = d < 1900 && i < Math.ceil(s.reserve / 2);
        const child = a as T.Group;
        if (child.userData.parkedDouglas) animateDouglas(child, { rpm: .12, gearPos: 1 }, dt);
        else if (child.userData.prop) {
          (child.userData.prop as T.Object3D).rotation.z = time * 14;
          (child.userData.gear as T.Object3D).visible = true;
        }
      }
      if (m.userData.elevator) (m.userData.elevator as T.Object3D).position.y = 19.85 - (d < 800 && Math.sin(time * 0.12) > 0 ? Math.sin(time * 0.12) * 5 : 0);

    }
    this.crew.visible = p.mode === "deck" || p.mode === "service" || p.mode === "arrest" || briefing;
    this.crew.position.z = (briefing ? -90 : 0) + Math.sin(time * 0.9) * 0.4;
    const live = new Set<string>();
    for (const a of b.aircraft) {
      live.add(a.id);
      let m = this.meshes.get(a.id) as T.Group | undefined;
      if (!m) {
        m = makeAircraft(a.team, a.kind, false);
        m.scale.multiplyScalar(1.15);
        addDamageVisuals(m);
        if (a.kind === "torpedo") {
          (m.userData.load as T.Object3D).visible = false;
          const torpedo = makeTorpedoModel();
          torpedo.position.set(0, -1.03, -0.1);
          m.add(torpedo);
          m.userData.torpedoLoad = torpedo;
        }
        m.userData.kind = a.kind;
        this.scene.add(m);
        this.meshes.set(a.id, m);
      }
      m.position.set(a.x, a.y, a.z);
      m.rotation.set(a.pitch, -a.heading, a.roll, "YXZ");
      (m.userData.prop as T.Object3D).rotation.z += dt * (a.engineCut ? 8 : 55);
      (m.userData.gear as T.Object3D).visible = (a.mode === "launch" && a.age < 4) || (a.mode === "rtb" && a.y < 80);
      (m.userData.load as T.Object3D).visible = a.bombs > 0;
      if (m.userData.torpedoLoad) (m.userData.torpedoLoad as T.Object3D).visible = a.torpedo > 0;
      updateDamageVisuals(m, a);
      m.visible = distance2(a, p) < 18000;
    }
    for (const [id, m] of this.meshes) if (id.startsWith("air-") && !live.has(id)) {
      this.scene.remove(m);
      this.disposeModel(m);
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
    if (this.playerMesh.userData.importedAircraft) animateDouglas(this.playerMesh, p, dt);
    else animateDauntless(this.playerMesh, p, dt);
    updateDamageVisuals(this.playerMesh, p);
    this.playerMesh.visible = b.status !== "lost";
    this.updateProjectiles();
    this.updateCamera(dt, briefing, time);
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
      this.camera.fov = 79;
    } else {
      const distance = this.cameraMode === 2 ? 58 : 18;
      const sign = this.rear ? 1 : -1;
      const up = this.cameraMode === 2 ? 12 : 4.2;
      this.targetCamera.set(p.x + f.x * distance * sign, p.y + f.y * distance * sign + up, p.z + f.z * distance * sign);
      this.look.set(p.x + f.x * (this.rear ? -35 : 40), p.y + f.y * (this.rear ? -35 : 40) + 1.5, p.z + f.z * (this.rear ? -35 : 40));
      this.camera.fov = this.cameraMode === 2 ? 60 : 56;
    }
    if (this.playerMesh.userData.crew) this.playerMesh.userData.crew[0].visible = !cockpit;
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

  disposeModel(group: T.Object3D): void {
    group.traverse((o) => {
      const mesh = o as T.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
    });
  }
}
