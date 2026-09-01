// Parse a GLB's JSON chunk and report node transforms, skins, and POSITION accessor ranges.
import { readFileSync } from "node:fs";

const path = process.argv[2];
const buf = readFileSync(path);
if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error("not GLB");
let off = 12;
let json = null;
let bin = null;
while (off < buf.length) {
  const len = buf.readUInt32LE(off);
  const type = buf.readUInt32LE(off + 4);
  if (type === 0x4e4f534a) json = JSON.parse(buf.subarray(off + 8, off + 8 + len).toString("utf8"));
  if (type === 0x004e4942) bin = buf.subarray(off + 8, off + 8 + len);
  off += 8 + len;
}
console.log(`== ${path}`);
console.log("extensionsUsed:", json.extensionsUsed ?? []);

const nodes = json.nodes ?? [];
for (const [i, n] of nodes.entries()) {
  const has = n.scale || n.translation || n.rotation || n.matrix;
  if (!has) continue;
  const parts = [];
  if (n.translation) parts.push(`t=[${n.translation.map((v) => +v.toFixed(3))}]`);
  if (n.rotation) parts.push(`r=[${n.rotation.map((v) => +v.toFixed(3))}]`);
  if (n.scale) parts.push(`s=[${n.scale}]`);
  if (n.matrix) parts.push(`matrix=[${n.matrix.map((v) => +v.toFixed(3))}]`);
  console.log(`node#${i} ${n.name ?? ""} ${parts.join(" ")} children=${(n.children ?? []).length}${n.mesh !== undefined ? ` mesh=${n.mesh}` : ""}${n.skin !== undefined ? ` skin=${n.skin}` : ""}`);
}

const accessors = json.accessors ?? [];
for (const [i, m] of (json.meshes ?? []).entries()) {
  for (const [p, prim] of m.primitives.entries()) {
    const posAcc = accessors[prim.attributes.POSITION];
    console.log(`mesh#${i} ${m.name ?? ""} prim#${p} ${Object.keys(prim.attributes)} POSITION min=[${posAcc.min}] max=[${posAcc.max}] count=${posAcc.count}`);
  }
}
for (const [i, s] of (json.skins ?? []).entries()) {
  console.log(`skin#${i} ${s.name ?? ""} joints=${s.joints.length} skeleton=${s.skeleton}`);
}
