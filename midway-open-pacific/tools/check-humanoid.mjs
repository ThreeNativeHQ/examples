/** Reusable GLB skin check: every finger, animation poses, seams and both closed fists.
 * node tools/check-humanoid.mjs path/to/rigged.glb
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { AnimationMixer, Box3, Quaternion, Vector3 } from "three";

// three's FileLoader emits ProgressEvent even for a data: URI; node 20 has no such global.
globalThis.ProgressEvent ??= class ProgressEvent extends Event {
  constructor(type, init = {}) {
    super(type);
    Object.assign(this, init);
  }
};

const loader = new GLTFLoader();

export async function loadGlb(path) {
  const bytes = await readFile(path);
  const headerLength = bytes.readUInt32LE(12);
  const json = JSON.parse(bytes.subarray(20, 20 + headerLength).toString());
  // Strip textures so node can parse without an image decoder.
  for (const material of json.materials ?? []) {
    delete material.normalTexture;
    delete material.occlusionTexture;
    delete material.emissiveTexture;
    if (material.pbrMetallicRoughness) {
      delete material.pbrMetallicRoughness.baseColorTexture;
      delete material.pbrMetallicRoughness.metallicRoughnessTexture;
    }
    for (const ext of Object.values(material.extensions ?? {})) {
      if (ext && typeof ext === "object")
        for (const k of Object.keys(ext)) if (k.endsWith("Texture")) delete ext[k];
    }
  }
  delete json.textures;
  delete json.images;
  json.buffers[0].uri =
    "data:application/octet-stream;base64," +
    bytes.subarray(28 + headerLength).toString("base64");
  return loader.parseAsync(JSON.stringify(json), "");
}

const sizeOf = (object) => new Box3().setFromObject(object).getSize(new Vector3());

export function checkHumanoid(gltf, { clips, height: expectedHeight, minimumHandVertices = 1, minimumFingerVertices = 1, hands = "articulated" } = {}) {
  assert(["rigid", "articulated"].includes(hands), "unknown hand binding mode");
  gltf.scene.updateMatrixWorld(true);

  const names = gltf.animations.map((clip) => clip.name).sort();
  assert(names.length > 0, "humanoid has no animation clips");
  if (clips) assert.deepEqual(names, [...clips].sort(), "humanoid clip names changed");
  for (const clip of gltf.animations)
    assert(clip.tracks.length > 0 && clip.duration > 0, `${clip.name} has no playable tracks`);

  const skins = [];
  let head;
  gltf.scene.traverse((node) => {
    if (node.isSkinnedMesh) skins.push(node);
    if (node.isBone && node.name === "Head") head = node;
  });
  assert(skins.length, "humanoid has no SkinnedMesh");
  const controlledVertices = (name, threshold) => {
    let count = 0;
    for (const skinned of skins) {
      const bone = skinned.skeleton.bones.findIndex((b) => b.name === name);
      const joints = skinned.geometry.attributes.skinIndex;
      const weights = skinned.geometry.attributes.skinWeight;
      for (let v = 0; v < joints.count; v++)
        for (let j = 0; j < 4; j++)
          if (joints.getComponent(v, j) === bone && weights.getComponent(v, j) > threshold) count++;
    }
    return count;
  };
  for (const name of ["hand_l", "hand_r"]) {
    const controlled = controlledVertices(name, 0.5);
    assert(controlled >= minimumHandVertices, `${name} controls only ${controlled} vertices; hand binding is broken`);
  }
  if (hands === "articulated") for (const side of ["l", "r"])
    for (const finger of ["thumb", "index", "middle", "ring", "pinky"]) {
      const controlled = controlledVertices(`${finger}_02_${side}`, 0.35);
      assert(controlled >= minimumFingerVertices, `${finger}_${side} controls only ${controlled} vertices; fingers stay rigid`);
    }
  assert(head, "humanoid has no Head bone");
  const height = sizeOf(gltf.scene).y;
  assert(height > 0 && Number.isFinite(height), "humanoid has invalid bounds");
  if (expectedHeight !== undefined)
    assert(Math.abs(height - expectedHeight) < 0.03, `humanoid height ${height.toFixed(3)} differs from ${expectedHeight}`);

  for (const skinned of skins) {
    // Exercise the exported skin, including UV-split vertices: clip existence cannot detect tears.
    const geometry = skinned.geometry;
    const handVertices = new Set();
    for (let v = 0; v < geometry.attributes.skinIndex.count; v++)
      for (let j = 0; j < 4; j++) {
        const bone = skinned.skeleton.bones[geometry.attributes.skinIndex.getComponent(v, j)];
        if (/^(hand|thumb|index|middle|ring|pinky)_/.test(bone.name) && geometry.attributes.skinWeight.getComponent(v, j) > 0.1)
          handVertices.add(v);
      }
    const rest = Array.from({ length: geometry.attributes.position.count }, (_, i) =>
      new Vector3().fromBufferAttribute(geometry.attributes.position, i));
    const twins = [];
    const positions = new Map();
    rest.forEach((p, i) => {
      const key = p.toArray().map((n) => n.toFixed(5)).join(",");
      if (positions.has(key)) twins.push([positions.get(key), i]);
      else positions.set(key, i);
    });
    const mixer = new AnimationMixer(gltf.scene);
    const posed = rest.map(() => new Vector3());
    for (const clip of gltf.animations) {
      mixer.stopAllAction();
      mixer.clipAction(clip).reset().play();
      let gap = 0;
      let stretch = 0;
      for (let sample = 0; sample <= 12; sample++) {
        mixer.setTime(clip.duration * sample / 12);
        gltf.scene.updateMatrixWorld(true);
        skinned.skeleton.update();
        posed.forEach((p, i) => skinned.getVertexPosition(i, p));
        for (const [a, b] of twins) gap = Math.max(gap, posed[a].distanceTo(posed[b]));
        const index = geometry.index;
        for (let i = 0; i < index.count; i += 3) {
          for (let e = 0; e < 3; e++) {
            const a = index.getX(i + e), b = index.getX(i + (e + 1) % 3);
            stretch = Math.max(stretch, posed[a].distanceTo(posed[b]) - rest[a].distanceTo(rest[b]));
          }
        }
      }
      assert(gap < 0.001, `${clip.name}: UV seam opens by ${gap.toFixed(4)}m`);
      assert(stretch < 0.07, `${clip.name}: triangle edge stretches by ${stretch.toFixed(4)}m`);
      console.log(`${clip.name}: 13 poses, seam gap=${gap.toFixed(5)}m, max edge growth=${stretch.toFixed(4)}m`);
    }
    mixer.stopAllAction();
    skinned.skeleton.pose();
    gltf.scene.updateMatrixWorld(true);
    if (hands === "rigid") continue; // Mitten gloves use the hand bone; body/UV seam checks above still apply.
    const openTips = new Map();
    for (const side of ["l", "r"])
      for (const finger of ["thumb", "index", "middle", "ring", "pinky"]) {
        const name = `${finger}_03_${side}`;
        openTips.set(name, gltf.scene.getObjectByName(name).getWorldPosition(new Vector3()));
        const angles = finger === "thumb" ? [15, 25, 20] : [75, 85, 45];
        for (let joint = 1; joint <= 3; joint++) {
          const bone = gltf.scene.getObjectByName(`${finger}_0${joint}_${side}`);
          const curl = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -angles[joint - 1] * Math.PI / 180);
          if (finger === "thumb" && joint === 1)
            curl.premultiply(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), (side === "l" ? 1 : -1) * 35 * Math.PI / 180));
          bone.quaternion.multiply(curl);
        }
      }
    gltf.scene.updateMatrixWorld(true);
    skinned.skeleton.update();
    for (const [name, open] of openTips) {
      const closed = gltf.scene.getObjectByName(name).getWorldPosition(new Vector3());
      assert(open.distanceTo(closed) > 0.03, `${name} does not bend when forming a fist`);
    }
    posed.forEach((p, i) => skinned.getVertexPosition(i, p));
    for (const [a, b] of twins)
      assert(posed[a].distanceTo(posed[b]) < 0.001, "closed fist opens a skin seam");
    const index = geometry.index;
    let fistStretch = 0;
    for (let i = 0; i < index.count; i += 3)
      for (let e = 0; e < 3; e++) {
        const a = index.getX(i + e), b = index.getX(i + (e + 1) % 3);
        if (handVertices.has(a))
          fistStretch = Math.max(fistStretch, posed[a].distanceTo(posed[b]) - rest[a].distanceTo(rest[b]));
      }
    assert(fistStretch < 0.03, `closed fist stretches a hand triangle by ${fistStretch.toFixed(4)}m`);
    console.log(`both fists: ten fingers bend, seams closed, max hand edge growth=${fistStretch.toFixed(4)}m`);
    mixer.stopAllAction();
    skinned.skeleton.pose();
    gltf.scene.updateMatrixWorld(true);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  assert(process.argv[2], "Usage: node tools/check-humanoid.mjs <rigged.glb>");
  checkHumanoid(await loadGlb(process.argv[2]));
  console.log("PASS check-humanoid: animation and both hand/fist mappings");
}
