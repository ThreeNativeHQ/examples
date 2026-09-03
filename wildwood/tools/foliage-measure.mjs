/**
 * Measure the world size of every imported pack GLB: `node tools/foliage-measure.mjs [glob-dir]`
 *
 * Placement in foliage.ts normalises by a species' longest side, so a species whose real metre
 * scale is only discovered at draw time normalises wrong. This reads the GLB's own node
 * transforms and POSITION accessor bounds, so the number printed is the metres the mesh occupies
 * once `extractTreeSpecies` has baked the world matrix in.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const dir = process.argv[2] ?? "assets/fab/1ac647da-b1bc-4e72-a56d-60aaeb6918e1/Models";

/** Parse the JSON chunk of a binary glTF. */
function readGlb(path) {
  const buffer = readFileSync(path);
  if (buffer.readUInt32LE(0) !== 0x46546c67) throw new Error(`${path} is not a GLB`);
  const jsonLength = buffer.readUInt32LE(12);
  return JSON.parse(buffer.subarray(20, 20 + jsonLength).toString("utf8"));
}

function nodeMatrix(node) {
  const t = node.translation ?? [0, 0, 0];
  const s = node.scale ?? [1, 1, 1];
  return { s, t };
}

for (const file of readdirSync(dir).filter((f) => f.endsWith(".glb")).sort()) {
  let json;
  try {
    json = readGlb(join(dir, file));
  } catch (error) {
    console.log(`${file}\tUNREADABLE\t${error.message}`);
    continue;
  }
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  const visit = (index, parent) => {
    const node = json.nodes[index];
    const local = nodeMatrix(node);
    const world = {
      s: local.s.map((v, i) => v * parent.s[i]),
      t: local.t.map((v, i) => v * parent.s[i] + parent.t[i]),
    };
    if (node.mesh !== undefined) {
      for (const primitive of json.meshes[node.mesh].primitives) {
        const accessor = json.accessors[primitive.attributes.POSITION];
        if (accessor?.min === undefined) continue;
        for (let axis = 0; axis < 3; axis += 1) {
          const lo = accessor.min[axis] * world.s[axis] + world.t[axis];
          const hi = accessor.max[axis] * world.s[axis] + world.t[axis];
          min[axis] = Math.min(min[axis], lo, hi);
          max[axis] = Math.max(max[axis], lo, hi);
        }
      }
    }
    for (const child of node.children ?? []) visit(child, world);
  };
  for (const root of json.scenes[json.scene ?? 0].nodes) visit(root, { s: [1, 1, 1], t: [0, 0, 0] });
  const size = max.map((v, i) => v - min[i]);
  const sections = json.meshes?.reduce((sum, mesh) => sum + mesh.primitives.length, 0) ?? 0;
  const triangles = json.meshes?.reduce(
    (sum, mesh) =>
      sum +
      mesh.primitives.reduce(
        (inner, p) => inner + (p.indices === undefined ? 0 : json.accessors[p.indices].count / 3),
        0,
      ),
    0,
  );
  console.log(
    `${file.replace(".glb", "").padEnd(26)}\tx=${size[0].toFixed(2)}\ty=${size[1].toFixed(2)}\tz=${size[2].toFixed(2)}\tbaseY=${min[1].toFixed(2)}\tsections=${String(sections)}\ttris=${String(Math.round(triangles))}`,
  );
}
