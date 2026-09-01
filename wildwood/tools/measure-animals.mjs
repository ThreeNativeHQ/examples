import { readFileSync } from "node:fs";
import { NodeIO } from "@gltf-transform/core";
import { FROM_meshopt } from "@gltf-transform/extensions";
const io = new NodeIO().registerExtensions(await (async () => {
  const { MeshoptSqueezer } = await import("@gltf-transform/extensions").catch(() => ({}));
  return [];
})());
// meshopt-decoder via three's meshopt module instead:
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
io.registerDependencies({ "meshopt.decoder": MeshoptDecoder });
const dir = "assets/fab/2dd7964c-a601-4264-a53d-465dcae1644c/raw";
for (const name of ["fox", "wolf", "husky", "stag", "doe"]) {
  const doc = await io.read(`${dir}/${name}.glb`);
  const scene = doc.getRoot().getDefaultScene();
  const world = scene.listWorldTransfoms ? null : null;
  // collect world-space positions via node transforms
  const mins = [Infinity, Infinity, Infinity], maxs = [-Infinity, -Infinity, -Infinity];
  const samples = [[], [], []];
  scene.traverse((node) => {
    const mesh = node.getMesh();
    if (!mesh) return;
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute("POSITION");
      const m = node.getWorldMatrix();
      for (let i = 0; i < pos.getCount(); i++) {
        const v = pos.getElement(i, [0, 0, 0]);
        const x = m[0]*v[0]+m[4]*v[1]+m[8]*v[2]+m[12];
        const y = m[1]*v[0]+m[5]*v[1]+m[9]*v[2]+m[13];
        const z = m[2]*v[0]+m[6]*v[1]+m[10]*v[2]+m[14];
        samples[0].push(x); samples[1].push(y); samples[2].push(z);
        for (let a=0;a<3;a++){ mins[a]=Math.min(mins[a],[x,y,z][a]); maxs[a]=Math.max(maxs[a],[x,y,z][a]); }
      }
    }
  });
  const pct = (arr, p) => { const s=[...arr].sort((a,b)=>a-b); return s[Math.floor(s.length*p)]; };
  const spans = [0,1,2].map(a => pct(samples[a],0.99) - pct(samples[a],0.01));
  const raw = [0,1,2].map(a => maxs[a]-mins[a]);
  console.log(name.padEnd(6), "pct-span", spans.map(v=>v.toFixed(1)).join(" x "), "| raw", raw.map(v=>v.toFixed(1)).join(" x "));
}
