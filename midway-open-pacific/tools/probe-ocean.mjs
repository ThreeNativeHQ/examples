/** Measure the ocean's real surface statistics on the CPU, as the shader's own WaveField sees it. */
import { WaveField } from "@threenative/core";

const WAVES = [
  [.94, .34, 108, 1.15], [.76, .65, 61, .72], [-.61, .79, 87, .68],
  [.40, -.92, 45, .31], [.42, .91, 34, .38], [-.35, .94, 18, .19],
  [.99, -.12, 9.4, .08], [.70, .71, 4.8, .035],
];
const fields = WAVES.map(([dx, dz, wavelength, amplitude]) => {
  const length = Math.hypot(dx, dz);
  const x = dx / length, z = dz / length, k = 2 * Math.PI / wavelength;
  return new WaveField({
    waves: [{ direction: { x, z }, wavelength, amplitude, speed: Math.sqrt(9.81 * k), detail: true }],
    domainWarp: [{ waveVector: { x: -z * k * .22, z: x * k * .22 }, displacement: { x: x * .85 / k, z: z * .85 / k }, speed: .07 }],
  });
});

let lo = 1e9, hi = -1e9, sum = 0, sum2 = 0, n = 0;
const perField = fields.map(() => ({ lo: 1e9, hi: -1e9 }));
for (let i = 0; i < 240; i++)
  for (let j = 0; j < 240; j++) {
    const x = i * 3.1, z = j * 3.7;
    let h = 0;
    for (const [k, field] of fields.entries()) {
      const s = field.sample(x, z, 12.5).height;
      h += s;
      perField[k].lo = Math.min(perField[k].lo, s);
      perField[k].hi = Math.max(perField[k].hi, s);
    }
    lo = Math.min(lo, h); hi = Math.max(hi, h);
    sum += h; sum2 += h * h; n += 1;
  }
const mean = sum / n;
const sigma = Math.sqrt(sum2 / n - mean * mean);
console.log(`combined: min ${lo.toFixed(3)} max ${hi.toFixed(3)} peak-to-trough ${(hi - lo).toFixed(2)}m`);
console.log(`sigma ${sigma.toFixed(3)}m -> significant wave height Hs = 4*sigma = ${(4 * sigma).toFixed(2)}m`);
for (const [i, p] of perField.entries())
  console.log(`  wave ${String(WAVES[i][2]).padStart(5)}m asked a=${WAVES[i][3]} -> measured ${p.lo.toFixed(3)}..${p.hi.toFixed(3)} (amplitude ${((p.hi - p.lo) / 2).toFixed(3)})`);
