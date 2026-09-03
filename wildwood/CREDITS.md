# Credits and assets — wildwood

## Landscape Pro 2.0, by STF3d

The valley's ground layers, pine bark, fern and plant atlases come from **Landscape Pro 2.0
Auto-Generated Material** on Fab, listing `1ac647da-b1bc-4e72-a56d-60aaeb6918e1`.

**These files are not in this repository, and must not be.** This remote is public and the Fab
Standard License does not permit redistributing a pack's assets as standalone files. What is
committed is the importer; the assets are regenerated locally by whoever owns the pack.

### Regenerating them

Needs a Fab account that owns the listing, and [`fabcli`](https://github.com/) signed in
(`fabcli auth status` should report a valid session).

```sh
fabcli download 1ac647da-b1bc-4e72-a56d-60aaeb6918e1 \
  --engine UE_4.27 --platform Windows --output ../.fab-source/landscape-pro-427

node tools/import-landscape-pro.mjs        # .uasset -> PNG, 37 textures
# then compress to the JPGs the game loads, into assets/landscape/
```

The conversion is done by `asset_import_unreal` from `threenative-asset-mcp` **0.7.0 or newer** —
0.4.0 has no Unreal importer at all, and the MCP must be restarted after upgrading for the tool to
appear.

### What imported, and what did not

**Textures: 37 of 37, zero failures.** Every ground layer, the bark, and the cut-out atlases.

**Meshes: none.** The pack's static meshes are uncooked UE4 object version **514**, and the
importer's engine-free MeshDescription reader is verified for 517–522 only:

```
ImportError: 18 uncooked static-mesh packages use UE4 object version 514.
```

Passing a later `--engine` does not help — Fab serves one artifact for every listed engine version
(4.24 and 4.27 are byte-identical at 3,225,681,826 bytes); the compatibility list is metadata, not
a re-cook. That was the state when this file was written; the importer has since been fixed and
**every mesh in the valley is now the pack's real geometry** — see the Landscape Pro section below
and `FRICTION.md` entry 5a.

## Everything else

`assets/native-proof.glb`, `assets/native-proof.png` and `assets/pickup.wav` ship with the
ThreeNative starter template.

## Landscape Pro 2.0 Auto-Generated Material — STF/sc3d.de

Fab listing `1ac647da-b1bc-4e72-a56d-60aaeb6918e1` (paid, Personal/Professional licence).
Ground layer textures, every tree, shrub, plant, rock, cliff and branch mesh in
`assets/fab/1ac647da-b1bc-4e72-a56d-60aaeb6918e1/` come from this pack, imported with
`asset_import_unreal` and served locally. **The imported pack binaries are gitignored — the
licence does not permit redistributing them through this public repository.** Rebuild them with
`tools/import-landscape-pro.mjs` after downloading the pack from Fab into `.fab-source/`.

## Vegetation packs attempted and not shipped

The valley's whole plant list is one pack, so the forest-density pass went looking on Fab for a
second. Five owned, on-theme listings were tried and none of them produced a single mesh, so **no
new asset ships and no new attribution is owed**. Recorded here so nobody spends the afternoon
finding out again — the errors and the diagnosis are in `FRICTION.md` entry 8.

| Listing | Fab id | Why it did not ship |
| --- | --- | --- |
| Temperate Vegetation: Fern Collection | `b778bd8f-524c-42b6-b60c-4caac59029c1` | 37 static meshes at UE4 object version 516; importer covers 517–522 |
| temperate Vegetation: optimized Grass Library | `8b68642e-35f4-438e-82b4-799fc2228303` | 110 meshes, version 516 |
| Procedural Nature Pack Vol.1 | `d3a29766-c848-40c5-ad3d-d609b80d224b` | 48 meshes, versions 413/451/498 |
| Paragon: Agora and Monolith Environment | `6f401fb5-88b5-41b4-bf1b-62321414e1f0` | 516 meshes, versions 434/516 |
| Common Hazel | `81bc7ba6-4686-4f94-9d2b-83eb1fdc4079` | Downloads and decodes (39 textures, 66 materials); all 30 static meshes fail with "the modern UE5 mesh converter produced no GLB" |

Selecting a later `--engine` does not change the artifact Fab serves — the Fern Collection reports
version 516 at both `UE_4.27` and `UE_5.4`. The engine compatibility list is metadata about what
the pack runs in, not a set of separately cooked downloads.
