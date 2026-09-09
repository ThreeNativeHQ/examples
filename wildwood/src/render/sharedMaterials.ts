// Generated for you. This is ordinary Three.js — edit or delete it freely.
// ThreeNative does not read this file.
//
// A foliage section's map, palette gain, alpha cutoff and wind settings are material data. The
// graph that consumes them is shared in shape: putting authored numbers into uniforms keeps those
// values independent per material while preventing one graph per layer/species combination.
import { DoubleSide, Vector3, type Texture } from "three";
import { MeshStandardNodeMaterial } from "three/webgpu";
import {
  float,
  instanceIndex,
  positionGeometry,
  positionLocal,
  sin,
  texture,
  time,
  uniform,
  uv,
  vec3,
} from "three/tsl";

interface IFoliageMaterial extends MeshStandardNodeMaterial {
  foliageWindSpeed: number;
  foliageWindStiffness: number;
  foliageWindStrength: number;
}

/**
 * One vertex graph serves every moving foliage material. The scalar uniforms update from the
 * current material for each object, so species keep their authored speed, stiffness and strength.
 * Shadow-pass materials do not carry these game fields; returning `undefined` leaves the last
 * valid value in place for that pass instead of making the shared node fail closed at runtime.
 */
const foliageWindSpeed = uniform(0.13).onObjectUpdate(({ material }) =>
  (material as Partial<IFoliageMaterial>).foliageWindSpeed,
);
const foliageWindStiffness = uniform(1.3).onObjectUpdate(({ material }) =>
  (material as Partial<IFoliageMaterial>).foliageWindStiffness,
);
const foliageWindStrength = uniform(0.045).onObjectUpdate(({ material }) =>
  (material as Partial<IFoliageMaterial>).foliageWindStrength,
);
const foliagePhase = float(instanceIndex).mul(12.9898).sin().mul(43_758.545).fract().mul(6.2831);
const foliageGust = sin(time.mul(foliageWindSpeed).add(foliagePhase))
  .mul(0.82)
  .add(sin(time.mul(foliageWindSpeed.mul(1.73)).add(foliagePhase.mul(1.7))).mul(0.18));
const foliageLift = positionGeometry.y.max(float(0)).pow(foliageWindStiffness);
const foliageBend = foliageGust.mul(foliageLift).mul(foliageWindStrength);
const foliagePosition = vec3(
  positionLocal.x.add(foliageBend),
  positionLocal.y.sub(foliageBend.mul(foliageBend).mul(float(0.35))),
  positionLocal.z.add(foliageBend.mul(float(0.55))),
);

export interface ISharedFoliageMaterialData {
  readonly alphaCutoff: number;
  readonly cutout: boolean;
  readonly gain: readonly [number, number, number];
  readonly map: Texture;
  readonly normal: Texture | undefined;
  readonly wind: { readonly strength: number; readonly stiffness: number; readonly speed: number };
}

/** Build one compatible PBR graph and keep every appearance choice on this material instance. */
export function createSharedFoliageMaterial(
  section: ISharedFoliageMaterialData,
): MeshStandardNodeMaterial {
  const material = new MeshStandardNodeMaterial({ metalness: 0, roughness: 0.92 }) as IFoliageMaterial;
  const sample = texture(section.map, uv());
  const gain = uniform(new Vector3(section.gain[0], section.gain[1], section.gain[2]));
  material.colorNode = sample.rgb.mul(gain);
  material.foliageWindSpeed = section.wind.speed;
  material.foliageWindStiffness = section.wind.stiffness;
  material.foliageWindStrength = section.wind.strength;
  if (section.normal !== undefined) material.normalMap = section.normal;
  section.map.anisotropy = 8;
  if (section.cutout) {
    material.side = DoubleSide;
    material.shadowSide = DoubleSide;
    material.alphaTestNode = uniform(section.alphaCutoff);
    material.opacityNode = sample.a;
  }
  if (section.wind.strength > 0) {
    material.positionNode = foliagePosition;
  }
  return material;
}
