// Generated-project source. Every appearance decision below is the game's: the beacon shape, the
// palette, the nameplate size, the flame atlas and each frame's duration. The framework supplies
// only Billboard3D (face the camera) and SpriteAnimator3D (advance an atlas on the fixed step).
import { Billboard3D, SpriteAnimator3D } from "@threenative/core";
import {
  BoxGeometry,
  type Camera,
  DataTexture,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  NearestFilter,
  PlaneGeometry,
  RGBAFormat,
  SRGBColorSpace,
} from "three";
import { palette } from "./palette.js";

const FLAME_FRAME_SIZE = 16;
const FLAME_FRAMES = 4;
const BEACON_POSITIONS = [
  [-4.2, 0, -1.6],
  [0, 0, -3.4],
  [4.2, 0, -1.6],
] as const;

/**
 * A four-frame flame atlas built in plain JS so the same bytes exist on web and native.
 *
 * A DOM canvas would work in a browser and not in the native host, and the point of the atlas is
 * that the game owns it — so it is authored here as data rather than loaded from a service.
 */
function createFlameAtlas(): DataTexture {
  const width = FLAME_FRAME_SIZE * FLAME_FRAMES;
  const data = new Uint8Array(width * FLAME_FRAME_SIZE * 4);
  for (let frame = 0; frame < FLAME_FRAMES; frame += 1) {
    const lean = (frame - 1.5) * 1.6;
    for (let y = 0; y < FLAME_FRAME_SIZE; y += 1) {
      const height = y / (FLAME_FRAME_SIZE - 1);
      const halfWidth = (1 - height) * 5.5 + 1;
      const centre = FLAME_FRAME_SIZE / 2 + lean * height;
      for (let x = 0; x < FLAME_FRAME_SIZE; x += 1) {
        const distance = Math.abs(x + 0.5 - centre);
        const inside = distance <= halfWidth;
        const offset = ((FLAME_FRAME_SIZE - 1 - y) * width + frame * FLAME_FRAME_SIZE + x) * 4;
        const core = inside ? 1 - distance / halfWidth : 0;
        data[offset] = Math.round(255 * core);
        data[offset + 1] = Math.round(210 * core * (1 - height * 0.45));
        data[offset + 2] = Math.round(120 * core * (1 - height * 0.8));
        data[offset + 3] = inside ? Math.round(255 * (0.35 + core * 0.65) * (1 - height * 0.5)) : 0;
      }
    }
  }
  const texture = new DataTexture(data, width, FLAME_FRAME_SIZE, RGBAFormat);
  texture.colorSpace = SRGBColorSpace;
  texture.magFilter = NearestFilter;
  texture.minFilter = NearestFilter;
  texture.needsUpdate = true;
  return texture;
}

export interface IBeacon {
  readonly billboard: Billboard3D;
  readonly flame: Mesh;
  readonly group: Group;
  readonly nameplate: Mesh;
  /** The mesh a pointer listener is registered on, and the mesh the scene BVH packs. */
  readonly post: Mesh;
  lit: boolean;
}

export interface IBeaconField {
  readonly animator: SpriteAnimator3D;
  readonly beacons: readonly IBeacon[];
  readonly root: Group;
  /** Face every nameplate at the camera. Called from the scene's frame, never by the framework. */
  update(camera: Camera): void;
}

export function createBeacons(camera: Camera): IBeaconField {
  const atlas = createFlameAtlas();
  const animator = new SpriteAnimator3D({
    texture: atlas,
    // Every duration is authored here; the framework invents no frame rate.
    frames: Array.from({ length: FLAME_FRAMES }, (_unused, index) => ({
      x: index * FLAME_FRAME_SIZE,
      y: 0,
      width: FLAME_FRAME_SIZE,
      height: FLAME_FRAME_SIZE,
      duration: index % 2 === 0 ? 0.09 : 0.13,
    })),
    mode: "loop",
    origin: "top-left",
  });
  const flameMaterial = new MeshBasicMaterial({
    alphaTest: 0.18,
    depthWrite: false,
    map: atlas,
    side: DoubleSide,
    toneMapped: false,
    transparent: true,
  });
  const root = new Group();
  const beacons = BEACON_POSITIONS.map(([x, y, z], index) => {
    const group = new Group();
    group.position.set(x, y, z);
    // A box, not a plane. A three-plane scene packs into a single BVH node, and a one-element
    // storage buffer generates `ptr<storage, BVHNode>` where the upstream query wants
    // `ptr<storage, array<BVHNode>>` — the shader then fails to compile. Real volume avoids it.
    const post = new Mesh(
      new BoxGeometry(0.42, 1.8, 0.42),
      new MeshStandardMaterial({
        color: palette.shadow,
        emissive: palette.skyLow,
        metalness: 0.1,
        roughness: 0.6,
      }),
    );
    post.position.y = 0.9;
    post.castShadow = true;
    post.name = `beacon-post-${index}`;
    // The BVH selects on this flag, so the game decides what is traceable, not the framework.
    post.userData.traceable = true;
    group.add(post);

    const flame = new Mesh(new PlaneGeometry(0.95, 0.95), flameMaterial);
    flame.position.y = 2.28;
    flame.visible = false;
    flame.name = `beacon-flame-${index}`;
    group.add(flame);

    const nameplate = new Mesh(
      new PlaneGeometry(0.9, 0.26),
      new MeshBasicMaterial({
        color: palette.accent,
        depthWrite: false,
        side: DoubleSide,
        toneMapped: false,
        transparent: true,
        opacity: 0.55,
      }),
    );
    nameplate.position.y = 2.6;
    nameplate.name = `beacon-plate-${index}`;
    group.add(nameplate);

    root.add(group);
    return { billboard: new Billboard3D(nameplate, { camera }), flame, group, nameplate, post, lit: false };
  });

  return {
    animator,
    beacons,
    root,
    update(activeCamera: Camera): void {
      for (const beacon of beacons) beacon.billboard.update(activeCamera);
    },
  };
}
