/**
 * Fleet asset gate: parses the shipped GLBs without a browser and asserts the
 * facts the game's render code depends on (crew rig/clips, aircraft pivot and
 * orientation, hull axis and length, atoll scale). Exits non-zero on mismatch.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { Box3, Quaternion, Vector3 } from "three";

// three's FileLoader emits ProgressEvent even for a data: URI; node 20 has no such global.
globalThis.ProgressEvent ??= class ProgressEvent extends Event {
  constructor(type, init = {}) {
    super(type);
    Object.assign(this, init);
  }
};

const loader = new GLTFLoader();
const asset = (name) => new URL(`../public/assets/${name}`, import.meta.url);

async function loadGlb(path) {
  const bytes = await readFile(path);
  const headerLength = bytes.readUInt32LE(12);
  const json = JSON.parse(bytes.subarray(20, 20 + headerLength).toString());
  // Strip textures so node can parse without an image decoder.
  for (const material of json.materials ?? []) {
    delete material.normalTexture;
    delete material.occlusionTexture;
    delete material.emissiveTexture;
    if (material.pbrMetallicRoughness) {
      delete material.pbrMetallicRoughness.baseColorTexture;
      delete material.pbrMetallicRoughness.metallicRoughnessTexture;
    }
    for (const ext of Object.values(material.extensions ?? {})) {
      if (ext && typeof ext === "object")
        for (const k of Object.keys(ext)) if (k.endsWith("Texture")) delete ext[k];
    }
  }
  delete json.textures;
  delete json.images;
  json.buffers[0].uri =
    "data:application/octet-stream;base64," +
    bytes.subarray(28 + headerLength).toString("base64");
  return loader.parseAsync(JSON.stringify(json), "");
}

const sizeOf = (object) => new Box3().setFromObject(object).getSize(new Vector3());

{
  const gltf = await loadGlb(asset("deck-crew.glb"));
  gltf.scene.updateMatrixWorld(true);

  const names = gltf.animations.map((clip) => clip.name).sort();
  assert.deepEqual(names, [
    "crew.chock",
    "crew.idle",
    "crew.service",
    "crew.signal",
    "crew.wait",
    "crew.walk",
  ], "deck-crew clip names changed");
  assert.equal(names.length, 6, "deck-crew must have exactly 6 clips");
  for (const clip of gltf.animations)
    assert(clip.tracks.length > 100, `${clip.name} is not a full-skeleton clip`);

  let skinned;
  let head;
  gltf.scene.traverse((node) => {
    if (node.isSkinnedMesh && !skinned) skinned = node;
    if (node.isBone && node.name === "Head") head = node;
  });
  assert(skinned, "deck-crew has no SkinnedMesh");
  // 66 joints: the 65-bone man plus Blender's unweighted neutral_bone export helper.
  assert.equal(skinned.skeleton.bones.length, 66, "deck-crew skeleton bone count");
  assert(head, "deck-crew has no Head bone");
  const height = sizeOf(gltf.scene).y;
  assert(height >= 1.8 && height <= 1.86, `crew height ${height.toFixed(3)} out of range`);
}

{
  const gltf = await loadGlb(asset("aircraft.mitsubishi-a6m3.glb"));
  gltf.scene.updateMatrixWorld(true);

  const span = sizeOf(gltf.scene).x;
  assert(span >= 11.0 && span <= 11.3, `A6M3 wingspan ${span.toFixed(3)} out of range`);

  const pivot = gltf.scene.getObjectByName("VINTThreeNativePivot");
  assert(pivot, "A6M3 pivot node missing");
  const position = pivot.getWorldPosition(new Vector3());
  const quaternion = pivot.getWorldQuaternion(new Quaternion());
  assert(position.z < -3, `A6M3 pivot Z ${position.z.toFixed(3)} is not ahead of origin`);
  quaternion.toArray().forEach((value, i) => {
    assert(Math.abs(value - (i === 3 ? 1 : 0)) < 1e-4, `A6M3 pivot quaternion[${i}]=${value} not identity`);
  });
}

{
  const gltf = await loadGlb(asset("destroyer.samidare.glb"));
  gltf.scene.updateMatrixWorld(true);

  let hull;
  gltf.scene.traverse((node) => {
    if (node.isMesh && node.name === "Object001_hull_0") hull = node;
  });
  assert(hull, "destroyer hull mesh missing");
  const size = sizeOf(hull);
  assert(size.x >= 140 && size.x <= 148, `destroyer hull length ${size.x.toFixed(2)} out of range`);
  assert(size.x > size.y && size.x > size.z, "destroyer hull does not run along X");
}

{
  const gltf = await loadGlb(asset("midway-atoll.glb"));
  gltf.scene.updateMatrixWorld(true);

  const width = sizeOf(gltf.scene).x;
  assert(width >= 1.99 && width <= 2.01, `atoll width ${width.toFixed(3)} out of range`);
}
console.log("PASS check-fleet: crew, A6M3, Samidare hull and Midway atoll assets match");
