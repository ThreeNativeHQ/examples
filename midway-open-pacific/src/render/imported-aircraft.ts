/**
 * The game's imported airframes, chosen by an explicit airframe id.
 *
 * The Douglas SBD-3 (battle-of-pacific/assets/generated) keeps its textures and 12 clips and its
 * own clip-driven animator. The TBD-1 and B5N2 come through tools/import-aircraft.sh already at
 * real size, so nothing here scales a model.
 */
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
import { createZero } from "./imported-fleet.js";

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
/** Which airframe a group is; the id the rest of the game asks for. */
export type AirframeId = "sbd3" | "tbd1" | "b5n2" | "a6m3";

const DOUGLAS_URL = "/assets/aircraft.douglas-sbd3.glb";

/**
 * The airframes imported by tools/import-aircraft.sh: metres, +Y up, span on X, wheels on y = 0,
 * and the propeller cut out of the fused mesh into its own child named `propeller` whose origin
 * sits on the real shaft, so spinning it about its own local Z is the whole animation. `ai` is the
 * reduced-detail build of the same airframe for wing aircraft and parked deck loads; the Kate
 * ships at one detail only.
 *
 * Nose direction is measured per file rather than assumed — see createAirframe.
 */
const IMPORTS = {
  tbd1: {
    name: "Douglas TBD-1 Devastator",
    hero: "/assets/aircraft.tbd-devastator.glb",
    ai: "/assets/aircraft.tbd-devastator.ai.glb",
  },
  b5n2: {
    name: "Nakajima B5N2",
    hero: "/assets/aircraft.b5n2-kate.glb",
    ai: "/assets/aircraft.b5n2-kate.glb",
  },
} as const;

/** Measured with tools/probe-glb.mjs: the A6M3 pivots its propeller under this node. */
const ZERO_PROPELLER = "VINTThreeNativePivot";

/** Rad/s at full throttle — about 2200 rpm, the rate dauntless.ts turns a propeller. */
const PROP_RATE = 231;
const TAU = Math.PI * 2;

let source: GLTF;
const imported = new Map<string, GLTF>();
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

