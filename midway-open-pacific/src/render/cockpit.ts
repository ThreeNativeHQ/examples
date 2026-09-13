/** Functional cockpit instrument texture; values come from the live flight state. */
import * as T from "three";
import { box, canvasTexture, mat, rod } from "./assets.js";
import { clamp } from "../sim/math.js";

export function makeInstrumentPanel(root: T.Object3D): any {
  const texture = canvasTexture(1024, 512, () => {});
  const canvas = texture.image as HTMLCanvasElement;
  const context = canvas.getContext("2d") as CanvasRenderingContext2D;
  box(root, 1.0, 0.4, 0.09, 0, 0.88, -1.56, mat(0x182521, { roughness: 0.96 }));
  const panel = new T.Mesh(
    new T.PlaneGeometry(0.965, 0.375),
    new T.MeshStandardMaterial({ map: texture, roughness: 0.78, metalness: 0.2, emissive: 0xa2b298, emissiveMap: texture, emissiveIntensity: 0.19 }),
  );
  panel.position.set(0, 0.88, -1.507);
  root.add(panel);
  box(root, 0.85, 0.12, 1.7, 0, 0.69, -0.5, mat(0x27352e, { roughness: 0.96 }));
  for (const side of [-1, 1]) {
    box(root, 0.14, 0.1, 0.75, side * 0.4, 0.56, -0.54, mat(0x485743));
    rod(root, [side * 0.38, 0.57, -0.66], [side * 0.38, 0.7, -0.73], 0.018, mat(0x161b1b));
  }
  const sight = new T.Group();
  sight.position.set(0, 1.135, -1.71);
  const ring = new T.Mesh(new T.TorusGeometry(0.062, 0.0023, 4, 40), new T.MeshBasicMaterial({ color: 0xccba84, transparent: true, opacity: 0.6 }));
  sight.add(ring);
  rod(sight, [-0.083, 0, 0], [0.083, 0, 0], 0.0015, mat(0xdbc491));
  rod(sight, [0, -0.083, 0], [0, 0.083, 0], 0.0015, mat(0xdbc491));
  root.add(sight);
  const state: any = { texture, canvas, context, panel, tick: -1 };
  updateInstrumentPanel(state, { ias: 0, y: 22, rpm: 0, vy: 0, fuel: 100, roll: 0, pitch: 0.2, flightTime: 0 });
  return state;
}

