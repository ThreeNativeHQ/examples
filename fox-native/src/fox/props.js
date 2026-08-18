import * as THREE from 'three';
import { C, mat, flat } from './palette.js';

function mesh(geo, material, cast = true) {
  const m = new THREE.Mesh(geo, material);
  m.castShadow = cast;
  m.receiveShadow = true;
  return m;
}

/** Stacked-cone conifer. */
export function pineTree(scale = 1, rng = Math.random) {
  const g = new THREE.Group();
  const trunk = mesh(new THREE.CylinderGeometry(0.13, 0.18, 0.7, 8), mat(C.woodDark));
  trunk.position.y = 0.35;
  g.add(trunk);
  const tiers = 3;
  for (let i = 0; i < tiers; i++) {
    const r = 0.72 - i * 0.17;
    const cone = mesh(new THREE.ConeGeometry(r, 0.95, 9), mat(i % 2 ? C.grassDark : C.grass));
    cone.position.y = 0.75 + i * 0.55;
    cone.rotation.y = rng() * Math.PI;
    g.add(cone);
  }
  g.scale.setScalar(scale);
  return g;
}

/** Round broadleaf tree with clustered canopy. */
export function roundTree(scale = 1, rng = Math.random) {
  const g = new THREE.Group();
  const trunk = mesh(new THREE.CylinderGeometry(0.16, 0.24, 1.0, 8), mat(C.woodDark));
  trunk.position.y = 0.5;
  g.add(trunk);
  const canopy = new THREE.Group();
  canopy.position.y = 1.5;
  g.add(canopy);
  for (let i = 0; i < 5; i++) {
    const r = 0.5 + rng() * 0.35;
    const ball = mesh(new THREE.SphereGeometry(r, 12, 10), mat(i % 2 ? C.grass : C.grassDark));
    ball.position.set((rng() - 0.5) * 0.9, (rng() - 0.5) * 0.5, (rng() - 0.5) * 0.9);
    canopy.add(ball);
  }
  g.scale.setScalar(scale);
  return g;
}

export function bush(scale = 1, rng = Math.random) {
  const g = new THREE.Group();
  for (let i = 0; i < 4; i++) {
    const r = 0.22 + rng() * 0.2;
    const ball = mesh(new THREE.SphereGeometry(r, 10, 8), mat(i % 2 ? C.grass : C.grassDark));
    ball.position.set((rng() - 0.5) * 0.6, r * 0.7, (rng() - 0.5) * 0.5);
    g.add(ball);
  }
  g.scale.setScalar(scale);
  return g;
}

export function flower(color = 0xff8fb0) {
  const g = new THREE.Group();
  const stem = mesh(new THREE.CylinderGeometry(0.015, 0.02, 0.22, 5), mat(C.grassDark));
  stem.position.y = 0.11;
  g.add(stem);
  for (let i = 0; i < 5; i++) {
    const p = mesh(new THREE.SphereGeometry(0.05, 8, 6), mat(color));
    p.position.set(Math.cos(i / 5 * Math.PI * 2) * 0.06, 0.24, Math.sin(i / 5 * Math.PI * 2) * 0.06);
    g.add(p);
  }
  const core = mesh(new THREE.SphereGeometry(0.04, 8, 6), mat(C.gold));
  core.position.y = 0.25;
  g.add(core);
  return g;
}

/** Wooden post-and-rope fence running along +X. */
export function fence(length, posts = 4) {
  const g = new THREE.Group();
  const step = length / (posts - 1);
  for (let i = 0; i < posts; i++) {
    const p = mesh(new THREE.CylinderGeometry(0.09, 0.11, 1.0, 7), mat(C.woodPost));
    p.position.set(i * step, 0.5, 0);
    g.add(p);
    if (i < posts - 1) {
      for (const [h, sag] of [[0.78, 0.06], [0.45, 0.05]]) {
        const rail = mesh(new THREE.CylinderGeometry(0.035, 0.035, step, 6), mat(C.rope));
        rail.rotation.z = Math.PI / 2;
        rail.position.set(i * step + step / 2, h - sag, 0);
        g.add(rail);
      }
    }
  }
  return g;
}

