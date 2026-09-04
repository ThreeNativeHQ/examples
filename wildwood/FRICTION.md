# FRICTION — wildwood

Gaps found while building this game, with the evidence. Per the sandbox standing instruction: an
abstraction that belongs to the engine goes in the engine. These are logged as they happened, and
none is lifted yet — each needs a second game to write it before it earns a package.

## 1. No terrain layer blending

`engine_search_capabilities("blend several PBR ground textures across a terrain by slope and
height")` → `[]`.

Written in the game at `src/render/terrain.ts` (`layerWeights`, `createTerrainMaterial`). Four
layers, weights baked per vertex from slope/height/moisture, mixed in TSL.

**Gate read:** rule 2 vetoes lifting the *material* — it decides how the ground looks, and colour,
tiling and layer choice must stay call arguments. What might survive the gate one day is the
mechanical half only: "bake a normalised weight-set into a vertex attribute and mix N samples by
it". Not yet — one game has written it once.

## 2. No instanced foliage scatter

`engine_search_capabilities("scatter instanced alpha-tested foliage cards with wind across a
landscape")` → `[]`.

Written at `src/render/foliage.ts` (`scatter`, `createFoliage`). Jittered-lattice rejection
sampling against slope/height/water rules, one `InstancedMesh` per species.

**Gate read:** `scatter` is arguably portable mechanism — it decides *where*, not *what it looks
like* — and every outdoor game needs it. Candidate for a lift once a second game writes it.

## 3. No texture configuration helper

`engine_search_capabilities("load a texture from the game assets directory and set its wrapping and
colour space")` → `[]`.

`ctx.assets.texture()` returns the texture but the game must then set `wrapS`/`wrapT`/`colorSpace`
by hand at every call site. Getting `colorSpace` wrong on a normal map is invisible in code review
and washes out every lit surface. See `src/scenes/Valley.ts` `loadGround`.

**Gate read:** this is the strongest candidate here — it is not a look decision, it is a correctness
trap with a right answer (diffuse is sRGB, data maps are not), and it is pure mechanism.

## 4. No water surface

`engine_search_capabilities("animated water surface with waves and reflections")` → `[]`.

Written at `src/render/water.ts`. Depth baked per vertex at build time from the same `heightAt` the
terrain uses, so the shore fades without a depth pre-pass.

**Gate read:** rule 2 vetoes it outright — a water surface is nothing but look.

## 5. Landscape Pro 2.0 meshes could not be imported

Not an engine gap; recorded because the next agent will otherwise try it again.

`asset_import_unreal` (threenative-asset-mcp 0.7.0) converts the pack's **textures** perfectly —
37/37, zero failures. Its **static meshes** are refused:

```
ImportError: 18 uncooked static-mesh packages use UE4 object version 514. The engine-free
MeshDescription path is verified for versions 517-522 (UE4.26/4.27-era source assets);
refusing to guess at a different binary layout.
```

Downloading a later `--engine` does not help: Fab serves one artifact for every listed engine
version (4.24 and 4.27 are byte-identical, 3,225,681,826 bytes). The compatibility list is
metadata, not a re-cook. So the geometry here stays procedural and wears the pack's textures.

## 5a. Update: the v514 refusal was already fixed, just never installed

The refusal above was stale tooling, not a missing capability. `threenative-asset-mcp` source
(commit 882f13f, working tree beyond it) already decodes v514 FRawMesh source models — but the
sandbox's `.mcp-tools/` still held the v43 build. Repacking the repo into `.mcp-tools/` (v44)
made every one of the pack's 61 meshes import: 12 minutes, zero failures, real geometry for the
pines, the rocks, the cliffs, and every plant. Evidence:
`wildwood/assets/fab/1ac647da-b1bc-4e72-a56d-60aaeb6918e1/import-report.json`.

**Rule for the next agent:** after fixing `threenative-asset-mcp`, repack it into the sandbox's
`.mcp-tools/` or the games keep running the old importer.

