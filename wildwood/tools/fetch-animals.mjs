/**
 * Re-download the animal GLBs into assets/fab/2dd7964c-a601-4264-a53d-465dcae1644c/.
 *
 * The directory is gitignored wholesale (assets/fab/ — the landscape pack in the sibling
 * listing is per-seat licensed), so these CC0 files are not in the repo either; this script
 * is how a fresh clone rebuilds them. Sources are Quaternius's CC0 packs as mirrored by
 * Poly Pizza — see CREDITS-ANIMALS.md for the license record and why the Fab
 * ANIMAL VARIETY PACK itself is not the source.
 *
 * Then optimize each for WebGPU (non-interleaved vertices), which is what the game loads:
 *
 *   npx @gltf-transform/cli optimize raw/<name>.glb <name>.glb --compress meshopt \
 *     --flatten false --join false --instance false --simplify false --vertex-layout separate
 *
 * Run: node tools/fetch-animals.mjs
 */
import { mkdirSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);
const outDir = "assets/fab/2dd7964c-a601-4264-a53d-465dcae1644c/raw";
mkdirSync(outDir, { recursive: true });

// Animal → the static.poly.pizza object the model page serves (CC0, by Quaternius).
const files = {
  "fox.glb": "e18e86df-1692-48d8-ac6e-1e25ab4ad574",
  "wolf.glb": "f1d12388-e39b-4157-b32a-646a1d089fc4",
  "husky.glb": "611d25c7-430f-4bb5-ab2c-d8f5f3cb9712",
  "stag.glb": "a9c69fbc-bf7c-4585-9a49-a82e0be1ac6b",
  "doe.glb": "4b6c2a41-43c7-404c-ae37-e8c4645ff93b",
};

for (const [name, uuid] of Object.entries(files)) {
  const url = `https://static.poly.pizza/${uuid}.glb.br`;
  await run("curl", ["-s", "--compressed", "--max-time", "120", "-o", `${outDir}/${name}`, url], {
    stdio: "inherit",
  });
  console.log(`fetched ${name}`);
}
console.log(`\nNow optimize each into the parent directory — see the header comment.`);
