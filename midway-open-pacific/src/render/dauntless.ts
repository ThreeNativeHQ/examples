/** Detailed procedural SBD-inspired player aircraft. Metres, nose toward local -Z. */
import * as T from "three";
import { box, canvasTexture, consolidate, cylinder, ellipsoid, mat, rod } from "./assets.js";
import { makeInstrumentPanel, updateInstrumentPanel } from "./cockpit.js";
import { makeTorpedoModel } from "./model-damage.js";

const TAU = Math.PI * 2;

/** Existing gear geometry shared by the procedural and imported SBD. */
export function createDauntlessGear(under: T.Material = mat(0xb7beb9)) {
  const rubber = mat(0x192129, { roughness: 0.94, metalness: 0 });
  const steel = mat(0x84939b, { metalness: 0.85, roughness: 0.26 });
  const darkSteel = mat(0x26333c, { metalness: 0.7, roughness: 0.35 });
  const staticParts = new T.Group();
  const gear = new T.Group();
  const gearLegs: any[] = [];
  for (const sign of [-1, 1]) {
    const leg = new T.Group();
    leg.position.set(sign * 1.51, -0.3, -0.65);
    rod(leg, [0, 0, 0], [0, -1.22, 0], 0.064, steel);
    rod(leg, [sign * 0.1, -0.1, 0.04], [sign * 0.16, -1.2, -0.06], 0.034, darkSteel);
    rod(leg, [sign * 0.1, -0.45, 0], [sign * 0.36, -0.95, 0], 0.034, steel);
    rod(leg, [sign * 0.36, -0.95, 0], [sign * 0.12, -1.22, 0], 0.034, steel);
    const wheel = cylinder(leg, 0.35, 0.35, 0.22, sign * 0.1, -1.19, 0, rubber, 28);
    wheel.geometry.rotateZ(Math.PI / 2);
    wheel.rotation.set(0, 0, 0);
    const axle = cylinder(leg, 0.14, 0.14, 0.24, sign * 0.1, -1.19, 0, steel, 20);
    axle.rotation.z = Math.PI / 2;
    box(leg, 0.26, 0.62, 0.07, sign * 0.03, -0.54, -0.1, under);
    gear.add(leg);
    gearLegs.push({ group: leg, wheel, sign });
    const well = new T.Mesh(new T.CircleGeometry(0.39, 24), rubber);
    well.rotation.x = Math.PI / 2;
    well.position.set(sign * 0.81, -0.47, -0.63);
    staticParts.add(well);
  }
  const tail = new T.Group();
  rod(tail, [0, -0.29, 4.19], [0, -0.52, 4.39], 0.043, steel);
  const tailwheel = cylinder(tail, 0.17, 0.17, 0.12, 0, -0.55, 4.45, rubber, 16);
  tailwheel.geometry.rotateZ(Math.PI / 2);
  tailwheel.rotation.set(0, 0, 0);

  gear.add(staticParts, tail);
  return { gear, gearLegs, tail };
}



function weatherTexture(): T.CanvasTexture {
  return canvasTexture(1024, 512, (c, w, h) => {
    c.fillStyle = "#d8dce0";
    c.fillRect(0, 0, w, h);
    let seed = 71;
    const random = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    for (let i = 0; i < 12000; i += 1) {
      c.fillStyle = `rgba(${random() > 0.5 ? "255,255,250" : "35,40,44"},${random() * 0.065})`;
      const x = random() * w;
      const y = random() * h;
      c.fillRect(x, y, 1 + random() * 8, 1 + random() * 3);
    }
    c.strokeStyle = "rgba(28,40,50,.26)";
    c.lineWidth = 1.2;
    for (let x = 30; x < w; x += 98) {
      c.beginPath();
      c.moveTo(x, 0);
      c.lineTo(x, h);
      c.stroke();
      for (let y = 6; y < h; y += 12) {
        c.fillStyle = "rgba(20,32,43,.25)";
        c.fillRect(x + 4, y, 1.5, 1.5);
        c.fillStyle = "rgba(247,245,227,.3)";
        c.fillRect(x + 5.5, y, 1, 1);
      }
    }
    for (const y of [57, 137, 240, 372, 458]) {
      c.beginPath();
      c.moveTo(0, y);
      c.lineTo(w, y);
      c.stroke();
    }
    for (let i = 0; i < 35; i += 1) {
      const x = random() * w;
      const y = random() * h;
      c.strokeStyle = "rgba(240,235,213,.19)";
      c.beginPath();
      c.moveTo(x, y);
      c.lineTo(x + random() * 25, y + random() * 2);
      c.stroke();
    }
  });
}

