/**
 * Static and animated census of the six production Animal Variety Pack GLBs.
 *
 * Resolves the same logical paths the Valley passes to ctx.assets.model(), measures both the
 * source and the manifest-selected served bytes, and writes deterministic JSON. The explicit
 * omitted-sixth validation mode is the fail-closed negative control.
 *
 *   node tools/measure-animals.mjs
 *   node tools/measure-animals.mjs --validate omitted-sixth
 */
import { createHash } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { measureThreePose } from "@threenative/core";
import { AnimationMixer } from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder as ThreeMeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";

const ROOT = resolve(import.meta.dirname, "..");
const MANIFEST_PATH = resolve(ROOT, "public/assets.manifest.json");
const ANIMAL_LISTING = "2dd7964c-a601-4264-a53d-465dcae1644c";
const OUTPUT_DEFAULT = resolve(
  ROOT,
  "artifacts/animals/production-census.json",
);
const NORMAL_TOLERANCE = 0.02;

const SPECIES = [
  {
    id: "fox",
    glb: "SK_Fox",
    poses: {
      idle: "ANIM_Fox_IdleBreathe",
      walk: "ANIM_Fox_Walk",
      run: "ANIM_Fox_Run",
    },
  },
  {
    id: "wolf",
    glb: "SK_Wolf",
    poses: {
      idle: "ANIM_Wolf_IdleBreathe",
      walk: "ANIM_Wolf_Walk",
      run: "ANIM_Wolf_Run",
    },
  },
  {
    id: "stag",
    glb: "SK_DeerStag",
    poses: {
      idle: "ANIM_DeerStag_IdleBreathe",
      walk: "ANIM_DeerStag_Walk",
      run: "ANIM_DeerStag_Run",
    },
  },
  {
    id: "doe",
    glb: "SK_DeerDoe",
    poses: {
      idle: "ANIM_DeerDoe_IdleBreathe",
      walk: "ANIM_DeerDoe_Walk",
      run: "ANIM_DeerDoe_Run",
    },
  },
  {
    id: "pig",
    glb: "SK_Pig",
    poses: {
      idle: "ANIM_Pig_IdleBreathe",
      walk: "ANIM_Pig_Walk",
      run: "ANIM_Pig_Run",
    },
  },
  {
    id: "crow",
    glb: "SK_Crow",
    poses: {
      idle: "ANIM_Crow_IdleLookAround",
      walk: "ANIM_Crow_Walk",
      run: "ANIM_Crow_Hop",
    },
  },
];

const args = process.argv.slice(2);
const option = (name, fallback = undefined) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : fallback;
};
const outputPath = resolve(
  ROOT,
  option("output", relative(ROOT, OUTPUT_DEFAULT)),
);
const validation = option("validate");

// Resolve glTF-Transform through @threenative/assets, whose published package pins a compatible
// core/extensions/Meshopt set. Wildwood's CLI dependency intentionally has a separate range.
const assetRequire = createRequire(import.meta.resolve("@threenative/assets"));
const importAssetDependency = async (name) =>
  import(pathToFileURL(assetRequire.resolve(name)).href);
const [{ NodeIO }, { ALL_EXTENSIONS }, meshoptimizer] = await Promise.all([
  importAssetDependency("@gltf-transform/core"),
  importAssetDependency("@gltf-transform/extensions"),
  importAssetDependency("meshoptimizer"),
]);
const { MeshoptDecoder, MeshoptEncoder } = meshoptimizer;
await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready]);
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({
    "meshopt.decoder": MeshoptDecoder,
    "meshopt.encoder": MeshoptEncoder,
  });

const manifest = JSON.parse(await readFile(MANIFEST_PATH, "utf8"));
const roster = validation === "omitted-sixth" ? SPECIES.slice(0, -1) : SPECIES;
requireRoster(roster);

const rows = [];
for (const species of roster) {
  const logicalPath = `fab/${ANIMAL_LISTING}/ue/Models/${species.glb}.glb`;
  const manifestEntry = manifest.entries?.[logicalPath];
  if (manifestEntry === undefined) {
    throw new Error(`required animal manifest entry missing: ${logicalPath}`);
  }
  if (
    typeof manifestEntry.output !== "string" ||
    manifestEntry.output.length === 0
  ) {
    throw new Error(`required animal served path missing: ${logicalPath}`);
  }

  const sourcePath = resolve(ROOT, "assets", logicalPath);
  const servedPath = resolve(ROOT, "public", manifestEntry.output);
  const [source, served] = await Promise.all([
    measureFile(sourcePath, species.poses),
    measureFile(servedPath, species.poses),
  ]);
  const sameHash = source.sha256 === served.sha256;
  const transformed =
    Array.isArray(manifestEntry.passes) && manifestEntry.passes.length > 0;
  rows.push({
    id: species.id,
    model: species.glb,
    logicalPath,
    source,
    served,
    hashComparison: {
      same: sameHash,
      label: sameHash
        ? "byte-identical"
        : transformed
          ? "intentional-post-phase-1-transform"
          : "unexplained-difference",
      manifestPasses: [...(manifestEntry.passes ?? [])].sort(),
    },
  });
}

