/**
 * Bone-length invariance scan over the real animal pack (PRD-324 Phase 1).
 *
 * A rigid skeleton preserves every parent→child distance under any pose. For every species and
 * its walk clip this tool measures that invariant on two arms:
 *
 *   raw      — a stock AnimationMixer on the loaded GLB scene: is the CLIP rigid on its own rig?
 *   gamePath — the real `Animal` (SkeletonUtils.clone + stripJunkTriangles + normaliseToMetres +
 *              AnimationPlayer with strideRoot), driven exactly as the game drives it.
 *
 * If raw is rigid and gamePath is not, the defect is in the application path. Either way the
 * report names the bone. PRD-314's clipBoneCoverage rides along per clip; clipPoseError and
 * boneContact are recorded as unable to answer this question in the verification note —
 * clipPoseError needs a second reference rig this pack does not have, and boneContact measures
 * bone-to-object distance, not pose shape.
 *
 *   npx tsx tools/scan-bone-lengths.ts
 */
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { AnimationMixer, Quaternion, Vector3 } from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder as ThreeMeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import {
  boneLengthDeviations,
  boneLengths,
  clipBoneCoverage,
  createRandom,
  posedBounds,
  reconcileMirroredClips,
} from "@threenative/core";
import { Animal, type IAnimalModel } from "../src/entities/animals/Animal.js";
import { ANIMAL_SPECS } from "../src/entities/animals/animalSpecs.js";

const ROOT = resolve(import.meta.dirname, "..");
const MANIFEST_PATH = resolve(ROOT, "public/assets.manifest.json");
const ANIMAL_LISTING = "2dd7964c-a601-4264-a53d-465dcae1644c";
const OUTPUT = resolve(ROOT, "artifacts/animals/bone-length-scan.json");
const WALK_SAMPLES = [0.25, 0.5, 0.75];
/** Game-path steps at 60 Hz: past the 0.25 s crossfade, so the blend is never what we measure. */
const GAME_STEPS = [45, 60, 75, 90];
const Y_PI = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI);

const assetRequire = createRequire(import.meta.resolve("@threenative/assets"));
const importAssetDependency = async (name) =>
  import(pathToFileURL(assetRequire.resolve(name)).href);
const [{ NodeIO }, { ALL_EXTENSIONS }, meshoptimizer] = await Promise.all([
  importAssetDependency("@gltf-transform/core"),
  importAssetDependency("@gltf-transform/extensions"),
  importAssetDependency("meshoptimizer"),
]);
const { MeshoptDecoder, MeshoptEncoder } = meshoptimizer;
await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready]);
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({
    "meshopt.decoder": MeshoptDecoder,
    "meshopt.encoder": MeshoptEncoder,
  });

const manifest = JSON.parse(await readFile(MANIFEST_PATH, "utf8"));
/**
 * `--correct <variant>` composes a bind/clip reconciliation into the clips before measuring, so
 * the right correction is picked from numbers instead of derivations:
 *   rootQuat/post+mirror at the parentless bone (the earlier, too-wide experiment)
 *   breakQuat  post-compose Y(π) on the measured break-point bone's quaternion tracks
 *   breakBoth  breakQuat + mirror (−x, y, −z) on that bone's position tracks
 *   allMirror  breakBoth + mirror every position track in every clip
 */
const correctArg = process.argv[process.argv.indexOf("--correct") + 1] ?? "none";
/**
 * One table, no inference: per variant — the quaternion op, which bones' quat tracks it touches,
 * and which position tracks get the (−x, y, −z) mirror. Targets: `rootless` (the parentless
 * bone), `break` (the measured break-point bone), `all` (every tracked bone).
 */
