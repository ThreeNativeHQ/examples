import { readFile } from "node:fs/promises";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { Vector3, Quaternion, Euler } from "three";
globalThis.ProgressEvent ??= class extends Event { constructor(t,i={}){super(t);Object.assign(this,i);} };
const bytes = await readFile(process.argv[2]);
const n = bytes.readUInt32LE(12);
const json = JSON.parse(bytes.subarray(20, 20 + n).toString());
for (const m of json.materials ?? []) { delete m.normalTexture; delete m.occlusionTexture; delete m.emissiveTexture;
  if (m.pbrMetallicRoughness) { delete m.pbrMetallicRoughness.baseColorTexture; delete m.pbrMetallicRoughness.metallicRoughnessTexture; } }
delete json.textures; delete json.images;
json.buffers[0].uri = "data:application/octet-stream;base64," + bytes.subarray(28 + n).toString("base64");
const gltf = await new GLTFLoader().parseAsync(JSON.stringify(json), "");
gltf.scene.updateMatrixWorld(true);
const pivot = gltf.scene.getObjectByName(process.argv[3]);
if (!pivot) { console.log("NOT FOUND"); process.exit(1); }
const q = new Quaternion(); const pos = new Vector3(); const s = new Vector3();
pivot.matrixWorld.decompose(pos, q, s);
console.log("pivot world pos", pos.toArray().map(v=>v.toFixed(3)).join(","), "scale", s.toArray().map(v=>v.toFixed(3)).join(","));
console.log("pivot world euler(deg)", new Euler().setFromQuaternion(q).toArray().slice(0,3).map(v=>(v*180/Math.PI).toFixed(2)).join(","));
for (const [name, axis] of [["localX",[1,0,0]],["localY",[0,1,0]],["localZ",[0,0,1]]])
  console.log(name, "-> world", new Vector3(...axis).applyQuaternion(q).toArray().map(v=>v.toFixed(3)).join(","));
console.log("local quat", pivot.quaternion.toArray().map(v=>v.toFixed(4)).join(","));
console.log("children", pivot.children.map(c=>c.name).join(" | "));
