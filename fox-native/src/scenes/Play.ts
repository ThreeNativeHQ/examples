import { type ICtx, Scene, type SceneFrame } from "@threenative/core";
import {
  BatchedMesh,
  Float32BufferAttribute,
  InstancedMesh,
  Matrix4,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  Uint32BufferAttribute,
  type PerspectiveCamera,
  Vector3,
} from "three";
import { MeshBasicNodeMaterial, StorageBufferAttribute } from "three/webgpu";
import { attribute, positionLocal, storage, vec4 } from "three/tsl";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { burst, coin, coinArc, gem, mushroom, snail, star } from "../fox/entities.js";
import { createFox } from "../fox/fox.js";
import { Level, makeRng } from "../fox/level.js";
import { C } from "../fox/palette.js";
import { createClouds, createLights, createSky } from "../fox/sky.js";
import { Hud, Pointers } from "../render/hud.js";
import { createLoadingScreen } from "../render/loading.js";
import type { GameState } from "../state.js";

export type GameCtx = ICtx<GameState, undefined>;

declare const __TN_JS_ENGINE_PROFILE__: Readonly<{
  extraDrawControl: boolean;
  frameWindow: number;
  materials: "distinct";
  meshes: number;
  pureJsIterations: number;
  pureJsObjects: number;
  visibility: 0 | 0.25 | 0.5 | 1;
  warmupFrames: number;
}>;

const profile = __TN_JS_ENGINE_PROFILE__;

const GRAVITY = 38;
const RUN = 9.5;
const DASH = 18;
const ACCEL = 60;
const JUMP_V = 13.5;
const HALF = new Vector3(0.36, 0.78, 0.36);
const CAM_OFFSET = new Vector3(-5.5, 5.2, 14.5);
const PROBE_MERGE_LEVEL = false;
// Build acts 2 and 3 after the loading screen comes down. They begin at x=34 and the fox starts
// at x=-5, so nothing on screen changes; it takes their cost out of the launch.
const DEFER_FAR_LEVEL = true;
const PROBE_FREEZE_LEVEL = false;
const PROBE_BATCH_LEVEL = false;
const PROBE_RENDER_SCALE = 1;
const PROBE_AGGRESSIVE_MERGE = false;
const PROBE_AGGRESSIVE_MERGE_SCENE = false;
const PROBE_STATIC_MERGE_SCENE = false;
const PROBE_FLATTEN_DYNAMIC = false;
const PROBE_BATCH_DYNAMIC = false;
const PROBE_INSTANCE_SCENE = false;
const PROBE_INSTANCE_DYNAMIC = false;
const PROBE_GPU_TRANSFORM_MERGE = false;
const PROBE_FRAME_RATE_WARMUP = profile.warmupFrames;
const PROBE_UPDATE_DYNAMIC_TRANSFORMS = true;
// Moving a shadow-casting light re-renders its 2048x2048 shadow map. Switchable so the cost of
// the sun following the player can be measured against the cost of the frame that does not.
const PROBE_SUN_FOLLOW = (globalThis as any).__TN_PROBE_SUN_FOLLOW__ !== false;

const GEMS: readonly (readonly [number, number, number])[] = [
  [16, 1.5, -1.5],
  [37.5, 3, 0],
  [50.5, 6.6, -1.4],
  [66, 4.5, 2.2],
  [90, 4.5, -2],
];

type Box = { min: Vector3; max: Vector3 };
type Pickup = { home: Vector3; kind: string; mesh: any; taken: boolean };
type Enemy = {
  alive: boolean;
  dir: number;
  from: number;
  kind: string;
  mesh: any;
  speed: number;
  squash: number;
  to: number;
  y: number;
};

