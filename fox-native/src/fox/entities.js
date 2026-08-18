import * as THREE from 'three';
import { C, mat } from './palette.js';

const TAU = Math.PI * 2;

/** Spinning coin with an embossed star. */
export function coin() {
  const g = new THREE.Group();
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.1, 18), mat(C.gold));
  disc.rotation.x = Math.PI / 2;
  disc.castShadow = true;
  g.add(disc);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.07, 8, 20), mat(C.goldDark));
  g.add(ring);
  for (const z of [-0.07, 0.07]) {
    const star = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.02, 5), mat(C.goldDark));
    star.rotation.x = Math.PI / 2;
    star.position.z = z;
    g.add(star);
  }
  g.userData.kind = 'coin';
  return g;
}

/** Blue octahedral gem. */
export function gem() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.OctahedronGeometry(0.45, 0), mat(C.gem));
  body.castShadow = true;
  g.add(body);
  const shine = new THREE.Mesh(new THREE.OctahedronGeometry(0.46, 0), mat(C.gemLight, { transparent: true, opacity: 0.45 }));
  shine.scale.set(0.5, 1, 0.5);
  g.add(shine);
  g.userData.kind = 'gem';
  return g;
}

/** Big collectible star. */
export function star() {
  const g = new THREE.Group();
  const shape = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? 0.62 : 0.27;
    const a = (i / 10) * TAU + Math.PI / 2;
    const x = Math.cos(a) * r, y = Math.sin(a) * r;
    if (i === 0) shape.moveTo(x, y); else shape.lineTo(x, y);
  }
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.18, bevelEnabled: true, bevelSize: 0.07, bevelThickness: 0.07, bevelSegments: 2 });
  geo.center();
  const body = new THREE.Mesh(geo, mat(C.gold));
  body.castShadow = true;
  g.add(body);
  const glow = new THREE.PointLight(0xffe27a, 8, 6);
  g.add(glow);
  g.userData.kind = 'star';
  return g;
}

/** Grumpy mushroom that patrols along X. */
export function mushroom() {
  const g = new THREE.Group();
  const stem = new THREE.Mesh(new THREE.CapsuleGeometry(0.36, 0.28, 6, 14), mat(C.spot));
  stem.position.y = 0.46;
  stem.castShadow = true;
  g.add(stem);

  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.62, 16, 12, 0, TAU, 0, Math.PI / 2), mat(C.capRed));
  cap.position.y = 0.78;
  cap.scale.y = 0.85;
  cap.castShadow = true;
  g.add(cap);
  const capRim = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.6, 0.14, 16), mat(C.capDark));
  capRim.position.y = 0.75;
  g.add(capRim);

  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * TAU + 0.4;
    const spot = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 8), mat(C.spot));
    spot.position.set(Math.cos(a) * 0.36, 0.96 + Math.sin(i) * 0.03, Math.sin(a) * 0.36);
    spot.scale.y = 0.5;
    g.add(spot);
  }

  const face = new THREE.Group();
  face.position.set(0, 0.5, 0.3);
  g.add(face);
  for (const s of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.075, 10, 8), mat(C.ink));
    eye.position.set(0.15 * s, 0.06, 0.04);
    face.add(eye);
    const brow = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.04, 0.03), mat(C.ink));
    brow.position.set(0.15 * s, 0.17, 0.05);
    brow.rotation.z = -0.4 * s;
    face.add(brow);
  }
  const mouth = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.035, 0.03), mat(C.ink));
  mouth.position.set(0, -0.12, 0.05);
  face.add(mouth);

  g.userData = { kind: 'mushroom', face, hop: 0 };
  return g;
}

/** Snail with a spiral shell. */
export function snail() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 0.75, 6, 12), mat(C.snailBody));
  body.rotation.z = Math.PI / 2;
  body.position.set(0.15, 0.3, 0);
  body.scale.set(1, 1, 0.85);
  body.castShadow = true;
  g.add(body);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.33, 12, 10), mat(C.snailBody));
  head.position.set(0.62, 0.42, 0);
  head.castShadow = true;
  g.add(head);

  for (const s of [-1, 1]) {
    const stalk = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.34, 6), mat(C.snailBody));
    stalk.position.set(0.68, 0.72, 0.14 * s);
    stalk.rotation.z = -0.25;
    g.add(stalk);
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8), mat(C.spot));
    eye.position.set(0.73, 0.9, 0.14 * s);
    g.add(eye);
    const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), mat(C.ink));
    pupil.position.set(0.81, 0.9, 0.15 * s);
    g.add(pupil);
  }

  // shell: torus stack forming a spiral
  const shell = new THREE.Group();
  shell.position.set(-0.18, 0.6, 0);
  shell.rotation.y = Math.PI / 2;
  g.add(shell);
  for (let i = 0; i < 5; i++) {
    const r = 0.52 - i * 0.09;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(r, 0.17 - i * 0.022, 8, 18), mat(i % 2 ? C.shellRed : 0xc4523c));
    ring.position.z = i * 0.055;
    ring.castShadow = true;
    shell.add(ring);
  }
  const shellCore = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 10), mat(0xc4523c));
  shellCore.position.z = 0.28;
  shell.add(shellCore);

  g.userData = { kind: 'snail' };
  return g;
}

/** Small burst of particles for pickups and stomps. */
export function burst(scene, position, color, count = 12) {
  const group = new THREE.Group();
  group.position.copy(position);
  const material = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 1, depthWrite: false });
  const bits = [];
  for (let i = 0; i < count; i++) {
    const bit = new THREE.Mesh(new THREE.SphereGeometry(0.09 + Math.random() * 0.07, 6, 5), material);
    const a = Math.random() * TAU, up = 0.4 + Math.random();
    bit.userData.v = new THREE.Vector3(Math.cos(a) * 3.2, up * 4.5, Math.sin(a) * 3.2);
    group.add(bit);
    bits.push(bit);
  }
  scene.add(group);
  let life = 0;
  return (dt) => {
    life += dt;
    for (const b of bits) {
      b.userData.v.y -= 18 * dt;
      b.position.addScaledVector(b.userData.v, dt);
    }
    material.opacity = Math.max(0, 1 - life / 0.7);
    if (life > 0.7) {
      scene.remove(group);
      group.traverse((o) => o.geometry?.dispose());
      material.dispose();
      return true; // done
    }
    return false;
  };
}

/** Arc of coins between two points. */
export function coinArc(from, to, count, height = 2.2) {
  const out = [];
  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0.5 : i / (count - 1);
    out.push(new THREE.Vector3(
      THREE.MathUtils.lerp(from[0], to[0], t),
      THREE.MathUtils.lerp(from[1], to[1], t) + Math.sin(t * Math.PI) * height,
      THREE.MathUtils.lerp(from[2] ?? 0, to[2] ?? 0, t),
    ));
  }
  return out;
}
