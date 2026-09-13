/** Scorch decals and the Mark 13 torpedo model. */
import * as T from "three";
import { box, canvasTexture, ellipsoid, mat } from "./assets.js";

let scorchMap: T.CanvasTexture | undefined;

export function addDamageVisuals(root: any): void {
  if (!scorchMap)
    scorchMap = canvasTexture(256, 256, (c) => {
      const g = c.createRadialGradient(128, 128, 10, 128, 128, 116);
      g.addColorStop(0, "rgba(6,5,4,.97)");
      g.addColorStop(0.35, "rgba(16,14,11,.88)");
      g.addColorStop(0.7, "rgba(49,34,22,.52)");
      g.addColorStop(1, "rgba(30,23,15,0)");
      c.fillStyle = g;
      c.fillRect(0, 0, 256, 256);
      for (let i = 0; i < 48; i += 1) {
        const x = 55 + ((i * 37) % 154);
        const y = 65 + ((i * 61) % 120);
        c.fillStyle = i % 3 ? "rgba(8,10,9,.85)" : "rgba(159,151,119,.6)";
        c.beginPath();
        c.moveTo(x, y);
        c.lineTo(x + 7, y - 4);
        c.lineTo(x + 4, y + 8);
        c.fill();
      }
    });
  const stains: Record<string, T.Mesh> = {};
  for (const [key, x, y, z] of [
    ["leftWing", -2.7, 0.0, -0.1],
    ["rightWing", 2.7, 0.0, -0.1],
    ["engine", 0, 0.8, -3.45],
    ["tail", 0, 0.3, 3.7],
  ] as [string, number, number, number][]) {
    const mesh = new T.Mesh(
      new T.PlaneGeometry(key.includes("Wing") ? 2.7 : 1.1, key.includes("Wing") ? 1.55 : 1.3),
      new T.MeshBasicMaterial({
        map: scorchMap,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        side: T.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -2,
      }),
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, y + 0.16, z);
    root.add(mesh);
    stains[key] = mesh;
  }
  root.userData.damageVisuals = stains;
}

export function updateDamageVisuals(root: any, a: any): void {
  const stains = root.userData.damageVisuals;
  if (!stains) return;
  for (const [key, m] of Object.entries(stains) as [string, T.Mesh][]) {
    const d = a.damage?.[key];
    m.visible = !!d && d.integrity < 0.93;
    (m.material as T.MeshBasicMaterial).opacity = d ? Math.min(1, (1 - d.integrity) * 1.9) : 0;
  }
  const d = root.userData;
  if (d.wings)
    for (const w of d.wings) w.mesh.visible = (a.damage?.[w.sign < 0 ? "leftWing" : "rightWing"].integrity ?? 1) > 0.025;
}

export function makeTorpedoModel(): T.Group {
  const root = new T.Group();
  const body = mat(0x6f7871, { roughness: 0.52, metalness: 0.62 });
  const nose = mat(0x343f3c, { roughness: 0.54, metalness: 0.55 });
  ellipsoid(root, 0, 0, -0.02, 0.285, 0.285, 1.88, body, 24);
  ellipsoid(root, 0, 0, -1.48, 0.277, 0.277, 0.42, nose, 24);
  for (let i = 0; i < 4; i += 1) {
    const fin = box(root, 0.74, 0.035, 0.74, 0, 0, 1.35, nose);
    fin.rotation.z = (i * Math.PI) / 2;
  }
  const band = new T.Mesh(new T.TorusGeometry(0.285, 0.017, 6, 24), mat(0x9d955a));
  band.position.z = -0.85;
  root.add(band);
  for (let j = 0; j < 2; j += 1)
    for (let i = 0; i < 4; i += 1) {
      const blade = box(root, 0.44, 0.038, 0.05, 0, 0, 1.91 + j * 0.08, mat(0x9e9275, { metalness: 0.8 }));
      blade.rotation.z = (i * Math.PI) / 2 + 0.4 * j;
    }
  root.name = "Mark 13 / straight-running aerial torpedo";
  return root;
}