/** Falling water: two scrolling translucent planes plus foam at the base. */
export function waterfall(width, height, scene) {
  const g = new THREE.Group();
  const sheets = [];
  for (let i = 0; i < 2; i++) {
    const mMat = new THREE.MeshBasicMaterial({
      color: i ? 0x9fe3fb : 0x4fb6e8,
      transparent: true,
      opacity: i ? 0.55 : 0.9,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    // narrower at the lip, spreading as it falls
    const sheet = new THREE.Mesh(
      new THREE.CylinderGeometry(width * (i ? 0.34 : 0.5), width * (i ? 0.44 : 0.62), height, 10, 1, true, -0.9, 1.8),
      mMat,
    );
    sheet.position.set(0, -height / 2, i * 0.25);
    g.add(sheet);
    sheets.push(sheet);

    // vertical streaks give the sheet motion without a texture
    const streaks = new THREE.Group();
    for (let s = 0; s < 8; s++) {
      const streak = new THREE.Mesh(
        new THREE.PlaneGeometry(width * (0.05 + Math.random() * 0.05), height * (0.12 + Math.random() * 0.2)),
        new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5, depthWrite: false }),
      );
      streak.position.set((Math.random() - 0.5) * width * 0.7, -Math.random() * height, width * 0.5);
      streak.userData.speed = 8 + Math.random() * 10;
      streaks.add(streak);
    }
    g.add(streaks);
    (g.userData.streaks ??= []).push(streaks);
  }

  // white water where the fall leaves the lip
  for (let i = 0; i < 4; i++) {
    const lip = new THREE.Mesh(
      new THREE.SphereGeometry(width * (0.2 + Math.random() * 0.14), 10, 8),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthWrite: false }),
    );
    lip.position.set((Math.random() - 0.5) * width * 0.9, -0.2, width * 0.3);
    lip.scale.y = 0.55;
    g.add(lip);
  }

  const foam = new THREE.Group();
  for (let i = 0; i < 9; i++) {
    const puff = new THREE.Mesh(
      new THREE.SphereGeometry(width * (0.18 + Math.random() * 0.16), 10, 8),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.75, depthWrite: false }),
    );
    puff.position.set((Math.random() - 0.5) * width * 1.4, -height + Math.random() * 0.8, (Math.random() - 0.5) * 1.2);
    puff.scale.y = 0.7;
    foam.add(puff);
  }
  g.add(foam);
  g.userData.height = height;
  return g;
}

export function updateWaterfall(g, dt) {
  const groups = g.userData.streaks;
  if (!groups) return;
  for (const streaks of groups) {
    for (const s of streaks.children) {
      s.position.y -= s.userData.speed * dt;
      if (s.position.y < -g.userData.height) s.position.y = 0;
    }
  }
}

/** Distant castle with towers, matching the reference skyline. */
export function castle() {
  const g = new THREE.Group();
  const brick = mat(C.brick);
  const brickDark = mat(C.brickDark);

  const keep = mesh(new THREE.BoxGeometry(9, 14, 8), brick);
  keep.position.y = 7;
  g.add(keep);

  for (const x of [-4.5, 4.5]) {
    const tower = mesh(new THREE.CylinderGeometry(2.2, 2.5, 17, 12), brick);
    tower.position.set(x, 8.5, 0);
    g.add(tower);
    const crown = mesh(new THREE.CylinderGeometry(2.7, 2.7, 1.0, 12), brickDark);
    crown.position.set(x, 17.2, 0);
    g.add(crown);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const merlon = mesh(new THREE.BoxGeometry(0.7, 1.1, 0.7), brickDark);
      merlon.position.set(x + Math.cos(a) * 2.3, 18.2, Math.sin(a) * 2.3);
      g.add(merlon);
    }
  }

  // parapet along the keep
  for (let i = -4; i <= 4; i++) {
    const merlon = mesh(new THREE.BoxGeometry(0.8, 1.2, 0.8), brickDark);
    merlon.position.set(i * 1.05, 14.6, 3.6);
    g.add(merlon);
  }

  const gate = mesh(new THREE.BoxGeometry(3, 4.4, 0.6), mat(C.woodDark));
  gate.position.set(0, 2.2, 4.1);
  g.add(gate);

  for (const [x, y] of [[-2.6, 9], [2.6, 9], [0, 10.5]]) {
    const win = mesh(new THREE.CircleGeometry(0.85, 14), mat(0x2f6fa8));
    win.position.set(x, y, 4.05);
    g.add(win);
    const ring = mesh(new THREE.TorusGeometry(0.95, 0.16, 8, 16), brickDark);
    ring.position.set(x, y, 4.05);
    g.add(ring);
  }

  const pole = mesh(new THREE.CylinderGeometry(0.08, 0.08, 5, 6), mat(C.metal));
  pole.position.set(0, 16.5, 0);
  g.add(pole);
  const flag = mesh(new THREE.PlaneGeometry(2.2, 1.2), new THREE.MeshBasicMaterial({ color: 0x2f7fd6, side: THREE.DoubleSide }));
  flag.position.set(1.1, 18.2, 0);
  g.add(flag);
  g.userData.flag = flag;

  return g;
}

