#!/usr/bin/env node
/**
 * Specimen preparation for the MetaHuman Expression Lab.
 *
 * Turns the two licensed source files a MetaHuman import leaves behind — the exported skinned
 * GLB and the head DNA the CUE4Parse converter pulled out of the same package — into the three
 * files `loadMetaHuman` takes: `specimen.glb`, `head.dna` and `bindings.json`.
 *
 *   node tools/prepare.mjs [specimen.glb] [head.dna] [--out content] [--quiet]
 *
 * The sidecar is derived **by construction**, never hand-edited:
 *
 *   joints   exact DNA joint name == glTF node name
 *   morphs   glTF morph target named `<dnaMesh>__<DNA channel>`, and only where that target
 *            actually carries delta data for that primitive
 *   lods     the two authored mesh sets in the container — LOD0, and the LOD1 the same package
 *            exports, welded onto the same skin so a switch needs no second file
 *   controls the PRD's 20 semantic faceboard aliases, resolved against the rig's real
 *            `RigEvaluator.names("gui")`, one alias per GUI channel and grouped in the UI
 *
 * It also copies the licensed texture set into `content/textures/` and composites the one texture
 * that does not exist in the source package: the eye, whose sclera and iris arrive as separate
 * maps on separate UV layouts. That composite's placement is measured off the eye mesh's own UVs,
 * for the same reason the sidecar is — a hand-typed centre is a guess that happens to look right.
 *
 * Then `validateMetaHumanAssets` checks the result against the rig and the glTF JSON, and a
 * report prints what was measured. Any validation failure exits non-zero.
 *
 * The output directory is gitignored: the specimen is Fab Standard License, local use only.
 * Runtime code licensing does not resolve asset distribution rights, so nothing here is
 * committed and nothing here is copied into a tracked path.
 */

import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { RigEvaluator, validateMetaHumanAssets } from "@threenative/metahuman";

const run = promisify(execFile);

const PROJECT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Where the licensed Fab sample lives, and the only place this script is portable by.
 *
 * Every source path below is derived from this one directory rather than carrying an author's home
 * directory in it, because a hard-coded `/home/<someone>/…` is a script that only runs on one
 * machine. `METAHUMAN_SOURCE_DIR` overrides the base outright — set it to the directory holding the
 * `ada-face`, `ada-textures2`, `ada-hair`, `ada-shirt` and `groom` folders — and the default is the
 * same directory under the invoking user's own home.
 */
const SOURCE = process.env.METAHUMAN_SOURCE_DIR ?? join(homedir(), ".cache/threenative/metahuman");

const DEFAULT_SPECIMEN = join(SOURCE, "ada-face/Models/Ada_FaceMesh.glb");
/**
 * The LOD1 of the same export, welded into `specimen.glb` as a second mesh set.
 *
 * `loadMetaHuman` builds its handle from one `loader.scene`, and its LOD bindings are glTF mesh
 * indices in that container — so a second LOD has to be inside the same file rather than beside it.
 * This level carries no morph targets at all (19 269 vertices against LOD0's 34 615), which is what
 * makes it worth previewing: whatever the face was doing through blend shapes alone would simply
 * not be there, and the joints would have to carry the expression by themselves.
 */
const DEFAULT_LOD1 = join(SOURCE, "ada-face/Models/Ada_FaceMesh_LOD1.glb");
const DEFAULT_DNA = join(SOURCE, "ada-face/dna/Ada_FaceMesh.dna");
const DEFAULT_TEXTURES = join(SOURCE, "ada-textures2/textures/Content/MetaHumans");

/**
 * The rest of Ada, from the same Fab sample: the hair, the brows and the body.
 *
 * The face mesh this lab already prepared is authored *alone*, which is why its prepared head is
 * bald and eyebrowless. These are the meshes Unreal hides while a faceboard session is open, and
 * they are what turns a head-and-shoulders study into a portrait. They are copied next to the
 * specimen, into the same gitignored `content/`, on the same licence terms.
 *
 * The card meshes are authored in the specimen's own rest space — measured, the brow cards span
 * y 1.4963..1.5178 and the head mesh y 1.2426..1.5914, both in metres with y up — so neither needs a
 * placement guess: the brow and hair cards go into the scene exactly where the exporter put them.
 *
 * `f_med_nrw_body.glb` is the exception, and the correction is measured rather than assumed: it is
 * an **extremities** LOD, 13 164 vertices of two hands and two feet, and not the bust this comment
 * used to claim. Its skeleton is the specimen's own — `pelvis` (0, 0.87071, 0.02095), `neck_01`
 * (0, 1.32989, −0.02048), `head` (0, 1.43358, 0.00133) and every other shared joint are identical
 * in both files, with identical inverse bind matrices and unit node scales — so it needs no
 * transform; but no vertex in it is bound to `spine_05`, `clavicle_l/r`, `neck_01/02` or `head`, and
 * its geometry stops at y 0.9656, a wrist. It is still copied, because the sample's licence covers
 * it and `src/scenes/Lab.ts` says why the game does not load it; nothing here depends on the copy.
 */
const DEFAULT_HAIR = join(SOURCE, "ada-hair");
const DEFAULT_SHIRT = join(SOURCE, "ada-shirt");

/**
 * The body meshes, as `content/` names. The brow cards are welded into the specimen rather than
 * copied; the hair is strands (`prepareStrands`), so no card mesh is copied at all.
 *
 * The shirt is in the same bind space as the specimen and the hair — measured, not assumed: it
 * carries the whole body skeleton, and its `root`, `pelvis`, `spine_05`, `neck_01`, `neck_02`,
 * `head`, `clavicle_l/r` and `upperarm_l/r` all resolve to the specimen's own world translations
 * to five decimals (pelvis 0, 0.87071, 0.02095; neck_01 0, 1.32989, −0.02048; head
 * 0, 1.43358, 0.00133) with the same `root` rest rotation, so **identity is the placement** and
 * `src/scenes/Lab.ts` adds it straight to the scene. Its own geometry spans y 0.8929..1.3874, so
 * the collar lands at the jaw and closes the chin-to-shoulder gap the head mesh's own neck leaves.
 */
const MODELS = [
  { from: "Models/f_med_nrw_body.glb", to: "body.glb" },
  { root: DEFAULT_SHIRT, from: "Models/f_med_nrw_top_shirt_nrm.glb", to: "shirt.glb" },
];

/**
 * The shirt's own maps, from the same licensed package.
 *
 * The GLB arrives with an exporter's *guesses* bound (a base colour, a normal and an occlusion on
 * `M_f_top_shirt`), not the material's real maps, so the game binds these four instead: the mask
 * whose green channel is the collar, the fabric normal, the fabric AO, and the oxford micro-normal
 * that goes on top of it. The 8192² fabric normal is written at 4096 for the same reason the two
 * 8192² face maps are.
 */
const SHIRT_TEXTURES = [
  { from: "textures/Content/MetaHumans/Common/Materials/Shirt/Female/f_top_shirt_Mask.png" },
  {
    from: "textures/Content/MetaHumans/Common/Materials/Shirt/Female/f_top_shirt_N.png",
    resize: 4096,
  },
  { from: "textures/Content/MetaHumans/Common/Materials/Shirt/Female/f_top_shirt_AO.png" },
  {
    from: "textures/Content/MetaHumans/Common/Materials/Textures/Clothing/Micros/micro_pp_oxford_N.png",
  },
];
const BROW_SOURCE = "Models/Eyebrows_M_Thin_CardsMesh_Group0_LOD0.glb";

/**
 * The licensed texture set, copied into `content/textures/` for the look in `src/render/`.
 *
 * `resize` is the longest edge the copy is written at. The two 8192² maps are written at 4096: at
 * a 1280-wide capture the extra resolution is invisible, and an 8192² PNG is hundreds of megabytes
 * of download to render a face the size of a thumbnail.
 *
 * `roughness` is the one entry that is not a copy. three samples a roughness map's **green**
 * channel (the glTF ORM packing) and this export writes its roughness in **red** with G and B left
 * at zero, so a verbatim copy makes the whole head a mirror. The derived file is the red channel
 * re-read as grey, which is what three reads.
 */
const TEXTURES = [
  { from: "Ada/Face/FaceColor_MAIN.png" },
  { from: "Ada/Face/FaceNormal_MAIN.png", resize: 4096 },
  { from: "Ada/Face/FaceRoughness_MAIN.png", roughness: true },
  { from: "Ada/Face/FaceCavity_MAIN.png", resize: 4096 },
  { from: "Common/Face/Textures/T_Sclera_D.png" },
  { from: "Common/Face/Textures/T_Sclera_N.png" },
  { from: "Common/Face/Textures/T_Eye_N.png" },
  { from: "Common/Face/Textures/IrisTextures/iris_007/T_Iris_A_M.png" },
  { from: "Common/Face/Textures/IrisTextures/iris_007/T_Iris_A_H.png" },
  { from: "Common/Materials/Textures/teeth_color_map_001.png" },
  { from: "Common/Materials/Textures/teeth_normal_map.png" },
  {
    from: "Common/FemaleHair/Textures/Eyelashes_L_SlightCurl_Cards/Eyelashes_L_SlightCurl_Coverage.png",
  },
];

/**
 * The iris the composite paints, in metres: an adult iris is 11.7 mm across, and the eye's own
 * geometry is what it is measured against. This is the one number in the composite that is a
 * physical fact rather than a measurement, and it is the knob to turn if the result reads wrong.
 */
const IRIS_DIAMETER_M = 0.0117;

/** The two colours the composite owns: the iris's only hue, and the pupil it looks into. */
const IRIS_BROWN = "#8a5a33";
const IRIS_PUPIL = "#08060a";

/** Where the specimen came from, kept distinct from the code's own MIT licence. */
const PROVENANCE = {
  id: "ada-facemesh-lod0",
  source:
    "Epic Games MetaHumans sample (Fab listing 0281d63e-71f7-4e07-a344-5fa721ac4d35, " +
    "artifact MetaHumanSample_5.5, package Ada_FaceMesh), imported by threenative-asset-mcp 47 " +
    "through asset_import_unreal (CUE4Parse converter b4e95441+threenative.49, umodel build 1)",
  license:
    "Fab Standard License — permitted in projects, standalone redistribution prohibited. " +
    "Local use only; never committed to this repository.",
};

/** The GLB is an Unreal export: centimetres, z up, left handed. */
const COORDINATES = { sourceUnits: "cm", sourceUp: "z", handedness: "left" };

/**
 * The PRD's 20 semantic channels, resolved to the GUI controls this DNA actually carries.
 *
 * Every name below is confirmed against `RigEvaluator.names("gui")` at run time: a GUI control
 * carries its axis in the name (`CTRL_C_jaw.ty`), and a missing one is a hard failure rather
 * than a control that silently does nothing. Where a semantic channel is more than one GUI
 * control — mouth close is four, upper and lower lips on both sides — each gets its own alias
 * and the game's UI groups them under the semantic name. `ty` channels run 0..1 and `tx` runs
 * -1..1, which the rig enforces by ignoring anything outside its domain.
 */