const CORRECT_PLANS = {
  none: { quat: null, quatTargets: [], pos: false, posTargets: [], posForm: "yaw" },
  quatPre: { quat: "pre", quatTargets: ["rootless"], pos: false, posTargets: [], posForm: "yaw" },
  quatPost: { quat: "post", quatTargets: ["rootless"], pos: false, posTargets: [], posForm: "yaw" },
  quatConj: { quat: "conj", quatTargets: ["rootless"], pos: false, posTargets: [], posForm: "yaw" },
  bothPre: { quat: "pre", quatTargets: ["rootless"], pos: true, posTargets: ["rootless"], posForm: "yaw" },
  bothPost: { quat: "post", quatTargets: ["rootless"], pos: true, posTargets: ["rootless"], posForm: "yaw" },
  breakQuat: { quat: "post", quatTargets: ["break"], pos: false, posTargets: [], posForm: "yaw" },
  breakBoth: { quat: "post", quatTargets: ["break"], pos: true, posTargets: ["break"], posForm: "yaw" },
  allMirror: { quat: "post", quatTargets: ["break"], pos: true, posTargets: ["all"], posForm: "yaw" },
  posOnly: { quat: null, quatTargets: [], pos: true, posTargets: ["all"], posForm: "yaw" },
  allConjAllPos: { quat: "conj", quatTargets: ["all"], pos: true, posTargets: ["all"], posForm: "yaw" },
  allPostAllPos: { quat: "post", quatTargets: ["all"], pos: true, posTargets: ["all"], posForm: "yaw" },
  // The Z-mirror family: the clips are expressed in a Z-mirrored frame vs the bind — positions
  // negate Z only, quaternions conjugate as (x, y, z, w) → (−x, −y, z, w).
  zPos: { quat: null, quatTargets: [], pos: true, posTargets: ["all"], posForm: "z" },
  zPosBreak: { quat: null, quatTargets: [], pos: true, posTargets: ["break"], posForm: "z" },
  zConjAll: { quat: "zconj", quatTargets: ["all"], pos: false, posTargets: [], posForm: "z" },
  zBothAll: { quat: "zconj", quatTargets: ["all"], pos: true, posTargets: ["all"], posForm: "z" },
  zBothBreak: { quat: "zconj", quatTargets: ["break"], pos: true, posTargets: ["break"], posForm: "z" },
};
const plan = CORRECT_PLANS[correctArg];
if (plan === undefined) {
  throw new Error(`--correct must be one of ${Object.keys(CORRECT_PLANS).join(", ")}; got ${correctArg}`);
}
const rows = [];
for (const spec of ANIMAL_SPECS) {
  const logicalPath = `fab/${ANIMAL_LISTING}/ue/Models/${spec.glb}.glb`;
  const manifestEntry = manifest.entries?.[logicalPath];
  if (manifestEntry === undefined) throw new Error(`required manifest entry missing: ${logicalPath}`);
  const servedPath = resolve(ROOT, "public", manifestEntry.output);
  const model = await loadServedModel(servedPath);
  if (correctArg !== "none") {
    applyRootCorrection(model);
  }
  const walkName = resolveClipName(model.animations, spec.clips.walk);
  const walkClip = model.animations.find((clip) => clip.name === walkName);
  if (walkClip === undefined) throw new Error(`required walk clip missing: ${spec.clips.walk}`);

  const raw = await scanRawMixer(model, walkClip);
  const gamePath = await scanGamePath(spec, model, walkClip);
  const coverage = clipBoneCoverage(model.scene, walkClip);
  const coreFix = await scanCoreFix(servedPath, walkClip);
  const row = {
    id: spec.id,
    logicalPath,
    servedBytes: manifestEntry.output,
    clip: walkClip.name,
    raw,
    gamePath,
    coreFix,
    clipCoverage: { driven: coverage.driven.length, undriven: coverage.undriven.length },
  };
  rows.push(row);
  console.log(`TN_BONE_SCAN ${JSON.stringify(row)}`);
}

const report = { version: 1, tolerance: 0.01, species: rows };
await mkdir(dirname(OUTPUT), { recursive: true });
await writeFile(OUTPUT, `${JSON.stringify(report, null, 2)}\n`);
console.log(`TN_BONE_SCAN_DONE:${relative(ROOT, OUTPUT)} species=${rows.length}`);