/** Windmill; blades spin via updateWindmill. */
export function windmill() {
  const g = new THREE.Group();
  const tower = mesh(new THREE.CylinderGeometry(1.5, 2.3, 7, 12), mat(0xe6d9c2));
  tower.position.y = 3.5;
  g.add(tower);
  const roof = mesh(new THREE.ConeGeometry(2.1, 2.2, 12), mat(C.roof));
  roof.position.y = 8.1;
  g.add(roof);

  const hub = new THREE.Group();
  hub.position.set(0, 6.6, 2.0);
  g.add(hub);
  for (let i = 0; i < 4; i++) {
    const arm = new THREE.Group();
    arm.rotation.z = (i / 4) * Math.PI * 2;
    hub.add(arm);
    const spar = mesh(new THREE.BoxGeometry(0.18, 4.4, 0.18), mat(C.woodDark));
    spar.position.y = 2.2;
    arm.add(spar);
    const sail = mesh(new THREE.BoxGeometry(0.9, 3.2, 0.08), mat(0xf6f0e2));
    sail.position.set(0.6, 2.4, 0.12);
    arm.add(sail);
  }
  g.userData.hub = hub;
  return g;
}

export function updateWindmill(g, dt) {
  if (g.userData.hub) g.userData.hub.rotation.z += dt * 0.55;
}

/** Zeppelin drifting across the sky. */
export function airship() {
  const g = new THREE.Group();
  const hull = mesh(new THREE.CapsuleGeometry(1.5, 4.4, 8, 16), mat(0xb9c4cc), false);
  hull.rotation.z = Math.PI / 2;
  g.add(hull);
  const fin = mesh(new THREE.BoxGeometry(0.12, 1.4, 1.6), mat(0x8e9aa4), false);
  fin.position.x = -3.5;
  g.add(fin);
  const fin2 = mesh(new THREE.BoxGeometry(0.12, 1.6, 1.4), mat(0x8e9aa4), false);
  fin2.position.x = -3.5;
  fin2.rotation.x = Math.PI / 2;
  g.add(fin2);
  const gondola = mesh(new THREE.BoxGeometry(1.8, 0.7, 0.9), mat(C.woodDark), false);
  gondola.position.y = -1.7;
  g.add(gondola);
  for (const x of [-0.6, 0.6]) {
    const cable = mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.1, 5), mat(0x6b6b6b), false);
    cable.position.set(x, -1.1, 0);
    g.add(cable);
  }
  return g;
}