## 6. No water abstraction in the engine for ponds/lakes

Asked for: realistic pond/lake water with depth-based shore transparency. Two
`engine_search_capabilities` sweeps (request + mechanic: "animated water surface shader with
depth-based shore transparency over a heightfield terrain", "water rendering with reflections and
ripples", "ocean or sea surface with large waves, buoyancy, and underwater rendering") all return
empty, **but the engine does ship `SpectralOcean`** (`packages/core/src/ocean/spectral.ts`, FFT
wave spectra with buoyancy and GPU readback) — the searches missed it because the manifest the
MCP serves (`fps-framework/capabilities.json`) is stale. A second agent is fixing the manifest
pipeline. `SpectralOcean` itself is an ocean-with-ships abstraction: cascaded FFT patches, no
depth-based shore blending — wrong fit for a forest pond, and rule 2 means a pond-shaped water
look ships as game render code regardless.

Evidence: `engine_search_capabilities` outputs (empty) vs
`threenative-engine/packages/core/capabilities.json` lines 380-427. The game keeps its own
depth-baked water (`src/render/water.ts`) with the pack's `waves_normal` map for ripple detail.

## 6a. Update: the water abstraction existed; the manifest was lying

The capabilities agent fixed the pipeline: the engine's manifest generator
(`pnpm tsx scripts/build-capability-manifest.ts` in threenative-engine, doc-derived, 231
entries) was never re-run into the copy the MCP serves — fps-framework held a 115-entry
old-generation artifact. With the fresh manifest, the searches above now resolve:

- `WaveField` (@threenative/core) — analytic waves on CPU + matching TSL displacement; the game
  supplies every wave number. This is where this game's two hand-rolled swell sines in
  `water.ts` land if a second use appears (a floating prop, an animal drinking) — the "twice"
  rule. The ripple normals, colour and opacity stay game-side regardless: rule 2, that is look.
- `SpectralOcean` / `Buoyancy3D` / `FluidField2D` — ocean-scale, confirmed wrong fit for a pond.

Evidence: capability-agent report (manifest diff 115 → 231, generator path, MCP verification
outputs resolving SpectralOcean and WaveField without a server restart).

## 7. Uncooked skeletal meshes (v510-514) are the next import gap; and a substitution

The Animal Variety Pack (Fab 2dd7964c) downloads fine through `fab_import_asset` once the user's
FabCLI session exists — 220 packages, 29 textures to 4096², 17 material instances, entitlement
recognised. The six **skeletal** meshes produce no GLB ("the modern UE5 mesh converter produced
no GLB"), so all ~150 ActorX PSA animations fail to bind at the 80% threshold — nothing exists
to bind to. A lane is absorbing the user's `three-ueformat-loader` (parses UEFormat v10 skeletal
LODs, skin weights, skeleton metadata from CUE4Parse `.uemodel` exports) into the MCP to close
this. Until then the game ships Quaternius CC0 animals (fox, wolf, husky, stag, doe — rigged,
12 clips each, all bound), which are stylised-low-poly and smaller than the real pack.

Also recorded: Fab's own `isFree` flag is false for sponsored free listings whose every
license priceTier prices 0 — the tiers are the truth, and both the normaliser and the
free-download gate now read them.

## 8. Three owned Fab vegetation packs are un-importable: UE4 object versions 413–516

Lane B went to Fab for new species — the valley's whole plant list is one pack, and eight of its
fifty-nine meshes carry the entire undergrowth. Three owned, on-theme packs refused at the import
step, all with the same shape of failure:

```
fab_import_asset b778bd8f-524c-42b6-b60c-4caac59029c1  (Temperate Vegetation: Fern Collection)
  UNREAL_SOURCE_UNSUPPORTED: 37 uncooked static-mesh packages use UE4 object version 516.
  The engine-free MeshDescription path is verified for versions 517-522.

fab_import_asset d3a29766-c848-40c5-ad3d-d609b80d224b  (Procedural Nature Pack Vol.1)
  UNREAL_SOURCE_UNSUPPORTED: 48 uncooked static-mesh packages use UE4 object version 413, 451, 498.
```

**Passing a later `--engine` does not help, and this is worth writing down twice**: the Fern
Collection lists UE_4.19 through UE_5.4, and `UE_4.27` and `UE_5.4` both download the same
artifact and both report version **516** — one version short of the supported floor. Fab's engine
compatibility list is metadata about what the pack *runs* in, not a set of separately cooked
artifacts. CREDITS.md already records this for Landscape Pro; it is a property of Fab, not of one
listing, and the importer's error should probably say so rather than inviting the retry.

516 in particular is a one-off gap: it is UE 4.25-era source, one increment below a range the
importer already handles. Whatever verification the 517–522 range rests on is worth re-running at
516 before writing a new reader — the odds that the MeshDescription layout moved in that
increment are not obviously high.

**What this cost, and what it did not.** No new species reached the valley. The density work went
ahead entirely inside the pack already imported, by treating a niche as a *layer* rather than a
species list — the same three `SM_pine-small` meshes now grow at three sizes as canopy
mid-storey, saplings, and (with the dead-tree meshes tipped over) deadfall. That is a real
technique and the wood is far better for it, but it is a technique for getting more out of one
pack, and it does not substitute for species variety: every conifer in the valley is still one of
five silhouettes.

---

## The godrays stage cannot be enabled from where the template calls `setupPost` (lighting pass, 2026-09-03)

`WorldEnvironment`'s `godRays` stage is raymarched against the sun's shadow map, and
`GodraysNode` reads `light.shadow.map.depthTexture` **while the TSL graph is being built**. The
stage's own availability check knows this and refuses by name with a good message:

```
light 'sun' has no shadow map yet: set renderer.shadowMap.enabled on the raw renderer
(ctx.renderer.raw), and build the chain after the first frame has rendered
```

The trouble is the second half of that instruction and where the generated scene puts the call.
`castShadow = true` is a request, not a result — three allocates the shadow map on the first
render that needs it — and the scaffolded `Valley.enter()` calls `setupForestLighting()` and
`setupPost()` on consecutive lines, before a single frame has been drawn. So on a freshly
generated project the stage is *structurally* unreachable: every run reports godrays as
unavailable, on a build where nothing is wrong and the light is correctly configured.

Worked around inside `setupPost`, whose signature the scene owns and whose body it does not: when
the resolved tier asks for godrays, the chain is not installed in that call but on the first frame
where `sun.shadow.map` is non-null, bounded at 240 frames, and it prints `TN_POST_DEFERRED
frames=N shadowMap=true|false` either way. Running out of budget is not an error — the chain goes
in without godrays and `TN_WORLD_ENVIRONMENT` still says why.

This is the right fix for this game but it is the kind of thing every game will have to rediscover
by reading a refusal reason and working out that "after the first frame" means restructuring the
call. Two things would remove it: `setupPost` in the shipped template could carry this deferral
already, or `GodraysNode` could take the light and resolve its shadow map lazily at execute time
rather than at build time.

### And a live trap next to it: the MRT list does not know about godrays

In generated `worldEnvironment.ts` the multi-render-target attachments are set for
`ssgi || ssr || gtao`. But the godrays stage runs its result through the same bilateral denoiser
as the GI gather, and that denoiser asks the pass for `normal` — so a tier that enables godrays
and denoising *without* any of those three asks a non-MRT pass for `getTextureNode("normal")`,
which is the exact failure this file's own comments warn about: WebGPU refuses the pipeline, the
frame goes black, and the chain still reports every stage as applied. A phone tier with shafts and
nothing else — a completely reasonable thing to configure — walks straight into it.

Fixed here by adding `(godraysEnabled && denoiseEnabled)` to that condition. Worth fixing in the
template, since the whole point of that file is that a silent no-op is never mistaken for a
setting.

## 9. The node-material cache-key cost is real, small, and not graph-driven — measured, then dropped

Two Chrome traces of live sessions agreed that `getMaterialCacheKey`, `_getNodeChildren`,
`getCacheKey` and `getRenderCacheKey` were the largest identifiable block of game-attributable
CPU — 7.2% of sampled CPU in the first trace, 4.1% in the second. Three.js re-deriving node-material
cache keys by walking TSL graphs, across 73 instanced meshes that each carry a wind shader. The
obvious inference is that the graphs are too big, and the obvious fix is to shrink them.

**That inference is wrong, and the experiment says so.** Removing `applyWind` entirely — the whole
~33-node wind subgraph, from all 73 materials — moved the node-key share of busy CPU from **6.59%
to 6.74%**. No change. What it did move was total busy CPU, 5156 ms to 4445 ms over an identical
18 s window: the graph costs about 14% of the game's CPU to *evaluate*, and nothing measurable to
*walk*.

So the cost scales with the number of objects and materials being walked, not with the size of
each graph. Shrinking shaders would have bought nothing, and it was worth an hour to find that out
before spending a day on it.

Two reasons it was then dropped rather than pursued:

1. **It is smaller than it first reads.** The 7.2% was a share of sampled CPU *including idle*, and
   the main thread is 47% idle. Against busy CPU it is 6.6%, and against wall clock about 1.9%.
2. **The lever that would move it is not in game space.** Fewer distinct materials means atlasing
   the pack's per-species maps so sections can share a material with a per-instance UV offset —
   an asset-pipeline change — or three caching keys it currently recomputes. Neither is a foliage
   edit.

Recorded so the next session reads the ablation instead of repeating the inference. Measured with
`tools/trace.mjs` on the private virtual display: a CPU-share A/B is valid there, an fps number is
not.

## 10. My audio inspector reported a defect that was itself — the correction

Entry 9's neighbour in this session's record was a claim I made and then had to withdraw, so it is
written here rather than left in a commit message where nobody re-reads it.

I reported that `forest-birds.ogg` clicked at its loop point — seam step **0.1098**, against
`forest-bed.ogg` at 0.0346 and `lake-shore.ogg` at 0.0025 — and used it as evidence that the
hand-rolled conditioning script had silently failed on one clip. I briefed a second agent to build
a throwing seam assertion in the asset pipeline on the strength of it.

**The click was not real.** It was my own instrument. `tools/audio-look.py` decodes at 22,050 Hz,
and a resampler is an FIR filter whose window runs off the end of the data and is zero-padded — so
the first and last output samples are the only wrong ones in the file, and a seam test reads
exactly those two. Measured at the file's native 44.1 kHz, and against the step distribution
either side of the join rather than absolutely:

```
clip               bare wrap   99th-pct step within 50 ms of the join   ratio
forest-bed.ogg      0.016142                 0.041870                   0.39x
forest-birds.ogg    0.066752                 0.298793                   0.22x
lake-shore.ogg      0.000648                 0.005415                   0.12x
```

`forest-birds` has the *second best* join in the set. The cross-fade had taken — the pre-encode PCM
and the decoded Ogg agree to a rounding.

Two things worth keeping from being wrong:

1. **Absolute seam steps are not comparable between clips**, and a gate built on one fires on good
   audio. The measure has to be the wrap step against its own neighbourhood, and the limit has to
   be above 1.0, because a perfectly continuous loop measures exactly 1.0 against itself and a 1.0
   limit fails it on float error.
2. **Never resample before measuring.** The instrument has to read the file at the rate the file is
   in. This is the second time today a measurement lane produced a confident wrong answer from a
   convenience in the harness rather than a fault in the thing measured — the first was reading an
   fps off a virtual display, where the present wait lands in the engine's `update` phase and
   reads as game CPU.

The hand pass *did* have a real gap, and naming it precisely matters more than the click I
invented: **it measured nothing about content.** It never noticed the discovery chime was 83% in
100-500 Hz where a bell should be bright, and never noticed that footsteps were carrying enough
sub-bass to thump. A seam check alone would have caught neither. That is what
`audio.expect.json` and the pipeline pass exist to make impossible between them.

**A correction to the footstep figure, since it appeared here and in two commit messages before it
was checked.** I wrote "fifteen footsteps carried up to 45.2% of their energy below 100 Hz". The
`up to` was true of the worst clip; the `fifteen` was not. Measured independently by the asset
pipeline lane against the same files, with the band arithmetic reconciled between both tools:
**three** clips exceeded a 15% sub-bass bound — `step-rock-3` at 42.5%, `step-rock-1` at 24.3%,
`step-rock-2` at 15.5%, with `step-grass-1` next at 12.8%. All fifteen were high-passed, because
filtering the set is cheaper than filtering three and then arguing about the boundary, but only
three were defective. The defect class was real and the count was not, and a count nobody checked
is exactly the kind of figure that gets repeated.

`tools/audio-look.py` is superseded by `threenative-playtest audio`, which enforces both rules
above. It stays only until nothing references it.

## 11. A startup budget copied from the schema's example, and one measured against a dev server

Two startup ceilings failed today, neither of them a regression: both were committed in a state
that had never once been green, and both were measuring something other than the game.

`playtests/startup.playtest.json` asked for `maxReadyMs: 8000`. That number is the literal value
in the engine's own `assertion-schema.ts` example for the field. It arrived by being copied out of
the documentation rather than by anybody measuring this wood, which is the failure mode a
worked example invites: it reads as a recommended ceiling when it is only a syntactically valid
one. A budget nobody has measured is a budget that fails on the day the feature it guards starts
working.

Because it did start working. `readyMs` is now 13.7-14.3 s, and it is *supposed* to have grown:
readiness used to resolve before the detail tier, so the small number it reported described a
moment when the screen showed a treeless valley — the exact frame the owner sent back with "look
at this shit". Holding readiness until the wood is complete and compiled is the fix for that, and
the honest cost of the fix is that the number it reports is three times larger and now true. It
decomposes as 2.3 s critical tier, 6.9 s detail tier, 5.1 s held warm-up (176 pipelines, and
capped by its own budget rather than finished). `maxEnteredMs` is the ceiling that still guards
what a player feels — time to *something* on screen, ~1.0 s against 2.5 s — and it is the one that
should stay tight.

The replacement ceiling is 18 s rather than the 16 s I first wrote, and the reason is worth
stating because it is the opposite instinct to the one this repo usually rewards. Seven runs
spread 13.7-14.9 s, so 16 s left 7% headroom on a figure whose largest single term is a warm-up
that stops on *its own* budget rather than on finishing — the variance is the machine's, not the
game's. A composite of three tiers is the wrong place to be strict. The strict gates are the
attributable ones on either side of it: `maxEnteredMs` at 2.5 s against a measured 1.0 s, and the
detail tier's 8 s against a measured 6.9 s, both of which name a tier somebody can go and fix. A
gate that goes red under load teaches people to re-run it, which costs more than the regression it
was meant to catch.

The second ceiling, the detail tier's own 8 s, was measured against `vite dev`. Dev hands every
GLB, OGG and HDR over as its own unbundled request through one middleware chain, so it queues
thirty-five large binaries: the same content and the same build measure 6.9 s on `vite preview`
and past 25 s on dev, and the four scenarios were separately timing out in `page.goto` for the
same reason. The gate now runs against the built bundle — the artifact a player downloads — and
the budget is advisory rather than fatal when someone points it at dev, naming why in the message
instead of printing a number that no game change can move.

The two debug pages keep a dev server of their own, because they are not build inputs and should
not become ones: `dev-animals.html` measures placement and facing, so it can afford slow serving,
and a player's download should not carry a debug entry point to make a proof convenient.
