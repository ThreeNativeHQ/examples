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
