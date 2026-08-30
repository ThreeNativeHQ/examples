import { Box3, Group, Mesh, MeshStandardMaterial } from "three";
import { addFishingBoat, addVan, vanFootprint } from "./src/render/vehicles.js";
import type { TownMaterials } from "./src/render/townMaterials.js";

const stub = new Proxy({}, {
  get: () => new MeshStandardMaterial({ color: 0x888888 }),
}) as unknown as TownMaterials;

const report = (label: string, g: Group) => {
  let tris = 0;
  let calls = 0;
  g.traverse((o) => {
    if (!(o instanceof Mesh)) return;
    calls += 1;
    const index = o.geometry.getIndex();
    const count = index !== null ? index.count : o.geometry.getAttribute("position").count;
    tris += count / 3;
  });
  const box = new Box3().setFromObject(g);
  console.log(`${label}: ${calls} meshes, ${tris} tris`);
  console.log(`  min ${box.min.toArray().map((n) => n.toFixed(2)).join(", ")}`);
  console.log(`  max ${box.max.toArray().map((n) => n.toFixed(2)).join(", ")}`);
  console.log(`  size ${box.getSize(box.max.clone()).toArray().map((n) => n.toFixed(2)).join(", ")}`);
};

const world = new Group();
const hittable: Mesh[] = [];
const vanAt = { x: -10.25, z: 18.4, yaw: -Math.PI / 2 + 0.05 };
const collider = addVan(world, hittable, stub, vanAt);
report("van(world)", world.children[0] as Group);
console.log("van collider", JSON.stringify(collider));
console.log("van footprint(incl mirrors)", JSON.stringify(vanFootprint(vanAt)));

const sea = new Group();
addFishingBoat(sea, stub, { x: 51.5, z: -9.45, yaw: 0.1, waterY: -1.1, moorTo: [53.5, 0.05, -7.9] });
report("boat(world)", sea.children[0] as Group);
const seaBox = new Box3().setFromObject(sea.children[0] as Group);
console.log("boat world box", seaBox.min.toArray().map(n=>n.toFixed(2)), seaBox.max.toArray().map(n=>n.toFixed(2)));
