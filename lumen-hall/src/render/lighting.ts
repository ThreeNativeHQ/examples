// Generated for you. This is ordinary Three.js — edit or delete it freely.
// ThreeNative does not read this file.
//
// One sun, low and outside, plus one hemisphere standing in for the sky the clerestory
// lets through. Every other lit surface in the nave is lit by that sun bouncing, which is
// the entire point of the scene: switch the indirect pass off and the aisles go black
// while the shafts stay exactly as bright.
import {
  Color,
  CubeTexture,
  DataTexture,
  DirectionalLight,
  HemisphereLight,
  LinearFilter,
  LinearMipmapLinearFilter,
  PCFShadowMap,
  RGBAFormat,
  type Scene,
  SRGBColorSpace,
  UnsignedByteType,
} from "three";
import { palette } from "./palette.js";

type ShadowRenderer = { shadowMap: { enabled: boolean; type: number } };

/**
 * `?off=ibl` and `?off=hemi` drop one fill term on the same build.
 *
 * Same trick and same reason as `postprocessing.ts`: an A/B of two fill terms against each
 * other has to differ by the term and nothing else, and two captures taken across a rebuild
 * differ by every file that moved between them.
 */
function lightOff(name: string): boolean {
  if (typeof globalThis.location === "undefined") return false;
  const off = new URLSearchParams(globalThis.location.search).get("off");
  return off !== null && off.split(",").some((entry) => entry.trim() === name);
}

export const NAVE = {
  /** Interior width between the two arcade faces. Every other number derives from this. */
  width: 16,
  /** Floor to vault crown. The reference reads at roughly 2.1 x the nave width. */
  height: 34,
  /** West door to east wall. */
  depth: 63,
  /** One bay. Pier, arch, triforium panel and clerestory light all repeat on this pitch. */
  bayPitch: 7,
  /** Top of the arcade storey. */
  arcadeHeight: 14,
  /** Top of the blind middle storey. */
  triforiumTop: 19,
  /** Top of the clerestory band, and the springing of the vault. */
  clerestoryTop: 28,
  /** How far the dark aisle runs behind each colonnade. */
  aisleWidth: 6,
  pierRadius: 1.15,
} as const;

/**
 * The sun, as a shadow-casting directional light.
 *
 * Godrays are raymarched against this light's *shadow map* — the shaft is the volume the
 * shadow map says is lit. A light with `castShadow` false produces no rays at all, and a
 * shadow camera that does not cover the nave produces rays that stop mid-air.
 */
