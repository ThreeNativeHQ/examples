/**
 * Convert the owned Landscape Pro 2.0 Unreal pack into GLBs and PNGs this game can load.
 *
 * The pack is Unreal *source* (uncooked `.uasset`), which is what a Fab marketplace pack always
 * is; the importer provisions its own converter for that case. Run it against an already
 * downloaded tree — `fabcli download <uid> --engine UE_4.24 --platform Windows -o <dir>`.
 *
 *   node tools/import-landscape-pro.mjs [--all]
 *
 * Without `--all` it imports only the packages this game actually uses, which is a few dozen of
 * the pack's 488 and the difference between a two-minute run and an afternoon.
 */
import { importUnrealDirectory } from "/home/joao/projects/threenative/sandbox/.mcp-tools/node_modules/threenative-asset-mcp/dist/unreal/importer.js";

const SOURCE = "/home/joao/projects/threenative/sandbox/.fab-source/landscape-pro-427";
// The importer never overwrites an output directory — it refuses with UNREAL_OUTPUT_COLLISION
// when the cache key differs, which is what happens the moment you add a package to the list. Pass
// a fresh directory (or delete the old one) rather than fighting it.
const OUTPUT = process.env.IMPORT_OUT ?? "/home/joao/projects/threenative/sandbox/wildwood/assets/landscape-pro";

/** The seven ground layers, as diffuse/normal pairs. These are what the terrain blend samples. */
const LAYERS = [
  "T_ground_grass_01_diffuse", "T_ground_grass_01_normal",
  "T_ground_grass_02_diffuse", "T_ground_grass_02_normal",
  "T_ground_forest_diffuse", "T_ground_forest_normal",
  "T_ground_rock_01_diffuse", "T_ground_rock_01_normal",
  "T_ground_rock_02_diffuse", "T_ground_rock_02_normal",
  "T_ground_rock_03_diffuse", "T_ground_rock_03_normal",
  "T_ground_dirt_01_diffuse", "T_ground_dirt_01_normal",
];

/**
 * The pack's meshes are NOT imported, and the reason is worth recording.
 *
 * Its static meshes are uncooked UE4 object version **514** — the 4.18-4.24 era it was authored
 * in. The importer's engine-free MeshDescription reader is verified for 517-522 and refuses to
 * guess at an older binary layout, which is the right call: a wrong guess produces geometry that
 * looks plausible and is subtly wrong. Downloading a later `--engine` does not help, because Fab
 * serves one artifact for every listed engine version (identical byte count for 4.24 and 4.27) —
 * the compatibility list is metadata, not a re-cook.
 *
 * So the geometry stays procedural, in `src/render/foliage.ts`, and wears these textures. That is
 * the honest split: the pack's *surfaces* are what made it worth owning, and those import
 * perfectly.
 */

/** Bark, frond, blade and leaf maps, which is what makes procedural geometry stop looking procedural. */
const FOLIAGE = [
  "T_pine_bark_diffuse", "T_pine_bark_normal",
  "T_tree_pine_barkDetail_diffuse", "T_tree_pine_barkDetail_normal",
  "T_farn_diffuse", "T_farn_normal", "T_farn_alphas",
  "T_grass_bush_atlas_diffuse", "T_grass_bush_atlas_normal", "T_grass_bush_atlas_alpha",
  "T_GrassGroup_Diffuse",
  "T_leafs_diffuse", "T_leafs_normal", "T_tree_pine_Leafs_opacity_maps",
  "T_tree_pine_barkDetail_diffuse", "T_dead_tree_trunk_diffuse",
  "T_clover_diffuse", "T_clover_normal",
  "T_cliffrocks_diffuse", "T_cliffrocks_normal",
  "T_cliffrock01_moss_diffuse", "T_cliffrock01_moss_normal",
  "T_dead_tree_trunk_diffuse", "T_dead_tree_trunk_normal",
];

/** The lake surface. */
const WATER = ["T_waves_normal", "T_water01"];

const all = process.argv.includes("--all");
const onlyPackages = all ? undefined : [...LAYERS, ...FOLIAGE, ...WATER];

console.log(`[import] source ${SOURCE}`);
console.log(`[import] output ${OUTPUT}`);
console.log(`[import] ${all ? "every package" : `${String(onlyPackages.length)} selected packages`}`);

const report = await importUnrealDirectory({
  sourceDir: SOURCE,
  outputDir: OUTPUT,
  listingId: "1ac647da-b1bc-4e72-a56d-60aaeb6918e1",
  engine: "UE_4.27",
  sourceKind: "fab-listing",
  authenticatedDownload: true,
  // 4096 source maps are film-sized. 1024 is the web budget, and a tiling ground layer at 1024
  // is indistinguishable at the distance any of this is ever seen from.
  maxTextureSize: 1024,
  onlyPackages,
  concurrency: 4,
  log: (message) => console.log(`[import] ${message}`),
});

console.log("\n=== REPORT ===");
console.log(JSON.stringify({
  counts: report.counts,
  materials: report.materials,
  materialCoverage: report.materialCoverage,
  models: (report.models ?? []).map((m) => ({ name: m.name, glb: m.glb, verts: m.vertices, mb: +(m.bytes / 1048576).toFixed(2), textured: m.textured })),
  textures: (report.textures ?? []).map((t) => ({ name: t.name, png: t.png, wh: `${t.width}x${t.height}` })),
}, null, 1));