const report = {
  version: 1,
  manifestPath: relative(ROOT, MANIFEST_PATH),
  expectedSpecies: SPECIES.length,
  species: rows,
  summary: {
    species: rows.length,
    sourceBytes: rows.reduce((sum, row) => sum + row.source.bytes, 0),
    servedBytes: rows.reduce((sum, row) => sum + row.served.bytes, 0),
    hashDifferences: rows.filter((row) => !row.hashComparison.same).length,
    intentionalTransformedDifferences: rows.filter(
      (row) =>
        row.hashComparison.label === "intentional-post-phase-1-transform",
    ).length,
  },
};
validateReport(report);
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(
  `TN_ANIMAL_CENSUS:${relative(ROOT, outputPath)} species=${rows.length}`,
);

function requireRoster(species) {
  const ids = new Set(species.map((entry) => entry.id));
  if (species.length !== 6 || ids.size !== 6) {
    throw new Error(
      `required animal roster has ${species.length} unique=${ids.size}; expected six`,
    );
  }
}

async function measureFile(path, poseClips) {
  let bytes;
  try {
    bytes = await readFile(path);
  } catch (error) {
    throw new Error(`required animal file missing: ${relative(ROOT, path)}`, {
      cause: error,
    });
  }
  const document = await io.read(path);
  const structural = inspectDocument(document);
  const animated = await inspectPoses(document, poseClips);
  return {
    path: relative(ROOT, path),
    sha256: createHash("sha256").update(bytes).digest("hex"),
    bytes: bytes.byteLength,
    ...structural,
    ...animated,
  };
}

function inspectDocument(document) {
  const root = document.getRoot();
  const attributeRows = new Map();
  const materialGroups = [];
  let primitiveTotal = 0;
  let triangleTotal = 0;

  for (const [meshIndex, mesh] of root.listMeshes().entries()) {
    for (const [primitiveIndex, primitive] of mesh.listPrimitives().entries()) {
      primitiveTotal += 1;
      triangleTotal += triangleCount(primitive);
      const material = primitive.getMaterial();
      materialGroups.push({
        mesh: mesh.getName() || `mesh-${meshIndex}`,
        primitive: primitiveIndex,
        material: material?.getName() || null,
      });
      for (const semantic of primitive.listSemantics().sort()) {
        const accessor = primitive.getAttribute(semantic);
        if (accessor === null)
          throw new Error(`missing ${semantic} accessor in ${mesh.getName()}`);
        const row = attributeRows.get(semantic) ?? {
          semantic,
          accessors: 0,
          count: 0,
        };
        row.accessors += 1;
        row.count += accessor.getCount();
        attributeRows.set(semantic, row);
      }
    }
  }

  const normals = inspectDirectionAttribute(root, "NORMAL", 3, false);
  const tangents = inspectDirectionAttribute(root, "TANGENT", 4, true);
  return {
    primitiveTotal,
    triangleTotal,
    attributes: [...attributeRows.values()].sort((left, right) =>
      left.semantic.localeCompare(right.semantic),
    ),
    skinTotal: root.listSkins().length,
    clipTotal: root.listAnimations().length,
    clipNames: root
      .listAnimations()
      .map((clip) => clip.getName())
      .sort(),
    materialGroups: {
      count: materialGroups.length,
      groups: materialGroups.sort((left, right) =>
        `${left.mesh}:${left.primitive}`.localeCompare(
          `${right.mesh}:${right.primitive}`,
        ),
      ),
    },
    normals,
    tangents,
  };
}

function triangleCount(primitive) {
  const count =
    primitive.getIndices()?.getCount() ??
    primitive.getAttribute("POSITION")?.getCount();
  if (count === undefined)
    throw new Error("primitive has neither indices nor POSITION");
  switch (primitive.getMode()) {
    case 4:
      return Math.floor(count / 3);
    case 5:
    case 6:
      return Math.max(0, count - 2);
    default:
      return 0;
  }
}

function inspectDirectionAttribute(
  root,
  semantic,
  dimensions,
  checkHandedness,
) {
  const values = new Array(dimensions).fill(0);
  let accessorCount = 0;
  let elementCount = 0;
  let finite = true;
  let unitLength = true;
  let handedness = true;
  for (const mesh of root.listMeshes()) {
    for (const primitive of mesh.listPrimitives()) {
      const accessor = primitive.getAttribute(semantic);
      if (accessor === null) continue;
      accessorCount += 1;
      elementCount += accessor.getCount();
      for (let index = 0; index < accessor.getCount(); index += 1) {
        accessor.getElement(index, values);
        finite &&= values.every(Number.isFinite);
        const length = Math.hypot(values[0], values[1], values[2]);
        unitLength &&=
          Number.isFinite(length) && Math.abs(length - 1) <= NORMAL_TOLERANCE;
        if (checkHandedness) {
          handedness &&= Math.abs(Math.abs(values[3]) - 1) <= NORMAL_TOLERANCE;
        }
      }
    }
  }
  if (!finite) throw new Error(`${semantic} contains a non-finite value`);
  return {
    present: accessorCount > 0,
    accessorCount,
    elementCount,
    finite,
    unitLength: accessorCount > 0 ? unitLength : null,
    handedness: checkHandedness && accessorCount > 0 ? handedness : null,
    tolerance: NORMAL_TOLERANCE,
  };
}

