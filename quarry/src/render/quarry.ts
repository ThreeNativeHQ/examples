import {
  Box3, BoxGeometry, Color, DirectionalLight, Fog, Group, HemisphereLight,
  Mesh, MeshStandardMaterial, PCFSoftShadowMap, type Object3D, type Scene, Vector3,
} from "three";

export const PROPS = [
  { name: "SM_rock01_lod000", x: -4.5, z: 6, width: 4.8, yaw: 0.25 },
  { name: "SM_rock02_lod000", x: 4.7, z: 6, width: 5.4, yaw: -0.4 },
  { name: "SM_rock03_lod000", x: -4.6, z: 0, width: 5.3, yaw: 0.7 },
  { name: "SM_cliffrock01_lod00", x: 6.2, z: 0, width: 8.0, yaw: -0.6 },
  { name: "SM_cliff01", x: -6.2, z: -7, width: 9.0, yaw: 0.25 },
  { name: "SM_cliff02", x: 5.8, z: -8, width: 10.0, yaw: -0.2 },
] as const;

/** The game chooses framing and scale; imported materials and their texture pixels stay intact. */
export function placeProp(model: Object3D, spec: (typeof PROPS)[number]): Object3D {
  const root = new Group();
  root.name = spec.name;
  root.add(model);
  model.updateMatrixWorld(true);
  const initial = new Box3().setFromObject(model);
  const size = initial.getSize(new Vector3());
  model.scale.multiplyScalar(spec.width / Math.max(size.x, size.z));
  model.updateMatrixWorld(true);
  const bounds = new Box3().setFromObject(model);
  const center = bounds.getCenter(new Vector3());
  model.position.add(new Vector3(-center.x, -bounds.min.y, -center.z));
  root.rotation.y = spec.yaw;
  root.position.set(spec.x, -0.08, spec.z);
  root.traverse((object) => {
    if (object instanceof Mesh) {
      object.castShadow = true;
      object.receiveShadow = true;
    }
  });
  root.updateMatrixWorld(true);
  return root;
}

export function buildQuarry(scene: Scene, renderer: { shadowMap: { enabled: boolean; type: number } }): Group {
  scene.background = new Color(0xc1ced0);
  scene.fog = new Fog(0xc1ced0, 55, 130);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFSoftShadowMap;
  scene.add(new HemisphereLight(0xd4e8ff, 0x897857, 2.1));
  const sun = new DirectionalLight(0xffecd0, 3.1);
  sun.position.set(-16, 22, 12);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -24, right: 24, top: 24, bottom: -24, near: 1, far: 80 });
  sun.shadow.normalBias = 0.035;
  scene.add(sun);
  const ground = new Group();
  const floor = new Mesh(new BoxGeometry(90, 0.5, 90), new MeshStandardMaterial({ color: 0xaaa28d, roughness: 0.98 }));
  floor.position.y = -0.25;
  floor.receiveShadow = true;
  ground.add(floor);
  // Cut stone slabs mark a human route between the much older rock faces.
  const slabMaterial = new MeshStandardMaterial({ color: 0xc9c0a8, roughness: 0.95 });
  for (let i = 0; i < 13; i += 1) {
    const slab = new Mesh(new BoxGeometry(2.1, 0.025, 1.65), slabMaterial);
    slab.position.set((i % 2) * 0.12 - 0.06, 0.01, 13 - i * 2.15);
    slab.receiveShadow = true;
    ground.add(slab);
  }
  return ground;
}
