/**
 * The flight-deck party around the player's aircraft.
 *
 * One rigged sailor is loaded once and instanced per station. A carrier deck is not a crowd of
 * identical figures: every man here has a job, stands where that job puts him relative to the
 * aircraft, wears his trade's helmet colour, and runs his own clip at his own phase and rate, so
 * no two are in step. Roles follow 1942 US carrier practice — plane director ahead of the nose,
 * chockmen at the main wheels, plane captain at the engine, ordnance under the wing, fuel and
 * arresting-gear details standing clear of the launch path.
 */
import { SkeletalMesh3D, type ICtx } from "@threenative/core";
import * as T from "three";
import type { GLTF } from "three/addons/loaders/GLTFLoader.js";
import type { WebGPURenderer } from "three/webgpu";
import { mat } from "./assets.js";

/** Clips baked by tools/blender/rig-deck-crew.py; the loader fails closed if any is missing. */
const CLIPS = [
  "crew.signal",
  "crew.idle",
  "crew.wait",
  "crew.chock",
  "crew.service",
  "crew.walk",
] as const;

type Clip = (typeof CLIPS)[number];

interface IStation {
  /** Shown in nothing; it documents why the man is standing there. */
  readonly job: string;
  readonly clip: Clip;
  /** Cloth-helmet colour, the trade marking a deck hand is actually recognised by. */
  readonly helmet: number;
  /** Metres in the aircraft's frame: +x starboard, -z ahead of the nose. */
  readonly x: number;
  readonly z: number;
  /** Facing, radians; 0 looks along the deck run, Math.PI looks back at the aircraft. */
  readonly yaw: number;
}

const YELLOW = 0xc8a63c;
const BLUE = 0x3f5f86;
const RED = 0x8f3b33;
const GREEN = 0x4e6b44;
const PURPLE = 0x5d4570;
const BROWN = 0x6d5a3f;
const WHITE = 0xb9bcb4;

const STATIONS: readonly IStation[] = [
  // The launch spot itself.
  { job: "plane director", clip: "crew.signal", helmet: YELLOW, x: -4.6, z: -7.2, yaw: Math.PI },
  { job: "chockman, port main", clip: "crew.chock", helmet: BLUE, x: -2.6, z: -0.2, yaw: 1.9 },
  { job: "chockman, starboard main", clip: "crew.chock", helmet: BLUE, x: 2.6, z: -0.2, yaw: -1.9 },
  { job: "plane captain, engine", clip: "crew.service", helmet: BROWN, x: -1.9, z: -3.7, yaw: 1.3 },
  { job: "ordnanceman, bomb rack", clip: "crew.service", helmet: RED, x: 2.5, z: 0.9, yaw: -1.2 },
  // Standing clear of the launch path.
  { job: "fuel detail", clip: "crew.wait", helmet: PURPLE, x: -8.4, z: 4.6, yaw: 2.5 },
  { job: "arresting-gear crew", clip: "crew.wait", helmet: GREEN, x: 8.8, z: 9.4, yaw: -2.4 },
  { job: "deck talker", clip: "crew.walk", helmet: WHITE, x: -10.2, z: -9.5, yaw: 0.25 },
  { job: "safety observer", clip: "crew.idle", helmet: WHITE, x: 10.1, z: -6.2, yaw: -1.6 },
  { job: "handler, forward park", clip: "crew.idle", helmet: BLUE, x: -6.8, z: 13.4, yaw: 2.9 },
  { job: "handler, respot", clip: "crew.signal", helmet: YELLOW, x: 5.4, z: 15.8, yaw: 3.5 },
  { job: "handler, tail walker", clip: "crew.wait", helmet: BLUE, x: -3.2, z: 18.1, yaw: 3.1 },
];

/** Height of the baked rig, set by tools/blender/rig-deck-crew.py and asserted by check-fleet. */
const SOURCE_HEIGHT = 1.83;

let source: GLTF | undefined;
let helmetShell: T.SphereGeometry | undefined;
let helmetGoggles: T.TorusGeometry | undefined;

