// Writes assets/face.glb: one body far denser than a 1080p screen can resolve.
//
// Nothing here knows about virtual geometry. That is the point of this sandbox — the mesh is
// authored the way any game authors one, and the cluster DAG is the pipeline's business.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Document, NodeIO } from "@gltf-transform/core";
import { TorusKnotGeometry } from "three";

// 1024 x 256 x 2 = 524,288 triangles. A torus knot rather than a sphere: three leaves a sphere
// two pole vertices no triangle references, and an unreferenced vertex trips the pipeline's own
// self-verify on a drift that has nothing to do with density.
const geometry = new TorusKnotGeometry(1, 0.4, 1024, 256);
const triangles = (geometry.index?.count ?? 0) / 3;

const document = new Document();
const buffer = document.createBuffer();
const position = document
  .createAccessor("face-position")
  .setType("VEC3")
  .setArray(Float32Array.from(geometry.attributes.position.array))
  .setBuffer(buffer);
const normal = document
  .createAccessor("face-normal")
  .setType("VEC3")
  .setArray(Float32Array.from(geometry.attributes.normal.array))
  .setBuffer(buffer);
const index = document
  .createAccessor("face-index")
  .setType("SCALAR")
  .setArray(Uint32Array.from(geometry.index.array))
  .setBuffer(buffer);
const primitive = document
  .createPrimitive()
  .setAttribute("POSITION", position)
  .setAttribute("NORMAL", normal)
  .setIndices(index)
  .setMaterial(document.createMaterial("rock"));
document
  .createScene("face")
  .addChild(document.createNode("face").setMesh(document.createMesh("face").addPrimitive(primitive)));

const out = resolve(dirname(fileURLToPath(import.meta.url)), "../assets");
mkdirSync(out, { recursive: true });
const bytes = Buffer.from(await new NodeIO().writeBinary(document));
writeFileSync(resolve(out, "face.glb"), bytes);
console.log(
  `assets/face.glb  ${triangles.toLocaleString("en-US")} triangles  ${(bytes.length / 1e6).toFixed(1)} MB`,
);