function mergeLevelMeshes(root: any): void {
  root.updateWorldMatrix(true, true);
  const groups = new Map<string, { geometries: any[]; material: any }>();
  const merged: any[] = [];
  let sourceMeshes = 0;
  // Merging bakes matrixWorld into the geometry, so anything that moves after the merge must be
  // left out of it. This check was missing while mergeStaticSceneMeshes below has always had it,
  // and the omission is what froze the windmill blades and the waterfall streaks: they were baked
  // at the pose they held when the deferred level revealed, and root.clear() then detached the
  // originals, so their updaters spent the rest of the run animating objects nothing draws.
  const isDynamic = (object: any): boolean => {
    for (let current = object; current !== null && current !== root.parent; current = current.parent) {
      if (current.isCamera === true || current.userData?.threeNativeDynamic === true) return true;
    }
    return false;
  };
  root.traverse((object: any) => {
    if (object.isMesh !== true || Array.isArray(object.material)) return;
    if (isDynamic(object)) return;
    sourceMeshes += 1;
    const geometry = object.geometry.clone().applyMatrix4(object.matrixWorld);
    const attributes = Object.keys(geometry.attributes)
      .sort()
      .map((name) => {
        const attribute = geometry.getAttribute(name);
        return `${name}:${attribute.itemSize}:${attribute.normalized}`;
      })
      .join(",");
    const key = `${object.material.uuid}|${attributes}|${geometry.index !== null}`;
    const group = groups.get(key) ?? { geometries: [], material: object.material };
    group.geometries.push(geometry);
    groups.set(key, group);
    merged.push(object);
  });
  // Only what was actually merged. `root.clear()` took the dynamic subtrees with it.
  for (const mesh of merged) mesh.parent?.remove(mesh);
  for (const group of groups.values()) {
    const geometry = mergeGeometries(group.geometries, false);
    if (geometry === null) continue;
    const mesh = new Mesh(geometry, group.material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    root.add(mesh);
    for (const source of group.geometries) source.dispose();
  }
  console.info(`TN_FOX_NATIVE_MERGE:sourceMeshes=${sourceMeshes};mergedMeshes=${groups.size}`);
}

function batchLevelMeshes(root: any): void {
  root.updateMatrixWorld(true);
  const groups = new Map<string, { material: any; meshes: any[] }>();
  root.traverse((object: any) => {
    if (!object.isMesh || Array.isArray(object.material)) return;
    const attributes = Object.keys(object.geometry.attributes)
      .sort()
      .map((name) => {
        const attribute = object.geometry.getAttribute(name);
        return `${name}:${attribute.itemSize}:${attribute.normalized}:${attribute.array.constructor.name}`;
      })
      .join(",");
    const key = `${object.material.uuid}|${object.geometry.index !== null}|${attributes}`;
    const group = groups.get(key) ?? { material: object.material, meshes: [] };
    group.meshes.push(object);
    groups.set(key, group);
  });
  const batches: any[] = [];
  for (const group of groups.values()) {
    const maxVertexCount = group.meshes.reduce((sum, mesh) => sum + mesh.geometry.getAttribute("position").count, 0);
    const maxIndexCount = group.meshes.reduce((sum, mesh) => sum + (mesh.geometry.index?.count ?? 0), 0);
    const batch = new BatchedMesh(
      group.meshes.length,
      maxVertexCount,
      maxIndexCount || maxVertexCount * 2,
      group.material,
    );
    batch.perObjectFrustumCulled = false;
    batch.sortObjects = false;
    for (const mesh of group.meshes) {
      const geometryId = batch.addGeometry(mesh.geometry);
      const instanceId = batch.addInstance(geometryId);
      batch.setMatrixAt(instanceId, mesh.matrixWorld);
    }
    batches.push(batch);
  }
  root.clear();
  for (const batch of batches) root.add(batch);
  console.info(`TN_FOX_NATIVE_BATCH:sourceMeshes=${[...groups.values()].reduce((sum, group) => sum + group.meshes.length, 0)};batchedMeshes=${batches.length}`);
}

function aggressivelyMergeLevelMeshes(root: any): void {
  root.updateWorldMatrix(true, true);
  const geometries: any[] = [];
  let sourceMeshes = 0;
  root.traverse((object: any) => {
    if (object.isMesh !== true) return;
    const geometry = object.geometry.clone().toNonIndexed().applyMatrix4(object.matrixWorld);
    const position = geometry.getAttribute("position");
    const color = object.material?.color;
    const colors = new Float32Array(position.count * 3);
    for (let index = 0; index < position.count; index += 1) {
      colors[index * 3] = color?.r ?? 1;
      colors[index * 3 + 1] = color?.g ?? 1;
      colors[index * 3 + 2] = color?.b ?? 1;
    }
    for (const name of Object.keys(geometry.attributes)) {
      if (name !== "position") geometry.deleteAttribute(name);
    }
    geometry.setAttribute("color", new Float32BufferAttribute(colors, 3));
    geometries.push(geometry);
    sourceMeshes += 1;
  });
  root.clear();
  const geometry = mergeGeometries(geometries, false);
  if (geometry === null) throw new Error("TN_FOX_NATIVE_AGGRESSIVE_MERGE_FAILED");
  root.add(new Mesh(geometry, new MeshBasicMaterial({ vertexColors: true })));
  console.info(`TN_FOX_NATIVE_AGGRESSIVE_MERGE:sourceMeshes=${sourceMeshes};mergedMeshes=1`);
}

function aggressivelyMergeSceneMeshes(scene: any): void {
  scene.updateWorldMatrix(true, true);
  const geometries: any[] = [];
  const meshes: any[] = [];
  let totalVertices = 0;
  let totalTriangles = 0;
  scene.traverse((object: any) => {
    if (object.isMesh !== true) return;
    const geometry = object.geometry.clone().toNonIndexed().applyMatrix4(object.matrixWorld);
    const position = geometry.getAttribute("position");
    totalVertices += position.count;
    totalTriangles += position.count / 3;
    const color = object.material?.color;
    const colors = new Float32Array(position.count * 3);
    for (let index = 0; index < position.count; index += 1) {
      colors[index * 3] = color?.r ?? 1;
      colors[index * 3 + 1] = color?.g ?? 1;
      colors[index * 3 + 2] = color?.b ?? 1;
    }
    for (const name of Object.keys(geometry.attributes)) {
      if (name !== "position") geometry.deleteAttribute(name);
    }
    geometry.setAttribute("color", new Float32BufferAttribute(colors, 3));
    geometries.push(geometry);
    meshes.push(object);
  });
  for (const mesh of meshes) mesh.parent?.remove(mesh);
  const geometry = mergeGeometries(geometries, false);
  if (geometry === null) throw new Error("TN_FOX_NATIVE_AGGRESSIVE_SCENE_MERGE_FAILED");
  scene.add(new Mesh(geometry, new MeshBasicMaterial({ vertexColors: true })));
  console.info(
    `TN_FOX_NATIVE_AGGRESSIVE_SCENE_MERGE:sourceMeshes=${meshes.length};mergedMeshes=1;vertices=${totalVertices};triangles=${totalTriangles}`,
  );
}

function mergeStaticSceneMeshes(scene: any): void {
  scene.updateWorldMatrix(true, true);
  const geometries: any[] = [];
  const meshes: any[] = [];
  const isDynamic = (object: any): boolean => {
    for (let current = object; current !== null; current = current.parent) {
      if (
        current.isCamera === true ||
        current.userData?.threeNativeDynamic === true ||
        current.userData?.kind !== undefined
      )
        return true;
    }
    return false;
  };
  scene.traverse((object: any) => {
    if (object.isMesh !== true || isDynamic(object)) return;
    const geometry = object.geometry.clone().toNonIndexed().applyMatrix4(object.matrixWorld);
    const position = geometry.getAttribute("position");
    const color = object.material?.color;
    const colors = new Float32Array(position.count * 3);
    for (let index = 0; index < position.count; index += 1) {
      colors[index * 3] = color?.r ?? 1;
      colors[index * 3 + 1] = color?.g ?? 1;
      colors[index * 3 + 2] = color?.b ?? 1;
    }
    for (const name of Object.keys(geometry.attributes)) {
      if (name !== "position") geometry.deleteAttribute(name);
    }
    geometry.setAttribute("color", new Float32BufferAttribute(colors, 3));
    geometries.push(geometry);
    meshes.push(object);
  });
  for (const mesh of meshes) mesh.parent?.remove(mesh);
  const geometry = mergeGeometries(geometries, false);
  if (geometry === null) throw new Error("TN_FOX_NATIVE_STATIC_MERGE_FAILED");
  scene.add(new Mesh(geometry, new MeshBasicMaterial({ vertexColors: true })));
  console.info(`TN_FOX_NATIVE_STATIC_MERGE:sourceMeshes=${meshes.length};mergedMeshes=1`);
}

const GEOMETRY_FINGERPRINTS = new WeakMap<object, string>();

function geometryFingerprint(geometry: any): string {
  const cached = GEOMETRY_FINGERPRINTS.get(geometry);
  if (cached !== undefined) return cached;
  let hash = 2166136261;
  const addBytes = (bytes: Uint8Array): void => {
    for (const byte of bytes) hash = Math.imul(hash ^ byte, 16777619);
  };
  const addText = (value: string): void => addBytes(new TextEncoder().encode(value));
  addText(geometry.index?.array?.constructor.name ?? "no-index");
  if (geometry.index?.array !== undefined) {
    const index = geometry.index.array;
    addBytes(new Uint8Array(index.buffer, index.byteOffset, index.byteLength));
  }
  for (const name of Object.keys(geometry.attributes).sort()) {
    const attribute = geometry.attributes[name];
    addText(`${name}:${attribute.itemSize}:${attribute.normalized}:${attribute.array.constructor.name}`);
    addBytes(new Uint8Array(attribute.array.buffer, attribute.array.byteOffset, attribute.array.byteLength));
  }
  const fingerprint = String(hash >>> 0);
  GEOMETRY_FINGERPRINTS.set(geometry, fingerprint);
  return fingerprint;
}

function instanceSceneMeshes(scene: any): void {
  scene.updateWorldMatrix(true, true);
  const groups = new Map<string, { geometry: any; material: any; meshes: any[] }>();
  const meshes: any[] = [];
  scene.traverse((object: any) => {
    if (object.isMesh !== true || Array.isArray(object.material)) return;
    const key = `${object.material.uuid}|${geometryFingerprint(object.geometry)}`;
    const group = groups.get(key) ?? { geometry: object.geometry, material: object.material, meshes: [] };
    group.meshes.push(object);
    groups.set(key, group);
    meshes.push(object);
  });
  for (const mesh of meshes) mesh.parent?.remove(mesh);
  for (const group of groups.values()) {
    const instances = new InstancedMesh(group.geometry, group.material, group.meshes.length);
    instances.castShadow = true;
    instances.receiveShadow = true;
    instances.frustumCulled = false;
    for (let index = 0; index < group.meshes.length; index += 1)
      instances.setMatrixAt(index, group.meshes[index].matrixWorld);
    instances.instanceMatrix.needsUpdate = true;
    scene.add(instances);
  }
  console.info(`TN_FOX_NATIVE_INSTANCED_SCENE:sourceMeshes=${meshes.length};groups=${groups.size}`);
}

function instanceMarkedDynamicGroups(scene: any, excluded: Set<any>): void {
  const roots: any[] = [];
  scene.traverse((object: any) => {
    const markedRoot =
      object !== scene &&
      object.userData?.threeNativeDynamic === true &&
      !excluded.has(object) &&
      object.parent?.userData?.threeNativeDynamic !== true &&
      object.userData?.streaks === undefined &&
      object.userData?.cloth === undefined &&
      object.userData?.hub === undefined;
    const kindRoot =
      object !== scene &&
      object.userData?.kind !== undefined &&
      !excluded.has(object) &&
      object.parent?.userData?.kind === undefined;
    if (markedRoot || kindRoot) roots.push(object);
  });
  const groups = new Map<string, { geometry: any; material: any; entries: any[] }>();
  let sourceMeshes = 0;
  for (const root of roots) {
    root.updateWorldMatrix(true, true);
    const inverse = root.matrixWorld.clone().invert();
    const meshes: any[] = [];
    root.traverse((object: any) => {
      if (object.isMesh !== true || Array.isArray(object.material)) return;
      const localMatrix = new Matrix4().multiplyMatrices(inverse, object.matrixWorld);
      const key = `${object.material.uuid}|${geometryFingerprint(object.geometry)}`;
      const group = groups.get(key) ?? { geometry: object.geometry, material: object.material, entries: [] };
      group.entries.push({ localMatrix, root });
      groups.set(key, group);
      meshes.push(object);
      sourceMeshes += 1;
    });
    for (const mesh of meshes) mesh.parent?.remove(mesh);
  }
  for (const group of groups.values()) {
    const instances = new InstancedMesh(group.geometry, group.material, group.entries.length);
    instances.castShadow = true;
    instances.receiveShadow = true;
    instances.frustumCulled = false;
    const world = new Matrix4();
    const hidden = new Matrix4().setPosition(1e6, 1e6, 1e6);
    for (let index = 0; index < group.entries.length; index += 1) {
      const entry = group.entries[index];
      instances.setMatrixAt(index, world.multiplyMatrices(entry.root.matrixWorld, entry.localMatrix));
    }
    instances.instanceMatrix.needsUpdate = true;
    instances.onBeforeRender = () => {
      for (let index = 0; index < group.entries.length; index += 1) {
        const entry = group.entries[index];
        if (entry.root.parent === null || entry.root.visible !== true) instances.setMatrixAt(index, hidden);
        else instances.setMatrixAt(index, world.multiplyMatrices(entry.root.matrixWorld, entry.localMatrix));
      }
      instances.instanceMatrix.needsUpdate = true;
    };
    scene.add(instances);
  }
  console.info(`TN_FOX_NATIVE_DYNAMIC_INSTANCED:roots=${roots.length};sourceMeshes=${sourceMeshes};groups=${groups.size}`);
}

function gpuTransformMergeScene(scene: any, excluded: Set<any>): void {
  scene.updateWorldMatrix(true, true);
  const roots: any[] = [];
  scene.traverse((object: any) => {
    const markedRoot =
      object !== scene &&
      object.userData?.threeNativeDynamic === true &&
      !excluded.has(object) &&
      object.parent?.userData?.threeNativeDynamic !== true;
    const kindRoot =
      object !== scene &&
      object.userData?.kind !== undefined &&
      !excluded.has(object) &&
      object.parent?.userData?.kind === undefined;
    if (markedRoot || kindRoot) roots.push(object);
  });
  const rootSet = new Set(roots);
  const isStaticProbeRoot = (_root: any): boolean => false;
  const dynamicRootFor = (object: any): any => {
    if (rootSet.has(object)) return isStaticProbeRoot(object) ? undefined : object;
    for (let current = object.parent; current !== null && current !== scene; current = current.parent) {
      if (rootSet.has(current)) return isStaticProbeRoot(current) ? undefined : current;
    }
    return undefined;
  };
  const transformOwnerFor = (object: any, dynamicRoot: any): any => {
    for (let current = object; current !== dynamicRoot; current = current.parent) {
      if (current.userData?.threeNativeTransformOwner === true) return current;
    }
    return dynamicRoot;
  };
  const staticGroups = new Map<string, { material: any; chunks: any[]; chunk: number }>();
  const dynamicGroups = new Map<string, { material: any; chunks: any[]; mode: "matrix" | "translation" }>();
  const dynamicMeshes = new Set<any>();
  const matrixOwnerIndices = new Map<any, number>();
  const translationOwnerIndices = new Map<any, number>();
  const matrices: { index: number; mode: "matrix"; root: any; path: any[]; object: any }[] = [];
  const translations: { index: number; mode: "translation"; root: any; path: any[]; object: any }[] = [];
  let staticVertices = 0;
  let dynamicVertices = 0;
  const makePath = (owner: any, root: any): any[] => {
    if (owner === root) return [];
    const path: any[] = [];
    for (let current = owner; current !== root; current = current.parent) path.unshift(current);
    return path;
  };
  let sourceMeshes = 0;
  scene.traverse((object: any) => {
    if (object.isMesh !== true || object.geometry?.getAttribute("position") === undefined) return;
    const dynamicRoot = dynamicRootFor(object);
    const transformOwner = dynamicRoot === undefined ? undefined : transformOwnerFor(object, dynamicRoot);
    const transformMode = "matrix" as const;
    const localMatrix =
      dynamicRoot === undefined
        ? object.matrixWorld
        : new Matrix4().copy(transformOwner.matrixWorld).invert().multiply(object.matrixWorld);
    if (transformMode === "translation") {
      const ownerLinear = new Matrix4().copy(transformOwner.matrixWorld);
      ownerLinear.setPosition(0, 0, 0);
      localMatrix.premultiply(ownerLinear);
    }
    const sourceGeometry = (object.geometry.index ? object.geometry.toNonIndexed() : object.geometry.clone()).applyMatrix4(
      localMatrix,
    );
    const position = sourceGeometry.getAttribute("position");
    for (const name of Object.keys(sourceGeometry.attributes)) {
      if (name !== "position") sourceGeometry.deleteAttribute(name);
    }
    const transparent = object.material?.transparent === true;
    const color = object.material?.color;
    const colorItemSize = 4;
    const colors = new Float32Array(position.count * colorItemSize);
    for (let index = 0; index < position.count; index += 1) {
      colors[index * colorItemSize] = color?.r ?? 1;
      colors[index * colorItemSize + 1] = color?.g ?? 1;
      colors[index * colorItemSize + 2] = color?.b ?? 1;
      colors[index * colorItemSize + 3] = object.material?.opacity ?? 1;
    }
    sourceGeometry.setAttribute("color", new Float32BufferAttribute(colors, colorItemSize));
    const key = transparent
      ? `transparent|${object.material?.side ?? 0}|${object.material?.depthWrite ?? true}`
      : `opaque|${object.material?.side ?? 0}`;
    if (dynamicRoot === undefined) {
      staticVertices += position.count;
      const chunk = 0;
      const groupKey = `${key}|chunk=${chunk}`;
      const group = staticGroups.get(groupKey) ?? { material: object.material, chunks: [], chunk };
      group.chunks.push(sourceGeometry);
      staticGroups.set(groupKey, group);
    } else {
      dynamicVertices += position.count;
      dynamicMeshes.add(object);
      const ownerIndices = transformMode === "translation" ? translationOwnerIndices : matrixOwnerIndices;
      const entries = transformMode === "translation" ? translations : matrices;
      let matrixIndex = ownerIndices.get(transformOwner);
      if (matrixIndex === undefined) {
        matrixIndex = entries.length;
        ownerIndices.set(transformOwner, matrixIndex);
        entries.push({
          index: matrixIndex,
          mode: transformMode,
          object: transformOwner,
          path: makePath(transformOwner, dynamicRoot),
          root: dynamicRoot,
        } as never);
      }
      const objectIds = new Uint32Array(position.count);
      objectIds.fill(matrixIndex);
      sourceGeometry.setAttribute(
        transformMode === "translation" ? "tnTranslationId" : "tnObjectId",
        new Uint32BufferAttribute(objectIds, 1),
      );
      const groupKey = `${transformMode}|${key}`;
      const group = dynamicGroups.get(groupKey) ?? { material: object.material, chunks: [], mode: transformMode };
      group.chunks.push(sourceGeometry);
      dynamicGroups.set(groupKey, group);
    }
    sourceMeshes += 1;
  });
  const sourceToRemove: any[] = [];
  scene.traverse((object: any) => {
    if (object.isMesh === true && object.geometry?.getAttribute("position") !== undefined) sourceToRemove.push(object);
  });
  for (const object of sourceToRemove) if (!dynamicMeshes.has(object)) object.parent?.remove(object);
  const transformRoot = new Object3D();
  transformRoot.updateMatrixWorld(true);
  for (const root of roots) transformRoot.attach(root);
  const transformData = new Float32Array(matrices.length * 16);
  const translationData = new Float32Array(translations.length * 4);
  for (let index = 0; index < matrices.length; index += 1)
    transformData.set(matrices[index].object.matrixWorld.elements, index * 16);
  for (let index = 0; index < translations.length; index += 1) {
    const elements = translations[index].object.matrixWorld.elements;
    translationData.set([elements[12], elements[13], elements[14], 0], index * 4);
  }
  const transformAttribute = new StorageBufferAttribute(transformData, 16);
  const translationAttribute = new StorageBufferAttribute(translationData, 4);
  const transformNode = storage(transformAttribute, "mat4", matrices.length);
  const translationNode = storage(translationAttribute, "vec4", translations.length);
  const objectIdNode = attribute("tnObjectId", "uint");
  const translationIdNode = attribute("tnTranslationId", "uint");
  const matrixPositionNode = transformNode.element(objectIdNode).mul(vec4(positionLocal, 1)).xyz;
  const translationPositionNode = positionLocal.add(translationNode.element(translationIdNode).xyz);
  let transformUpdateCalls = 0;
  let transformUpdateElapsed = 0;
  let transformUpdateMax = 0;
  const updateDynamicTransforms = (): void => {
    const startedAt = globalThis.performance?.now() ?? 0;
    const world = new Matrix4();
    for (const root of roots) {
      root.updateMatrix();
      root.matrixWorld.copy(root.matrix);
    }
    for (const entry of matrices) {
      let visible = entry.root.parent !== null && entry.root.visible === true;
      for (const node of entry.path) {
        node.updateMatrix();
        visible = visible && node.visible === true;
      }
      if (entry.path.length > 0) {
        world.copy(entry.root.matrixWorld);
        for (const node of entry.path) world.multiply(node.matrix);
        entry.object.matrixWorld.copy(world);
      }
      const offset = entry.index * 16;
      transformData.set(entry.object.matrixWorld.elements, offset);
      if (!visible) {
        transformData[offset + 12] = 1e6;
        transformData[offset + 13] = 1e6;
        transformData[offset + 14] = 1e6;
      }
    }
    for (const entry of translations) {
      let visible = entry.root.parent !== null && entry.root.visible === true;
      for (const node of entry.path) {
        node.updateMatrix();
        visible = visible && node.visible === true;
      }
      if (entry.path.length > 0) {
        world.copy(entry.root.matrixWorld);
        for (const node of entry.path) world.multiply(node.matrix);
        entry.object.matrixWorld.copy(world);
      }
      const offset = entry.index * 4;
      const elements = entry.object.matrixWorld.elements;
      translationData[offset] = visible ? elements[12] : 1e6;
      translationData[offset + 1] = visible ? elements[13] : 1e6;
      translationData[offset + 2] = visible ? elements[14] : 1e6;
      translationData[offset + 3] = 0;
    }
    if (matrices.length > 0) transformAttribute.needsUpdate = true;
    if (translations.length > 0) translationAttribute.needsUpdate = true;
    const elapsed = (globalThis.performance?.now() ?? startedAt) - startedAt;
    transformUpdateCalls += 1;
    transformUpdateElapsed += elapsed;
    transformUpdateMax = Math.max(transformUpdateMax, elapsed);
    if (transformUpdateCalls === PROBE_FRAME_RATE_WARMUP + 300)
      console.info(
        `TN_FOX_NATIVE_GPU_TRANSFORM_UPDATE:calls=${transformUpdateCalls};avgMs=${(transformUpdateElapsed / transformUpdateCalls).toFixed(3)};maxMs=${transformUpdateMax.toFixed(3)}`,
      );
  };
  const makeMaterial = (sourceMaterial: any): MeshBasicNodeMaterial => {
    const material = new MeshBasicNodeMaterial({
      depthWrite: sourceMaterial?.depthWrite ?? true,
      opacity: 1,
      side: sourceMaterial?.side ?? 0,
      transparent: sourceMaterial?.transparent ?? false,
      vertexColors: true,
    });
    return material;
  };
  let mergedMeshes = 0;
  let dynamicUpdateAttached = false;
  for (const group of staticGroups.values()) {
    const geometry = mergeGeometries(group.chunks, false);
    if (geometry === null) continue;
    const mesh = new Mesh(geometry, makeMaterial(group.material));
    geometry.computeBoundingSphere();
    mesh.frustumCulled = true;
    scene.add(mesh);
    mergedMeshes += 1;
  }
  for (const group of dynamicGroups.values()) {
    const geometry = mergeGeometries(group.chunks, false);
    if (geometry === null) continue;
    const material = makeMaterial(group.material);
    material.positionNode = group.mode === "translation" ? translationPositionNode : matrixPositionNode;
    const mesh = new Mesh(geometry, material);
    mesh.frustumCulled = false;
    if (PROBE_UPDATE_DYNAMIC_TRANSFORMS && !dynamicUpdateAttached) {
      mesh.onBeforeRender = updateDynamicTransforms;
      dynamicUpdateAttached = true;
    }
    scene.add(mesh);
    mergedMeshes += 1;
  }
  console.info(
    `TN_FOX_NATIVE_GPU_TRANSFORM_MERGE:sourceMeshes=${sourceMeshes};dynamicRoots=${roots.length};transformEntries=${matrices.length + translations.length};matrixEntries=${matrices.length};translationEntries=${translations.length};mergedMeshes=${mergedMeshes}`,
  );
  console.info(`TN_FOX_NATIVE_GPU_TRANSFORM_VERTICES:static=${staticVertices};dynamic=${dynamicVertices}`);
}

function flattenMarkedDynamicGroups(scene: any, excluded: Set<any>): void {
  const roots: any[] = [];
  scene.traverse((object: any) => {
    if (
      object !== scene &&
      object.userData?.threeNativeDynamic === true &&
      !excluded.has(object) &&
      object.parent?.userData?.threeNativeDynamic !== true &&
      object.userData?.streaks === undefined &&
      object.userData?.cloth === undefined
    )
      roots.push(object);
    if (
      object !== scene &&
      object.userData?.kind !== undefined &&
      !excluded.has(object) &&
      object.parent?.userData?.kind === undefined
    )
      roots.push(object);
  });
  let sourceMeshes = 0;
  for (const root of roots) {
    root.updateWorldMatrix(true, true);
    const inverse = root.matrixWorld.clone().invert();
    const geometries: any[] = [];
    const meshes: any[] = [];
    root.traverse((object: any) => {
      if (object.isMesh !== true) return;
      const geometry = object.geometry.clone().toNonIndexed().applyMatrix4(inverse).applyMatrix4(object.matrixWorld);
      const position = geometry.getAttribute("position");
      const color = object.material?.color;
      const colors = new Float32Array(position.count * 3);
      for (let index = 0; index < position.count; index += 1) {
        colors[index * 3] = color?.r ?? 1;
        colors[index * 3 + 1] = color?.g ?? 1;
        colors[index * 3 + 2] = color?.b ?? 1;
      }
      for (const name of Object.keys(geometry.attributes)) {
        if (name !== "position") geometry.deleteAttribute(name);
      }
      geometry.setAttribute("color", new Float32BufferAttribute(colors, 3));
      geometries.push(geometry);
      meshes.push(object);
    });
    for (const mesh of meshes) mesh.parent?.remove(mesh);
    const geometry = mergeGeometries(geometries, false);
    if (geometry === null) continue;
    root.add(new Mesh(geometry, new MeshBasicMaterial({ vertexColors: true })));
    sourceMeshes += meshes.length;
  }
  console.info(`TN_FOX_NATIVE_DYNAMIC_FLATTEN:groups=${roots.length};sourceMeshes=${sourceMeshes}`);
}

function batchMarkedDynamicGroups(scene: any, excluded: Set<any>): void {
  const roots: any[] = [];
  scene.traverse((object: any) => {
    const markedRoot =
      object !== scene &&
      object.userData?.threeNativeDynamic === true &&
      !excluded.has(object) &&
      object.parent?.userData?.threeNativeDynamic !== true &&
      object.userData?.streaks === undefined &&
      object.userData?.cloth === undefined &&
      object.userData?.hub === undefined;
    const kindRoot =
      object !== scene &&
      object.userData?.kind !== undefined &&
      !excluded.has(object) &&
      object.parent?.userData?.kind === undefined;
    if (markedRoot || kindRoot) roots.push(object);
  });
  const geometries: any[] = [];
  const segments: { root: any; positions: Float32Array; offset: number; count: number }[] = [];
  let sourceMeshes = 0;
  let vertexOffset = 0;
  for (const root of roots) {
    root.updateWorldMatrix(true, true);
    const inverse = root.matrixWorld.clone().invert();
    const rootGeometries: any[] = [];
    const meshes: any[] = [];
    root.traverse((object: any) => {
      if (object.isMesh !== true) return;
      const geometry = object.geometry.clone().toNonIndexed().applyMatrix4(inverse).applyMatrix4(object.matrixWorld);
      const position = geometry.getAttribute("position");
      const color = object.material?.color;
      const colors = new Float32Array(position.count * 3);
      for (let index = 0; index < position.count; index += 1) {
        colors[index * 3] = color?.r ?? 1;
        colors[index * 3 + 1] = color?.g ?? 1;
        colors[index * 3 + 2] = color?.b ?? 1;
      }
      for (const name of Object.keys(geometry.attributes)) {
        if (name !== "position") geometry.deleteAttribute(name);
      }
      geometry.setAttribute("color", new Float32BufferAttribute(colors, 3));
      rootGeometries.push(geometry);
      meshes.push(object);
    });
    for (const mesh of meshes) mesh.parent?.remove(mesh);
    const geometry = mergeGeometries(rootGeometries, false);
    if (geometry === null) continue;
    const positions = new Float32Array(geometry.getAttribute("position").array);
    geometries.push(geometry);
    segments.push({ root, positions, offset: vertexOffset, count: geometry.getAttribute("position").count });
    vertexOffset += geometry.getAttribute("position").count;
    sourceMeshes += meshes.length;
  }
  const geometry = mergeGeometries(geometries, false);
  if (geometry === null) {
    console.info("TN_FOX_NATIVE_DYNAMIC_BATCH:groups=0;sourceMeshes=0");
    return;
  }
  const batch = new Mesh(geometry, new MeshBasicMaterial({ vertexColors: true }));
  batch.frustumCulled = false;
  const destination = geometry.getAttribute("position");
  const point = new Vector3();
  const update = (): void => {
    const target = destination.array as Float32Array;
    for (const segment of segments) {
      const elements = segment.root.matrixWorld.elements;
      for (let vertex = 0; vertex < segment.count; vertex += 1) {
        const source = (vertex * 3);
        point.set(segment.positions[source], segment.positions[source + 1], segment.positions[source + 2]);
        const x = point.x;
        const y = point.y;
        const z = point.z;
        const visible = segment.root.parent !== null && segment.root.visible === true;
        const destinationOffset = (segment.offset + vertex) * 3;
        if (!visible) {
          target[destinationOffset] = 1e6;
          target[destinationOffset + 1] = 1e6;
          target[destinationOffset + 2] = 1e6;
          continue;
        }
        target[destinationOffset] = elements[0] * x + elements[4] * y + elements[8] * z + elements[12];
        target[destinationOffset + 1] = elements[1] * x + elements[5] * y + elements[9] * z + elements[13];
        target[destinationOffset + 2] = elements[2] * x + elements[6] * y + elements[10] * z + elements[14];
      }
    }
    destination.needsUpdate = true;
  };
  batch.onBeforeRender = update;
  scene.add(batch);
  console.info(`TN_FOX_NATIVE_DYNAMIC_BATCH:groups=${segments.length};sourceMeshes=${sourceMeshes}`);
}

export class Play extends Scene<GameState, undefined> {
  #frameRateFrames = 0;
  #frameRateStartedAt: number | undefined;
  #frameRateEmitted = false;
  #lastFrameAt: number | undefined;
  #windowFrames = 0;
  #windowIndex = 0;
  #worstFrameMs = 0;

  static override readonly initialState: GameState = {
    coins: 0,
    finished: false,
    gemTotal: GEMS.length,
    gems: 0,
    hearts: 3,
    playerX: -5,
    running: true,
    stars: 0,
    time: 0,
    toast: "",
  };

  override render(): void {
    this.#frameRateFrames += 1;
    const now = globalThis.performance?.now();
    if (typeof now !== "number" || !Number.isFinite(now)) {
      console.error(`TN_FOX_NATIVE_FRAME_RATE_MISSING:window=${profile.frameWindow}`);
      return;
    }
    if (this.#frameRateFrames <= profile.warmupFrames) {
      this.#lastFrameAt = now;
      return;
    }
    if (this.#frameRateStartedAt === undefined) {
      this.#frameRateStartedAt = now;
      this.#lastFrameAt = now;
      this.#windowFrames = 0;
      this.#worstFrameMs = 0;
      console.info(
        `TN_ANDROID_JS_WINDOW_START:${JSON.stringify({ frameWindow: profile.frameWindow })}`,
      );
      return;
    }
    const frameMs = now - (this.#lastFrameAt ?? now);
    this.#lastFrameAt = now;
    if (frameMs > this.#worstFrameMs) this.#worstFrameMs = frameMs;
    this.#windowFrames += 1;
    if (this.#windowFrames < profile.frameWindow) return;

    const elapsedMs = now - this.#frameRateStartedAt;
    if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) {
      console.error(`TN_FOX_NATIVE_FRAME_RATE_MISSING:window=${profile.frameWindow}`);
      return;
    }
    const frames = this.#windowFrames;
    const fps = (frames * 1000) / elapsedMs;
    if (!this.#frameRateEmitted) {
      console.info(
        `TN_ANDROID_JS_FRAME:${JSON.stringify({
          elapsedMs,
          frames,
          msPerFrame: elapsedMs / frames,
        })}`,
      );
      this.#frameRateEmitted = true;
    }
    console.info(
      `TN_FOX_NATIVE_FRAME_RATE:window=${this.#windowIndex};frames=${frames};elapsedMs=${elapsedMs.toFixed(3)};fps=${fps.toFixed(3)};worstFrameMs=${this.#worstFrameMs.toFixed(3)}`,
    );
    this.#windowIndex += 1;
    this.#windowFrames = 0;
    this.#worstFrameMs = 0;
    this.#frameRateStartedAt = now;
  }

  override enter(ctx: GameCtx): SceneFrame<GameState, undefined> {
    const scene = ctx.scene;
    const camera = ctx.camera as PerspectiveCamera;
    if (PROBE_RENDER_SCALE !== 1) {
      const { width, height } = ctx.renderer.domElement;
      ctx.renderer.setSize(Math.max(1, Math.round(width * PROBE_RENDER_SCALE)), Math.max(1, Math.round(height * PROBE_RENDER_SCALE)), false);
      console.info(`TN_FOX_NATIVE_RENDER_SCALE:width=${width};height=${height};scale=${PROBE_RENDER_SCALE}`);
    }
    const rng = makeRng(90210);

    createSky(scene);
    const { sun } = createLights(scene);
    if ((globalThis as any).__TN_PROBE_SHADOWS__ === false) sun.castShadow = false;
    const updateClouds = createClouds(scene, rng);
    const level = new Level(scene, rng).build({ defer: DEFER_FAR_LEVEL });
    if (PROBE_MERGE_LEVEL) mergeLevelMeshes(level.renderRoot);
    if (PROBE_BATCH_LEVEL) batchLevelMeshes(level.renderRoot);
    if (PROBE_AGGRESSIVE_MERGE) aggressivelyMergeLevelMeshes(level.renderRoot);
    if (PROBE_FREEZE_LEVEL) {
      scene.updateMatrixWorld(true);
      level.renderRoot.updateMatrixWorld = () => undefined;
    }

    const fox = createFox();
    fox.group.userData.threeNativeDynamic = true;
    scene.add(fox.group);

    // ---------------------------------------------------------------- pickups
    const pickups: Pickup[] = [];
    const addPickup = (kind: string, x: number, y: number, z = 0): void => {
      const mesh = kind === "coin" ? coin() : kind === "gem" ? gem() : star();
      mesh.position.set(x, y, z);
      scene.add(mesh);
      pickups.push({ home: mesh.position.clone(), kind, mesh, taken: false });
    };

    for (let i = 0; i < 9; i++) addPickup("coin", -5 + i * 1.6, 1.25, Math.sin(i * 0.9) * 1.4);
    for (let i = 0; i < 8; i++) addPickup("coin", 12 + i * 2, 1.25, i % 2 ? 1.6 : -1.4);
    for (const p of coinArc([30, 1.3, 0], [34, 2.8, 0], 6, 1.6)) addPickup("coin", p.x, p.y, p.z);
    for (const [x, y, z] of [
      [45.5, 4.6, 1.2],
      [48, 5.6, 0],
      [50.5, 6.2, -1.4],
      [52.8, 7, 0],
      [55, 7.6, 1],
    ] as const)
      addPickup("coin", x, y, z);
    for (const p of coinArc([41, 3, 0], [45.5, 4.4, 1.2], 4, 1.2)) addPickup("coin", p.x, p.y, p.z);
    for (let i = 0; i < 10; i++)
      addPickup("coin", 60 + i * 1.4, 4.25, -0.4 + Math.sin(i * 0.7) * 1.8);
    for (let i = 0; i < 6; i++) addPickup("coin", 75 + i * 1.3, 4.4 + Math.sin(i * 0.8) * 0.5, 0);
    for (let i = 0; i < 5; i++) addPickup("coin", 84 + i * 1.5, 4.25, i % 2 ? 1.5 : -1.5);
    for (const [x, y, z] of GEMS) addPickup("gem", x, y, z);
    for (const [x, y, z] of [
      [24, 6, 2.6],
      [55, 9, 1],
      [94.5, 5, 0],
    ] as const)
      addPickup("star", x, y, z);

    // ---------------------------------------------------------------- enemies
    const enemies: Enemy[] = [];
    const addEnemy = (
      kind: string,
      x: number,
      y: number,
      z: number,
      from: number,
      to: number,
      speed = 2,
    ): void => {
      const mesh = kind === "mushroom" ? mushroom() : snail();
      mesh.position.set(x, y, z);
      scene.add(mesh);
      enemies.push({ alive: true, dir: 1, from, kind, mesh, speed, squash: 0, to, y });
    };
    addEnemy("snail", 22, 0, 2.4, 18, 28, 1.2);
    addEnemy("mushroom", 37, 1.5, 0, 34.8, 40.2, 2.4);
    addEnemy("mushroom", 63, 3, -1.5, 60, 68, 2.6);
    addEnemy("mushroom", 71, 3, 1.8, 67, 73.5, 2.2);
    addEnemy("snail", 87, 3, 2.6, 83.5, 92, 1.1);

    // ---------------------------------------------------------------- player
    const player = {
      coyote: 0,
      dashCooldown: 0,
      dashTime: 0,
      facing: 1,
      finished: false,
      grounded: false,
      hearts: 3,
      invuln: 0,
      jumpBuffer: 0,
      jumps: 0,
      pos: level.spawn.clone() as Vector3,
      vel: new Vector3(),
    };
    ctx.entities.add("player", {
      // `mesh` (or `object`) must be an Object3D or the playtest bridge reports no
      // position for this entity and every `movement` assertion returns a null delta.
      mesh: fox.group,
      debug: () => ({
        grounded: player.grounded,
        hearts: player.hearts,
        x: player.pos.x,
        y: player.pos.y,
        z: player.pos.z,
      }),
    });

    let elapsed = 0;
    let toastUntil = 0;
    let coins = 0;
    let gems = 0;
    const effects: ((dt: number) => boolean)[] = [];
    const spawnBurst = (position: Vector3, color: number, count: number): void => {
      effects.push(burst(scene, position, color, count));
    };

    const toast = (text: string, seconds = 1.6): void => {
      ctx.state.set({ toast: text });
      toastUntil = elapsed + seconds;
    };

    const overlaps = (min: Vector3, max: Vector3, b: Box): boolean =>
      min.x < b.max.x &&
      max.x > b.min.x &&
      min.y < b.max.y &&
      max.y > b.min.y &&
      min.z < b.max.z &&
      max.z > b.min.z;

    const moveAxis = (axis: "x" | "y" | "z", amount: number): void => {
      player.pos[axis] += amount;
      const center = player.pos.clone();
      center.y += HALF.y;
      const min = center.clone().sub(HALF);
      const max = center.clone().add(HALF);
      for (const b of level.colliders as Box[]) {
        if (!overlaps(min, max, b)) continue;
        if (amount > 0) player.pos[axis] -= max[axis] - b.min[axis];
        else player.pos[axis] += b.max[axis] - min[axis];
        if (axis === "y") {
          if (amount < 0) {
            player.grounded = true;
            player.jumps = 0;
          }
          player.vel.y = 0;
        } else {
          player.vel[axis] = 0;
        }
        return;
      }
    };

    const damage = (n: number, knockDir: number): void => {
      if (player.invuln > 0 || player.finished) return;
      player.hearts = Math.max(0, player.hearts - n);
      player.invuln = 1.3;
      ctx.state.set({ hearts: player.hearts });
      toast(player.hearts > 0 ? "OUCH!" : "OUT OF HEARTS");
      if (knockDir !== 0) {
        player.vel.x = -knockDir * 7;
        player.vel.y = 7;
      }
      if (player.hearts === 0) {
        ctx.after(0.7, () => {
          player.hearts = 3;
          ctx.state.set({ hearts: 3 });
          player.pos.copy(level.spawn);
          player.vel.set(0, 0, 0);
        });
      }
    };

    const respawn = (): void => {
      let cp = level.checkpoints[0];
      for (const c of level.checkpoints) if (c.x <= player.pos.x + 2) cp = c;
      player.pos.set(cp.x, cp.y + 0.5, cp.z);
      player.vel.set(0, 0, 0);
      damage(1, 0);
    };

    camera.fov = 52;
    camera.near = 0.1;
    camera.far = 900;
    camera.updateProjectionMatrix();
    // The HUD is parented to the camera so it renders in the same pass as the world. The DOM
    // HUD in main.ts is web-only; this one is what desktop and Android actually show.
    const hud = new Hud();
    ctx.canvasLayer.scene.add(hud.group);
    const pointers = new Pointers(ctx.renderer.domElement);
    if ((globalThis as any).__TN_PROBE_HUD__ === false) hud.group.visible = false;
    ctx.scene.add(camera);
    hud.layout(ctx.viewport.size.width, ctx.viewport.size.height);
    ctx.viewport.onResize((size) => hud.layout(size.width, size.height));
    camera.position.copy(player.pos).add(CAM_OFFSET);
    const camTarget = new Vector3();
    const camPos = new Vector3();
    const cameraMeshes = new Set<any>();
    camera.traverse((object) => {
      if ((object as any).isMesh === true) cameraMeshes.add(object);
    });
    const workloadMeshes: any[] = [];
    scene.traverse((object) => {
      if ((object as any).isMesh === true && !cameraMeshes.has(object)) workloadMeshes.push(object);
    });
    console.info(
      `TN_ANDROID_JS_FOX_MESH_BREAKDOWN:total=${workloadMeshes.length + cameraMeshes.size};workload=${workloadMeshes.length};camera=${cameraMeshes.size}`,
    );
    // The size check is fail-closed on purpose: a benchmark whose subject quietly changed size
    // measures nothing. The merge and batch probes change it deliberately, though, so the check
    // asks whether one is active rather than whether the count moved — with none of them on it
    // is exactly as strict as before.
    const subjectRewritten =
      PROBE_MERGE_LEVEL ||
      PROBE_BATCH_LEVEL ||
      PROBE_AGGRESSIVE_MERGE ||
      PROBE_AGGRESSIVE_MERGE_SCENE ||
      PROBE_STATIC_MERGE_SCENE ||
      PROBE_INSTANCE_SCENE ||
      // Deferring the far half of the stage leaves it out of the subject at this moment; it is
      // built a beat later. The count is legitimately smaller, so the size check does not apply.
      DEFER_FAR_LEVEL;
    if (!subjectRewritten && workloadMeshes.length !== profile.meshes) {
      throw new Error(
        `TN_ANDROID_JS_FOX_MESH_COUNT_MISMATCH:expected=${profile.meshes};actual=${workloadMeshes.length}`,
      );
    }
    const visibleMeshes = Math.floor(workloadMeshes.length * profile.visibility);
    for (let index = visibleMeshes; index < workloadMeshes.length; index += 1) {
      workloadMeshes[index].visible = false;
    }
    console.info(`TN_FOX_NATIVE_MESH_PROBE:visibility=${profile.visibility};meshes=${workloadMeshes.length}`);
    console.info(`TN_ANDROID_JS_SUBJECT:${JSON.stringify({ ...profile, visibleMeshes })}`);
    if (PROBE_GPU_TRANSFORM_MERGE) gpuTransformMergeScene(scene, new Set([camera]));
    if (PROBE_AGGRESSIVE_MERGE_SCENE) aggressivelyMergeSceneMeshes(scene);
    if (PROBE_INSTANCE_SCENE) instanceSceneMeshes(scene);
    if (PROBE_STATIC_MERGE_SCENE) mergeStaticSceneMeshes(scene);
    if (PROBE_FLATTEN_DYNAMIC && !PROBE_BATCH_DYNAMIC)
      flattenMarkedDynamicGroups(scene, new Set([fox.group, camera]));
    if (PROBE_BATCH_DYNAMIC) batchMarkedDynamicGroups(scene, new Set([fox.group, camera]));
    if (PROBE_INSTANCE_DYNAMIC) instanceMarkedDynamicGroups(scene, new Set([fox.group, camera]));

    // Build every pipeline this scene needs before the loop starts drawing it. Without it each
    // material compiles inside the first frame that happens to use it, which on a phone is a
    // stall the player watches rather than a cost paid during load.
    if ((globalThis as any).__TN_PROBE_WARMUP__ !== false) {
      void ctx.renderer.compileAsync(scene, camera);
    }

    let gameUpdateCalls = 0;
    let gameUpdateElapsed = 0;
    let gameUpdateMax = 0;
    // Counts every pointer event the host delivers, so a frame-rate drop under input can be
    // attributed to event dispatch rather than to the game's own update.
    let pointerEventCount = 0;
    for (const type of ["pointerdown", "pointermove", "pointerup", "pointercancel"])
      ctx.renderer.domElement.addEventListener(type, () => {
        pointerEventCount += 1;
      });
    const loading = createLoadingScreen(ctx);
    // The far half of the stage is built once the screen is down and the player can see the game.
    // It is off screen at x>=34, so this is invisible; it only moves the work off the launch.
    let farLevelPending = DEFER_FAR_LEVEL;
    void ctx.startup.whenReady().then(() => {
      if (!farLevelPending) return;
      farLevelPending = false;
      level.buildLater();
      // The collapse has already run, so this geometry would otherwise stay one draw per mesh —
      // which is the cost the collapse exists to remove. Merging it as it arrives keeps the draw
      // count near where the collapse left it. It happens after the reveal, off the launch.
      mergeLevelMeshes(level.renderRoot);
    });

    return (frameCtx, dt) => {
      loading.update();
      const gameUpdateStartedAt = globalThis.performance?.now() ?? 0;
      const input = frameCtx.input;
      const touch = hud.readTouch(pointers.active.values());
      const move = input.vector("move");
      let mx = move.x + touch.x;
      let mz = -move.y + touch.z;
      const length = Math.hypot(mx, mz);
      if (length > 1) {
        mx /= length;
        mz /= length;
      }
      const wantsDash = input.pressed("dash") || touch.dash;
      const jumpHeld = input.pressed("jump") || hud.jumpHeld;
      if (input.justPressed("jump") || touch.jump) player.jumpBuffer = 0.14;

      if (wantsDash && player.dashCooldown <= 0 && (Math.abs(mx) > 0.1 || Math.abs(mz) > 0.1)) {
        player.dashTime = 0.22;
        player.dashCooldown = 0.55;
      }
      player.dashCooldown = Math.max(0, player.dashCooldown - dt);
      player.dashTime = Math.max(0, player.dashTime - dt);

      const dashing = player.dashTime > 0;
      const targetSpeed = dashing ? DASH : RUN;
      const wantX = mx * targetSpeed;
      const wantZ = mz * targetSpeed * 0.75;
      const accel = (player.grounded ? ACCEL : ACCEL * 0.55) * (dashing ? 3 : 1);
      player.vel.x = MathUtils.damp(
        player.vel.x,
        wantX,
        accel / Math.max(1, Math.abs(wantX - player.vel.x)) + 8,
        dt,
      );
      player.vel.z = MathUtils.damp(player.vel.z, wantZ, 12, dt);
      if (Math.abs(mx) > 0.15) player.facing = Math.sign(mx);

      player.coyote = player.grounded ? 0.12 : Math.max(0, player.coyote - dt);
      player.jumpBuffer = Math.max(0, player.jumpBuffer - dt);
      if (player.jumpBuffer > 0) {
        if (player.grounded || player.coyote > 0) {
          player.vel.y = JUMP_V;
          player.jumps = 1;
          player.jumpBuffer = 0;
          player.coyote = 0;
          player.grounded = false;
        } else if (player.jumps === 1) {
          player.vel.y = JUMP_V * 0.88;
          player.jumps = 2;
          player.jumpBuffer = 0;
        }
      }
      if (player.vel.y > 0 && !jumpHeld) player.vel.y -= GRAVITY * 1.1 * dt;
      player.vel.y -= GRAVITY * dt;
      player.vel.y = Math.max(player.vel.y, -34);

      player.grounded = false;
      moveAxis("x", player.vel.x * dt);
      moveAxis("z", player.vel.z * dt);
      moveAxis("y", player.vel.y * dt);
      player.pos.z = MathUtils.clamp(player.pos.z, -6.2, 5.2);
      if (player.pos.y < -28) respawn();
      player.invuln = Math.max(0, player.invuln - dt);

      fox.group.position.copy(player.pos);
      // `yaw` is the lean away from straight ahead, never the heading itself: the branch below
      // already owns left vs right. Feeding `player.facing` into the atan2 as well applied the
      // flip twice, so a pure-left stick gave atan2(0, -|vx|) = PI and a target of 270 degrees --
      // the model faces +Z, straight at the camera, instead of left.
      const yaw = Math.atan2(player.vel.z, Math.max(0.001, Math.abs(player.vel.x)));
      fox.group.rotation.y = MathUtils.damp(
        fox.group.rotation.y,
        player.facing > 0 ? -yaw * 0.5 : Math.PI + yaw * 0.5,
        8,
        dt,
      );
      const groundY = level.groundAt(player.pos.x, player.pos.z, player.pos.y + 0.1);
      fox.update({
        dashing,
        dt,
        grounded: player.grounded,
        groundY: groundY === Number.NEGATIVE_INFINITY ? player.pos.y - 8 : groundY,
        speed: Math.hypot(player.vel.x, player.vel.z),
        vy: player.vel.y,
      });
      fox.group.visible = player.invuln <= 0 || Math.floor(player.invuln * 14) % 2 === 0;

      const foxCentre = new Vector3(player.pos.x, player.pos.y + 0.8, player.pos.z);
      for (const p of pickups) {
        if (p.taken) continue;
        const m = p.mesh;
        if (p.kind === "coin") m.rotation.y += dt * 3.2;
        else if (p.kind === "gem") {
          m.rotation.y += dt * 1.8;
          m.rotation.x = Math.sin(elapsed * 2) * 0.2;
        } else m.rotation.y += dt * 1.4;
        m.position.y = p.home.y + Math.sin(elapsed * 2.4 + p.home.x) * 0.14;

        if (m.position.distanceTo(foxCentre) >= (p.kind === "coin" ? 1.15 : 1.4)) continue;
        p.taken = true;
        scene.remove(m);
        if (p.kind === "coin") {
          coins += 1;
          frameCtx.state.set({ coins });
          spawnBurst(m.position, C.gold, 8);
        } else if (p.kind === "gem") {
          gems += 1;
          frameCtx.state.set({ gems });
          spawnBurst(m.position, C.gem, 16);
          toast(`GEM ${gems}/${GEMS.length}`);
        } else {
          frameCtx.state.set((state) => ({ stars: state.stars + 1 }));
          spawnBurst(m.position, C.gold, 22);
          toast("STAR!");
        }
      }

      for (const e of enemies) {
        if (!e.alive) {
          e.squash += dt;
          e.mesh.scale.y = Math.max(0.02, 1 - e.squash * 3);
          e.mesh.scale.x = 1 + e.squash * 1.2;
          e.mesh.scale.z = e.mesh.scale.x;
          if (e.squash > 0.4) {
            scene.remove(e.mesh);
            e.mesh.visible = false;
          }
          continue;
        }
        e.mesh.position.x += e.dir * e.speed * dt;
        if (e.mesh.position.x > e.to) e.dir = -1;
        if (e.mesh.position.x < e.from) e.dir = 1;
        e.mesh.rotation.y = e.dir > 0 ? 0 : Math.PI;
        if (e.kind === "mushroom") {
          const hop = Math.abs(Math.sin(elapsed * 4 + e.from));
          e.mesh.position.y = e.y + hop * 0.28;
          e.mesh.scale.y = 1 - hop * 0.1;
        } else {
          e.mesh.position.y = e.y + Math.sin(elapsed * 2.5 + e.from) * 0.04;
        }

        const dx = Math.abs(e.mesh.position.x - player.pos.x);
        const dz = Math.abs(e.mesh.position.z - player.pos.z);
        const dy = player.pos.y - e.mesh.position.y;
        if (dx >= 0.95 || dz >= 0.95 || dy >= 1.5 || dy <= -1.1) continue;
        if (player.vel.y < -1 && dy > 0.45) {
          e.alive = false;
          player.vel.y = 12;
          player.jumps = 1;
          spawnBurst(
            e.mesh.position.clone().setY(e.mesh.position.y + 0.6),
            e.kind === "mushroom" ? C.capRed : C.shellRed,
            14,
          );
          toast("NICE!", 0.9);
        } else {
          damage(1, Math.sign(player.pos.x - e.mesh.position.x) || 1);
        }
      }

      if (!player.finished && player.pos.x > level.goalX - 0.8 && Math.abs(player.pos.y - 3) < 4) {
        player.finished = true;
        frameCtx.state.set({ finished: true });
        toast("LEVEL CLEAR!", 6);
      }

      camTarget.set(player.pos.x + 3.4 + player.vel.x * 0.14, player.pos.y + 2.6, player.pos.z * 0.5);
      camPos.copy(player.pos).add(CAM_OFFSET);
      camPos.y = Math.max(camPos.y, player.pos.y + 2.2);
      camera.position.lerp(camPos, 1 - 0.0018 ** dt);
      camera.lookAt(camTarget);

      if (PROBE_SUN_FOLLOW) {
        sun.position.set(player.pos.x - 40, 60, player.pos.z + 34);
        sun.target.position.copy(player.pos);
        sun.target.updateMatrixWorld();
      }

      for (let i = effects.length - 1; i >= 0; i--) {
        const effect = effects[i];
        if (effect !== undefined && effect(dt)) effects.splice(i, 1);
      }

      level.update(dt);
      updateClouds(dt);

      if (!player.finished) elapsed += dt;
      if (toastUntil !== 0 && elapsed > toastUntil) {
        toastUntil = 0;
        frameCtx.state.set({ toast: "" });
      }
      hud.update({
        coins,
        gemTotal: GEMS.length,
        gems,
        hearts: player.hearts,
        time: elapsed,
      });
      frameCtx.state.set({ playerX: player.pos.x, time: elapsed });
      const gameUpdateElapsedMs = (globalThis.performance?.now() ?? gameUpdateStartedAt) - gameUpdateStartedAt;
      gameUpdateCalls += 1;
      gameUpdateElapsed += gameUpdateElapsedMs;
      gameUpdateMax = Math.max(gameUpdateMax, gameUpdateElapsedMs);
      if (gameUpdateCalls % profile.frameWindow === 0) {
        console.info(
          `TN_FOX_NATIVE_GAME_UPDATE:calls=${gameUpdateCalls};avgMs=${(gameUpdateElapsed / profile.frameWindow).toFixed(3)};maxMs=${gameUpdateMax.toFixed(3)};pointers=${pointers.active.size};touchEvents=${pointerEventCount};drawCalls=${(ctx.renderer.raw as any)?.info?.render?.drawCalls ?? -1};renderCalls=${(ctx.renderer.raw as any)?.info?.render?.calls ?? -1};sceneChildren=${scene.children.length};foxX=${player.pos.x.toFixed(1)}`,
        );
        gameUpdateElapsed = 0;
        gameUpdateMax = 0;
        pointerEventCount = 0;
      }
    };
  }
}
