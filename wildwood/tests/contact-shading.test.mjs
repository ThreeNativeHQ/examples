import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { PerspectiveCamera, Scene } from "three";
import DenoiseNode from "three/addons/tsl/display/DenoiseNode.js";
import GTAONode from "three/addons/tsl/display/GTAONode.js";
import SSGINode from "three/addons/tsl/display/SSGINode.js";
import { vec4 } from "three/tsl";

// Compile the real game source; only the renderer installation seam is replaced.
// No GPU is needed to inspect the graph handed to the renderer.
const root = fileURLToPath(new URL("../", import.meta.url));
const temporary = await mkdtemp(`${root}tests/.contact-shading-`);
after(() => rm(temporary, { recursive: true, force: true }));
const mutation = process.env.WILDWOOD_SHADING_MUTATION;
assert.ok(
  [undefined, "raw-ao", "soft-sharpen", "narrow-ao", "temporal-ssgi", "temporal-gtao"].includes(
    mutation,
  ),
);
let mutations = 0;
await build({
  stdin: {
    contents:
      'export { WorldEnvironment } from "./src/render/worldEnvironment.ts"; export { qualityPreset } from "./src/render/quality.ts";',
    resolveDir: root,
  },
  outfile: `${temporary}/render.mjs`,
  bundle: true,
  platform: "node",
  format: "esm",
  packages: "external",
  plugins: mutation
    ? [
        {
          name: "regression-control",
          setup(builder) {
            builder.onLoad({ filter: /(?:worldEnvironment|quality)\.ts$/ }, async ({ path }) => {
              let contents = await readFile(path, "utf8");
              // Negative controls change only the isolated compilation, never the game on disk.
              // Negative controls, one per thing this suite is supposed to catch: raw AO
              // reaching the colour multiply, the rejected whole-frame softening, and a
              // contact filter left at `DenoiseNode`'s own defaults — which is the state that
              // left speckling in the fern understory.
              const [before, replacement] = {
                "raw-ao": ["input.mul(contactDenoise(contact).r)", "input.mul(contact.r)"],
                "soft-sharpen": ["sharpenStrength: 0.28", "sharpenStrength: 0.9"],
                "narrow-ao": ["CONTACT_DENOISE_RADIUS = 16", "CONTACT_DENOISE_RADIUS = 5"],
                "temporal-ssgi": [
                  "gi.useTemporalFiltering = false;",
                  "gi.useTemporalFiltering = true;",
                ],
                // Not a hypothetical: `SSGINode` and `GTAONode` carry the same property with
                // opposite defaults, so the contact term's stability is a dependency default
                // this game would rather state than inherit.
                "temporal-gtao": [
                  "contact.useTemporalFiltering = false;",
                  "contact.useTemporalFiltering = true;",
                ],
              }[mutation];
              mutations += contents.split(before).length - 1;
              contents = contents.replaceAll(before, replacement);
              return { contents, loader: "ts" };
            });
          },
        },
      ]
    : [],
});
if (mutation) assert.equal(mutations, mutation === "soft-sharpen" ? 3 : 1);
const { WorldEnvironment, qualityPreset } = await import(`${temporary}/render.mjs`);

for (const tier of ["low", "medium", "high"]) {
  test(`${tier}: preparing output before loading prevents a tone-map change at world entry`, () => {
    const raw = { toneMapping: 0, toneMappingExposure: 1 };
    const renderer = {
      kind: "webgpu",
      raw,
      createRenderChain: (definition) => ({
        applied: { stages: definition.request.stages, dropped: [] },
      }),
    };
    const world = new WorldEnvironment(qualityPreset(tier));
    world.prepare(renderer);
    assert.equal(raw.toneMapping, 4);
    const loadingOutput = { ...raw };
    world.apply(renderer, new Scene(), new PerspectiveCamera());
    assert.deepEqual(raw, loadingOutput);
  });
}

function nodes(rootNode) {
  const found = new Set();
  const visit = (node) => {
    if (found.has(node)) return;
    found.add(node);
    for (const child of node.getChildren()) visit(child);
  };
  visit(rootNode);
  return [...found];
}

function graph(options) {
  let installed;
  const camera = new PerspectiveCamera();
  new WorldEnvironment(options).apply(
    {
      kind: "webgpu",
      raw: {},
      createRenderChain(definition) {
        installed = definition;
        return { applied: { stages: definition.request.stages, dropped: [] } };
      },
    },
    new Scene(),
    camera,
  );
  assert.ok(installed, "the render graph must be installed");
  const input = vec4(0.3, 0.5, 0.7, 1);
  const ao = installed.stages.find(({ name }) => name === "ambientOcclusion");
  assert.ok(installed.request.stages.includes("ambientOcclusion"));
  const built = ao.build(input, { tier: "high" });
  const output = built.isVarNode ? built.node : built;
  return { camera, installed, input, output };
}