function insignia(): T.CanvasTexture {
  return canvasTexture(256, 256, (c) => {
    c.fillStyle = "#1d3346";
    c.beginPath();
    c.arc(128, 128, 119, 0, TAU);
    c.fill();
    c.fillStyle = "#dddccf";
    c.beginPath();
    for (let i = 0; i < 10; i += 1) {
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      const r = i % 2 ? 45 : 107;
      c.lineTo(128 + Math.cos(a) * r, 128 + Math.sin(a) * r);
    }
    c.closePath();
    c.fill();
  });
}

function textTexture(text: string): T.CanvasTexture {
  return canvasTexture(512, 128, (c) => {
    c.fillStyle = "#d6d9d2";
    c.font = "bold 96px sans-serif";
    c.textAlign = "center";
    c.fillText(text, 256, 101);
  });
}

function fuselageGeometry(): T.BufferGeometry {
  const stations: [number, number, number][] = [
    [-4.39, 0.76, 0], [-4.0, 0.82, 0], [-3.58, 0.79, 0], [-3.0, 0.75, 0], [-2.25, 0.71, 0],
    [-1.35, 0.67, 0], [-0.3, 0.64, -0.03], [0.7, 0.59, -0.045], [1.6, 0.49, -0.08], [2.4, 0.36, -0.1],
    [3.15, 0.245, -0.12], [3.9, 0.145, -0.14], [4.55, 0.078, -0.15], [4.88, 0.025, -0.16],
  ];
  const n = 48;
  const pos: number[] = [];
  const uv: number[] = [];
  const indices: number[] = [];
  const colors: number[] = [];
  for (let j = 0; j < stations.length; j += 1) {
    const [z, r, cy] = stations[j];
    for (let i = 0; i <= n; i += 1) {
      const a = (i / n) * TAU;
      const y = Math.sin(a) * r * 0.93 + cy;
      pos.push(Math.cos(a) * r, y, z);
      uv.push(i / n, (z + 4.4) / 9.28);
      const k = Math.max(0, Math.min(1, (Math.sin(a) + 0.12) * 3 + 0.5));
      const top = new T.Color(0x4c7187).convertLinearToSRGB();
      const under = new T.Color(0xb2b9b5).convertLinearToSRGB();
      under.lerp(top, k);
      colors.push(under.r, under.g, under.b);
    }
  }
  for (let j = 0; j < stations.length - 1; j += 1)
    for (let i = 0; i < n; i += 1) {
      const a = j * (n + 1) + i;
      const b = a + n + 1;
      indices.push(a, a + 1, b, b, a + 1, b + 1);
    }
  const g = new T.BufferGeometry();
  g.setAttribute("position", new T.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new T.Float32BufferAttribute(uv, 2));
  g.setAttribute("color", new T.Float32BufferAttribute(colors, 3));
  g.setIndex(indices);
  g.computeVertexNormals();
  return g;
}

function wingSection(x: number): { leading: number; chord: number; y: number; thickness: number } {
  const a = Math.abs(x);
  const t = Math.min(1, Math.max(0, (a - 1.15) / 5.18));
  const tip = Math.min(1, Math.max(0.13, (6.34 - a) / 0.22));
  return { leading: -1.73 + t * 0.8, chord: (3.06 - t * 1.77) * tip, y: -0.3 + Math.max(0, a - 1.1) * 0.077, thickness: 0.145 - t * 0.065 };
}

