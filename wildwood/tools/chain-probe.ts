/** One-off: which nodes does ANIM_Fox_Walk actually drive, and where does the 180° enter? */
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { AnimationMixer, Quaternion, Vector3 } from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder as ThreeMeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";

const ROOT = resolve(import.meta.dirname, "..");
const ANIMAL_LISTING = "2dd7964c-a601-4264-a53d-465dcae1644c";

const assetRequire = createRequire(import.meta.resolve("@threenative/assets"));
const importAssetDependency = async (name) =>
  import(pathToFileURL(assetRequire.resolve(name)).href);
const [{ NodeIO }, { ALL_EXTENSIONS }, meshoptimizer] = await Promise.all([
  importAssetDependency("@gltf-transform/core"),
  importAssetDependency("@gltf-transform/extensions"),
  importAssetDependency("meshoptimizer"),
]);
const { MeshoptDecoder, MeshoptEncoder } = meshoptimizer;
await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready]);
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ "meshopt.decoder": MeshoptDecoder, "meshopt.encoder": MeshoptEncoder });

const manifest = JSON.parse(await readFile(resolve(ROOT, "public/assets.manifest.json"), "utf8"));
const logicalPath = `fab/${ANIMAL_LISTING}/ue/Models/SK_Fox.glb`;
const servedPath = resolve(ROOT, "public", manifest.entries[logicalPath].output);

const document = await io.read(servedPath);
const docRoot = document.getRoot();
const buffer = docRoot.listBuffers()[0] ?? document.createBuffer();
for (const accessor of docRoot.listAccessors()) {
  if (accessor.getBuffer() === null) accessor.setBuffer(buffer);
}
for (const mesh of docRoot.listMeshes()) {
  for (const primitive of mesh.listPrimitives()) primitive.setMaterial(null);
}
for (const material of docRoot.listMaterials()) material.dispose();
for (const texture of docRoot.listTextures()) texture.dispose();
const binary = await io.writeBinary(document);
const arrayBuffer = binary.buffer.slice(binary.byteOffset, binary.byteOffset + binary.byteLength);
const loader = new GLTFLoader().setMeshoptDecoder(ThreeMeshoptDecoder);
const gltf = await loader.parseAsync(arrayBuffer, "");

const walk = gltf.animations.find((clip) => clip.name.endsWith("ANIM_Fox_Walk") || clip.name === "ANIM_Fox_Walk");
console.log("clip:", walk.name, "tracks:", walk.tracks.length);
const byProperty = new Map();
for (const track of walk.tracks) {
  const dot = track.name.lastIndexOf(".");
  const property = track.name.slice(dot + 1);
  byProperty.set(property, (byProperty.get(property) ?? 0) + 1);
  if (property !== "quaternion") console.log("  non-quat track:", track.name);
}
console.log("  track properties:", JSON.stringify([...byProperty.entries()]));
const nodeNames = new Set(walk.tracks.map((t) => t.name.slice(0, t.name.lastIndexOf("."))));
console.log("  driven nodes:", [...nodeNames].join(", "));

// Ancestor chain of the head, bind vs walk, world + local deltas.
const heads = [];
gltf.scene.traverse((o) => o.name.endsWith("-Head") && heads.push(o));
const chain = [];
for (let o = heads[0]; o !== null; o = o.parent) chain.unshift(o);
console.log("chain:", chain.map((o) => `${o.name}(${o.type})`).join(" -> "));

const bindWorld = new Map();
const bindLocal = new Map();
for (const o of chain) {
  bindWorld.set(o, o.getWorldQuaternion(new Quaternion()));
  bindLocal.set(o, o.quaternion.clone());
}
const mixer = new AnimationMixer(gltf.scene);
mixer.clipAction(walk).play();
mixer.setTime(walk.duration / 2);
gltf.scene.updateMatrixWorld(true);
const world = new Quaternion();
for (const o of chain) {
  o.getWorldQuaternion(world);
  const wd = angleBetween(bindWorld.get(o), world);
  const ld = angleBetween(bindLocal.get(o), o.quaternion);
  console.log(
    `  ${o.name.padEnd(14)} type=${o.type.padEnd(9)} worldDelta=${wd.toFixed(1).padStart(6)}° localDelta=${ld.toFixed(1).padStart(6)}°`,
  );
}

function angleBetween(a, b) {
  const d = a.clone().invert().premultiply(b);
  return 2 * Math.acos(Math.min(1, Math.abs(d.w))) * (180 / Math.PI);
}
