import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { BufferGeometry, Texture } from "three";

const root = fileURLToPath(new URL("../", import.meta.url));
const temporary = await mkdtemp(`${root}tests/.shared-materials-`);
after(() => rm(temporary, { recursive: true, force: true }));

await build({
  stdin: {
    contents: 'export { createSharedFoliageMaterial } from "./src/render/sharedMaterials.ts";',
    resolveDir: root,
  },
  outfile: `${temporary}/shared-materials.mjs`,
  bundle: true,
  platform: "node",
  format: "esm",
  packages: "external",
});

const { createSharedFoliageMaterial } = await import(`${temporary}/shared-materials.mjs`);

const section = (map, cutout = true) => ({
  alphaCutoff: 0.37,
  cutout,
  geometry: new BufferGeometry(),
  map,
  normal: undefined,
});

const wind = { speed: 0.13, stiffness: 1.3, strength: 0.045 };

test("foliage material data stays independent in the shared factory", () => {
  const first = createSharedFoliageMaterial({
    ...section(new Texture()),
    gain: [3.3, 3.6, 2.8],
    wind,
  });
  const second = createSharedFoliageMaterial({
    ...section(new Texture()),
    gain: [3.9, 3.4, 2.7],
    wind: { speed: 0.11, stiffness: 1.8, strength: 0.011 },
  });

  const firstGain = first.colorNode.node.bNode;
  const secondGain = second.colorNode.node.bNode;
  assert.equal(firstGain.isUniformNode, true);
  assert.equal(secondGain.isUniformNode, true);
  assert.deepEqual(firstGain.value.toArray(), [3.3, 3.6, 2.8]);
  assert.deepEqual(secondGain.value.toArray(), [3.9, 3.4, 2.7]);
  assert.notEqual(firstGain, secondGain);
  assert.equal(first.alphaTestNode.isUniformNode, true);
  assert.equal(first.alphaTestNode.value, 0.37);
  assert.notEqual(first.opacityNode, second.opacityNode);
  assert.notEqual(first.alphaTestNode, second.alphaTestNode);
  assert.equal(first.positionNode, second.positionNode);
  assert.equal(first.positionNode.getCacheKey(true), second.positionNode.getCacheKey(true));
  assert.equal(first.foliageWindSpeed, 0.13);
  assert.equal(second.foliageWindSpeed, 0.11);
});
