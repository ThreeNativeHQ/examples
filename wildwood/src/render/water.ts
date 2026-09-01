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
  type Texture,
  Vector2,
} from "three";
import { MeshStandardNodeMaterial } from "three/webgpu";
import { attribute, float, positionLocal, sin, texture, time, vec2, vec3 } from "three/tsl";
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

/** Optional realism inputs. `wavesNormal` is the pack's own ripple normal map. */
export interface IWaterOptions {
  readonly wavesNormal?: Texture;
}

/**
 * Build a lake surface over a circular patch of the valley.
 *
 * The grid is generous around the lake's nominal radius because the shoreline is where `heightAt`
 * happens to cross zero, not where the basin was drawn — the noise the basin is subtracted from
 * pushes the real waterline in and out by several metres, which is exactly what makes it look
 * like a shore instead of a drawn circle.
 */
export function createWater(centre: Vector2, radius: number, options: IWaterOptions = {}, samples = 96): IWater {
  const span = radius * 2.4;
  const step = span / (samples - 1);
  const half = span / 2;
  const vertexCount = samples * samples;

  const positions = new Float32Array(vertexCount * 3);
  const colors = new Float32Array(vertexCount * 3);
  // A plain float attribute rather than a fourth colour channel: opacity and colour are separate
  // decisions, and packing them together is how a shallows tint ends up controlling transparency.
  const depths = new Float32Array(vertexCount);

  // Both ends of the ramp are pulled well down: under this scene's screen-space reflections a
  // full-bright water plane mirrors the gained-up grass and blooms into radioactive lime, and a
  // dark base keeps the same reflections reading as sky and treeline instead. Darkened here, in
  // the bake — NOT as a `colorNode` on the material, which fights the vertex-colour path and
  // renders the whole surface invisible.
  // Both ends of the ramp are pulled well down: under this scene's screen-space reflections a
  // full-bright water plane mirrors the gained-up grass and blooms into radioactive lime, and a
  // dark base keeps the same reflections reading as sky and treeline instead. Darkened here, in
  // the bake — NOT as a `colorNode` on the material, which fights the vertex-colour path and
  // renders the whole surface invisible. The shallow end leans hard toward the water colour,
  // because a bright silt floor seen through a translucent margin is what turned the pond into a
  // glowing cream sheet.
  const shallow = new Color(palette.silt).lerp(new Color(palette.water), 0.72).multiplyScalar(0.34);
  const deep = new Color(palette.water).multiplyScalar(0.2);
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
    metalness: 0,
    roughness: 0.18,
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
  // Clear at the very margin, then quickly honest: 40 cm of depth already reads as water, not as
  // wet silt. The floor keeps a sheen on the edge so the waterline stays visible against silt of
  // nearly the same colour, but a shallow pond whose floor shows through everywhere renders as a
  // bright sheet, not as water.
  material.opacityNode = depth.mul(float(1.4)).add(float(0.22)).min(float(0.97));
  // Ripple detail: the pack's own normal map, sampled twice at incommensurate scales and drifts,
  // so the specular never settles into one visible tiling. This is what turns a flat shaded disc
  // into water: the vertex waves move the silhouette, but these move the *light*. The close scale
  // carries the visible ripple texture; the far one breaks up its repeat.
  const wavesNormal = options.wavesNormal;
  if (wavesNormal !== undefined) {
    const uvA = vec2(positionLocal.x, positionLocal.z).mul(0.38).add(vec2(time.mul(0.024), time.mul(0.016)));
    const uvB = vec2(positionLocal.x, positionLocal.z).mul(0.083).add(vec2(time.mul(-0.018), time.mul(0.011)));
    const sampleA = texture(wavesNormal, uvA);
    const sampleB = texture(wavesNormal, uvB);
    // glTF convention puts up in B; a horizontal plane's perturbation is (x, z-up, y) into world.
    const detail = sampleA.rgb.add(sampleB.rgb).mul(0.5).sub(vec3(0.5, 0.5, 0.5)).mul(vec3(2.6, 2.6, 1.0));
    material.normalNode = vec3(detail.x, detail.z, detail.y);
  }

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
