import { InstancedMesh, MathUtils, Matrix4, MeshBasicMaterial, PlaneGeometry } from "three";
import type { PerspectiveCamera } from "three";
import { palette } from "./palette.js";

const CHARS = "0123456789:ACEHIMNORST";
const GLYPHS =
  "7e33ae63f 3884210c4 7c21fc21f 7e10f421f 4210fc631 7e10f843 7e31f843 8422221f 7e31fc63f 7e10fc63f 8401080 4631fc62e 7c210843f 7c217843f 4631fc631 7c842109f 4631ad771 4631cd671 3a318c62e 45257c62f 7e10f843f 10842109f"
    .split(" ")
    .map((hex) => BigInt(`0x${hex}`));

function glyph(rows: readonly string[]): bigint {
  let value = 0n;
  for (let row = 0; row < rows.length; row += 1) {
    for (let column = 0; column < 5; column += 1) {
      if (rows[row]?.[column] === "#") value |= 1n << BigInt(row * 5 + column);
    }
  }
  return value;
}

const EXTRA_GLYPHS = new Map([
  ["B", glyph(["11110", "10001", "10001", "11110", "10001", "10001", "11110"])],
  ["D", glyph(["11110", "10001", "10001", "10001", "10001", "10001", "11110"])],
  ["G", glyph(["01110", "10001", "10000", "10111", "10001", "10001", "01110"])],
  ["L", glyph(["10000", "10000", "10000", "10000", "10000", "10000", "11111"])],
  ["Y", glyph(["10001", "10001", "01010", "00100", "00100", "00100", "00100"])],
]);

type HudValues = { counter?: number; primary: number; seconds: number; status?: string };

function formatHudText(primaryLabel: string, counterLabel: string | undefined, values: HudValues) {
  const minutes = String(Math.floor(values.seconds / 60)).padStart(2, "0");
  const seconds = String(Math.floor(values.seconds % 60)).padStart(2, "0");
  const lines = [
    `NET ${(values.status ?? "disabled").toUpperCase()}`,
    `${primaryLabel} ${Math.max(0, Math.round(values.primary))}`,
  ];
  if (counterLabel !== undefined && values.counter !== undefined)
    lines.push(`${counterLabel} ${Math.max(0, Math.round(values.counter))}`);
  lines.push(`TIME ${minutes}:${seconds}`);
  return lines.join("\n");
}

export function createHud(camera: PerspectiveCamera, primaryLabel: string, counterLabel?: string) {
  const material = new MeshBasicMaterial({
    color: palette.player,
    depthTest: false,
    depthWrite: false,
  });
  const root = new InstancedMesh(new PlaneGeometry(0.82, 0.82), material, 2_048);
  const matrix = new Matrix4();
  root.frustumCulled = false;
  root.renderOrder = 10_000;
  camera.add(root);
  return {
    glyphs: 0,
    update(values: HudValues): void {
      // The HUD changes at most once a second, but update runs per frame — skip the glyph
      // rebuild and the instance upload when the text is unchanged. Placement still recomputes:
      // a resize moves the anchor even when the text has not changed.
      const text = formatHudText(primaryLabel, counterLabel, values);
      const height = 2 * Math.tan(MathUtils.degToRad(camera.fov / 2));
      root.position.set(-height * camera.aspect * 0.46, height * 0.42, -1);
      root.scale.setScalar(height / 160);
      if (text === this.lastText) return;
      this.lastText = text;
      let instance = 0;
      for (const [y, line] of text.split("\n").entries()) {
        for (let x = 0; x < line.length; x += 1) {
          const character = line[x] ?? " ";
          const glyph = GLYPHS[CHARS.indexOf(character)] ?? EXTRA_GLYPHS.get(character);
          if (glyph === undefined) continue;
          for (let pixel = 0; pixel < 35; pixel += 1) {
            if ((glyph & (1n << BigInt(pixel))) === 0n) continue;
            matrix.makeTranslation(x * 6 + (pixel % 5), -y * 10 - Math.floor(pixel / 5), 0);
            root.setMatrixAt(instance, matrix);
            instance += 1;
          }
        }
      }
      root.count = this.glyphs = instance;
      root.instanceMatrix.needsUpdate = true;
    },
    lastText: "",
    dispose(): void {
      root.removeFromParent();
      root.geometry.dispose();
      material.dispose();
    },
  };
}
