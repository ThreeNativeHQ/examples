import { Color, DoubleSide, type Texture, Vector3 } from "three";
import { MeshPhysicalNodeMaterial } from "three/webgpu";
import {
  cameraPosition,
  color,
  cross,
  dFdx,
  dFdy,
  dot,
  float,
  mix,
  normalMap,
  normalWorld,
  normalize,
  oneMinus,
  positionGeometry,
  positionWorld,
  pow,
  saturate,
  smoothstep,
  step,
  sqrt,
  texture,
  uniform,
  uv,
  vec2,
  vec3,
} from "three/tsl";

/**
 * The surfaces this lab writes itself: skin, the eyeball, and the look of Ada's strand hair (the
 * strands themselves are drawn by `strands.ts`).
 *
 * They are all `MeshPhysicalNodeMaterial` with a TSL graph on top, because the engine's renderer is
 * three's `WebGPURenderer` and a node material is therefore the same pipeline the rest of the scene
 * is already on — no second renderer, no `onBeforeCompile` string surgery.
 *
 * The one thing deliberately absent is a sheen lobe. It was measured out on this face and it stays
 * out: three's sheen is an energy compensation, `1 - max3(sheenColor) * IBLSheenBRDF(...)`, applied
 * to the *whole* irradiance, and `IBLSheenBRDF` rises towards 1 exactly where the surface turns away
 * from the eye. The rim of every silhouette — the jawline, where the mandible has rotated out of the
 * key and would be lit by the fill alone — had its diffuse scaled towards nothing and drew pure
 * black. A grazing highlight is worth less than an unlit face.
 */

/** The key light's world direction, shared by both graphs. Written once by `setKeyDirection`. */
const KEY_DIRECTION = uniform(new Vector3(0, 0, 1));

/**
 * Point both graphs at the stage's key light.
 *
 * The stage is three directional lights, and a node graph cannot ask "the brightest light" a
 * question, so the game hands over the one it means. It is a static rig, so this is a one-time write
 * rather than a per-frame uniform update — and it is the same light the physical material is already
 * lit by, which is the only way the added lobes and the built-in ones agree about where the
 * terminator is. Getting that wrong is the whole difference between scatter and a painted-on glow.
 */
export function setKeyDirection(direction: Vector3): void {
  KEY_DIRECTION.value.copy(direction).normalize();
}

/**
 * The coil's look: near-black fibre, a faint warm sheen, and a self-shadow deep enough that the
 * mass reads matte. Albedo is linear; the reference's lit hair mass measures 14/13/11 sRGB.
 */
export const HAIR_LOOK = {
  albedo: new Color(0.0019, 0.0014, 0.0012),
  sheen: new Color(0.72, 0.58, 0.5),
  rootShade: 0.12,
  depthShade: 0.1,
  primary: [0.01, 400],
  secondary: [0.008, 90],
  shift: 0.12,
  ambient: 1,
  // Round 12: back down from 4. The reference's brow is a *thin* tapered arch, and at 4x the fibres
  // made a bushy black band; the density now lives in the painted stain under them (`skinMaterial`),
  // so the fibres only have to read as hair, not carry the whole brow.
  widthScale: 2.2,
} as const;

/**
 * The brows: the same fibre, a warmer brown, and no volume to be buried in.
 *
 * **Wider and denser, and the arithmetic says by how much.** A brow fibre is measured on the
 * prepared `brows.strands.bin` at a median 0.035 mm — a twentieth of a pixel at this framing, and
 * 1 354 of them, so the strand mesh's coverage subset (see `strands.ts`) was keeping roughly one
 * fibre in twelve at a 1.3x width. That is the "thin, spiky, feathery" report exactly: too few
 * fibres, each one a hard isolated line with skin between them, where the reference is a filled
 * soft mass. `widthScale` is the single lever for both halves of that, because coverage is
 * `width / drawnWidth` — widening the fibre raises the share kept *and* widens what is kept, so
 * 4.0 roughly quadruples the brow's ink rather than merely fattening a third of it.
 *
 * **Darker, and the specular down with it — but not by crushing the albedo.** Measured on the
 * round-10 capture, the drawn fibre core already read 26 against the reference's 24, so the fibre's
 * own darkness was right and what was missing was *coverage*: the reference's brow strip averages
 * 51 luma against this one's 81, which is skin showing between too few fibres. So the density does
 * the darkening, and the albedo drops only a little — a brow crushed to black reads as a painted
 * line, which is the other way to be wrong. The two lobes go to 40% and 38% of the hair's and the
 * sheen tint down with them: a brow is a few dozen fibres deep lying flat on the skin, so a cuticle
 * highlight has nothing to catch, and a sheen on it is the grey haze the report calls "feathery".
 * The warm tint stays — it is the only thing keeping the fibre from going blue-black.
 */