export function setupLighting(scene: Scene, renderer: ShadowRenderer): DirectionalLight {
  renderer.shadowMap.enabled = true;
  // Hard PCF, not soft. A cathedral shaft is defined by the *edge* the pier cuts into it;
  // PCFSoftShadowMap spreads that edge over enough texels that the shaft stops having a
  // shape, and the godray pass then raymarches a soft edge into a soft shaft.
  renderer.shadowMap.type = PCFShadowMap;

  // Daylight, not candlelight. Once the godray floor stopped the pass washing the frame,
  // the scene read as night lit only by its candles — the reference is a building full of
  // afternoon sun with the candles as accents, and the sun has to dominate for that.
  const sun = new DirectionalLight(palette.sun, 13);
  // Low and to the west, so it enters through the clerestory rather than the vault and
  // the shafts cross the nave at an angle instead of dropping straight down.
  // Steep enough that the shafts land on the floor between the columns rather than on the
  // far wall. At 22 m up over 44 m across they hit the opposite wall at head height and
  // the floor stays black; this angle puts them down where the camera is looking.
  // Almost perpendicular to the nave axis, and only slightly toward the east end.
  //
  // The previous direction carried a large -Z component, which meant the light approached
  // down the length of the building and the solid west wall behind the camera blocked it
  // before it ever reached a window. The result was a hard-edged black wedge over half the
  // frame that looked like a shadow bug and was actually a sun pointed at a wall.
  sun.position.set(-62, 40, -4);
  sun.target.position.set(12, 1, -12);
  sun.castShadow = true;
  // 2048, not 4096. The godray pass samples this map once per raymarch step per pixel, so
  // its size is a cost multiplier on the whole volumetric pass rather than a one-off. At a
  // 92-unit ortho extent 2048 still gives 22 texels per metre, which holds a hard pier edge
  // at this scale — and the pier edge is the only thing the shafts need it for.
  // Back to 4096. The earlier cut to 2048 was to save the per-frame shadow pass, but that
  // pass is now frozen — `autoUpdate = false` renders it exactly once — so resolution costs
  // one render at startup and nothing per frame afterwards. The godray march samples this
  // map, so a coarse one shows up directly as blocky shaft edges.
  sun.shadow.mapSize.set(4096, 4096);
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 220;
  // The shadow camera has to contain the whole building, not just what is on screen —
  // the raymarch samples it well outside the view frustum.
  // Tight. Every unit of extent spends shadow-map resolution, and a blurred shadow here
  // is a blurred shaft: 2048 over 52 units is 39 texels per metre, enough for a hard pier
  // edge at this scale.
  const extent = 46;
  sun.shadow.camera.left = -extent;
  sun.shadow.camera.right = extent;
  sun.shadow.camera.top = extent;
  sun.shadow.camera.bottom = -extent;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.02;
  // The sun does not move and neither does the building, so the 4096x4096 shadow pass is
  // re-rendering an identical map every frame. Measured by wrapping the WebGPU encoder:
  // freezing it removes 22 draws and 164,000 triangles per frame and costs 1.0 ms of a
  // 16.3 ms GPU frame — 6%, entirely recoverable, one line.
  //
  // `needsUpdate` renders it exactly once. Anything that later animates *and* casts a
  // shadow has to set `sun.shadow.needsUpdate = true` again; nothing in this scene does,
  // because the candle flames are emissive quads rather than shadow casters.
  sun.shadow.autoUpdate = false;
  sun.shadow.needsUpdate = true;

  scene.add(sun);
  scene.add(sun.target);

  // The fill the reference's quantiles demanded: its shadowed stone sits at p25 ≈ 23 of
  // 255 — soft light through the building — where ours sat at 11 no matter what the
  // screen-space gather was fed (measured: SSGI intensity 0.55 to 4, radius 8 to 14,
  // moved p25 by one point; the gather cannot bridge a nave whose dark stone is metres
  // from its lit patches). What actually fills a cathedral is the sky, through the same
  // clerestory the sun comes through. A hemisphere stands in for it: warm from above,
  // floor-bounce brown from below, and it lights only the standard materials — the glass
  // is authored and stays untouched.
  // Cut from 0.45, because the hemisphere is no longer the whole fill. What it still
  // supplies that nothing else does is a floor under the whole building — the vault webs
  // and the aisle ceilings face nothing the environment cube calls bright, and with the
  // hemisphere gone entirely they go to black. What it cannot supply is any *shape*: a
  // hemisphere is two colours and a `dot(n, up)`, so every shadowed surface in the building
  // gets the same value at the same facing, which is exactly the flat shadow this pass is
  // here to fix.
  //
  // 0.17, cut from 0.45 and then again from the 0.26 this pass first shipped, because a
  // `HemisphereLight` is a uniform ambient term by construction — two colours and a
  // `dot(n, up)` — and a uniform ambient term is precisely the flat shadow this pass exists
  // to remove. Integrating the pair says how badly. At 0.26 the darkest fill *any* surface
  // in the building could receive was 0.410, of which the hemisphere alone was 0.26 — 63%
  // of the floor — and because it sits in the denominator of every contrast ratio in the
  // frame it dragged the cube's 3.28x sunward-to-shaded spread down to an effective 1.94x.
  //
  // 0.17 with the cube at 1.35 puts the floor at 0.248 and the effective spread at 2.93x,
  // while leaving the sunward fill at 0.829 against the 0.855 it had at 0.26 — so the lit
  // side keeps its fill and only the unlit side gets darker, which is the definition of the
  // change being contrast rather than exposure. 0.10 with the cube at 1.1 was tried and is
  // too far: floor 0.163, but it took p25 to 0.057 against the two references' 0.088 and
  // 0.095, which is the shadow fill this whole pass was bought for going back out again.
  //
  // Not zero, because the vault webs and the aisle ceilings face nothing this cube calls
  // bright and go to black without it. This is the smallest flat term that keeps them
  // readable, and every other point of fill now comes from something with a direction.
  //
  // Note three's IBL diffuse is `PI * radiance` — assuming it was the ratio of two averages
  // cost a capture, and ran the frame a stop and a half hot at intensity 2.0.
  const sky = new HemisphereLight(palette.sun, 0x3a3630, lightOff("hemi") ? 0 : 0.17);
  scene.add(sky);

  // The other half, and the one that carries the shape. See `roomEnvironment`.
  if (!lightOff("ibl")) {
    scene.environment = roomEnvironment();
    scene.environmentIntensity = 1.35;
  }

  return sun;
}

