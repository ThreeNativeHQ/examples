// Per-node world-space bounds for one GLB, to find nose direction, propellers, gear and glass.
import { readFile } from "node:fs/promises";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { Box3, Vector3 } from "three";
globalThis.ProgressEvent ??= class extends Event {
  constructor(t, i = {}) { super(t); Object.assign(this, i); }
};
const [path, filter] = process.argv.slice(2);
const bytes = await readFile(path);
const n = bytes.readUInt32LE(12);
const json = JSON.parse(bytes.subarray(20, 20 + n).toString());
for (const m of json.materials ?? []) {
  delete m.normalTexture; delete m.occlusionTexture; delete m.emissiveTexture;
  if (m.pbrMetallicRoughness) {
    delete m.pbrMetallicRoughness.baseColorTexture;
    delete m.pbrMetallicRoughness.metallicRoughnessTexture;
  }
}
delete json.textures; delete json.images;
json.buffers[0].uri = "data:application/octet-stream;base64," + bytes.subarray(28 + n).toString("base64");
const gltf = await new GLTFLoader().parseAsync(JSON.stringify(json), "");
gltf.scene.updateMatrixWorld(true);
const re = filter ? new RegExp(filter, "i") : null;
const rows = [];
gltf.scene.traverse((node) => {
  if (!node.isMesh) return;
  if (re && !re.test(node.name) && !re.test(node.parent?.name ?? "")) return;
  const b = new Box3().setFromObject(node);
  const s = b.getSize(new Vector3());
  const c = b.getCenter(new Vector3());
  const tris = (node.geometry.index ? node.geometry.index.count : node.geometry.attributes.position.count) / 3;
  rows.push({
    name: node.name, parent: node.parent?.name ?? "", tris: Math.round(tris),
    size: [s.x, s.y, s.z].map((v) => v.toFixed(2)).join("x"),
    centre: [c.x, c.y, c.z].map((v) => v.toFixed(2)).join(","),
    material: Array.isArray(node.material) ? "multi" : node.material.name || "-",
  });
});
rows.sort((a, b) => b.tris - a.tris);
for (const r of rows)
  console.log(`${String(r.tris).padStart(6)}  ${r.size.padEnd(20)} @ ${r.centre.padEnd(22)} ${r.material.padEnd(16)} ${r.name}  <- ${r.parent}`);
console.log(`\nclips:`);
for (const c of gltf.animations)
  console.log(`  ${c.name} ${c.duration.toFixed(2)}s  tracks: ${c.tracks.map((t) => t.name).join(", ")}`);
