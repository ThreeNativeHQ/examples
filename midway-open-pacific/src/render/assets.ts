/** Procedural geometry and textures. No copyrighted game assets or image downloads. */
import * as THREE from "three";

const materialCache = new Map<string, THREE.MeshStandardMaterial>();

export function mat(color: number, opts: Record<string, unknown> = {}): THREE.MeshStandardMaterial {
  const key = String(color) + JSON.stringify(opts);
  let m = materialCache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color: new THREE.Color(color).convertLinearToSRGB(), roughness: 0.68, metalness: 0.18, ...opts });
    materialCache.set(key, m);
  }
  return m;
}

export function box(
  parent: THREE.Object3D,
  w: number,
  h: number,
  d: number,
  x: number,
  y: number,
  z: number,
  m: THREE.Material | number,
): THREE.Mesh {
  const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), typeof m === "number" ? mat(m) : m);
  o.position.set(x, y, z);
  parent.add(o);
  return o;
}

export function ellipsoid(
  parent: THREE.Object3D,
  x: number,
  y: number,
  z: number,
  sx: number,
  sy: number,
  sz: number,
  m: THREE.Material,
  segments = 16,
): THREE.Mesh {
  const o = new THREE.Mesh(new THREE.SphereGeometry(1, segments, 10), m);
  o.position.set(x, y, z);
  o.scale.set(sx, sy, sz);
  parent.add(o);
  return o;
}

export function cylinder(
  parent: THREE.Object3D,
  r1: number,
  r2: number,
  height: number,
  x: number,
  y: number,
  z: number,
  m: THREE.Material,
  segments = 12,
): THREE.Mesh {
  const o = new THREE.Mesh(new THREE.CylinderGeometry(r1, r2, height, segments), m);
  o.position.set(x, y, z);
  parent.add(o);
  return o;
}

export function rod(
  parent: THREE.Object3D,
  a: number[],
  b: number[],
  r: number,
  m: THREE.Material,
): THREE.Mesh {
  const A = new THREE.Vector3(...(a as [number, number, number]));
  const B = new THREE.Vector3(...(b as [number, number, number]));
  const v = B.clone().sub(A);
  const o = cylinder(parent, r, r, v.length(), 0, 0, 0, m, 8);
  o.position.copy(A.add(B).multiplyScalar(0.5));
  o.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), v.normalize());
  return o;
}

export function canvasTexture(
  w: number,
  h: number,
  draw: (c: CanvasRenderingContext2D, w: number, h: number) => void,
): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  draw(c.getContext("2d") as CanvasRenderingContext2D, w, h);
  const tx = new THREE.CanvasTexture(c);
  tx.colorSpace = THREE.SRGBColorSpace;
  tx.anisotropy = 4;
  return tx;
}

/** Merge static components by material to avoid a draw call for every bolt and window. */
export function consolidate(group: THREE.Object3D): THREE.Group {
  group.updateMatrixWorld(true);
  const batches = new Map<string, { material: THREE.Material; positions: number[]; normals: number[]; uv: number[] }>();
  group.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const geometry = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
    geometry.applyMatrix4(mesh.matrixWorld);
    const id = (mesh.material as THREE.Material).uuid;
    let b = batches.get(id);
    if (!b) {
      b = { material: mesh.material as THREE.Material, positions: [], normals: [], uv: [] };
      batches.set(id, b);
    }
    b.positions.push(...Array.from(geometry.attributes.position.array as ArrayLike<number>));
    b.normals.push(...Array.from(geometry.attributes.normal.array as ArrayLike<number>));
    if (geometry.attributes.uv) b.uv.push(...Array.from(geometry.attributes.uv.array as ArrayLike<number>));
    else b.uv.push(...new Float32Array(geometry.attributes.position.count * 2));
    geometry.dispose();
  });
  const result = new THREE.Group();
  for (const b of batches.values()) {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(b.positions, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(b.normals, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(b.uv, 2));
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, b.material);
    m.castShadow = true;
    m.receiveShadow = true;
    result.add(m);
  }
  return result;
}