/** The GLB exactly as the browser loads it, materials stripped — geometry, skin and clips intact. */
async function loadServedModel(path) {
  const document = await io.read(path);
  const root = document.getRoot();
  const buffer = root.listBuffers()[0] ?? document.createBuffer();
  for (const accessor of root.listAccessors()) {
    if (accessor.getBuffer() === null) accessor.setBuffer(buffer);
  }
  for (const mesh of root.listMeshes()) {
    for (const primitive of mesh.listPrimitives()) primitive.setMaterial(null);
  }
  for (const material of root.listMaterials()) material.dispose();
  for (const texture of root.listTextures()) texture.dispose();

  const binary = await io.writeBinary(document);
  const arrayBuffer = binary.buffer.slice(binary.byteOffset, binary.byteOffset + binary.byteLength);
  const loader = new GLTFLoader().setMeshoptDecoder(ThreeMeshoptDecoder);
  const gltf = await loader.parseAsync(arrayBuffer, "");
  return { scene: gltf.scene, animations: gltf.animations };
}

function resolveClipName(clips, wanted) {
  if (clips.some((clip) => clip.name === wanted)) return wanted;
  const prefixed = clips.find((clip) => clip.name.endsWith(`|${wanted}`));
  if (prefixed !== undefined) return prefixed.name;
  throw new Error(`no clip resolves to '${wanted}'`);
}

/**
 * Compose the bind/clip reconciliation into the clips, in place. With a break-point variant the
 * target bone is MEASURED per model: the first bone in the hierarchy whose quaternion track sits
 * ~180° from its own bind at every sampled time.
 */
function applyRootCorrection(model) {
  const rootless = new Set();
  const everyBone = new Set();
  model.scene.traverse((object) => {
    if (object.isBone !== true) return;
    everyBone.add(object.name);
    if (object.parent === null || object.parent.isBone !== true) rootless.add(object.name);
  });
  const byTarget = {
    rootless,
    all: everyBone,
    break: new Set([findBreakBone(model)]),
  };
  const quatTargets = new Set(plan.quatTargets.flatMap((key) => [...byTarget[key]]));
  const posTargets = new Set(plan.posTargets.flatMap((key) => [...byTarget[key]]));
  let corrected = 0;
  for (const clip of model.animations) {
    for (const track of clip.tracks) {
      const dot = track.name.lastIndexOf(".");
      const node = track.name.slice(0, dot);
      const property = track.name.slice(dot + 1);
      if (property === "quaternion" && plan.quat !== null && quatTargets.has(node)) {
        const values = track.values;
        for (let index = 0; index < values.length; index += 4) {
          if (plan.quat === "zconj") {
            // (x, y, z, w) → (−x, −y, z, w): conjugation by the Z-axis mirror.
            values[index] = -values[index];
            values[index + 1] = -values[index + 1];
          } else {
            const q = new Quaternion(values[index], values[index + 1], values[index + 2], values[index + 3]);
            if (plan.quat === "pre") q.premultiply(Y_PI);
            else if (plan.quat === "conj") q.premultiply(Y_PI).multiply(Y_PI.clone().invert());
            else q.multiply(Y_PI);
            values[index] = q.x;
            values[index + 1] = q.y;
            values[index + 2] = q.z;
            values[index + 3] = q.w;
          }
        }
        corrected += 1;
      }
      if (property === "position" && plan.pos && posTargets.has(node)) {
        const values = track.values;
        for (let index = 0; index < values.length; index += 3) {
          if (plan.posForm === "z") {
            // (x, y, z) → (x, y, −z): the Z-mirror preserves left/right.
            values[index + 2] = -values[index + 2];
          } else {
            values[index] = -values[index];
            values[index + 2] = -values[index + 2];
          }
        }
        corrected += 1;
      }
    }
  }
  console.log(`TN_SCAN_CORRECTION variant=${correctArg} quat=${plan.quat}/${[...quatTargets].length} pos=${plan.pos}/${[...posTargets].length} tracks=${corrected}`);
}

/**
 * The first bone (hierarchy order) whose quaternion track disagrees with its own bind by ~180°
 * at every sampled time of any clip — the point where the file's bind and its clips disagree.
 */
