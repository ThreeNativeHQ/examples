# Bug report — wildwood tree corruption, 2026-09-01

## Symptom (verified visually from screenshots)

1. Scattered detail-tier trees render as garbled blocky mesh clusters — dark mottled cubes,
   amber/orange glowing patches, some white/grey cubes; one large foreground plant renders with
   green/pink vertical stripe artifacts.
2. One distant pine renders correctly. Terrain, grass tufts, ferns, boulders, sky, clouds, water
   and HUD render correctly.
3. The failure is completely silent: zero console errors, zero page errors, zero failed requests
   in every broken run (playtest runner + custom capture, multiple runs).

## Verified facts

**Assets**
- F1. The corruption reproduces under three different asset generations served to the same WIP
  game code: (a) bake v8 `sharedImages`+UASTC (manifest 19:23), (b) bake under the reverted
  `models:"none"` config (manifest ~20:45, meshopt+quantize, embedded PNGs), (c) the pre-bake
  mixed state at 19:20. Same garble each time.
- F2. The pinned source GLBs in `assets/fab/…/Models/` were written 10:36:48 — before the last
  known-good screenshots (13:52). They have not been re-imported since.
- F3. The Unreal importer the game's import tool calls is the installed
  `sandbox/.mcp-tools/.../threenative-asset-mcp` snapshot v0.7.0, installed 13:49:46.
- F4. The engine packages the importer is built from (`packages/raw-unreal`, `packages/ueformat`)
  received commits today at 13:24, 14:15, 14:32, 14:41 and 17:00 — i.e. they were under active
  development across the good→bad boundary.
- F5. The committed `public/` contains no tree assets at all (only `basis/`, `icon.png`,
  `favicon.svg`, one hdri, `bake.receipt.json`). Every tree byte on disk is an untracked bake or
  import product.
- F15. **The source GLBs are meshopt-compressed.** A bare GLTFLoader refuses them with
  `setMeshoptDecoder must be called before loading compressed files`. The 13:52 import already
  shipped this way, so meshopt decoding has always been part of this game's load path.
- F16. **The source bytes decode to a healthy tree.** With `MeshoptDecoder` wired, an isolated
  bare-three.js render of `SM_pine-small01.glb` produces stage `ready`, 530 triangles, a
  green-dominant tree (9.8% of frame pixels green, 0.0% pink-garble signature). Capture:
  `/tmp/ww-treeprobe4-for-user.png`. X2 (broken sources) is dead.

**Engines / timelines**
- F6. Engine core tarballs in play: 08:38 (`335b01068fc6`, pinned by committed game), 13:56/14:23
  (water lane), 17:02 (`main-28b6d7a5ea64`, installed into the game at 17:03 and referenced by
  the WIP until ~21:20, when the other lane re-pinned to a fresh `e26a8af27221`). The user
  reports the last known-good engine was ~13:52.
- F7. (Corrected.) The broken scene is proven only on engines from the 17:02 build onward. The
  08:38 engine was never captured rendering the WIP game; the earlier claim that it "also served
  the broken scene" was an inference, not a measurement.
- F17. **Core's loader code is byte-identical between the last-good engine (335b01068fc6) and the
  first-bad engine (main-28b6d7a5ea64)** in the meshopt/decoder region (diff of the loader region
  in both `dist/index.js`: empty). The meshopt import, `setMeshoptDecoder` call and its
  surroundings did not change.
- F18. The game's three version is pinned `0.185.1` (patched) in both the committed and WIP
  `package.json` — the loader library did not change either.

**Code**
- F8. The uncommitted WIP is the only code delta between the last commit (8fa064b, 18:27) and the
  running broken game: `Valley.ts` (+858/−270: critical/detail loading tiers, manifest
  resolution, `resolveServedUrl`), `loading.ts` (loading screen), `spawnWildwoodAnimals.ts`,
  `measure-startup.mjs`, and the (now reverted, backup at `/tmp/wildwood-config-wip-backup.ts`)
  `threenative.config.ts` asset block. `foliage.ts` — which builds the instanced scatter and
  runs `retextureSpecies` — is committed and unchanged since 09:39.
- F9. Only the critical tree takes a different code path than the scatter (single mesh vs
  instanced + `retextureSpecies`). The symptom's clean-vs-garbled split follows that same line.
- F10. The manifest resolution layer itself is sound: 165 entries, every entry present on disk
  after a completed bake; the engine writes the manifest before its delete phase; receipts
  report 0 errors.
- F11. The bake was left interrupted at least once (files written 19:23:58, manifest stale at
  19:23:44, one tracked HDRI hash deleted). That produced mixed-generation serving windows but
  is healed by any completed bake.
- F19. The WIP `FLORA` species table and `FAB` path constants are unchanged from the committed
  Valley (`git diff` on those lines: empty). The same species files are loaded in both eras.

**My verification failures (so nobody re-trusts them)**
- F12. The commit-by-commit arms A/B/C photographed the engine loading screen (247 unique
  colours, 99.4% dark pixels) because the old game code never sets the new engine's
  `__TN_STARTUP_READY__` flag. All "clean" verdicts from those arms are void.
- F13. The old-game worktree reproduction (`093c93d`, complete raw assets incl. animal pack,
  own pinned engine) hangs on the loading screen with no console output, no page errors, no
  failed requests, and all probed asset URLs return HTTP 200. Undiagnosed. It blocks the
  commit-bisect path.
- F14. (Superseded.) The first probe page died on bare-specifier imports in a verbatim-served
  `public/` file and photographed its own CSS background (solid whitish-purple). Two probe
  rebuilds later the page self-reports stage/triangle-count, which is what F16 is based on.

## Current state of the working tree

- One fresh vite serves `sandbox/wildwood` on 5173. Stale servers on 5199, 5274 and the old 5173
  were killed.
- `threenative.config.ts` and tracked `public/` files are restored to HEAD; the WIP config is
  backed up at `/tmp/wildwood-config-wip-backup.ts`.
- The manifest-referenced tree GLBs are currently overwritten with pristine source bytes
  (baked originals backed up at `/tmp/baked-backup/`). The game has not been re-captured in this
  state.

## Where the search stands

X2 (broken sources) is dead — see F16. X1 splits further, because F17/F18/F19 removed the
engine-loader, three-version and species-table explanations. The remaining candidates:

- Y1. **The bake output is the poison.** Every broken view served *baked* GLBs; the one proven
  healthy render (F16) served the *raw source*. The bake re-compresses every tree with meshopt
  and quantizes its attributes, and the bake logs repeat
  `quantize: Skipping TEXCOORD_0; out of [0,1] range` on the leaf atlases — the exact attribute
  whose corruption renders as green/pink stripes. Untested: decode a baked GLB and compare its
  vertex data against the source numerically.
- Y2. **The WIP `Valley.ts` restructure garbles the scatter at the scene-graph/material level**
  (not bytes) — still possible; all byte-level probes pass.

## Next action

Decode `SM_pine-small01` source vs its baked output (`/tmp/baked-backup/SM_pine-small01.17a44382.glb`)
in node and diff positions/UVs beyond quantization tolerance. Garbled bake → the bug is the
bake's quantize/meshopt pass in `packages/assets` (fix + red test there). Numerically identical
bake → Y2, and the fix lands in `Valley.ts`.