function roundel(team: string): THREE.CanvasTexture {
  return canvasTexture(128, 128, (c) => {
    c.fillStyle = team === "us" ? "#193446" : "#eee5cf";
    c.beginPath();
    c.arc(64, 64, 58, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = team === "us" ? "#f3eee0" : "#a73130";
    if (team === "jp") {
      c.beginPath();
      c.arc(64, 64, 45, 0, Math.PI * 2);
      c.fill();
    } else {
      c.beginPath();
      for (let i = 0; i < 10; i += 1) {
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        const r = i % 2 ? 21 : 51;
        c.lineTo(64 + Math.cos(a) * r, 64 + Math.sin(a) * r);
      }
      c.closePath();
      c.fill();
    }
  });
}

const roundelM: Record<string, THREE.MeshBasicMaterial> = {};
function emblem(team: string): THREE.MeshBasicMaterial {
  if (!roundelM[team]) roundelM[team] = new THREE.MeshBasicMaterial({ map: roundel(team), transparent: true, depthWrite: false, side: THREE.DoubleSide });
  return roundelM[team];
}

function wing(parent: THREE.Object3D, span: number, chord: number, m: THREE.Material, y = 0, z = 0): THREE.Mesh {
  const shape = new THREE.Shape();
  shape.moveTo(-span / 2, chord * 0.25);
  shape.quadraticCurveTo(-span * 0.54, -chord * 0.05, -span * 0.45, -chord * 0.35);
  shape.lineTo(-1, -chord * 0.55);
  shape.lineTo(1, -chord * 0.55);
  shape.lineTo(span * 0.45, -chord * 0.35);
  shape.quadraticCurveTo(span * 0.54, -chord * 0.05, span / 2, chord * 0.25);
  shape.lineTo(span * 0.43, chord * 0.45);
  shape.lineTo(-span * 0.43, chord * 0.45);
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.14, bevelEnabled: true, bevelSize: 0.045, bevelThickness: 0.025, bevelSegments: 1, steps: 1, curveSegments: 8 });
  geo.rotateX(Math.PI / 2);
  const mesh = new THREE.Mesh(geo, m);
  mesh.position.set(0, y, z);
  parent.add(mesh);
  return mesh;
}

