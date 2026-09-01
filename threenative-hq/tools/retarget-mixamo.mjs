/**
 * Retarget Mixamo animation clips onto the office mannequin's rig.
 *
 * `node tools/retarget-mixamo.mjs`
 *
 * Mixamo clips arrive as "Without Skin" FBX on the `mixamorig*` skeleton, which this mannequin
 * does not share — the office rig is the Quaternius 65-joint skeleton. This script resamples every
 * clip in world space through `SkeletonUtils.retargetClip` (three parses the FBX directly, so no
 * Blender step) and writes the result as a clip-only GLB beside the other animation libraries:
 * `assets/worker-mixamo.glb`. No mesh, no skin, no materials — the same shape `trim-clips.mjs`
 * leaves library 2 in, so `ctx.assets.model()` loads it for its `animations` array alone.
 *
 * Inputs: tools/source-assets/mixamo/*.fbx (the raw Mixamo downloads). Re-runnable at will.
 */
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
import { retargetClip } from "three/examples/jsm/utils/SkeletonUtils.js";
import { Matrix4, Quaternion, Skeleton, Vector3 } from "three";
import { NodeIO } from "@gltf-transform/core";
import { readdirSync, readFileSync } from "node:fs";
import { join, basename } from "node:path";

const RIG = "assets/worker.glb";
const SOURCE_DIR = "tools/source-assets/mixamo";
const OUT = "assets/worker-mixamo.glb";

/** The office-facing clip names, so the game's `requiredClips()` can name them exactly. */
const RENAMES = new Map([
  ["Typing", "Typing_Loop"],
  ["Sit To Type", "SitToType"],
  ["Type To Sit", "TypeToSit"],
  ["Texting While Standing", "Texting_Standing_Loop"],
  ["Walking While Texting", "Texting_Walk_Loop"],
  ["Opening A Filing Cabinet", "Filing_Open"],
  ["Using A Filing Cabinet", "Filing_Use_Loop"],
  ["Using A Fax Machine", "Fax_Use_Loop"],
  ["Sending Fax", "Fax_Send"],
]);

/** Target bone → source bone. The Quaternius rig speaks UE4-style names; Mixamo speaks its own. */
const NAMES = {
  Head: "mixamorigHead",
  neck_01: "mixamorigNeck",
  spine_01: "mixamorigSpine",
  spine_02: "mixamorigSpine1",
  spine_03: "mixamorigSpine2",
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
  ball_l: "mixamorigLeftToeBase",
  thigh_r: "mixamorigRightUpLeg",
  calf_r: "mixamorigRightLeg",
  foot_r: "mixamorigRightFoot",
  ball_r: "mixamorigRightToeBase",
  pelvis: "mixamorigHips",
};

/**
 * Fingers, added to the map rather than left out.
 *
 * A clip that names no finger bone does not neutralise them — the mixer simply never writes
 * those bones, so they hold whatever the previous clip left, and a worker crossing from the
 * Quaternius walk into the Mixamo typing take keeps the walk's last hand shape forever. The
 * typing take animates thirty finger tracks; using them is both the fix and the better hands.
 */
for (const [rigSide, mixamoSide] of [["l", "Left"], ["r", "Right"]]) {
  for (const [rigDigit, mixamoDigit] of [
    ["thumb", "Thumb"],
    ["index", "Index"],
    ["middle", "Middle"],
    ["ring", "Ring"],
    ["pinky", "Pinky"],
  ]) {
    for (const joint of [1, 2, 3]) {
      NAMES[`${rigDigit}_0${String(joint)}_${rigSide}`] =
        `mixamorig${mixamoSide}Hand${mixamoDigit}${String(joint)}`;
    }
  }
}

const io = new NodeIO();
const rigDoc = await io.read(RIG);

// The target skeleton must be a real THREE.Skeleton, so the rig goes through GLTFLoader even
// though the retargeted output is written back out with gltf-transform.
const loader = new GLTFLoader();
const rigGltf = await loader.parseAsync(readFileSync(RIG).buffer.slice(0), "");
let rigSkinned;
rigGltf.scene.traverse((object) => {
  if (object.isSkinnedMesh && rigSkinned === undefined) rigSkinned = object;
});
if (rigSkinned === undefined) throw new Error(`No skinned mesh in ${RIG}.`);
const rigSkeleton = rigSkinned.skeleton;
rigGltf.scene.updateMatrixWorld(true);
const rigHip = rigSkeleton.bones.find((bone) => bone.name === "pelvis");
if (rigHip === undefined) throw new Error('The rig has no "pelvis" bone.');
const rigHipHeight = rigHip.getWorldPosition(new Vector3()).y;

/**
 * The office rig's rest-pose world rotation per bone, read before anything poses it.
 *
 * `retarget` copies the source bone's world rotation onto the target bone outright. That is only
 * correct when both rigs agree on how a bone is oriented at rest, and these two do not: the
 * office rig's arm bones sit 90 deg from Mixamo's and its legs a full 180. Copied straight, every
 * limb points the right way and is rolled about its own axis — which a direction check cannot
 * see and which tears the skin between elbow and wrist into a smear that reads as an arm coming
 * off. `localOffsets` below converts the copy into "apply the source's rotation *away from its
 * own rest* to the target's rest", which is convention-free.
 */
const rigRest = new Map();
for (const bone of rigSkeleton.bones) rigRest.set(bone.name, bone.getWorldQuaternion(new Quaternion()));

