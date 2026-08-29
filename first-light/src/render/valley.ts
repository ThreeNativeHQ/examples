// Generated-project source. The ridge, the towers and the spur are the game's level design, and
// so is every colour here. The framework contributes the sky radiance and the haze, and neither
// of those knows what a tower is.
import {
  AdditiveBlending,
  BoxGeometry,
  CircleGeometry,
  ConeGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
} from "three";
import { palette } from "./palette.js";

export const SPUR_X = 2.4;
export const RIDGE_HALF_WIDTH = 9;

export interface IValley {
  readonly group: Group;
  readonly spur: Mesh;
  /** The sun disc. The atmosphere creates no light and no sun, so the game draws its own. */
  readonly sun: Mesh;
}

export function createValley(): IValley {
  const group = new Group();
  const rock = new MeshStandardMaterial({ color: palette.floor, roughness: 0.95, metalness: 0.03 });

  const ridge = new Mesh(new BoxGeometry(RIDGE_HALF_WIDTH * 2 + 6, 1, 7), rock);
  ridge.position.set(0, -0.5, 1);
  ridge.receiveShadow = true;
  group.add(ridge);

  // Mountains at kilometre scale, in four ranks. They exist so the atmosphere's aerial
  // perspective has something to act on — without depth there is no haze to see — and they are
  // peaks rather than slabs because a flat wall reads as a colour band, not a distance.
  const haze = new MeshStandardMaterial({ color: palette.shadow, roughness: 1 });
  // Far enough back, and low enough, that the horizon stays visible. The sunrise is the subject;
  // a near rank tall enough to hide it makes the whole game unreadable.
  // Heights are capped by the sun, not by taste. A rank whose angular height exceeds the sun's
  // elevation hides the sunrise, and the sunrise is the entire subject of the game.
  const ranks: readonly (readonly [number, number, number, number])[] = [
    [-1_400, 34, 260, 7],
    [-2_800, 74, 560, 6],
    [-5_200, 132, 1_020, 5],
    [-9_000, 215, 1_950, 4],
  ];
  for (const [z, height, radius, count] of ranks) {
    for (let index = 0; index < count; index += 1) {
      const spread = (index - (count - 1) / 2) / Math.max(1, count - 1);
      const jitter = Math.sin(index * 12.9898 + z) * 0.5 + 0.5;
      const peak = height * (0.62 + jitter * 0.5);
      const mountain = new Mesh(new ConeGeometry(radius * (0.8 + jitter * 0.5), peak, 5), haze);
      mountain.position.set(spread * radius * count * 0.95, peak / 2 - 14, z + jitter * radius);
      mountain.rotation.y = jitter * 1.4;
      group.add(mountain);
    }
  }

  // Three signal towers out in the valley, the things you are signalling to.
  for (const [x, z] of [
    [-46, -190],
    [8, -240],
    [58, -170],
  ] as const) {
    const tower = new Mesh(new ConeGeometry(4.5, 26, 6), rock);
    tower.position.set(x, 1, z);
    group.add(tower);
    const lamp = new Mesh(
      new BoxGeometry(3, 3, 3),
      new MeshStandardMaterial({
        color: palette.accent,
        emissive: palette.accent,
        emissiveIntensity: 1.4,
      }),
    );
    lamp.position.set(x, 15, z);
    group.add(lamp);
  }

  const spur = new Mesh(
    new PlaneGeometry(3.2, 3.2),
    new MeshStandardMaterial({
      color: palette.player,
      emissive: palette.player,
      emissiveIntensity: 0.5,
      roughness: 0.5,
    }),
  );
  spur.rotation.x = -Math.PI / 2;
  spur.position.set(SPUR_X, 0.02, 1.4);
  group.add(spur);

  // The atmosphere hands back radiance and transmittance and deliberately creates no mesh, no
  // material and no light. So the disc is ours: the geometry, the size and the glow are chosen
  // here, and every frame its colour is set from the model's own sun transmittance.
  const sun = new Mesh(
    new CircleGeometry(430, 48),
    new MeshBasicMaterial({
      blending: AdditiveBlending,
      // The sky dome draws after this and is opaque, so a disc that writes no depth is simply
      // painted over. It writes depth and sits inside the dome instead.
      depthWrite: true,
      fog: false,
      toneMapped: false,
      transparent: true,
    }),
  );
  group.add(sun);

  return { group, spur, sun };
}