export function makeAircraft(team = "us", kind = "bomber", detail = true): THREE.Group {
  const root = new THREE.Group();
  const body = new THREE.Group();
  const blue = mat(team === "us" ? 0x526f82 : 0xb5b8a6);
  const dark = mat(team === "us" ? 0x354956 : 0x435449);
  const light = mat(0xbcc2b6);
  const black = mat(0x202a2c);
  const metal = mat(0x747b77, { metalness: 0.7, roughness: 0.32 });
  const isFighter = kind === "fighter";
  const span = isFighter ? 10.8 : 12.8;
  const profile = [new THREE.Vector2(0.1, -5), new THREE.Vector2(0.28, -4), new THREE.Vector2(0.6, -2), new THREE.Vector2(0.78, 0), new THREE.Vector2(0.84, 2), new THREE.Vector2(0.82, 3.65), new THREE.Vector2(0.65, 4.25)];
  const fuselage = new THREE.Mesh(new THREE.LatheGeometry(profile, detail ? 20 : 10), blue);
  fuselage.rotation.x = -Math.PI / 2;
  body.add(fuselage);
  ellipsoid(body, 0, -0.27, 0, 0.73, 0.59, 3.5, light, 12);
  const cow = cylinder(body, 0.87, 0.85, 1.15, 0, 0, -3.9, dark, 20);
  cow.rotation.x = Math.PI / 2;
  const lip = cylinder(body, 0.72, 0.83, 0.12, 0, 0, -4.52, metal, 20);
  lip.rotation.x = Math.PI / 2;
  wing(body, span, 2.9, blue, -0.2, -0.15);
  wing(body, 4.7, 1.5, blue, 0.23, 3.6);
  const fin = new THREE.Shape();
  fin.moveTo(2.7, 0.2);
  fin.lineTo(4.3, 2.25);
  fin.quadraticCurveTo(5.1, 2.4, 5.0, 1.5);
  fin.lineTo(4.95, 0);
  fin.closePath();
  const fg = new THREE.ExtrudeGeometry(fin, { depth: 0.13, bevelEnabled: false, curveSegments: 5 });
  fg.rotateY(-Math.PI / 2);
  const tail = new THREE.Mesh(fg, blue);
  tail.position.x = 0.07;
  body.add(tail);
  for (const x of [-span * 0.32, span * 0.32]) {
    const mark = new THREE.Mesh(new THREE.PlaneGeometry(1.65, 1.65), emblem(team));
    mark.rotation.x = -Math.PI / 2;
    mark.position.set(x, -0.1, -0.1);
    body.add(mark);
  }
  for (const x of [-0.805, 0.805]) {
    const mark = new THREE.Mesh(new THREE.PlaneGeometry(0.98, 0.98), emblem(team));
    mark.rotation.y = x > 0 ? Math.PI / 2 : -Math.PI / 2;
    mark.position.set(x, 0.14, 1.8);
    body.add(mark);
  }
  const glass = new THREE.MeshPhongMaterial({ color: 0x739fba, transparent: true, opacity: 0.76, shininess: 95, side: THREE.DoubleSide });
  ellipsoid(body, 0, 0.76, 0.05, 0.57, 0.64, isFighter ? 1.05 : 1.85, glass, 12);
  if (detail) {
    for (const z of [-1.45, -0.65, 0.2, 1.0, 1.58]) {
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i <= 10; i += 1) {
        const a = (i / 10) * Math.PI;
        pts.push(new THREE.Vector3(Math.cos(a) * 0.55, 0.7 + Math.sin(a) * 0.65, z));
      }
      body.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 10, 0.028, 4, false), metal));
    }
    rod(body, [0, 1.38, -1.4], [0, 1.38, 1.4], 0.026, metal);
    ellipsoid(body, 0, 0.82, -0.5, 0.23, 0.31, 0.21, mat(0x6f5840), 10);
    for (const x of [-0.48, 0.48]) rod(body, [x, 0.52, -2.8], [x, 0.5, -4.35], 0.052, black);
    for (const x of [-1, 1]) {
      rod(body, [x * 1.2, -0.08, 2.6], [x * 2, 0.25, 3.6], 0.025, metal);
      for (let i = 1; i < 5; i += 1) box(body, 0.02, 0.012, 2.0, x * (1 + i), -0.098, -0.05, dark);
      box(body, 4.1, 0.014, 0.025, x * 3.6, -0.09, 0.9, dark);
    }
    const number = new THREE.Mesh(
      new THREE.PlaneGeometry(0.55, 0.6),
      new THREE.MeshBasicMaterial({
        map: canvasTexture(96, 96, (c) => {
          c.fillStyle = "#eae3ce";
          c.font = "bold 76px sans-serif";
          c.textAlign = "center";
          c.fillText("6", 48, 78);
        }),
        transparent: true,
        side: THREE.DoubleSide,
      }),
    );
    number.rotation.y = Math.PI / 2;
    number.position.set(0.53, 0.1, 3.2);
    body.add(number);
  }
  root.add(consolidate(body));
  const prop = new THREE.Group();
  prop.position.z = -4.75;
  for (let i = 0; i < 3; i += 1) {
    const blade = new THREE.Group();
    blade.rotation.z = (i * Math.PI * 2) / 3;
    box(blade, 0.18, 1.6, 0.045, 0, 0.9, 0, black);
    box(blade, 0.18, 0.19, 0.048, 0, 1.64, -0.005, mat(0xceb469));
    prop.add(blade);
  }
  const spinner = cylinder(prop, 0.02, 0.28, 0.5, 0, 0, -0.15, metal);
  spinner.rotation.x = -Math.PI / 2;
  const disk = new THREE.Mesh(new THREE.CircleGeometry(1.8, 32), new THREE.MeshBasicMaterial({ color: 0xbec3ad, transparent: true, opacity: 0.085, side: THREE.DoubleSide, depthWrite: false }));
  prop.add(disk);
  root.add(prop);
  const gear = new THREE.Group();
  for (const x of [-1.5, 1.5]) {
    rod(gear, [x, -0.3, -0.1], [x, -1.72, -0.5], 0.085, metal);
    const wheel = cylinder(gear, 0.51, 0.51, 0.32, x, -1.85, -0.5, black, 14);
    wheel.rotation.z = Math.PI / 2;
    const hub = cylinder(gear, 0.21, 0.21, 0.34, x, -1.85, -0.5, metal, 12);
    hub.rotation.z = Math.PI / 2;
  }
  const tw = cylinder(gear, 0.22, 0.22, 0.17, 0, -0.65, 4.25, black, 10);
  tw.rotation.z = Math.PI / 2;
  root.add(gear);
  const brakes = new THREE.Group();
  for (const sign of [-1, 1]) {
    const flap = box(brakes, 4.35, 0.05, 0.75, sign * 3.8, -0.06, 1.17, mat(0x934033));
    flap.rotation.x = -0.6;
    for (let i = 0; i < 10; i += 1) {
      const hole = new THREE.Mesh(new THREE.CircleGeometry(0.075, 7), black);
      hole.rotation.x = -Math.PI / 2 - 0.6;
      hole.position.set(sign * (1.9 + i * 0.39), 0.04, 1.3);
      brakes.add(hole);
    }
  }
  root.add(brakes);
  brakes.visible = false;
  const load = new THREE.Group();
  ellipsoid(load, 0, -1.12, 0.2, 0.27, 0.27, 1.0, mat(0x656446), 12);
  box(load, 0.8, 0.04, 0.45, 0, -1.12, 1.05, mat(0x656446));
  root.add(load);
  if (kind === "recon") {
    root.scale.setScalar(1.4);
    for (const x of [-2.2, 2.2]) ellipsoid(root, x, -1, 0, 0.45, 0.6, 1.3, blue);
  }
  root.userData = { prop, gear, brakes, load };
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh) {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    }
  });
  return root;
}