/** NACA-like camber and rounded leading edge instead of a flat extruded outline. */
function wingGeometry(x0: number, x1: number, t0 = 0, t1 = 1, sign = 1): T.BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const nx = 20;
  const nt = 22;
  for (const side of [1, -1])
    for (let i = 0; i <= nx; i += 1) {
      const x = x0 + ((x1 - x0) * i) / nx;
      const s = wingSection(x);
      for (let j = 0; j <= nt; j += 1) {
        const t = t0 + (t1 - t0) * (0.5 - 0.5 * Math.cos((j / nt) * Math.PI));
        const thickness = 5 * s.thickness * s.chord * (0.2969 * Math.sqrt(Math.max(0, t)) - 0.126 * t - 0.3516 * t * t + 0.2843 * t * t * t - 0.1036 * t * t * t * t);
        const camber = 0.025 * s.chord * Math.sin(Math.PI * t);
        pos.push(sign * x, s.y + camber + side * thickness, s.leading + s.chord * t);
        uv.push(x / 6.34, t);
      }
    }
  const layer = (nx + 1) * (nt + 1);
  for (let side = 0; side < 2; side += 1)
    for (let i = 0; i < nx; i += 1)
      for (let j = 0; j < nt; j += 1) {
        const a = side * layer + i * (nt + 1) + j;
        const b = a + nt + 1;
        if ((side === 0) === (sign === 1)) idx.push(a, a + 1, b, a + 1, b + 1, b);
        else idx.push(a, b, a + 1, a + 1, b, b + 1);
      }
  const g = new T.BufferGeometry();
  g.setAttribute("position", new T.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new T.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.addGroup(0, nx * nt * 6, 0);
  g.addGroup(nx * nt * 6, nx * nt * 6, 1);
  g.computeVertexNormals();
  return g;
}

function flatShape(points: number[][], depth = 0.07): T.ExtrudeGeometry {
  const shape = new T.Shape();
  points.forEach(([x, y], i) => (i ? shape.lineTo(x, y) : shape.moveTo(x, y)));
  shape.closePath();
  return new T.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelSize: 0.018, bevelThickness: 0.014, bevelSegments: 1, curveSegments: 8 });
}

function brakePanel(width: number, depth: number, top: boolean, blue: T.Material, under: T.Material): T.Group {
  const shape = new T.Shape();
  shape.moveTo(0, 0);
  shape.lineTo(width, 0);
  shape.lineTo(width, depth * 0.8);
  shape.lineTo(0, depth);
  shape.closePath();
  for (let i = 0; i < 22; i += 1)
    for (let row = 0; row < 3; row += 1) {
      const x = 0.1 + (i * (width - 0.2)) / 21;
      const z = 0.11 + row * 0.17;
      if (z > depth * (1 - (0.2 * x) / width) - 0.06) continue;
      const hole = new T.Path();
      hole.absarc(x, z, 0.044, 0, TAU, true);
      shape.holes.push(hole);
    }
  const geo = new T.ShapeGeometry(shape, 6);
  geo.rotateX(Math.PI / 2);
  const verts = geo.attributes.position;
  for (let i = 0; i < verts.count; i += 1) {
    const x = verts.getX(i);
    verts.setY(i, verts.getY(i) + x * 0.077);
    verts.setZ(i, verts.getZ(i) - x * 0.065);
  }
  geo.computeVertexNormals();
  const g = new T.Group();
  g.add(new T.Mesh(geo, new T.MeshStandardMaterial({ color: new T.Color(top ? 0x6c899c : 0xb6bbb4).convertLinearToSRGB(), metalness: 0.18, roughness: 0.63, side: top ? T.BackSide : T.FrontSide })));
  g.add(new T.Mesh(geo, new T.MeshStandardMaterial({ color: new T.Color(0xa74737).convertLinearToSRGB(), roughness: 0.7, metalness: 0.09, side: top ? T.FrontSide : T.BackSide })));
  void blue;
  void under;
  return g;
}