function findBreakBone(model) {
  const bones = [];
  model.scene.traverse((object) => {
    if (object.isBone === true) bones.push(object);
  });
  const bind = bindLocalQuaternions(model.scene);
  const mixer = new AnimationMixer(model.scene);
  let breakBone = null;
  for (const bone of bones) {
    const tracked = model.animations.some((clip) =>
      clip.tracks.some((track) => track.name === `${bone.name}.quaternion`),
    );
    if (!tracked) continue;
    let consistent = true;
    for (const clip of model.animations) {
      const track = clip.tracks.find((candidate) => candidate.name === `${bone.name}.quaternion`);
      if (track === undefined) continue;
      for (let index = 0; index < track.values.length; index += 4) {
        const q = new Quaternion(track.values[index], track.values[index + 1], track.values[index + 2], track.values[index + 3]);
        const delta = bind.get(bone.name).clone().invert().premultiply(q);
        const degrees = 2 * Math.acos(Math.min(1, Math.abs(delta.w))) * (180 / Math.PI);
        if (degrees < 150) {
          consistent = false;
          break;
        }
      }
      if (!consistent) break;
    }
    if (consistent) {
      breakBone = bone.name;
      break;
    }
  }
  mixer.uncacheRoot(model.scene);
  if (breakBone === null) throw new Error("no break-point bone found: every tracked bone is bind-consistent");
  return breakBone;
}

/** The clip alone, on its own rig: any deviation here is in the DATA, not the game. */
async function scanRawMixer(model, clip) {
  const bind = boneLengths(model.scene);
  const bindForwardZ = forwardZOf(model.scene);
  const bindWorld = bindWorldQuaternions(model.scene);
  const bindLocal = bindLocalQuaternions(model.scene);
  const rootBone = rootBoneOf(model.scene);
  const bindPelvis = landmarkWorldPosition(model.scene, "-Pelvis");
  const sideSigns = bindSideSigns(model.scene);
  const mixer = new AnimationMixer(model.scene);
  mixer.clipAction(clip).play();
  const samples = [];
  for (const seconds of WALK_SAMPLES) {
    mixer.setTime(seconds * clip.duration);
    model.scene.updateMatrixWorld(true);
    const report = boneLengthDeviations(model.scene, bind);
    const world = new Quaternion();
    rootBone.getWorldQuaternion(world);
    const bindRoot = bindWorld.get(rootBone.name);
    const rootWorldDelta = round(
      2 * Math.acos(Math.min(1, Math.abs(bindRoot.clone().invert().premultiply(world).w))) *
        (180 / Math.PI),
    );
    const pelvisNow = landmarkWorldPosition(model.scene, "-Pelvis");
    samples.push({
      ...summarise(seconds * clip.duration, report),
      extent: extentOf(model.scene),
      forwardZ: forwardZOf(model.scene),
      rootWorldDelta,
      pelvisOffset: round(pelvisNow.distanceTo(bindPelvis)),
      handedness: handednessOf(model.scene, sideSigns),
      bindDelta: worstBindDeltas(model.scene, bindWorld),
      localBindDelta: worstLocalBindDeltas(model.scene, bindLocal),
    });
  }
  mixer.stopAllAction();
  mixer.uncacheRoot(model.scene);
  return { bindForwardZ, samples, worst: samples.reduce(worstOf) };
}

function rootBoneOf(root) {
  const bones = [];
  root.traverse((object) => {
    if (object.isBone === true && (object.parent === null || object.parent.isBone !== true)) {
      bones.push(object);
    }
  });
  if (bones.length !== 1) throw new Error(`expected exactly one root bone, got ${bones.length}`);
  return bones[0];
}

function landmarkWorldPosition(root, suffix) {
  let found = null;
  root.traverse((object) => {
    if (object.name.endsWith(suffix)) found = object;
  });
  if (found === null) throw new Error(`required landmark '${suffix}' missing`);
  root.updateWorldMatrix(true, true);
  return found.getWorldPosition(new Vector3());
}

/**
 * Side consistency against the rig's own bind: every L/R bone keeps the side of the pelvis it
 * had at bind, measured on the pelvis→bone axis in the rig's local frame. No external left/right
 * convention is involved, so a correction that quietly reflects the skeleton fails here while
 * every length and forward number stays green.
 */