function dial(c: CanvasRenderingContext2D, x: number, y: number, r: number, label: string, value: number, max: number, unit: string, readout?: number): void {
  c.save();
  c.translate(x, y);
  c.fillStyle = "#090f10";
  c.strokeStyle = "#69756b";
  c.lineWidth = 4;
  c.beginPath();
  c.arc(0, 0, r, 0, Math.PI * 2);
  c.fill();
  c.stroke();
  c.strokeStyle = "#172521";
  c.lineWidth = 5;
  c.beginPath();
  c.arc(0, 0, r - 6, 0, Math.PI * 2);
  c.stroke();
  for (let i = 0; i <= 40; i += 1) {
    const a = -Math.PI * 0.78 + (i / 40) * Math.PI * 1.56;
    const rr = r - 15;
    c.strokeStyle = i % 5 ? "#909e8f" : "#d4dfc0";
    c.lineWidth = i % 5 ? 1.5 : 3;
    c.beginPath();
    c.moveTo(Math.sin(a) * (rr - (i % 5 ? 5 : 11)), -Math.cos(a) * (rr - (i % 5 ? 5 : 11)));
    c.lineTo(Math.sin(a) * rr, -Math.cos(a) * rr);
    c.stroke();
    if (i % 10 === 0) {
      c.font = "13px monospace";
      c.textAlign = "center";
      c.fillStyle = "#bdcbae";
      c.fillText(String(Math.round((i / 40) * max)), Math.sin(a) * (r - 33), -Math.cos(a) * (r - 33) + 5);
    }
  }
  c.fillStyle = "#c5d3b7";
  c.font = "bold 14px monospace";
  c.textAlign = "center";
  c.fillText(label, 0, -20);
  c.font = "10px monospace";
  c.fillStyle = "#8ea18b";
  c.fillText(unit, 0, -5);
  const a = -Math.PI * 0.78 + clamp(value / max, 0, 1) * Math.PI * 1.56;
  c.save();
  c.rotate(a);
  c.fillStyle = "#efe9cd";
  c.beginPath();
  c.moveTo(-3, 10);
  c.lineTo(-2, -r + 19);
  c.lineTo(2, -r + 19);
  c.lineTo(3, 10);
  c.fill();
  c.restore();
  c.fillStyle = "#bfa86f";
  c.beginPath();
  c.arc(0, 0, 5, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = "#101b16";
  c.fillRect(-35, 24, 70, 19);
  c.fillStyle = "#d2d9c0";
  c.font = "13px monospace";
  c.fillText(String(readout ?? Math.round(value)), 0, 39);
  c.restore();
}

export function updateInstrumentPanel(s: any, p: any): void {
  const t = p.flightTime || 0;
  if (Math.abs(t - s.tick) < 0.08) return;
  s.tick = t;
  const c = s.context;
  c.fillStyle = "#26332e";
  c.fillRect(0, 0, 1024, 512);
  c.fillStyle = "#91a184";
  c.font = "14px monospace";
  c.fillText("U.S. NAVY   /   FLIGHT INSTRUMENTS", 40, 27);
  c.fillText(p.airframe === "tbd" ? "TBD-1" : "SBD-3", 900, 27);
  dial(c, 165, 163, 111, "AIRSPEED", (p.ias || 0) * 1.94384, 260, "KNOTS");
  dial(c, 440, 163, 111, "ALTIMETER", (p.y * 3.28084) % 10000, 10000, "FEET", Math.round(p.y * 3.28084));
  dial(c, 715, 163, 111, "ENGINE", (p.rpm || 0) * 2600, 3000, "RPM");
  dial(c, 165, 389, 96, "FUEL", p.fuel, 100, "PERCENT");
  dial(c, 440, 389, 96, "CLIMB", (p.vy || 0) * 196.85 + 3000, 6000, "FT / MIN", Math.round((p.vy || 0) * 196.85));
  dial(c, 715, 389, 96, "OIL", Math.max(0, (p.rpm || 0) * 90 * (p.damage?.engine.integrity ?? 1)), 100, "PSI");
  c.save();
  c.translate(929, 195);
  c.fillStyle = "#121d1a";
  c.beginPath();
  c.arc(0, 0, 61, 0, Math.PI * 2);
  c.fill();
  c.save();
  c.beginPath();
  c.arc(0, 0, 55, 0, Math.PI * 2);
  c.clip();
  c.rotate(-(p.roll || 0));
  const shift = clamp((p.pitch || 0) * 70, -50, 50);
  c.fillStyle = "#647f88";
  c.fillRect(-90, -100 + shift, 180, 100);
  c.fillStyle = "#706048";
  c.fillRect(-90, shift, 180, 110);
  c.strokeStyle = "#d1d6bb";
  c.lineWidth = 2;
  c.beginPath();
  c.moveTo(-60, shift);
  c.lineTo(60, shift);
  c.stroke();
  c.restore();
  c.strokeStyle = "#dec38e";
  c.lineWidth = 3;
  c.beginPath();
  c.moveTo(-36, 0);
  c.lineTo(-8, 0);
  c.lineTo(0, 7);
  c.lineTo(8, 0);
  c.lineTo(36, 0);
  c.stroke();
  c.restore();
  c.font = "12px monospace";
  c.fillStyle = "#b8c8ab";
  c.fillText("ATTITUDE", 887, 280);
  c.fillText("GENERATOR", 878, 359);
  c.fillStyle = p.engineCut ? "#9e3325" : "#658a51";
  c.beginPath();
  c.arc(921, 383, 8, 0, 6.28);
  c.fill();
  c.fillStyle = "#8a947d";
  for (const [x, y] of [
    [21, 20],
    [1003, 20],
    [21, 492],
    [1003, 492],
    [865, 475],
  ]) {
    c.beginPath();
    c.arc(x, y, 4, 0, 6.28);
    c.fill();
  }
  s.texture.needsUpdate = true;
}
