import {
  BoxGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  RingGeometry,
  type Scene,
} from "three";
import { mix, sin, uv, vec3 } from "three/tsl";
import { MeshBasicNodeMaterial } from "three/webgpu";

function surface(color: number): MeshBasicNodeMaterial {
  return new MeshBasicNodeMaterial({ color, toneMapped: false });
}

export function createCurtainMaterial(): MeshBasicNodeMaterial {
  const material = new MeshBasicNodeMaterial({ side: DoubleSide, toneMapped: false });
  const weave = sin(uv().x.mul(50)).mul(sin(uv().y.mul(38))).mul(0.5).add(0.5);
  material.colorNode = mix(vec3(0.05, 0.55, 0.75), vec3(1, 0.35, 0.12), weave);
  return material;
}

export function createStage(scene: Scene): Group {
  scene.background = new Color(0x06111f);
  const stage = new Group();
  const floor = new Mesh(new BoxGeometry(6.4, 0.14, 3.6), surface(0x102e42));
  floor.position.set(-1, -1.65, -0.2);
  stage.add(floor);
  for (const x of [-3.05, 1.05]) {
    const post = new Mesh(new CylinderGeometry(0.06, 0.08, 3.3, 16), surface(0xc7e7ef));
    post.position.set(x, 0, 0);
    stage.add(post);
  }
  const target = new Mesh(new RingGeometry(0.3, 0.4, 32), surface(0x63f5c8));
  target.position.set(0.75, -1.25, 0.36);
  target.rotation.x = -Math.PI / 2;
  stage.add(target);
  scene.add(stage);
  return stage;
}

export function createBarrier(): Mesh<BoxGeometry, MeshBasicNodeMaterial> {
  const material = surface(0x315c72);
  material.wireframe = true;
  const barrier = new Mesh(new BoxGeometry(4.8, 3.4, 0.2), material);
  barrier.position.set(-1, 0, 0.45);
  return barrier;
}