function deckTexture(japanese: boolean): THREE.CanvasTexture {
  return canvasTexture(512, 2048, (c, w, h) => {
    c.fillStyle = japanese ? "#867c63" : "#656c6b";
    c.fillRect(0, 0, w, h);
    for (let i = 0; i < w; i += 7) {
      c.fillStyle = `rgba(${i % 3 ? 18 : 230},${i % 3 ? 25 : 219},${i % 3 ? 22 : 189},.12)`;
      c.fillRect(i, 0, 1, h);
    }
    for (let i = 0; i < 1800; i += 1) {
      const x = (Math.sin(i * 78.3) * 43758.54) % 1;
      const y = (Math.sin(i * 32.1) * 12354.4) % 1;
      c.fillStyle = "rgba(15,22,24,.12)";
      c.fillRect(Math.abs(x * w), Math.abs(y * h), 1, 12 + (i % 11));
    }
    c.strokeStyle = "#c9c3a6";
    c.lineWidth = 5;
    c.setLineDash([48, 30]);
    c.beginPath();
    c.moveTo(w * 0.5, 40);
    c.lineTo(w * 0.5, h - 40);
    c.stroke();
    c.setLineDash([]);
    c.lineWidth = 3;
    c.strokeStyle = "rgba(217,211,184,.6)";
    for (const x of [w * 0.19, w * 0.81]) {
      c.beginPath();
      c.moveTo(x, 20);
      c.lineTo(x, h - 20);
      c.stroke();
    }
    for (const y of [h * 0.28, h * 0.72]) {
      c.fillStyle = "#525c5c";
      c.fillRect(w * 0.25, y, w * 0.5, h * 0.072);
      c.strokeStyle = "#a19e84";
      c.lineWidth = 2;
      c.strokeRect(w * 0.25, y, w * 0.5, h * 0.072);
    }
    for (let i = 0; i < 8; i += 1) {
      const y = h * 0.75 + i * 22;
      c.strokeStyle = "rgba(14,22,23,.72)";
      c.lineWidth = 3;
      c.beginPath();
      c.moveTo(45, y);
      c.lineTo(w - 45, y);
      c.stroke();
    }
    c.fillStyle = "#ded7b7";
    c.font = "bold 130px sans-serif";
    c.textAlign = "center";
    c.fillText(japanese ? "" : "6", w * 0.5, h * 0.15);
    if (japanese) {
      c.fillStyle = "#963c35";
      c.beginPath();
      c.arc(w / 2, h * 0.12, 66, 0, Math.PI * 2);
      c.fill();
    }
  });
}

