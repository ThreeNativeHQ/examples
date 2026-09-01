import { NodeIO } from "@gltf-transform/core";

const path = process.argv[2];
const io = new NodeIO();
const doc = await io.read(path);
const root = doc.getRoot();

console.log(`== ${path}`);
for (const scene of root.listScenes()) {
  console.log("scene nodes:", scene.listNodes().map((n) => n.getName()));
}
console.log("-- nodes with non-identity transform:");
for (const node of root.listNodes()) {
  const t = node.getTranslation(), r = node.getRotation(), s = node.getScale();
  const dirty =
    t.some((v) => Math.abs(v) > 1e-6) ||
    r.some((v) => Math.abs(v) > 1e-6) ||
    s.some((v) => Math.abs(v - 1) > 1e-6);
  if (dirty)
    console.log(
      `  ${node.getName()}: t=[${t.map((v) => v.toFixed(3))}] r=[${r.map((v) => v.toFixed(3))}] s=[${s.map((v) => v.toFixed(4))}]`,
    );
}
console.log("-- skins:");
for (const skin of root.listSkins()) {
  const joints = skin.listJoints();
  console.log(`  ${skin.getName()}: ${joints.length} joints, skeleton=${skin.getSkeleton()?.getName()}`);
  const ibm = skin.getInverseBindMatrices()?.getArray();
  if (ibm) {
    let min = Infinity, max = -Infinity;
    for (const v of ibm) {
      if (!Number.isFinite(v)) console.log("  IBM HAS NON-FINITE VALUE");
      min = Math.min(min, v), max = Math.max(max, v);
    }
    console.log(`  IBM range ${min.toFixed(2)}..${max.toFixed(2)}`);
  }
}
console.log("-- meshes:");
for (const mesh of root.listMeshes()) {
  for (const [i, prim] of mesh.listPrimitives().entries()) {
    const pos = prim.getAttribute("POSITION");
    const joints = prim.getAttribute("JOINTS_0");
    const weights = prim.getAttribute("WEIGHTS_0");
    const mm = prim.getMaterial()?.getName();
    let min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    let zeroWeight = 0, badSum = 0, farJoints = 0;
    const jointCount = root.listSkins()[0]?.listJoints().length ?? 0;
    for (let v = 0; v < pos.getCount(); v++) {
      for (let a = 0; a < 3; a++) {
        const val = pos.getComponent(v, a);
        min[a] = Math.min(min[a], val);
        max[a] = Math.max(max[a], val);
      }
      if (weights) {
        let sum = 0;
        for (let c = 0; c < 4; c++) {
          sum += weights.getComponent(v, c);
          if (joints && joints.getComponent(v, c) >= jointCount) farJoints++;
        }
        if (sum < 0.01) zeroWeight++;
        else if (Math.abs(sum - 1) > 0.02) badSum++;
      }
    }
    console.log(
      `  prim#${i} mat=${mm} verts=${pos.getCount()} bbox=[${min.map((v) => v.toFixed(2))}..${max.map((v) => v.toFixed(2))}] zeroW=${zeroWeight} badSumW=${badSum} oobJointIdx=${farJoints}`,
    );
  }
}
