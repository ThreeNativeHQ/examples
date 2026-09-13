/** User-supplied Douglas SBD-3, battle-of-pacific/assets/generated; textures and 12 clips retained. */
import { AnimationPlayer, type ICtx, softCircleDataTexture } from "@threenative/core";
import * as T from "three";
import type { WebGPURenderer } from "three/webgpu";
import { mat, rod } from "./assets.js";
import type { GLTF } from "three/addons/loaders/GLTFLoader.js";
import {
  createCockpitInterior,
  ensureCockpitMaterials,
  getCockpitMaterials,
  type CockpitInterior,
} from "./cockpit-detail.js";
import { createDauntlessGear } from "./dauntless.js";

/** The detailed interior is a real-metre cockpit, scaled into the Douglas canopy opening. */
const COCKPIT_SCALE = 0.52;
const COCKPIT_POSITION: [number, number, number] = [0, 0.342, -2.482];

const surfaceClips = [
  "flight.pitch-up",
  "flight.pitch-down",
  "flight.roll-right",
  "flight.roll-left",
  "flight.rudder-right",
  "flight.rudder-left",
  "flaps.deploy",
];
let source: GLTF;
const instances = new WeakMap<
  T.Group,
  {
    player: AnimationPlayer;
    canopyMaterial: T.Material;
    blades: T.Object3D[];
    blur: T.Mesh<T.PlaneGeometry, T.MeshBasicMaterial>;
    instrumentRoot: T.Group;
    interior: CockpitInterior | undefined;
    actions: Map<string, T.AnimationAction>;
    gear: ReturnType<typeof createDauntlessGear>;
  }
>();

