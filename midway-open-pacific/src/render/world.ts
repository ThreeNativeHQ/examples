/** The battle's Three.js world, built into the scene the framework owns. */
import * as T from "three";
import { attitudeAxes } from "../sim/flight.js";
import { clamp, distance2, forward, rng } from "../sim/math.js";
import { ellipsoid, makeAircraft, makeCrew, makeIsland, makeShip, mat, cloudTexture, smokeTexture, wakeTexture } from "./assets.js";
import { animateDauntless, makeDauntless } from "./dauntless.js";
import { addDamageVisuals, makeTorpedoModel, updateDamageVisuals } from "./model-damage.js";
import { createOcean, createWaterMesh } from "./ocean.js";
import { CombatParticles } from "./particles.js";
import type { SpectralOcean } from "@threenative/core";
import { color, dot, float, mix, normalize, positionLocal, pow, smoothstep, vec3 } from "three/tsl";
import { MeshBasicNodeMaterial } from "three/webgpu";

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
  smokeTex: T.Texture;
  cloudTex: T.Texture;
  wakeTex: T.Texture;
  ocean!: SpectralOcean;
  sea!: T.Mesh;
  sky!: T.Mesh;
  clouds: T.Sprite[] = [];
  crew!: T.Group;
  playerMesh!: T.Group;
  flash!: T.Sprite;
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
    this.renderer.shadowMap.enabled = false;
    this.renderer.shadowMap.type = T.BasicShadowMap;
    this.scene.fog = new T.FogExp2(0x8fa9b4, 0.000028);
    const hemi = new T.HemisphereLight(0xc6dbe4, 0x34545f, 0.7);
    this.scene.add(hemi);
    this.sun = new T.DirectionalLight(0xffddb8, 1.65);
    this.sun.position.set(-200, 140, -240);
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);
    this.sun.castShadow = false;
    this.sun.shadow.mapSize.set(2048, 2048);
    Object.assign(this.sun.shadow.camera, { left: -80, right: 80, top: 80, bottom: -80, near: 1, far: 850 });
    this.sun.shadow.bias = -0.000035;
    this.sun.shadow.normalBias = 0.018;
    this.sunDir = new T.Vector3(-0.62, 0.23, -0.75).normalize();
    this.smokeTex = smokeTexture();
    this.cloudTex = cloudTexture();
    this.wakeTex = wakeTexture();
    this.makeSky();
    this.makeOcean();
    this.makeClouds();
    this.makeWorld();
    this.makeTracers();
    this.particles = new CombatParticles(this.scene);
  }

  makeSky(): void {
    // A TSL node material, so the same sky runs on the WebGPU backend as on web. The sphere is
    // centred on the camera each frame; `positionLocal` is therefore the view direction.
    const material = new MeshBasicNodeMaterial({ side: T.BackSide, depthWrite: false, fog: false });
    const direction = normalize(positionLocal);
    const height = direction.y.max(0);
    // Linear values, copied from the standalone build's sky shader. `color(hex)` would convert
    // them from sRGB first and darken the whole sky.
    const horizon = vec3(0.34, 0.49, 0.57);
    const zenith = vec3(0.055, 0.2, 0.36);
    const sun = normalize(vec3(-0.62, 0.23, -0.75));
    const facing = dot(direction, sun).max(0);
    const gradient = mix(horizon, zenith, pow(height, float(0.46)));
    const glow = vec3(0.5, 0.28, 0.11).mul(pow(facing, float(9)).mul(0.75));
    const disk = vec3(4, 2.9, 1.8).mul(pow(facing, float(2100)));
    const sky = gradient.add(glow).add(disk);
    const belowMix = float(1).sub(smoothstep(float(-0.12), float(0), direction.y));
    material.colorNode = mix(sky, vec3(0.3, 0.43, 0.46), belowMix);
    this.sky = new T.Mesh(new T.SphereGeometry(70000, 32, 16), material);
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -10;
    this.scene.add(this.sky);
  }

  makeOcean(): void {
    // `ctx.add` hands the compute-driven SpectralOcean to the renderer so its cascades run.
    this.ocean = this.host.add(createOcean()) as SpectralOcean;
    this.sea = createWaterMesh(this.ocean);
    this.scene.add(this.sea);
  }

  makeClouds(): void {
    const random = rng(1842);
    const material = new T.SpriteMaterial({ map: this.cloudTex, color: 0xf8efe0, transparent: true, opacity: 0.3, depthWrite: false, fog: true });
    for (let i = 0; i < 65; i += 1) {
      const s = new T.Sprite(material);
      s.position.set((random() - 0.5) * 46000, 1300 + random() * 1600, (random() - 0.5) * 45000);
      const k = 850 + random() * 1900;
      s.scale.set(k, k * 0.47, 1);
      s.userData.origin = s.position.x;
      this.scene.add(s);
      this.clouds.push(s);
    }
  }

  makeWorld(): void {
    const b = this.battle;
    for (const s of b.ships) {
      const mesh = makeShip(s);
      this.scene.add(mesh);
      this.meshes.set(s.id, mesh);
      const wake = new T.Mesh(
        new T.PlaneGeometry(s.width * 5, s.length * 2.5),
        new T.MeshBasicMaterial({ map: this.wakeTex, transparent: true, opacity: 0.52, depthWrite: false, side: T.DoubleSide }),
      );
      wake.rotation.x = -Math.PI / 2;
      wake.position.set(0, 0.65, s.length * 1.55);
      mesh.add(wake);
      mesh.userData.wake = wake;
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
      this.scene.remove(this.playerMesh);
      this.playerMesh.userData.instruments?.texture.dispose();
      this.disposeModel(this.playerMesh);
    }
    this.playerMesh = makeDauntless(type === "tbd");
    addDamageVisuals(this.playerMesh);
    this.scene.add(this.playerMesh);
    this.flash = new T.Sprite(new T.SpriteMaterial({ map: this.smokeTex, color: 0xffe5a4, transparent: true, opacity: 0, depthWrite: false, blending: T.AdditiveBlending }));
    this.flash.position.set(0, 0.25, -5.2);
    this.flash.scale.set(3, 3, 1);
    this.playerMesh.add(this.flash);
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
    this.renderer.shadowMap.enabled = false;
    for (let i = 0; i < this.clouds.length; i += 1) this.clouds[i].visible = q !== "low" || i % 2 === 0;
  }

  reset(b: any): void {
    this.battle = b;
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
    this.ocean.advance(time);
    this.sea.position.set(this.camera.position.x, 0, this.camera.position.z);
    for (const c of this.clouds) c.position.x = c.userData.origin + time * 3;
    for (const s of b.ships) {
      const m = this.meshes.get(s.id);
      if (!m) continue;
      m.position.set(s.x, s.kind === "sub" && !s.surfaced ? -7 : s.y, s.z);
      m.rotation.set(Math.sin(time * 0.3 + s.baseZ) * 0.004, -s.heading, s.sunk ? s.sink * 0.35 : Math.sin(time * 0.22 + s.baseX) * 0.004 + (1 - s.hp / s.maxHp) * 0.035);
      m.visible = s.sink < 0.95;
      const d = distance2(s, p);
      for (const [i, a] of (m.userData.parked as T.Object3D[]).entries()) {
        a.visible = d < 1900 && i < Math.ceil(s.reserve / 2);
        const child = a as T.Group;
        (child.userData.prop as T.Object3D).rotation.z = time * 14;
        (child.userData.gear as T.Object3D).visible = true;
      }
      (m.userData.elevator as T.Object3D).position.y = 19.85 - (d < 800 && Math.sin(time * 0.12) > 0 ? Math.sin(time * 0.12) * 5 : 0);
      const wake = m.userData.wake as T.Mesh;
      wake.visible = false;
      (wake.material as T.MeshBasicMaterial).opacity = s.kind === "sub" ? 0.2 : 0.5;
    }
    this.crew.visible = p.mode === "deck" || p.mode === "service" || p.mode === "arrest" || briefing;
    this.crew.position.z = Math.sin(time * 0.9) * 0.4;
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
    this.playerMesh.position.set(p.x, p.y, p.z);
    if (p.attitude) this.playerMesh.quaternion.set(p.attitude.x, p.attitude.y, p.attitude.z, p.attitude.w);
    else this.playerMesh.rotation.set(p.pitch, -p.heading, p.roll, "YXZ");
    animateDauntless(this.playerMesh, p, dt);
    updateDamageVisuals(this.playerMesh, p);
    this.playerMesh.visible = b.status !== "lost";
    this.flash.material.opacity = p.heat * 0.7;
    this.updateProjectiles();
    this.updateCamera(dt, briefing, time);
    this.particles.update(b, this.camera.position);
    this.sky.position.copy(this.camera.position);
    this.sun.position.set(p.x - 260, p.y + 220, p.z - 320);
    this.sun.target.position.set(p.x, p.y, p.z);
  }

  updateCamera(dt: number, briefing: boolean, time: number): void {
    const p = this.battle.player;
    const axes = p.attitude ? attitudeAxes(p) : { f: forward(p.heading, p.pitch), u: { x: 0, y: 1, z: 0 }, r: { x: 1, y: 0, z: 0 } };
    const f = axes.f;
    const u = axes.u;
    const ownBomb = [...this.battle.bombs, ...this.battle.airTorpedoes, ...this.battle.torpedoes].filter((a: any) => a.owner === "player").at(-1);
    let cockpit = false;
    if (briefing) {
      this.targetCamera.set(p.x + 17 + Math.sin(time * 0.055) * 2, p.y + 6.5, p.z + 21);
      this.look.set(p.x - 5, p.y - 0.1, p.z - 4);
      this.camera.fov = 49;
    } else if (this.followBomb && ownBomb) {
      this.targetCamera.set(ownBomb.x + 12, ownBomb.y + 16, ownBomb.z + 28);
      this.look.set(ownBomb.x + ownBomb.vx * 0.6, ownBomb.y + (ownBomb.vy ?? 0) * 0.6, ownBomb.z + ownBomb.vz * 0.6);
      this.camera.fov = 65;
    } else if (this.cameraMode === 1) {
      cockpit = true;
      this.playerMesh.updateMatrixWorld(true);
      this.targetCamera.set(0, 1.235, -0.57);
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
      const distance = this.cameraMode === 2 ? 58 : 24;
      const sign = this.rear ? 1 : -1;
      const up = this.cameraMode === 2 ? 12 : 5.2;
      this.targetCamera.set(p.x + f.x * distance * sign, p.y + f.y * distance * sign + up, p.z + f.z * distance * sign);
      this.look.set(p.x + f.x * (this.rear ? -35 : 40), p.y + f.y * (this.rear ? -35 : 40) + 1.5, p.z + f.z * (this.rear ? -35 : 40));
      this.camera.fov = this.cameraMode === 2 ? 60 : 56;
    }
    this.playerMesh.userData.crew[0].visible = !cockpit;
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
      const length = a.type === "flak" ? 0.035 : 0.045;
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
