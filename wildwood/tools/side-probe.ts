/** One-off: raw world positions of side-named bones, bind vs walk pose, uncorrected. */
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { AnimationMixer, Vector3 } from "three";
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

const walk = gltf.animations.find((clip) => clip.name === "ANIM_Fox_Walk");
const bones = new Map();
gltf.scene.traverse((o) => {
  if (o.isBone === true) bones.set(o.name, o);
});
const names = ["Fox_", "Fox_-Pelvis", "Fox_-Spine", "Fox_-L-Thigh", "Fox_-R-Thigh", "Fox_-L-Foot", "Fox_-R-Foot", "Fox_-Head"];
const grab = () => {
  gltf.scene.updateWorldMatrix(true, true);
  return Object.fromEntries(names.map((n) => {
    const b = bones.get(n);
    const p = b.getWorldPosition(new Vector3());
    return [n, [p.x, p.y, p.z].map((v) => Number(v.toFixed(4)))];
  }));
};
console.log("BIND ", JSON.stringify(grab()));
const mixer = new AnimationMixer(gltf.scene);
mixer.clipAction(walk).play();
mixer.setTime(walk.duration / 2);
console.log("WALK ", JSON.stringify(grab()));
