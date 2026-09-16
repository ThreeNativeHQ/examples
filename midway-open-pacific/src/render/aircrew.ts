/**
 * One seated aircrew station — the shared pilot rig, its seat, and a rear station's flexible-gun
 * pivot — fitted into whichever cockpit carries it.
 *
 * Extracted from the Douglas factory so the ported TBD's own procedural cockpit can seat the same
 * rig without importing the Douglas module: `imported-aircraft.ts` imports `devastator.ts`, so the
 * reverse would be a cycle. This is render-only; it reads and writes no sim, input or camera state.
 */
import { SkeletalMesh3D } from "@threenative/core";
import * as T from "three";
import type { GLTF } from "three/addons/loaders/GLTFLoader.js";
import { box, mat, rod } from "./assets.js";

/** The deck crew's rigged pilot, which both the Douglas and the TBD seat in their cockpits. */
export const AIRCREW_PILOT_URL = "/assets/carrier-aircraft-pilot.glb";

let pilotRig: GLTF | undefined;

/** Hand the loaded pilot GLTF to every cockpit factory. Idempotent, so each load re-publishes it. */
export function configureAircrewPilot(gltf: GLTF): void {
  pilotRig = gltf;
}

/**
 * The seated rig's own joints in its local frame, measured on the shipped `sit` clip at mixer t = 0
 * (yaw 0, facing +Z, nose -Z game frame). Furniture is derived from the pelvis so a seat can never
 * drift off the man it carries — an earlier hand-placed pan sat 0.85 m in front of the gunner.
 */
export const SEATED_PELVIS: readonly [number, number, number] = [0.003, 0.625, -0.286];

/**
 * The seated eye relative to the posed `Head` bone: 0.08 m up and 0.055 m along the face's forward
 * axis, so `eye = head + offset` reproduces the SBD's documented cockpit eye (0, 1.080, -1.650)
 * from its measured head joint (-0.003, 0.998, -1.597). Measured once, shared by every station.
 */
const EYE_OFFSET: readonly [number, number, number] = [0, 0.08, 0.055];

/** A seated crew station: the rig root, its own fittings, the seated eye, and any gun pivot. */
export interface ISeatedStation {
  /** The whole station, rig plus fittings; what `userData.crew[0]` hides for a pilot. */
  root: T.Group;
  /** The station's fittings, registered in the airframe's `userData.owned` for disposal. */
  furniture: T.Group;
  player: SkeletalMesh3D;
  /** The seated eye in aircraft-root coordinates, measured off the posed skeleton. */
  eye: T.Vector3;
  /** The flexible gun's pivot on a rear station; the controls arm turns this and nothing else. */
  gun?: T.Group;
}

/**
 * A seat pan, backrest and legs under a seated crew man's measured pelvis, built in his local frame
 * so the caller yaws and places the station as one. The pan sits 0.075 m below the pelvis joint (the
 * sit bones) and the backrest just behind his back at local -Z.
 */
function seatedFurniture(parent: T.Object3D, seat: T.Material, frame: T.Material): void {
  const [px, py, pz] = SEATED_PELVIS;
  box(parent, 0.42, 0.06, 0.44, px, py - 0.105, pz, seat);
  box(parent, 0.44, 0.46, 0.06, px, py + 0.095, pz - 0.135, seat);
  for (const x of [-0.17, 0.17]) rod(parent, [x, py - 0.105, pz], [x, 0.05, pz], 0.018, frame);
}

export interface ISeatedStationOptions {
  /** Build the placeholder twin-gun mount and publish its pivot. */
  gun?: boolean;
  /**
   * Build the procedural seat. Off where the airframe already models its own, so the drawn seat
   * never doubles up with the source cockpit.
   */
  furniture?: boolean;
}

/**
 * One seated crew man on the deck crew's `sit` clip: the rig, his seat, and — on a rear station —
 * the flexible-gun pivot the controls arm turns.
 *
 * The likeness, weights, textures and skeleton are the shared `carrier-aircraft-pilot.glb`; only
 * the `sit` clip is the additional Quaternius UAL motion, so a second man is an independent
 * `SkeletalMesh3D` clone with its own mixer. The gun is its own pivot group, so hiding the man in a
 * first-person station never hides the seat, the fittings or the gun.
 */
export function createSeatedStation(
  name: string,
  seat: readonly [number, number, number],
  yaw: number,
  options: ISeatedStationOptions = {},
): ISeatedStation {
  if (!pilotRig) throw new Error(`Load the aircrew pilot rig before building the ${name}.`);
  const root = new T.Group();
  root.name = `${name} crew`;
  const fittings = new T.Group();
  fittings.name = `${name} cockpit fittings`;
  const furniture = new T.Group();
  furniture.position.set(...seat);
  furniture.rotation.y = yaw;
  if (options.furniture !== false)
    seatedFurniture(furniture, mat(0x5c5340, { roughness: 0.85, metalness: 0.05 }), mat(0x4a5148, { metalness: 0.55, roughness: 0.5 }));
  fittings.add(furniture);
  let gun: T.Group | undefined;
  if (options.gun) {
    // Twin .30 flexible mount, a placeholder the user replaces, carried in the seat's own frame so
    // it follows the man to any cockpit. Only the cradle, barrels and magazine turn with the
    // controls; the pedestal is fixed to the seat, so a yaw or pitch swings the gun and never the
    // man, his seat or the airframe. Nothing here is gunnery logic.
    const frame = mat(0x4a5148, { metalness: 0.55, roughness: 0.5 });
    const gunMat = mat(0x33383a, { metalness: 0.8, roughness: 0.35 });
    rod(furniture, [0, 0.56, 0.85], [0, 1.2, 0.85], 0.03, frame);
    gun = new T.Group();
    gun.name = `${name} gun pivot`;
    gun.position.set(0, 1.22, 0.85);
    furniture.add(gun);
    box(gun, 0.24, 0.06, 0.12, 0, 0, 0, frame);
    for (const x of [-0.07, 0.07]) rod(gun, [x, 0.04, 0.02], [x, 0.08, 0.56], 0.026, gunMat);
    box(gun, 0.22, 0.14, 0.12, 0.26, -0.2, 0.06, gunMat);
  }
  root.add(fittings);
  const player = new SkeletalMesh3D({
    source: pilotRig.scene,
    clips: pilotRig.animations,
    // Only the seated clip belongs to this occupant; the standing hero clips stay on the deck crew.
    requiredClips: ["sit"],
    // A seated man travels nowhere; an in-place idle must keep its authored rate.
    strideSync: false,
  });
  player.root.name = name;
  player.root.position.set(...seat);
  player.root.rotation.y = yaw;
  player.play("sit");
  player.update(0);
  root.add(player.root);
  root.traverse((node) => {
    if (!(node instanceof T.Mesh)) return;
    node.castShadow = true;
    node.receiveShadow = true;
  });
  // The seated eye point, in the aircraft's own frame. Measured off the posed skeleton rather than
  // typed in, so a cockpit view follows the rig wherever it is fitted.
  const head = player.root.getObjectByName("Head");
  if (!head) throw new Error(`The pilot rig has no Head bone to sight the ${name} from.`);
  player.root.updateMatrixWorld(true);
  const eye = head
    .getWorldPosition(new T.Vector3())
    .add(new T.Vector3(...EYE_OFFSET).applyAxisAngle(new T.Vector3(0, 1, 0), yaw));
  return { root, furniture: fittings, player, eye, gun };
}
