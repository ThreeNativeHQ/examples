import { Box3, Raycaster, Vector3 } from "three";
import { createCathedral } from "./src/render/cathedral.js";

const nave = createCathedral();
nave.updateMatrixWorld(true);
const piers = nave.children[5];
const labels = new Map<object, string>();
const order = ["floor","bay-walls","glass-warm","glass-cool","glass-aisle","piers","aisle-walls",
  "aisle-vault-L","aisle-vault-R","vault-webs","bay-ribs","transverse-ribs","bosses",
  "chancel-arch","apse-back","cant-L","cant-R","rose-glass","rose-tracery","rose-surround",
  "east-lancet-glass","lancet-frames","canopy","canopy-gable","chancel-floor","altar","screen","west-wall"];
nave.children.forEach((c, i) => labels.set(c, order[i] ?? `child-${i}`));

// What does one pier's geometry actually span, and how much of it is above the triforium?
const pierGeom = (piers as unknown as { geometry: { getAttribute(n: string): { count: number; getX(i: number): number; getY(i: number): number; getZ(i: number): number } } }).geometry;
const pos = pierGeom.getAttribute("position");
const box = new Box3();
let aboveCount = 0;
let zMinHigh = Infinity;
let zMaxHigh = -Infinity;
let xMinHigh = Infinity;
for (let i = 0; i < pos.count; i += 1) {
  const y = pos.getY(i);
  box.expandByPoint(new Vector3(pos.getX(i), y, pos.getZ(i)));
  if (y > 20) {
    aboveCount += 1;
    zMinHigh = Math.min(zMinHigh, pos.getZ(i));
    zMaxHigh = Math.max(zMaxHigh, pos.getZ(i));
    xMinHigh = Math.min(xMinHigh, pos.getX(i));
  }
}
console.log(`pier local bbox  x ${box.min.x.toFixed(2)}..${box.max.x.toFixed(2)}  y ${box.min.y.toFixed(2)}..${box.max.y.toFixed(2)}  z ${box.min.z.toFixed(2)}..${box.max.z.toFixed(2)}`);
console.log(`vertices above y=20: ${aboveCount}  their z span ${zMinHigh.toFixed(2)}..${zMaxHigh.toFixed(2)} (width ${(zMaxHigh - zMinHigh).toFixed(2)} m)  max local x ${box.max.x.toFixed(2)}`);
console.log(`  -> world |x| of the frontmost point above 20 m: ${(8.3 - box.max.x).toFixed(2)}`);

const CAMERA = new Vector3(2.6, 2.6, 22);
for (const [side, bay, light] of [[-1, 4, -1.5], [-1, 2, 1.5], [1, 4, -1.5], [-1, 6, -1.5]] as const) {
  const bayZ = -31.5 + bay * 7 + 3.5;
  const target = new Vector3(side * 10.08, 23, bayZ + light);
  const to = target.clone().sub(CAMERA);
  const reach = to.length();
  const hits = new Raycaster(CAMERA, to.clone().normalize(), 0.01, reach + 1).intersectObject(nave, true);
  console.log(`\nray -> side ${side > 0 ? "R" : "L"} bay ${bay} light ${light} (target z ${(bayZ + light).toFixed(1)}), reach ${reach.toFixed(1)}`);
  for (const h of hits.slice(0, 3)) {
    console.log(`   ${h.distance.toFixed(2).padStart(6)} m  ${(labels.get(h.object) ?? "?").padEnd(12)} at (${h.point.x.toFixed(2)}, ${h.point.y.toFixed(2)}, ${h.point.z.toFixed(2)})`);
  }
}