/**
 * The nave, as a 64px cube, for image-based lighting.
 *
 * Two jobs a `HemisphereLight` cannot do, and both of them are what separates this frame
 * from a realtime one:
 *
 *   **Shape.** A hemisphere is one gradient from up to down, so a pier's shadowed face is
 *   the same value whether it faces the sun-side clerestory or the dark north aisle. In a
 *   real building it is not: the fill comes *through the windows*, so it is directional,
 *   and every unlit surface is brighter on the window side. That gradient across a shadowed
 *   face is most of what reads as "this was rendered by something that understands the
 *   room".
 *
 *   **Specular.** A hemisphere light contributes no specular term at all. Limestone at
 *   roughness 0.74 and bronze at roughness 0.35 both have a real specular lobe, and with
 *   nothing in the environment to put in it, the stone renders as pure Lambert — matte,
 *   even, and the single loudest tell in the frame. `furnishings.ts` already found this out
 *   for its chandeliers and hung a private cube on those materials; this is the same idea
 *   for everything else, which is why the two are separate textures rather than a shared
 *   one. That file's cube is the three things a *chandelier* reflects; this one is what a
 *   wall sees.
 *
 * Generated rather than loaded, for the same reasons that file gives: no DOM, no canvas, no
 * asset, so it works on the native target too. It is not a photograph of this building — it
 * is four facts about it:
 *
 *   a bright warm band at clerestory height on the sun side (-X)
 *   a dimmer, cooler band on the shaded side (+X) and down the axis (±Z)
 *   a near-black vault above, because the vault is 34 m up and unlit
 *   a warm floor below, because the marble is the brightest lit surface in the picture
 *
 * The bands are deliberately *bands* and not a gradient. A gradient models the room and
 * gives no glint; a band has an edge, and an edge is what a low-roughness surface turns
 * into a highlight.
 */
function roomEnvironment(): CubeTexture {
  const size = 64;
  // Linear values, not sRGB: this is a light source, and it is read as one.
  // The unlit end of this cube is the frame's black point, so it is authored deep on
  // purpose. Every value below the window band is what a surface facing *nothing* receives,
  // and a surface facing nothing in a stone building at a low sun receives almost nothing.
  // The first pass had `wall` at 0.03 and `vault` at 0.012, which put a floor of indirect
  // light under every pixel in the picture — measured, the darkest fill any surface could
  // receive was 0.41 and the frame's p05 sat 3.5x above the build it replaced.
  const vault = new Color(0.003, 0.0033, 0.0045);
  const floorBounce = new Color(0.05, 0.034, 0.022);
  const sunSide = new Color(1.75, 1.53, 1.19);
  const shadeSide = new Color(0.105, 0.121, 0.157);
  const axisGlass = new Color(0.4, 0.315, 0.248);
  const wall = new Color(0.006, 0.0056, 0.005);

  const faces: DataTexture[] = [];
  const sample = new Color();
  for (let face = 0; face < 6; face += 1) {
    const data = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        // Cube-face parametrisation, in the order three uses: +X, -X, +Y, -Y, +Z, -Z.
        const u = (2 * (x + 0.5)) / size - 1;
        const v = 1 - (2 * (y + 0.5)) / size;
        const direction = faceDirection(face, u, v);
        const radiance = directionRadiance(
          direction,
          vault,
          floorBounce,
          sunSide,
          shadeSide,
          axisGlass,
          wall,
        );
        // Stored as bytes, so anything over 1 clips. The sun-side band is authored past 1
        // on purpose and is scaled down to fit before it is written, with the loss taken
        // back by `environmentIntensity` — a band that clipped to white would lose its hue
        // and throw a colourless highlight. The encode is the other half of the cube's
        // `SRGBColorSpace`: these are linear radiances and the sampler will decode them.
        sample.setRGB(
          Math.min(1, radiance.r / ENV_HEADROOM),
          Math.min(1, radiance.g / ENV_HEADROOM),
          Math.min(1, radiance.b / ENV_HEADROOM),
        );
        sample.convertLinearToSRGB();
        const index = (y * size + x) * 4;
        data[index] = Math.round(255 * sample.r);
        data[index + 1] = Math.round(255 * sample.g);
        data[index + 2] = Math.round(255 * sample.b);
        data[index + 3] = 255;
      }
    }
    const texture = new DataTexture(data, size, size, RGBAFormat, UnsignedByteType);
    texture.needsUpdate = true;
    faces.push(texture);
  }

  // `new CubeTexture(faces)` — the *textures*, not `faces.map((t) => t.image)`. The raw
  // `.image` of a `DataTexture` is a `{ data, width, height }` record with no texture on
  // it, and a cube assembled out of six of those uploads without an error and lights
  // nothing: measured, `scene.environment` set from such a cube moved the frame by 0.56
  // mean absolute channel value, against a 0.5-0.9 noise floor from the stochastic passes,
  // and *raising* `environmentIntensity` from 0.62 to 2.0 moved it less rather than more —
  // which is what a no-op under the noise looks like from the outside. `furnishings.ts`
  // gets this right for its own cube and is the reason the mistake was findable.
  const cube = new CubeTexture(faces);
  // sRGB, matching that file. The values above are authored as linear radiance and are
  // encoded on the way in, which is also what buys back the precision an 8-bit linear cube
  // throws away at the dark end — the vault sits at 0.012, which is byte 2 of 255 linear
  // and byte 30 through the transfer.
  cube.colorSpace = SRGBColorSpace;
  // Without mips a rough surface samples the sharpest level and the matte limestone gets
  // the same crisp window edge as the polished floor.
  cube.generateMipmaps = true;
  cube.minFilter = LinearMipmapLinearFilter;
  cube.magFilter = LinearFilter;
  cube.needsUpdate = true;
  return cube;
}