const SEMANTIC_CHANNELS = [
  { group: "jaw", label: "jaw open", controls: [["jawOpen", "CTRL_C_jaw.ty"]] },
  {
    group: "mouth",
    label: "mouth close",
    controls: [
      ["mouthCloseUpperL", "CTRL_L_mouth_pressU.ty"],
      ["mouthCloseUpperR", "CTRL_R_mouth_pressU.ty"],
      ["mouthCloseLowerL", "CTRL_L_mouth_pressD.ty"],
      ["mouthCloseLowerR", "CTRL_R_mouth_pressD.ty"],
    ],
  },
  {
    group: "lips",
    label: "lip pucker",
    controls: [
      ["lipPuckerUpperL", "CTRL_L_mouth_purseU.ty"],
      ["lipPuckerUpperR", "CTRL_R_mouth_purseU.ty"],
      ["lipPuckerLowerL", "CTRL_L_mouth_purseD.ty"],
      ["lipPuckerLowerR", "CTRL_R_mouth_purseD.ty"],
    ],
  },
  {
    group: "lips",
    label: "lip funnel",
    controls: [
      ["lipFunnelUpperL", "CTRL_L_mouth_funnelU.ty"],
      ["lipFunnelUpperR", "CTRL_R_mouth_funnelU.ty"],
      ["lipFunnelLowerL", "CTRL_L_mouth_funnelD.ty"],
      ["lipFunnelLowerR", "CTRL_R_mouth_funnelD.ty"],
    ],
  },
  {
    group: "mouth",
    label: "smile",
    controls: [
      ["smileL", "CTRL_L_mouth_cornerPull.ty"],
      ["smileR", "CTRL_R_mouth_cornerPull.ty"],
    ],
  },
  {
    group: "mouth",
    label: "frown",
    controls: [
      ["frownL", "CTRL_L_mouth_cornerDepress.ty"],
      ["frownR", "CTRL_R_mouth_cornerDepress.ty"],
    ],
  },
  {
    group: "brow",
    label: "inner brow raise",
    controls: [
      ["browRaiseInnerL", "CTRL_L_brow_raiseIn.ty"],
      ["browRaiseInnerR", "CTRL_R_brow_raiseIn.ty"],
    ],
  },
  {
    group: "brow",
    label: "outer brow raise",
    controls: [
      ["browRaiseOuterL", "CTRL_L_brow_raiseOut.ty"],
      ["browRaiseOuterR", "CTRL_R_brow_raiseOut.ty"],
    ],
  },
  {
    group: "brow",
    label: "brow lower",
    controls: [
      ["browLowerL", "CTRL_L_brow_down.ty"],
      ["browLowerR", "CTRL_R_brow_down.ty"],
    ],
  },
  {
    group: "eyes",
    label: "blink",
    controls: [
      ["blinkL", "CTRL_L_eye_blink.ty"],
      ["blinkR", "CTRL_R_eye_blink.ty"],
    ],
  },
  {
    group: "eyes",
    label: "squint",
    controls: [
      ["squintL", "CTRL_L_eye_squintInner.ty"],
      ["squintR", "CTRL_R_eye_squintInner.ty"],
    ],
  },
  {
    group: "eyes",
    label: "cheek raise",
    controls: [
      ["cheekRaiseL", "CTRL_L_eye_cheekRaise.ty"],
      ["cheekRaiseR", "CTRL_R_eye_cheekRaise.ty"],
    ],
  },
  {
    group: "gaze",
    label: "gaze horizontal",
    controls: [
      ["gazeHorizontalL", "CTRL_L_eye.tx"],
      ["gazeHorizontalR", "CTRL_R_eye.tx"],
    ],
  },
  {
    group: "gaze",
    label: "gaze vertical",
    controls: [
      ["gazeVerticalL", "CTRL_L_eye.ty"],
      ["gazeVerticalR", "CTRL_R_eye.ty"],
    ],
  },
];

