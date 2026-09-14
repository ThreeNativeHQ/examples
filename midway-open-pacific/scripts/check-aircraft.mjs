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

/** Parse another shipped GLB the same texture-less way, for the imported-airframe animations. */
const stripGlb = async (asset) => {
  const raw = await readFile(new URL(asset, import.meta.url));
  const header = raw.readUInt32LE(12);
  const model = JSON.parse(raw.subarray(20, 20 + header));
  for (const material of model.materials) {
    delete material.normalTexture;
    delete material.occlusionTexture;
    delete material.emissiveTexture;
    if (material.pbrMetallicRoughness) {
      delete material.pbrMetallicRoughness.baseColorTexture;
      delete material.pbrMetallicRoughness.metallicRoughnessTexture;
    }
  }
  delete model.textures;
  delete model.images;
  model.buffers[0].uri =
    "data:application/octet-stream;base64," + raw.subarray(28 + header).toString("base64");
  return new GLTFLoader().parseAsync(JSON.stringify(model), "");
};
const tbdSource = await stripGlb("../public/assets/aircraft.tbd-devastator.glb");
assert.equal(tbdSource.animations.length, 9, "the TBD ships one clip per moving part");
const tbdParts = ["aileronleft", "aileronright", "elevator", "flapleft", "flapright", "gearleft", "gearright", "propeller", "rudder"];
for (const name of tbdParts) assert.ok(tbdSource.scene.getObjectByName(name), `TBD ships a separated ${name}`);
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
  const { loadImportedAircraft, createDouglas, animateDouglas, disposeDouglas, createAirframe, animateDevastator, disposeAirframe } = await import(
    pathToFileURL(modulePath).href
  );
  const testTexture = new Texture();
  const sourceMesh = loaded.scene.getObjectByName("defaultMaterial_node_18");
  sourceMesh.material.map = testTexture;
  await loadImportedAircraft({
    assets: { model: async (url) => (/tbd-devastator/.test(String(url)) ? tbdSource : loaded) },
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
  assert.ok(panelRoot.children.length > 0, "player receives the detailed live cockpit");
  assert.equal(
    parked.getObjectByName(panelRoot.name).children.length,
    0,
    "parked planes need no cockpit interior",
  );
  const interior = panelRoot.getObjectByName("Cockpit interior");
  assert.ok(interior, "detailed cockpit interior is mounted on the player");
  let interiorMeshes = 0;
  interior.traverse((node) => {
    if (node.isMesh) interiorMeshes += 1;
  });
  assert.ok(interiorMeshes > 40, `cockpit interior carries real geometry: ${interiorMeshes} meshes`);
  const rig = airplane.userData.cockpitRig;
  assert.equal(typeof rig?.update, "function", "cockpit rig is live");
  const stick = airplane.getObjectByName("Control stick");
  const lever = airplane.getObjectByName("Throttle lever 1");
  const needles = [];
  airplane.traverse((node) => {
    if (node.name === "Gauge needle") needles.push(node);
  });
  assert.ok(stick && lever && needles.length >= 8, "stick, throttle and gauges are rigged");
  const rigNeutral = { stick: stick.rotation.x, lever: lever.rotation.x };
  const needlesBefore = needles.map((needle) => needle.rotation.z);
  animateDouglas(airplane, { rpm: 0.9, elevator: 0.8, aileron: 0.6, rudder: 0.5, flapPos: 1 }, 0.05);
  const needlesAfter = needles.map((needle) => needle.rotation.z);
  assert.ok(Math.abs(stick.rotation.x - rigNeutral.stick) > 0.1, "stick follows the elevator");
  assert.ok(Math.abs(stick.rotation.z) > 0.05, "stick rolls with the ailerons");
  assert.ok(Math.abs(lever.rotation.x - rigNeutral.lever) > 0.02, "throttle lever follows power");
  assert.ok(
    needlesAfter.some((angle, i) => Math.abs(angle - needlesBefore[i]) > 0.001),
    "gauge needles move with flight state",
  );
  animateDouglas(airplane, {}, 0);
  airplane.updateMatrixWorld(true);
  const eye = airplane.userData.cockpit;
  const panelPoint = interior.localToWorld(new Vector3(0, 0.66, -0.455));
  const forward = new Raycaster(eye, panelPoint.clone().sub(eye).normalize(), 0.045, eye.distanceTo(panelPoint) + 0.02)
    .intersectObject(airplane, true)
    .filter((hit) => hit.object.visible && !hit.object.material.transparent);
  assert.ok(forward.length > 0, "the detailed panel is ahead of the pilot");
  let onInterior = false;
  for (let node = forward[0].object; node; node = node.parent) if (node === panelRoot) onInterior = true;
  assert.ok(onInterior, "the first thing ahead of the pilot is the cockpit interior");
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
    sightline.some((hit) => hit.object === glass),
    "the canopy glass is still on the forward sightline",
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
  assert.ok(propeller.quaternion.equals(stopped), "a stopped propeller does not advance");
  disposeDouglas(airplane);
  disposeDouglas(parked);

  // The player TBD: the ported standalone airframe, driven by the game's own control values, as its
  // own instance. The supplied GLB is no longer the Devastator the game draws.
  const tbd = createAirframe("tbd1", "hero", true);
  const parkedTbd = createAirframe("tbd1", "ai");
  assert.equal(tbd.name, "Douglas TBD-1 Devastator", "the player TBD is the ported airframe");
  assert.ok(tbd.userData.devastator, "the player TBD is the ported Devastator");
  const tbdSpan = new Box3().setFromObject(tbd).getSize(new Vector3()).x;
  assert.ok(Math.abs(tbdSpan - 15.24) < 0.05, `TBD span stays measured: ${tbdSpan}`);
  tbd.updateMatrixWorld(true);
  assert.ok(
    Math.abs(new Box3().setFromObject(tbd).min.y + 1.82) < 0.02,
    "the Devastator rests on the 1.82 m gear datum the flight model and the deck park both use",
  );
  const part = (name) => tbd.getObjectByName(name);
  const moved = ["aileronleft", "elevator", "flapleft", "gearleft", "rudder"].map(part);
  assert.ok(moved.every(Boolean), "every Devastator flight part is addressable");
  assert.ok(tbd.getObjectByName("airframebody"), "the fuselage is named for the asset contract");
  const tbdNeutral = moved.map((node) => node.quaternion.clone());
  const parkedNeutral = ["aileronleft", "elevator", "flapleft", "gearleft", "rudder"].map((name) =>
    parkedTbd.getObjectByName(name).quaternion.clone(),
  );
  // The model eases toward its targets, so the control values are held until it settles.
  const settle = (values, steps = 60) => {
    for (let i = 0; i < steps; i += 1) animateDevastator(tbd, values, 0.05);
  };
  settle({ rpm: 0.9, elevator: 1, controlAileron: 1, rudder: -1, flapPos: 1, gearPos: 0, torpedo: 1 });
  for (const [i, node] of moved.entries())
    assert.ok(
      node.quaternion.angleTo(tbdNeutral[i]) > 0.05,
      `${node.name} follows its control: ${node.quaternion.angleTo(tbdNeutral[i])}`,
    );
  assert.equal(part("propeller").visible, false, "the running propeller hands off to its blur");
  assert.equal(tbd.getObjectByName("Propeller motion blur").visible, true);
  assert.ok(tbd.userData.torpedoLoad, "the Devastator carries its own store");
  for (const [i, name] of ["aileronleft", "elevator", "flapleft", "gearleft", "rudder"].entries())
    assert.ok(
      parkedTbd.getObjectByName(name).quaternion.angleTo(parkedNeutral[i]) < 1e-6,
      `${name} on a second instance is untouched`,
    );
  settle({ rpm: 0, torpedo: 0, flapPos: 0, gearPos: 1 }, 120);
  for (const [i, node] of moved.entries())
    assert.ok(node.quaternion.angleTo(tbdNeutral[i]) < 0.01, `${node.name} returns to neutral`);
  assert.equal(tbd.userData.torpedoLoad.visible, false, "releasing the store hides it once");
  assert.ok(tbd.userData.arrestingHook, "the Devastator carries its hook");
  assert.ok(tbd.userData.cockpit, "the Devastator publishes the pilot eye");
  const count = (group) => {
    let triangles = 0;
    group.traverse((node) => {
      if (node.isMesh && node.geometry)
        triangles += node.geometry.index
          ? node.geometry.index.count / 3
          : node.geometry.attributes.position.count / 3;
    });
    return Math.round(triangles);
  };
  assert.ok(
    count(parkedTbd) < count(tbd) * 0.6,
    `the deck-park Devastator is the cheap build: hero ${count(tbd)} vs parked ${count(parkedTbd)}`,
  );
  disposeAirframe(tbd);
  disposeAirframe(parkedTbd);
  console.log(
    "Aircraft check passed: 12 clips, 12.66m span, independent controls and clones, neutral release, throttle stop, separate vertex layout; the ported player TBD drives its own split surfaces, store and hook with independent instance state.",
  );
} finally {
  await rm(temporary, { recursive: true, force: true });
}
