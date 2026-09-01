/**
 * How far a clip is authored to move a bone, per clip-second.
 *
 * `node tools/clip-motion.mjs [bone]` (default `hand_r`)
 *
 * The runtime probe measures how far `hand_r` actually travels per game-second. On its own that
 * number says nothing: a hand that moves two centimetres a second is either a subtle typing idle
 * playing correctly or a lively one playing at a sixth speed, and the two look completely
 * different on screen. This is the other half — forward kinematics over the shipped GLB, at the
 * clip's own authored rate — so `observed / authored` is a playback rate rather than a vibe.
 *
 * It also prints each clip's root ground speed, which is what `AnimationPlayer` uses to decide
 * whether a clip is a travelling clip whose rate should be matched to the ground the body covers.
 */
import { NodeIO } from "@gltf-transform/core";
import { Matrix4, Quaternion, Vector3 } from "three";

const io = new NodeIO();

/** Sample one animation sampler at time t, with the interpolation glTF asks for. */
function sampleAt(sampler, t, components) {
  const input = sampler.getInput().getArray();
  const output = sampler.getOutput().getArray();
  const interpolation = sampler.getInterpolation();
  const last = input.length - 1;
  if (t <= input[0]) return read(output, 0, components, interpolation);
  if (t >= input[last]) return read(output, last, components, interpolation);
  let index = 0;
  while (index < last && input[index + 1] < t) index += 1;
  const t0 = input[index];
  const t1 = input[index + 1];
  const alpha = t1 === t0 ? 0 : (t - t0) / (t1 - t0);
  const a = read(output, index, components, interpolation);
  const b = read(output, index + 1, components, interpolation);
  if (interpolation === "STEP") return a;
  if (components === 4) {
    const qa = new Quaternion(a[0], a[1], a[2], a[3]);
    const qb = new Quaternion(b[0], b[1], b[2], b[3]);
    qa.slerp(qb, alpha);
    return [qa.x, qa.y, qa.z, qa.w];
  }
  return a.map((value, axis) => value + (b[axis] - value) * alpha);
}

/** CUBICSPLINE output stores in/value/out triplets; the value is the middle one. */
function read(output, keyframe, components, interpolation) {
  const stride = interpolation === "CUBICSPLINE" ? components * 3 : components;
  const offset = keyframe * stride + (interpolation === "CUBICSPLINE" ? components : 0);
  return Array.from(output.slice(offset, offset + components));
}

/**
 * Authored bone travel per clip, keyed by clip name: `{ path, speed, reach, duration }` in the
 * GLB's own units, which for this rig are metres.
 *
 * Exported so the runtime probe can divide what it measured by what was authored and report a
 * playback rate rather than a distance nobody can calibrate.
 */
export async function authoredBoneMotion(bone = "hand_r", files = ["assets/worker.glb", "assets/worker-mixamo.glb"]) {
 const motion = {};
 for (const path of files) {
  const doc = await io.read(path);
  const root = doc.getRoot();
  const parents = new Map();
  for (const node of root.listNodes()) for (const child of node.listChildren()) parents.set(child, node);
  const target = root.listNodes().find((node) => node.getName() === bone);
  if (target === undefined) continue;
  const chain = [];
  for (let node = target; node !== undefined; node = parents.get(node)) chain.unshift(node);

  for (const anim of root.listAnimations()) {
    const channels = new Map();
    let duration = 0;
    for (const channel of anim.listChannels()) {
      const input = channel.getSampler()?.getInput()?.getArray();
      if (input?.length) duration = Math.max(duration, input[input.length - 1]);
      const node = channel.getTargetNode();
      if (node === null) continue;
      let entry = channels.get(node);
      if (entry === undefined) {
        entry = {};
        channels.set(node, entry);
      }
      entry[channel.getTargetPath()] = channel.getSampler();
    }

    const world = new Matrix4();
    const local = new Matrix4();
    const at = new Vector3();
    const previous = new Vector3();
    const position = new Vector3();
    const rotation = new Quaternion();
    const scale = new Vector3();
    let travelled = 0;
    let first = true;
    const step = 1 / 60;
    let reach = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
    for (let time = 0; time <= duration; time += step) {
      world.identity();
      for (const node of chain) {
        const tracks = channels.get(node) ?? {};
        const t = tracks.translation === undefined ? node.getTranslation() : sampleAt(tracks.translation, time, 3);
        const r = tracks.rotation === undefined ? node.getRotation() : sampleAt(tracks.rotation, time, 4);
        const s = tracks.scale === undefined ? node.getScale() : sampleAt(tracks.scale, time, 3);
        position.set(t[0], t[1], t[2]);
        rotation.set(r[0], r[1], r[2], r[3]);
        scale.set(s[0], s[1], s[2]);
        local.compose(position, rotation, scale);
        world.multiply(local);
      }
      at.setFromMatrixPosition(world);
      for (let axis = 0; axis < 3; axis += 1) {
        const value = at.getComponent(axis);
        reach.min[axis] = Math.min(reach.min[axis], value);
        reach.max[axis] = Math.max(reach.max[axis], value);
      }
      if (!first) travelled += at.distanceTo(previous);
      previous.copy(at);
      first = false;
    }
    const span = Math.max(...[0, 1, 2].map((axis) => reach.max[axis] - reach.min[axis]));
    if (motion[anim.getName()] === undefined)
      motion[anim.getName()] = {
        duration: Number(duration.toFixed(3)),
        path: Number(travelled.toFixed(4)),
        speed: Number((travelled / duration).toFixed(4)),
        reach: Number(span.toFixed(4)),
      };
  }
 }
 return motion;
}

// Run directly (`node tools/clip-motion.mjs [bone]`) it prints the table; imported, it is silent.
if (process.argv[1]?.endsWith("clip-motion.mjs")) {
  const bone = process.argv[2] ?? "hand_r";
  const motion = await authoredBoneMotion(bone);
  console.log(`\n== authored ${bone} motion (GLB units; this rig is authored in metres)`);
  for (const [clip, m] of Object.entries(motion))
    console.log(
      `${clip.padEnd(24)} dur ${m.duration.toFixed(2).padStart(6)}s  path ${m.path.toFixed(3).padStart(7)} m  speed ${m.speed.toFixed(4).padStart(7)} m/clip-s  reach ${m.reach.toFixed(4)} m`,
    );
}
