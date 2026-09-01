/**
 * The animals harness: a flat lit ground, the full roster, and their real animations.
 *
 * This is a dev entry (`/dev-animals.html`), not the game — it exists so a screenshot can
 * prove the animals render, animate, and bind their clips, without booting the valley. The
 * GLB paths are the same ones the valley loads; the loader here is a plain GLTFLoader with
 * the meshopt decoder wired, standing in for `ctx.assets.model`.
 */
import type { AnimalState } from "../entities/animals/Animal.js";
import { spawnWildwoodAnimals } from "../entities/animals/spawnWildwoodAnimals.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import {
  Color,
  DirectionalLight,
  Fog,
  HemisphereLight,
  Mesh,
  MeshStandardMaterial,
  PCFSoftShadowMap,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  SphereGeometry,
  Vector3,
} from "three";
import { WebGPURenderer } from "three/webgpu";

const params = new URLSearchParams(location.search);
const STATE_NAMES: readonly AnimalState[] = ["idle", "graze", "wander", "flee"];
/** Force every animal into one state and keep re-asserting it every few seconds. */
const forcedState: AnimalState | null = STATE_NAMES.includes(params.get("state") as AnimalState)
  ? (params.get("state") as AnimalState)
  : null;
/** Radius a circling threat walks at; 0 disables the threat entirely. */
const threatRadius = Number(params.get("threat") ?? 14);
/** A static threat pinned at "x,z" — the flee lane's way of promising a bolt on frame one. */
const staticThreat = params.get("threatAt");

const hud = document.getElementById("hud") ?? document.body;
const renderer = new WebGPURenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

const scene = new Scene();
scene.background = new Color(0xc7dcea);
scene.fog = new Fog(0xc7dcea, 26, 62);

const camera = new PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 200);
camera.position.set(0, 2.4, 11);
camera.lookAt(0, 0.8, 0);

const sun = new DirectionalLight(0xfff1d6, 2.6);
sun.position.set(9, 13, 7);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -16;
sun.shadow.camera.right = 16;
sun.shadow.camera.top = 16;
sun.shadow.camera.bottom = -16;
scene.add(sun);
scene.add(new HemisphereLight(0xbcd8ff, 0x4c6236, 1.1));

const ground = new Mesh(new PlaneGeometry(90, 90), new MeshStandardMaterial({ color: 0x6d8b53, roughness: 1 }));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

// A red marker where the threat is, so a still frame can prove the flee heading runs AWAY
// from it rather than toward it.
const threatMarker = new Mesh(
  new SphereGeometry(0.25, 16, 12),
  new MeshStandardMaterial({ color: 0xd23c2a, roughness: 0.6 }),
);
threatMarker.visible = threatRadius > 0;
scene.add(threatMarker);

const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);

await renderer.init();
const animals = await spawnWildwoodAnimals({
  // The harness stands in for ctx.assets.model: same GLB names, raw loader instead of the
  // engine's manifest-resolved path.
  load: async (path) => {
    const gltf = await loader.loadAsync(`/assets/fab/2dd7964c-a601-4264-a53d-465dcae1644c/${path}`);
    return { scene: gltf.scene, animations: gltf.animations };
  },
  ground: () => 0,
  parent: scene,
  log: (line) => console.log(line),
});
for (const animal of animals.animals) {
  animal.object.traverse((object) => {
    if ((object as Mesh).isMesh === true) object.castShadow = true;
  });
}
console.log("TN_ANIMALS_READY");

let clock = 0;
let forcedSlot = -1;

renderer.setAnimationLoop(() => {
  clock += 1 / 60;

  // A slow ghost circles the pen; anything inside its bolt radius reacts as it would to you.
  // threatAt pins it so the flee lane can shoot a guaranteed simultaneous bolt.
  const threat = (() => {
    if (staticThreat !== null) {
      const [x, z] = staticThreat.split(",").map(Number);
      return new Vector3(x, 0, z);
    }
    if (threatRadius > 0) {
      return new Vector3(Math.sin(clock * 0.45) * threatRadius, 0, Math.cos(clock * 0.45) * threatRadius);
    }
    return null;
  })();
  threatMarker.visible = threat !== null;
  threatMarker.position.set(threat?.x ?? 0, 0.25, threat?.z ?? 0);

  if (forcedState !== null && forcedState !== "flee") {
    const slot = Math.floor(clock / 6);
    if (slot !== forcedSlot) {
      forcedSlot = slot;
      for (const animal of animals.animals) animal.forceState(forcedState, 7);
    }
  }
  animals.update(1 / 60, threat);

  camera.position.x = Math.sin(clock * 0.12) * 1.6;
  camera.lookAt(0, 0.8, 0);

  if (Math.floor(clock * 5) !== Math.floor((clock - 1 / 60) * 5)) {
    hud.textContent =
      `wildwood animals — ${forcedState ?? "ai"}\n` +
      animals.animals
        .map((a) => `${a.spec.label.padEnd(6)} ${a.state.padEnd(7)} ${a.clip ?? "?"} roam ${a.roamed.toFixed(1)}m`)
        .join("\n");
  }

  void renderer.renderAsync(scene, camera);
});

addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