async function inspectPoses(document, poseClips) {
  // Textures are irrelevant to geometry and cannot be decoded by Node's GLTFLoader. Strip only
  // their bindings in a diagnostic copy, then let Three's real loader/mixer and measureThreePose
  // evaluate skinning and animation.
  const root = document.getRoot();
  const buffer = root.listBuffers()[0] ?? document.createBuffer();
  for (const accessor of root.listAccessors()) {
    if (accessor.getBuffer() === null) accessor.setBuffer(buffer);
  }
  for (const mesh of root.listMeshes()) {
    for (const primitive of mesh.listPrimitives()) primitive.setMaterial(null);
  }
  for (const material of root.listMaterials()) material.dispose();
  for (const texture of root.listTextures()) texture.dispose();

  const binary = await io.writeBinary(document);
  const arrayBuffer = binary.buffer.slice(
    binary.byteOffset,
    binary.byteOffset + binary.byteLength,
  );
  const loader = new GLTFLoader().setMeshoptDecoder(ThreeMeshoptDecoder);
  const gltf = await loader.parseAsync(arrayBuffer, "");
  const bindTransforms = [];
  gltf.scene.traverse((object) => {
    bindTransforms.push({
      object,
      position: object.position.clone(),
      quaternion: object.quaternion.clone(),
      scale: object.scale.clone(),
    });
  });
  const bindBounds = requiredBounds(
    "bind",
    measureThreePose(gltf.scene).bounds,
  );
  const poses = {};
  for (const [semantic, clipName] of Object.entries(poseClips)) {
    for (const transform of bindTransforms) {
      transform.object.position.copy(transform.position);
      transform.object.quaternion.copy(transform.quaternion);
      transform.object.scale.copy(transform.scale);
    }
    gltf.scene.traverse((object) => object.skeleton?.pose());
    const clip = gltf.animations.find(
      (candidate) => candidate.name === clipName,
    );
    if (clip === undefined)
      throw new Error(`required ${semantic} clip missing: ${clipName}`);
    const mixer = new AnimationMixer(gltf.scene);
    mixer.clipAction(clip).play();
    const sampleSeconds = clip.duration / 2;
    mixer.setTime(sampleSeconds);
    gltf.scene.updateMatrixWorld(true);
    poses[semantic] = {
      clip: clip.name,
      sampleSeconds,
      bounds: requiredBounds(
        `${semantic}:${clip.name}`,
        measureThreePose(gltf.scene).bounds,
      ),
    };
    mixer.stopAllAction();
    mixer.uncacheRoot(gltf.scene);
  }
  return { bindBounds, poses };
}

function requiredBounds(label, bounds) {
  if (bounds === null) throw new Error(`required ${label} bounds missing`);
  for (const [field, values] of Object.entries(bounds)) {
    if (
      !Array.isArray(values) ||
      values.length !== 3 ||
      !values.every(Number.isFinite)
    ) {
      throw new Error(
        `required ${label} bounds.${field} is missing or non-finite`,
      );
    }
  }
  return bounds;
}

function validateReport(value) {
  if (value.species.length !== value.expectedSpecies) {
    throw new Error(
      `animal report has ${value.species.length} species; expected ${value.expectedSpecies}`,
    );
  }
  for (const row of value.species) {
    for (const sideName of ["source", "served"]) {
      const side = row[sideName];
      for (const field of [
        "path",
        "sha256",
        "bytes",
        "primitiveTotal",
        "triangleTotal",
        "attributes",
        "skinTotal",
        "clipTotal",
        "materialGroups",
        "normals",
        "tangents",
        "bindBounds",
        "poses",
      ]) {
        if (side[field] === undefined)
          throw new Error(`${row.id}.${sideName}.${field} is missing`);
      }
      for (const pose of ["idle", "walk", "run"]) {
        if (side.poses[pose]?.bounds === undefined) {
          throw new Error(
            `${row.id}.${sideName}.poses.${pose}.bounds is missing`,
          );
        }
      }
    }
  }
  assertFiniteNumbers(value, "report");
}

function assertFiniteNumbers(value, path) {
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new Error(`${path} is non-finite`);
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) =>
      assertFiniteNumbers(entry, `${path}[${index}]`),
    );
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const [key, entry] of Object.entries(value))
      assertFiniteNumbers(entry, `${path}.${key}`);
  }
}
