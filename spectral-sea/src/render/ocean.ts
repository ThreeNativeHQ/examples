import { type ISpectralOceanOptions, SpectralOcean } from "@threenative/core";
import { Mesh, PlaneGeometry } from "three";
import { color, float, mix, positionLocal, positionWorld, smoothstep, vec3 } from "three/tsl";
import { MeshBasicNodeMaterial } from "three/webgpu";

/**
 * Every number here is this game's.
 *
 * The framework ships the transform and the readback and has no opinion about what water looks
 * like — the colours, the ramp, the foam line, the wind, the wave height and the tessellation all
 * live in this file. Changing any of them touches nothing installed.
 */
export const SEA = {
  amplitude: 0.0017,
  cascades: [{ patchSize: 210 }, { patchSize: 43 }],
  choppiness: 1.15,
  directionality: 2.4,
  gravity: 9.81,
  readbackEveryFrames: 3,
  readbackResolution: 32,
  resolution: 128,
  seed: 20_260_829,
  smallWaveCutoff: 0.55,
  windDirection: 0.65,
  windSpeed: 11,
} satisfies ISpectralOceanOptions;

/** The water plane's edge length in metres, and how finely it is tessellated. */
export const SURFACE = { segments: 220, size: 260 } as const;

const DEEP = 0x04263c;
const SHALLOW = 0x2ea6c6;
const FOAM = 0xeef9ff;

export function createSpectralOcean(): SpectralOcean {
  return new SpectralOcean(SEA);
}

/**
 * The drawn surface, displaced by the simulation the ocean is running.
 *
 * The vertex position reads the cascade buffers directly, so what is drawn is the same field the
 * height query is copied from. If the two disagreed, the raft would ride water nothing renders and
 * every assertion in this game would still be green.
 */
export function createWaterMesh(ocean: SpectralOcean): Mesh {
  const geometry = new PlaneGeometry(SURFACE.size, SURFACE.size, SURFACE.segments, SURFACE.segments);
  geometry.rotateX(-Math.PI / 2);
  const material = new MeshBasicNodeMaterial({ toneMapped: false });
  const grid = float(ocean.resolution);

  const samples = SEA.cascades.map((_cascade, index) => {
    const patch = float(ocean.cascadePatchSize(index));
    const buffer = ocean.cascadeDisplacement(index);
    // Wrap twice: the first `mod` is still negative for a vertex left of the origin, and a
    // negative index reads whatever happens to sit behind the buffer.
    const gx = positionLocal.x.div(patch).mul(grid).floor().mod(grid).add(grid).mod(grid);
    const gz = positionLocal.z.div(patch).mul(grid).floor().mod(grid).add(grid).mod(grid);
    return buffer.element(gz.mul(grid).add(gx).toUint());
  });

  // FRICTION: the cascades are summed by hand rather than in a loop. `node.add(other)` does not
  // return the type of `node`, and `float(0)` is a different node type again from a buffer
  // element, so no accumulator typechecks across an arbitrary number of cascades. Two cascades are
  // this game's own choice and the sum is clearer written out — but a game wanting five would be
  // reaching for a cast. TSL's typing, not the ocean's.
  const [broad, fine] = samples;
  if (broad === undefined || fine === undefined) throw new Error("the sea needs both cascades.");
  material.positionNode = positionLocal.add(
    vec3(broad.x.add(fine.x), broad.y.add(fine.y), broad.z.add(fine.z)),
  );

  // Colour by the displaced height, read back out of the world position the vertex stage produced.
  // A crest reads bright and a trough reads dark, which is the only reason a still frame can show
  // whether this field is moving at all.
  const shade = smoothstep(float(-1.6), float(1.6), positionWorld.y);
  const water = mix(color(DEEP), color(SHALLOW), shade);
  const crest = smoothstep(float(0.9), float(2.1), positionWorld.y);
  material.colorNode = mix(water, color(FOAM), crest);

  const mesh = new Mesh(geometry, material);
  mesh.frustumCulled = false;
  return mesh;
}
