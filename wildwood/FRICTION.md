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