export const BROW_LOOK = {
  ...HAIR_LOOK,
  // **Round 12: a brown fibre, not a black one.** Side by side at 2x, the reference's brow is a soft
  // brown arch barely a stop under the skin around it, and ours was a black band of hard fibres —
  // which is the "artificial" report in one picture. Linear 0.02/0.008/0.0042 is a deep warm brown
  // that sits *on* this skin's hue instead of cutting a hole in it.
  albedo: new Color(0.02, 0.008, 0.0042),
  sheen: new Color(0.35, 0.25, 0.18),
  rootShade: 0.75,
  depthShade: 1,
  // Back down from 4 to 1.5. The reference's brow is a *thin* tapered arch, and at 4x the fibres made
  // a bushy band; the density now lives in the painted stain under them (`skinMaterial`), so the
  // fibres only have to read as hair, not carry the whole brow.
  widthScale: 1.5,
  primary: [0.003, 400],
  secondary: [0.002, 90],
  // Per-fibre brightness from the fibre's own stable seed, so fibres that share a normal, a depth and
  // a key still read as separate hairs rather than one flat slab.
  seedVary: 0.4,
} as const;

/**
 * Unreal writes tangent-space normals green-up; three reads them green-down.
 */
const DIRECTX_TO_THREE = vec2(1, -1);

/**
 * How hard the pore map is allowed to bend the surface.
 *
 * The specimen's `FaceNormal_MAIN` is 4096² of *pores* over a head 0.30 m tall, so one pore is about
 * a fifth of a millimetre — a third of a pixel at portrait framing, and a sixth of one on a cheek
 * turned away. At the map's own strength that is not detail, it is a per-pixel normal, and a
 * sub-pixel normal is what reads as the grainy, sandy surface the round-12 report is about: it
 * sparkles along the terminator and it crawls under a smile, because the surface is being rewritten
 * by 782 morph targets while the camera holds still.
 *
 * Round 12 moved the cure: the base layer now reads this map two mips down (`DIFFUSION_MIPS`), where
 * the pores are already averaged away, and the pores live only in the clearcoat lobe at `PORE_SCALE`.
 * So the base keeps the map's own strength — 0.5 there made the wrinkles and the face's own folds
 * invisible (measured: forcing wrinkle map 1 on at full weight changed 52 pixels of a brow shot).
 */
const NORMAL_STRENGTH = 1;
/** The same flip and the strength in one node, because `normalMap` decodes whatever scale it is given. */
const NORMAL_SCALE = vec2(NORMAL_STRENGTH, -NORMAL_STRENGTH);

/**
 * The mouth interior, found by where the atlas puts it rather than by planes through the face.
 *
 * The head primitive is one mesh carrying the lips, the mouth sock, the palate and the throat, and
 * MetaHuman unwraps the sock as its own UV island: the two pink ovals in the top corners of
 * `FaceColor_MAIN` (u < 0.12 or u > 0.88, v < 0.14). Every vertex behind the lips in this specimen —
 * 371 of them, measured by plotting the sock's UVs over the atlas — lands on those two islands, and
 * no surface of the face does. The plane test this replaced (a y band, a z window, an |x| limit and a
 * normal gate) also caught the commissure: the cheek beside a mouth corner curves back behind the lip
 * plane and faces sideways, so it drew as a grey smudge beside the lips at every angle.
 *
 * Inside the island the darkening is a ramp on the *bind* depth: 9.5 cm (just behind the lips) keeps
 * a little of the atlas's own wet red, and the throat at 2 cm is close to black. Bind, never skinned —
 * the lower sock rides the jaw, and a skinned depth would re-light it as the mouth opens.
 */
const MOUTH = {
  island: vec2(0.12, 0.14),
  front: 0.095,
  back: 0.02,
  /** How much of its own colour the sock keeps just behind the lips, and at the back of the throat. */
  keepFront: 0.4,
  keepBack: 0.04,
} as const;

/**
 * Both tints as plain `vec3`, because they multiply and add rather than being an output colour: a
 * `color()` node is the one that goes through the output's colour-space conversion, and running a
 * light tint through it twice is how a scatter ends up the wrong red.
 */
const KEY_TINT = color("#fff2e2").rgb;

