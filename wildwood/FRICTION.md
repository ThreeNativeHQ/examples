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
