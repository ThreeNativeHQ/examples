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
  positionWorld,
  pow,
  saturate,
  smoothstep,
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
  albedo: new Color(0.007, 0.0045, 0.003),
  sheen: new Color(0.5, 0.4, 0.34),
  rootShade: 0.6,
  depthShade: 1,
  widthScale: 4,
  primary: [0.004, 400],
  secondary: [0.003, 90],
  // 0.55 is what turns the coverage mass back into fibres: without it the 4x brow is one flat
  // black slab with a silhouette, because every fibre in a brow shares a normal, a depth and a key
  // and the only terms that separate a groom's fibres are volume terms a brow does not have. The
  // seed is per fibre and stable, so this is the per-fibre separation for free.
  seedVary: 0.55,
} as const;

/** Unreal writes tangent-space normals green-up; three reads them green-down. */
const DIRECTX_TO_THREE = vec2(1, -1);

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
  const skin = texture(maps.colour, uv())
    .rgb.mul(mix(float(CAVITY_FLOOR), float(1), pow(saturate(cavity), float(CAVITY_GAMMA))))
    .mul(SKIN_TINT);
  material.colorNode = mix(skin, SCALP_TINT, scalp);
  material.normalNode = normalMap(texture(maps.normal, uv()), DIRECTX_TO_THREE);
  // **Everything that makes skin look like skin is switched off under the groom, not just its
  // colour.** A near-black albedo under a key at 4.2 still rendered 57/36/28 at the crown with the
  // colour alone, because what was left was the specular and the scatter: the broad lobe lands on
  // the four places a face is turned to mirror the key, and the crown is one of them. Hair has a
  // roughness of 1 and no dielectric term, so the scalp takes both, and the terminator scatter —
  // which is the whole point of the graph on a cheek — is multiplied out of it.
  const face = oneMinus(scalp);
  material.roughnessNode = mix(rough.mul(0.55).add(0.18), float(1), scalp);
  material.metalness = 0;
  material.specularIntensity = SKIN_SPECULAR;
  material.specularIntensityNode = float(SKIN_SPECULAR).mul(face);

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
    .mul(KEY_TINT)
    .mul(scattered.mul(SCATTER_STRENGTH).add(through.mul(0.4)))
    .add(KEY_TINT.mul(broad.mul(cavity)))
    .mul(cavity)
    .mul(face);
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