/** Wooden crate with plank detail. */
export function crate(size = 1) {
  const g = new THREE.Group();
  const box = mesh(new THREE.BoxGeometry(size, size, size), mat(C.wood));
  g.add(box);
  const f = size / 2 + 0.01;
  for (const [rot, pos] of [[[0, 0, 0], [0, 0, f]], [[0, Math.PI, 0], [0, 0, -f]], [[0, Math.PI / 2, 0], [f, 0, 0]], [[0, -Math.PI / 2, 0], [-f, 0, 0]]]) {
    for (const y of [-size * 0.3, 0, size * 0.3]) {
      const plank = mesh(new THREE.BoxGeometry(size * 0.96, size * 0.24, 0.02), mat(C.woodDark), false);
      plank.rotation.set(...rot);
      plank.position.set(pos[0], y, pos[2]);
      if (Math.abs(pos[0]) > 0) { plank.position.z = 0; }
      g.add(plank);
    }
  }
  g.position.y = size / 2;
  return g;
}

/** Classic '?' block. */
export function questionBlock(size = 1) {
  const g = new THREE.Group();
  const box = mesh(new THREE.BoxGeometry(size, size, size), mat(0xe89b25));
  g.add(box);
  const f = size / 2 + 0.02;
  for (const [ry, px, pz] of [[0, 0, f], [Math.PI, 0, -f], [Math.PI / 2, f, 0], [-Math.PI / 2, -f, 0]]) {
    const face = new THREE.Group();
    face.rotation.y = ry;
    face.position.set(px, 0, pz);
    g.add(face);
    const shape = new THREE.Shape();
    // simple blocky "?" made from two bars and a dot
    const bar = new THREE.Mesh(new THREE.BoxGeometry(size * 0.34, size * 0.12, 0.02), mat(0xfff0c9));
    bar.position.set(0, size * 0.2, 0);
    const stem = new THREE.Mesh(new THREE.BoxGeometry(size * 0.12, size * 0.3, 0.02), mat(0xfff0c9));
    stem.position.set(size * 0.11, size * 0.02, 0);
    const dot = new THREE.Mesh(new THREE.BoxGeometry(size * 0.12, size * 0.12, 0.02), mat(0xfff0c9));
    dot.position.set(0, -size * 0.26, 0);
    face.add(bar, stem, dot);
    void shape;
  }
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
    const rivet = mesh(new THREE.SphereGeometry(size * 0.06, 8, 6), mat(0xfff0c9), false);
    rivet.position.set(sx * size * 0.38, sy * size * 0.38, size / 2 + 0.01);
    g.add(rivet);
  }
  return g;
}

/** Goal flag on a pole. */
export function goalFlag() {
  const g = new THREE.Group();
  const pole = mesh(new THREE.CylinderGeometry(0.1, 0.12, 6, 8), mat(C.metal));
  pole.position.y = 3;
  g.add(pole);
  const base = mesh(new THREE.CylinderGeometry(0.6, 0.75, 0.4, 12), mat(C.rockDark));
  base.position.y = 0.2;
  g.add(base);
  const cloth = mesh(new THREE.PlaneGeometry(1.8, 1.1, 8, 1), new THREE.MeshBasicMaterial({ color: 0xff5a4a, side: THREE.DoubleSide }), false);
  cloth.position.set(0.9, 5.2, 0);
  g.add(cloth);
  const ball = mesh(new THREE.SphereGeometry(0.16, 10, 8), mat(C.gold));
  ball.position.y = 6.1;
  g.add(ball);
  g.userData.cloth = cloth;
  return g;
}

/** Vine strands hanging off a ledge. */
export function vines(count = 4, rng = Math.random) {
  const g = new THREE.Group();
  for (let i = 0; i < count; i++) {
    const len = 0.8 + rng() * 1.6;
    const strand = mesh(new THREE.CylinderGeometry(0.035, 0.03, len, 5), mat(C.grassDark), false);
    strand.position.set((rng() - 0.5) * 1.6, -len / 2, (rng() - 0.5) * 0.3);
    g.add(strand);
    for (let l = 0; l < 3; l++) {
      const leaf = mesh(new THREE.SphereGeometry(0.11, 8, 6), mat(C.grass), false);
      leaf.scale.set(1, 0.4, 0.7);
      leaf.position.set(strand.position.x + (rng() - 0.5) * 0.2, -len * (0.2 + l * 0.3), strand.position.z);
      g.add(leaf);
    }
  }
  return g;
}

export { flat };