function hullGeometry(length: number, width: number, depth: number, deck = false): THREE.ExtrudeGeometry {
  const L = length / 2;
  const W = width / 2;
  const s = new THREE.Shape();
  if (deck) {
    s.moveTo(-W * 0.72, -L);
    s.lineTo(W * 0.72, -L);
    s.lineTo(W, -L * 0.86);
    s.lineTo(W, L * 0.86);
    s.lineTo(W * 0.75, L);
    s.lineTo(-W * 0.75, L);
    s.lineTo(-W, L * 0.86);
    s.lineTo(-W, -L * 0.86);
  } else {
    s.moveTo(0, -L);
    s.quadraticCurveTo(W * 0.8, -L * 0.88, W, -L * 0.5);
    s.lineTo(W, L * 0.8);
    s.quadraticCurveTo(W * 0.9, L, 0, L);
    s.quadraticCurveTo(-W * 0.9, L, -W, L * 0.8);
    s.lineTo(-W, -L * 0.5);
    s.quadraticCurveTo(-W * 0.8, -L * 0.88, 0, -L);
  }
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false, curveSegments: 8 });
  g.rotateX(Math.PI / 2);
  return g;
}

/**
 * Recognition features for the procedural carrier hulls, keyed by ship name. These are
 * silhouette cues the player can read at range, not random variation:
 *   Akagi    — port island and a single starboard funnel: the class's signature layout.
 *   Kaga     — port island, a single long downturned starboard funnel, longest/beamier hull.
 *   Soryu    — starboard island, two downturned funnels, compact hull.
 *   Hiryu    — amidships port island, two downturned funnels, compact hull.
 *   Yorktown — starboard island, a single straight funnel, full-length hull.
 *   Hornet   — as Yorktown, but a lighter island and marginally shorter hull.
 * funnels holds the funnel z offsets (its length is the funnel count). Hull/beam scale the
 * drawn geometry only: ship.length and ship.width stay the simulation's collision numbers.
 */
type CarrierProfile = {
  side: number;
  funnelSide: number;
  hull: number;
  beam: number;
  island: number;
  islandHeight: number;
  funnels: number[];
  funnelTilt: number;
};

const CARRIER_FALLBACK: CarrierProfile = { side: 1, funnelSide: 1, hull: 1, beam: 1, island: 1, islandHeight: 1, funnels: [-15], funnelTilt: 0 };
const CARRIER_PROFILES: Record<string, CarrierProfile> = {
  Akagi: { side: -1, funnelSide: 1, hull: 1.06, beam: 1.05, island: 1, islandHeight: 1, funnels: [-15], funnelTilt: 0.3 },
  Kaga: { side: -1, funnelSide: 1, hull: 1.1, beam: 1.08, island: 1.05, islandHeight: 1.03, funnels: [-17], funnelTilt: 0.42 },
  Soryu: { side: 1, funnelSide: 1, hull: 0.92, beam: 0.94, island: 0.9, islandHeight: 0.95, funnels: [-24, -10], funnelTilt: 0.34 },
  Hiryu: { side: -1, funnelSide: -1, hull: 0.94, beam: 0.95, island: 0.92, islandHeight: 0.96, funnels: [-26, -11], funnelTilt: 0.38 },
  "USS Yorktown": { side: 1, funnelSide: 1, hull: 1, beam: 1, island: 1, islandHeight: 1, funnels: [-15], funnelTilt: 0 },
  "USS Hornet": { side: 1, funnelSide: 1, hull: 0.99, beam: 0.99, island: 0.97, islandHeight: 0.98, funnels: [-15], funnelTilt: 0 },
};

