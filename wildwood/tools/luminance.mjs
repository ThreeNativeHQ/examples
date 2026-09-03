/**
 * Luminance quantiles for a capture: `node tools/luminance.mjs <png> [png ...]`
 *
 * A lighting change is the easiest thing in this game to fool yourself about — four separate
 * attempts here picked the wrong cause by eye. Quantiles say what actually moved.
 *
 * Reports on the LINEAR luminance of the sRGB pixels, because a stop is a ratio and a ratio taken
 * on gamma-encoded values is not the ratio anybody means. `p10 -> p90` in stops is the number to
 * read for "does this image have range"; `nearBlack` is the number to read for "did the shadows
 * stop carrying detail". The HUD strip is excluded: it is bright cyan text on a dark panel and it
 * moves both tails on its own.
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
// playwright ships pngjs-compatible decoding nowhere useful, so decode with the platform: sharp is
// not a dependency here, and a PNG decoder is 30 lines via zlib.
const { inflateSync } = require("node:zlib");

function decodePng(buffer) {
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 8;
  let colourType = 6;
  const idat = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colourType = data[9];
    } else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    offset += length + 12;
  }
  if (bitDepth !== 8) throw new Error(`unsupported bit depth ${String(bitDepth)}`);
  const channels = colourType === 6 ? 4 : colourType === 2 ? 3 : 0;
  if (channels === 0) throw new Error(`unsupported colour type ${String(colourType)}`);
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = Buffer.alloc(height * stride);
  let previous = Buffer.alloc(stride);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    const current = Buffer.alloc(stride);
    for (let i = 0; i < stride; i += 1) {
      const a = i >= channels ? current[i - channels] : 0;
      const b = previous[i];
      const c = i >= channels ? previous[i - channels] : 0;
      let value = line[i];
      if (filter === 1) value += a;
      else if (filter === 2) value += b;
      else if (filter === 3) value += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        value += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      current[i] = value & 0xff;
    }
    current.copy(out, y * stride);
    previous = current;
  }
  return { channels, data: out, height, width };
}

const toLinear = (v) => {
  const s = v / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};

for (const file of process.argv.slice(2)) {
  const { channels, data, height, width } = decodePng(readFileSync(file));
  const luminance = [];
  // Skip the bottom 9% (the control strip) and the top 4% (the compass readout).
  const top = Math.floor(height * 0.04);
  const bottom = Math.floor(height * 0.91);
  for (let y = top; y < bottom; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * channels;
      luminance.push(
        0.2126 * toLinear(data[i]) + 0.7152 * toLinear(data[i + 1]) + 0.0722 * toLinear(data[i + 2]),
      );
    }
  }
  luminance.sort((a, b) => a - b);
  const q = (p) => luminance[Math.min(luminance.length - 1, Math.floor(luminance.length * p))];
  const nearBlack = (luminance.filter((v) => v < 0.005).length / luminance.length) * 100;
  const stops = Math.log2(Math.max(q(0.9), 1e-6) / Math.max(q(0.1), 1e-6));
  const mean = luminance.reduce((s, v) => s + v, 0) / luminance.length;
  console.log(
    `${file}\n  p10=${q(0.1).toFixed(4)} p50=${q(0.5).toFixed(4)} p90=${q(0.9).toFixed(4)} mean=${mean.toFixed(4)} nearBlack=${nearBlack.toFixed(2)}% p10->p90=${stops.toFixed(2)} stops`,
  );
}
