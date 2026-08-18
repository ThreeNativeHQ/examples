import { DataTexture, RGBAFormat, UnsignedByteType } from "three";

/**
 * A soft round sprite, built as pixel data rather than by painting a canvas.
 *
 * `CanvasTexture` samples black under `WebGPURenderer` — the generated `AGENTS.md` documents it
 * as a trap and this project hit it — so the smoke and flash sprites are written straight into a
 * `DataTexture`. Flat quads are what made the muzzle smoke read as grey boxes; a radial alpha
 * falloff is the whole difference between a puff and a rectangle.
 *
 * @param size edge length in pixels
 * @param hardness 0 fades from the very centre, 1 keeps a solid core
 */
export function softCircleTexture(size = 64, hardness = 0.25): DataTexture {
  const data = new Uint8Array(size * size * 4);
  const centre = (size - 1) / 2;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const dx = (x - centre) / centre;
      const dy = (y - centre) / centre;
      const distance = Math.sqrt(dx * dx + dy * dy);
      // 1 at the centre, 0 at the rim, with a flat core when hardness is raised.
      const falloff =
        distance >= 1
          ? 0
          : hardness >= 1
            ? 1
            : Math.min(1, (1 - distance) / (1 - hardness)) ** 1.6;
      const index = (y * size + x) * 4;
      data[index] = 255;
      data[index + 1] = 255;
      data[index + 2] = 255;
      data[index + 3] = Math.round(falloff * 255);
    }
  }
  const texture = new DataTexture(data, size, size, RGBAFormat, UnsignedByteType);
  texture.needsUpdate = true;
  return texture;
}
