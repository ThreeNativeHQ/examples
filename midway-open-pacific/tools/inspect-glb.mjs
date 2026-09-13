// Generic GLB inspector: dimensions, orientation, node names, clips, material/triangle counts.
import { readFile } from "node:fs/promises";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { Box3, Vector3 } from "three";

// three's FileLoader emits ProgressEvent even for a data: URI; node 20 has no such global.
globalThis.ProgressEvent ??= class ProgressEvent extends Event {
  constructor(type, init = {}) {
    super(type);
    Object.assign(this, init);
  }
};

const loader = new GLTFLoader();

for (const path of process.argv.slice(2)) {
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
  const images = (json.images ?? []).length;
  delete json.textures;
  delete json.images;
  json.buffers[0].uri =
    "data:application/octet-stream;base64," +
    bytes.subarray(28 + headerLength).toString("base64");
  const gltf = await loader.parseAsync(JSON.stringify(json), "");
  const box = new Box3().setFromObject(gltf.scene);
  const size = box.getSize(new Vector3());
  let tris = 0;
  const meshes = [];
  const materials = new Set();
  gltf.scene.traverse((n) => {
    if (!n.isMesh) return;
    const g = n.geometry;
    tris += (g.index ? g.index.count : g.attributes.position.count) / 3;
    meshes.push(n.name);
    for (const m of Array.isArray(n.material) ? n.material : [n.material]) materials.add(m.uuid);
  });
  console.log(`\n######## ${path}`);
  console.log(
    `size XYZ = ${size.x.toFixed(2)} x ${size.y.toFixed(2)} x ${size.z.toFixed(2)}  ` +
      `min.y=${box.min.y.toFixed(2)} max.y=${box.max.y.toFixed(2)}`,
  );
  console.log(`centre = ${box.getCenter(new Vector3()).toArray().map((v) => v.toFixed(2)).join(", ")}`);
  console.log(`triangles=${Math.round(tris)}  meshes=${meshes.length}  materials=${materials.size}  images=${images}`);
  console.log(`clips = ${gltf.animations.map((c) => `${c.name}(${c.duration.toFixed(2)}s,${c.tracks.length}t)`).join(", ") || "none"}`);
  const named = [];
  gltf.scene.traverse((n) => { if (n.name) named.push(`${n.type}:${n.name}`); });
  console.log(`nodes(${named.length}) = ${named.slice(0, 70).join(" | ")}`);
}
