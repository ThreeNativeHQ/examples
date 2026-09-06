import { readFile, mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";
import { transform } from "esbuild";
const root = new URL("../", import.meta.url);
const source = await readFile(new URL("src/render/loading.ts", root), "utf8");
const start = source.indexOf("function forestBackdropTexture()");
const end = source.indexOf("\nfunction setFillUv(", start);
if (start < 0 || end < 0) throw new Error("Loading artwork source was not found");
const { code } = await transform(source.slice(start, end), { loader: "ts" });
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  const dataUrl = await page.evaluate((code) => {
    class CanvasTexture {
      constructor(image) {
        this.image = image;
      }
    }
    const configureTexture = () => {};
    const forestPixelTexture = () => {
      throw new Error("Full Canvas 2D support is required for baking");
    };
    return eval(code + '\nforestBackdropTexture().image.toDataURL("image/png")');
  }, code);
  await mkdir(new URL("assets/loading/", root), { recursive: true });
  await writeFile(
    new URL("assets/loading/forest.png", root),
    Buffer.from(dataUrl.split(",")[1], "base64"),
  );
  console.log("Baked loading artwork: assets/loading/forest.png (960x540)");
} finally {
  await browser.close();
}
