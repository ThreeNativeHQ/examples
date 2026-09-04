/**
 * Does every animal move at a speed its own clips can carry?
 *
 * The owner's report on 2026-09-03, playing the wood: "deer legs movement does not match its
 * movement speed. It's ultra fast but he's moving slowly." That is foot-sliding, and it has a
 * number: the playback rate `AnimationPlayer` has to run a clip at to cover the ground the spec
 * asks for. At rate 1 the feet and the ground agree exactly. Away from 1 they disagree, and past
 * the engine's 3.0 ceiling the rate is clamped — the cycle stops keeping up at all and the animal
 * skates, which is the same defect wearing the other face.
 *
 * This gate loads the real GLBs, asks the real engine what each clip was authored for, and fails
 * when a species' configured speed sits outside the band its clips support.
 *
 *   node tools/stride-gate.mjs
 *   node tools/stride-gate.mjs --json
 */
import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { AnimationPlayer, normaliseToMetres } from "@threenative/core";
import { Group } from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { clone as cloneSkeleton } from "three/addons/utils/SkeletonUtils.js";

const ROOT = resolve(import.meta.dirname, "..");
const MODELS = resolve(ROOT, "assets/fab/2dd7964c-a601-4264-a53d-465dcae1644c/ue/Models");

/**
 * The band a locomotion rate may sit in.
 *
 * Rate 1 is a clip playing at the speed it was drawn for. A little either side is invisible — a
 * real animal changes pace without changing gait. The ceiling is the engine's own
 * `STRIDE_RATE_MAX`: at 3.0 the rate is being clamped rather than matched, so anything at or above
 * it is a species asking its rig for a gait the rig does not have.
 */
const RATE_MIN = 0.7;
const RATE_MAX = 2.6;

// GLTFLoader reaches for browser globals only on the texture path, which this gate never renders.
globalThis.self ??= globalThis;
globalThis.URL.createObjectURL ??= () => "blob:stub";
globalThis.URL.revokeObjectURL ??= () => {};

/** The specs, read from the game's own source rather than retyped here. */
async function loadSpecs() {
  const out = resolve(ROOT, "artifacts/animals/.animalSpecs.mjs");
  await mkdir(resolve(ROOT, "artifacts/animals"), { recursive: true });
  await build({
    entryPoints: [resolve(ROOT, "src/entities/animals/animalSpecs.ts")],
    outfile: out,
    format: "esm",
    bundle: false,
  });
  const module = await import(pathToFileURL(out).href);
  await rm(out, { force: true });
  return module.ANIMAL_SPECS;
}

await MeshoptDecoder.ready;
const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);
const parse = async (path) => {
  const bytes = await readFile(path);
  return new Promise((res, rej) =>
    loader.parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), "", res, rej),
  );
};

const specs = await loadSpecs();
const rows = [];
for (const spec of specs) {
  const gltf = await parse(resolve(MODELS, `${spec.glb}.glb`));
  for (const [gait, semantic] of [
    ["walk", "walk"],
    ["run", "run"],
  ]) {
    const speed = gait === "walk" ? spec.walkSpeed : spec.runSpeed;
    // The same shape the game builds: a group the AI moves, the rig cloned under it, the group
    // normalised to the species' real length, and the group named as the strideRoot.
    const group = new Group();
    group.add(cloneSkeleton(gltf.scene));
    normaliseToMetres(group, { axis: "longest", metres: spec.length });
    const player = new AnimationPlayer({
      clips: gltf.animations,
      root: group.children[0],
      strideRoot: group,
    });
    const name = gltf.animations.find((clip) => clip.name === spec.clips[semantic])?.name;
    if (name === undefined) {
      rows.push({ id: spec.id, gait, ok: false, why: `no clip named ${spec.clips[semantic]}` });
      continue;
    }
    player.play(name);
    player.update(1 / 60);
    for (let frame = 0; frame < 12; frame += 1) {
      group.position.z += speed / 60;
      player.update(1 / 60);
    }
    const stride = player.stride;
    const rate = stride.clipGroundSpeed > 0 ? speed / stride.clipGroundSpeed : Infinity;
    const ok = stride.clipGroundSpeed > 0 && rate >= RATE_MIN && rate <= RATE_MAX;
    rows.push({
      id: spec.id,
      gait,
      clip: name,
      authored: Number(stride.clipGroundSpeed.toFixed(3)),
      speed,
      rate: Number(rate.toFixed(2)),
      inPlace: stride.inPlace,
      ok,
      why: ok
        ? ""
        : stride.clipGroundSpeed === 0
          ? "clip carries no stride the engine can find"
          : rate > RATE_MAX
            ? `asks for ${rate.toFixed(2)}x its own cycle`
            : `runs its cycle at ${rate.toFixed(2)}x, slower than the clip`,
    });
  }
}

if (process.argv.includes("--json")) {
  console.log(JSON.stringify({ rateMin: RATE_MIN, rateMax: RATE_MAX, rows }, null, 2));
} else {
  console.log(`stride gate — rate must sit in [${RATE_MIN}, ${RATE_MAX}]\n`);
  console.log("species  gait   clip                       authored   speed    rate   verdict");
  console.log("-".repeat(88));
  for (const row of rows) {
    console.log(
      `${row.id.padEnd(8)} ${row.gait.padEnd(6)} ${(row.clip ?? "-").padEnd(26)}` +
        ` ${String(row.authored ?? "-").padStart(8)} ${String(row.speed ?? "-").padStart(7)}` +
        ` ${String(row.rate ?? "-").padStart(7)}   ${row.ok ? "ok" : `FAIL: ${row.why}`}`,
    );
  }
}

const failed = rows.filter((row) => !row.ok);
await mkdir(resolve(ROOT, "artifacts/animals"), { recursive: true });
await writeFile(
  resolve(ROOT, "artifacts/animals/stride-gate.json"),
  `${JSON.stringify({ rateMin: RATE_MIN, rateMax: RATE_MAX, rows }, null, 2)}\n`,
);
if (failed.length > 0) {
  console.error(`\n${failed.length} of ${rows.length} gaits are outside the band.`);
  process.exit(1);
}
console.log(`\nall ${rows.length} gaits matched.`);