/**
 * The red the terminator scatters, and how hard.
 *
 * This was `#c2402a` at 0.55 and it read as a sunburn rather than as light going *through* a cheek:
 * measured on the round-5 captures the neck and the upper chest were a full stop more red than the
 * albedo, and the face's lit side was carrying an orange cast from the same term. The cure is the
 * tint, not the strength — the scatter has to be the albedo's own brown lifted, because that is
 * what light leaving a dark skin does, and a saturated red is a light the skin does not emit.
 *
 * So the red channel is halved against the green and blue rather than all three coming down: 0.55
 * of `#c2402a` became 0.4 of `#8c4638`, which leaves the terminator wrapped and the shadow side
 * alive while the added light stays inside the colour the texture map already painted.
 */
const SCATTER_TINT = color("#8c4638").rgb;

/**
 * What the scalp wears under the groom: the hair's own root colour, so the gaps between fibres show
 * more hair rather than lit skin. Where is `HairScalp_Mask.png`, which `tools/prepare.mjs` derives
 * from the groom's own roots — not a painted band.
 */
const SCALP_TINT = color("#050302").rgb;
const SCATTER_STRENGTH = 0.5;
const WRAP = 0.62;

/**
 * The skin's own tint, applied to the specimen's albedo before anything is lit.
 *
 * Measured on matched points — the same forehead, cheek and nose patches in
 * `artifacts/look/round-10-front.png` and in the reference render — round 10 read 114/74/58,
 * 130/83/65 and 98/56/41 against the reference's 96/55/37, 88/48/32 and 145/94/70. The blue channel
 * was lifted 57% on the forehead and 103% on the cheek while the red moved 19% and 48%, and *that
 * ratio* is the whole report: the face was not merely too bright, it was too bright **in the
 * channel the key should barely reach**, which is exactly what "lighter and greyer" is on a render.
 * A uniform scale cannot fix it — it moves all three channels together and leaves the hue alone.
 *
 * So this is per-channel, and linear, because the map is. Each factor is a measured sRGB shortfall
 * inverted through the output transfer, so what lands is a lit result on the reference's values
 * rather than an albedo that looks right and does not. Two capture rounds set it. The first,
 * 0.62/0.46/0.36, put the forehead's red on the reference exactly and left its blue 26% high with
 * the cheek 20% high in green and 33% in blue — the residual sitting almost entirely on the two
 * cool channels — so the second pass takes those down and leaves red nearly alone. The head carries
 * the tint, so the neck and the cartilage do too; the scalp and the shirt have their own materials
 * and are untouched.
 */
const SKIN_TINT = vec3(0.55, 0.33, 0.165);

/** The broad lobe's exponent and weight: a wide, wet band a single-lobe BRDF cannot express. */
const BROAD_EXPONENT = 4.5;
const BROAD_WEIGHT = 0.025;

/**
 * How hard the cavity map bites, and how much of the face's own colour is left at the bottom of it.
 *
 * The map is measured: over the whole 4096² file it runs 0.118 to 1.0 with a mean of 0.907, so it
 * is mostly *white* and its information is entirely in the creases — the eye sockets, the nostrils,
 * the philtrum, the ear, the neck. Read as `mix(0.5, 1, cavity)` that information is worth half a
 * stop in the socket, which is why the flat report and the reference's deep-set eyes are so far
 * apart: the reference's socket is 68/34/24 against a 131/83/63 cheek, and this was landing near
 * 100/71/59. `cavity^1.6` with a 0.3 floor puts the socket at about a third of the cheek and leaves
 * the broad flat areas of the face at 0.88, so the creases read without the face looking grubby.
 */
const CAVITY_FLOOR = 0.12;
const CAVITY_GAMMA = 2;

/**
 * The specular share of the surface. Skin's real F0 is about 0.028, and 0.32 gave 0.013.
 *
 * Lowered from 0.45 on a measurement rather than a hunch: with the albedo tinted, the blue channel
 * came in on the nose side (30 against a reference 31) and 25% over on the forehead and cheek, and
 * the only term that is neutral rather than warm is this one — the albedo cannot be both right on a
 * shadowed side and too blue on a lit one. The sheen is not what goes; the *strength* is, and the
 * broad lobe below still carries the wet band on the forehead, the nose bridge and the cheekbones.
 */
const SKIN_SPECULAR = 0.34;

/** Mips of blur on the base layer's normal: 2 is a 4x footprint, enough to take the pores (1–2 texels) out. */
const DIFFUSION_MIPS = 2;
/** The pores in the oily film keep the map's full strength: a tight lobe is where they belong. */
const PORE_SCALE = vec2(0.45, -0.45);
/** The clearcoat's share: the oily film's glint, which the reference carries on forehead, nose and lips. */
const OIL_WEIGHT = 0.35;
/**
 * The brow's stain: a *darkening of the skin's own colour*, a little warmer, and how far the densest
 * skin goes. A fixed brown was the first try and it drew a grey halo, because this skin's albedo is
 * far redder than any neutral brown — the stain has to keep the hue it sits on.
 */