export function makeShip(ship: any): THREE.Group {
  const root = new THREE.Group();
  const body = new THREE.Group();
  const cv = ship.kind === "carrier";
  const sub = ship.kind === "sub";
  const jp = ship.team === "jp";
  const profile = CARRIER_PROFILES[ship.name] ?? { ...CARRIER_FALLBACK, side: jp ? -1 : 1, funnelSide: jp ? -1 : 1 };
  const grey = mat(jp ? 0x666e69 : 0x5b6b73);
  const dark = mat(0x35444b);
  const light = mat(0x96a39f);
  const black = mat(0x192c34);
  const wood = mat(jp ? 0x847b60 : 0x677371);
  const metal = mat(0x667270);
  const hull = new THREE.Mesh(hullGeometry(ship.length, ship.width * (cv ? 0.86 : 1), cv ? 17 : sub ? 5 : 9), grey);
  hull.position.y = cv ? 16 : sub ? 3 : 8;
  body.add(hull);
  const water = new THREE.Mesh(hullGeometry(ship.length * 0.99, ship.width * (cv ? 0.875 : 1.015), 1.4), dark);
  water.position.y = 1.5;
  body.add(water);
  const deck = new THREE.Mesh(hullGeometry(ship.length * (cv ? 1 : 0.92), ship.width, cv ? 1.4 : 1, cv), wood);
  deck.position.y = cv ? 20 : sub ? 3.5 : 9;
  body.add(deck);
  const parked: THREE.Object3D[] = [];
  const elevator = new THREE.Group();
  if (cv) {
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(ship.width, ship.length), new THREE.MeshStandardMaterial({ map: deckTexture(jp), roughness: 0.94, metalness: 0 }));
    plane.rotation.x = -Math.PI / 2;
    plane.position.y = 20.03;
    body.add(plane);
    for (const x of [-17.9, 17.9]) {
      box(body, 0.65, 1.1, 160, x, 16.5, 4, grey);
      for (let i = 0; i < 12; i += 1) rod(body, [x, 16.5, -75 + i * 14], [x * 0.8, 7, -72 + i * 14], 0.25, grey);
    }
    const side = profile.side;
    const island = new THREE.Group();
    box(island, 8, 5, 34, side * 13, 22.5, -28, grey);
    box(island, 10, 4, 21, side * 13, 27, -34, grey);
    box(island, 11, 2.3, 15, side * 13, 30.1, -38, light);
    box(island, 11.15, 1.12, 15.1, side * 13, 30.35, -38, black);
    box(island, 11.5, 0.65, 15.7, side * 13, 31.85, -38, grey);
    box(island, 6.4, 4.7, 9, side * 13, 34.6, -39, grey);
    box(island, 6.6, 0.9, 9.2, side * 13, 35, -39, black);
    box(island, 7, 0.6, 9.7, side * 13, 37.2, -39, light);
    rod(island, [side * 13, 36, -32], [side * 13, 52, -32], 0.21, metal);
    rod(island, [side * 7, 45, -32], [side * 19, 45, -32], 0.13, metal);
    box(island, 5.8, 2.8, 0.3, side * 13, 50, -32, black);
    for (let i = 0; i < 6; i += 1) rod(island, [side * 10.5 + i, 48.6, -32.3], [side * 10.5 + i, 51.4, -32.3], 0.055, light);
    const islandBase = new THREE.Vector3(side * 13, 20, -33);
    for (const part of island.children) part.position.sub(islandBase);
    island.position.copy(islandBase);
    island.scale.set(profile.island, profile.islandHeight, profile.island);
    body.add(island);
    for (const fz of profile.funnels) {
      const funnel = cylinder(body, 3.5, 4.2, 14, profile.funnelSide * 13, 29, fz, dark);
      cylinder(funnel, 3.7, 3.7, 0.7, 0, 7.4, 0, black);
      funnel.rotation.z = -profile.funnelSide * profile.funnelTilt;
    }
    for (const x of [-18.5, 18.5])
      for (const z of [-95, -52, 32, 96]) {
        cylinder(body, 2.8, 2.4, 0.8, x, 14, z, grey);
        cylinder(body, 1.15, 1.4, 1.7, x, 15, z, dark);
        rod(body, [x, 16, z], [x * 1.13, 18, z - 4], 0.16, black);
        rod(body, [x + 0.4, 16, z], [x * 1.13 + 0.4, 18, z - 4], 0.16, black);
      }
    for (let i = 0; i < 6; i += 1) {
      const p = makeAircraft(ship.team, i % 2 ? "bomber" : "fighter", false);
      p.scale.setScalar(0.72);
      p.position.set(i % 2 ? -11 : 11, 22.1, 37 + Math.floor(i / 2) * 20);
      p.rotation.y = i % 2 ? 0.16 : -0.16;
      root.add(p);
      parked.push(p);
    }
    box(elevator, 14, 0.65, 18, 0, 0, 0, dark);
    elevator.position.set(0, 19.9, -68);
    root.add(elevator);
    for (const x of [-18.2, 18.2]) {
      for (let i = 0; i < 20; i += 1) {
        const z = -118 + i * 12;
        rod(body, [x, 19, z], [x * 1.1, 18, z], 0.07, light);
      }
      rod(body, [x * 1.1, 18, -118], [x * 1.1, 18, 110], 0.055, light);
    }
    body.scale.set(profile.beam, 1, profile.hull);
  } else if (sub) {
    box(body, 3.6, 6.5, 11, 0, 6.4, 1, dark);
    rod(body, [0, 9.5, 0], [0, 14.5, 0], 0.12, black);
    rod(body, [0, 14.5, 0], [0, 14.5, -1], 0.12, black);
    cylinder(body, 1.2, 1.5, 0.8, 0, 4, -13, grey);
    rod(body, [0, 5, -13], [0, 6, -17], 0.15, black);
  } else {
    box(body, 8, 5, 22, 0, 11.5, -4, grey);
    box(body, 7, 5, 10, 0, 16, -12, grey);
    box(body, 7.2, 1.5, 10.2, 0, 17, -12, black);
    box(body, 7.8, 0.65, 11, 0, 18, -12, light);
    for (const z of [5, 15]) {
      cylinder(body, 2.2, 2.5, 11, 0, 14, z, dark);
      cylinder(body, 2.3, 2.3, 0.5, 0, 19.8, z, black);
    }
    rod(body, [0, 18, -8], [0, 31, -8], 0.14, metal);
    rod(body, [-5, 26, -8], [5, 26, -8], 0.1, metal);
    for (const z of [-37, -25, 33, 43]) {
      cylinder(body, 2.9, 3.6, 2.5, 0, 10, z, grey);
      box(body, 5, 2, 4, 0, 11.5, z, grey);
      for (const x of [-1, 1]) rod(body, [x, 12, z], [x, 13, z + (z < 0 ? -8 : 8)], 0.22, black);
    }
  }
  root.add(consolidate(body));
  root.userData = { parked, elevator };
  return root;
}