/** Faceboard translate channels: `ty` is 0..1, `tx` is -1..1. */
function domainFor(gui) {
  return gui.endsWith(".tx") ? { min: -1, max: 1 } : { min: 0, max: 1 };
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

/** The glTF JSON chunk, read straight out of the container: this lane needs no DOM and no loader. */
function gltfJson(bytes, path) {
  if (bytes.readUInt32LE(0) !== 0x46546c67) throw new Error(`${path} is not a .glb container`);
  const length = bytes.readUInt32LE(12);
  if (bytes.readUInt32LE(16) !== 0x4e4f534a) throw new Error(`${path} has no JSON chunk first`);
  return JSON.parse(bytes.subarray(20, 20 + length).toString("utf8"));
}

/**
 * A target carries deltas when its accessor is sparse or its declared minimum is not zero.
 *
 * The importer writes every LOD0 channel as a target on every primitive and leaves the ones a
 * mesh has no data for as zero-filled accessors. Reading the minimum is the honest test: it is
 * the exporter's own statement about the data behind that accessor, and it costs no scan.
 */
function targetHasDeltas(json, accessorIndex) {
  const accessor = json.accessors[accessorIndex];
  if (accessor.sparse !== undefined) return true;
  return (accessor.min ?? []).some((value) => value !== 0);
}

/** Skin influences actually carried, read off the JOINTS_0 accessors. */
function skinInfluenceReport(json) {
  const sizes = new Set();
  for (const mesh of json.meshes ?? []) {
    for (const primitive of mesh.primitives) {
      const accessor = json.accessors[primitive.attributes?.JOINTS_0];
      if (accessor === undefined) continue;
      // 5120 BYTE / 5121 UNSIGNED_BYTE -> 4, 5122 SHORT / 5123 UNSIGNED_SHORT -> 4,
      // 5125 UNSIGNED_INT -> 8. glTF only permits these four for skin joints.
      sizes.add(accessor.componentType === 5125 ? 8 : 4);
    }
  }
  return [...sizes];
}

/* ------------------------------------------------------------------ the look's textures ------- */

/** Run the installed ImageMagick, with its stderr as the failure message when it refuses. */
async function magick(args) {
  try {
    await run("magick", args);
  } catch (error) {
    const detail = /** @type {{ stderr?: string }} */ (error).stderr ?? "";
    throw new Error(`magick ${args.join(" ")} failed: ${String(detail).trim() || String(error)}`);
  }
}

/**
 * One float accessor out of the GLB's BIN chunk, read without a loader.
 *
 * The eye's placement is the only reason this exists: the composite below has to know where in
 * texture space the iris goes, and that is a fact about this mesh's UVs and not about the DNA.
 */
function accessorFloats(bytes, json, index) {
  const accessor = json.accessors[index];
  const view = json.bufferViews[accessor.bufferView];
  const components = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[accessor.type];
  const size = { 5126: 4, 5123: 2, 5125: 4, 5121: 1, 5122: 2 }[accessor.componentType];
  if (components === undefined || size === undefined)
    throw new Error(`accessor ${index} is ${accessor.type}/${accessor.componentType}, which this reader does not decode`);
  // The JSON chunk is followed by an 8-byte BIN chunk header before any buffer byte.
  const start = 20 + bytes.readUInt32LE(12) + 8 + (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const stride = view.byteStride ?? size * components;
  const out = new Float64Array(accessor.count * components);
  for (let row = 0; row < accessor.count; row += 1) {
    for (let axis = 0; axis < components; axis += 1) {
      const at = start + row * stride + axis * size;
      out[row * components + axis] =
        accessor.componentType === 5126
          ? bytes.readFloatLE(at)
          : accessor.componentType === 5123
            ? bytes.readUInt16LE(at)
            : accessor.componentType === 5125
              ? bytes.readUInt32LE(at)
              : bytes.readUInt8(at);
    }
  }
  return out;
}

/**
 * Where each eye's iris goes, measured off that eye's own UVs.
 *
 * The eyeball primitive is a **polar disc** unwrap: the direction the sphere's own axis points sits
 * at the centre of a disc of texture space, and rings of constant angle from it are circles around
 * that point — measured `max|du|` to `max|dv|` of 1.03, so a circle painted in texture space is a
 * circle on the ball. Two things make this harder than it looks, and both are why it is measured
 * rather than typed:
 *
 * - **The pole is a spiral, not a point.** Its vertices alternate around the centre with an
 *   amplitude that grows with the angle, so the single vertex furthest forward is whichever one
 *   the sphere's own radius noise favours — measured 0.5000 for one eye where the spiral converges
 *   on 0.5250. The cap's mean converges on the same limit, so that is what this reads.
 * - **The two eyes disagree.** Their unwraps are mirror images, so their discs are at u 0.475 and
 *   0.525 — close enough that one shared texture would paint a second iris inside the first eye's
 *   iris, and each eye gets its own file.
 *
 * The iris radius is the one physical fact in here: `IRIS_DIAMETER_M` on a sphere of a measured
 * radius is an angle, and that angle's ring radius is read off the mesh.
 */
function irisPlacements(bytes, json) {
  const found = [];
  for (const mesh of json.meshes ?? []) {
    for (const [index, candidate] of (mesh.primitives ?? []).entries()) {
      const material = json.materials?.[candidate.material]?.name ?? "";
      // The eye balls are the only primitives whose material says it is a refractive eye.
      if (!/eyerefractive/i.test(material)) continue;
      found.push({ material, primitive: candidate, index });
    }
  }
  if (found.length === 0) throw new Error("no MI_EyeRefractive primitive to place an iris on");

  return found.map(({ material, primitive }) => {
    const position = accessorFloats(bytes, json, primitive.attributes.POSITION);
    const uv = accessorFloats(bytes, json, primitive.attributes.TEXCOORD_0);
    const count = json.accessors[primitive.attributes.POSITION].count;
    const low = [Infinity, Infinity, Infinity];
    const high = [-Infinity, -Infinity, -Infinity];
    for (let at = 0; at < count; at += 1)
      for (let axis = 0; axis < 3; axis += 1) {
        low[axis] = Math.min(low[axis], position[at * 3 + axis]);
        high[axis] = Math.max(high[axis], position[at * 3 + axis]);
      }
    const centre = low.map((value, axis) => (value + high[axis]) / 2);
    const radius = (high[0] - low[0]) / 2;

    // The angle of every vertex off the eye's own forward axis, and its own UV.
    const spoke = [];
    for (let at = 0; at < count; at += 1) {
      const dx = position[at * 3] - centre[0];
      const dy = position[at * 3 + 1] - centre[1];
      const dz = position[at * 3 + 2] - centre[2];
      spoke.push({
        degrees: (Math.acos(Math.max(-1, Math.min(1, dz / Math.hypot(dx, dy, dz)))) * 180) / Math.PI,
        u: uv[at * 2],
        v: uv[at * 2 + 1],
      });
    }
    // The spiral's limit, as the cap's mean. Three degrees is the first ring of the unwrap.
    const cap = spoke.filter((entry) => entry.degrees <= 3);
    const centreU = cap.reduce((sum, entry) => sum + entry.u, 0) / cap.length;
    const centreV = cap.reduce((sum, entry) => sum + entry.v, 0) / cap.length;

    // Ring radius as a function of that angle, averaged into whole degrees.
    const rings = new Map();
    for (const entry of spoke) {
      const distance = Math.hypot(entry.u - centreU, entry.v - centreV);
      // The sphere's rear cap is its own UV island in the corner; it is not part of this disc.
      if (distance > 0.7) continue;
      const key = Math.round(entry.degrees);
      const seen = rings.get(key) ?? { sum: 0, n: 0 };
      seen.sum += distance;
      seen.n += 1;
      rings.set(key, seen);
    }
    const ringAt = (degrees) => {
      const mean = (key) => (rings.has(key) ? rings.get(key).sum / rings.get(key).n : Number.NaN);
      const a = mean(Math.floor(degrees));
      const b = mean(Math.floor(degrees) + 1);
      if (!Number.isFinite(a)) return b;
      if (!Number.isFinite(b)) return a;
      return a + (b - a) * (degrees - Math.floor(degrees));
    };

    const angleDegrees = (Math.asin(Math.min(1, IRIS_DIAMETER_M / 2 / radius)) * 180) / Math.PI;
    return {
      material,
      // The file is named after the eye the material is instanced on, so nothing is typed twice.
      file: `Eye_D_${material.split("_").pop()}.png`,
      eyeballRadius: radius,
      centreU,
      centreV,
      angleDegrees,
      radiusU: ringAt(angleDegrees),
    };
  });
}

/**
 * One eye texture, which the source package does not ship.
 *
 * `T_Sclera_D` is a whole-eyeball map whose bright centre *is* the sclera, and the iris arrives as
 * a separate square with its own centre, a cyan field where there is no iris, and colour that is
 * not a colour — its fibres are green because it is a mask. So the iris is built in four steps:
 *
 *   1. its own luminance, stretched so the fibres span the range — detail without a hue
 *   2. multiplied by one brown, which is the only colour in the result
 *   3. cut to a disc of the measured iris radius, blurred so the limbus fades instead of ending,
 *      with the pupil punched out of it
 *   4. laid over the sclera, and the pupil painted on the sclera first, so the hole shows black
 *
 * The pupil is at `IRIS_DIAMETER_M / 2 / 4`: `T_Iris_A_H`'s own black disc measures 0.2505 of its
 * texture's half-width, and 3 mm over an 11.7 mm iris is the ratio a real pupil has.
 */
async function compositeEye(textureRoot, out, placement) {
  const size = 2048; // the sclera's own resolution, so nothing is resampled twice
  const irisRadius = Math.round(placement.radiusU * size);
  const at = Math.round(placement.centreU * size) - irisRadius;
  const top = Math.round(placement.centreV * size) - irisRadius;
  const box = `${irisRadius * 2}x${irisRadius * 2}`;
  const pupilRadius = Math.round(irisRadius / 4);
  // `circle x0,y0 x1,y1` is a centre and a point on its rim, so the rim point is a radius to the
  // left of the centre. Written the other way round — the rim at `irisRadius - radius` — the disc
  // itself degenerates to a zero-radius dot and the whole iris is masked away.
  const ring = (radius) => `circle ${irisRadius},${irisRadius} ${irisRadius - radius},${irisRadius}`;
  const sclera = join(textureRoot, "Common/Face/Textures/T_Sclera_D.png");
  const iris = join(textureRoot, "Common/Face/Textures/IrisTextures/iris_007/T_Iris_A_M.png");
  const grey = join(out, ".eye-fibres.png");
  const layer = join(out, ".eye-iris.png");
  const mask = join(out, ".eye-disc.png");
  const cut = join(out, ".eye-iris-cut.png");
  const target = join(out, placement.file);
  // The pupil goes on the sclera at the *composited* position, which is not the layer's own.
  const pupil = `circle ${at + irisRadius},${top + irisRadius} ${at + irisRadius - pupilRadius},${top + irisRadius}`;

  await magick([sclera, "-draw", `fill ${IRIS_PUPIL} ${pupil}`, target]);
  await magick([iris, "-resize", box, "-colorspace", "gray", "-level", "0,85%", grey]);
  await magick([`-size`, box, `xc:${IRIS_BROWN}`, grey, "-compose", "Multiply", "-composite", layer]);
  await magick([
    "-size", box, "xc:black",
    // Both fills live inside the draw string: a separate `-fill` between two `-draw` options is
    // applied to neither, and the mask comes out one disc with no hole in it.
    "-draw", `fill white ${ring(irisRadius)}`,
    "-draw", `fill black ${ring(pupilRadius)}`,
    "-blur", `0x${Math.max(2, Math.round(irisRadius * 0.045))}`,
    mask,
  ]);
  await magick([layer, mask, "-alpha", "off", "-compose", "CopyOpacity", "-composite", cut]);
  await magick([target, cut, "-geometry", `+${at}+${top}`, "-compose", "over", "-composite", target]);
  // The intermediates are scratch: `content/` is one rebuild away from being clean.
  await Promise.all([rm(grey, { force: true }), rm(layer, { force: true }), rm(mask, { force: true }), rm(cut, { force: true })]);
}

/** Copy the licensed texture set, deriving the files the source package does not ship. */
async function prepareTextures(bytes, json, out) {
  const textures = resolve(PROJECT, out, "textures");
  await mkdir(textures, { recursive: true });
  const written = [];
  for (const entry of TEXTURES) {
    const source = join(DEFAULT_TEXTURES, entry.from);
    const target = join(textures, basename(entry.from));
    if (entry.roughness === true)
      // `-separate` on one channel is that channel as a grey image, which is what three samples.
      await magick([source, "-channel", "R", "-separate", target]);
    else if (entry.resize !== undefined)
      // `-alpha off` first, always: these maps carry a fully transparent alpha channel, and
      // resizing an image whose alpha is zero returns an all-zero black. Measured: the cavity map
      // went from mean 0.907 to mean 0.000 with the alpha left on.
      await magick([source, "-alpha", "off", "-resize", `${entry.resize}x${entry.resize}`, target]);
    else await copyFile(source, target);
    written.push({
      name: basename(entry.from),
      bytes: (await readFile(target)).length,
      note: entry.roughness ? "red→grey" : entry.resize ? `downscaled to ${entry.resize}` : "copied",
    });
  }
  for (const entry of SHIRT_TEXTURES) {
    const source = join(DEFAULT_SHIRT, entry.from);
    const target = join(textures, basename(entry.from));
    if (entry.resize === undefined) await copyFile(source, target);
    else await magick([source, "-alpha", "off", "-resize", `${entry.resize}x${entry.resize}`, target]);
    written.push({
      name: basename(entry.from),
      bytes: (await readFile(target)).length,
      note: entry.resize ? `downscaled to ${entry.resize}` : "copied",
    });
  }
  const placements = irisPlacements(bytes, json);
  for (const placement of placements) {
    await compositeEye(DEFAULT_TEXTURES, textures, placement);
    written.push({
      name: placement.file,
      bytes: (await readFile(join(textures, placement.file))).length,
      note: `composited for ${placement.material}: sclera + a ${(IRIS_DIAMETER_M * 1000).toFixed(1)}mm iris`,
    });
  }
  return { textures, written, placements };
}

/* ------------------------------------------------- the brow cards, welded to the head rig ------- */

/** glTF component sizes, so one reader decodes every accessor type this file meets. */
const COMPONENT_BYTES = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
const COMPONENTS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };

/**
 * One accessor's whole value array, sparse or not.
 *
 * The head's morph targets are all *sparse*: the exporter wrote a zero-filled base and a short list
 * of the vertices that actually move. Reading `bufferView` alone therefore reads zeros for most of
 * a channel, which is exactly the failure mode that would leave the brows welded but frozen, so the
 * sparse indices and values are applied on top of the base here — once, for every caller.
 */
function readAccessor(bytes, json, index) {
  const accessor = json.accessors[index];
  const components = COMPONENTS[accessor.type];
  const size = COMPONENT_BYTES[accessor.componentType];
  if (components === undefined || size === undefined)
    throw new Error(`accessor ${index} is ${accessor.type}/${accessor.componentType}, unreadable here`);
  const out = new Float64Array(accessor.count * components);
  /**
   * One component, decoded with the component type, the byte offset and the element stride *of the
   * view it is in*.
   *
   * The stride is the part that bites. glTF leaves `bufferView.byteStride` unset for tightly packed
   * data and says nothing at all about the two halves of a sparse block, which are always tight:
   * `sparse.indices` is a packed SCALAR list and `sparse.values` a packed VEC3 per index. Treating
   * "no byteStride" as "no stride" therefore reads entry 0's three floats for every entry, which
   * returns a plausible array of which exactly one element is non-zero — measured, 3 of 73 224
   * components, and ten of the fourteen brow channels welded on dead.
   */
  const scalar = (viewIndex, elementIndex, component, componentType, byteOffset, elementBytes) => {
    const view = json.bufferViews[viewIndex];
    const at =
      20 +
      bytes.readUInt32LE(12) +
      8 +
      (view.byteOffset ?? 0) +
      (byteOffset ?? 0) +
      elementIndex * elementBytes +
      component * COMPONENT_BYTES[componentType];
    switch (componentType) {
      case 5126:
        return bytes.readFloatLE(at);
      case 5123:
        return bytes.readUInt16LE(at);
      case 5125:
        return bytes.readUInt32LE(at);
      case 5122:
        return bytes.readInt16LE(at);
      case 5121:
        return bytes.readUInt8(at);
      default:
        return bytes.readInt8(at);
    }
  };
  if (accessor.bufferView !== undefined) {
    const view = json.bufferViews[accessor.bufferView];
    const elementBytes = view.byteStride ?? components * size;
    for (let row = 0; row < accessor.count; row += 1)
      for (let axis = 0; axis < components; axis += 1)
        out[row * components + axis] = scalar(
          accessor.bufferView,
          row,
          axis,
          accessor.componentType,
          accessor.byteOffset,
          elementBytes,
        );
  }
  const sparse = accessor.sparse;
  if (sparse !== undefined)
    for (let entry = 0; entry < sparse.count; entry += 1) {
      const target = scalar(
        sparse.indices.bufferView,
        entry,
        0,
        sparse.indices.componentType,
        sparse.indices.byteOffset,
        COMPONENT_BYTES[sparse.indices.componentType],
      );
      for (let axis = 0; axis < components; axis += 1)
        out[target * components + axis] = scalar(
          sparse.values.bufferView,
          entry,
          axis,
          accessor.componentType,
          sparse.values.byteOffset,
          components * size,
        );
    }
  return out;
}

/**
 * The brow channels, as the head's own target names.
 *
 * Fourteen of the head's 821 blend shapes move the brow, and every one of them carries deltas on
 * the head primitive — measured, not filtered on a guess, because a target that reads as present
 * but holds no data is a slider that does nothing. Only these are welded to the cards: a brow card
 * is 4 296 vertices, and all 821 channels of deltas for them would be 42 MB of buffer for shapes
 * that cannot move a hair.
 */
function browChannelTargets(json) {
  const primitive = json.meshes[0].primitives[0];
  const names = json.meshes[0].extras?.targetNames;
  if (!Array.isArray(names)) throw new Error("the head mesh carries no extras.targetNames");
  return primitive.targets
    .map((target, index) => ({ index, name: names[index] }))
    .filter((entry) => entry.name !== undefined && /brow/i.test(entry.name))
    .filter((entry) => targetHasDeltas(json, primitive.targets[entry.index].POSITION))
    .map((entry) => ({ ...entry, channel: entry.name.slice(entry.name.indexOf("__") + 2) }));
}

/**
 * Nearest head-surface vertex to each brow-card vertex, over a uniform grid.
 *
 * The card is a flat ribbon a few millimetres off the forehead, so "the closest head vertex" is the
 * vertex the skin under that card actually is, and copying that vertex's weights and deltas is
 * what makes the card ride the same deformation as the skin it sits on. A 24 408-vertex brute force
 * is 105 M distances and a linear scan over the whole head for each of 4 296 cards; the grid makes
 * it the handful of vertices in one 8 mm cell, which is the difference between a prepare step
 * someone waits on and one they do not.
 */
function nearestHeadVertices(head, brow, cell) {
  const buckets = new Map();
  const key = (x, y, z) => `${x},${y},${z}`;
  for (let at = 0; at < head.length / 3; at += 1) {
    const at3 = at * 3;
    const k = key(
      Math.floor(head[at3] / cell),
      Math.floor(head[at3 + 1] / cell),
      Math.floor(head[at3 + 2] / cell),
    );
    const bucket = buckets.get(k);
    if (bucket === undefined) buckets.set(k, [at]);
    else bucket.push(at);
  }
  const nearest = new Int32Array(brow.length / 3);
  for (let at = 0; at < brow.length / 3; at += 1) {
    const x = brow[at * 3];
    const y = brow[at * 3 + 1];
    const z = brow[at * 3 + 2];
    const cx = Math.floor(x / cell);
    const cy = Math.floor(y / cell);
    const cz = Math.floor(z / cell);
    let best = -1;
    let bestDistance = Infinity;
    // Widen the search ring by ring; the answer is always in the first ring that finds anything,
    // because the cards sit on the head rather than near it.
    for (let ring = 0; ring < 24 && best < 0; ring += 1)
      for (let dx = -ring; dx <= ring; dx += 1)
        for (let dy = -ring; dy <= ring; dy += 1)
          for (let dz = -ring; dz <= ring; dz += 1) {
            if (ring > 0 && Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz)) !== ring) continue;
            const bucket = buckets.get(key(cx + dx, cy + dy, cz + dz));
            if (bucket === undefined) continue;
            for (const candidate of bucket) {
              const at3 = candidate * 3;
              const distance =
                (head[at3] - x) ** 2 + (head[at3 + 1] - y) ** 2 + (head[at3 + 2] - z) ** 2;
              if (distance < bestDistance) {
                bestDistance = distance;
                best = candidate;
              }
            }
          }
    if (best < 0) throw new Error(`a brow card vertex at ${x},${y},${z} has no head vertex near it`);
    nearest[at] = best;
  }
  return nearest;
}

