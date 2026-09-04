# ue-static-import

One question, one answer: **does the ThreeNative Unreal importer take a real Fab pack's static
mesh all the way to pixels in a game built from current engine tarballs?**

Yes, for a static mesh. This project is the evidence.

## What was proved

`asset_import_unreal` read `Content/Office_Pack_Vol_1/Models/SM_Chair_1.uasset` out of a downloaded
Fab pack — with no Unreal Engine on the machine — and wrote
`assets/fab/office-chair/Models/SM_Chair_1.glb`. `src/scenes/Play.ts` loads it through the ordinary
`ctx.assets.model()` call; nothing in the game is Unreal-aware after the import.

`playtests/unreal-prop.playtest.json` is what makes that a fact rather than a screenshot. It runs
the real build on hardware WebGPU and asserts the chair's numbers:

| Assertion | Observed |
| --- | --- |
| `visibility.unreal-chair` projected pixels | 15710 (floor: 2000), `offscreenRatio` 0 |
| `materialCount` | 3 — `M_Plastic_2`, `M_Leather_1`, `M_Metal_3`, Unreal's own names |
| `triangles` | 8384 |
| `texturedMaps` | 9 distinct textures actually bound to material slots |
| `heightMetres` | 1.383 — Unreal centimetres arrived as ThreeNative metres |
| `groundClearance` | 0 — `GroundSnap` seats it on the floor with nothing to correct |

The control: every one of those assertions was run **before** the entity existed and every one went
red. The import is what turns them green.

## Reproducing the import

The pack is not in this repository; it is a Fab download. With the pack on disk, the whole import is
one MCP call:

```jsonc
// asset_import_unreal
{
  "sourceDir": "<downloaded Office Pack Vol.1>",
  "outputDir": "assets/fab/office-chair",
  "packages": ["SM_Chair_1"],
  "maxTextureSize": 1024
}
```

`assets/fab/office-chair/import-report.json` records what came back: source hash, toolchain
versions, and every material binding with the confidence the importer had in it.

## What the importer does and does not do

**Lossless, for this mesh.** Geometry (8384 triangles across 3 sections), the section-to-material
split, UVs, Unreal's material names, and the centimetre-to-metre conversion. Six of the nine texture
bindings resolved `exact` — read off the Unreal material graph, not guessed.

**Reconstructed, not read.** Three bindings are `heuristic`: glTF has one metallicRoughness texture
where Unreal has separate roughness and metalness maps, so the importer packs them
(`redToRoughness`, `redRoughnessRedMetalness`) by filename convention. It says so per binding rather
than presenting a guess as a fact.

**Dropped, and named.** Converting the whole pack instead of one mesh reports the rest honestly:
displacement and ambient-occlusion maps with no glTF PBR slot, 42 unsupported material inputs out of
106 sections, and two Blueprint packages that failed outright (`UE4 LegacyVersion: unsupported value
-8`). `.umap` levels do convert — 127 lights out of `DemoMap` — with Unreal's rectangular area
lights mapped onto `KHR_lights_punctual` points and their real dimensions kept in node extras.

**Refused.** A second Fab pack (Landscape Pro) fails closed with `UNREAL_SOURCE_UNSUPPORTED`: its
uncooked meshes are UE4 object version 514 and the engine-free path is verified for 517–522. It
declines to guess at the binary layout rather than inventing geometry.

## Running it

```sh
pnpm dev                # the game
pnpm build              # compiles assets/ into public/: 9.56 MB GLB -> 3.86 MB, PNG -> KTX2
pnpm typecheck
pnpm test               # every scenario, hardware WebGPU
```
