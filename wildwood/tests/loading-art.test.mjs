import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { test } from "node:test";
import { build } from "esbuild";
import { Scene, OrthographicCamera, Texture } from "three";
import { texturePass } from "@threenative/assets";
test("the configured asset pass preserves loading artwork pixels verbatim", async () => {
  const directory = await mkdtemp(new URL(".loading-", import.meta.url).pathname);
  try {
    await build({
      entryPoints: [new URL("../threenative.config.ts", import.meta.url).pathname],
      outfile: directory + "/config.mjs",
      bundle: true,
      platform: "node",
      format: "esm",
      packages: "external",
    });
    const { default: config } = await import(directory + "/config.mjs");
    const png = await readFile(new URL("../assets/loading/forest.png", import.meta.url));
    const cooked = await texturePass(config.assets.textures).apply(png, "loading/forest.png");
    assert.ok(Buffer.isBuffer(cooked), "loading art must retain its source container");
    assert.deepEqual(cooked, png, "loading art must retain its source pixels");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
test("loading artwork is an asset compiler input, not an unlisted public file", async () => {
  const png = await readFile(new URL("../assets/loading/forest.png", import.meta.url));
  assert.equal(png.subarray(1, 4).toString(), "PNG");
  assert.equal(png.readUInt32BE(16), 960);
  assert.equal(png.readUInt32BE(20), 540);
});
test("native loading requests the same baked artwork and applies it to the backdrop", async () => {
  const directory = await mkdtemp(new URL(".loading-", import.meta.url).pathname);
  let controller;
  try {
    await build({
      entryPoints: [new URL("../src/render/loading.ts", import.meta.url).pathname],
      outfile: directory + "/loading.mjs",
      bundle: true,
      platform: "node",
      format: "esm",
      packages: "external",
    });
    const { createLoadingScreen } = await import(directory + "/loading.mjs");
    const requested = [];
    const texture = new Texture({ width: 960, height: 540 });
    const scene = new Scene();
    controller = createLoadingScreen({
      assets: {
        texture: async (path) => {
          requested.push(path);
          return texture;
        },
      },
      canvasLayer: { scene, camera: new OrthographicCamera(0, 1280, 720, 0), opaque: false },
      renderer: { renderOverlay() {} },
      startup: { progress: 0.5, whenReady: () => new Promise(() => {}) },
    });
    await Promise.resolve();
    assert.deepEqual(requested, ["loading/forest.png"]);
    assert.equal(scene.children.find((child) => child.renderOrder === 0).material.map, texture);
  } finally {
    controller?.finish();
    await rm(directory, { recursive: true, force: true });
  }
});
