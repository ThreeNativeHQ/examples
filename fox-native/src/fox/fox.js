import * as THREE from 'three';
import { C, mat } from './palette.js';

function part(geo, material, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = false;
  return m;
}

/**
 * Chibi fox in a blue jacket, modelled from primitives.
 * Local space: feet at y = 0, facing +X.
 */
export function createFox() {
  const root = new THREE.Group();

  const fur = mat(C.fur);
  const furDark = mat(C.furDark);
  const cream = mat(C.cream);
  const jacket = mat(C.jacket);
  const jacketDark = mat(C.jacketDark);
  const ink = mat(C.ink);

  // ---- body -------------------------------------------------------------
  const body = new THREE.Group();
  body.position.y = 0.58;
  root.add(body);

  const torso = part(new THREE.CapsuleGeometry(0.3, 0.24, 6, 14), jacket, 0, 0.2, 0);
  torso.scale.set(1, 1, 0.92);
  body.add(torso);

  // jacket hem + collar so the silhouette is not one solid tube
  const hem = part(new THREE.CylinderGeometry(0.33, 0.35, 0.12, 16), jacketDark, 0, -0.02, 0);
  body.add(hem);
  const collar = part(new THREE.CylinderGeometry(0.25, 0.28, 0.1, 16), jacketDark, 0, 0.44, 0);
  body.add(collar);

  const belly = part(new THREE.SphereGeometry(0.2, 12, 10), cream, 0.2, 0.14, 0);
  belly.scale.set(0.7, 1, 0.9);
  body.add(belly);

  const pack = part(new THREE.BoxGeometry(0.3, 0.34, 0.26), mat(C.pack), -0.26, 0.22, 0);
  body.add(pack);
  const packStrap = part(new THREE.TorusGeometry(0.22, 0.035, 8, 18), mat(C.pack), -0.1, 0.24, 0);
  packStrap.rotation.y = Math.PI / 2;
  body.add(packStrap);
  const packBuckle = part(new THREE.CylinderGeometry(0.07, 0.07, 0.06, 12), mat(C.gemLight), -0.42, 0.24, 0);
  packBuckle.rotation.z = Math.PI / 2;
  body.add(packBuckle);

  // ---- head -------------------------------------------------------------
  const head = new THREE.Group();
  head.position.set(0.02, 0.62, 0);
  body.add(head);

  const skull = part(new THREE.SphereGeometry(0.34, 16, 14), fur);
  skull.scale.set(0.95, 0.94, 1);
  head.add(skull);

  const cheeks = part(new THREE.SphereGeometry(0.26, 14, 12), cream, 0.12, -0.08, 0);
  cheeks.scale.set(0.85, 0.8, 1.02);
  head.add(cheeks);

  const muzzle = part(new THREE.SphereGeometry(0.14, 12, 10), cream, 0.3, -0.07, 0);
  muzzle.scale.set(0.9, 0.75, 0.85);
  head.add(muzzle);
  head.add(part(new THREE.SphereGeometry(0.055, 10, 8), ink, 0.42, -0.04, 0));

  for (const s of [-1, 1]) {
    const eye = part(new THREE.SphereGeometry(0.062, 10, 10), ink, 0.26, 0.06, 0.15 * s);
    eye.scale.set(0.8, 1.15, 1);
    head.add(eye);
    const glint = part(new THREE.SphereGeometry(0.022, 8, 8), mat(0xffffff), 0.31, 0.1, 0.17 * s);
    head.add(glint);

    const ear = new THREE.Group();
    ear.position.set(-0.02, 0.28, 0.17 * s);
    ear.rotation.x = -0.35 * s;
    head.add(ear);
    ear.add(part(new THREE.ConeGeometry(0.13, 0.3, 10), fur, 0, 0.13, 0));
    ear.add(part(new THREE.ConeGeometry(0.075, 0.18, 8), mat(C.ink), 0.02, 0.13, 0));
    ear.userData.side = s;
  }

  // ---- limbs ------------------------------------------------------------
  const limbs = { armL: null, armR: null, legL: null, legR: null };
  for (const [name, s] of [['L', 1], ['R', -1]]) {
    const arm = new THREE.Group();
    arm.position.set(0, 0.34, 0.29 * s);
    body.add(arm);
    const sleeve = part(new THREE.CapsuleGeometry(0.085, 0.16, 4, 10), jacket, 0, -0.12, 0);
    arm.add(sleeve);
    arm.add(part(new THREE.SphereGeometry(0.095, 10, 8), cream, 0, -0.27, 0));
    limbs[`arm${name}`] = arm;

    const leg = new THREE.Group();
    leg.position.set(0, 0.02, 0.14 * s);
    body.add(leg);
    const thigh = part(new THREE.CapsuleGeometry(0.1, 0.18, 4, 10), cream, 0, -0.16, 0);
    leg.add(thigh);
    const foot = part(new THREE.BoxGeometry(0.24, 0.11, 0.15), cream, 0.05, -0.33, 0);
    leg.add(foot);
    limbs[`leg${name}`] = leg;
  }

  // ---- tail (raccoon-striped, the reference fox has one) -----------------
  const tail = new THREE.Group();
  tail.position.set(-0.3, 0.18, 0);
  tail.rotation.z = 0.5;
  body.add(tail);
  const tailSegs = [];
  let prev = tail;
  const radii = [0.17, 0.19, 0.19, 0.17, 0.13];
  for (let i = 0; i < radii.length; i++) {
    const seg = new THREE.Group();
    seg.position.x = i === 0 ? -0.12 : -0.19;
    prev.add(seg);
    const c = i >= radii.length - 1 ? cream : (i % 2 === 0 ? fur : cream);
    const ball = part(new THREE.SphereGeometry(radii[i], 12, 10), c);
    ball.scale.set(1.05, 1, 1);
    seg.add(ball);
    tailSegs.push(seg);
    prev = seg;
  }

  // ---- contact shadow blob ---------------------------------------------
  const blob = new THREE.Mesh(
    new THREE.CircleGeometry(0.42, 20),
    new THREE.MeshBasicMaterial({ color: 0x0a2436, transparent: true, opacity: 0.28, depthWrite: false }),
  );
  blob.rotation.x = -Math.PI / 2;
  blob.renderOrder = 2;
  root.add(blob);

  const state = { t: 0 };

  /**
   * @param {object} s  { dt, speed, grounded, vy, dashing, facing }
   */
  function update(s) {
    state.t += s.dt;
    const t = state.t;
    const run = Math.min(1, s.speed / 7);
    const cycle = t * (6 + run * 9);

    if (s.grounded) {
      const swing = Math.sin(cycle) * (0.35 + run * 0.75);
      limbs.legL.rotation.z = swing;
      limbs.legR.rotation.z = -swing;
      limbs.armL.rotation.z = -swing * 0.85;
      limbs.armR.rotation.z = swing * 0.85;
      body.position.y = 0.58 + Math.abs(Math.sin(cycle)) * 0.06 * run + Math.sin(t * 2.2) * 0.012;
      body.rotation.z = -0.06 - run * 0.16 - (s.dashing ? 0.16 : 0);
    } else {
      // tuck on the way up, reach on the way down
      const rise = THREE.MathUtils.clamp(s.vy / 9, -1, 1);
      limbs.legL.rotation.z = THREE.MathUtils.lerp(limbs.legL.rotation.z, 0.5 + rise * 0.5, 0.25);
      limbs.legR.rotation.z = THREE.MathUtils.lerp(limbs.legR.rotation.z, -0.2 + rise * 0.4, 0.25);
      limbs.armL.rotation.z = THREE.MathUtils.lerp(limbs.armL.rotation.z, -1.5 - rise * 0.6, 0.2);
      limbs.armR.rotation.z = THREE.MathUtils.lerp(limbs.armR.rotation.z, -1.2 - rise * 0.5, 0.2);
      body.position.y = 0.58;
      body.rotation.z = THREE.MathUtils.lerp(body.rotation.z, -0.12, 0.15);
    }

    head.rotation.z = Math.sin(cycle * 0.5) * 0.04 - run * 0.08;
    head.rotation.y = Math.sin(t * 1.3) * 0.06;

    // tail trails behind with a lag per segment
    tail.rotation.z = 0.5 - run * 0.55 + Math.sin(t * 3) * 0.08;
    tailSegs.forEach((seg, i) => {
      seg.rotation.z = Math.sin(t * (5 + run * 4) - i * 0.7) * (0.1 + run * 0.14);
      seg.rotation.y = Math.sin(t * 2.4 - i * 0.5) * 0.1;
    });

    // shadow blob tracks the ground below the fox
    const drop = s.groundY === undefined ? 0 : root.position.y - s.groundY;
    blob.position.y = -drop + 0.02;
    blob.visible = drop < 7;
    const k = THREE.MathUtils.clamp(1 - drop / 7, 0.25, 1);
    blob.scale.setScalar(k);
    blob.material.opacity = 0.3 * k;
  }

  return { group: root, update, head, body };
}