export async function loadDeckCrew(ctx: Pick<ICtx, "assets" | "renderer">): Promise<void> {
  source = await ctx.assets.model<GLTF>("/assets/deck-crew.glb");
  const anisotropy = (ctx.renderer.raw as WebGPURenderer).getMaxAnisotropy();
  source.scene.traverse((node) => {
    if (!(node instanceof T.Mesh)) return;
    for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
      for (const value of Object.values(material)) {
        if (value instanceof T.Texture) {
          value.anisotropy = anisotropy;
          value.needsUpdate = true;
        }
      }
    }
  });
}

/** A cloth flight-deck helmet with its goggles pushed up, in metres, sized for a 1.8m man. */
function makeHelmet(colour: number): T.Group {
  helmetShell ??= new T.SphereGeometry(0.108, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.62);
  helmetGoggles ??= new T.TorusGeometry(0.088, 0.018, 6, 14, Math.PI * 1.15);
  const group = new T.Group();
  const shell = new T.Mesh(helmetShell, mat(colour, { roughness: 0.86, metalness: 0.02 }));
  shell.castShadow = true;
  group.add(shell);
  const goggles = new T.Mesh(helmetGoggles, mat(0x2b2f30, { roughness: 0.5, metalness: 0.25 }));
  goggles.rotation.set(-Math.PI / 2, 0, Math.PI * 0.42);
  goggles.position.set(0, 0.028, 0.006);
  group.add(goggles);
  return group;
}

interface ISailor {
  readonly station: IStation;
  readonly player: SkeletalMesh3D;
  readonly rate: number;
}

export class DeckCrew {
  readonly group = new T.Group();
  /** Public so a capture run can prove the party is not twelve men moving as one. */
  readonly sailors: ISailor[] = [];

  constructor() {
    if (!source) throw new Error("Load the deck crew before constructing the flight-deck party.");
    this.group.name = "Flight-deck party";
    for (const [index, station] of STATIONS.entries()) {
      const player = new SkeletalMesh3D({
        source: source.scene,
        clips: source.animations,
        requiredClips: CLIPS,
        // No `size` here. Skin-aware normalisation measures to the crown *bone*, which stops in
        // the middle of the skull, so asking for 1.74m produced a 2.03m sailor. The rig is baked
        // to a known height instead, and scaled from it.
        strideSync: false,
      });
      // Men are not issued in one size; vary height a little so the party does not read as a row
      // of copies. The source height is a pipeline constant, asserted by tools/check-fleet.mjs.
      player.root.scale.setScalar((1.72 + ((index * 7) % 5) * 0.025) / SOURCE_HEIGHT);
      player.root.position.set(station.x, 0, station.z);
      player.root.rotation.y = station.yaw;
      player.root.traverse((node) => {
        if (node instanceof T.Mesh) {
          node.castShadow = true;
          node.receiveShadow = true;
        }
      });
      this.attachHelmet(player.root, station.helmet);
      player.play(station.clip);
      // Two men on the same clip must never move as one. Phase comes from the action's start
      // time; rate is applied to the sailor's own `dt` in update() rather than to the action,
      // because AnimationPlayer's stride pass rewrites an in-place clip's timeScale back to 1 on
      // every frame even when strideSync is off, and patching around the engine is not our call.
      const clip = player.clip(station.clip);
      const rate = 0.86 + ((index * 11) % 7) * 0.043;
      player.mixer.clipAction(clip).time = clip.duration * (((index * 5) % 12) / 12);
      this.group.add(player.root);
      this.sailors.push({ station, player, rate });
    }
  }

  /** Ride the head bone, so a kneeling or crouching man keeps his helmet on. */
  private attachHelmet(root: T.Object3D, colour: number): void {
    root.updateMatrixWorld(true);
    const head = root.getObjectByName("Head");
    if (!head) throw new Error("The deck-crew rig is missing its Head bone.");
    const helmet = makeHelmet(colour);
    // The rig carries the normalising scale, so undo it before adding metre-authored geometry.
    const scale = head.getWorldScale(new T.Vector3()).x || 1;
    helmet.scale.setScalar(1 / scale);
    // Bone +Y runs up through the skull; the bone's tail stops short of the crown.
    helmet.position.set(0, 0.1 / scale, 0.004 / scale);
    head.add(helmet);
  }

  update(dt: number): void {
    for (const sailor of this.sailors) sailor.player.update(dt * sailor.rate);
  }

  dispose(): void {
    for (const sailor of this.sailors) sailor.player.dispose();
    this.sailors.length = 0;
    this.group.clear();
  }
}
