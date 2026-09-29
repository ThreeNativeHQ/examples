import type { IAssetLoader } from "@threenative/core";
import { eyeMaterial, type IWrinkles, skinMaterial, teethMaterial } from "./look.js";
import {
  Color,
  DoubleSide,
  type Material,
  type Mesh,
  MeshPhysicalMaterial,
  type MeshPhysicalMaterialParameters,
  type Object3D,
  type Texture,
  Vector2,
} from "three";
import { MeshPhysicalNodeMaterial } from "three/webgpu";
import { color, float, mix, normalMap, saturate, smoothstep, texture, uv, vec2, vec3 } from "three/tsl";

/**
 * The lab's own appearance for the specimen's imported surfaces.
 *
 * The Unreal import that produced this GLB is honest about what it could not map: it writes flat
 * 0.8 grey PBR factors, binds a bent-normal map to the occlusion slot, and uses the eye's vein map
 * as its base colour. Those are the exporter's guesses, and this file is where a look replaces
 * them. Nothing here is an attempt at MetaHuman's shading — see the disclosure in the UI.
 *
 * Three deliberate calls, each because the alternative is a specific wrong-looking face:
 *
 * - **`vertexColors = false`.** The import's COLOR_0 is a packed Unreal channel, not a colour, and
 *   it is nearly black; leaving the loader's automatic flag on paints the head black.
 * - **Per group, not per mesh.** The GLB is *one* mesh with nine primitives, so three hands the
 *   loader one `Mesh` carrying nine groups and a nine-entry material array. Reading
 *   `material[0]` and assigning one material back — which is what a mesh walk naturally does —
 *   paints the eyes, the teeth and the eyelashes in skin, and that is the whole "flat clay" report.
 * - **The lacrimal film and the eye occlusion are not drawn.** In Unreal both are translucent
 *   overlays; there is nothing in this file to composite them *against*, so the honest outcome of
 *   drawing them opaquely is the milky film over both eyes the report is about. Hidden beats wrong.
 */

/** Where `tools/prepare.mjs` writes the licensed texture set. */
const TEXTURES = "content/textures/";

/**
 * Every map the look binds, and whether its pixels are data rather than colour.
 *
 * `data: true` is the difference between a normal map that shades and one that tints everything
 * the colour of the light, so it is stated per map rather than left to a shared default.
 */
const MAPS: Readonly<Record<string, boolean>> = {
  "FaceColor_MAIN.png": false,
  "FaceNormal_MAIN.png": true,
  "FaceRoughness_MAIN.png": true,
  "FaceCavity_MAIN.png": true,
  "Eye_D_L.png": false,
  "Eye_D_R.png": false,
  "T_Eye_N.png": true,
  "teeth_color_map_001.png": false,
  "teeth_normal_map.png": true,
  "Eyelashes_L_SlightCurl_Coverage.png": true,
  // Where the groom's roots are, derived by `tools/prepare.mjs --strands`: a mask, so data.
  "HairScalp_Mask.png": true,
  // The brow's painted density and Ada's wrinkle maps with their region strip, all derived or
  // imported by `tools/prepare.mjs` (`--strands`, `--wrinkles`): data, every one.
  "BrowDensity_Mask.png": true,
  "FaceNormal_WM1.png": true,
  "FaceNormal_WM2.png": true,
  "FaceNormal_WM3.png": true,
  "WrinkleMasks.png": true,
  "f_top_shirt_Mask.png": true,
  "f_top_shirt_N.png": true,
  "f_top_shirt_AO.png": true,
  "micro_pp_oxford_N.png": true,
};

/** The loaded maps, by the file name they were prepared under. */
export type SpecimenMaps = ReadonlyMap<string, Texture>;

