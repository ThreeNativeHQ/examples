/**
 * Keep only the clips the office plays, and strip the second library's duplicate body.
 *
 * The two CC0 libraries ship 43 clips each on the same rig, and each carries its own copy of the
 * mannequin — 15 MB for a game that plays eight clips and draws one body. Trimming is a build-time
 * decision about this game's assets, not something the framework should do behind anyone's back,
 * so it lives here and is re-runnable: `node tools/trim-clips.mjs`.
 */
import { NodeIO } from "@gltf-transform/core";
import { readFileSync, writeFileSync } from "node:fs";

const KEEP = new Set([
  "Walk_Formal_Loop",
  "Walk_Loop",
  "Driving_Loop",
  "Sitting_Talking_Loop",
  "Sitting_Idle_Loop",
  "Sitting_Enter",
  "Sitting_Exit",
  "Idle_TalkingPhone_Loop",
]);

const io = new NodeIO();

async function trim(source, destination, { keepMesh }) {
  const document = await io.read(source);
  const root = document.getRoot();
  for (const animation of root.listAnimations()) {
    if (KEEP.has(animation.getName())) continue;
    for (const channel of animation.listChannels()) channel.dispose();
    for (const sampler of animation.listSamplers()) sampler.dispose();
    animation.dispose();
  }
  if (!keepMesh) {
    // The clips address nodes, not meshes: dropping the second body keeps every channel valid.
    for (const skin of root.listSkins()) skin.dispose();
    for (const mesh of root.listMeshes()) mesh.dispose();
    for (const node of root.listNodes()) if (node.getMesh() !== null) node.dispose();
  }
  await document.transform((doc) => {
    for (const accessor of doc.getRoot().listAccessors())
      if (accessor.listParents().length <= 1) accessor.dispose();
    for (const buffer of doc.getRoot().listBuffers())
      if (buffer.listParents().length <= 1) buffer.dispose();
  });
  await io.write(destination, document);
  const kept = (await io.read(destination)).getRoot().listAnimations().map((a) => a.getName());
  console.log(
    `${destination}: ${String(readFileSync(destination).byteLength)} bytes, clips ${kept.join(", ")}`,
  );
}

await trim("tools/source-assets/worker.source.glb", "assets/worker.glb", { keepMesh: true });
await trim("tools/source-assets/worker-clips-2.source.glb", "assets/worker-clips-2.glb", { keepMesh: false });
