/** Particle buffers stay current without mesh hooks that disable engine batching. */
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

const scene = new THREE.Scene();
const cp = new CombatParticles(scene);
const camera = new THREE.Vector3(0, 100, 0);
const battle = { time: 0, wind: { x: 0, z: 0 }, effects: [], aircraft: [], player: { mode: "deck", damage: null }, ships: [] };
for (const batch of [cp.smokeBatch, cp.glowBatch]) {
  assert.equal(Object.hasOwn(batch.mesh, "onBeforeRender"), false, "a mesh draw hook disables full-roster batching");
  assert.equal(Object.hasOwn(batch.mesh, "onAfterRender"), false, "a mesh draw hook disables full-roster batching");
  assert.equal(batch.geometry.instanceCount, 0);
}

let packingCalls = 0;
const writeBatch = cp.writeBatch;
cp.writeBatch = function (...args) { packingCalls += 1; return writeBatch.apply(this, args); };
// Fixed updates advance the simulation and emitters but never pack a draw buffer.
for (let i = 0; i < 5; i++) {
  battle.time += 1 / 60;
  cp.update(battle, camera);
}
assert.equal(cp.smokeBatch.geometry.instanceCount, 0, "fixed updates pack no smoke; packing belongs to prepare");
assert.equal(cp.glowBatch.geometry.instanceCount, 0, "fixed updates pack no glow; packing belongs to prepare");
battle.effects.push({ id: "hit", type: "hit", x: 300, y: 200, z: 0, size: 1 });
battle.time += 1 / 60;
cp.update(battle, camera);
assert.equal(cp.smoke.items.length, 2);
assert.equal(cp.glow.items.length, 9);
assert.equal(cp.smokeBatch.geometry.instanceCount, 0, "an emitting update still packs nothing");
assert.equal(cp.glowBatch.geometry.instanceCount, 0, "an emitting update still packs nothing");

// Aging stays in update; the buffers only follow on the next prepare with the latest positions.
const age = cp.smoke.items[0].age;
battle.time += 0.1;
cp.update(battle, camera);
assert.ok(cp.smoke.items[0].age > age);
assert.equal(packingCalls, 0, "fixed updates never call the buffer packer");
cp.prepare(camera);
assert.equal(packingCalls, 2, "one preparation packs exactly two batches");
assert.ok(cp.smoke.items.length > 0 && cp.glow.items.length > 0, "the hit left live particles to pack");
assert.equal(cp.smokeBatch.geometry.instanceCount, cp.smoke.items.length, "prepare packs every live smoke particle exactly once");
assert.equal(cp.glowBatch.geometry.instanceCount, cp.glow.items.length, "prepare packs every live glow particle exactly once");
const smokePositions = cp.smokeBatch.arrays.aPosition;
const live = cp.smoke.items;
const packed = [];
for (let i = 0; i < cp.smokeBatch.geometry.instanceCount; i++) packed.push([smokePositions[i * 3], smokePositions[i * 3 + 1], smokePositions[i * 3 + 2]]);
for (const p of live) {
  assert.ok(
    packed.some(([x, y, z]) => x === Math.fround(p.x) && y === Math.fround(p.y) && z === Math.fround(p.z)),
    "packed smoke holds the latest simulated position",
  );
}
cp.reset();
assert.equal(cp.smokeBatch.geometry.instanceCount, 0);
assert.equal(cp.glowBatch.geometry.instanceCount, 0);

for (const x of [10, 50, 30]) cp.emit(cp.smoke, { x, y: 0, z: 0 }, { life: 100, size: 1 });
const originalOrder = [...cp.smoke.items];
cp.prepare(new THREE.Vector3());
assert.deepEqual(cp.smoke.items, originalOrder, "sorting must not change simulation pool order");
assert.deepEqual([smokePositions[0], smokePositions[3], smokePositions[6]], [50, 30, 10], "smoke sorts farthest-first");
for (const x of [50, 5]) cp.emit(cp.glow, { x, y: 0, z: 0 }, { life: 100, size: 1 });
cp.prepare(new THREE.Vector3());
const glowPositions = cp.glowBatch.arrays.aPosition;
assert.deepEqual([glowPositions[0], glowPositions[3]], [50, 5], "glow preserves emission order");
cp.dispose();
console.log("PASS: fixed updates do not pack, prepare packs both batches once with latest positions, sorting is non-mutating, and no mesh hooks exist");
