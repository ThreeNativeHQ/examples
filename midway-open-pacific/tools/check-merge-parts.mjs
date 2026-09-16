/**
 * Reachability and provenance proof for Midway's merge paths now running through the packaged
 * `@threenative/core` `mergeParts` with preserved channels.
 *
 * Live in-world consumers — the required gameplay proof:
 *   - the hull LOD stand-in (`airframe-lod.ts` `mergeLod`), reached for every imported hull below
 *     the merged-hull pixel line: `scene.world.meshes[*].userData.hullLow`
 *   - the Devastator detail batch (`devastator.ts` `batch`): scene meshes named `*_details`
 * The engine's default merge strips every attribute but position, so a merged geometry that still
 * carries `uv` and `normal` can only come from a caller passing `preserve: ["uv", "normal"]`; that
 * is the signal read per consumer.
 *
 * NOT live: `assets.ts` `consolidate` is exported but unreferenced by the shipped game, so its
 * builders `makeIsland`/`makeCrew` are called here directly. That verifies the third helper's
 * output, and is explicitly not represented as live in-world integration.
 *
 * Provenance: the game's own dependency string is a hashed tarball; the tarball's sha256 is checked
 * against that hash, and the resolved package's real public `mergeParts` is exercised (it refuses a
 * listed channel a part lacks, and keeps it when the part carries it). A string match on the served
 * bundle proved nothing about behaviour and is gone.
 *
 * Run under the display lock: bash tools/capture-lock.sh node tools/check-merge-parts.mjs
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as THREE from "three";
import { chromium } from "playwright";

const gameRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(await readFile(path.join(gameRoot, "package.json"), "utf8"));
const dependency = pkg.dependencies["@threenative/core"];
const tarball = dependency.replace(/^file:/, "");
const hash = path.basename(tarball).match(/-([0-9a-f]{12})\.tgz$/)?.[1];
assert.ok(hash, `game dependency is not a hashed core tarball: ${dependency}`);
const digest = createHash("sha256").update(await readFile(tarball)).digest("hex");
assert.equal(digest.slice(0, 12), hash, `core tarball content no longer matches its hash: ${tarball}`);
console.log(`core tarball ${path.basename(tarball)} sha256 ${digest.slice(0, 12)} ok`);

const core = await import("@threenative/core");
console.log(`core resolved ${import.meta.resolve("@threenative/core")}`);
const probe = (geometry, preserve) =>
  core.mergeParts([{ geometry }], { label: "provenance-probe", preserve });
const bare = new THREE.BufferGeometry();
bare.setAttribute(
  "position",
  new THREE.BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 3),
);
assert.throws(() => probe(bare, ["uv"]), /has no uv to preserve/);
const full = bare.clone();
full.setAttribute("normal", new THREE.BufferAttribute(new Float32Array(9), 3));
full.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(6), 2));
const kept = probe(full, ["uv", "normal"]);
assert.ok(
  kept.getAttribute("uv") && kept.getAttribute("normal"),
  "resolved core does not keep preserved channels",
);

const URL = process.env.MIDWAY_URL || "http://127.0.0.1:5399";
const browser = await chromium.launch({
  headless: false,
  args: [
    "--enable-unsafe-webgpu",
    "--enable-features=Vulkan",
    "--disable-gpu-sandbox",
    "--ignore-gpu-blocklist",
    "--ozone-platform=x11",
  ],
});
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await page.goto(URL);
  await page.waitForSelector("#loading.hidden", { state: "attached", timeout: 120000 });
  await page.waitForSelector("#briefing:not(.hidden)");

  const report = await page.evaluate(async () => {
    const urls = performance
      .getEntriesByType("resource")
      .map((e) => e.name)
      .filter((n) => /\/src\/game\.ts(?:\?|$)/.test(n));
    let scene;
    for (const url of urls.reverse()) {
      const loaded = (await import(url)).default.scene;
      if (loaded) {
        scene = loaded;
        break;
      }
    }
    if (!scene) throw new Error("Loaded game has no scene");
    const has = (geometry) =>
      !!(
        geometry?.getAttribute("uv") &&
        geometry?.getAttribute("normal") &&
        geometry.getAttribute("position")?.count
      );

    const hulls = [];
    for (const mesh of scene.world.meshes.values())
      if (mesh.userData?.hullLow?.geometry) hulls.push(has(mesh.userData.hullLow.geometry));

    const detailMeshes = [];
    scene.world.scene.traverse((o) => {
      if (o.isMesh && /_details$/.test(o.name)) detailMeshes.push(o);
    });
    const details = detailMeshes.map((o) => has(o.geometry));
    // Exact bit digest of the merged Devastator position/normal/uv buffers, so a baseline and a
    // final run can be compared directly and the normal-fallback question answered with numbers.
    const devastatorDigest = (() => {
      let h = 2166136261 >>> 0;
      const mix = (value) => {
        h = Math.imul(h ^ value, 16777619) >>> 0;
      };
      for (const mesh of [...detailMeshes].sort((a, b) => a.name.localeCompare(b.name))) {
        for (const name of ["position", "normal", "uv"]) {
          const array = mesh.geometry.getAttribute(name)?.array;
          if (!array) {
            mix(0xdead);
            continue;
          }
          for (const word of new Uint32Array(array.buffer, array.byteOffset, array.length)) mix(word);
        }
      }
      return h.toString(16);
    })();

    // Exported but unused builder path; called directly, never claimed as live gameplay.
    const assets = await import("/src/render/assets.ts");
    const consolidated = [];
    for (const child of assets.makeIsland().children)
      if (child.isMesh) consolidated.push(has(child.geometry));
    for (const man of assets.makeCrew().children)
      for (const child of man.children) if (child.isMesh) consolidated.push(has(child.geometry));

    return { groups: { hulls, details, consolidated }, devastatorDigest };
  });

  const { groups, devastatorDigest } = report;
  for (const [name, rows] of Object.entries(groups)) {
    assert.ok(rows.length > 0, `no meshes reached through the ${name} caller`);
    assert.equal(
      rows.filter(Boolean).length,
      rows.length,
      `a ${name} merged geometry lost its uv or normal: ${JSON.stringify(rows)}`,
    );
  }
  assert.deepEqual(errors, [], `console errors: ${errors.join(" | ")}`);
  console.log(
    `PASS merge-parts: hull LOD ${groups.hulls.length}, devastator details ${groups.details.length} (live); ` +
      `consolidate builder ${groups.consolidated.length} (exported, unused, called directly); ` +
      `devastator position/normal/uv digest ${devastatorDigest}; ` +
      "core tarball hash + public preserve behavior; no console errors",
  );
} finally {
  await browser.close();
}
