import * as THREE from 'three';
import { BundleGroup } from 'three/webgpu';
import { C, mat, rockBox } from './palette.js';
import {
  pineTree, roundTree, bush, flower, fence, waterfall, updateWaterfall,
  castle, windmill, updateWindmill, airship, crate, questionBlock, goalFlag, vines,
} from './props.js';

/** Deterministic RNG so the level looks the same every run. */
export function makeRng(seed = 1337) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export class Level {
  constructor(scene, rng) {
    this.scene = scene;
    this.rng = rng;
    this.colliders = [];      // { min: Vector3, max: Vector3 }
    this.updaters = [];
    this.checkpoints = [];    // x positions with a safe landing spot
    this.spawn = new THREE.Vector3(-5, 1.2, 0);
    this.goalX = 92;
    // Safe again now that the HUD lives on `ctx.canvasLayer` rather than sharing this pass:
    // bundled draws execute last within a pass, so anything drawn beside them loses.
    this.renderRoot = new BundleGroup();
    this.renderRoot.static = false;
    scene.add(this.renderRoot);
  }

  addCollider(cx, top, cz, w, d, h) {
    this.colliders.push({
      min: new THREE.Vector3(cx - w / 2, top - h, cz - d / 2),
      max: new THREE.Vector3(cx + w / 2, top, cz + d / 2),
    });
  }

  /** Rock block with a grass cap; `top` is the walkable surface height. */
  ground({ x0, x1, top, z0 = -6, z1 = 6, depth = 12, grass = true, checkpoint = true }) {
    const w = x1 - x0, d = z1 - z0;
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    const g = new THREE.Group();

    const capH = grass ? 0.6 : 0;
    if (grass) {
      const cap = new THREE.Mesh(rockBox(w + 0.25, capH, d + 0.25, this.rng, 0.12), mat(C.grass, { vertexColors: true }));
      cap.position.set(cx, top - capH / 2, cz);
      cap.receiveShadow = true;
      cap.castShadow = true;
      g.add(cap);
      // dirt band right under the turf, as in the reference cliff edges
      const dirt = new THREE.Mesh(new THREE.BoxGeometry(w + 0.12, 0.5, d + 0.12), mat(C.dirt));
      dirt.position.set(cx, top - capH - 0.22, cz);
      g.add(dirt);
      this.grassSkirt(g, x0, x1, z0, z1, top - capH);
      this.scatterFoliage(g, x0, x1, z0, z1, top);
    }

    const body = new THREE.Mesh(rockBox(w, depth, d, this.rng, 0.22), mat(grass ? C.rock : C.grass, { vertexColors: true }));
    body.position.set(cx, top - capH - depth / 2, cz);
    body.receiveShadow = true;
    body.castShadow = true;
    g.add(body);

    // strata bands break up the big rock face
    for (let i = 0; i < 3; i++) {
      const y = top - capH - 1.4 - i * 2.1;
      if (y < top - capH - depth) break;
      const band = new THREE.Mesh(
        rockBox(w * 0.99, 0.5 + this.rng() * 0.3, d + 0.1, this.rng, 0.16),
        mat(i % 2 ? C.rockDark : C.rockLight, { vertexColors: true }),
      );
      band.position.set(cx, y, cz);
      g.add(band);
    }

    // chunky boulders on the visible face
    for (let i = 0; i < Math.max(3, Math.floor(w / 3)); i++) {
      const r = 0.5 + this.rng() * 0.9;
      const b = new THREE.Mesh(new THREE.DodecahedronGeometry(r, 0), mat(this.rng() < 0.5 ? C.rockDark : C.rockLight));
      b.position.set(x0 + this.rng() * w, top - capH - 0.8 - this.rng() * (depth - 2), z1 - 0.2 + this.rng() * 0.6);
      b.rotation.set(this.rng() * 3, this.rng() * 3, this.rng() * 3);
      b.castShadow = true;
      g.add(b);
    }

    // moss creeping over the lip
    for (let i = 0; i < Math.max(2, Math.floor(w / 5)); i++) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.55 + this.rng() * 0.5, 8, 6), mat(C.moss));
      m.scale.set(1.4, 0.5, 0.6);
      m.position.set(x0 + 1 + this.rng() * (w - 2), top - capH - 0.55 - this.rng() * 1.2, z1 + 0.05);
      g.add(m);
    }

    this.renderRoot.add(g);
    this.addCollider(cx, top, cz, w, d, depth + capH);
    if (checkpoint) this.checkpoints.push({ x: x0 + 1.5, y: top + 1.2, z: 0 });
    return g;
  }

  /** Hanging grass tufts along the top edge — the scalloped overhang in the reference. */
  grassSkirt(parent, x0, x1, z0, z1, y) {
    const material = mat(C.grass);
    const edges = [
      { from: [x0, z1], to: [x1, z1] },
      { from: [x0, z0], to: [x1, z0] },
      { from: [x0, z0], to: [x0, z1] },
      { from: [x1, z0], to: [x1, z1] },
    ];
    for (const e of edges) {
      const len = Math.hypot(e.to[0] - e.from[0], e.to[1] - e.from[1]);
      const n = Math.max(2, Math.round(len / 0.85));
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        const tuft = new THREE.Mesh(new THREE.SphereGeometry(0.42 + this.rng() * 0.18, 8, 6), material);
        tuft.position.set(
          THREE.MathUtils.lerp(e.from[0], e.to[0], t),
          y + 0.12 - this.rng() * 0.25,
          THREE.MathUtils.lerp(e.from[1], e.to[1], t),
        );
        tuft.scale.set(1, 0.75, 1);
        tuft.castShadow = true;
        parent.add(tuft);
      }
    }
  }

  scatterFoliage(parent, x0, x1, z0, z1, top) {
    const n = Math.floor((x1 - x0) * 0.7);
    for (let i = 0; i < n; i++) {
      const x = THREE.MathUtils.lerp(x0 + 1, x1 - 1, this.rng());
      const backHalf = this.rng() < 0.75;
      const z = backHalf
        ? THREE.MathUtils.lerp(z0 + 0.6, z0 + (z1 - z0) * 0.35, this.rng())
        : THREE.MathUtils.lerp(z1 - (z1 - z0) * 0.25, z1 - 0.5, this.rng());
      const r = this.rng();
      let prop;
      if (r < 0.3) prop = bush(0.6 + this.rng() * 0.5, this.rng);
      else if (r < 0.75) prop = flower([0xff8fb0, 0xffe066, 0xffffff, 0xc78fff][Math.floor(this.rng() * 4)]);
      else {
        prop = new THREE.Group();
        for (let b = 0; b < 4; b++) {
          const blade = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.4 + this.rng() * 0.3, 4), mat(C.grassLight));
          blade.position.set((this.rng() - 0.5) * 0.35, 0.2, (this.rng() - 0.5) * 0.35);
          blade.rotation.z = (this.rng() - 0.5) * 0.5;
          prop.add(blade);
        }
      }
      prop.position.set(x, top, z);
      parent.add(prop);
    }
  }

  /** Floating island: grass disc on a rock spike. */
  island({ x, y, z = 0, r = 2.5, depth = 3.5, tree = false }) {
    const g = new THREE.Group();
    g.position.set(x, y, z);

    const cap = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 0.97, 0.5, 12), mat(C.grass));
    cap.position.y = -0.25;
    cap.castShadow = true;
    cap.receiveShadow = true;
    g.add(cap);

    const rim = new THREE.Mesh(new THREE.TorusGeometry(r * 0.99, 0.24, 6, 16), mat(C.grass));
    rim.rotation.x = Math.PI / 2;
    rim.position.y = -0.42;
    rim.castShadow = true;
    g.add(rim);

    const rock = new THREE.Mesh(new THREE.ConeGeometry(r * 0.95, depth, 10), mat(C.rock));
    rock.position.y = -0.5 - depth / 2;
    rock.castShadow = true;
    g.add(rock);
    const rock2 = new THREE.Mesh(new THREE.ConeGeometry(r * 0.6, depth * 0.7, 8), mat(C.rockDark));
    rock2.position.set(r * 0.25, -0.5 - depth * 0.6, -r * 0.2);
    rock2.rotation.z = 0.25;
    rock2.castShadow = true;
    g.add(rock2);

    const v = vines(3, this.rng);
    v.position.set(r * 0.4, -0.6, r * 0.5);
    g.add(v);

    if (tree) {
      const t = this.rng() < 0.5 ? pineTree(0.9 + this.rng() * 0.4, this.rng) : roundTree(0.8, this.rng);
      t.position.set((this.rng() - 0.5) * r * 0.6, 0, -r * 0.3);
      g.add(t);
    }
    for (let i = 0; i < 3; i++) {
      const f = flower([0xff8fb0, 0xffe066, 0xffffff][i % 3]);
      f.position.set((this.rng() - 0.5) * r * 1.2, 0, (this.rng() - 0.5) * r * 1.2);
      g.add(f);
    }

    this.renderRoot.add(g);
    // square collider inscribed in the disc keeps landings forgiving but fair
    this.addCollider(x, y, z, r * 1.5, r * 1.5, depth + 1);
    this.checkpoints.push({ x, y: y + 1.2, z });
    return g;
  }

  /** Plank bridge with rope rails; walkable surface at `top`. */
  bridge({ x0, x1, top, z = 0, width = 5.2 }) {
    const g = new THREE.Group();
    const w = x1 - x0;
    const plankCount = Math.round(w / 0.62);
    for (let i = 0; i < plankCount; i++) {
      const px = x0 + (i + 0.5) * (w / plankCount);
      const plank = new THREE.Mesh(
        new THREE.BoxGeometry((w / plankCount) * 0.86, 0.26, width),
        mat(i % 3 === 0 ? C.woodDark : C.wood),
      );
      plank.position.set(px, top - 0.13, z);
      plank.rotation.x = (this.rng() - 0.5) * 0.02;
      plank.castShadow = true;
      plank.receiveShadow = true;
      g.add(plank);
    }

    // support beams under the deck
    for (const sz of [-1, 1]) {
      const beam = new THREE.Mesh(new THREE.BoxGeometry(w, 0.3, 0.35), mat(C.woodDark));
      beam.position.set((x0 + x1) / 2, top - 0.4, z + sz * (width / 2 - 0.35));
      beam.castShadow = true;
      g.add(beam);
    }

    // posts + rope handrails
    const posts = Math.max(3, Math.round(w / 4.5));
    for (let i = 0; i <= posts; i++) {
      const px = THREE.MathUtils.lerp(x0, x1, i / posts);
      for (const sz of [-1, 1]) {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.19, 1.9, 8), mat(C.woodPost));
        post.position.set(px, top + 0.55, z + sz * (width / 2 - 0.15));
        post.castShadow = true;
        g.add(post);
        const capTop = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.14, 8), mat(C.woodDark));
        capTop.position.set(px, top + 1.55, z + sz * (width / 2 - 0.15));
        g.add(capTop);

        if (i < posts) {
          const seg = (x1 - x0) / posts;
          for (const [h, r] of [[1.15, 0.05], [0.65, 0.045]]) {
            const rope = new THREE.Mesh(new THREE.CylinderGeometry(r, r, seg, 6), mat(C.rope));
            rope.rotation.z = Math.PI / 2;
            rope.position.set(px + seg / 2, top + h - 0.08, z + sz * (width / 2 - 0.15));
            g.add(rope);
          }
        }
      }
    }

    this.renderRoot.add(g);
    this.addCollider((x0 + x1) / 2, top, z, w, width, 0.5);
    this.checkpoints.push({ x: x0 + 1, y: top + 1.2, z });
    return g;
  }

  /** Background scenery — no collision, pure silhouette. */
  backdrop() {
    const rng = this.rng;
    const scene = this.renderRoot;

    // Layered cliffs behind the play area, with waterfalls
    const cliffs = [
      { x: 4, y: -16, z: -46, w: 26, h: 24, d: 14 },
      { x: 40, y: -14, z: -54, w: 30, h: 28, d: 16 },
      { x: 78, y: -16, z: -48, w: 26, h: 26, d: 14 },
      { x: -30, y: -18, z: -42, w: 20, h: 22, d: 12 },
      { x: 108, y: -18, z: -56, w: 28, h: 28, d: 16 },
      { x: 22, y: -22, z: -72, w: 34, h: 30, d: 18 },
      { x: 92, y: -24, z: -80, w: 30, h: 32, d: 18 },
    ];
    for (const c of cliffs) {
      const g = new THREE.Group();
      const rock = new THREE.Mesh(rockBox(c.w, c.h, c.d, rng, 0.24), mat(C.rock, { vertexColors: true }));
      rock.position.set(c.x, c.y + c.h / 2, c.z);
      rock.receiveShadow = true;
      g.add(rock);
      const cap = new THREE.Mesh(new THREE.BoxGeometry(c.w + 0.6, 1.4, c.d + 0.6), mat(C.grass));
      cap.position.set(c.x, c.y + c.h, c.z);
      g.add(cap);
      const dirt = new THREE.Mesh(new THREE.BoxGeometry(c.w + 0.3, 0.9, c.d + 0.3), mat(C.dirt));
      dirt.position.set(c.x, c.y + c.h - 1.1, c.z);
      g.add(dirt);
      for (let i = 0; i < 6; i++) {
        const b = new THREE.Mesh(new THREE.DodecahedronGeometry(1 + rng() * 1.6, 0), mat(rng() < 0.5 ? C.rockDark : C.rockLight));
        b.position.set(c.x + (rng() - 0.5) * c.w * 0.9, c.y + rng() * c.h * 0.9, c.z + c.d / 2);
        b.rotation.set(rng() * 3, rng() * 3, rng() * 3);
        g.add(b);
      }
      for (let i = 0; i < 4; i++) {
        const t = rng() < 0.6 ? pineTree(1.6 + rng() * 1.2, rng) : roundTree(1.5 + rng(), rng);
        t.position.set(c.x + (rng() - 0.5) * c.w * 0.85, c.y + c.h + 0.5, c.z + (rng() - 0.5) * c.d * 0.5);
        g.add(t);
      }
      // strata
      for (let i = 1; i < 4; i++) {
        const band = new THREE.Mesh(new THREE.BoxGeometry(c.w * 0.99, 0.8, c.d + 0.2), mat(i % 2 ? C.rockDark : C.rockLight));
        band.position.set(c.x, c.y + c.h - i * 3.5, c.z);
        g.add(band);
      }
      scene.add(g);

      const wf = waterfall(3 + rng() * 3, c.h * 0.85, scene);
      wf.userData.threeNativeDynamic = true;
      wf.position.set(c.x + (rng() - 0.5) * c.w * 0.5, c.y + c.h - 0.5, c.z + c.d / 2 + 0.2);
      scene.add(wf);
      this.updaters.push((dt) => updateWaterfall(wf, dt));
    }

    // Distant floating islands
    for (let i = 0; i < 12; i++) {
      const g = new THREE.Group();
      const r = 2 + rng() * 5;
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 0.95, 1.2, 10), mat(C.grass));
      g.add(cap);
      const spike = new THREE.Mesh(new THREE.ConeGeometry(r * 0.9, r * 2.2, 8), mat(C.rock));
      spike.position.y = -r * 1.2;
      g.add(spike);
      for (let t = 0; t < 3; t++) {
        const tree = rng() < 0.5 ? pineTree(0.8 + rng() * 0.8, rng) : roundTree(0.7 + rng() * 0.6, rng);
        tree.position.set((rng() - 0.5) * r, 0.6, (rng() - 0.5) * r);
        g.add(tree);
      }
      g.position.set(-40 + rng() * 190, 4 + rng() * 28, -45 - rng() * 90);
      scene.add(g);
    }

    const cas = castle();
    cas.position.set(26, 4, -78);
    cas.scale.setScalar(1.7);
    scene.add(cas);

    const mill = windmill();
    mill.userData.threeNativeDynamic = true;
    mill.position.set(74, 12, -66);
    mill.scale.setScalar(1.9);
    scene.add(mill);
    this.updaters.push((dt) => updateWindmill(mill, dt));

    const ship = airship();
    ship.userData.threeNativeDynamic = true;
    ship.position.set(-10, 34, -52);
    ship.scale.setScalar(2.2);
    scene.add(ship);
    this.updaters.push((dt) => {
      ship.position.x += dt * 1.4;
      ship.position.y += Math.sin(performance.now() * 0.0004) * dt * 1.5;
      if (ship.position.x > 190) ship.position.x = -60;
    });
  }

  /** Assemble the whole stage. */
  build({ defer = false } = {}) {
    const rng = this.rng;

    // --- act 1: mesa, rope bridge, big meadow ---------------------------
    this.ground({ x0: -20, x1: -7, top: 0, z0: -7, z1: 6, depth: 16 });
    this.bridge({ x0: -7, x1: 10, top: 0, width: 5.4 });

    if (!defer) this.buildActsTwoAndThree(rng);
    this.backdrop();
    this.checkpoints.sort((a, b) => a.x - b.x);
    return this;
  }

  /**
   * Acts 2 and 3, which start at x=34 while the player starts at x=-5.
   *
   * They are off screen at launch, so building them after the loading screen comes down takes
   * their cost out of the launch without the player seeing anything appear. Colliders come with
   * them, and the fox cannot cross x=32 in the time this takes.
   */
  buildLater() {
    if (this.builtLater === true) return this;
    this.builtLater = true;
    const rng = this.rng;
    this.buildActsTwoAndThree(rng);
    this.checkpoints.sort((a, b) => a.x - b.x);
    return this;
  }

  buildActsTwoAndThree(rng) {
    // The rest of act 1's meadow. The fox starts at x=-5 and the camera does not reach x=10 at
    // that moment, so this is off screen too.
    this.ground({ x0: 10, x1: 30, top: 0, z0: -7, z1: 6, depth: 16 });

    // --- act 2: rising steps ------------------------------------------
    this.ground({ x0: 34, x1: 41, top: 1.5, z0: -5, z1: 5, depth: 14 });
    this.island({ x: 45.5, y: 3.2, z: 1.2, r: 2.4, tree: true });
    this.island({ x: 50.5, y: 4.8, z: -1.4, r: 2.1 });
    this.island({ x: 55, y: 6.2, z: 1.0, r: 2.6, tree: true });

    // --- act 3: high meadow, second bridge, goal -----------------------
    this.ground({ x0: 59, x1: 74, top: 3, z0: -7, z1: 6, depth: 18 });
    this.bridge({ x0: 74, x1: 82, top: 3, width: 5.0 });
    this.ground({ x0: 82, x1: 97, top: 3, z0: -7, z1: 6, depth: 20 });

    // trees + fences on the meadows
    for (const [x, z, s] of [[13, -5.4, 1.1], [17.5, -5.8, 0.9], [27, -5.2, 1.2], [62, -5.6, 1.1], [70, -5.4, 1.3], [86, -5.6, 1.2], [93, -5, 1.0]]) {
      const t = rng() < 0.5 ? pineTree(s * 1.3, rng) : roundTree(s * 1.2, rng);
      const top = x < 32 ? 0 : 3;
      t.position.set(x, top, z);
      this.renderRoot.add(t);
    }
    for (const [x, top, len] of [[19, 0, 7], [63, 3, 8]]) {
      const f = fence(len, 5);
      f.position.set(x, top, -6.2);
      this.renderRoot.add(f);
    }

    // crates + a '?' block, as in the reference
    for (const [x, y, z, s] of [[27.6, 0, 3.2, 1.1], [28.8, 0, 3.2, 1.1], [27.6, 1.1, 3.2, 1.1], [88, 3, 3.4, 1.2]]) {
      const c = crate(s);
      c.position.set(x, y + s / 2, z);
      this.renderRoot.add(c);
      this.addCollider(x, y + s, z, s, s, s);
    }
    const qb = questionBlock(1.2);
    qb.userData.threeNativeDynamic = true;
    qb.position.set(24, 3.6, 2.6);
    this.renderRoot.add(qb);
    this.addCollider(24, 4.2, 2.6, 1.2, 1.2, 1.2);
    this.updaters.push((dt) => { qb.position.y = 3.6 + Math.sin(performance.now() * 0.002) * 0.08; void dt; });

    const flag = goalFlag();
    flag.userData.threeNativeDynamic = true;
    flag.position.set(this.goalX, 3, 0);
    this.renderRoot.add(flag);
    this.updaters.push(() => {
      const cloth = flag.userData.cloth;
      const pos = cloth.geometry.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i);
        pos.setZ(i, Math.sin(performance.now() * 0.006 + x * 3) * 0.12 * (x + 0.9));
      }
      pos.needsUpdate = true;
    });

  }

  /** Ground height directly under a point (or -Infinity). */
  groundAt(x, z, fromY) {
    let best = -Infinity;
    for (const b of this.colliders) {
      if (x < b.min.x - 0.3 || x > b.max.x + 0.3) continue;
      if (z < b.min.z - 0.3 || z > b.max.z + 0.3) continue;
      if (b.max.y <= fromY + 0.2 && b.max.y > best) best = b.max.y;
    }
    return best;
  }

  update(dt) {
    for (const u of this.updaters) u(dt);
  }
}
