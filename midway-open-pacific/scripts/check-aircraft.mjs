// CPU check: real GLB geometry and tracks; texture decoding is covered by the browser playtest.
import assert from "node:assert/strict";
import { readFile, mkdtemp, writeFile, rm, mkdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { build } from "esbuild";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { Box3, Raycaster, Vector3, Texture } from "three";

const bytes = await readFile(
  new URL("../public/assets/aircraft.douglas-sbd3.glb", import.meta.url),
);
const length = bytes.readUInt32LE(12);
const gltf = JSON.parse(bytes.subarray(20, 20 + length));
assert.equal(gltf.animations.length, 12);
assert.equal(gltf.images.length, 61);
for (const mesh of gltf.meshes)
  for (const primitive of mesh.primitives) {
    for (const index of Object.values(primitive.attributes)) {
      const accessor = gltf.accessors[index];
      const view = gltf.bufferViews[accessor.bufferView];
      const components = { VEC2: 2, VEC3: 3, VEC4: 4 }[accessor.type];
      const componentBytes = { 5126: 4, 5123: 2, 5121: 1 }[accessor.componentType];
      assert.ok(
        !view.byteStride || view.byteStride === components * componentBytes,
        "attributes must not interleave",
      );
    }
  }
for (const material of gltf.materials) {
  delete material.normalTexture;
  delete material.occlusionTexture;
  delete material.emissiveTexture;
  delete material.pbrMetallicRoughness.baseColorTexture;
  delete material.pbrMetallicRoughness.metallicRoughnessTexture;
}
delete gltf.textures;
delete gltf.images;
gltf.buffers[0].uri =
  "data:application/octet-stream;base64," + bytes.subarray(28 + length).toString("base64");
globalThis.ProgressEvent = class {};
const loaded = await new GLTFLoader().parseAsync(JSON.stringify(gltf), "");
await mkdir("node_modules/.cache", { recursive: true });
const temporary = await mkdtemp(resolve("node_modules/.cache/aircraft-check-"));
try {
  const output = await build({
    entryPoints: ["src/render/imported-aircraft.ts"],
    bundle: true,
    packages: "external",
    platform: "node",
    format: "esm",
    write: false,
  });
  const modulePath = resolve(temporary, "aircraft.mjs");
  await writeFile(modulePath, output.outputFiles[0].text);
  const { loadImportedAircraft, createDouglas, animateDouglas, disposeDouglas } = await import(
    pathToFileURL(modulePath).href
  );
  const testTexture = new Texture();
  const sourceMesh = loaded.scene.getObjectByName("defaultMaterial_node_18");
  sourceMesh.material.map = testTexture;
  await loadImportedAircraft({
    assets: { model: async () => loaded },
    renderer: { raw: { getMaxAnisotropy: () => 8 } },
  });
  assert.equal(
    testTexture.anisotropy,
    8,
    "aircraft textures use the running adapter's supported anisotropy",
  );
  const pixels = new Uint8ClampedArray(1024 * 512 * 4);
  const context = new Proxy(
    { getImageData: () => ({ data: pixels }) },
    { get: (target, key) => target[key] ?? (() => {}) },
  );
  globalThis.document = {
    createElement: () => ({ width: 0, height: 0, getContext: () => context }),
  };
  const airplane = createDouglas(true);
  const parked = createDouglas();
  const { gearClearance } = await import("@threenative/core");
  airplane.rotation.set(0.22, 0, 0, "YXZ");
  airplane.position.set(0, 20.06 + gearClearance({ pitch: 0.22 }), 15);
  airplane.updateMatrixWorld(true);
  const contacts = [];
  airplane.children[1].traverse((node) => {
    if (
      !node.isMesh ||
      node.geometry.type !== "CylinderGeometry" ||
      ![0.35, 0.17].includes(node.geometry.parameters.radiusTop)
    )
      return;
    const positions = node.geometry.getAttribute("position");
    let bottom = Infinity;
    for (let i = 0; i < positions.count; i++)
      bottom = Math.min(
        bottom,
        new Vector3().fromBufferAttribute(positions, i).applyMatrix4(node.matrixWorld).y,
      );
    contacts.push(bottom - 20.06);
  });
  assert.equal(contacts.length, 3, "measure both main wheels and the fixed tailwheel");
  assert.ok(
    contacts.every((gap) => Math.abs(gap) <= 0.05),
    `wheel/deck gaps must stay within 5cm: ${contacts}`,
  );
  console.log("Measured wheel/deck gaps (metres):", contacts);
  airplane.position.set(0, 0, 0);
  airplane.rotation.set(0, 0, 0);
  airplane.updateMatrixWorld(true);
  const panelRoot = airplane.getObjectByName("Douglas live cockpit instruments");
  assert.ok(panelRoot.children.length > 0, "player receives the existing live cockpit panel");
  assert.equal(
    parked.getObjectByName(panelRoot.name).children.length,
    0,
    "parked planes need no canvas panel",
  );
  const panel = panelRoot.children.find((node) => node.isMesh && node.material.map?.isDataTexture);
  assert.ok(panel, "cockpit panel uploads pixel data for WebGPU");
  airplane.updateMatrixWorld(true);
  const panelPosition = panel.getWorldPosition(new Vector3());
  const eye = airplane.userData.cockpit;
  const panelSightline = new Raycaster(
    eye,
    panelPosition.clone().sub(eye).normalize(),
    0.045,
    eye.distanceTo(panelPosition) + 0.01,
  )
    .intersectObject(airplane, true)
    .filter((hit) => !hit.object.material.transparent);
  assert.equal(
    panelSightline[0]?.object,
    panel,
    "instrument panel must be visible ahead of the pilot",
  );
  assert.ok(Math.abs(new Box3().setFromObject(airplane).getSize(new Vector3()).x - 12.66) < 0.001);
  const glass = airplane.getObjectByName("defaultMaterial_node_7");
  const frames = airplane.getObjectByName("defaultMaterial_node_8");
  assert.ok(
    glass.material.transparent && glass.material.opacity <= 0.15,
    "canopy panes must transmit the cockpit view",
  );
  assert.equal(glass.material.depthWrite, false);
  assert.equal(glass.castShadow, false);
  assert.equal(frames.material.transparent, false, "canopy frames remain opaque");
  assert.equal(frames.visible, true);
  airplane.updateMatrixWorld(true);
  const sightline = new Raycaster(
    airplane.userData.cockpit,
    new Vector3(0, 0, -1),
    0.045,
    10,
  ).intersectObject(airplane, true);
  assert.ok(sightline.length > 0, "check the canopy from inside its actual cockpit mount");
  assert.ok(
    sightline.every((hit) => hit.object.material.transparent),
    "no opaque mesh blocks the forward cockpit sightline",
  );
  const propeller = airplane.getObjectByName("Circle008_Circle031ThreeNativePivot");
  const elevator = airplane.getObjectByName("defaultMaterial_node_1ThreeNativePivot");
  const aileron = airplane.getObjectByName("aileronpositive-xThreeNativePivot");
  const rudder = airplane.getObjectByName("Circle004_Circle026ThreeNativePivot");
  const flap = airplane.getObjectByName("Plane003_Plane004ThreeNativePivot");
  const neutral = [propeller, elevator, aileron, rudder, flap].map((node) =>
    node.quaternion.clone(),
  );
  animateDouglas(
    airplane,
    { rpm: 0.73, elevator: 0.8, aileron: 0.6, rudder: 0.5, flapPos: 1 },
    0.017,
  );
  assert.equal(
    airplane.getObjectByName("defaultMaterial_node_15").visible,
    false,
    "running blades cannot strobe across the cockpit view",
  );
  assert.equal(airplane.getObjectByName("defaultMaterial_node_16").visible, false);
  assert.equal(airplane.getObjectByName("Propeller motion blur").visible, true);
  for (const [i, node] of [propeller, elevator, aileron, rudder, flap].entries())
    assert.ok(node.quaternion.angleTo(neutral[i]) > 0.05, `${node.name} must move`);
  assert.ok(
    parked.getObjectByName(elevator.name).quaternion.angleTo(neutral[1]) < 0.00001,
    "instances animate independently",
  );
  animateDouglas(airplane, { rpm: 0 }, 0);
  for (const [i, node] of [propeller, elevator, aileron, rudder, flap].entries())
    if (i > 0)
      assert.ok(
        node.quaternion.angleTo(neutral[i]) < 0.00001,
        `${node.name} must return to neutral`,
      );
  assert.equal(
    airplane.getObjectByName("defaultMaterial_node_15").visible,
    true,
    "stopped blades remain visible",
  );
  assert.equal(airplane.getObjectByName("Propeller motion blur").visible, false);
  const stopped = propeller.quaternion.clone();
  animateDouglas(airplane, { rpm: 0 }, 0.1);
  assert.ok(propeller.quaternion.angleTo(stopped) < 0.00001);
  disposeDouglas(airplane);
  disposeDouglas(parked);
  console.log(
    "Aircraft check passed: 12 clips, 12.66m span, independent controls and clones, neutral release, throttle stop, separate vertex layout.",
  );
} finally {
  await rm(temporary, { recursive: true, force: true });
}