/** Load the whole set concurrently, so the look costs one round trip rather than eleven. */
export async function loadSpecimenMaps(assets: IAssetLoader): Promise<SpecimenMaps> {
  const loaded = await Promise.all(
    Object.entries(MAPS).map(
      async ([name, data]) => [name, await assets.texture(`${TEXTURES}${name}`, { data })] as const,
    ),
  );
  return new Map(
    loaded.map(([name, texture]) => {
      // **`flipY = false`, and it is not a detail.** The export's UVs are glTF's: v = 0 is the
      // *top* row of the image, which is why GLTFLoader loads its own textures unflipped. The
      // engine's image loader flips, because that is right for an ordinary web image. Flipped
      // against these UVs the face atlas is upside down — measured, the glabella at uv v 0.43
      // reads row 1167, which is the lips, and the head wears a red patch across the nose bridge.
      texture.flipY = false;
      // **Anisotropic mip filtering, and it is the cure for the grain the report is about.** Every one
      // of these maps is minified hard: a 4096² face atlas over a head 0.30 m tall is 13 texels per
      // millimetre, and a cheek turned away from the camera is a surface at a grazing angle, where
      // the mip an axis-aligned footprint picks is the *blurred* one and every pore survives as noise
      // on top of it. The engine's image loader hands back a `Texture` with three's defaults —
      // mipmaps on, `anisotropy = 1` — so the mips were there and nothing was using them well.
      // Sixteen is the floor of what a modern desktop adapter reports and costs one sampler setting.
      texture.anisotropy = 16;
      return [name, texture] as const;
    }),
  );
}

/**
 * Unreal writes its tangent-space normals green-up; three reads them green-down. Negating the
 * green axis is the whole conversion, and it is why the head's brow and nose shade the way they
 * do rather than the inside-out way a straight copy does.
 */
const DIRECTX_TO_THREE = new Vector2(1, -1);

function map(maps: SpecimenMaps, name: string): Texture {
  const texture = maps.get(name);
  if (texture === undefined) throw new Error(`the look is missing ${name}; run \`node tools/prepare.mjs\``);
  return texture;
}

/** Skin: the specimen's own four maps, shaded by this sample's TSL graph. See `look.ts`. */
function skin(maps: SpecimenMaps, wrinkles: IWrinkles | undefined): Material {
  return skinMaterial({
    brow: map(maps, "BrowDensity_Mask.png"),
    wrinkles,
    colour: map(maps, "FaceColor_MAIN.png"),
    normal: map(maps, "FaceNormal_MAIN.png"),
    roughness: map(maps, "FaceRoughness_MAIN.png"),
    cavity: map(maps, "FaceCavity_MAIN.png"),
    scalp: map(maps, "HairScalp_Mask.png"),
  });
}

/**
 * The shirt: Ada's own bust mesh, in this sample's colours.
 *
 * The GLB arrives with an exporter's guess bound on `M_f_top_shirt` — a base colour, a normal and
 * an occlusion that are the converter's reading of the material, not the material — so all four
 * licensed maps `tools/prepare.mjs` copies are bound here instead, and the colour is stated.
 *
 * **Two regions, from the mask's green channel.** Measured over the whole 4096² mask, R sits at
 * 0.5 everywhere, B is empty, and G is 0.05 on average with two saturated bands — the collar
 * plackets. That is the only region information the material ships, so it is the whole of the
 * split: a deep plum fabric everywhere and the reference's cream collar piping along the two bands.
 * The plum and the cream are read off the reference render itself, where the lit fabric measures
 * 84/42/61 and the piping's highlight about 200/190/175 — a piping that came out pure white would
 * be the one thing on this bust brighter than the face.
 *
 * **Two normal maps, added in tangent space.** The fabric normal is the shirt's own wrinkles and
 * the oxford micro-normal is the weave; `normalMap` takes any node and decodes it as `x*2-1`, so
 * the two are summed and renormalised *before* that call and the DirectX-to-three green flip is
 * folded into the same expression. Passing the fabric alone would leave a 4K map of cloth
 * wrinkles with no weave in it, which at this framing is the difference between fabric and plastic.
 *
 * The AO is multiplied into the diffuse rather than bound as an `aoMap`, for the same reason the
 * cavity map is not bound as one on the skin: this stage has a key, a fill and a rim and an
 * ambient of 0.08, so there is almost no indirect term for an occlusion map to attenuate and the
 * map would be invisible. Multiplying it into the albedo is what puts the shading under the collar
 * and in the folds where it belongs.
 */