/**
 * Transfer one channel's deltas onto the cards, from the head vertices that actually carry them.
 *
 * Nearest-vertex transfer is the obvious move and it is wrong here, in a way that reads as a working
 * slider doing nothing. The head's morph targets are **sparse**: `brow_down_L` stores 417 of its
 * 24 408 vertices and leaves the other 23 991 as zeros, because that is how the exporter wrote a
 * channel whose effect is a patch rather than a whole head. So the nearest head vertex to a card
 * vertex is a zero almost every time — measured, nearest-vertex transfer put data on 72 of 12 888
 * components across all fourteen brow channels and left 10 of the 14 channels completely dead.
 *
 * What is smooth is the field, not the samples, so this blends the four nearest *sampled* vertices
 * by inverse-square distance. The card then carries the skin's own motion, smoothly, and a channel
 * that moves the forehead moves the cards with it.
 *
 * A linear scan, deliberately: the largest of the fourteen brow channels samples a few thousand of
 * the head's 24 408 vertices, so the whole transfer is a few million distance tests — a spatial
 * index would be a second data structure to get wrong for a loop that already runs in about a
 * second.
 */
function transferDeltas(headPosition, headDeltas, browPosition) {
  const count = browPosition.length / 3;
  const sampled = [];
  for (let at = 0; at < headDeltas.length / 3; at += 1) {
    const at3 = at * 3;
    if (headDeltas[at3] !== 0 || headDeltas[at3 + 1] !== 0 || headDeltas[at3 + 2] !== 0) sampled.push(at);
  }
  if (sampled.length === 0)
    throw new Error("a brow channel has no sampled head vertex, so there is nothing to transfer");
  const K = 4;
  const out = new Float32Array(count * 3);
  const blended = new Set();
  const best = [];
  for (let at = 0; at < count; at += 1) {
    const x = browPosition[at * 3];
    const y = browPosition[at * 3 + 1];
    const z = browPosition[at * 3 + 2];
    best.length = 0;
    for (const candidate of sampled) {
      const at3 = candidate * 3;
      const distance =
        (headPosition[at3] - x) ** 2 +
        (headPosition[at3 + 1] - y) ** 2 +
        (headPosition[at3 + 2] - z) ** 2;
      // Insertion-sorted, smallest first, capped at K: a card wants the four *closest* sampled
      // vertices, not the four first in scan order.
      let slot = best.length;
      while (slot > 0 && best[slot - 1].distance > distance) slot -= 1;
      if (slot >= K) continue;
      best.splice(slot, 0, { at: candidate, distance });
      if (best.length > K) best.pop();
    }
    let total = 0;
    for (const entry of best) total += 1 / (entry.distance + 1e-9);
    for (const entry of best) {
      const weight = 1 / (entry.distance + 1e-9) / total;
      const from = entry.at * 3;
      out[at * 3] += headDeltas[from] * weight;
      out[at * 3 + 1] += headDeltas[from + 1] * weight;
      out[at * 3 + 2] += headDeltas[from + 2] * weight;
      blended.add(entry.at);
    }
  }
  return { deltas: out, sampled: sampled.length, blended: blended.size };
}

/**
 * Successive appends into the container's one BIN chunk, four-byte aligned.
 *
 * The welded file is built by adding to the export rather than by rewriting it: existing buffer
 * views keep their offsets and every append lands after them. A writer rather than a function
 * because the brows and the LOD1 mesh are welded in sequence, and the second must not be able to
 * overwrite the first.
 */
function binWriter(json, glbBytes) {
  const binStart = 20 + glbBytes.readUInt32LE(12) + 8;
  const chunks = [Buffer.from(glbBytes.subarray(binStart, binStart + json.buffers[0].byteLength))];
  return {
    /** Append one buffer's bytes as one buffer view, and hand back its index. */
    view(bytes) {
      const raw = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const padding = Buffer.alloc((4 - (json.buffers[0].byteLength % 4)) % 4);
      if (padding.length > 0) {
        chunks.push(padding);
        json.buffers[0].byteLength += padding.length;
      }
      json.bufferViews.push({ buffer: 0, byteOffset: json.buffers[0].byteLength, byteLength: raw.length });
      chunks.push(raw);
      json.buffers[0].byteLength += raw.length;
      return json.bufferViews.length - 1;
    },
    bytes() {
      return Buffer.concat(chunks);
    },
  };
}

/** The raw bytes of one buffer view in another container, unaligned and exactly as stored. */
function viewBytes(glbBytes, json, at) {
  const view = json.bufferViews[at];
  if (view === undefined) throw new Error(`glTF buffer view ${at} is not in this container`);
  const start = 20 + glbBytes.readUInt32LE(12) + 8 + (view.byteOffset ?? 0);
  return new Uint8Array(glbBytes.buffer, glbBytes.byteOffset + start, view.byteLength);
}

/** A dense float accessor over an appended view, with the min/max glTF demands of a VEC3. */
function floatAccessor(json, viewIndex, type, count, values) {
  const accessor = { bufferView: viewIndex, byteOffset: 0, componentType: 5126, count, type };
  const width = COMPONENTS[type];
  if (type === "VEC3") {
    const low = new Array(width).fill(Infinity);
    const high = new Array(width).fill(-Infinity);
    for (let row = 0; row < count; row += 1)
      for (let axis = 0; axis < width; axis += 1) {
        const value = values[row * width + axis];
        if (value < low[axis]) low[axis] = value;
        if (value > high[axis]) high[axis] = value;
      }
    accessor.min = low;
    accessor.max = high;
  }
  json.accessors.push(accessor);
  return json.accessors.length - 1;
}

/** An integer accessor: the one glTF type a skin's joints are allowed to be. */
function jointAccessor(json, viewIndex, count) {
  json.accessors.push({ bufferView: viewIndex, byteOffset: 0, componentType: 5123, count, type: "VEC4" });
  return json.accessors.length - 1;
}

/**
 * Weld the brow cards into the specimen GLB: skinned to the head's own skeleton, carrying the head's
 * own brow deltas, on the head's own skin.
 *
 * It has to be *this* file and not a second one the game loads beside it. `loadMetaHuman` builds its
 * handle from one `loader.scene`: its joint bindings are resolved by node name inside that graph and
 * its morph bindings by `(glTF mesh, primitive, target)`, and anything outside is neither named nor
 * bound — it would render, and it would never move. So the cards go in as mesh 1 of the same
 * container on skin 0, at identity, which is the only placement where the head's inverse bind
 * matrices mean the right thing and the cards land where the exporter put them.
 */