function bindSideSigns(root) {
  root.updateWorldMatrix(true, true);
  const pelvis = landmarkWorldPosition(root, "-Pelvis");
  const signs = new Map();
  root.traverse((object) => {
    if (object.isBone !== true) return;
    if (!object.name.includes("-L-") && !object.name.includes("-R-")) return;
    const local = root.worldToLocal(object.getWorldPosition(new Vector3()));
    const pelvisLocal = root.worldToLocal(pelvis.clone());
    signs.set(object.name, Math.sign(local.x - pelvisLocal.x));
  });
  return signs;
}

function handednessOf(root, bindSigns) {
  root.updateWorldMatrix(true, true);
  const pelvis = landmarkWorldPosition(root, "-Pelvis");
  let correct = 0;
  let total = 0;
  const wrong = [];
  root.traverse((object) => {
    if (object.isBone !== true) return;
    const bindSign = bindSigns.get(object.name);
    if (bindSign === undefined) return;
    total += 1;
    const local = root.worldToLocal(object.getWorldPosition(new Vector3()));
    const pelvisLocal = root.worldToLocal(pelvis.clone());
    const sign = Math.sign(local.x - pelvisLocal.x);
    if (sign === bindSign) correct += 1;
    else wrong.push(object.name);
  });
  return { correct, total, wrong: wrong.slice(0, 4) };
}

/** Every bone's world rotation at bind, so a posed bone can be scored against its own rest. */
function bindWorldQuaternions(root) {
  root.updateWorldMatrix(true, true);
  const quats = new Map();
  root.traverse((object) => {
    if (object.isBone === true) quats.set(object.name, object.getWorldQuaternion(new Quaternion()));
  });
  return quats;
}

/** Every bone's local rotation at bind — what the clip's own tracks are compared against. */
function bindLocalQuaternions(root) {
  root.updateWorldMatrix(true, true);
  const quats = new Map();
  root.traverse((object) => {
    if (object.isBone === true) quats.set(object.name, object.quaternion.clone());
  });
  return quats;
}

/** Worst five bones by LOCAL rotation delta from bind: is the flip only on the root track? */
function worstLocalBindDeltas(root, bindLocal) {
  const rows = [];
  const delta = new Quaternion();
  root.traverse((object) => {
    const bind = bindLocal.get(object.name);
    if (bind === undefined) return;
    delta.copy(bind).invert().premultiply(object.quaternion);
    const angle = 2 * Math.acos(Math.min(1, Math.abs(delta.w))) * (180 / Math.PI);
    rows.push({ bone: object.name, degrees: round(angle) });
  });
  rows.sort((left, right) => right.degrees - left.degrees);
  return rows.slice(0, 8);
}

/**
 * Per-bone world-rotation delta from bind, in degrees, whole quaternion (PRD-314's method with
 * the rig's own bind as the reference — a self-referential clipPoseError). Worst five, each with
 * the yaw component of its delta: a fold about the body's up axis reads as yaw ≈ ±180°.
 */
function worstBindDeltas(root, bindQuats) {
  const rows = [];
  root.updateWorldMatrix(true, true);
  const world = new Quaternion();
  const delta = new Quaternion();
  const axis = new Vector3();
  root.traverse((object) => {
    const bind = bindQuats.get(object.name);
    if (bind === undefined) return;
    object.getWorldQuaternion(world);
    delta.copy(bind).invert().premultiply(world);
    const angle = 2 * Math.acos(Math.min(1, Math.abs(delta.w))) * (180 / Math.PI);
    const sign = delta.w < 0 ? -1 : 1;
    const yaw = Math.atan2(2 * (sign * delta.w * delta.y + sign * delta.x * delta.z), 1 - 2 * (delta.y ** 2 + delta.z ** 2)) * (180 / Math.PI);
    rows.push({ bone: object.name, degrees: round(angle), yaw: round(yaw) });
  });
  rows.sort((left, right) => right.degrees - left.degrees);
  return rows.slice(0, 5);
}

/** The skin-aware world bounds of the posed rig — what the CPU-skinned vertices actually fill. */
function extentOf(root) {
  const bounds = posedBounds(root);
  return {
    size: [bounds.size[0], bounds.size[1], bounds.size[2]].map(round),
  };
}