const SHIRT_PLUM = "#5e2a49";
const SHIRT_COLLAR = "#cfc4b2";
/** The oxford weave repeats far tighter than the fabric's own UVs; 14 is a measured-looking guess. */
const SHIRT_MICRO_TILE = 14;
const SHIRT_MICRO_WEIGHT = 0.4;
/** The indirect term the collar's inner face needs to read as cloth rather than as a hole. */
const SHIRT_INDIRECT = 0.2;

export function shirtLook(maps: SpecimenMaps): Material {
  const material = new MeshPhysicalNodeMaterial();
  const mask = texture(map(maps, "f_top_shirt_Mask.png"), uv());
  const fabric = texture(map(maps, "f_top_shirt_N.png"), uv()).xyz.mul(2).sub(1);
  const micro = texture(map(maps, "micro_pp_oxford_N.png"), uv().mul(SHIRT_MICRO_TILE))
    .xyz.mul(2)
    .sub(1);
  const ao = texture(map(maps, "f_top_shirt_AO.png"), uv()).g;
  const collar = smoothstep(float(0.35), float(0.75), mask.g);
  const weave = vec3(
    fabric.x.add(micro.x.mul(SHIRT_MICRO_WEIGHT)),
    fabric.y.add(micro.y.mul(SHIRT_MICRO_WEIGHT)),
    fabric.z,
  ).normalize();
  const cloth = mix(color(SHIRT_PLUM).rgb, color(SHIRT_COLLAR).rgb, collar)
    .mul(mix(float(0.55), float(1), saturate(ao)));
  material.colorNode = cloth;
  // **The collar's inner face, and why it was a hole in the picture.** The collar is a folded band of
  // two sheets of cloth and the shot is half its *inside*, standing between the neck and the light:
  // the key is at 4.2 from the front-left, an inward-facing sheet gets nearly none of it, and the
  // measured result was a near-black wedge that read as a gap between the skin and the shirt rather
  // than as fabric. A fraction of the albedo as emission is the stand-in for the indirect light this
  // stage's 0.08 ambient cannot supply — it lifts the inside of the collar to a dark plum that is
  // still obviously cloth, and on the lit outer faces it is a fifth of a stop against a key of 4.2.
  material.emissiveNode = cloth.mul(SHIRT_INDIRECT);
  // Re-encoded, because `normalMap` decodes whatever node it is handed as `x*2-1`.
  material.normalNode = normalMap(weave.mul(0.5).add(0.5), vec2(1, -1));
  material.metalness = 0;
  // Cloth, and the roughness the fabric's own map does not carry: a shirt at 0.5 is a satin.
  material.roughness = 0.82;
  material.specularIntensity = 0.2;
  material.vertexColors = false;
  // The export marks the material double-sided and the plackets are genuinely two sheets of cloth.
  material.side = DoubleSide;
  material.name = "metahuman-lab/shirt";
  return material;
}

/** `MeshPhysicalMaterial` for this sample: metal-free, and never the import's vertex colours. */
function phys(options: MeshPhysicalMaterialParameters): MeshPhysicalMaterial {
  return new MeshPhysicalMaterial({ metalness: 0, ...options });
}

/**
 * Eyelash cards, which the export marks alpha-blended and ships without a mask.
 *
 * The coverage map is the mask the import dropped: white where a lash is, black where the card is
 * air. It is read as *opacity* rather than as a cut-out, and that is the whole look. An alpha test
 * is the obvious reading and it is the one that fails here: a lash is a fifth of a pixel wide at
 * portrait framing, so a test keeps whichever sub-pixel strand happens to cover a pixel centre and
 * drops the rest — measured, 5% of the card's area survives, which is the fleck-at-the-corners
 * report. Blended, the same mask leaves every strand at its real width and the empty air of a card
 * costs nothing, so the lid darkens where the lashes are and not where they are not.
 *
 * So this one card is drawn after the face with `depthWrite` off: it is a decal on the lid, and the
 * lid is already in the depth buffer.
 */
function lashes(maps: SpecimenMaps): Material {
  return phys({
    color: new Color("#140d0a"),
    alphaMap: map(maps, "Eyelashes_L_SlightCurl_Coverage.png"),
    transparent: true,
    depthWrite: false,
    roughness: 0.85,
    // Zero, for the same reason the cards carry none: a lash is a decal on the lid a few pixels
    // across, and a dielectric highlight on it is a blue-white point of light on the eyelid.
    specularIntensity: 0,
    side: DoubleSide,
    vertexColors: false,
  });
}

