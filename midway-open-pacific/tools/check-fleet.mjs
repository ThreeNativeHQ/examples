/**
 * Fleet asset gate: parses the shipped GLBs without a browser and asserts the
 * facts the game's render code depends on (crew rig/clips, aircraft pivot and
 * orientation, hull axis and length, atoll scale). Exits non-zero on mismatch.
 */
import assert from "node:assert/strict";
import { Box3, Quaternion, Vector3 } from "three";
import { checkHumanoid, loadGlb } from "./check-humanoid.mjs";

const asset = (name) => new URL(`../public/assets/${name}`, import.meta.url);

const sizeOf = (object) => new Box3().setFromObject(object).getSize(new Vector3());

{
  const gltf = await loadGlb(process.argv[2] ?? asset("deck-crew.glb"));
  checkHumanoid(gltf, {
    clips: ["crew.chock", "crew.idle", "crew.service", "crew.signal", "crew.wait", "crew.walk"],
    height: 1.83,
    minimumHandVertices: 50,
    minimumFingerVertices: 10,
  });
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
