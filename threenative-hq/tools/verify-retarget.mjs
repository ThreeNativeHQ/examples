/**
 * Score the retarget in degrees: `node tools/verify-retarget.mjs [clip]`.
 *
 * A screenshot says "the arms look wrong". This says how wrong, per bone, per frame — the only
 * way to tell a fixed retarget from one that merely moved.
 *
 * The measurement is each bone's world rotation *relative to its own rig's rest pose*, compared
 * against the same delta on the Mixamo source. Two things follow from that, and both are the
 * point:
 *
 * - Comparing deltas rather than absolute rotations means the two rigs never have to agree on a
 *   bind convention. The office rig's arm bones sit 90 deg apart from Mixamo's and its legs 180;
 *   an absolute comparison scores that skeleton difference forever and reports the same number
 *   for every clip.
 * - Comparing whole quaternions rather than bone directions means twist counts. A forearm rolled
 *   90 deg about its own axis still points exactly where it should: a direction-only metric reads
 *   zero error while the skin between elbow and wrist tears into a smear on screen. That is the
 *   bug this file exists to catch.
 *
 * Under ~10 deg mean is a pose a player reads as the same pose. Over ~40 deg is a different pose.
 */
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
import { AnimationMixer, Quaternion } from "three";
import { readFileSync } from "node:fs";

const RIG = "assets/worker.glb";
const LIB = "assets/worker-mixamo.glb";

/** Office rig bone -> Mixamo bone, for the joints a player actually reads. */
const NAMES = {
  pelvis: "mixamorigHips",
  spine_01: "mixamorigSpine",
  spine_02: "mixamorigSpine1",
  spine_03: "mixamorigSpine2",
  neck_01: "mixamorigNeck",
  Head: "mixamorigHead",
  clavicle_l: "mixamorigLeftShoulder",
  upperarm_l: "mixamorigLeftArm",
  lowerarm_l: "mixamorigLeftForeArm",
  hand_l: "mixamorigLeftHand",
  clavicle_r: "mixamorigRightShoulder",
  upperarm_r: "mixamorigRightArm",
  lowerarm_r: "mixamorigRightForeArm",
  hand_r: "mixamorigRightHand",
  thigh_l: "mixamorigLeftUpLeg",
  calf_l: "mixamorigLeftLeg",
  foot_l: "mixamorigLeftFoot",
  thigh_r: "mixamorigRightUpLeg",
  calf_r: "mixamorigRightLeg",
  foot_r: "mixamorigRightFoot",
};

const SOURCE_FOR = new Map([
  ["Typing_Loop", "Typing.fbx"],
  ["SitToType", "Sit To Type.fbx"],
  ["TypeToSit", "Type To Sit.fbx"],
  ["Texting_Standing_Loop", "Texting While Standing.fbx"],
  ["Texting_Walk_Loop", "Walking While Texting.fbx"],
  ["Filing_Open", "Opening A Filing Cabinet.fbx"],
  ["Filing_Use_Loop", "Using A Filing Cabinet.fbx"],
  ["Fax_Use_Loop", "Using A Fax Machine.fbx"],
  ["Fax_Send", "Sending Fax.fbx"],
]);

const arrayBuffer = (path) => {
  const b = readFileSync(path);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
};

const rig = await new GLTFLoader().parseAsync(arrayBuffer(RIG), "");
const lib = await new GLTFLoader().parseAsync(arrayBuffer(LIB), "");
const only = process.argv[2];
const clips = lib.animations.filter((c) => only === undefined || c.name === only);
if (clips.length === 0) throw new Error(`No clip "${String(only)}" in ${LIB}.`);

/** Rest-pose world rotations of the office rig, read with the skeleton explicitly reposed. */
function rigRest() {
  rig.scene.traverse((o) => {
    if (o.isSkinnedMesh) o.skeleton.pose();
  });
  rig.scene.updateMatrixWorld(true);
  const out = new Map();
  for (const name of Object.keys(NAMES)) {
    const bone = rig.scene.getObjectByName(name);
    if (bone !== undefined) out.set(name, bone.getWorldQuaternion(new Quaternion()));
  }
  return out;
}

const scratch = new Quaternion();
const deltaFrom = (bone, rest, out) =>
  out.copy(bone.getWorldQuaternion(scratch)).multiply(rest.clone().invert());

let worstClip = "";
let worstMean = 0;
for (const clip of clips) {
  const fbx = SOURCE_FOR.get(clip.name);
  if (fbx === undefined) continue;

  // The FBX is at its T-pose rest until a mixer touches it, so rest rotations are read here.
  const source = new FBXLoader().parse(arrayBuffer(`tools/source-assets/mixamo/${fbx}`), "");
  source.updateMatrixWorld(true);
  const sourceRest = new Map();
  for (const [target, name] of Object.entries(NAMES)) {
    const bone = source.getObjectByName(name);
    if (bone !== undefined) sourceRest.set(target, bone.getWorldQuaternion(new Quaternion()));
  }
  const targetRest = rigRest();

  const sourceMixer = new AnimationMixer(source);
  sourceMixer.clipAction(source.animations[0]).play();
  const targetMixer = new AnimationMixer(rig.scene);
  targetMixer.clipAction(clip).play();

  const perBone = new Map();
  let sum = 0;
  let count = 0;
  let max = 0;
  let maxAt = "";
  const samples = 8;
  let last = 0;
  const dt = new Quaternion();
  const ds = new Quaternion();
  for (let i = 0; i < samples; i += 1) {
    const t = (clip.duration * (i + 0.5)) / samples;
    sourceMixer.update(t - last);
    targetMixer.update(t - last);
    last = t;
    source.updateMatrixWorld(true);
    rig.scene.updateMatrixWorld(true);
    for (const [target, name] of Object.entries(NAMES)) {
      const tb = rig.scene.getObjectByName(target);
      const sb = source.getObjectByName(name);
      if (tb === undefined || sb === undefined) continue;
      deltaFrom(tb, targetRest.get(target), dt);
      deltaFrom(sb, sourceRest.get(target), ds);
      const deg = (2 * Math.acos(Math.min(1, Math.abs(dt.dot(ds)))) * 180) / Math.PI;
      perBone.set(target, (perBone.get(target) ?? 0) + deg / samples);
      sum += deg;
      count += 1;
      if (deg > max) {
        max = deg;
        maxAt = `${target}@${t.toFixed(2)}s`;
      }
    }
  }
  const mean = sum / Math.max(1, count);
  if (mean > worstMean) {
    worstMean = mean;
    worstClip = clip.name;
  }
  const worst = [...perBone.entries()]
    .sort((x, y) => y[1] - x[1])
    .slice(0, 4)
    .map(([n, d]) => `${n} ${d.toFixed(0)}`)
    .join(", ");
  console.log(
    `${clip.name.padEnd(24)} mean ${mean.toFixed(1)} deg  max ${max.toFixed(0)} (${maxAt})  worst: ${worst}`,
  );
}
console.log(`\nWORST ${worstClip} ${worstMean.toFixed(1)} deg mean`);
