// Generated for you. This is ordinary Three.js — edit or delete it freely.
// ThreeNative does not read this file.
//
// One sun, low and outside, and nothing else. Every other lit surface in the nave is lit
// by that sun bouncing, which is the entire point of the scene: switch the indirect pass
// off and the aisles go black while the shafts stay exactly as bright.
import { DirectionalLight, PCFShadowMap, type Scene } from "three";
import { palette } from "./palette.js";

type ShadowRenderer = { shadowMap: { enabled: boolean; type: number } };

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
  scene.add(sun);
  scene.add(sun.target);
  return sun;
}