const BROW_STAIN = vec3(0.34, 0.3, 0.28);
const BROW_STAIN_WEIGHT = 0.5;

/**
 * Skin: the specimen's own maps, plus the two things a PBR material does not have.
 *
 * **A wrap term that reddens the terminator.** `wrapped` is the diffuse `N·L` pushed 0.62 past zero,
 * so light reaches a little way around the curve of a cheek instead of stopping dead at it.
 * `saturate(wrapped - saturate(N·L))` is the part of that which the ordinary diffuse has not already
 * accounted for — the light that went *into* the skin rather than off it — and it is added as
 * emission tinted `SCATTER`, so the shadow side of a nose is red rather than grey. The
 * forward-scatter term beside it is the light that comes *through* a thin part, the ear rim and the
 * lid, when the camera is on the far side of it from the key.
 *
 * **Two specular lobes.** The physical material's own GGX is the tight one, with roughness read from
 * the map. The broad one is added here, `pow(N·H, 4.5)` at 12% of the key: the wide sheen skin has
 * under a broad source, and it is what the reference's forehead, nose bridge, cheekbones and lips
 * all carry. Its exponent is low on purpose — the *geometry* places it, because `N·H` is only high
 * where the surface is already turned to mirror the key, which on a face is exactly those four
 * places and nowhere else. Both are multiplied by the cavity map, so a crease in the nostril or the
 * lid loses its highlight before it loses its colour — which is what cavity is for, and what binding
 * it as an `aoMap` on the diffuse alone cannot do, because `aoMap` never reaches the specular term.
 *
 * `normalWorld` is read rather than a local normal because it is three's own shading normal *after*
 * the normal map: the scatter has to follow the terminator that is on screen, not the one a
 * low-poly head would give.
 */
