# Credits

- **Quaternius Universal Animation Library 1 and 2** — CC0. The mannequin and the walk, sit and
  driving clips the office plays. <https://quaternius.itch.io/universal-animation-library> and
  <https://quaternius.itch.io/universal-animation-library-2>. Fetched through the ThreeNative
  asset MCP (`asset_download_bundle_entry`) and trimmed to the eight clips this game uses by
  `tools/trim-clips.mjs`; the untrimmed downloads live in `tools/source-assets/` and are not
  committed.
- **Mixamo animation clips** (Typing, Sit To Type, Type To Sit, Texting While Standing, Walking
  While Texting, Opening/Using A Filing Cabinet, Using A Fax Machine, Sending Fax) — downloaded
  from <https://www.mixamo.com> by the project owner; the raw FBX files live in
  `tools/source-assets/mixamo/`, which is gitignored — Adobe's Mixamo terms permit use inside
  projects like this one but not standalone redistribution of the source files. They were
  retargeted off the Mixamo skeleton onto the Quaternius mannequin by `tools/retarget-mixamo.mjs`
  into `assets/worker-clips-3.glb`, which carries no Mixamo mesh, skin or texture.

- **Fujitsu FM Towns FMT-KB202A keyboard, top view** (`references/keyboard-top.jpg`) — public
  domain, by snuci. <https://commons.wikimedia.org/wiki/File:Fujitsu_FMT-KB202A_keyboard_top_view.JPG>.
  The sculpt reference for `src/render/keyboard.ts`: its row structure — function row, staggered
  alpha block with wide modifiers, spacebar row, right-hand cluster behind a gutter — is what the
  key table is laid out against. No pixels of it ship; the model is procedural Three.js.

Attribution is not required for CC0. It is here because knowing where a mannequin came from is
worth more than the licence obliges.

## Office furniture — Poly Haven (CC0)

All three are **CC0**, read off the `polyhaven_search_assets` and `polyhaven_list_files` results.
CC0 requires no attribution; they are listed because Poly Haven asks for a visible credit when its
API is used, and because knowing where a model came from is worth more than the licence obliges.
Downloaded at **1K** and packed from Poly Haven's `.gltf` + `.bin` + textures into one `.glb` each
by the `polyhaven_import_model` tool.

- **Vintage Wooden Drawer 01** — James Ray Cock. `assets/office/vintage_wooden_drawer_01.glb`.
  <https://polyhaven.com/a/vintage_wooden_drawer_01>
- **Modern Wooden Cabinet** — Patrik Pangerl. `assets/office/modern_wooden_cabinet.glb`.
  <https://polyhaven.com/a/modern_wooden_cabinet>
- **Modern Arm Chair 01** — Vibrant Nordic. `assets/office/modern_arm_chair_01.glb`.
  <https://polyhaven.com/a/modern_arm_chair_01>

Models powered by Poly Haven — <https://polyhaven.com>.

## Office Pack Vol.1 — Fab

- **Office Pack Vol.1** by Meik.W.Models — CC-BY, entitlement and licence read from the Fab listing
  by ThreeNative Asset MCP 0.7.0. Seventeen imported models build the workstations, banded columns,
  conference area, sofa lounge, reception counter, shelving, doors and lift bank.
  <https://www.fab.com/listings/ce136033-3265-46d3-ac4d-fdbd5c9d0462>
