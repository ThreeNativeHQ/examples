// Generated for you. This is ordinary Three.js — edit or delete it freely.
// ThreeNative does not read this file.
//
// The materials for everything that is *not* ground, water, or foliage: the landmarks the player
// walks out to find. Each is deliberately a little apart from the palette of the wood around it,
// because a landmark that blends in is not a landmark.
import { Color, DoubleSide, MeshBasicMaterial, MeshStandardMaterial, RepeatWrapping, type Texture } from "three";
import { MeshBasicNodeMaterial, MeshStandardNodeMaterial } from "three/webgpu";
import {
  abs,
  float,
  normalLocal,
  positionLocal,
  texture,
  uv,
  vec2,
  vec3,
} from "three/tsl";
import { palette } from "./palette.js";

/** The pack maps the landmark materials are lifted with. All optional; each falls back flat. */
export interface ILandmarkMaps {
  readonly deadBark?: Texture;
  readonly deadBarkNormal?: Texture;
  readonly rock?: Texture;
  /** Also handed to the imported stone species, which need the scene's real rock diffuse. */
  readonly rockNormal?: Texture;
}

export function createMaterials(maps: ILandmarkMaps = {}) {
  return {
    // The standing stone and the cairn: pale, matte, and cool against the warm ground.
    // Textured when the pack's mossy cliff rock is available, flat grey when it is not.
    //
    // A node material rather than a plain standard one purely so the map can be **gained up**. The
    // pack's textures are authored for Unreal's exposure and land very dark here; a
    // `MeshStandardMaterial` can only tint its map *down* from white, so the same texture that
    // looks right on the instanced boulders (which already multiply by 2.9) renders the landmarks
    // as near-black silhouettes. There is no way to say "brighter than white" without a node.
    stone: rockStandMaterial(maps.rock),
    // Wet dark stone for the shrine's basin, which is the one shiny thing in the valley.
    slick: new MeshStandardMaterial({ color: new Color(palette.stone).multiplyScalar(0.42), roughness: 0.22, metalness: 0.08 }),
    // Dead wood: the fallen giant, the trail posts, the stumps around the camp. The pack's dead
    // trunk bark when available — gained up like every texture out of this pack — flat palette
    // colour when not. `roundedBox` shapes carry no UVs (see `rockStandMaterial` below) and sample
    // one texel; only the cylinders, which have real UVs, show the grain.
    deadwood: deadwoodMaterial(maps),
    // The charcoal ring, near black so the burnt ground reads even in shade.
    char: new MeshStandardMaterial({ color: 0x1c1a17, roughness: 1, metalness: 0 }),
    // Embers and the trailhead's painted blaze — the two warm accents in the whole valley.
    ember: new MeshStandardMaterial({
      color: palette.ember,
      emissive: new Color(palette.ember).multiplyScalar(0.55),
      metalness: 0,
      roughness: 0.6,
    }),
    // Reeds at the water's edge. Unlit: they stand against bright water and a standard material
    // there goes to silhouette anyway, so the flat colour costs nothing and reads cleaner. Pulled
    // down to a dull olive — the palette's blade green at full strength renders as neon straws.
    reed: new MeshBasicMaterial({ color: new Color(palette.blade).multiplyScalar(0.42), side: DoubleSide }),
  };
}

/**
 * Dead bark on the fallen giant, the camp seats, and the trail posts.
 *
 * **Projected from position, not read from `uv()`.** The rounded-box shapes in `shapes.ts` carry
 * no UV attribute, so `uv()` returns zero across every one of them and the map collapses to a
 * single texel: the fallen giant's 5.2 m root plate rendered as one flat olive slab, which is the
 * loudest thing in the frame once the wood around it is 46,000 scanned plants. Raising the
 * geometry's segment counts does nothing for that — the facets were never the problem, the missing
 * UVs were.
 *
 * A triplanar projection fixes every prop built from these shapes at once and needs no geometry
 * change: sample the bark three times, along each axis, and blend by the surface normal so each
 * face takes the projection that faces it most. The seams a box projection normally shows are
 * hidden by the blend, and the grain runs along the trunk because the trunk's long axis is X.
 */
function deadwoodMaterial(maps: ILandmarkMaps): MeshStandardMaterial | MeshStandardNodeMaterial {
  if (maps.deadBark === undefined) {
    return new MeshStandardMaterial({ color: new Color(palette.bark).multiplyScalar(1.25), roughness: 0.95, metalness: 0 });
  }
  const material = new MeshStandardNodeMaterial({ metalness: 0, roughness: 0.95 });
  // Half a metre per tile. Bark at this pack's authored scale reads as noise any finer and as
  // plywood any coarser.
  const scale = float(2);
  const point = positionLocal.mul(scale);
  const sampled = (a: ReturnType<typeof vec2>) => texture(maps.deadBark as Texture, a).rgb;
  const alongX = sampled(vec2(point.z, point.y));
  const alongY = sampled(vec2(point.x, point.z));
  const alongZ = sampled(vec2(point.x, point.y));
  // Cubed, so the dominant axis wins decisively; a linear blend greys out every rounded corner.
  const weight = abs(normalLocal).pow(float(3));
  const sum = weight.x.add(weight.y).add(weight.z).max(float(0.0001));
  const blended = alongX
    .mul(weight.x)
    .add(alongY.mul(weight.y))
    .add(alongZ.mul(weight.z))
    .div(sum);
  // The cylinders DO have real UVs, and the trunk's grain along its own length is worth keeping,
  // so they take the authored mapping and only the UV-less shapes fall back to the projection.
  // `uv()` is exactly zero on those, which is what makes this test reliable rather than a guess.
  const authored = texture(maps.deadBark, uv()).rgb;
  const hasUv = uv().x.add(uv().y).greaterThan(float(0.00001));
  material.colorNode = vec3(hasUv.select(authored, blended)).mul(float(3.1));
  if (maps.deadBarkNormal !== undefined) material.normalMap = maps.deadBarkNormal;
  return material;
}

/** Mossy cliff rock, lifted to this scene's exposure. Falls back to flat stone with no texture. */
function rockStandMaterial(rock: Texture | undefined): MeshStandardMaterial | MeshStandardNodeMaterial {
  if (rock === undefined) {
    return new MeshStandardMaterial({ color: palette.stone, metalness: 0, roughness: 0.94 });
  }
  rock.wrapS = RepeatWrapping;
  rock.wrapT = RepeatWrapping;
  const material = new MeshStandardNodeMaterial({ metalness: 0, roughness: 0.94 });
  // UVs come from world position, not from the geometry's own `uv` attribute.
  //
  // Two reasons, and the first is a hard requirement: `shapes.ts` `roundedBox` deletes its `uv`
  // attribute (it rebuilds normals after welding and stale UVs would be a trap), so every landmark
  // built from `block()` — the cairn, the fire-ring kerbs, the trailhead post — has none, and
  // sampling `uv()` there logs "Vertex attribute uv not found" and renders one corner texel.
  // The second is that a planar projection looks *better* on displaced rock than a sphere's own
  // pinched polar UVs.
  material.colorNode = texture(rock, vec2(positionLocal.x, positionLocal.z).mul(0.55)).rgb.mul(float(1.5));
  return material;
}

/** The trailhead banner owns its sampled, double-sided look. */
export function createBannerMaterial(texture: Texture): MeshBasicNodeMaterial {
  return new MeshBasicNodeMaterial({ map: texture, side: DoubleSide });
}