export function skinMaterial(maps: {
  readonly colour: Texture;
  readonly normal: Texture;
  readonly roughness: Texture;
  readonly cavity: Texture;
  readonly scalp: Texture;
  readonly brow: Texture;
  readonly wrinkles?: IWrinkles;
}): MeshPhysicalNodeMaterial {
  const material = new MeshPhysicalNodeMaterial();
  const cavity = texture(maps.cavity, uv()).r;
  // The roughness map is a grayscale PNG, so all three channels carry the value. Measured on the
  // file: it runs 0 to 0.894 with a mean of 0.81, which is a *matte* face under the old `*0.8 + 0.15`
  // and read as exactly that — no highlight anywhere, hence "flat". The slope is shallower and the
  // floor lower now, so the map's own variation is what decides how wet a forehead is.
  const rough = texture(maps.roughness, uv()).g;

  // **Under the groom this is the hair's root colour, not skin.** Real strands leave gaps, and a
  // gap over lit skin reads as a bald scalp. The mask is where the groom's roots are, read off the
  // groom by `tools/prepare.mjs` — it feathers exactly as raggedly as the hairline does.
  const scalp = texture(maps.scalp, uv()).r;
  // **The mouth cavity, so the gums and the throat stop being lit like a cheek.** The interior is
  // part of the head's own primitive and carries the face atlas, so before this it was tinted and lit
  // exactly as the face was: a bright salmon band above the teeth, which is what the report calls odd
  // gums. The key physically cannot reach into a closed mouth, and a cavity in shadow is a *darkening
  // of the albedo* rather than a light that is switched off — the hue stays the map's own, which is
  // what keeps a gum a gum instead of a brown hole.
  const inside = insideMouth();
  const skin = texture(maps.colour, uv())
    .rgb.mul(mix(float(CAVITY_FLOOR), float(1), pow(saturate(cavity), float(CAVITY_GAMMA))))
    .mul(SKIN_TINT)
    .mul(mix(float(1), mouthKeep(), inside));
  // **The brow's stain under its strands.** A real brow is not fibres on bare skin: the skin under it
  // is darkened by the density of hair rooted there, and that stain is what makes the reference's
  // brow one soft full arch. The mask is the groom's own density (`tools/prepare.mjs`); read from a
  // blurred mip so it has no edge of its own, and it only ever *darkens* toward the fibre's colour.
  const brow = pow(saturate(texture(maps.brow, uv()).bias(float(2)).r), float(1.6)).mul(BROW_STAIN_WEIGHT);
  material.colorNode = mix(mix(skin, skin.mul(BROW_STAIN), brow), SCALP_TINT, scalp);

  // **Two normals, because skin has two surfaces.** Light that enters skin leaves it a few millimetres
  // away, so the *diffuse* never sees a pore: it sees the surface blurred by its own scattering
  // distance. The oily film on top is what carries the pores, as a tight specular. So the base layer
  // — diffuse, the broad sheen and the terminator scatter below — is shaded with the pore map read
  // two mips down (a 4x footprint, which takes the 1–2-texel pores out and keeps the wrinkles), and the
  // clearcoat layer is the second specular lobe with the full-resolution pores. That split is the cure
  // for "grainy on smile": a sub-pixel pore bending the *diffuse* is noise that crawls as 782 morph
  // targets rewrite the surface, while the same pore in a tight lobe is a sparkle only where the
  // surface actually mirrors the key.
  const pores = texture(maps.normal, uv());
  const diffused = texture(maps.normal, uv()).bias(float(DIFFUSION_MIPS));
  material.normalNode = normalMap(wrinkled(diffused, maps), NORMAL_SCALE);
  material.clearcoatNormalNode = normalMap(pores, PORE_SCALE);
  // **Specular anti-aliasing from the normal's own variance** (Toksvig plus a screen-space kernel).
  // A mip-filtered normal map averages pores into a *shorter* vector: `1 − |n|` is exactly how much
  // normal spread one pixel is hiding, and a lobe that does not widen by it sparkles. The screen-space
  // term catches what the mips cannot — the same pore swimming under a morph — from the pixel-to-pixel
  // change of the decoded normal. Both widen the lobe; neither touches the diffuse.
  const decoded = pores.xyz.mul(2).sub(1);
  const length = decoded.length().max(1e-4);
  const toksvig = oneMinus(length).div(length);
  const kernel = dot(dFdx(decoded.xy), dFdx(decoded.xy)).add(dot(dFdy(decoded.xy), dFdy(decoded.xy))).mul(0.25).min(0.18);
  // biome-ignore lint/suspicious/noExplicitAny: TSL node arithmetic has no useful static type here.
  const widen = (roughness: any) =>
    sqrt(roughness.mul(roughness).add(toksvig.mul(2)).add(kernel.mul(2))).min(1);
  // **Everything that makes skin look like skin is switched off under the groom, not just its
  // colour.** A near-black albedo under a key at 4.2 still rendered 57/36/28 at the crown with the
  // colour alone, because what was left was the specular and the scatter: the broad lobe lands on
  // the four places a face is turned to mirror the key, and the crown is one of them. Hair has a
  // roughness of 1 and no dielectric term, so the scalp takes both, and the terminator scatter —
  // which is the whole point of the graph on a cheek — is multiplied out of it.
  const face = oneMinus(scalp);
  const wet = face.mul(oneMinus(inside)).mul(cavity);
  // Lobe one, the base GGX: broad, from the diffused normal — the soft sheen across a cheekbone.
  material.roughnessNode = mix(widen(rough.mul(0.35).add(0.42)), float(1), scalp);
  material.metalness = 0;
  material.specularIntensity = SKIN_SPECULAR;
  material.specularIntensityNode = float(SKIN_SPECULAR).mul(wet);
  // Lobe two, the clearcoat: tight, from the pores — the oily glint on the forehead, nose and lips.
  material.clearcoatNode = float(OIL_WEIGHT).mul(wet).mul(smoothstep(float(0.95), float(0.55), rough));
  material.clearcoatRoughnessNode = widen(rough.mul(0.3).add(0.28));

  const view = normalize(cameraPosition.sub(positionWorld));
  const light = KEY_DIRECTION;
  const facing = dot(normalWorld, light);
  const wrapped = saturate(facing.add(float(WRAP)).div(float(WRAP + 1)));
  const scattered = saturate(wrapped.sub(saturate(facing)));
  const through = pow(saturate(dot(view, light.negate())), float(3)).mul(saturate(facing.negate()));
  const broad = pow(saturate(dot(normalWorld, normalize(light.add(view)))), float(BROAD_EXPONENT))
    .mul(saturate(facing))
    .mul(BROAD_WEIGHT);

  material.emissiveNode = SCATTER_TINT
    .rgb.mul(KEY_TINT)
    .mul(scattered.mul(SCATTER_STRENGTH).add(through.mul(0.4)))
    .add(KEY_TINT.mul(broad.mul(cavity)))
    .mul(cavity)
    .mul(face)
    .mul(oneMinus(inside));
  return material;
}