function weldBrows(headBytes, json, browBytes, bin) {
  const browJson = gltfJson(browBytes, "brows");
  const browPrim = browJson.meshes[0].primitives[0];
  const browPosition = readAccessor(browBytes, browJson, browPrim.attributes.POSITION);
  const browNormal = readAccessor(browBytes, browJson, browPrim.attributes.NORMAL);
  const browUv = readAccessor(browBytes, browJson, browPrim.attributes.TEXCOORD_0);
  const browIndex = readAccessor(browBytes, browJson, browPrim.indices);
  const count = browPosition.length / 3;

  const headPrim = json.meshes[0].primitives[0];
  const headPosition = readAccessor(headBytes, json, headPrim.attributes.POSITION);
  const headJoints = readAccessor(headBytes, json, headPrim.attributes.JOINTS_0);
  const headWeights = readAccessor(headBytes, json, headPrim.attributes.WEIGHTS_0);
  const nearest = nearestHeadVertices(headPosition, browPosition, 0.008);
  const channels = browChannelTargets(json);

  // The transferred skin: every card vertex takes the four joints and four weights of the head
  // vertex directly under it, so the card is bound exactly as the skin it sits on is.
  const joints = new Uint16Array(count * 4);
  const weights = new Float32Array(count * 4);
  for (let at = 0; at < count; at += 1) {
    const source = nearest[at] * 4;
    for (let slot = 0; slot < 4; slot += 1) {
      joints[at * 4 + slot] = headJoints[source + slot];
      weights[at * 4 + slot] = headWeights[source + slot];
    }
  }
  // And the transferred deltas: blended from the sampled vertices of the same channel, so a brow
  // raise lifts the cards by the skin's own motion rather than by a copy of it that drifts.
  const transferred = channels.map((entry) =>
    transferDeltas(headPosition, readAccessor(headBytes, json, headPrim.targets[entry.index].POSITION), browPosition),
  );
  const deltas = transferred.map((entry) => entry.deltas);
  const sampled = Math.max(...transferred.map((entry) => entry.sampled));
  const blended = Math.max(...transferred.map((entry) => entry.blended));

  const views = [
    bin.view(Float32Array.from(browPosition)),
    bin.view(Float32Array.from(browNormal)),
    bin.view(Float32Array.from(browUv)),
    bin.view(Uint16Array.from(browIndex)),
    bin.view(joints),
    bin.view(weights),
    ...deltas.map((delta) => bin.view(delta)),
  ];
  const attributes = {
    POSITION: floatAccessor(json, views[0], "VEC3", count, browPosition),
    NORMAL: floatAccessor(json, views[1], "VEC3", count, browNormal),
    TEXCOORD_0: floatAccessor(json, views[2], "VEC2", count, browUv),
    JOINTS_0: jointAccessor(json, views[4], count),
    WEIGHTS_0: floatAccessor(json, views[5], "VEC4", count, weights),
  };
  json.accessors.push({
    bufferView: views[3],
    byteOffset: 0,
    componentType: 5123,
    count: browIndex.length,
    type: "SCALAR",
  });
  const meshIndex = json.meshes.length;
  json.meshes.push({
    name: "Eyebrows_M_Thin_Cards",
    primitives: [
      {
        attributes,
        indices: json.accessors.length - 1,
        material: json.materials.length,
        mode: 4,
        // Dense, and named exactly as the head names its own brow targets: this is the key
        // `loadMetaHuman` checks when it binds a channel, and a renamed target is a dead slider.
        targets: deltas.map((delta, target) => ({ POSITION: floatAccessor(json, views[6 + target], "VEC3", count, delta) })),
      },
    ],
    extras: { targetNames: channels.map((entry) => entry.name) },
  });
  json.materials.push({
    name: "M_EyebrowCards",
    pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 0.6 },
  });
  json.nodes.push({ mesh: meshIndex, name: "Eyebrows_M_Thin_Cards", skin: 0 });
  json.scenes[0].nodes.push(json.nodes.length - 1);

  return {
    mesh: meshIndex,
    morphs: channels.map((entry, target) => ({ channel: entry.channel, mesh: meshIndex, primitive: 0, target })),
    vertices: count,
    sampled,
    blended,
  };
}

/**
 * Weld the LOD1 mesh in beside LOD0, on the same skin, so `setLod(1)` is a visibility switch rather
 * than a second load.
 *
 * The two exports were measured against each other before this was written: identical node names
 * (875 joints, in the same order), identical local transforms on every joint, an identical
 * hierarchy bar one root's *name* (`Ada_FaceMesh.ao` against `Ada_FaceMesh.ao_LOD1`, neither of
 * which is a DNA joint), and a byte-identical 875×16 block of inverse bind matrices. So the bind
 * pose is the same pose, and skin 0 — with the LOD0 inverse bind matrices — is the right skin for
 * these vertices. Each of those is re-checked here rather than assumed, because a re-prepare of a
 * different export must fail loudly instead of welding a head that moves wrongly.
 *
 * No morph targets come across: this level declares none, which is the entire point of the preview.
 */
function weldLod1(headBytes, json, lod1Bytes, bin) {
  const source = gltfJson(lod1Bytes, "LOD1");

  const jointsOf = (doc) => doc.skins[0].joints.map((at) => doc.nodes[at].name);
  const a = jointsOf(json);
  const b = jointsOf(source);
  if (a.length !== b.length || a.some((name, at) => name !== b[at]))
    throw new Error("the LOD1 export's skeleton is not this head's skeleton, so it cannot be welded in");

  const place = (doc) => doc.nodes.map((node) => `${node.translation ?? ""}|${node.rotation ?? ""}|${node.scale ?? ""}`);
  // Compared over the LOD1 export's own length only: the container already carries the welded brow
  // node after the last joint, and that extra node is not a disagreement about the bind pose.
  const from = place(json).slice(0, source.nodes.length);
  const to = place(source);
  for (let at = 0; at < to.length; at += 1)
    if (from[at] !== to[at])
      throw new Error(`the LOD1 export places '${source.nodes[at].name ?? at}' differently from LOD0`);

  // Materials are matched by name rather than by index: both exports carry the same eight, in the
  // same order today, and an index would silently paint a LOD1 eye with the wrong map if that stopped
  // being true. This level adds none of its own.
  const materialOf = new Map(json.materials.map((material, at) => [material.name, at]));
  const remapped = new Map();
  const viewOf = (at) => {
    const known = remapped.get(at);
    if (known !== undefined) return known;
    const next = bin.view(viewBytes(lod1Bytes, source, at));
    remapped.set(at, next);
    return next;
  };
  const accessorOf = (at) => {
    const accessor = source.accessors[at];
    if (accessor === undefined) throw new Error(`the LOD1 export's accessor ${at} does not exist`);
    // Copied as declared: byte offset, stride and sparsity all survive, because a re-read accessor
    // that dropped the stride would read LOD1's joints as floats.
    const copy = { ...accessor, bufferView: viewOf(accessor.bufferView) };
    json.accessors.push(copy);
    return json.accessors.length - 1;
  };

  const primitives = source.meshes[0].primitives.map((prim) => {
    const attributes = {};
    for (const [name, at] of Object.entries(prim.attributes)) attributes[name] = accessorOf(at);
    const name = source.materials[prim.material ?? -1]?.name;
    const material = name === undefined ? undefined : materialOf.get(name);
    if (material === undefined)
      throw new Error(`the LOD1 export's material '${String(name)}' is not one LOD0 already carries`);
    return { attributes, indices: prim.indices === undefined ? undefined : accessorOf(prim.indices), material, mode: prim.mode ?? 4 };
  });
  const vertices = primitives.reduce((total, prim) => total + json.accessors[prim.attributes.POSITION].count, 0);
  const triangles = primitives.reduce(
    (total, prim) => total + (prim.indices === undefined ? 0 : json.accessors[prim.indices].count / 3),
    0,
  );

  const meshIndex = json.meshes.length;
  json.meshes.push({ name: "Ada_FaceMesh_LOD1", primitives });
  // Skin 0 and at identity, which is the only placement where LOD0's inverse bind matrices mean the
  // right thing — the same argument the brow cards are welded on, and the same answer.
  json.nodes.push({ mesh: meshIndex, name: "Ada_FaceMesh_LOD1", skin: 0 });
  json.scenes[0].nodes.push(json.nodes.length - 1);
  return { mesh: meshIndex, vertices, triangles, primitives: primitives.length };
}

/* ------------------------------------------------- the groom, as strands ----------------------- */

/**
 * Ada's groom as real strands, exported from the same sample's groom assets.
 *
 * The source format is little-endian `u32 strandCount, u32 pointCount, u32[strandCount]
 * pointsPerStrand, f32[pointCount*3]` positions and `f32[pointCount]` widths, in **Unreal source
 * space: centimetres, z up**. The GLB exporter mapped the same space to glTF as `(x, z, y) / 100`,
 * and that is measured, not assumed: the brow strands span x -5.61..5.75, y 7.41..10.41,
 * z 149.78..151.63 cm and the exported brow *cards* x -0.0570..0.0571, y 1.4963..1.5178,
 * z 0.0747..0.1056 m, which only that mapping lines up (swapping y and z is also the handedness
 * flip, so x keeps its sign). The report prints each set's mean root-to-scalp distance as the proof.
 */
const GROOM = join(SOURCE, "groom");
const STRAND_SETS = [
  { from: "Hair_S_Coil.strands.bin", to: "hair.strands.bin", lift: 0.0003 },
  // Lifted to 0.6 mm off the skin: the brow fibres lie flat along the brow, and on this face mesh
  // many sit *under* its surface — measured on the first captures, only the brow's outline survived
  // the depth test and the brow drew as a ring.
  { from: "Eyebrows_M_Thin.strands.bin", to: "brows.strands.bin", lift: 0.0006 },
];

function readGroom(bytes) {
  const strandCount = bytes.readUInt32LE(0);
  const pointCount = bytes.readUInt32LE(4);
  const expected = 8 + strandCount * 4 + pointCount * 16;
  if (bytes.length !== expected)
    throw new Error(`groom file is ${bytes.length} bytes; its header says ${expected}`);
  const copy = (offset, length) => new Uint8Array(bytes.subarray(offset, offset + length)).buffer;
  const sizes = new Uint32Array(copy(8, strandCount * 4));
  const position = new Float32Array(copy(8 + strandCount * 4, pointCount * 12));
  const width = new Float32Array(copy(8 + strandCount * 4 + pointCount * 12, pointCount * 4));
  let total = 0;
  for (const size of sizes) {
    if (size < 2) throw new Error("a strand with fewer than two points has no segment to draw");
    total += size;
  }
  if (total !== pointCount) throw new Error(`strand sizes sum to ${total}, header says ${pointCount}`);
  return { strandCount, pointCount, sizes, position, width };
}