/**
 * Head-minus-pelvis horizontal direction, expressed on the rig's own +Z (its local frame), so a
 * rig facing its own +Z reads +1 and one facing backwards reads −1. Landmarks follow the
 * harness convention: exactly one bone named `*-Head` and one `*-Pelvis` under the rig.
 */
function forwardZOf(root) {
  const heads = [];
  const pelvises = [];
  root.traverse((object) => {
    if (object.name.endsWith("-Head")) heads.push(object);
    if (object.name.endsWith("-Pelvis")) pelvises.push(object);
  });
  if (heads.length !== 1 || pelvises.length !== 1) {
    throw new Error(
      `required landmarks missing: head=${heads.length} pelvis=${pelvises.length} under ${root.name || root.type}`,
    );
  }
  root.updateWorldMatrix(true, true);
  const headLocal = root.worldToLocal(heads[0].getWorldPosition(new Vector3()));
  const pelvisLocal = root.worldToLocal(pelvises[0].getWorldPosition(new Vector3()));
  const delta = headLocal.sub(pelvisLocal);
  delta.y = 0;
  const length = delta.length();
  if (length <= 1e-9) return 0;
  return round(delta.z / length);
}

/** The game's real `Animal`, driven as the game drives it. */
async function scanGamePath(spec, model, walkClip) {
  const animal = new Animal(spec, model, {
    ground: () => 0,
    spawn: new Vector3(0, 0, 0),
    rng: createRandom(90210),
  });
  // Before the first update the mixer has written nothing: the rig stands at bind.
  const bindForwardZ = forwardZOf(animal.object);
  animal.forceState("wander", 30);
  const samples = [];
  for (let step = 1; step <= GAME_STEPS[GAME_STEPS.length - 1]; step += 1) {
    animal.update(1 / 60, null);
    if (GAME_STEPS.includes(step)) {
      const report = boneLengthDeviations(animal.object, animal.bindBoneLengths);
      samples.push({
        ...summarise(step / 60, report),
        extent: extentOf(animal.object),
        forwardZ: forwardZOf(animal.object),
      });
    }
  }
  animal.dispose();
  return { bindForwardZ, samples, worst: samples.reduce(worstOf), clip: walkClip.name };
}

/**
 * The shipped repair (`reconcileMirroredClips` from @threenative/core) against the real GLB:
 * what it detects, and whether the repaired clip then faces forward.
 */
async function scanCoreFix(servedPath, walkClip) {
  const model = await loadServedModel(servedPath);
  const applied = reconcileMirroredClips(model.scene, model.animations);
  if (!applied) return { applied };
  const bind = boneLengths(model.scene);
  const sideSigns = bindSideSigns(model.scene);
  const bindPelvis = landmarkWorldPosition(model.scene, "-Pelvis");
  const mixer = new AnimationMixer(model.scene);
  mixer.clipAction(walkClip).play();
  mixer.setTime(walkClip.duration / 2);
  model.scene.updateMatrixWorld(true);
  const deviations = boneLengthDeviations(model.scene, bind);
  const pelvisNow = landmarkWorldPosition(model.scene, "-Pelvis");
  const result = {
    applied,
    forwardZ: forwardZOf(model.scene),
    pelvisOffset: round(pelvisNow.distanceTo(bindPelvis)),
    side: handednessOf(model.scene, sideSigns),
    rigid: deviations.rigid,
  };
  mixer.stopAllAction();
  mixer.uncacheRoot(model.scene);
  return result;
}

function summarise(seconds, report) {
  return {
    seconds,
    rigid: report.rigid,
    maxDeviation: round(report.maxDeviation),
    compared: report.compared,
    worst:
      report.worst === null
        ? null
        : {
            bone: report.worst.bone,
            bindLength: round(report.worst.bindLength),
            posedLength: round(report.worst.posedLength),
            delta: round(report.worst.delta),
          },
  };
}

function worstOf(left, right) {
  return (right?.maxDeviation ?? 0) > (left?.maxDeviation ?? 0) ? right : left;
}

function round(value) {
  if (!Number.isFinite(value)) throw new Error("scan produced a non-finite number");
  return Number(value.toFixed(6));
}
