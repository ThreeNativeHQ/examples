// Generated for you. This is ordinary Three.js — edit or delete it freely.
// ThreeNative does not read this file.
//
// The lake, and one trick worth stealing.
//
// A water surface needs to know how deep the water is under each point — that is what makes a
// shore fade instead of ending at a hard line. The usual way is to sample the depth buffer in the
// shader, which is a whole render-target dance. This lake does not move and neither does the
// ground under it, so the depth is baked **once, per vertex, at build time**, straight out of the
// same `heightAt` the terrain and the collider use. Shallow water gets the silt colour and goes
// transparent; deep water goes dark and opaque. No second pass, no depth texture.
//
// What is left for the shader is the only thing that actually changes: the ripples.
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  Mesh,
  Vector2,
} from "three";
import { MeshStandardNodeMaterial } from "three/webgpu";
import { attribute, float, positionLocal, sin, time, vec3 } from "three/tsl";
import { palette } from "./palette.js";
import { WATER_LEVEL, heightAt } from "./terrain.js";

/** How deep the water has to be before it reads as fully opaque. */
const OPAQUE_DEPTH = 2.6;

export interface IWater {
  readonly mesh: Mesh;
  /** True when a point is over water — the scene uses it to report wading. */
  readonly covers: (x: number, z: number) => boolean;
  readonly level: number;
}

/**
 * Build a lake surface over a circular patch of the valley.
 *
 * The grid is generous around the lake's nominal radius because the shoreline is where `heightAt`
 * happens to cross zero, not where the basin was drawn — the noise the basin is subtracted from
 * pushes the real waterline in and out by several metres, which is exactly what makes it look
 * like a shore instead of a drawn circle.
 */
export function createWater(centre: Vector2, radius: number, samples = 96): IWater {
  const span = radius * 2.4;
  const step = span / (samples - 1);
  const half = span / 2;
  const vertexCount = samples * samples;

  const positions = new Float32Array(vertexCount * 3);
  const colors = new Float32Array(vertexCount * 3);
  // A plain float attribute rather than a fourth colour channel: opacity and colour are separate
  // decisions, and packing them together is how a shallows tint ends up controlling transparency.
  const depths = new Float32Array(vertexCount);

  const shallow = new Color(palette.silt).lerp(new Color(palette.water), 0.45);
  const deep = new Color(palette.water).multiplyScalar(0.6);
  const colour = new Color();

  for (let ix = 0; ix < samples; ix += 1) {
    for (let iz = 0; iz < samples; iz += 1) {
      const index = ix * samples + iz;
      const x = centre.x - half + ix * step;
      const z = centre.y - half + iz * step;
      const depth = Math.max(0, WATER_LEVEL - heightAt(x, z));
      positions[index * 3] = x;
      positions[index * 3 + 1] = WATER_LEVEL;
      positions[index * 3 + 2] = z;
      depths[index] = Math.min(1, depth / OPAQUE_DEPTH);
      colour.copy(shallow).lerp(deep, Math.min(1, depth / OPAQUE_DEPTH));
      colors[index * 3] = colour.r;
      colors[index * 3 + 1] = colour.g;
      colors[index * 3 + 2] = colour.b;
    }
  }

  // Only cells with water in at least one corner get triangles. Skipping the dry ones is what
  // keeps the surface from showing as a square sheet hovering over the hillside.
  const cells = samples - 1;
  const indices: number[] = [];
  for (let ix = 0; ix < cells; ix += 1) {
    for (let iz = 0; iz < cells; iz += 1) {
      const a = ix * samples + iz;
      const b = a + 1;
      const c = a + samples;
      const d = c + 1;
      const wet = (depths[a] ?? 0) + (depths[b] ?? 0) + (depths[c] ?? 0) + (depths[d] ?? 0);
      if (wet <= 0) continue;
      indices.push(a, b, c, b, d, c);
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(positions, 3));
  geometry.setAttribute("color", new BufferAttribute(colors, 3));
  geometry.setAttribute("depth", new BufferAttribute(depths, 1));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();

  const material = new MeshStandardNodeMaterial({
    depthWrite: false,
    metalness: 0.1,
    roughness: 0.12,
    // Both sides: the surface is thin, and standing in the shallows puts the camera under it.
    side: DoubleSide,
    transparent: true,
    vertexColors: true,
  });
  // The generic is written out: `attribute()` infers its node type from the argument, which
  // widens to `string` and produces a node with none of the `.mul`/`.add` methods the ripple
  // below is built from.
  const depth = attribute<"float">("depth", "float");
  // Two crossed travelling waves at different wavelengths and speeds. A single sine reads as
  // corduroy; two that do not share a period read as water. Amplitude is scaled by depth so the
  // shoreline stays welded to the ground instead of rippling through it.
  const swellA = sin(positionLocal.x.mul(0.85).add(positionLocal.z.mul(0.4)).add(time.mul(0.42)));
  const swellB = sin(positionLocal.x.mul(-0.35).add(positionLocal.z.mul(1.1)).add(time.mul(0.29)));
  const ripple = swellA.mul(0.035).add(swellB.mul(0.022)).mul(depth);
  material.positionNode = vec3(positionLocal.x, positionLocal.y.add(ripple), positionLocal.z);
  // Clear at the margin, opaque over the deep. The floor keeps a sheen on the very edge so the
  // waterline is still visible against wet silt of nearly the same colour.
  material.opacityNode = depth.mul(float(0.82)).add(float(0.18));

  const mesh = new Mesh(geometry, material);
  mesh.name = "water";
  mesh.receiveShadow = false;
  mesh.castShadow = false;
  // Drawn after the opaque valley, and after the foliage, so the shore blends over both.
  mesh.renderOrder = 2;
  mesh.matrixAutoUpdate = false;
  mesh.updateMatrix();

  return {
    covers: (x, z) => heightAt(x, z) < WATER_LEVEL,
    level: WATER_LEVEL,
    mesh,
  };
}