/** Idempotent: ctx.assets caches each model, and the anisotropy pass writes the same value again. */
export async function loadImportedAircraft(ctx: Pick<ICtx, "assets" | "renderer">): Promise<void> {
  const anisotropy = (ctx.renderer.raw as WebGPURenderer).getMaxAnisotropy();
  const urls = [
    DOUGLAS_URL,
    ...new Set(Object.values(IMPORTS).flatMap((airframe) => [airframe.hero, airframe.ai])),
  ];
  const [models] = await Promise.all([
    Promise.all(urls.map((url) => ctx.assets.model<GLTF>(url))),
    ensureCockpitMaterials(anisotropy),
  ]);
  urls.forEach((url, i) => {
    const model = models[i]!;
    imported.set(url, model);
    model.scene.traverse((node) => {
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
  });
  source = imported.get(DOUGLAS_URL)!;
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
  // Exposed for symmetry with every other airframe, but animateDouglas owns it: the mixer writes
  // this pivot's quaternion from propeller.spin every frame, so spinPropeller cannot move it.
  root.userData.propeller = propellerPivot;
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

/**
 * One aircraft of a named airframe, at the requested detail.
 *
 * The id is explicit on purpose: a caller asks for the airframe it means, so no team or kind
 * mapping can quietly hand back the wrong silhouette. `ai` is the reduced-detail build where the
 * airframe has one; where it does not, the same model serves both and says so here.
 */
export function createAirframe(id: AirframeId, detail: "hero" | "ai"): T.Group {
  // The Dauntless and the Zero keep the constructors that measured them; only their propeller is
  // republished here, so one animator can find any airframe's propeller the same way.
  if (id === "sbd3") return createDouglas();
  if (id === "a6m3") {
    const zero = createZero();
    zero.userData.propeller = requirePropeller(zero, ZERO_PROPELLER, "Mitsubishi A6M3", "aircraft.mitsubishi-a6m3.glb");
    return zero;
  }
  const airframe = IMPORTS[id as keyof typeof IMPORTS] as (typeof IMPORTS)[keyof typeof IMPORTS] | undefined;
  if (!airframe)
    throw new Error(`Unknown airframe id "${String(id)}": expected sbd3, tbd1, b5n2 or a6m3.`);
  const url = airframe[detail];
  const gltf = imported.get(url);
  if (!gltf) throw new Error(`Load the imported aircraft before constructing the ${airframe.name}.`);
  const root = new T.Group();
  root.name = airframe.name;
  // Already metres, wheels on y = 0 and nose -Z out of the import: never scaled or rotated here.
  const model = gltf.scene.clone(true);
  model.traverse((node) => {
    if (node instanceof T.Mesh) {
      node.castShadow = true;
      node.receiveShadow = true;
    }
  });
  root.add(model);
  const propeller = requirePropeller(model, "propeller", airframe.name, url);
  root.updateMatrixWorld(true);

  // Which way the file points, measured from the model itself rather than assumed. The game flies
  // every model nose -Z, and the propeller IS the nose, so its own sign along the fuselage says
  // which end is which: a mis-exported airframe gets turned instead of flown backwards. Every
  // shipped model satisfies -Z today, so this is a no-op — it earns its place by having caught a
  // Blender +Y-to-glTF -Z axis error in tools/blender/align-aircraft.py that nothing else saw.
  let shaft = propeller.getWorldPosition(new T.Vector3());
  if (!(Math.abs(shaft.z) > 0.5))
    throw new Error(`${airframe.name} propeller sits at neither end of its fuselage.`);
  if (shaft.z > 0) {
    model.rotation.y = Math.PI;
    root.updateMatrixWorld(true);
    shaft = propeller.getWorldPosition(new T.Vector3());
  }

  // The blade disc at speed, the way dauntless.ts fades one: a soft circle that comes up as the
  // blades go out. Sized from the propeller's own measured diameter, and parented to the root at
  // the shaft rather than to the propeller, so it keeps the root's scale and never spins.
  const span = new T.Box3().setFromObject(propeller).getSize(new T.Vector3());
  const radius = Math.max(span.x, span.y) / 2;
  if (!(radius > 0)) throw new Error(`${airframe.name} propeller has no measurable diameter.`);
  const blur = new T.Mesh(
    new T.PlaneGeometry(radius * 2, radius * 2),
    new T.MeshBasicMaterial({
      map: softCircleDataTexture(64, 0.8),
      color: 0xa3aaa3,
      transparent: true,
      opacity: 0,
      side: T.DoubleSide,
      depthWrite: false,
      forceSinglePass: true,
      toneMapped: false,
    }),
  );
  blur.name = "Propeller motion blur";
  blur.position.copy(shaft);
  blur.visible = false;
  root.add(blur);

  root.userData.importedAircraft = true;
  root.userData.propeller = propeller;
  // The scene's generic per-frame path spins `prop`; this is the same object under the name
  // createZero established, so an imported airframe drops into it without a special case.
  root.userData.prop = propeller;
  root.userData.propAngle = 0;
  root.userData.propBlur = blur;
  return root;
}

function requirePropeller(root: T.Object3D, name: string, model: string, file: string): T.Object3D {
  const propeller = root.getObjectByName(name);
  // A silently missing pivot is the failure the whole import was built to remove: without it the
  // propeller is fused into the airframe and no rotation can look right, so this never falls back.
  if (!propeller)
    throw new Error(`${model} (${file}) has no child named "${name}" to spin as its propeller.`);
  return propeller;
}

/**
 * Turn one aircraft's propeller. `rpmNormalised` is 0 at rest and 1 at full throttle.
 *
 * The angle lives on the group, so two aircraft at different throttle settings never share a
 * rotation, and a paused frame (dt = 0) advances nothing.
 */
export function spinPropeller(group: T.Group, rpmNormalised: number, dt: number): void {
  const propeller = group.userData.propeller as T.Object3D | undefined;
  if (!propeller)
    throw new Error(`${group.name || "This object"} is not an airframe with a propeller to spin.`);
  const rpm = Math.max(0, rpmNormalised);
  const angle = ((group.userData.propAngle as number | undefined) ?? 0) + dt * rpm * PROP_RATE;
  group.userData.propAngle = angle % TAU;
  propeller.rotation.z = group.userData.propAngle as number;
  const blur = group.userData.propBlur as
    | T.Mesh<T.PlaneGeometry, T.MeshBasicMaterial>
    | undefined;
  // Only an airframe that owns a blur disc may hide its blades; the rest would just vanish.
  if (!blur) return;
  propeller.visible = rpm < 0.38;
  blur.visible = rpm > 0.15;
  blur.material.opacity = Math.min(1, rpm * 2.5);
}

/**
 * Give back what this one aircraft owns, and nothing else.
 *
 * Geometry, materials and textures come from the shared GLTF that `ctx.assets` owns and outlive
 * every instance, so only the blur disc built for this group is disposed. Procedural parts another
 * constructor built for its own instance stay in that instance's `userData.owned`, where the
 * scene's model disposal already gives them back.
 */
export function disposeAirframe(group: T.Group): void {
  if (instances.has(group)) {
    disposeDouglas(group);
    return;
  }
  const blur = group.userData.propBlur as
    | T.Mesh<T.PlaneGeometry, T.MeshBasicMaterial>
    | undefined;
  if (!blur) return;
  blur.geometry.dispose();
  blur.material.map?.dispose();
  blur.material.dispose();
  blur.removeFromParent();
  delete group.userData.propBlur;
}
