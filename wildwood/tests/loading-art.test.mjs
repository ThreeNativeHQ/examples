import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";

test("loading foreground reaches the image edge without a horizontal repeat-like seam", async () => {
  const bundled = await build({
    stdin: {
      contents: `import { Scene, OrthographicCamera } from 'three';
        import { createLoadingScreen } from './src/render/loading.ts';
        const scene = new Scene();
        createLoadingScreen({ canvasLayer: {scene, camera:new OrthographicCamera(0,960,540,0), opaque:false},
          renderer: {renderOverlay(){}}, startup: {progress:0.5, whenReady:()=>new Promise(()=>{})} });
        globalThis.loadingCanvas = scene.children.find(o=>o.renderOrder===0).material.map.image;`,
      resolveDir: fileURLToPath(new URL("../", import.meta.url)),
    },
    bundle: true,
    write: false,
    format: "iife",
    platform: "browser",
    plugins:
      process.env.WILDWOOD_LOADING_MUTATION === "in-frame-baseline"
        ? [
            {
              name: "old-foreground-negative-control",
              setup(builder) {
                builder.onLoad({ filter: /\/render\/loading\.ts$/ }, async ({ path }) => {
                  const source = await readFile(path, "utf8");
                  const before = 'forestBand(475, "#09160f", 34, 17, canvas.height + 1)';
                  assert.ok(
                    source.includes(before),
                    "negative control must change the real foreground",
                  );
                  return {
                    contents: source.replace(before, 'forestBand(475, "#09160f", 34, 17)'),
                    loader: "ts",
                  };
                });
              },
            },
          ]
        : [],
  });
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.addScriptTag({ content: bundled.outputFiles[0].text });
    const peak = await page.evaluate(() => {
      const canvas = globalThis.loadingCanvas;
      const { width, height } = canvas;
      const { data } = canvas.getContext("2d").getImageData(0, 0, width, height);
      let peak = 0;
      for (let y = Math.floor(height * 0.85); y < height; y++) {
        let sum = 0,
          count = 0;
        for (let x = 0; x < width; x++) {
          if (x > width * 0.4 && x < width * 0.6) continue; // Exclude the curved trail.
          for (let c = 0; c < 3; c++) {
            sum += Math.abs(data[(y * width + x) * 4 + c] - data[((y - 1) * width + x) * 4 + c]);
            count++;
          }
        }
        peak = Math.max(peak, sum / count);
      }
      return { width, height, peak };
    });
    assert.equal(peak.width, 960);
    assert.equal(peak.height, 540);
    assert.ok(peak.peak < 1, `foreground has a horizontal color jump of ${peak.peak}`);
  } finally {
    await browser.close();
  }
});