export function makeCrew(): THREE.Group {
  const group = new THREE.Group();
  const yellow = mat(0xc6a951);
  const pants = mat(0x3b5664);
  const skin = mat(0xb89576);
  for (let i = 0; i < 12; i += 1) {
    const man = new THREE.Group();
    const side = i % 2 ? 1 : -1;
    man.position.set(side * (7.5 + (i % 3) * 1.5), 20, 67 + Math.floor(i / 2) * 8);
    box(man, 0.55, 0.85, 0.38, 0, 0.95, 0, i % 3 ? yellow : mat(0xa38677));
    ellipsoid(man, 0, 1.62, 0, 0.21, 0.25, 0.21, skin, 8);
    for (const x of [-0.16, 0.16]) rod(man, [x, 0.6, 0], [x, 0.05, 0], 0.1, pants);
    rod(man, [-0.3, 1.23, 0], [-0.65, 1.1, -0.1], 0.075, yellow);
    rod(man, [0.3, 1.23, 0], [0.55, 1.65, -0.1], 0.075, yellow);
    man.userData.phase = i;
    group.add(consolidate(man));
  }
  return group;
}

export function smokeTexture(): THREE.CanvasTexture {
  return canvasTexture(128, 128, (c) => {
    const g = c.createRadialGradient(64, 64, 0, 64, 64, 62);
    g.addColorStop(0, "rgba(255,255,255,.9)");
    g.addColorStop(0.3, "rgba(245,245,245,.68)");
    g.addColorStop(0.7, "rgba(210,215,220,.25)");
    g.addColorStop(1, "rgba(210,215,220,0)");
    c.fillStyle = g;
    c.fillRect(0, 0, 128, 128);
  });
}