/**
 * Ada's wrinkle maps, weighted per region by the rig's animated-map outputs.
 *
 * `normals` are `FaceNormal_WM1..3`; `masks` is the 37 region masks packed three to an RGB tile and
 * stacked (`tools/prepare.mjs --wrinkles`); `weights[k][tile]` is one `vec3` per tile per wrinkle map,
 * holding that map's weight for each of the tile's three regions — zero for a region the map does not
 * own. The game writes them from `human.animatedMaps()` after every evaluation (`bindWrinkles`).
 */
type UniformVec3 = ReturnType<typeof uniform> & { value: Vector3 };

export interface IWrinkles {
  readonly normals: readonly [Texture, Texture, Texture];
  readonly masks: Texture;
  readonly tiles: number;
  readonly weights: readonly (readonly UniformVec3[])[];
  /** Tiles each wrinkle map owns any region in, so a map never samples a tile that cannot weigh it. */
  readonly owned: readonly (readonly number[])[];
}

/** The region table `tools/prepare.mjs` writes beside the strip. */
export interface IWrinkleTable {
  readonly tiles: number;
  readonly regions: readonly { readonly region: string; readonly tile: number; readonly channel: number }[];
}

/**
 * Build the wrinkle binding, and the per-frame writer that feeds it from the rig.
 *
 * The rig names each output `head_wm<k>_normal.<region>`; `k` picks the map and the region picks the
 * tile and channel. An output whose region is not in the table is a sidecar the table was not written
 * for, and the build throws rather than dropping a wrinkle silently.
 */
export function bindWrinkles(
  textures: { readonly normals: readonly [Texture, Texture, Texture]; readonly masks: Texture },
  table: IWrinkleTable,
  names: readonly string[],
): {
  readonly wrinkles: IWrinkles;
  readonly write: (values: ArrayLike<number>) => void;
  /** The strongest weight each wrinkle map was given, read back off the uniforms the shader reads. */
  readonly applied: () => readonly [number, number, number];
} {
  const where = new Map(table.regions.map((entry) => [entry.region, entry] as const));
  const weights = [0, 1, 2].map(() => Array.from({ length: table.tiles }, () => uniform(new Vector3()) as UniformVec3));
  const owned = [new Set<number>(), new Set<number>(), new Set<number>()];
  const route: { index: number; map: number; tile: number; channel: number }[] = [];
  names.forEach((name, index) => {
    const match = /^head_wm([123])_normal\.(.+)$/.exec(name);
    if (match === null) return;
    const entry = where.get(match[2] as string);
    if (entry === undefined) throw new Error(`wrinkle region '${match[2]}' is not in content/wrinkles.json`);
    const map = Number(match[1]) - 1;
    owned[map]?.add(entry.tile);
    route.push({ index, map, tile: entry.tile, channel: entry.channel });
  });
  return {
    wrinkles: { ...textures, tiles: table.tiles, weights, owned: owned.map((set) => [...set].sort((a, b) => a - b)) },
    write: (values) => {
      for (const { index, map, tile, channel } of route)
        weights[map]?.[tile]?.value.setComponent(channel, values[index] ?? 0);
    },
    applied: () => {
      const strongest = (k: number) =>
        Math.max(0, ...(weights[k] ?? []).map(({ value }) => Math.max(value.x, value.y, value.z)));
      return [strongest(0), strongest(1), strongest(2)];
    },
  };
}

/** The base normal with each wrinkle map blended in where, and as far as, the rig says it is active. */
function wrinkled(base: ReturnType<typeof texture>, maps: { readonly wrinkles?: IWrinkles }) {
  const wrinkles = maps.wrinkles;
  if (wrinkles === undefined) return base;
  const at = uv();
  const tiles = new Map<number, ReturnType<typeof texture>>();
  const tile = (index: number) => {
    let node = tiles.get(index);
    if (node === undefined) {
      node = texture(wrinkles.masks, vec2(at.x, at.y.add(index).div(wrinkles.tiles)));
      tiles.set(index, node);
    }
    return node;
  };
  // biome-ignore lint/suspicious/noExplicitAny: see above.
  let normal: any = base.xyz;
  wrinkles.normals.forEach((map, k) => {
    const owned = wrinkles.owned[k] ?? [];
    if (owned.length === 0) return;
    // biome-ignore lint/suspicious/noExplicitAny: an accumulating TSL sum changes node type per add.
    let weight: any = float(0);
    for (const index of owned) weight = weight.add(dot(tile(index).rgb, wrinkles.weights[k]?.[index] as never));
    normal = mix(normal, texture(map, at).bias(float(DIFFUSION_MIPS - 1)).xyz, saturate(weight));
  });
  return normal;
}

