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
for (let i = 0; i < 5; i++) {
  battle.time += 1 / 60;
  cp.update(battle, camera);
}
assert.equal(cp.smokeBatch.geometry.instanceCount, 0);
battle.effects.push({ id: "hit", type: "hit", x: 300, y: 200, z: 0, size: 1 });
battle.time += 1 / 60;
cp.update(battle, camera);
assert.equal(cp.smoke.items.length, 2);
assert.equal(cp.glow.items.length, 9);
assert.equal(cp.smokeBatch.geometry.instanceCount, 2, "new smoke is ready for the next draw");
assert.equal(cp.glowBatch.geometry.instanceCount, 9, "new sparks are ready for the next draw");
const age = cp.smoke.items[0].age;
battle.time += 0.1;
cp.update(battle, camera);
assert.ok(cp.smoke.items[0].age > age);
cp.reset();
assert.equal(cp.smokeBatch.geometry.instanceCount, 0);
assert.equal(cp.glowBatch.geometry.instanceCount, 0);

for (const x of [10, 50, 30]) cp.emit(cp.smoke, { x, y: 0, z: 0 }, { life: 100, size: 1 });
const originalOrder = [...cp.smoke.items];
cp.writeBatch(cp.smoke, cp.smokeBatch, new THREE.Vector3(), true);
assert.deepEqual(cp.smoke.items, originalOrder, "sorting must not change simulation pool order");
const smokePositions = cp.smokeBatch.arrays.aPosition;
assert.deepEqual([smokePositions[0], smokePositions[3], smokePositions[6]], [50, 30, 10]);
for (const x of [50, 5]) cp.emit(cp.glow, { x, y: 0, z: 0 }, { life: 100, size: 1 });
cp.writeBatch(cp.glow, cp.glowBatch, new THREE.Vector3(), false);
const glowPositions = cp.glowBatch.arrays.aPosition;
assert.deepEqual([glowPositions[0], glowPositions[3]], [50, 5], "glow preserves emission order");
cp.dispose();
console.log("PASS: batching-compatible particle meshes, current buffers, emission, aging, reset and ordering");
