/**
 * Browser-lane mirror of the runtime's `TN_GPU_TEXTURES` / `TN_GPU_BUFFERS` markers.
 *
 * The native markers live in `packages/runtime-native/src/webgpu/bindings.cpp`
 * (`recordTextureCreated` / `recordBufferCreated`, commit d6e21511) and only exist on a device.
 * This wraps `GPUDevice.prototype.createTexture` / `createBuffer` in real Chrome and applies the
 * *same* arithmetic, so a change to what the game asks the GPU for can be measured without a
 * phone. It measures the request, not what a driver then holds — those are different numbers and
 * the whole point of PRD-213 is that they differ by more than 2x on Mali.
 *
 * Lane: desktop Chrome / real WebGPU adapter. Never quote its output as an Android result.
 *
 *   node tools/gpu-request-probe.mjs [--port 4179] [--frames 600] [--label before]
 */
import { spawn } from "node:child_process";
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

const port = Number(flag("port", "4179"));
const settleMs = Number(flag("settle", "25000"));
const label = flag("label", "run");

/** Mirror of `textureBytesPerTexel` in bindings.cpp. Unknown formats report 4, never a guess. */
function bytesPerTexel(format) {
  if (/^(bc|etc2|astc|eac)/.test(format)) {
    if (format.includes("rgba8unorm") || format.includes("bc3") || format.includes("bc7") || format.includes("astc-4x4")) return 1;
    return 0.5;
  }
  if (/32(float|uint|sint)/.test(format)) {
    if (format.startsWith("rgba")) return 16;
    if (format.startsWith("rg")) return 8;
    return 4;
  }
  if (/16(float|uint|sint|unorm)/.test(format)) {
    if (format.startsWith("rgba")) return 8;
    if (format.startsWith("rg")) return 4;
    return 2;
  }
  if (format.startsWith("depth32float")) return format.includes("stencil") ? 5 : 4;
  if (format.startsWith("depth24")) return 4;
  if (format.startsWith("depth16")) return 2;
  if (format.startsWith("rg8")) return 2;
  if (format.startsWith("r8")) return 1;
  if (format.startsWith("rgb10a2") || format.startsWith("rg11b10")) return 4;
  return 4;
}

const probeSource = `(${String(function install(bytesPerTexelSource) {
  const bytesPerTexel = eval(`(${bytesPerTexelSource})`);
  const state = { textures: new Map(), buffers: new Map(), textureBytes: 0, bufferBytes: 0, textureCount: 0, bufferCount: 0, errors: [] };
  globalThis.__tnGpuRequest = state;
  const wrap = () => {
    if (typeof GPUDevice === "undefined" || GPUDevice.prototype.__tnWrapped) return;
    GPUDevice.prototype.__tnWrapped = true;
    const createTexture = GPUDevice.prototype.createTexture;
    GPUDevice.prototype.createTexture = function (descriptor) {
      try {
        const size = descriptor.size;
        const width = Array.isArray(size) ? (size[0] ?? 1) : (size.width ?? 1);
        const height = Array.isArray(size) ? (size[1] ?? 1) : (size.height ?? 1);
        const layers = Array.isArray(size) ? (size[2] ?? 1) : (size.depthOrArrayLayers ?? 1);
        const mips = descriptor.mipLevelCount ?? 1;
        const samples = descriptor.sampleCount ?? 1;
        const format = String(descriptor.format);
        let texels = 0;
        for (let level = 0; level < Math.max(1, mips); level += 1) {
          texels += Math.max(1, Math.floor(width / 2 ** level)) * Math.max(1, Math.floor(height / 2 ** level));
        }
        const bytes = Math.round(texels * Math.max(1, layers) * Math.max(1, samples) * bytesPerTexel(format));
        let key = width + "x" + height;
        if (layers > 1) key += "x" + layers;
        key += " " + format;
        if (mips > 1) key += " mips" + mips;
        if (samples > 1) key += " msaa" + samples;
        const bucket = state.textures.get(key) ?? { n: 0, bytes: 0 };
        bucket.n += 1;
        bucket.bytes += bytes;
        state.textures.set(key, bucket);
        state.textureBytes += bytes;
        state.textureCount += 1;
      } catch (error) {
        state.errors.push(`texture: ${String(error)}`);
      }
      return createTexture.call(this, descriptor);
    };
    const createBuffer = GPUDevice.prototype.createBuffer;
    GPUDevice.prototype.createBuffer = function (descriptor) {
      try {
        const usage = descriptor.usage ?? 0;
        const names = [];
        if (usage & GPUBufferUsage.VERTEX) names.push("vertex");
        if (usage & GPUBufferUsage.INDEX) names.push("index");
        if (usage & GPUBufferUsage.UNIFORM) names.push("uniform");
        if (usage & GPUBufferUsage.STORAGE) names.push("storage");
        if (usage & GPUBufferUsage.INDIRECT) names.push("indirect");
        if (usage & GPUBufferUsage.COPY_SRC) names.push("copysrc");
        if (usage & GPUBufferUsage.COPY_DST) names.push("copydst");
        if (usage & GPUBufferUsage.MAP_READ) names.push("mapread");
        if (usage & GPUBufferUsage.MAP_WRITE) names.push("mapwrite");
        const key = names.length === 0 ? "other" : names.join("|");
        const bucket = state.buffers.get(key) ?? { n: 0, bytes: 0 };
        bucket.n += 1;
        bucket.bytes += descriptor.size ?? 0;
        state.buffers.set(key, bucket);
        state.bufferBytes += descriptor.size ?? 0;
        state.bufferCount += 1;
      } catch (error) {
        state.errors.push(`buffer: ${String(error)}`);
      }
      return createBuffer.call(this, descriptor);
    };
  };
  wrap();
  const timer = setInterval(() => {
    wrap();
    if (GPUDevice.prototype.__tnWrapped) clearInterval(timer);
  }, 5);
})})(${JSON.stringify(String(bytesPerTexel))})`;