/** 1 on the mouth sock's UV island, 0 on the face. */
function insideMouth() {
  const at = uv();
  const corner = oneMinus(step(MOUTH.island.x, at.x)).max(step(float(1).sub(MOUTH.island.x), at.x));
  return corner.mul(oneMinus(step(MOUTH.island.y, at.y)));
}

/** What the sock keeps of its albedo: most of it just behind the lips, almost none at the throat. */
function mouthKeep() {
  return mix(float(MOUTH.keepBack), float(MOUTH.keepFront), smoothstep(float(MOUTH.back), float(MOUTH.front), positionGeometry.z));
}

/**
 * The teeth: the specimen's own colour and normal map, plus the occlusion Unreal ships separately as
 * `T_Teeth_mouthOcc` and this export has no slot for.
 *
 * **Depth *is* the occlusion**, and the specimen's own geometry says so: 73 mm from the last molar to
 * the incisors, with the arch's corners — the part the report calls a white glitchy shape at the
 * mouth corner — sitting at 0.046..0.083, i.e. deeper than the midpoint of the ramp. A molar drawn at
 * an incisor's brightness is a white sliver; a real corner of a real mouth is a shadow, and this is
 * that shadow. The roughness rides the same ramp, because a wet highlight on a back molar is the
 * other half of the same wrongness.
 *
 * A dim red bounce is added on top, keyed to the same depth: light off the gums is what keeps the
 * lower arch from being a void, and the report's "lower teeth barely visible" is a *value* problem,
 * not a geometry one — both arches' front teeth stand equally far forward, so the ramp leaves them
 * alone and it is the bounce, not the ramp, that lifts the lower row.
 */
const ENAMEL_BOUNCE = 0.12;
/** The teeth primitive's own z extent, measured: 0.0302 at the last molar, 0.1033 at the incisors. */
const TEETH = { back: 0.03, front: 0.1033, bite: 1.426 } as const;

export function teethMaterial(maps: {
  readonly colour: Texture;
  readonly normal: Texture;
}): MeshPhysicalNodeMaterial {
  const material = new MeshPhysicalNodeMaterial();
  // The teeth's own extent, which is its own ramp: the incisors stand 73 mm in front of the last
  // molar, and that distance is the occlusion Unreal ships separately as `T_Teeth_mouthOcc`.
  // **Occlusion runs along the arch as well as into it.** An incisor is at the front of the arch and
  // a molar at the end of it, and both ends are *farther from the light that gets into a mouth* than
  // the front-centre is — so the ramp is the depth into the mouth and the arch's own half-width, not
  // the depth alone. This is the report's "flat white strip": a band whose every tooth is drawn at an
  // incisor's value, which is why the corners of the arch read as two bright slivers and the middle
  // as one flat plate.
  // Depth alone, and steep: the incisors (z 0.103) and canines (0.095) are the teeth light reaches;
  // the premolars fall to half and the molars to the floor. The arch-width term this used to add made
  // the *corners* brighter, which is exactly backwards — it is what lit the last upper molar as a white
  // sliver through the corner of the lips.
  const along = smoothstep(float(0.062), float(TEETH.front), positionGeometry.z);
  // **The gum line is darker than the biting edge.** Both arches meet at y 1.426; enamel near the
  // gums sits under the lip and between the teeth's own curvature, the edge catches the light.
  const edge = oneMinus(smoothstep(float(0.004), float(0.015), positionGeometry.y.sub(TEETH.bite).abs()));
  // **And toward the corners of the mouth.** Past the canines (|x| 0.011) the arch runs back under the
  // cheek, where the lip corner shadows it — the bright sliver the owner saw at the mouth corner was
  // a premolar drawn at an incisor's value.
  const lateral = smoothstep(float(0.011), float(0.024), positionGeometry.x.abs());
  // **Enamel against everything else, read off the atlas's own colour.** The teeth primitive is
  // MetaHuman's whole mouth kit — both arches, the gums and the tongue — on one 2048² map: the teeth
  // rows along the top, the tongue bottom-left, the gum and palate shells bottom-right. Enamel is the
  // one surface in it that is not red: measured, 212/191/162 (r−g 0.08) against the gums' 174/95/88
  // and the tongue's 180/101/94 (r−g 0.31). A height band was the old separator and it cut through
  // the lower incisors as the jaw swung; the colour moves with the UVs, so it never does.
  const enamel = texture(maps.colour, uv()).rgb;
  const redness = enamel.r.sub(enamel.g);
  const tooth = oneMinus(smoothstep(float(0.13), float(0.21), redness));
  // Soft tissue is a wet, darker red — the atlas is painted for a mouth under Unreal's own occlusion.
  const albedo = mix(
    enamel.mul(vec3(0.42, 0.22, 0.2)),
    enamel.mul(vec3(0.62, 0.58, 0.52)).mul(mix(float(0.55), float(1), edge)),
    tooth,
  );
  material.colorNode = albedo.mul(mix(float(0.03), float(1), pow(along, float(1.5)))).mul(mix(float(1), float(0.3), lateral));
  material.normalNode = normalMap(texture(maps.normal, uv()), DIRECTX_TO_THREE);
  // Enamel is glossy, the tongue and gums wet; both lose their highlight at the back of the mouth.
  material.roughnessNode = mix(float(0.8), mix(float(0.5), float(0.28), tooth), along);
  material.specularIntensityNode = mix(float(0.05), mix(float(0.2), float(0.6), tooth), along).mul(
    mix(float(1), float(0.3), lateral),
  );
  material.clearcoatNode = tooth.mul(along).mul(0.35);
  material.clearcoatRoughness = 0.2;
  material.metalness = 0;
  material.emissiveNode = color("#7a2f24").rgb.mul(ENAMEL_BOUNCE).mul(along).mul(tooth);
  return material;
}