/**
 * One eye, from the texture `tools/prepare.mjs` composited for it: sclera, iris and pupil placed
 * on this eye's own polar unwrap. `eyeMaterial` dims it, warms it and puts the lid's shadow on it.
 */
function eye(maps: SpecimenMaps, side: string): Material {
  const name = `Eye_D_${side}.png`;
  return eyeMaterial({ colour: map(maps, name), normal: map(maps, "T_Eye_N.png") });
}

/**
 * An overlay Unreal draws translucently. Hidden rather than faked: see the file header.
 *
 * `visible = false` is three's per-material switch, so the group is skipped in the render list
 * and in the shadow pass while the mesh and its morph targets stay exactly where they were.
 */
function overlay(): Material {
  return phys({ visible: false, vertexColors: false });
}

/** The one material per primitive this sample ships, by the name the export gave it. */
function forPrimitive(name: string, maps: SpecimenMaps, wrinkles: IWrinkles | undefined): Material {
  // The brow cards stay welded into the specimen (the rig binds their morphs) and are not drawn:
  // the brows are strands now, in `strands.ts`, riding the same skin.
  if (/brow/i.test(name)) return overlay();
  if (/eyelash/i.test(name)) return lashes(maps);
  if (/eyerefractive/i.test(name)) return eye(maps, /_L\b/.test(name) ? "L" : "R");
  if (/eyeocclusion|lacrimal|fluid|saliva/i.test(name)) return overlay();
  if (/teeth/i.test(name))
    return teethMaterial({ colour: map(maps, "teeth_color_map_001.png"), normal: map(maps, "teeth_normal_map.png") });
  // The head, and the cartilage, which shares the head's atlas and so must share its look.
  if (name === "" || /head|cartilage/i.test(name)) return skin(maps, wrinkles);
  // A primitive this file has never heard of is the sample's problem, not a reason to fail the
  // load: it still gets skin, and says so once, in the console the diagnostics panel reads.
  console.warn(`metahuman-lab: no material for '${name}'; drawing it as skin`);
  return skin(maps, wrinkles);
}

/** Every material name on a mesh, which is how a card mesh is told apart from a solid one. */
function materialNames(mesh: Mesh): string {
  return (Array.isArray(mesh.material) ? mesh.material : [mesh.material])
    .map((material) => material?.name ?? "")
    .join(" ");
}

/** Replace every mesh's materials with this sample's look, one group at a time. */
export function applySpecimenMaterials(root: Object3D, maps: SpecimenMaps, wrinkles?: IWrinkles): void {
  root.traverse((object) => {
    const mesh = object as Mesh;
    if (mesh.isMesh !== true) return;
    const draw = (material: Material) => {
      const name = material.name ?? "";
      const replacement = forPrimitive(name, maps, wrinkles);
      // The name is load-bearing, not decoration: the stage finds the two eyeballs by theirs, and
      // a fresh MeshPhysicalMaterial is unnamed, so replacing without this makes the whole head one
      // anonymous material and every later question about the graph unanswerable.
      replacement.name = `metahuman-lab/${name || "skin"}`;
      return replacement;
    };
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(draw) : draw(mesh.material);
    // The rig drives vertices through morph targets and the skeleton; both need a normal to stay
    // correct, and the export's own normals are the only ones there are.
    // The cards resolve their cut-out *inside* the triangle, so a shadow pass — which has no
    // multisample mask to resolve against — would cast a card's full rectangle. Better no shadow
    // from a brow than a grey bar across the forehead.
    const card = /brow|eyelash/i.test(materialNames(mesh));
    mesh.castShadow = !card;
    mesh.receiveShadow = !card;
  });
}

/** The wrinkle maps and the region strip, from the loaded set. */
export function wrinkleTextures(maps: SpecimenMaps) {
  return {
    normals: [map(maps, "FaceNormal_WM1.png"), map(maps, "FaceNormal_WM2.png"), map(maps, "FaceNormal_WM3.png")] as const,
    masks: map(maps, "WrinkleMasks.png"),
  };
}