/** mulberry32: a seeded shuffle, so the LOD subset is the same random subset on every prepare. */
function seeded(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Convert one groom into the layout `src/render/strands.ts` draws from:
 *
 *   u32 magic "TNS1", u32 strandCount, u32 pointCount, u32[strandCount + 1] first point per strand,
 *   f32[pointCount * 4] x, y, z, width   (metres, y up)
 *   f32[pointCount * 4] t, depth, seed, 0 (t: 0 root .. exactly 1 tip; depth: 0 buried .. 1 exposed;
 *                                         seed: the strand's slot / strandCount, uniform in [0, 1))
 *
 * **Shuffled**, always: a strand-count LOD is then "draw the first K strands", a random subset for
 * free and one instance-count change at runtime, and the renderer's per-strand coverage keep
 * (`seed < coverage`) is a random subset too. Unshuffled, the brow groom's authored order is
 * spatial, and keeping its first 20% drew only the brow's outline.
 *
 * **Depth in the volume** is the self-shadow term. Every point is binned by its direction from the
 * root centroid; in each bin the radius runs from the lowest root (the scalp) to the 97th-percentile
 * point radius (the outside of the groom, stray fibres excluded), and a point's depth is where it
 * sits in that range. It is the cheap stand-in for a deep-opacity map: a coil in the middle of the
 * mass is dark because it *is* in the middle of the mass.
 */
function convertGroom(source) {
  const { strandCount, pointCount, sizes, position, width } = source;
  const starts = new Uint32Array(strandCount);
  for (let s = 1; s < strandCount; s += 1) starts[s] = starts[s - 1] + sizes[s - 1];
  const order = Array.from({ length: strandCount }, (_, index) => index);
  const random = seeded(465);
  for (let i = order.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  const first = new Uint32Array(strandCount + 1);
  const points = new Float32Array(pointCount * 4);
  const attrs = new Float32Array(pointCount * 4);
  let at = 0;
  for (const [slot, strand] of order.entries()) {
    first[slot] = at;
    const size = sizes[strand];
    for (let k = 0; k < size; k += 1) {
      const from = starts[strand] + k;
      points[at * 4] = position[from * 3] / 100;
      points[at * 4 + 1] = position[from * 3 + 2] / 100;
      points[at * 4 + 2] = position[from * 3 + 1] / 100;
      points[at * 4 + 3] = width[from] / 100;
      attrs[at * 4] = k / (size - 1);
      attrs[at * 4 + 2] = slot / strandCount;
      at += 1;
    }
  }
  first[strandCount] = at;

  const centre = [0, 0, 0];
  for (let s = 0; s < strandCount; s += 1)
    for (let axis = 0; axis < 3; axis += 1) centre[axis] += points[first[s] * 4 + axis] / strandCount;
  const AZ = 64;
  const EL = 32;
  const binOf = (p) => {
    const x = points[p * 4] - centre[0];
    const y = points[p * 4 + 1] - centre[1];
    const z = points[p * 4 + 2] - centre[2];
    const r = Math.hypot(x, y, z);
    const az = Math.min(AZ - 1, Math.floor(((Math.atan2(z, x) + Math.PI) / (2 * Math.PI)) * AZ));
    const el = Math.min(EL - 1, Math.floor(((Math.asin(y / (r || 1)) + Math.PI / 2) / Math.PI) * EL));
    return { bin: el * AZ + az, r };
  };
  const bins = Array.from({ length: AZ * EL }, () => ({ inner: Infinity, outer: 0, radii: [] }));
  for (let p = 0; p < pointCount; p += 1) {
    const { bin, r } = binOf(p);
    bins[bin].radii.push(r);
  }
  for (let s = 0; s < strandCount; s += 1) {
    const { bin, r } = binOf(first[s]);
    bins[bin].inner = Math.min(bins[bin].inner, r);
  }
  for (const bin of bins) {
    bin.radii.sort((a, b) => a - b);
    bin.outer = bin.radii.length === 0 ? 0 : bin.radii[Math.floor(bin.radii.length * 0.97)];
    if (!Number.isFinite(bin.inner)) bin.inner = bin.radii[0] ?? 0;
    bin.radii = undefined;
  }
  for (let p = 0; p < pointCount; p += 1) {
    const { bin, r } = binOf(p);
    const span = bins[bin].outer - bins[bin].inner;
    attrs[p * 4 + 1] = span <= 1e-4 ? 1 : Math.min(1, Math.max(0, (r - bins[bin].inner) / span));
  }

  return { first, points, attrs };
}

function encodeGroom({ first, points, attrs }) {
  const header = new Uint32Array([0x31534e54, first.length - 1, points.length / 4]);
  return Buffer.concat([
    Buffer.from(header.buffer),
    Buffer.from(first.buffer),
    Buffer.from(points.buffer),
    Buffer.from(attrs.buffer),
  ]);
}

/**
 * Push every point of a groom at least `lift` metres above the skin: measured along the nearest
 * head vertex's normal, from that vertex's tangent plane, so a point already clear of the skin is
 * left where the groom put it. Returns how many points moved and the largest move.
 */
function liftOffSkin(headBytes, json, converted, lift) {
  const headPrim = json.meshes[0].primitives[0];
  const headPosition = readAccessor(headBytes, json, headPrim.attributes.POSITION);
  const headNormal = readAccessor(headBytes, json, headPrim.attributes.NORMAL);
  const { points } = converted;
  const count = points.length / 4;
  const probe = new Float64Array(count * 3);
  for (let p = 0; p < count; p += 1)
    for (let axis = 0; axis < 3; axis += 1) probe[p * 3 + axis] = points[p * 4 + axis];
  const nearest = nearestHeadVertices(headPosition, probe, 0.008);
  let moved = 0;
  let largest = 0;
  for (let p = 0; p < count; p += 1) {
    const v = nearest[p] * 3;
    const length = Math.hypot(headNormal[v], headNormal[v + 1], headNormal[v + 2]) || 1;
    let height = 0;
    for (let axis = 0; axis < 3; axis += 1)
      height += (points[p * 4 + axis] - headPosition[v + axis]) * (headNormal[v + axis] / length);
    const push = lift - height;
    if (push <= 0) continue;
    moved += 1;
    largest = Math.max(largest, push);
    for (let axis = 0; axis < 3; axis += 1) points[p * 4 + axis] += (headNormal[v + axis] / length) * push;
  }
  return { moved, largest };
}

/**
 * The brows follow the brow: every brow strand's **root** gets the transfer the brow cards got —
 * the skin weights of the nearest head vertex, and each brow channel's deltas blended from the four
 * nearest *sampled* vertices of that channel — and `src/render/strands.ts` moves the whole strand by
 * its root's displacement each frame. JSON, because 1 354 roots by 14 channels is small.
 */
function browSkin(headBytes, json, converted) {
  const headPrim = json.meshes[0].primitives[0];
  const headPosition = readAccessor(headBytes, json, headPrim.attributes.POSITION);
  const strandCount = converted.first.length - 1;
  const roots = new Float64Array(strandCount * 3);
  for (let s = 0; s < strandCount; s += 1)
    for (let axis = 0; axis < 3; axis += 1) roots[s * 3 + axis] = converted.points[converted.first[s] * 4 + axis];
  const nearest = nearestHeadVertices(headPosition, roots, 0.008);
  const round = (value) => Math.round(value * 1e7) / 1e7;
  return {
    nearest: Array.from(nearest),
    // Each nearest vertex's rest position, so the runtime can prove it indexes the same mesh.
    rest: Array.from(nearest, (index) => [0, 1, 2].map((axis) => round(headPosition[index * 3 + axis]))),
    channels: browChannelTargets(json).map((entry) => ({
      target: entry.name,
      deltas: Array.from(
        transferDeltas(headPosition, readAccessor(headBytes, json, headPrim.targets[entry.index].POSITION), roots)
          .deltas,
        round,
      ),
    })),
  };
}

/**
 * The scalp under the groom, as a mask in the face atlas: where the hair's roots are, the skin is
 * the hair's own colour — which is what a MetaHuman's scalp carries and what the gaps between fibres
 * show. Derived from the roots, not painted: every root splats a small Gaussian at the UV of its
 * nearest head vertex, and the density saturates, so the hairline is exactly as soft and as ragged
 * as the groom's own. Written as a greyscale PNG through magick (a PGM on the way).
 */
function scalpMask(headBytes, json, converted, out) {
  const { first, points } = converted;
  const roots = [];
  for (let s = 0; s + 1 < first.length; s += 1)
    for (let axis = 0; axis < 3; axis += 1) roots.push(points[first[s] * 4 + axis]);
  return splatMask(headBytes, json, roots, undefined, { file: "HairScalp_Mask", sigma: 5, knee: 2 }, out);
}

/**
 * The brow's painted density under its strands: the stain a real brow leaves on the skin, which is
 * what makes the reference's brow read as one soft full arch rather than as fibres on bare skin.
 *
 * Every *point* of every brow strand splats, not only the root, weighted down towards the tip — so
 * the mask is the groom's own shape, densest along the roots and feathering out where the fibres
 * thin, and it follows any groom this sample is prepared from.
 */
function browMask(headBytes, json, converted, out) {
  const { first, points } = converted;
  const at = [];
  const weights = [];
  for (let s = 0; s + 1 < first.length; s += 1) {
    const span = Math.max(1, first[s + 1] - first[s] - 1);
    for (let p = first[s]; p < first[s + 1]; p += 1) {
      for (let axis = 0; axis < 3; axis += 1) at.push(points[p * 4 + axis]);
      weights.push(1 - 0.7 * ((p - first[s]) / span));
    }
  }
  return splatMask(headBytes, json, at, weights, { file: "BrowDensity_Mask", sigma: 3, knee: 6 }, out);
}

async function splatMask(headBytes, json, at, weights, { file, sigma, knee }, out) {
  const SIZE = 1024;
  const headPrim = json.meshes[0].primitives[0];
  const headPosition = readAccessor(headBytes, json, headPrim.attributes.POSITION);
  const headUv = readAccessor(headBytes, json, headPrim.attributes.TEXCOORD_0);
  const nearest = nearestHeadVertices(headPosition, at, 0.008);
  const density = new Float32Array(SIZE * SIZE);
  const reach = Math.ceil(sigma * 2.5);
  nearest.forEach((vertex, index) => {
    const weight = weights?.[index] ?? 1;
    const cx = headUv[vertex * 2] * SIZE;
    const cy = headUv[vertex * 2 + 1] * SIZE;
    for (let y = Math.max(0, Math.floor(cy - reach)); y <= Math.min(SIZE - 1, Math.ceil(cy + reach)); y += 1)
      for (let x = Math.max(0, Math.floor(cx - reach)); x <= Math.min(SIZE - 1, Math.ceil(cx + reach)); x += 1)
        density[y * SIZE + x] += weight * Math.exp(-((x - cx) ** 2 + (y - cy) ** 2) / (2 * sigma * sigma));
  });
  const pixels = Buffer.alloc(SIZE * SIZE);
  // `knee` is how many overlapping splats it takes to saturate: the inside is solid, the edge fades.
  for (let i = 0; i < pixels.length; i += 1) pixels[i] = Math.round(255 * (1 - Math.exp(-density[i] / knee)));
  const pgm = join(out, "textures", `${file}.pgm`);
  await mkdir(join(out, "textures"), { recursive: true });
  await writeFile(pgm, Buffer.concat([Buffer.from(`P5 ${SIZE} ${SIZE} 255\n`), pixels]));
  await magick([pgm, join(out, "textures", `${file}.png`)]);
  await rm(pgm);
}

/**
 * Ada's wrinkle maps and the regions they belong to, for the skin's animated-map binding.
 *
 * MetaHuman's face material blends three extra normal maps (`FaceNormal_WM1..3`) over the main one,
 * each only inside the regions whose rig outputs are active — 37 of them, one per animated map
 * (`head_wm1_browsRaiseInner_L`, `head_wm3_smile_R`, …), painted into the RGBA channels of twelve
 * shared `T_head_wm*_msk_*` textures. Both come from the licensed sample through the asset importer
 * (`importUnrealDirectory` with `onlyPackages`), into `ada-wrinkles` and `ada-wrinkle-masks`.
 *
 * **The channel-to-region table is this sample's reading, not Epic's.** The material graph that
 * names each channel is not in the export, so every channel was matched by where it lands on the
 * atlas: side from u (u > 0.5 is the character's left — the left eye's vertices sit there), region
 * from the anatomy under it, and the count checks out exactly — 15 wm1 regions, 10 wm2, 8 wm3 and 4
 * wm13 against the channels those masks carry. The masks are repacked three regions to an RGB tile
 * (no alpha: a browser premultiplies an image's colour by its alpha on upload) and stacked into one
 * 512 × 512·n strip, so the shader binds one texture for all 37 instead of twelve.
 */
const WRINKLE_NORMALS = ["FaceNormal_WM1", "FaceNormal_WM2", "FaceNormal_WM3"];
const WRINKLE_MASK_DIR = "ada-wrinkle-masks/textures/Content/MetaHumans/Common/Face/Textures/Utilities/AnimMasks";
const WRINKLE_REGIONS = [
  ["wm1_msk_01", "R", "head_wm1_blink_L"],
  ["wm1_msk_01", "G", "head_wm1_blink_R"],
  ["wm1_msk_01", "B", "head_wm1_browsRaiseInner_L"],
  ["wm1_msk_01", "A", "head_wm1_browsRaiseInner_R"],
  ["wm1_msk_02", "R", "head_wm1_browsRaiseOuter_L"],
  ["wm1_msk_02", "G", "head_wm1_browsRaiseOuter_R"],
  ["wm1_msk_02", "B", "head_wm1_chinRaise_L"],
  ["wm1_msk_02", "A", "head_wm1_chinRaise_R"],
  ["wm1_msk_03", "R", "head_wm1_jawOpen"],
  ["wm1_msk_03", "G", "head_wm1_purse_DL"],
  ["wm1_msk_03", "B", "head_wm1_purse_DR"],
  ["wm1_msk_03", "A", "head_wm1_purse_UL"],
  ["wm1_msk_04", "R", "head_wm1_purse_UR"],
  ["wm1_msk_04", "G", "head_wm1_squintInner_L"],
  ["wm1_msk_04", "B", "head_wm1_squintInner_R"],
  ["wm2_msk_01", "R", "head_wm2_browsLateral_L"],
  ["wm2_msk_01", "G", "head_wm2_browsLateral_R"],
  ["wm2_msk_01", "B", "head_wm2_browsDown_L"],
  ["wm2_msk_01", "A", "head_wm2_browsDown_R"],
  ["wm2_msk_02", "R", "head_wm2_mouthStretch_L"],
  ["wm2_msk_02", "G", "head_wm2_mouthStretch_R"],
  ["wm2_msk_02", "B", "head_wm2_neckStretch_L"],
  ["wm2_msk_02", "A", "head_wm2_neckStretch_R"],
  ["wm2_msk_03", "R", "head_wm2_noseWrinkler_L"],
  ["wm2_msk_03", "G", "head_wm2_noseWrinkler_R"],
  ["wm3_msk_01", "R", "head_wm3_cheekRaiseInner_L"],
  ["wm3_msk_01", "G", "head_wm3_cheekRaiseInner_R"],
  ["wm3_msk_01", "B", "head_wm3_cheekRaiseOuter_L"],
  ["wm3_msk_01", "A", "head_wm3_cheekRaiseOuter_R"],
  ["wm3_msk_02", "R", "head_wm3_cheekRaiseUpper_L"],
  ["wm3_msk_02", "G", "head_wm3_cheekRaiseUpper_R"],
  ["wm3_msk_02", "B", "head_wm3_smile_L"],
  ["wm3_msk_02", "A", "head_wm3_smile_R"],
  ["wm13_msk_01", "R", "head_wm13_lips_DL"],
  ["wm13_msk_01", "G", "head_wm13_lips_DR"],
  ["wm13_msk_01", "B", "head_wm13_lips_UL"],
  ["wm13_msk_01", "A", "head_wm13_lips_UR"],
];
const WRINKLE_TILE = 512;

async function prepareWrinkles(out) {
  const textures = join(out, "textures");
  await mkdir(textures, { recursive: true });
  const written = [];
  for (const name of WRINKLE_NORMALS) {
    const target = join(textures, `${name}.png`);
    // 2048: a wrinkle is a fold several millimetres wide, and the pores stay on the main map.
    await magick([join(SOURCE, "ada-wrinkles/textures/Content/MetaHumans/Ada/Face", `${name}.png`), "-alpha", "off", "-resize", "2048x2048", target]);
    written.push(`${name}.png`);
  }
  const scratch = join(out, "textures", ".wrinkle-scratch");
  await mkdir(scratch, { recursive: true });
  const greys = [];
  for (const [file, channel, region] of WRINKLE_REGIONS) {
    const grey = join(scratch, `${region}.png`);
    await magick([join(SOURCE, WRINKLE_MASK_DIR, `T_head_${file}.png`), "-alpha", "on", "-channel", channel, "-separate", "-resize", `${WRINKLE_TILE}x${WRINKLE_TILE}`, grey]);
    greys.push(grey);
  }
  const black = join(scratch, "black.png");
  await magick(["-size", `${WRINKLE_TILE}x${WRINKLE_TILE}`, "xc:black", "-colorspace", "gray", black]);
  const tiles = [];
  for (let at = 0; at < greys.length; at += 3) {
    const tile = join(scratch, `tile-${tiles.length}.png`);
    const three = [0, 1, 2].map((offset) => greys[at + offset] ?? black);
    await magick([...three, "-combine", "-colorspace", "sRGB", "-type", "TrueColor", tile]);
    tiles.push(tile);
  }
  await magick([...tiles, "-append", "+repage", join(textures, "WrinkleMasks.png")]);
  await rm(scratch, { recursive: true, force: true });
  await writeFile(
    join(out, "wrinkles.json"),
    JSON.stringify({
      tiles: tiles.length,
      regions: WRINKLE_REGIONS.map(([, , region], index) => ({ region, tile: Math.floor(index / 3), channel: index % 3 })),
    }),
  );
  written.push(`WrinkleMasks.png (${tiles.length} tiles)`, "wrinkles.json");
  return written;
}

async function prepareStrands(headBytes, json, out) {
  const headPrim = json.meshes[0].primitives[0];
  const headPosition = readAccessor(headBytes, json, headPrim.attributes.POSITION);
  const report = [];
  for (const set of STRAND_SETS) {
    const source = readGroom(await readFile(join(GROOM, set.from)));
    const converted = convertGroom(source);
    const lifted = set.lift === undefined ? undefined : liftOffSkin(headBytes, json, converted, set.lift);
    await writeFile(join(out, set.to), encodeGroom(converted));
    // The placement proof: how far a root sits from the nearest vertex of the face mesh.
    const count = converted.first.length - 1;
    const step = Math.max(1, Math.floor(count / 2000));
    const probe = [];
    for (let s = 0; s < count; s += step)
      for (let axis = 0; axis < 3; axis += 1) probe.push(converted.points[converted.first[s] * 4 + axis]);
    const near = nearestHeadVertices(headPosition, probe, 0.008);
    let sum = 0;
    for (let i = 0; i < near.length; i += 1)
      sum += Math.hypot(
        headPosition[near[i] * 3] - probe[i * 3],
        headPosition[near[i] * 3 + 1] - probe[i * 3 + 1],
        headPosition[near[i] * 3 + 2] - probe[i * 3 + 2],
      );
    report.push(
      `${set.to}: ${source.strandCount} strands, ${source.pointCount} points, ` +
        `root-to-scalp mean ${((sum / near.length) * 1000).toFixed(2)} mm over ${near.length} roots` +
        (lifted === undefined
          ? ""
          : `; ${lifted.moved} points lifted to ${set.lift * 1000} mm off the skin (largest move ${(lifted.largest * 1000).toFixed(2)} mm)`),
    );
    if (set.to === "hair.strands.bin") await scalpMask(headBytes, json, converted, out);
    if (set.to === "brows.strands.bin") {
      await writeFile(join(out, "brows.skin.json"), JSON.stringify(browSkin(headBytes, json, converted)));
      await browMask(headBytes, json, converted, out);
    }
  }
  return report;
}

/** The container: one JSON chunk, one BIN chunk, both padded to 4 bytes. */
function repack(json, bin) {
  const jsonBytes = Buffer.from(JSON.stringify(json), "utf8");
  const jsonPad = (4 - (jsonBytes.length % 4)) % 4;
  const binPad = (4 - (bin.length % 4)) % 4;
  const jsonChunk = Buffer.concat([jsonBytes, Buffer.alloc(jsonPad, 0x20)]);
  const binChunk = Buffer.concat([bin, Buffer.alloc(binPad, 0)]);
  const total = 12 + 8 + jsonChunk.length + 8 + binChunk.length;
  const out = Buffer.alloc(total);
  out.writeUInt32LE(0x46546c67, 0);
  out.writeUInt32LE(2, 4);
  out.writeUInt32LE(total, 8);
  out.writeUInt32LE(jsonChunk.length, 12);
  out.writeUInt32LE(0x4e4f534a, 16);
  jsonChunk.copy(out, 20);
  const binHeader = 20 + jsonChunk.length;
  out.writeUInt32LE(binChunk.length, binHeader);
  out.writeUInt32LE(0x004e4942, binHeader + 4);
  binChunk.copy(out, binHeader + 8);
  return out;
}


async function main() {
  const argv = process.argv.slice(2);
  const positional = [];
  let out = join(PROJECT, "content");
  let quiet = false;
  let strandsOnly = false;
  let wrinklesOnly = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--out") out = resolve(PROJECT, argv[(index += 1)] ?? "content");
    else if (arg === "--quiet") quiet = true;
    else if (arg === "--strands") strandsOnly = true;
    else if (arg === "--wrinkles") wrinklesOnly = true;
    else positional.push(arg);
  }
  const glbPath = resolve(positional[0] ?? DEFAULT_SPECIMEN);
  const dnaPath = resolve(positional[1] ?? DEFAULT_DNA);

  const [glbBytes, dnaBytes, browBytes, lod1Bytes] = await Promise.all([
    readFile(glbPath),
    readFile(dnaPath),
    readFile(join(DEFAULT_HAIR, BROW_SOURCE)),
    readFile(DEFAULT_LOD1),
  ]);
  const glbSha256 = sha256(glbBytes);
  const dnaSha256 = sha256(dnaBytes);
  const json = gltfJson(glbBytes, glbPath);
  // `--wrinkles` rewrites only the wrinkle maps and their region strip.
  if (wrinklesOnly) {
    process.stdout.write(`${(await prepareWrinkles(out)).join("\n")}\n`);
    return;
  }
  // `--strands` rewrites only the groom, which is the step a look iteration re-runs.
  if (strandsOnly) {
    await mkdir(out, { recursive: true });
    process.stdout.write(`${(await prepareStrands(glbBytes, json, out)).join("\n")}\n`);
    return;
  }

  const rig = await RigEvaluator.create(new Uint8Array(dnaBytes));
  try {
    const facts = {
      gui: rig.names("gui"),
      raw: rig.names("raw"),
      joints: rig.names("joint"),
      blendShapes: rig.names("blendShape"),
      animatedMaps: rig.names("animatedMap"),
      lodCount: rig.counts().lodCount,
    };
    const channelSet = new Set(facts.blendShapes);
    const jointSet = new Set(facts.joints);
    const guiSet = new Set(facts.gui);

    // The brow cards are welded in *first*, so every index below — mesh, target, node — is read off
    // the container the game actually loads rather than the export it came from.
    const bin = binWriter(json, glbBytes);
    const brows = weldBrows(glbBytes, json, browBytes, bin);

    // joints: an exact DNA joint name that is also a node name in the exported graph.
    const joints = [];
    for (const node of json.nodes ?? []) {
      if (typeof node.name === "string" && jointSet.has(node.name)) {
        joints.push({ dna: node.name, node: node.name });
      }
    }

    // morphs: `<dnaMesh>__<DNA channel>`, per primitive, only where that target has deltas. The brow
    // cards' own targets are welded in above and land in the same list on the same terms.
    const morphs = [...brows.morphs];
    const declaredTargets = [];
    const exportedChannels = new Set(brows.morphs.map((entry) => entry.channel));
    for (const [mesh, entry] of (json.meshes ?? []).entries()) {
      const names = entry.extras?.targetNames;
      if (!Array.isArray(names)) throw new Error(`glTF mesh ${mesh} carries no extras.targetNames`);
      for (const [primitive, prim] of entry.primitives.entries()) {
        for (const [target, morph] of (prim.targets ?? []).entries()) {
          declaredTargets.push(target);
          if (!targetHasDeltas(json, morph.POSITION)) continue;
          const named = names[target];
          if (typeof named !== "string") throw new Error(`target ${target} of mesh ${mesh} is unnamed`);
          const channel = named.slice(named.indexOf("__") + 2);
          if (!channelSet.has(channel))
            throw new Error(`glTF target '${named}' is not a blend shape this DNA carries`);
          exportedChannels.add(channel);
          morphs.push({ channel, mesh, primitive, target });
        }
      }
    }

    // controls: the PRD's semantic channels, resolved against the rig's real GUI names.
    const controls = [];
    for (const channel of SEMANTIC_CHANNELS) {
      for (const [alias, gui] of channel.controls) {
        if (!guiSet.has(gui))
          throw new Error(
            `the alias '${alias}' wants GUI control '${gui}', which this DNA does not carry ` +
              `(a GUI name carries its axis, e.g. CTRL_C_jaw.ty)`,
          );
        const { min, max } = domainFor(gui);
        controls.push({ alias, gui, min, max, default: 0 });
      }
    }

    const meshCount = json.meshes.length;
    // The look reads the *exported* head: the iris placement is a property of the eyeball's own
    // UVs, and welding the brows changed no head accessor. LOD1 is welded after it for the same
    // kind of reason — it is a mesh the look has nothing to say about, and `json` must still be the
    // LOD0-only container when these two read accessors out of `glbBytes` by index.
    const look = await prepareTextures(glbBytes, json, out);
    const strands = await prepareStrands(glbBytes, json, out);

    // lods: the two authored mesh sets in the container. LOD1 goes in after the morph scan because
    // it declares no targets at all, and a mesh with no targets is not a mesh whose
    // `extras.targetNames` is missing.
    const lod1 = weldLod1(glbBytes, json, lod1Bytes, bin);
    const specimenBytes = repack(json, bin.bytes());
    const lods = [
      { lod: 0, meshes: [0, brows.mesh] },
      { lod: 1, meshes: [lod1.mesh] },
    ];

    const bindings = {
      schemaVersion: 1,
      specimen: PROVENANCE,
      // The hash is of the *welded* container, because that is the file the loader checksum-checks.
      hashes: { dna: dnaSha256, glb: sha256(specimenBytes) },
      coordinates: COORDINATES,
      joints,
      morphs,
      lods,
      controls,
      animatedMaps: facts.animatedMaps.map((map) => ({ map })),
    };

    const prepared = validateMetaHumanAssets({
      bindings,
      dnaSha256,
      glbSha256: bindings.hashes.glb,
      rig: facts,
      gltf: { nodes: json.nodes, meshes: json.meshes },
    });

    await mkdir(out, { recursive: true });
    await writeFile(join(out, "specimen.glb"), specimenBytes);
    await copyFile(dnaPath, join(out, "head.dna"));
    for (const model of MODELS)
      await copyFile(join(model.root ?? DEFAULT_HAIR, model.from), join(out, model.to));
    const bindingsBytes = Buffer.from(`${JSON.stringify(bindings, null, 2)}\n`);
    await writeFile(join(out, "bindings.json"), bindingsBytes);

    if (quiet) return;
    const meshStats = json.meshes.map((mesh, index) => ({
      mesh: index,
      primitives: mesh.primitives.length,
      vertices: mesh.primitives.reduce(
        (total, prim) => total + (json.accessors[prim.attributes.POSITION]?.count ?? 0),
        0,
      ),
      triangles: mesh.primitives.reduce(
        (total, prim) => total + (json.accessors[prim.indices]?.count ?? 0) / 3,
        0,
      ),
      targets: mesh.primitives[0]?.targets?.length ?? 0,
    }));
    const lines = [
      "MetaHuman specimen prepared",
      `  route            asset MCP importer (asset_import_unreal) — PRD-465 §4 route 1`,
      `  specimen         ${PROVENANCE.id}`,
      `  source glb       ${glbPath}`,
      `  source dna       ${dnaPath}`,
      `  output           ${out}`,
      `  licence          ${PROVENANCE.license}`,
      "",
      "  joints           " +
        `${prepared.joints.length} mapped / ${facts.joints.length} DNA joints ` +
        `(${facts.joints.length - prepared.joints.length} DNA joints the export does not carry a node for)`,
      "  morph targets    " +
        `${prepared.morphs.length} mapped / ${declaredTargets.length} declared across ` +
        `${meshCount} mesh(es) with targets, covering ${exportedChannels.size} of ${facts.blendShapes.length} DNA blend shapes`,
      "  lods             " +
        `${prepared.lods.length} prepared (LOD0 ${brows.mesh === 1 ? "and its welded brow cards" : ""}, ` +
        `LOD1 welded in as mesh ${lod1.mesh}: ${lod1.vertices} vertices, ${lod1.triangles} triangles, ` +
        `${lod1.primitives} primitives, on the same skin and with no morph targets — so setLod(1) ` +
        `carries the expression through the joints alone; the rig itself reports ${facts.lodCount} LODs)`,
      "  controls         " +
        `${prepared.controls.length} aliases resolved against ${facts.gui.length} GUI controls ` +
        `the DNA carries — the PRD's 20 semantic channels (${SEMANTIC_CHANNELS.length} labels, ` +
        `6 of them split left/right) are one alias per GUI channel`,
      `  gui controls     ${prepared.controls.map((control) => `${control.alias}->${control.gui}`).join("  ")}`,
      "  animated maps    " +
        `${prepared.animatedMaps?.length ?? 0} bound of ${facts.animatedMaps.length} the rig carries`,
      `  skin influences  JOINTS_0 only, ${skinInfluenceReport(json).join("/")} per vertex ` +
        `— the source-side influence count was not measured (only the exported GLB was read)`,
      `  coordinates      ${COORDINATES.sourceUnits}, ${COORDINATES.sourceUp}-up, ` +
        `${COORDINATES.handedness}-handed (Unreal source; the engine applies the single conversion)`,
      "",
      "  brow cards       " +
        `welded into specimen.glb as mesh ${brows.morphs[0]?.mesh ?? "?"} on skin 0: ${brows.vertices} ` +
        `vertices, each taking the JOINTS_0/WEIGHTS_0 of the nearest head-surface vertex (8mm grid) and ` +
        `the ${brows.morphs.length} brow deltas blended from the 4 nearest *sampled* vertices of each ` +
        `channel (up to ${brows.sampled} samples reaching ${brows.blended} of them per card) — so ` +
        `loadMetaHuman's own joint and morph writes move them`,
      "  models           " +
        MODELS.map((model) => model.to).join(", ") +
        " copied beside the specimen, in the head's own rest space (metres, y up) — no placement guess",
      ...strands.map((line) => `  strands          ${line}`),
      "",
      `  textures         ${look.written.length} into ${look.textures} ` +
        `(${(look.written.reduce((sum, entry) => sum + entry.bytes, 0) / 1e6).toFixed(1)} MB)`,
      ...look.written.map(
        (entry) => `    ${entry.name.padEnd(42)} ${(entry.bytes / 1e6).toFixed(2).padStart(7)} MB  ${entry.note}`,
      ),
      ...look.placements.map(
        (eye) =>
          `  iris ${eye.material.padEnd(28)} UV centre (${eye.centreU.toFixed(4)}, ${eye.centreV.toFixed(4)})  ` +
          `iris r=${eye.radiusU.toFixed(4)} — a ${(IRIS_DIAMETER_M * 1000).toFixed(1)}mm iris is ` +
          `${eye.angleDegrees.toFixed(2)}° off the pole of a ${(eye.eyeballRadius * 2000).toFixed(2)}mm-radius ball, ` +
          `and this unwrap's rings are ${(eye.radiusU / (eye.angleDegrees * Math.PI / 180)).toFixed(4)} UV per radian there`,
      ),
      "",
      "  geometry",
      ...meshStats.map(
        (stats) =>
          `    mesh ${stats.mesh}: ${stats.vertices} vertices, ${stats.triangles} triangles, ` +
          `${stats.primitives} primitives, ${stats.targets} morph targets per primitive`,
      ),
      "",
      `  sha256 glb       ${bindings.hashes.glb}  (the welded container, LOD0 + brows + LOD1)`,
      `  sha256 source    ${glbSha256}  (the export, before the brows were welded in)`,
      `  sha256 dna       ${dnaSha256}`,
      `  sha256 bindings  ${sha256(bindingsBytes)}`,
    ];
    process.stdout.write(`${lines.join("\n")}\n`);
  } finally {
    rig.dispose();
  }
}

main().catch((error) => {
  process.exitCode = 1;
  console.error(`prepare failed: ${error instanceof Error ? error.message : String(error)}`);
});
