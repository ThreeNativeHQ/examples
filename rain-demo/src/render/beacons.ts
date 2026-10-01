// The Storm Chaser waypoint markers: a tall pillar of light at each waypoint, so the next one reads
// through rain and haze. Ordinary Three.js; the scene turns each pillar toward the camera with the
// engine's Billboard3D and decides which one is lit.
import {
  AdditiveBlending,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  type Scene,
} from "three";
import { palette } from "./palette.js";

const HEIGHT = 22;
const WIDTH = 1.6;
/** The next waypoint burns bright; the later ones are a faint promise down the road. */
const NEXT_OPACITY = 0.32;
const LATER_OPACITY = 0.1;

export interface IBeacons {
  readonly pillars: readonly Mesh[];
  /** Light the waypoint `next`, dim the later ones, hide the reached ones (or all, when `active` is false). */
  show(next: number, active: boolean): void;
  dispose(): void;
}

export function createBeacons(
  scene: Scene,
  waypoints: readonly { readonly x: number; readonly z: number }[],
): IBeacons {
  // Three columns of vertices so the beam is bright down its middle and gone at its edges, and
  // fades out towards the top: with additive blending, a dark vertex is a transparent one.
  const geometry = new PlaneGeometry(WIDTH, HEIGHT, 2, 1);
  const position = geometry.getAttribute("position");
  const shade: number[] = [];
  for (let index = 0; index < position.count; index += 1) {
    const centre = Math.abs(position.getX(index)) < 1e-6 ? 1 : 0;
    const base = position.getY(index) < 0 ? 1 : 0.12;
    shade.push(centre * base, centre * base, centre * base);
  }
  geometry.setAttribute("color", new Float32BufferAttribute(shade, 3));
  // Its base at the ground, so the pillar stands on the road rather than floating through it.
  geometry.translate(0, HEIGHT / 2, 0);
  const pillars = waypoints.map(({ x, z }) => {
    const material = new MeshBasicMaterial({
      blending: AdditiveBlending,
      color: new Color(palette.accent),
      depthWrite: false,
      side: DoubleSide,
      transparent: true,
      vertexColors: true,
    });
    const pillar = new Mesh(geometry, material);
    pillar.position.set(x, 0, z);
    pillar.renderOrder = 2;
    scene.add(pillar);
    return pillar;
  });
  return {
    pillars,
    show(next, active) {
      pillars.forEach((pillar, index) => {
        pillar.visible = active && index >= next;
        (pillar.material as MeshBasicMaterial).opacity = index === next ? NEXT_OPACITY : LATER_OPACITY;
      });
    },
    dispose() {
      for (const pillar of pillars) {
        scene.remove(pillar);
        (pillar.material as MeshBasicMaterial).dispose();
      }
      geometry.dispose();
    },
  };
}