export async function loadImportedAircraft(ctx: Pick<ICtx, "assets" | "renderer">): Promise<void> {
  const anisotropy = (ctx.renderer.raw as WebGPURenderer).getMaxAnisotropy();
  const [sourceModel] = await Promise.all([
    ctx.assets.model<GLTF>("/assets/aircraft.douglas-sbd3.glb"),
    ensureCockpitMaterials(anisotropy),
  ]);
  source = sourceModel;
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

/** Metres, nose -Z; the body's origin is the flight model's centre of gravity. */
export function createDouglas(withCockpit = false): T.Group {
  if (!source) throw new Error("Load the Douglas aircraft before constructing its instances.");
  const root = new T.Group();
  root.name = "Douglas SBD-3";
  const model = source.scene.clone(true);
  const span = new T.Box3().setFromObject(model).getSize(new T.Vector3()).x;
  if (!Number.isFinite(span) || span <= 0)
    throw new Error("Douglas aircraft has no measurable wingspan.");
  model.scale.multiplyScalar(12.66 / span);
  model.rotation.y = Math.PI;
  // The source is exported gear-up; lift its propeller clear of the existing 1.82m wheel datum.
  model.position.y = 0.35;
  root.add(model);
  const gear = createDauntlessGear();
  root.add(gear.gear);
  // Keep the fixed tailwheel on the flight model's contact datum. Only extend its strut
  // to the imported fuselage; moving the whole assembly with the model leaves it floating.
  root.updateMatrixWorld(true);
  const attachment = new T.Raycaster(
    new T.Vector3(0, -2, 4.19),
    new T.Vector3(0, 1, 0),
  ).intersectObject(model, true)[0];
  if (!attachment) throw new Error("Douglas tailwheel has no fuselage attachment above its mount.");
  rod(
    gear.tail,
    [0, -0.29, 4.19],
    [0, attachment.point.y, 4.19],
    0.043,
    mat(0x84939b, { metalness: 0.85, roughness: 0.26 }),
  );
  root.traverse((node) => {
    if (node instanceof T.Mesh) {
      node.castShadow = true;
      node.receiveShadow = true;
    }
  });
  // Blender inspection: node_7 is the pane mesh; node_8 is the separate metal frame.
  // The supplied GLB marks both opaque, making the cockpit windshield a solid grey wall.
  const canopy = model.getObjectByName("defaultMaterial_node_7");
  if (!(canopy instanceof T.Mesh) || !(canopy.material instanceof T.MeshStandardMaterial))
    throw new Error("Douglas aircraft is missing its separate canopy glass mesh.");
  const canopyMaterial = canopy.material.clone();
  canopyMaterial.color.set(0xc3dbe0);
  canopyMaterial.map = null;
  canopyMaterial.normalMap = null;
  canopyMaterial.transparent = true;
  canopyMaterial.opacity = 0.09;
  canopyMaterial.depthWrite = false;
  canopyMaterial.metalness = 0;
  canopyMaterial.roughness = 0.12;
  canopyMaterial.forceSinglePass = true;
  canopy.material = canopyMaterial;
  canopy.castShadow = false;
  const canopyFrame = model.getObjectByName("defaultMaterial_node_8");
  // Fuselage shells that share the cockpit's space and peek around the detailed interior.
  const cockpitFuselage = ["defaultMaterial_node_12", "defaultMaterial_node_18"]
    .map((name) => model.getObjectByName(name))
    .filter((node): node is T.Object3D => Boolean(node));
  const cockpitShell = [canopy, ...(canopyFrame ? [canopyFrame] : []), ...cockpitFuselage];
  const blades = ["defaultMaterial_node_15", "defaultMaterial_node_16"].map((name) => {
    const mesh = model.getObjectByName(name);
    if (!(mesh instanceof T.Mesh))
      throw new Error(`Douglas aircraft is missing propeller blade ${name}.`);
    return mesh;
  });
  const propellerPivot = model.getObjectByName("Circle008_Circle031ThreeNativePivot");
  if (!propellerPivot) throw new Error("Douglas aircraft is missing its propeller pivot.");
  root.updateMatrixWorld(true);
  const inversePivot = propellerPivot.matrixWorld.clone().invert();
  const vertex = new T.Vector3();
  let bladeRadius = 0;
  for (const blade of blades) {
    const transform = inversePivot.clone().multiply(blade.matrixWorld);
    const positions = blade.geometry.getAttribute("position");
    for (let i = 0; i < positions.count; i++) {
      vertex.fromBufferAttribute(positions, i).applyMatrix4(transform);
      bladeRadius = Math.max(bladeRadius, Math.hypot(vertex.x, vertex.y));
    }
  }
  const blur = new T.Mesh(
    new T.PlaneGeometry(bladeRadius * 2, bladeRadius * 2),
    new T.MeshBasicMaterial({
      map: softCircleDataTexture(64, 0.8),
      color: 0xa3aaa3,
      transparent: true,
      opacity: 0.045,
      side: T.DoubleSide,
      depthWrite: false,
      forceSinglePass: true,
      toneMapped: false,
    }),
  );
  blur.name = "Propeller motion blur";
  propellerPivot.add(blur);
  const instrumentRoot = new T.Group();
  instrumentRoot.name = "Douglas live cockpit instruments";
  const cockpitMaterials = getCockpitMaterials();
  const interior = withCockpit && cockpitMaterials ? createCockpitInterior(cockpitMaterials) : undefined;
  if (interior) {
    interior.root.scale.setScalar(COCKPIT_SCALE);
    interior.root.position.set(...COCKPIT_POSITION);
    instrumentRoot.add(interior.root);
    root.userData.cockpit = new T.Vector3(
      COCKPIT_POSITION[0] + interior.eye[0] * COCKPIT_SCALE,
      COCKPIT_POSITION[1] + interior.eye[1] * COCKPIT_SCALE,
      COCKPIT_POSITION[2] + interior.eye[2] * COCKPIT_SCALE,
    );
  }
  root.add(instrumentRoot);
  const propeller = source.animations.find((clip) => clip.name === "propeller.spin");
  if (!propeller) throw new Error("Douglas aircraft is missing propeller.spin.");
  const propTracks = new Set(propeller.tracks.map((track) => track.name));
  // Composite source clips include the propeller. Strip that shared track so simultaneous
  // elevator, aileron and rudder input cannot blend away the independent throttle-driven spin.
  const clips = [
    propeller,
    ...surfaceClips.map((name) => {
      const clip = source.animations.find((candidate) => candidate.name === name);
      if (!clip) throw new Error(`Douglas aircraft is missing ${name}.`);
      return new T.AnimationClip(
        name,
        clip.duration,
        clip.tracks.filter((track) => !propTracks.has(track.name)),
      );
    }),
  ];
  const player = new AnimationPlayer({
    root: model,
    clips,
    requiredClips: clips.map((clip) => clip.name),
    strideRoot: root,
    strideSync: false,
  });
  const actions = new Map(
    clips.map((clip) => {
      const action = player.mixer.clipAction(clip).play();
      action.paused = clip !== propeller;
      action.setEffectiveWeight(clip === propeller ? 1 : 0);
      return [clip.name, action] as const;
    }),
  );
  root.userData.importedAircraft = true;
  root.userData.cockpitInterior = instrumentRoot;
  root.userData.cockpitShell = cockpitShell;
  root.userData.cockpitRig = interior;
  instances.set(root, {
    player,
    actions,
    gear,
    canopyMaterial,
    blades,
    blur,
    instrumentRoot,
    interior,
  });
  animateDouglas(root, {}, 0);
  return root;
}

interface IDouglasControls {
  rpm?: number;
  throttle?: number;
  elevator?: number;
  controlAileron?: number;
  aileron?: number;
  rudder?: number;
  flapPos?: number;
  brakePos?: number;
  gearPos?: number;
  wheelAngle?: number;
}

export function animateDouglas(root: T.Group, p: IDouglasControls, dt: number): void {
  const instance = instances.get(root);
  if (!instance) throw new Error("This object is not an imported Douglas aircraft.");
  const { actions, player, gear, blades, blur, interior } = instance;
  const rpm = Math.max(0, p.rpm ?? p.throttle ?? 0.18);
  for (const blade of blades) blade.visible = rpm < 0.24;
  blur.visible = rpm >= 0.24;
  if (interior) interior.update(p);
  actions.get("propeller.spin")!.setEffectiveTimeScale(rpm * 26);
  for (const [positive, negative, value] of [
    ["flight.pitch-up", "flight.pitch-down", p.elevator ?? 0],
    ["flight.roll-right", "flight.roll-left", p.controlAileron ?? p.aileron ?? 0],
    ["flight.rudder-right", "flight.rudder-left", p.rudder ?? 0],
  ] as const) {
    actions.get(positive)!.setEffectiveWeight(T.MathUtils.clamp(value, 0, 1));
    actions.get(negative)!.setEffectiveWeight(T.MathUtils.clamp(-value, 0, 1));
  }
  const flap = actions.get("flaps.deploy")!;
  flap.setEffectiveWeight(1);
  flap.time =
    flap.getClip().duration * T.MathUtils.clamp(Math.max(p.flapPos ?? 0, p.brakePos ?? 0), 0, 1);
  for (const { group, sign, wheel } of gear.gearLegs) {
    group.rotation.z = (-sign * (1 - (p.gearPos ?? 1)) * Math.PI) / 2;
    wheel.rotation.x = p.wheelAngle ?? 0;
  }
  player.update(dt);
}

export function disposeDouglas(root: T.Group): void {
  const instance = instances.get(root);
  if (!instance) return;
  instance.player.dispose();
  instance.canopyMaterial.dispose();
  instance.blur.geometry.dispose();
  instance.blur.material.map?.dispose();
  instance.blur.material.dispose();
  instance.interior?.dispose();
  instance.instrumentRoot.traverse((node) => {
    if (!(node instanceof T.Mesh)) return;
    node.geometry.dispose();
    if (node.material instanceof T.MeshBasicMaterial) node.material.dispose();
  });
  instance.gear.gear.traverse((node) => {
    if (!(node instanceof T.Mesh)) return;
    node.geometry.dispose();
    // Gear materials come from the shared mat() cache and belong to the whole scene.
  });
  instances.delete(root);
}