export function cloudTexture(): THREE.CanvasTexture {
  return canvasTexture(512, 256, (c) => {
    for (let i = 0; i < 33; i += 1) {
      const x = 80 + (Math.sin(i * 2.1) + 1) * 170;
      const y = 83 + Math.cos(i * 1.7) * 42;
      const r = 45 + (i % 4) * 15;
      const g = c.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, "rgba(239,230,208,.25)");
      g.addColorStop(0.5, "rgba(233,229,218,.14)");
      g.addColorStop(1, "rgba(221,221,210,0)");
      c.fillStyle = g;
      c.fillRect(0, 0, 512, 256);
    }
  });
}

export function wakeTexture(): THREE.CanvasTexture {
  return canvasTexture(256, 512, (c) => {
    for (let i = 0; i < 110; i += 1) {
      const y = i * 4.5;
      const spread = 8 + y * 0.21;
      const alpha = (1 - i / 110) * 0.22;
      c.strokeStyle = `rgba(210,235,232,${alpha})`;
      c.lineWidth = 4 + (i % 5);
      c.beginPath();
      c.moveTo(128 - spread, y);
      c.lineTo(128 - spread + 14, y + 22);
      c.stroke();
      c.beginPath();
      c.moveTo(128 + spread, y);
      c.lineTo(128 + spread - 14, y + 22);
      c.stroke();
    }
    const g = c.createLinearGradient(0, 0, 0, 512);
    g.addColorStop(0, "rgba(216,241,238,.45)");
    g.addColorStop(1, "rgba(216,241,238,0)");
    c.fillStyle = g;
    c.beginPath();
    c.moveTo(122, 0);
    c.lineTo(96, 512);
    c.lineTo(160, 512);
    c.lineTo(134, 0);
    c.fill();
  });
}

export function makeIsland(): THREE.Group {
  const g = new THREE.Group();
  const sand = mat(0xb1b09a);
  const green = mat(0x5f7565);
  const runway = mat(0x6d7675);
  ellipsoid(g, 0, -18, 0, 1350, 30, 670, sand, 32);
  ellipsoid(g, 50, -10, 30, 1120, 27, 500, green, 32);
  box(g, 1120, 0.25, 63, 0, 12, 0, runway);
  box(g, 63, 0.25, 750, 160, 12, 0, runway);
  for (let i = 0; i < 15; i += 1) box(g, 35, 0.3, 2, -500 + i * 70, 12.4, 0, mat(0xc9cfb9));
  for (let i = 0; i < 8; i += 1) {
    box(g, 55, 24, 36, -380 + i * 100, 23, 120, mat(0x838578));
    box(g, 57, 4, 39, -380 + i * 100, 36, 120, mat(0x626d65));
  }
  for (let i = 0; i < 12; i += 1) cylinder(g, 12, 12, 16, -420 + (i % 6) * 36, 22, -140 - Math.floor(i / 6) * 42, mat(0x727c75));
  return consolidate(g);
}
