/**
 * Bake the two static artificial-horizon images the cockpit now samples, from the drawing
 * instructions the dial used to run every update.
 *
 * The old `createAttitudeFace` repainted a 256² canvas and marked its `CanvasTexture` dirty on
 * every `CockpitInterior.update`: a full external-image upload per frame for a picture that is one
 * rotation and one vertical shift away from a fixed one. This runs that drawing once, offline, and
 * the dial samples the result with two scalar uniforms instead.
 *
 * Two images, because one of them moves and the other does not:
 *
 *   attitude-moving.png   1024² sky/ground/horizon/pitch ladder, centred at (512,512), drawn at
 *                         the old 256 dial's pixel scale and padded past every coordinate the
 *                         runtime can sample — |p| <= 125 after rotation, plus 1.2 rad * 112 px of
 *                         pitch shift, is 512 +- 260, so full-width sky and ground never run out.
 *   attitude-overlay.png  256² transparent aircraft symbol and top index, in dial space.
 *
 * Run through tools/capture-lock.sh; it launches a browser for the 2-D canvas.
 *   bash tools/capture-lock.sh node tools/bake-attitude.mjs
 */
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright";

const out = join(import.meta.dirname, "..", "public", "assets", "cockpit");

const browser = await chromium.launch({ headless: true, args: ["--ozone-platform=x11"] });
try {
  const page = await browser.newPage();
  const images = await page.evaluate(() => {
    const TAU = Math.PI * 2;
    // The old dial's constants, unchanged: a 256 canvas, R = size/2 - 3, 112 px per radian of
    // pitch and the same 57.2958 degrees-per-radian ladder spacing.
    const DIAL = 256;
    const R = DIAL / 2 - 3;
    const BACK = 1024;
    const draw = (width, height, paint) => {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      paint(ctx);
      return canvas.toDataURL("image/png");
    };

    const moving = draw(BACK, BACK, (ctx) => {
      ctx.translate(BACK / 2, BACK / 2);
      // Sky and ground run the full backing, not the old +-2R: at full roll and full pitch the
      // sampled coordinate reaches 260 px from centre, and a band that stopped at 250 would show
      // the player a blank edge rolling into the dial.
      ctx.fillStyle = "#39628e";
      ctx.fillRect(-BACK, -BACK, 2 * BACK, BACK);
      ctx.fillStyle = "#6d5433";
      ctx.fillRect(-BACK, 0, 2 * BACK, BACK);
      ctx.fillStyle = "#e9e3cd";
      ctx.fillRect(-BACK, -1.5, 2 * BACK, 3);
      ctx.strokeStyle = "#dfe6ea";
      ctx.fillStyle = "#dfe6ea";
      ctx.font = "500 11px monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      for (let d = -30; d <= 30; d += 10) {
        if (d === 0) continue;
        const y = -(d * 112) / 57.2958;
        const w = Math.abs(d) === 10 ? 22 : 34;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(-w, y);
        ctx.lineTo(w, y);
        ctx.stroke();
        ctx.fillText(String(Math.abs(d)), -w - 12, y);
        ctx.fillText(String(Math.abs(d)), w + 12, y);
      }
    });

    const overlay = draw(DIAL, DIAL, (ctx) => {
      ctx.translate(DIAL / 2, DIAL / 2);
      ctx.strokeStyle = "#f0bd49";
      ctx.lineWidth = 3;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      ctx.moveTo(-40, 0);
      ctx.lineTo(-12, 0);
      ctx.lineTo(0, 10);
      ctx.lineTo(12, 0);
      ctx.lineTo(40, 0);
      ctx.stroke();
      ctx.fillStyle = "#f0bd49";
      ctx.beginPath();
      ctx.arc(0, 0, 3, 0, TAU);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(0, -R + 3);
      ctx.lineTo(-6, -R + 14);
      ctx.lineTo(6, -R + 14);
      ctx.closePath();
      ctx.fill();
    });

    // What a person cannot see in a data URL: that the sky is above the horizon, the ground below
    // it, and the overlay is transparent everywhere it did not draw.
    const probe = (url, size) =>
      new Promise((resolve) => {
        const image = new Image();
        image.onload = () => {
          const canvas = document.createElement("canvas");
          canvas.width = size;
          canvas.height = size;
          const ctx = canvas.getContext("2d");
          ctx.drawImage(image, 0, 0);
          const at = (x, y) => [...ctx.getImageData(x, y, 1, 1).data];
          resolve({
            skyBand: at(size / 2, size / 2 - 60),
            groundBand: at(size / 2, size / 2 + 60),
            corner: at(2, 2),
            centre: at(size / 2, size / 2),
          });
        };
        image.src = url;
      });
    return Promise.all([probe(moving, BACK), probe(overlay, DIAL)]).then(([m, o]) => ({
      moving,
      overlay,
      movingProbe: m,
      overlayProbe: o,
    }));
  });

  // Sky is blue above, ground brown below, right out to the padded edge.
  const [sr, sg, sb] = images.movingProbe.skyBand;
  const [gr, gg, gb] = images.movingProbe.groundBand;
  assert.ok(sb > sr && sb > sg, `sky band is blue: ${images.movingProbe.skyBand}`);
  assert.ok(gr > gb && gg > gb, `ground band is earth: ${images.movingProbe.groundBand}`);
  assert.deepEqual(images.movingProbe.corner.slice(3), [255], "the moving face is opaque to its corner");
  assert.equal(images.overlayProbe.corner[3], 0, "the overlay is transparent where it drew nothing");
  assert.ok(images.overlayProbe.centre[3] > 0, "the overlay drew its aircraft symbol");

  for (const [name, url] of [
    ["attitude-moving.png", images.moving],
    ["attitude-overlay.png", images.overlay],
  ]) {
    const bytes = Buffer.from(url.split(",")[1], "base64");
    await writeFile(join(out, name), bytes);
    console.log(`${name}: ${bytes.length} bytes`);
  }
} finally {
  await browser.close();
}