for (const tier of ["low", "medium", "high"]) {
  test(`${tier}: contact shading filters AO before multiplying colour`, () => {
    const { output, input } = graph(qualityPreset(tier));
    assert.equal(output.op, "*");
    assert.equal(output.aNode, input);
    assert.equal(output.bNode.components, "x", "AO must affect all colour channels equally");
    const branch = nodes(output.bNode);
    const filter = branch.find((node) => node instanceof DenoiseNode);
    assert.ok(filter, "raw stochastic AO must not reach the colour multiply");
    assert.ok(nodes(filter.textureNode).some((node) => node instanceof GTAONode));
    assert.ok(filter.depthNode, "edge-aware filtering needs scene depth");
    assert.ok(filter.normalNode, "edge-aware filtering needs scene normals");
    const gather = nodes(filter.textureNode).find((node) => node instanceof GTAONode);
    assert.equal(
      gather.useTemporalFiltering,
      false,
      "the contact gather must not rotate its noise per frame either — three's two nodes ship " +
        "this property with opposite defaults, so this scene states it rather than inheriting it",
    );
  });

  test(`${tier}: the contact filter is widened and loosened off DenoiseNode's defaults`, () => {
    const { camera, output } = graph(qualityPreset(tier));
    const filter = nodes(output.bNode).find((node) => node instanceof DenoiseNode);
    // A default-tuned filter is what left the speckling: 16 taps inside 5 half-res texels,
    // each weighted by `pow(dot(n, n_sample), 5)`, so in fern understory — where every
    // neighbour's normal disagrees — the filter returns the noisy centre texel and calls it
    // denoised. Reach further, stop on depth instead of on normal agreement.
    const reference = new DenoiseNode(
      filter.textureNode,
      filter.depthNode,
      filter.normalNode,
      camera,
    );
    assert.ok(
      filter.radius.value > reference.radius.value,
      `contact reach ${filter.radius.value} must exceed the ${reference.radius.value}-texel default`,
    );
    assert.ok(
      filter.normalPhi.value < reference.normalPhi.value,
      `normal stopping ${filter.normalPhi.value} must be looser than the ${reference.normalPhi.value} default`,
    );
    assert.ok(
      filter.depthPhi.value < reference.depthPhi.value,
      `depth stopping ${filter.depthPhi.value} m must be tighter than the ${reference.depthPhi.value} m default`,
    );
  });

  test(`${tier}: actual RCAS node preserves the approved sharpening`, () => {
    const { installed, output } = graph(qualityPreset(tier));
    assert.ok(installed.request.stages.includes("sharpen"));
    const stage = installed.stages.find(({ name }) => name === "sharpen");
    const sharpened = stage.build(output, { tier });
    // 0 is maximum sharpening and 2 is none. 0.9 was tried to hide the AO grain and rejected:
    // it took the ground and leaf textures with it. Grain is the filter's problem, not RCAS's.
    assert.equal(sharpened.sharpness.value, 0.28);
    assert.ok(nodes(sharpened.textureNode).includes(output));
  });
}

test("explicit denoise override bypasses the filter while retaining AO", () => {
  const { output } = graph({ ...qualityPreset("high"), denoiseEnabled: false });
  const branch = nodes(output.bNode);
  assert.ok(branch.some((node) => node instanceof GTAONode));
  assert.ok(!branch.some((node) => node instanceof DenoiseNode));
});

/**
 * The defect this file was opened for, at its source.
 *
 * `SSGINode.useTemporalFiltering` ships `true`, and three's own doc on the property says that
 * value "requires the usage of `TRAANode`" — and that with it `false`, "a manual denoise via
 * `DenoiseNode` is required". Left `true` the node rotates its slice direction by `frameId % 6`
 * and its ray-start offset by `frameId % 4` every frame, on the assumption that something
 * downstream averages consecutive frames. This chain has no TRAA node, so nothing does, and a
 * fresh noise realization reaches the screen every frame: dark speckle that crawls. Measured on
 * the spawn view, that churn was 5.2/255 of mean luminance between two captures of the *same*
 * build — 70% of the difference between the arms being compared — and it was worst exactly
 * where the report said the artifact was, in the dense foliage.
 *
 * So this asserts the pair that has to hold together: the flag off, and the manual denoise its
 * doc requires in exchange, present on both gathered terms.
 */
for (const tier of ["high"]) {
  test(`${tier}: the GI gather does not rotate its noise per frame without a TRAA node`, () => {
    const { installed, input } = graph(qualityPreset(tier));
    const stage = installed.stages.find(({ name }) => name === "ssgi");
    assert.ok(stage, "this tier is expected to run the GI gather");
    assert.ok(
      !installed.request.stages.includes("traa"),
      "a TRAA stage would make temporal filtering the correct setting — revisit this test",
    );
    const built = stage.build(input, { tier });
    const gather = nodes(built.isVarNode ? built.node : built).find(
      (node) => node instanceof SSGINode,
    );
    assert.ok(gather, "the GI stage must install an SSGINode");
    assert.equal(
      gather.useTemporalFiltering,
      false,
      "per-frame slice rotation with nothing to average it is the speckle in the report",
    );
    // The other half of the node's contract: it says the manual denoise is *required* once the
    // flag is off, and both gathered terms go through one.
    const filtered = nodes(built.isVarNode ? built.node : built).filter(
      (node) => node instanceof DenoiseNode,
    );
    assert.equal(filtered.length, 2, "both the AO and the GI term must be denoised");
  });
}