const server = spawn("pnpm", ["dev", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
  cwd: process.cwd(),
  stdio: ["ignore", "pipe", "pipe"],
});
const stop = () => {
  server.kill("SIGTERM");
};
process.on("exit", stop);

await new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error("vite did not start")), 60_000);
  server.stdout.on("data", (chunk) => {
    // Vite colours its banner, so the port is not contiguous in the raw bytes: strip the escapes.
    const text = String(chunk).replaceAll(/\u001B\[[0-9;]*m/gu, "");
    if (text.includes(`:${port}`) || text.includes("ready in")) {
      clearTimeout(timeout);
      resolve();
    }
  });
  server.stderr.on("data", (chunk) => process.stderr.write(chunk));
});

const browser = await chromium.launch({ headless: false, args: WEBGPU_BROWSER_ARGS });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.addInitScript(probeSource);
const logs = [];
page.on("console", (message) => {
  const text = message.text();
  if (text.startsWith("TN_")) logs.push(text);
});
// Vite prints its banner a beat before the socket accepts, and the first navigation can abort.
let navigated = false;
for (let attempt = 0; attempt < 10 && !navigated; attempt += 1) {
  try {
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "domcontentloaded", timeout: 20_000 });
    navigated = true;
  } catch (error) {
    if (attempt === 9) throw error;
    await page.waitForTimeout(1000);
  }
}

const adapter = await page.evaluate(async () => {
  const gpuAdapter = await navigator.gpu?.requestAdapter();
  const info = gpuAdapter?.info;
  if (info === undefined) return undefined;
  // GPUAdapterInfo's fields are prototype getters: a spread returns {} and any guard over it
  // passes vacuously. Name them.
  return {
    vendor: info.vendor,
    architecture: info.architecture,
    device: info.device,
    description: info.description,
  };
});
if (adapter === undefined) throw new Error("no WebGPU adapter: this run would not be a real GPU measurement");
const adapterText = JSON.stringify(adapter);
if (/swiftshader|llvmpipe|lavapipe|software/i.test(adapterText)) {
  throw new Error(`software adapter refused: ${adapterText}`);
}

await page.waitForTimeout(settleMs);

const installed = await page.evaluate(() => globalThis.__tnGpuRequest !== undefined);
if (!installed) throw new Error("probe was not installed in the page: refusing to report zeros");

const result = await page.evaluate(() => {
  const state = globalThis.__tnGpuRequest;
  const sort = (map) =>
    [...map.entries()]
      .sort((a, b) => b[1].bytes - a[1].bytes)
      .map(([k, v]) => ({ k, n: v.n, mb: +(v.bytes / 1048576).toFixed(1) }));
  return {
    textureMB: +(state.textureBytes / 1048576).toFixed(1),
    textures: state.textureCount,
    bufferMB: +(state.bufferBytes / 1048576).toFixed(1),
    buffers: state.bufferCount,
    textureBuckets: sort(state.textures).slice(0, 14),
    bufferBuckets: sort(state.buffers),
    wrapped: GPUDevice.prototype.__tnWrapped === true,
    errors: state.errors.slice(0, 3),
  };
});

console.log(`TN_GPU_REQUEST_BROWSER[${label}]:${JSON.stringify({ adapter, ...result })}`);
for (const line of logs.slice(-4)) console.log(line);

await browser.close();
stop();
process.exit(0);
