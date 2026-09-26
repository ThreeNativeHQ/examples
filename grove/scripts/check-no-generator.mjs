#!/usr/bin/env node
// Fails if a shipped bundle still carries the offline tree generator. A grove is built from cooked
// GLBs, so the donor's noise shader, its simplex3 helper and the TreeOptions type must appear in
// nothing that ships. Usage: node scripts/check-no-generator.mjs [dir] (default: dist).
//
// Each needle is scoped to the donor rather than matched bare, because a native artifact embeds the
// host runtime's own symbols: `parry3d::query::gjk::voronoi_simplex3::VoronoiSimplex` contains the
// letters `simplex3` and has nothing to do with a tree. The donor's helper is GLSL — it is always
// written `simplex3(` — so requiring the parenthesis keeps this a generator gate and not a
// physics-symbole grep.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const FORBIDDEN = [
  ["ashima/webgl-noise", /ashima\/webgl-noise/],
  ["simplex3", /simplex3\s*\(/],
  ["TreeOptions", /TreeOptions/],
];
const root = resolve(process.argv[2] ?? "dist");

function walk(dir) {
  const found = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) found.push(...walk(path));
    else found.push(path);
  }
  return found;
}

let scanned = 0;
const hits = [];
for (const file of walk(root)) {
  scanned += 1;
  // Read as text on purpose: a GLB is binary, and a latin1 read still finds an ASCII needle in it.
  const text = readFileSync(file, "latin1");
  for (const [label, pattern] of FORBIDDEN) {
    if (pattern.test(text)) hits.push(`${relative(root, file)}: ${label}`);
  }
}

console.log(`check:no-generator scanned ${scanned} file(s) under ${root}`);
if (hits.length > 0) {
  for (const hit of hits) console.error(`  generator found — ${hit}`);
  console.error("The tree generator must be authored offline (`pnpm trees`) and never shipped.");
  process.exit(1);
}
console.log(
  `  none of ${FORBIDDEN.map(([label]) => label).join(", ")} present: the grove ships cooked GLBs only.`,
);