export function makeDauntless(torpedo = false): T.Group {
  const root = new T.Group();
  const staticParts = new T.Group();
  const weather = weatherTexture();
  root.name = torpedo ? "TBD-inspired Devastator / detailed player model" : "SBD Dauntless / detailed player model";
  const blue = new T.MeshStandardMaterial({ color: new T.Color(0x496e87).convertLinearToSRGB(), map: weather, roughness: 0.57, metalness: 0.21 });
  const under = new T.MeshStandardMaterial({ color: new T.Color(0xb7beb9).convertLinearToSRGB(), map: weather, roughness: 0.67, metalness: 0.11 });
  const navy = mat(0x354c60);
  const rubber = mat(0x192129, { roughness: 0.94, metalness: 0 });
  const steel = mat(0x84939b, { metalness: 0.85, roughness: 0.26 });
  const darkSteel = mat(0x35424b, { metalness: 0.75, roughness: 0.42 });
  const interior = mat(0x657363, { roughness: 0.9 });
  const leather = mat(0x574c3e);
  root.add(new T.Mesh(fuselageGeometry(), new T.MeshStandardMaterial({ color: new T.Color(0xffffff).convertLinearToSRGB(), vertexColors: true, map: weather, roughness: 0.64, metalness: 0.18 })));
  const cowProfile = [new T.Vector2(0.76, -4.43), new T.Vector2(0.81, -4.34), new T.Vector2(0.835, -4.1), new T.Vector2(0.825, -3.65), new T.Vector2(0.77, -3.45)];
  const cow = new T.Mesh(new T.LatheGeometry(cowProfile, 48), blue);
  cow.rotation.x = Math.PI / 2;
  staticParts.add(cow);
  const inner = new T.Mesh(new T.CircleGeometry(0.72, 48), rubber);
  inner.position.z = -4.455;
  inner.rotation.y = Math.PI;
  staticParts.add(inner);
  const lip = new T.Mesh(new T.TorusGeometry(0.755, 0.045, 8, 48), steel);
  lip.position.z = -4.46;
  staticParts.add(lip);
  for (let i = 0; i < 9; i += 1) {
    const a = (i / 9) * TAU;
    const x = Math.cos(a);
    const y = Math.sin(a);
    rod(staticParts, [x * 0.27, y * 0.27, -4.49], [x * 0.65, y * 0.65, -4.49], 0.095, darkSteel);
    for (let k = 0; k < 6; k += 1) {
      const fin = new T.Mesh(new T.TorusGeometry(0.106, 0.009, 4, 10), steel);
      fin.position.set(x * (0.36 + k * 0.046), y * (0.36 + k * 0.046), -4.49);
      fin.quaternion.setFromUnitVectors(new T.Vector3(0, 0, 1), new T.Vector3(x, y, 0));
      staticParts.add(fin);
    }
    rod(staticParts, [x * 0.22, y * 0.22, -4.54], [x * 0.57, y * 0.57, -4.56], 0.019, steel);
  }
  const hub = cylinder(staticParts, 0.21, 0.23, 0.2, 0, 0, -4.62, darkSteel, 24);
  hub.rotation.x = Math.PI / 2;
  for (const side of [-1, 1]) {
    const ex = cylinder(staticParts, 0.105, 0.12, 0.46, side * 0.58, -0.49, -3.35, darkSteel, 12);
    ex.rotation.x = 0.5;
    ex.rotation.z = side * 0.7;
    box(staticParts, 0.17, 0.07, 1.25, side * 0.31, 0.62, -3.6, navy);
    rod(staticParts, [side * 0.31, 0.62, -3.4], [side * 0.31, 0.6, -4.64], 0.031, darkSteel);
    ellipsoid(staticParts, side * 0.52, -0.08, -2.6, 0.09, 0.26, 0.7, navy, 14);
  }
  box(staticParts, 0.35, 0.15, 0.65, 0, -0.72, -3.1, darkSteel);
  const brakePanels: any[] = [];
  const wings: any[] = [];
  for (const sign of [-1, 1]) {
    for (const geo of [wingGeometry(0.38, 3.8, 0, 0.77, sign), wingGeometry(3.8, 6.3, 0, 0.73, sign)]) {
      const mesh = new T.Mesh(geo, [blue, under]);
      root.add(mesh);
      wings.push({ mesh, sign });
    }
    const ail = new T.Group();
    const section = wingSection(4.8);
    const pivot = { x: sign * 4.8, y: section.y, z: section.leading + section.chord * 0.73 };
    const ag = wingGeometry(3.82, 6.3, 0.75, 1, sign);
    ag.translate(-pivot.x, -pivot.y, -pivot.z);
    ail.position.set(pivot.x, pivot.y, pivot.z);
    ail.add(new T.Mesh(ag, [blue, under]));
    root.add(ail);
    ellipsoid(staticParts, sign * 0.67, -0.34, -0.06, 0.51, 0.2, 1.8, blue, 24);
    const rootSection = wingSection(0.95);
    const hingeZ = rootSection.leading + rootSection.chord * 0.77;
    for (const upper of [true, false]) {
      const panel = brakePanel(2.91, 0.66, upper, blue, under);
      panel.position.set(sign * 0.87, -0.29 + (upper ? 0.022 : -0.022), hingeZ);
      panel.scale.x = sign;
      root.add(panel);
      brakePanels.push({ group: panel, upper });
    }
    ellipsoid(staticParts, sign * 6.29, 0.1, -0.1, 0.056, 0.036, 0.11, mat(sign < 0 ? 0x9f2321 : 0x548678, { emissive: sign < 0 ? 0xc23522 : 0x42b382, emissiveIntensity: 0.8 }), 10);
    box(staticParts, 0.37, 0.012, 2.04, sign * 0.96, -0.047, -0.19, rubber);
    for (const x of [2.2, 3.18, 4.2, 5.25]) {
      const w = wingSection(x);
      rod(staticParts, [sign * x, w.y + 0.1, w.leading + 0.16], [sign * x, w.y + 0.09, w.leading + w.chord * 0.7], 0.006, navy);
    }
  }
  rod(staticParts, [-4.9, -0.03, -0.3], [-4.9, -0.17, -1.6], 0.019, steel);
  const tailPoints = [[-2.3, 3.95], [-2.18, 3.48], [-1.65, 3.29], [-0.2, 3.02], [0.2, 3.02], [1.65, 3.29], [2.18, 3.48], [2.3, 3.95], [1.9, 4.08], [-1.9, 4.08]];
  const tg = flatShape(tailPoints, 0.085);
  tg.rotateX(Math.PI / 2);
  const tail = new T.Mesh(tg, blue);
  tail.position.y = 0.12;
  staticParts.add(tail);
  const elevators: T.Group[] = [];
  for (const sign of [-1, 1]) {
    const eg = flatShape([[0.14, 0], [2.25, 0.05], [2.02, 0.52], [0.45, 0.72], [0.14, 0.68]], 0.055);
    eg.rotateX(Math.PI / 2);
    const g = new T.Group();
    g.position.set(0, 0.12, 3.94);
    g.scale.x = sign;
    g.add(new T.Mesh(eg, blue));
    root.add(g);
    elevators.push(g);
  }
  const finGeo = flatShape([[3.02, 0.12], [3.42, 0.9], [3.87, 1.65], [4.23, 1.75], [4.29, 0.08]], 0.11);
  finGeo.rotateY(-Math.PI / 2);
  const fin = new T.Mesh(finGeo, blue);
  fin.position.x = 0.055;
  staticParts.add(fin);
  const rudderGeo = flatShape([[0, 0.02], [-0.06, 1.65], [0.24, 1.65], [0.64, 1.33], [0.71, 0.3], [0.54, -0.04]], 0.095);
  rudderGeo.rotateY(-Math.PI / 2);
  const rudder = new T.Group();
  rudder.position.set(0.047, 0, 4.22);
  rudder.add(new T.Mesh(rudderGeo, blue));
  root.add(rudder);
  box(staticParts, 0.8, 0.18, 3.28, 0, 0.5, 0, interior);
  const crew: T.Group[] = [];
  for (const z of torpedo ? [-0.87, 0.65, 1.8] : [-0.87, 0.93]) {
    const person = new T.Group();
    crew.push(person);
    root.add(person);
    box(person, 0.48, 0.48, 0.17, 0, 0.77, z + 0.22, interior);
    box(person, 0.45, 0.11, 0.45, 0, 0.53, z, leather);
    ellipsoid(person, 0, 0.79, z, 0.22, 0.26, 0.16, mat(0xb7a47c), 16);
    ellipsoid(person, 0, 1.11, z, 0.145, 0.17, 0.145, mat(0x7d674b), 16);
    ellipsoid(person, 0, 1.075, z + (z > 0 ? 0.11 : -0.11), 0.11, 0.07, 0.066, mat(0xcaaa86), 12);
    box(person, 0.23, 0.04, 0.028, 0, 1.15, z + (z > 0 ? 0.145 : -0.145), rubber);
    for (const side of [-1, 1]) rod(person, [side * 0.19, 0.87, z], [side * 0.26, 0.72, z + (z > 0 ? 0.25 : -0.3)], 0.055, mat(0xb1a17c));
  }
  const instruments = makeInstrumentPanel(root);
  rod(staticParts, [0, 0.56, -0.72], [0, 0.83, -0.82], 0.022, darkSteel);
  const ring = new T.Mesh(new T.TorusGeometry(0.43, 0.026, 7, 32), darkSteel);
  ring.rotation.x = Math.PI / 2;
  ring.position.set(0, 0.79, 1.35);
  staticParts.add(ring);
  for (const x of [-0.11, 0.11]) {
    box(staticParts, 0.12, 0.11, 0.4, x, 0.92, 1.64, rubber);
    rod(staticParts, [x, 0.94, 1.6], [x, 1.07, 2.7], 0.026, darkSteel);
  }
  const glassMat = new T.MeshPhongMaterial({ color: new T.Color(0x6c9aac).convertLinearToSRGB(), transparent: true, opacity: 0.12, shininess: 90, specular: 0xd5edff, side: T.DoubleSide, depthWrite: false });
  const stations: [number, number, number][] = torpedo
    ? [[-1.82, 0.3, 0.97], [-1.36, 0.46, 1.45], [-0.4, 0.49, 1.49], [0.54, 0.47, 1.44], [1.45, 0.43, 1.35], [2.25, 0.32, 1.1], [2.65, 0.18, 0.71]]
    : [[-1.82, 0.3, 0.97], [-1.36, 0.46, 1.45], [-0.4, 0.49, 1.49], [0.54, 0.47, 1.44], [1.32, 0.37, 1.31], [1.7, 0.25, 0.99]];
  const glassGroup = new T.Group();
  const arches: number[][][] = [];
  for (const [z, w, h] of stations) {
    const pts = [[-w, 0.57, z], [-w, 0.98 + (h - 1.4) * 0.4, z], [-w * 0.53, h, z], [w * 0.53, h, z], [w, 0.98 + (h - 1.4) * 0.4, z], [w, 0.57, z]];
    arches.push(pts);
    for (let i = 0; i < pts.length - 1; i += 1) rod(staticParts, pts[i], pts[i + 1], 0.02, blue);
  }
  for (let k = 0; k < arches.length - 1; k += 1)
    for (let i = 0; i < 5; i += 1) {
      const v = [...arches[k][i], ...arches[k + 1][i], ...arches[k + 1][i + 1], ...arches[k][i + 1]];
      const g = new T.BufferGeometry();
      g.setAttribute("position", new T.Float32BufferAttribute(v, 3));
      g.setIndex([0, 1, 2, 0, 2, 3]);
      g.computeVertexNormals();
      glassGroup.add(new T.Mesh(g, glassMat));
      if (i > 0) rod(staticParts, arches[k][i], arches[k + 1][i], 0.015, blue);
    }
  root.add(glassGroup);
  const roundel = new T.MeshBasicMaterial({ map: insignia(), transparent: true, depthWrite: false, side: T.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2 });
  for (const sign of [-1, 1]) {
    const x = sign * 4.15;
    const s = wingSection(4.15);
    const m = new T.Mesh(new T.PlaneGeometry(1.22, 1.22), roundel);
    m.rotation.x = -Math.PI / 2;
    m.rotation.y = -sign * 0.075;
    m.position.set(x, s.y + 0.205, s.leading + s.chord * 0.43);
    root.add(m);
    const m2 = new T.Mesh(new T.PlaneGeometry(0.68, 0.68), roundel);
    m2.rotation.y = (sign * Math.PI) / 2;
    m2.position.set(sign * 0.49, 0.04, 1.7);
    root.add(m2);
    const number = new T.Mesh(new T.PlaneGeometry(1.28, 0.34), new T.MeshBasicMaterial({ map: textTexture("S • 6"), transparent: true, side: T.DoubleSide, depthWrite: false }));
    number.rotation.y = (sign * Math.PI) / 2;
    number.position.set(sign * 0.31, -0.01, 2.64);
    root.add(number);
  }
  const prop = new T.Group();
  prop.position.z = -4.73;
  const blades = new T.Group();
  for (let i = 0; i < 3; i += 1) {
    const blade = new T.Group();
    blade.rotation.z = (i / 3) * TAU;
    const shape = new T.Shape();
    shape.moveTo(-0.075, 0.16);
    shape.quadraticCurveTo(-0.2, 0.65, -0.095, 1.45);
    shape.quadraticCurveTo(0, 1.67, 0.075, 1.51);
    shape.quadraticCurveTo(0.15, 0.7, 0.075, 0.16);
    const geo = new T.ExtrudeGeometry(shape, { depth: 0.026, bevelEnabled: true, bevelSize: 0.018, bevelThickness: 0.013, bevelSegments: 1 });
    const mesh = new T.Mesh(geo, rubber);
    mesh.rotation.y = 0.18;
    blade.add(mesh);
    box(blade, 0.15, 0.12, 0.03, 0, 1.49, -0.01, mat(0xc4af59));
    blades.add(blade);
  }
  ellipsoid(prop, 0, 0, -0.08, 0.23, 0.23, 0.2, steel, 24);
  prop.add(blades);
  const blurTex = canvasTexture(256, 256, (c) => {
    const g = c.createRadialGradient(128, 128, 18, 128, 128, 123);
    g.addColorStop(0, "rgba(180,190,192,0)");
    g.addColorStop(0.3, "rgba(193,204,207,.065)");
    g.addColorStop(0.83, "rgba(213,219,211,.12)");
    g.addColorStop(0.94, "rgba(213,204,149,.18)");
    g.addColorStop(1, "rgba(220,216,197,0)");
    c.fillStyle = g;
    c.fillRect(0, 0, 256, 256);
  });
  const blur = new T.Mesh(new T.PlaneGeometry(3.3, 3.3), new T.MeshBasicMaterial({ map: blurTex, transparent: true, side: T.DoubleSide, depthWrite: false }));
  prop.add(blur);
  root.add(prop);
  const { gear, gearLegs } = createDauntlessGear(under);
  root.add(gear);
  const hook = new T.Group();
  hook.position.set(0, -0.36, 3.14);
  rod(hook, [0, 0, 0], [0, -0.15, 1.64], 0.034, darkSteel);
  rod(hook, [0, -0.15, 1.64], [0, -0.23, 1.78], 0.055, steel);
  root.add(hook);
  const loads: T.Group[] = [];
  for (const [x, y, z, size] of [[0, -1.0, 0.13, 1], [-2.3, -0.6, 0.14, 0.5], [2.3, -0.6, 0.14, 0.5]] as [number, number, number, number][]) {
    const load = new T.Group();
    load.position.set(x, y, z);
    load.scale.setScalar(size);
    const olive = mat(0x747457, { roughness: 0.68 });
    ellipsoid(load, 0, 0, 0, 0.22, 0.22, 0.85, olive, 24);
    const band = new T.Mesh(new T.TorusGeometry(0.213, 0.018, 6, 24), mat(0xb7a967));
    band.position.z = -0.43;
    load.add(band);
    for (let i = 0; i < 4; i += 1) {
      const fin = box(load, 0.48, 0.025, 0.41, 0, 0, 0.79, olive);
      fin.rotation.z = (i * Math.PI) / 2;
    }
    root.add(load);
    loads.push(load);
  }
  const cradle = new T.Group();
  cradle.position.set(0, -0.5, -0.75);
  for (const x of [-0.28, 0.28]) {
    rod(cradle, [x, 0, 0], [x, -0.4, 0.42], 0.026, steel);
    rod(cradle, [x, -0.4, 0.42], [x, -0.45, 1.25], 0.026, steel);
  }
  root.add(cradle);
  const torpedoStore = makeTorpedoModel();
  torpedoStore.position.set(0, -1.02, -0.28);
  root.add(torpedoStore);
  torpedoStore.visible = torpedo;
  if (torpedo) {
    root.scale.set(1.19, 1.04, 1.06);
    for (const { group } of brakePanels) group.visible = false;
    for (const sign of [-1, 1]) {
      const flap = new T.Mesh(wingGeometry(0.85, 3.8, 0.77, 1, sign), [blue, under]);
      root.add(flap);
      wings.push({ mesh: flap, sign });
    }
    for (const sign of [-1, 1])
      for (let i = 0; i < 27; i += 1) {
        const x = 1.4 + i * 0.175;
        const w = wingSection(x);
        rod(staticParts, [sign * x, w.y + 0.115, w.leading + 0.14], [sign * x, w.y + 0.105, w.leading + w.chord * 0.68], 0.009, blue);
      }
  }
  root.add(consolidate(staticParts));
  root.traverse((o) => {
    const mesh = o as T.Mesh;
    if (mesh.isMesh) {
      mesh.castShadow = !(mesh.material as T.Material).transparent;
      mesh.receiveShadow = !(mesh.material as T.Material).transparent;
    }
  });
  root.userData = {
    detailed: true,
    airframe: torpedo ? "tbd" : "sbd",
    torpedoStore,
    crew,
    instruments,
    wings,
    prop,
    blades,
    blur,
    gear,
    gearLegs,
    brakes: { visible: false },
    brakePanels,
    load: loads[0],
    loads,
    elevators,
    rudder,
    hook,
    cradle,
    previousBombs: 3,
    releaseClock: 0,
    propAngle: 0,
  };
  return root;
}

