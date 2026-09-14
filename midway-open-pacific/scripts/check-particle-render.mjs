/**
 * Regression check for the particle batch packing split (PRD-midway-flak-hunt).
 *
 * Node only: bundles the real `CombatParticles` and a real `three` scene, then drives the class
 * through `update` and the mesh's ordinary `onBeforeRender` hook. No renderer, no GPU, no browser.
 *
 * The contract under test:
 *   1. five simulation updates emit/age but do not sort or pack any batch;
 *   2. the mesh's first `onBeforeRender` packs the current (latest) pool state into its geometry;
 *   3. emission counts and aging are unchanged;
 *   4. empty -> nonempty -> reset instance-count transitions are correct;
 *   5. the smoke batch is packed far-to-near without reordering the simulation pool, and the glow
 *      batch keeps pool order.
 *
 * Run: node scripts/check-particle-render.mjs
 */
import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const bundled = await build({
  stdin: {
    contents: `
      export { CombatParticles } from "./src/render/particles.ts";
      export * as THREE from "three";
    `,
    loader: "ts",
    resolveDir: root,
  },
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node20",
  write: false,
  logLevel: "silent",
});
const { CombatParticles, THREE } = await import(
  `data:text/javascript,${encodeURIComponent(bundled.outputFiles[0].text)}`
);

const STEP = 1 / 60;

function emptyBattle() {
  return {
    time: 0,
    wind: { x: 0, z: 0 },
    effects: [],
    aircraft: [],
    player: { mode: "deck", damage: null },
    ships: [],
  };
}

/** Count every pack attempt without changing what it packs. */
function instrument(cp) {
  const stats = { packs: 0 };
  const original = cp.writeBatch.bind(cp);
  cp.writeBatch = (...args) => {
    stats.packs += 1;
    return original(...args);
  };
  return stats;
}

function render(cp, scene, camera) {
  cp.smokeBatch.mesh.onBeforeRender({}, scene, camera);
  cp.glowBatch.mesh.onBeforeRender({}, scene, camera);
}

function packedDistances(cp, camera) {
  const count = cp.smokeBatch.geometry.instanceCount;
  const a = cp.smokeBatch.arrays.aPosition;
  const out = [];
  for (let i = 0; i < count; i += 1) {
    const k = i * 3;
    out.push((a[k] - camera.position.x) ** 2 + (a[k + 1] - camera.position.y) ** 2 + (a[k + 2] - camera.position.z) ** 2);
  }
  return out;
}

const failures = [];
const check = (name, fn) => {
  try {
    fn();
    console.log(`  ok   ${name}`);
  } catch (error) {
    failures.push(`${name}: ${error.message}`);
    console.log(`  FAIL ${name}: ${error.message}`);
  }
};

console.log("check-particle-render: contract");

// 1. Five simulation updates must not pack.
const stage = (() => {
  const scene = new THREE.Scene();
  const cp = new CombatParticles(scene);
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(0, 100, 0);
  camera.updateMatrixWorld(true);
  const battle = emptyBattle();
  const stats = instrument(cp);
  for (let i = 0; i < 5; i += 1) {
    battle.time += STEP;
    cp.update(battle, camera.position);
  }
  return { scene, cp, camera, battle, stats };
})();

check("five updates pack nothing", () => {
  assert.equal(stage.stats.packs, 0, `writeBatch ran ${stage.stats.packs} times during 5 updates`);
});
check("five updates leave both instance counts at zero (empty pools)", () => {
  assert.equal(stage.cp.smokeBatch.geometry.instanceCount, 0);
  assert.equal(stage.cp.glowBatch.geometry.instanceCount, 0);
});

// 2. One hit effect -> update emits; still no pack until the render hook.
stage.battle.effects.push({ id: "e1", type: "hit", x: 300, y: 200, z: 0, size: 1 });
stage.battle.time += STEP;
stage.cp.update(stage.battle, stage.camera.position);
check("emission still happens in update (hit: 2 smoke, 9 glow)", () => {
  assert.equal(stage.cp.smoke.items.length, 2, `smoke=${stage.cp.smoke.items.length}`);
  assert.equal(stage.cp.glow.items.length, 9, `glow=${stage.cp.glow.items.length}`);
});
check("emitting update still packs nothing", () => {
  assert.equal(stage.stats.packs, 0, `writeBatch ran ${stage.stats.packs} times during emitting update`);
});
check("no instance is drawn before the first render hook", () => {
  assert.equal(stage.cp.smokeBatch.geometry.instanceCount, 0);
  assert.equal(stage.cp.glowBatch.geometry.instanceCount, 0);
});

