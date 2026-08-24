/**
 * What does an equirect's resolution cost in image-based-light memory?
 *
 * PRD-213's sky split rests on one claim: three.js sizes the PMREM cubeUV render targets from the
 * *source equirect's width*, so feeding the image-based light a smaller copy of the same sky is a
 * straight memory saving with no change to the background the player sees. This proves that claim
 * by running the real `PMREMGenerator` from the game's own installed three.js against equirects of
 * several widths, on a real GPU, and reporting the bytes each one asks `createTexture` for — with
 * the same arithmetic `packages/runtime-native/src/webgpu/bindings.cpp` uses on device.
 *
 * It is deliberately independent of the game: it builds its own scene, so it keeps working while
 * another lane is editing the sandbox tree, and it isolates the sky variable from everything else.
 *
 * Lane: desktop Chrome, real WebGPU adapter. Never quote its output as an Android result.
 *
 *   node tools/pmrem-size-probe.mjs [--port 4181]
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const WEBGPU_BROWSER_ARGS = [
  "--ozone-platform=x11",
  "--enable-unsafe-webgpu",
  "--disable-gpu-sandbox",
  "--ignore-gpu-blocklist",
  "--enable-features=Vulkan",
];

const flag = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : process.argv[index + 1];
};
const port = Number(flag("port", "4181"));
const widths = (flag("widths", "3072,2048,1024,512") ?? "").split(",").map(Number);

const threeRoot = path.join(process.cwd(), "node_modules", "three");

const page = `<!doctype html><meta charset="utf-8"><title>pmrem</title>
<script type="importmap">
{"imports":{"three/webgpu":"/three/build/three.webgpu.js","three/tsl":"/three/build/three.tsl.js","three":"/three/build/three.module.js"}}
</script>
<canvas id="c" width="256" height="256"></canvas>
<script type="module">
import * as THREE from "three/webgpu";
window.THREE = THREE;
window.ready = (async () => {
  const renderer = new THREE.WebGPURenderer({ canvas: document.getElementById("c"), antialias: false });
  await renderer.init();
  window.renderer = renderer;
  return true;
})();
window.measure = async (width) => {
  const height = width / 2;
  // A real image, not a blank one: PMREM's blur passes are resolution-driven, not content-driven,
  // but a flat texture would let a future optimisation elide work and quietly change the answer.
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    data[i * 4] = (i * 7) & 255;
    data[i * 4 + 1] = (i * 13) & 255;
    data[i * 4 + 2] = (i * 29) & 255;
    data[i * 4 + 3] = 255;
  }
  const texture = new THREE.DataTexture(data, width, height, THREE.RGBAFormat);
  texture.mapping = THREE.EquirectangularReflectionMapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  globalThis.__tnGpuRequest.mark();
  const generator = new THREE.PMREMGenerator(window.renderer);
  const target = generator.fromEquirectangular(texture);
  await window.renderer.renderAsync(new THREE.Scene(), new THREE.PerspectiveCamera());
  const delta = globalThis.__tnGpuRequest.sinceMark();
  generator.dispose();
  target.dispose();
  texture.dispose();
  return { width, cubeUvTarget: { width: target.width, height: target.height }, ...delta };
};
</script>`;

const server = createServer(async (request, response) => {
  try {
    if (request.url === "/" || request.url === "/index.html") {
      response.writeHead(200, { "content-type": "text/html" });
      response.end(page);
      return;
    }
    if (request.url?.startsWith("/three/")) {
      const file = path.join(threeRoot, request.url.slice("/three/".length));
      if (!file.startsWith(threeRoot)) throw new Error("escape");
      response.writeHead(200, { "content-type": "text/javascript" });
      response.end(await readFile(file));
      return;
    }
    response.writeHead(404).end();
  } catch (error) {
    response.writeHead(500).end(String(error));
  }
});
await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));

const probe = `(${String(function install() {
  const state = { buckets: new Map(), bytes: 0, count: 0, markBytes: 0, markCount: 0, markBuckets: new Map() };
  state.mark = () => {
    state.markBytes = state.bytes;
    state.markCount = state.count;
    state.markBuckets = new Map(state.buckets);
  };
  state.sinceMark = () => {
    const created = [];
    for (const [key, bucket] of state.buckets) {
      const before = state.markBuckets.get(key);
      const n = bucket.n - (before?.n ?? 0);
      const bytes = bucket.bytes - (before?.bytes ?? 0);
      if (n > 0) created.push({ k: key, n, mb: +(bytes / 1048576).toFixed(2) });
    }
    created.sort((a, b) => b.mb - a.mb);
    return {
      mb: +((state.bytes - state.markBytes) / 1048576).toFixed(2),
      textures: state.count - state.markCount,
      created,
    };
  };
  globalThis.__tnGpuRequest = state;
  const perTexel = (format) => {
    if (/32(float|uint|sint)/.test(format)) return format.startsWith("rgba") ? 16 : format.startsWith("rg") ? 8 : 4;
    if (/16(float|uint|sint|unorm)/.test(format)) return format.startsWith("rgba") ? 8 : format.startsWith("rg") ? 4 : 2;
    if (format.startsWith("depth32float")) return format.includes("stencil") ? 5 : 4;
    if (format.startsWith("depth24")) return 4;
    if (format.startsWith("depth16")) return 2;
    if (format.startsWith("rg8")) return 2;
    if (format.startsWith("r8")) return 1;
    return 4;
  };
  const wrap = () => {
    if (typeof GPUDevice === "undefined" || GPUDevice.prototype.__tnWrapped) return true;
    GPUDevice.prototype.__tnWrapped = true;
    const createTexture = GPUDevice.prototype.createTexture;
    GPUDevice.prototype.createTexture = function (descriptor) {
      const size = descriptor.size;
      const width = Array.isArray(size) ? (size[0] ?? 1) : (size.width ?? 1);
      const height = Array.isArray(size) ? (size[1] ?? 1) : (size.height ?? 1);
      const layers = Array.isArray(size) ? (size[2] ?? 1) : (size.depthOrArrayLayers ?? 1);
      const mips = Math.max(1, descriptor.mipLevelCount ?? 1);
      const samples = Math.max(1, descriptor.sampleCount ?? 1);
      const format = String(descriptor.format);
      let texels = 0;
      for (let level = 0; level < mips; level += 1) {
        texels += Math.max(1, Math.floor(width / 2 ** level)) * Math.max(1, Math.floor(height / 2 ** level));
      }
      const bytes = Math.round(texels * Math.max(1, layers) * samples * perTexel(format));
      let key = width + "x" + height;
      if (layers > 1) key += "x" + layers;
      key += " " + format;
      if (mips > 1) key += " mips" + mips;
      if (samples > 1) key += " msaa" + samples;
      const bucket = state.buckets.get(key) ?? { n: 0, bytes: 0 };
      bucket.n += 1;
      bucket.bytes += bytes;
      state.buckets.set(key, bucket);
      state.bytes += bytes;
      state.count += 1;
      return createTexture.call(this, descriptor);
    };
    return true;
  };
  if (!wrap()) {
    const timer = setInterval(() => {
      if (wrap()) clearInterval(timer);
    }, 5);
  }
})})()`;

const browser = await chromium.launch({ headless: false, args: WEBGPU_BROWSER_ARGS });
const tab = await browser.newPage();
await tab.addInitScript(probe);
tab.on("pageerror", (error) => console.error("PAGE ERROR", error.message));
await tab.goto(`http://127.0.0.1:${port}/`, { waitUntil: "domcontentloaded" });

const adapter = await tab.evaluate(async () => {
  const info = (await navigator.gpu?.requestAdapter())?.info;
  return info === undefined
    ? undefined
    : { vendor: info.vendor, architecture: info.architecture, device: info.device, description: info.description };
});
if (adapter === undefined) throw new Error("no WebGPU adapter");
if (/swiftshader|llvmpipe|lavapipe|software/i.test(JSON.stringify(adapter))) {
  throw new Error(`software adapter refused: ${JSON.stringify(adapter)}`);
}
await tab.waitForFunction(() => globalThis.__tnGpuRequest !== undefined && globalThis.measure !== undefined);
await tab.evaluate(() => window.ready);

const rows = [];
for (const width of widths) {
  rows.push(await tab.evaluate((w) => window.measure(w), width));
}
console.log(`TN_PMREM_SIZE_BROWSER:${JSON.stringify({ adapter, rows }, undefined, 2)}`);

await browser.close();
server.close();
process.exit(0);