const files = readdirSync(SOURCE_DIR).filter((f) => f.toLowerCase().endsWith(".fbx"));
if (files.length === 0) throw new Error(`No .fbx sources in ${SOURCE_DIR}.`);

const clips = [];
for (const file of files) {
  const stem = basename(file, ".fbx");
  const name = RENAMES.get(stem);
  if (name === undefined) throw new Error(`No rename for "${stem}" — add it to RENAMES.`);
  const group = new FBXLoader().parse(readFileSync(join(SOURCE_DIR, file)).buffer.slice(0), "");
  const mixamoClip = group.animations[0];
  if (mixamoClip === undefined) throw new Error(`${file} carries no animation.`);
  // "Without Skin" downloads carry a bare bone hierarchy, which is all the retarget reads.
  group.updateMatrixWorld(true);
  const hips = group.getObjectByName("mixamorigHips");
  if (hips === undefined) throw new Error(`${file} has no mixamorigHips root bone.`);
  const bones = [];
  hips.traverse((object) => {
    if (object.isBone) bones.push(object);
  });
  const mixamoSkeleton = new Skeleton(bones);
  // A Mixamo "Without Skin" FBX sits in its T-pose until a mixer touches it, so its rest
  // rotations are readable right here — and this is the only moment they are.
  const localOffsets = {};
  for (const [targetName, sourceName] of Object.entries(NAMES)) {
    const sourceBone = group.getObjectByName(sourceName);
    const rest = rigRest.get(targetName);
    if (sourceBone === undefined || rest === undefined) continue;
    localOffsets[targetName] = new Matrix4().makeRotationFromQuaternion(
      sourceBone.getWorldQuaternion(new Quaternion()).invert().multiply(rest),
    );
  }
  // Mixamo FBX is authored in centimetres; the rig is in metres. Rotations are scale-free, so
  // only the hip's world translation needs the ratio, and the ratio is measured, not assumed.
  const scale = rigHipHeight / hips.getWorldPosition(new Vector3()).y;
  const retargeted = retargetClip(rigSkinned, mixamoSkeleton, mixamoClip, {
    hip: "mixamorigHips",
    names: NAMES,
    localOffsets,
    scale,
  });
  retargeted.name = name;
  clips.push(retargeted);
  console.log(
    `${name}: ${retargeted.duration.toFixed(2)}s, ${String(retargeted.tracks.length)} tracks, scale ${scale.toFixed(4)}`,
  );
}

// Rebuild the rig document as a clip-only library: mesh, skin, and materials go, the nodes the
// clips address stay. This is the same shape trim-clips.mjs leaves worker-clips-2.glb in.
for (const mesh of rigDoc.getRoot().listMeshes()) mesh.dispose();
for (const skin of rigDoc.getRoot().listSkins()) skin.dispose();
for (const material of rigDoc.getRoot().listMaterials()) material.dispose();
for (const texture of rigDoc.getRoot().listTextures()) texture.dispose();
for (const animation of rigDoc.getRoot().listAnimations()) animation.dispose();

/**
 * Every rig bone, so a clip can be told to neutralise the ones it does not animate.
 *
 * An AnimationMixer writes only the bones a clip names. Anything unnamed holds the pose the
 * previous clip left it in — which is how the leaf bones of a walk cycle end up frozen inside a
 * seated worker's hands. Two constant keys per missing bone costs nothing and makes every clip in
 * this library a complete pose rather than a patch on whatever ran before it.
 */
const restBones = [];
rigGltf.scene.traverse((object) => {
  if (object.isBone) restBones.push(object);
});

for (const clip of clips) {
  const animation = rigDoc.createAnimation(clip.name);
  const named = new Set(clip.tracks.map((t) => t.name.match(/\.bones\[(.+)\]\./)?.[1]));
  for (const bone of restBones) {
    if (named.has(bone.name)) continue;
    clip.tracks.push({
      name: `.bones[${bone.name}].quaternion`,
      times: [0, clip.duration],
      values: [...bone.quaternion.toArray(), ...bone.quaternion.toArray()],
    });
  }
  for (const track of clip.tracks) {
    const match = track.name.match(/\.bones\[(.+)\]\.(position|quaternion)/);
    if (match === null) throw new Error(`Unparsed track name "${track.name}".`);
    const [, boneName, threePath] = match;
    // glTF names these paths `translation` and `rotation`; three names the tracks `position` and
    // `quaternion`. Writing three's own word here is silent: gltf-transform stores the string,
    // GLTFLoader finds no property for it, and every rotation track loads back as
    // `<bone>.undefined` — bound to nothing, so the whole rig plays its bind pose. That is a
    // T-pose on screen with the hips still animating.
    const path = threePath === "position" ? "translation" : "rotation";
    const node = rigDoc.getRoot().listNodes().find((n) => n.getName() === boneName);
    if (node === undefined) throw new Error(`Track targets "${boneName}", which the rig lacks.`);
    const sampler = rigDoc.createAnimationSampler();
    sampler
      .setInput(
        rigDoc
          .createAccessor()
          .setType("SCALAR")
          .setArray(new Float32Array(track.times)),
      )
      .setOutput(
        rigDoc
          .createAccessor()
          .setType(path === "rotation" ? "VEC4" : "VEC3")
          .setArray(new Float32Array(track.values)),
      );
    animation.addSampler(sampler);
    const channel = rigDoc.createAnimationChannel();
    channel.setTargetNode(node).setTargetPath(path).setSampler(sampler);
    animation.addChannel(channel);
  }
}

await io.write(OUT, rigDoc);
console.log(`WROTE ${OUT} with ${String(clips.length)} clips`);
