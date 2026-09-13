// The Pacific's sea, as a TSL node material over the engine's SpectralOcean. `SpectralOcean`
// runs the cascaded wave spectra on the GPU and draws nothing; this file owns the surface mesh,
// the material and every colour, so the sea the aircraft flies over is the same field that is
// drawn.
import { type ISpectralOceanOptions, SpectralOcean } from "@threenative/core";
import { Mesh, PlaneGeometry } from "three";
import {
  color,
  float,
  mix,
  positionLocal,
  positionWorld,
  smoothstep,
  transformNormalToView,
  vec3,
} from "three/tsl";
import type { Node } from "three/webgpu";
import { MeshStandardNodeMaterial } from "three/webgpu";

/** The open-Pacific sea state. Wind sets the wavelengths; amplitude scales the whole spectrum. */
export const SEA = {
  amplitude: 0.019,
  cascades: [{ patchSize: 2600 }, { patchSize: 620 }, { patchSize: 150 }],
  choppiness: 1.15,
  directionality: 2.4,
  gravity: 9.81,
  readbackEveryFrames: 60,
  readbackResolution: 16,
  resolution: 128,
  seed: 19_420_604,
  smallWaveCutoff: 0.32,
  windDirection: 0.55,
  windSpeed: 13,
} satisfies ISpectralOceanOptions;

/** The drawn surface's edge length in metres and its tessellation. */
export const SURFACE = { segments: 256, size: 18_000 } as const;

const DEEP = 0x06202e;
const SHALLOW = 0x0d465c;
const FOAM = 0xd7e8ea;

export function createOcean(): SpectralOcean {
  return new SpectralOcean(SEA);
}

function cascadeAt(
  ocean: SpectralOcean,
  index: number,
  x: Node<"float">,
  z: Node<"float">,
): Node<"vec4"> {
  const grid = float(ocean.resolution);
  const patch = float(ocean.cascadePatchSize(index));
  const buffer = ocean.cascadeDisplacement(index);
  const u = x.div(patch).mul(grid);
  const v = z.div(patch).mul(grid);
  const u0 = u.floor();
  const v0 = v.floor();
  const wrap = (value: Node<"float">): Node<"float"> => value.mod(grid).add(grid).mod(grid);
  const read = (cx: Node<"float">, cz: Node<"float">): Node<"vec4"> =>
    buffer.element(wrap(cz).mul(grid).add(wrap(cx)).toUint()) as Node<"vec4">;
  const near = mix(read(u0, v0), read(u0.add(1), v0), u.sub(u0));
  const far = mix(read(u0, v0.add(1)), read(u0.add(1), v0.add(1)), u.sub(u0));
  return mix(near, far, v.sub(v0)) as Node<"vec4">;
}

function displacementAt(ocean: SpectralOcean, x: Node<"float">, z: Node<"float">): Node<"vec3"> {
  const broad = cascadeAt(ocean, 0, x, z);
  const fine = cascadeAt(ocean, 1, x, z);
  const finer = cascadeAt(ocean, 2, x, z);
  return vec3(
    broad.x.add(fine.x).add(finer.x),
    broad.y.add(fine.y).add(finer.y),
    broad.z.add(fine.z).add(finer.z),
  );
}

/** The sea surface: displaced by the simulation, lit by the scene's own lights. */
export function createWaterMesh(ocean: SpectralOcean): Mesh {
  const geometry = new PlaneGeometry(SURFACE.size, SURFACE.size, SURFACE.segments, SURFACE.segments);
  geometry.rotateX(-Math.PI / 2);
  const material = new MeshStandardNodeMaterial({ metalness: 0.02, roughness: 0.34 });

  // Sample by WORLD position so the waves stay anchored as the mesh follows the camera; the mesh
  // transform is translation only, so the object-space offset equals the world offset.
  const offset = displacementAt(ocean, positionWorld.x, positionWorld.z);
  material.positionNode = positionLocal.add(offset);

  const step = float(SURFACE.size / SURFACE.segments);
  const east = displacementAt(ocean, positionWorld.x.add(step), positionWorld.z);
  const west = displacementAt(ocean, positionWorld.x.sub(step), positionWorld.z);
  const north = displacementAt(ocean, positionWorld.x, positionWorld.z.add(step));
  const south = displacementAt(ocean, positionWorld.x, positionWorld.z.sub(step));
  const twice = step.mul(2);
  material.normalNode = transformNormalToView(
    vec3(west.y.sub(east.y).div(twice), float(1), south.y.sub(north.y).div(twice)).normalize(),
  );

  const shade = smoothstep(float(-3.5), float(2.6), positionWorld.y);
  // Linear constants from the standalone build's sea shader.
  const water = mix(vec3(0.007, 0.056, 0.09), vec3(0.012, 0.18, 0.215), shade);
  const crest = smoothstep(float(2.4), float(4.4), positionWorld.y);
  material.colorNode = mix(water, vec3(0.52, 0.65, 0.66), crest);
  material.roughnessNode = mix(float(0.34), float(0.86), crest);

  const mesh = new Mesh(geometry, material);
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  mesh.renderOrder = -2;
  mesh.name = "sea-surface";
  return mesh;
}