export function animateDauntless(root: T.Group, p: any, dt: number): void {
  const d = root.userData;
  if (!d?.detailed) return;
  const rpm = p.rpm ?? p.throttle ?? 0.18;
  d.propAngle = (d.propAngle + dt * (rpm * 231)) % TAU;
  d.blades.rotation.z = d.propAngle;
  d.blades.visible = rpm < 0.38;
  d.blur.visible = rpm > 0.15;
  d.blur.material.opacity = Math.min(1, rpm * 2.5);
  for (const { group, sign, wheel } of d.gearLegs) {
    group.rotation.z = -sign * (1 - (p.gearPos ?? 1)) * 1.57;
    wheel.rotation.x = p.wheelAngle || 0;
    wheel.rotation.y = 0;
  }
  for (const { group, upper } of d.brakePanels) group.rotation.x = upper ? -(p.brakePos || 0) * 1.02 : Math.max((p.brakePos || 0) * 1.02, (p.flapPos || 0) * 0.64);
  for (const { group } of d.ailerons ?? []) group.rotation.x = -(group.sign ?? 0) * (p.controlAileron ?? p.aileron ?? 0) * 0.25;
  for (const e of d.elevators) e.rotation.x = -(p.elevator || 0) * 0.32;
  d.rudder.rotation.y = -(p.rudder || 0) * 0.36;
  d.hook.rotation.x = (p.gearPos || 0) * 0.42;
  d.torpedoStore.visible = (p.torpedo || 0) > 0;
  d.cradle.visible = p.airframe !== "tbd";
  updateInstrumentPanel(d.instruments, p);
  d.loads[0].visible = p.bombs >= 3;
  d.loads[1].visible = p.bombs >= 2;
  d.loads[2].visible = p.bombs >= 1;
  if (p.bombs < d.previousBombs) d.releaseClock = 0.55;
  d.previousBombs = p.bombs;
  d.releaseClock = Math.max(0, d.releaseClock - dt);
  d.cradle.rotation.x = Math.sin((d.releaseClock / 0.55) * Math.PI) * 0.54;
}