const ageBefore = stage.cp.smoke.items[0].age;
render(stage.cp, stage.scene, stage.camera);
check("first render hook packs each batch exactly once", () => {
  assert.equal(stage.stats.packs, 2, `writeBatch ran ${stage.stats.packs} times (expected 2)`);
});
check("first render hook packs the latest pool state", () => {
  assert.equal(stage.cp.smokeBatch.geometry.instanceCount, stage.cp.smoke.items.length);
  assert.equal(stage.cp.glowBatch.geometry.instanceCount, stage.cp.glow.items.length);
  assert.ok(stage.cp.smokeBatch.geometry.instanceCount > 0);
});

// 3. Aging unchanged: advance time, update, ages grow; the hook packs one more time.
stage.battle.time += 0.1;
stage.cp.update(stage.battle, stage.camera.position);
check("aging still advances in update", () => {
  assert.ok(stage.cp.smoke.items[0].age > ageBefore, `${ageBefore} -> ${stage.cp.smoke.items[0].age}`);
});
render(stage.cp, stage.scene, stage.camera);
check("second render hook packs the aged state (one more pack per batch)", () => {
  assert.equal(stage.stats.packs, 4, `writeBatch ran ${stage.stats.packs} times (expected 4)`);
});

// 4. Empty -> nonempty -> reset counts.
check("reset returns both counts to zero without packing", () => {
  const before = stage.stats.packs;
  stage.cp.reset();
  assert.equal(stage.cp.smokeBatch.geometry.instanceCount, 0);
  assert.equal(stage.cp.glowBatch.geometry.instanceCount, 0);
  assert.equal(stage.stats.packs, before, "reset must not pack");
  render(stage.cp, stage.scene, stage.camera);
  assert.equal(stage.cp.smokeBatch.geometry.instanceCount, 0);
  assert.equal(stage.cp.glowBatch.geometry.instanceCount, 0);
});

// 5. Smoke packs far-to-near and never reorders the pool; glow keeps pool order.
check("smoke sort matches distance and cannot reorder the simulation pool", () => {
  const scene = new THREE.Scene();
  const cp = new CombatParticles(scene);
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(0, 0, 0);
  camera.updateMatrixWorld(true);
  cp.reset();
  const at = (x, y, z) => cp.emit(cp.smoke, { x, y, z }, { life: 100, size: 1, growth: 0, kind: 0, alpha: 1 });
  at(10, 0, 0);
  at(50, 0, 0);
  at(30, 0, 0);
  const refs = [...cp.smoke.items];
  assert.equal(refs.length, 3, "three seeded smoke particles");
  cp.smokeBatch.mesh.onBeforeRender({}, scene, camera);
  // Pool order untouched (the packer sorts a copy).
  cp.smoke.items.forEach((p, i) => assert.equal(p, refs[i], `pool item ${i} moved`));
  // Packed order is descending distance.
  const d = packedDistances(cp, camera);
  assert.equal(d.length, 3);
  for (let i = 1; i < d.length; i += 1)
    assert.ok(d[i] <= d[i - 1] + 1e-6, `distance order not descending: ${d.join(",")}`);
});

check("glow batch keeps pool order", () => {
  const scene = new THREE.Scene();
  const cp = new CombatParticles(scene);
  const camera = new THREE.PerspectiveCamera();
  cp.reset();
  const a = cp.emit(cp.glow, { x: 50, y: 0, z: 0 }, { life: 100, size: 1, growth: 0, kind: 1, alpha: 1 });
  const b = cp.emit(cp.glow, { x: 5, y: 0, z: 0 }, { life: 100, size: 1, growth: 0, kind: 1, alpha: 1 });
  camera.updateMatrixWorld(true);
  cp.glowBatch.mesh.onBeforeRender({}, scene, camera);
  const arr = cp.glowBatch.arrays.aPosition;
  assert.equal(cp.glowBatch.geometry.instanceCount, 2);
  assert.equal(arr[0], a.x, "glow first packed x must be the first emitted");
  assert.equal(arr[3], b.x, "glow second packed x must be the second emitted");
});

if (failures.length) {
  console.error(`\ncheck-particle-render: FAIL (${failures.length})`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log("\ncheck-particle-render: PASS");
