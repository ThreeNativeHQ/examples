/** Scorch decals and the Mark 13 torpedo model. */
import * as T from "three";
import { box, canvasTexture, ellipsoid, mat } from "./assets.js";

let scorchMap: T.CanvasTexture | undefined;

function ensureScorchMap(): void {
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
}

export function addDamageVisuals(root: any): void {
  ensureScorchMap();
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

/**
 * Height of the walkable top surface above a hull's origin. These are the same numbers the
 * simulation uses to decide that a falling bomb has struck the ship (`updateWeapons`), so a mark
 * lands on the deck the weapon actually hit rather than three metres inside it.
 */
const DECK_SURFACE: Record<string, number> = { carrier: 20, cruiser: 9, destroyer: 9, sub: 0.5 };
const MAX_SCARS = 8;

/**
 * Persistent scorch marks where a ship was actually hit. The marks live in the hull's own frame, so
 * they ride the moving ship, and they are rebuilt from `ship.impacts` every frame: a restart hands
 * over a battle with no impacts and every mark simply hides itself.
 *
 * A near miss detonates in the water and never earns a deck scar, and an impact below the deck
 * surface — a torpedo at the waterline — is left to the fire and spray effects instead.
 */
export function updateShipScars(root: any, s: any, distance = 0, quality = "balanced"): void {
  const deck = DECK_SURFACE[s.kind] ?? 7;
  // Transparent overdraw the player cannot read at range: keep the marks near enough to see, and
  // fewer of them at low quality. The fires stay in every case, so a burning deck still reads.
  const budget = quality === "low" ? 3 : quality === "high" ? MAX_SCARS : 5;
  const visible = distance < (quality === "low" ? 3500 : 7000);
  const marks = visible
    ? ((s.impacts ?? []) as any[]).filter((m) => !m.nearMiss && m.height >= deck - 3).slice(-budget)
    : [];
  ensureScorchMap();
  let pool = root.userData.shipScars as T.Mesh[] | undefined;
  if (!marks.length && !pool) return;
  if (!pool) {
    pool = [];
    for (let i = 0; i < MAX_SCARS; i += 1) {
      const mesh = new T.Mesh(
        new T.PlaneGeometry(1, 1),
        new T.MeshBasicMaterial({
          map: scorchMap,
          transparent: true,
          opacity: 0,
          depthWrite: false,
          side: T.DoubleSide,
          polygonOffset: true,
          polygonOffsetFactor: -4,
        }),
      );
      mesh.rotation.x = -Math.PI / 2;
      mesh.visible = false;
      root.add(mesh);
      pool.push(mesh);
    }
    root.userData.shipScars = pool;
  }
  for (const [i, mesh] of pool.entries()) {
    const m = marks[i];
    mesh.visible = !!m;
    if (!m) continue;
    // The hull group is rotated by -heading, so a ship-frame offset maps to (right, height, -forward).
    const size = Math.min(26, 7 + (m.damage ?? 80) * 0.085);
    mesh.scale.set(size, size, 1);
    mesh.position.set(m.right, deck + 0.35, -m.forward);
    mesh.rotation.z = (m.time % 6.28) || 0;
    (mesh.material as T.MeshBasicMaterial).opacity = Math.min(0.94, 0.45 + (m.damage ?? 80) / 320);
  }
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