/** Brightest value the cube is authored to, before it is normalised into a byte. */
const ENV_HEADROOM = 1.8;

/** Unit direction for texel (u, v) on cube face `face`, in three's face order. */
function faceDirection(face: number, u: number, v: number): [number, number, number] {
  const raw: [number, number, number] =
    face === 0
      ? [1, v, -u]
      : face === 1
        ? [-1, v, u]
        : face === 2
          ? [u, 1, -v]
          : face === 3
            ? [u, -1, v]
            : face === 4
              ? [u, v, 1]
              : [-u, v, -1];
  const length = Math.hypot(raw[0], raw[1], raw[2]);
  return [raw[0] / length, raw[1] / length, raw[2] / length];
}

/** What a surface facing `direction` sees, as linear radiance. */
function directionRadiance(
  direction: [number, number, number],
  vault: Color,
  floorBounce: Color,
  sunSide: Color,
  shadeSide: Color,
  axisGlass: Color,
  wall: Color,
): Color {
  const [x, y, z] = direction;
  const out = new Color();
  // Above the clerestory band there is only vault; below the floor line there is only
  // marble. Both are smoothed over a few degrees so a rough surface does not integrate a
  // step into a visible seam.
  if (y > 0.42) return out.copy(vault);
  if (y < -0.3) return out.copy(floorBounce).multiplyScalar(1 + y * 0.4);

  // The window band. It sits between the arcade top and the vault springing, which at this
  // camera height is a band of elevations rather than a horizon line — and its *edges* are
  // what a polished surface turns into a highlight, so they stay hard.
  const inBand = y > 0.06 && y < 0.4;
  if (!inBand) return out.copy(wall).multiplyScalar(1 + y);

  // -X is the sun side: `setupLighting` puts the sun at x = -62, so that is the wall whose
  // clerestory the light comes through. The falloff is on |x| so the band wraps the two
  // long walls and fades out where the wall turns the corner.
  const side = Math.abs(x);
  const axis = Math.abs(z);
  if (x < 0) out.copy(sunSide).multiplyScalar(side ** 1.6);
  else out.copy(shadeSide).multiplyScalar(side ** 1.6);
  // The east and west ends: the rose behind the camera and the lancets over the altar,
  // both of them glass, neither of them as bright as the sun-side clerestory.
  out.add(axisGlass.clone().multiplyScalar(axis ** 3));
  return out;
}