/**
 * The eyeball: the specimen's own sclera-and-iris composite, darkened, warmed, and sitting in the
 * shadow its own lid casts on it.
 *
 * **The iris and the sclera are two different corrections, and one scale cannot be both.** The
 * composite is measured: the iris reads 0.365/0.251/0.161 and the sclera 0.734/0.685/0.658, so
 * scaling the ball uniformly moves the pair together and the *ratio* between them — which is what
 * makes an eye look like an eye — never moves. Measured on the reference her iris is 25/15/11 to
 * 41/26/19, essentially the hair's own value, where one uniform scale left it at 63/37/32 to
 * 78/59/46: a bright orange sticker. So the two are separated by luminance — the iris is the dark
 * 0.27 of the pair and the sclera the bright 0.70, and nothing in between is either — and dimmed
 * independently, the iris by about 2.5x and the sclera by a sixth.
 *
 * **The lid's shadow, from the ball's own normal.** The export's `EyeOcclusion` primitive is a
 * translucent overlay this sample does not draw (see `materials.ts`), so without this the top of
 * every eyeball is as bright as the bottom and the eyes read as spheres stuck onto a face.
 * `normalWorld.y` is the one term that needs no convention: it is 1 at the top of the ball under the
 * upper lid, 0 at the bottom, and it moves with the head, which is what a cast shadow does. Reading
 * it off the UV instead would have needed the polar unwrap's `v` direction, and this atlas's
 * direction is an assumption; the normal is measured.
 *
 * The cornea is the clearcoat: one tight dielectric layer over the whole ball, which is what puts
 * the small catchlight on it and makes the eye read as wet rather than printed. It is the only
 * specular term and it is untouched by the dimming, which is what keeps the catchlight.
 */
const EYE_SCLERA = vec3(0.17, 0.15, 0.14);
// The iris is 0.075 and measured 63/37/32 where the reference's is 25/15/11 — 2.5x, and still
// reading orange. 0.030 lands it on the reference's own value, and it is the one number in the eye
// that has to come from the render rather than from the texture: the composite's iris is 0.365
// linear and the reference's *rendered* iris is 0.01, so the pair differ by a factor no uniform
// scale of the ball can express.
const EYE_IRIS = vec3(0.03, 0.021, 0.017);
/** The luminance window the two are separated over: 0.34 below is iris, 0.56 above is sclera. */
const EYE_SPLIT = vec2(0.34, 0.56);
const LID_SHADOW = 0.3;

export function eyeMaterial(maps: {
  readonly colour: Texture;
  readonly normal: Texture;
}): MeshPhysicalNodeMaterial {
  const material = new MeshPhysicalNodeMaterial();
  const lid = smoothstep(float(-0.35), float(0.55), normalWorld.y);
  const base = texture(maps.colour, uv()).rgb;
  const luma = dot(base, vec3(0.2126, 0.7152, 0.0722));
  const iris = oneMinus(smoothstep(EYE_SPLIT.x, EYE_SPLIT.y, luma));
  material.colorNode = mix(base.mul(EYE_SCLERA), base.mul(EYE_IRIS), iris).mul(
    mix(float(1), float(LID_SHADOW), lid),
  );
  material.normalNode = normalMap(texture(maps.normal, uv()), DIRECTX_TO_THREE);
  material.metalness = 0;
  material.roughness = 0.2;
  material.specularIntensity = 0;
  material.clearcoat = 0.45;
  material.clearcoatRoughness = 0.1;
  return material;
}

