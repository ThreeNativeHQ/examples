# Bayview asset manifest

Every asset shipped under `public/`, what it is for, its physical world size, its maps,
and the colour space each map must be loaded in. Written for whoever is editing
`src/render/townMaterials.ts` — the tiling column is the point of this document.

Licences and attribution live in `CREDITS.md`, not here.

## Read this first: the two rules that decide whether the map looks right

**1. Colour space.** Under `WebGPURenderer` a normal or roughness map loaded as sRGB is
wrong in a way that reads as "the lighting is off", not as "the texture is broken".

| Map role | `texture.colorSpace` |
| --- | --- |
| colour / albedo / base colour | `THREE.SRGBColorSpace` |
| normal, roughness, metalness, AO, displacement | `THREE.NoColorSpace` (linear) |

`ctx.assets.texture()` does not know which is which. Set it explicitly per texture.

**2. World-space tiling.** Every repeat below is expressed as *metres of world surface per
one UV repeat*. For a wall `w` metres wide and `h` metres tall:

```ts
tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
tex.repeat.set(w / tileMetresU, h / tileMetresV);
```

Two textures with different `tileMetres` on adjacent surfaces is the single most common
cause of a scene that looks like a test harness. Use the numbers in the table, not `(4, 4)`.

**Non-square textures matter.** `bayview-paving` is a 2:1 image covering a 2:1 patch of
ground. Give it a 2:1 repeat ratio or the cobbles come out as ellipses. All other sets here
are square.

## Materials

| Path (under `public/assets/`) | Used for | Tile size, world metres (U × V) | Maps present | Pixels |
| --- | --- | --- | --- | --- |
| `bayview-whitewash.jpg` `-normal.jpg` `-rough.jpg` | **Primary building walls.** Weathered off-white plaster with grey-green staining and paint loss — the dominant surface in every reference frame. | **2.0 × 2.0** *(estimated, see notes)* | colour, normal (GL), roughness | 1024² |
| `bayview-peeling.jpg` `-normal.jpg` `-rough.jpg` | **Plaster peeling over brick.** Buildings the design doc marks as exposed-brick finish; also good for the lower 2 m of walls anywhere. | **0.8 × 0.8** *(measured, see notes)* | colour, normal (GL), roughness | 1024² |
| `bayview-concrete.jpg` `-normal.jpg` `-rough.jpg` | **Parapets, quay wall, kerbs, stair cheeks, plinths.** Smooth pale cast concrete — deliberately flatter than the plaster so trim reads as a different material. | **2.4 × 2.4** *(provider-stated)* | colour, normal (GL), roughness | 1024² |
| `bayview-paving.jpg` `-normal.jpg` `-rough.jpg` | **Ground.** Fan-pattern granite setts for streets, mid, plazas, promenade. | **1.8 × 0.9** *(estimated; keep the 2:1 ratio)* | colour, normal (GL), roughness | 1024×512 |
| `bayview-quaystone.jpg` `-normal.jpg` `-rough.jpg` | **Quay wall, seawall, lower-storey rubble walls.** Coursed rough-cut beige stone blocks with deep mortar joints. | **2.0 × 1.0** *(provider-stated and confirmed by measurement)* | colour, normal (GL), roughness | 1024×512 |
| `bayview-flagstone.jpg` `-normal.jpg` `-rough.jpg` `-ao.jpg` | **Ground** — worn medieval paving flags with mossy joints. Added by the `textures` agent; a closer match to the hero frame's B-site ground than the fan-pattern setts, which suit the streets and mid. | **1.85 × 1.85** *(provider-stated; verified against `ambientcg_get_asset("Tiles098")`)* | colour, normal (GL), roughness, AO | 1024² |
| `bayview-steel.jpg` `-normal.jpg` `-rough.jpg` `-metal.jpg` | **Blue corrugated roller and garage doors.** Colour map is flat blue paint with rivets; the corrugation lives entirely in the normal map, so this set is unusable without it. | **1.0 × 1.0** *(estimated; puts the corrugation pitch near 10 cm)* | colour, normal (GL), roughness, **metalness** | 512² |
| `bayview-wood.jpg` `-normal.jpg` | **Crates, pier decking, catwalk planks, balcony rails, shutters.** Weathered untreated planks. | **1.0 × 1.0** *(provider-stated)* | colour, normal (GL) — **no roughness** | 1024² |
| `bayview-brick.jpg` | Pure exposed brick. Photo-derived, **no normal or roughness map**; prefer `bayview-peeling` where the peel reads. | not stated | colour only | 1254² |
| `bayview-plaster.jpg` | Original photo-derived plaster. Superseded by `bayview-whitewash` for anything lit; **no normal or roughness map**. | not stated | colour only | 1254² |
| `bayview-sky.jpg` | Sky dome / environment. Equirectangular. | n/a — map as equirect | colour only | 3072×1536 |
| `sky.jpg` | Older sky, currently the one `Play.ts` actually loads. Superseded by `bayview-sky.jpg`. | n/a | colour only | 2048×1024 |
| `bayview-floor.png` | Current ground texture. Being replaced by the paving set. Unknown provenance, 3.5 MB — the largest single texture in the build. **Delete once the paving set is wired in.** | unknown | colour only | 1717×916 |

`-metal.jpg` is a **metalness** map — bind it to `material.metalnessMap` and set
`material.metalness = 1`, otherwise the map is ignored.

### Where the tile numbers come from

Be honest about which of these are provider facts and which are mine:

- **`bayview-concrete` — 2.4 m: provider-stated.** `ambientcg_get_asset("Concrete046")`
  returns `"dimensions":{"width":240,"height":240}`, i.e. centimetres.
- **`bayview-wood` — 1.0 m: provider-stated.** `polyhaven_get_asset("brown_planks_03")`
  returns `"dimensions":[1000,1000]` (millimetres).
- **`bayview-peeling` — 0.8 m: measured, and the number I trust most.** ambientCG states no
  dimensions for `PaintedPlaster016`. The normal map shows exactly **10 brick courses per
  tile height**. A standard course (65 mm brick + 10 mm mortar) is 75 mm; a chunkier one is
  85 mm. Ten courses is therefore 0.75–0.85 m. The texture is square, so 0.8 × 0.8.
- **`bayview-quaystone` — 2.0 × 1.0 m: provider-stated *and* independently confirmed.**
  `ambientcg_get_asset("Bricks075A")` returns `"dimensions":{"width":200,"height":100}` and
  the shipped maps are 2:1, so the metadata and the image agree. Measuring across the tile
  gives about 7 blocks per 2 m, i.e. ~28 cm stones — correct for rubble masonry. This is the
  most trustworthy number in the table, and it is the one that proves ambientCG's
  `dimensions` field means physical centimetres and that the map aspect follows it.
- **`bayview-paving` — 1.8 × 0.9 m: estimated, and the ratio matters more than the value.**
  ambientCG reports `"dimensions":{"width":90,"height":90}` for `PavingStones150`, but the
  maps it ships are 2:1, so that square figure cannot be right as stated. Given that
  `Bricks075A` above shows the field *is* physical centimetres with the aspect respected, the
  likeliest reading is that 90 is the **height** and the width is 180. That also produces
  believable stones: about 30 setts across the width, so 1.8 m / 30 ≈ 6 cm — right for small
  mosaic setts, whereas a 90 cm width would imply 3 cm setts, which is not a thing. The setts
  are undistorted at the shipped 2:1 aspect (verified by tiling it both ways and comparing the
  fan arcs). **Never give this texture a 1:1 repeat ratio.**
- **`bayview-whitewash` — 2.0 m: estimated.** ambientCG states no dimensions for
  `Plaster007`. It is a featureless plaster scan with no object of known size in it, so
  there is nothing to measure against; 2 m is a plausible wall-scan size and a sane
  starting point. Adjust by eye — this is the one number in the table worth tuning in
  engine rather than trusting.
- **`bayview-steel` — 1.0 m: estimated.** ambientCG states no dimensions for
  `CorrugatedSteel007A`. Chosen so the corrugation pitch lands near the real-world 8–10 cm.
- **`bayview-brick` / `bayview-plaster` / `bayview-floor`** are photo-derived or of unknown
  provenance. No physical size exists for them at all; anything you pick is arbitrary.

## Models

| Path | Used for | Real-world size | Notes |
| --- | --- | --- | --- |
| `assets/bayview-barrel.glb` | **Oil drums** beside crate clusters, on the dock, at mid and B. Weathered blue painted steel with rust — matches the drums in the MID and B SITE reference frames. | 0.63 m diameter × 0.93 m tall (a real 200 L drum) | 1473 triangles, one mesh. Already metre-scaled: load and place, do not rescale. |
| `assets/bayview-gutter.glb` | **Declined by the `facade` agent — deletion candidate, 652 KB.** Was intended for facade downspouts. | gutter runs ~2.3 m; downspout ~1.8 m | 16490 triangles across 12 meshes. **The decline is correct:** the whole town facade batch is ~134k triangles and a downpipe appears on ~60 wall faces, so even instancing only the downspout would put one detail in the same order as everything else combined. The hand-built version is 5 primitives and reads correctly at the 3 m+ a player ever sees it from. Keep only if someone wants the real kit badly enough to load it in `Play.ts` and thread it through `buildTown(materials)`, which is currently synchronous. |
| `assets/bayview-walllamp.glb` | **Wall lamps over doorways** — the CONNECTOR and CATWALK frames both have one. Rusted caged bulkhead lamp with frosted ribbed glass; the standard fitting on real harbour buildings. | 0.27 × 0.43 × 0.14 m | 4446 triangles, 2 meshes, 2 materials (body + glass). **Carries an emissive map** — set `material.emissiveIntensity` and add a small warm `PointLight` at the glass to make it actually light the wall. |
| `assets/bayview-buoy.glb` | **Optional** channel-marker buoy for the open water east of the quay. Weathered red steel with cage light, bell and ring guard. Not in the reference frames — see the note below before placing it. | 1.07 × 2.66 × 0.95 m | 12240 triangles. **Carries an emissive map** on the lamp cage. |
| `assets/enemy-terrorist.glb` | Enemy soldiers | — | Rigged. **Clone with `SkeletonUtils.clone()`, never `.clone(true)`.** |
| `assets/player-viewmodel.glb` | First-person arms | — | Rigged; same cloning rule. |
| `assets/weapon-ak47.glb` | Weapon | — | 11.7 MB, the largest asset in the build. |

Both Poly Haven models were repacked from their shipped `.gltf` + `.bin` + loose textures
into **single self-contained `.glb` files** — one request each, no relative-path fragility,
and a `bayview-*` name so `.gitignore` tracks them. Both were verified by parsing them with
the project's own `GLTFLoader`, not just by inspecting bytes.

Their `arm` texture is an ARM pack (R=AO, G=roughness, B=metalness) already wired up as the
glTF `metallicRoughnessTexture`. `GLTFLoader` handles it; do not rebuild the material by hand
unless you want to change it.

**On the buoy.** It is the only fetchable object that puts anything in the empty water east
of the quay, because no small boat exists in any reachable source. It is **not a substitute
for the boat** and it is not in any reference frame — a channel marker is ordinary harbour
furniture and would not look out of place in a Mediterranean port, but placing it is a
judgement call about adding something the reference does not show. Shipped so the option
exists; delete it if the answer is no. Suggested position if yes: east of the pier head
around `x ≈ 48, z ≈ -6`, outside the playable deck so it never affects traversal, with a
slow `Math.sin` bob and a small roll on the `update` loop.

**Poly Haven models are metre-scaled and their bounds were verified**, not assumed — each was
parsed with the project's own `GLTFLoader` and measured with `Box3`. Every size in the table
above is a measured bound that matches Poly Haven's published dimensions. Load and place; do
not rescale.

## Audio

Nothing in `src/` loads any audio yet — `public/pickup.ogg` is unused starter residue. These
six files are the starting kit. All are mono, 48 kHz, Vorbis.

| Path | Intended cue | Length |
| --- | --- | --- |
| `audio/hit-impact.ogg` | Bullet hitting a body — pair with the hitmarker | 0.55 s |
| `audio/bullet-whizz.ogg` | Round passing close to the player | 1.05 s |
| `audio/ui-click.ogg` | Menu and HUD interaction | 0.10 s |
| `audio/round-complete.ogg` | Run completed (11 hits) | 0.29 s |
| `audio/round-failed.ogg` | Health 0 or timeout | 0.50 s |
| `audio/clock-tick.ogg` | Round clock under 10 s | 0.02 s — a sharp blip, not a "tock" |

**There is no rifle shot, no footstep and no harbour ambience, and they are not obtainable
from the catalogued sources.** See the gaps section below before going looking.

## Known gaps

Things the references show that no shipped asset covers. Each is a deliberate decision, not
an oversight.

| Gap | Why there is no asset for it |
| --- | --- |
| **Rifle shot, shell casing, footsteps on stone, gull/harbour ambience** | The audio catalogue has six packs total: one Kenney UI pack and five Sonniss GDC bundle parts. The Kenney pack is interface sounds only. Sonniss part 1 (1.3 GB, inspected in full) is a 344 Audio sampler — dinosaurs, anime voices, barbershop, casino, antique typewriters — with no firearm, footstep, bird or water content whatsoever. The remaining parts are 1.3 GB each with no way to inspect before downloading. These four cues need a different source or synthesis. |
| **Sea water surface** | ambientCG's water results are all frozen lakes (`Ice001–004`) and stain decals. Poly Haven has no water textures. The sea is the whole eastern horizon, so it matters — but it wants an animated normal-scrolling shader in `src/render/`, not a fetched texture. |
| **Yellow delivery van (T MAIN)** | Searched `van`, `truck`, `car`, `vehicle`. Poly Haven's entire road-vehicle catalogue is one car **under a dust cover**, plus loose tyres and wheel rims. There is no van, and a shrouded car reads as an abandoned garage, not a working street. Build it. |
| **Small fishing boat (B pier)** | Searched `boat`, `rowboat`, `fishing`, `watercraft`, `dock`. Poly Haven's entire Watercraft category is **four colonial sailing ships** (pinnace, three Dutch ships) and three buoys. A pirate galleon at a modern industrial pier would be far worse than an empty berth. Build it — a hull is a lofted shape, not a detailed prop, and it sits at 20+ m where silhouette is all that reads. |
| **Stencilled crate markings** | The crates themselves are `bayview-wood` on rounded boxes, which is right. The black stencil lettering is map identity and belongs in `src/render/`. Poly Haven's crates are colonial rope-handled chests, the wrong silhouette. |
| **Palm trees** | **No CC0 palm exists in any catalogued source.** Poly Haven's tree library is broadleaf, coniferous, coastal and desert only — Burkea africana, jacaranda, fir, pine, quiver tree; a search for "palm" returns a pair of *garden gloves*. ambientCG has exactly one tree model, a stump. Even the near-misses are unusable at 0.3–17 **million** triangles each. Write the geometry. |
| **Satellite dishes, rooftop AC condensers** | Neither exists at Poly Haven (`satellite` and `conditioner` return nothing; `antenna` returns a boombox and a WW2 field radio; `dish` returns a Victorian tea set and a carrot cake). Not on ambientCG either — **its entire 3D model catalogue is 34 items and they are all fruit, bread, pastries, a stick and a tree stump.** Both props are a dish/box plus a bracket. Primitives, instanced. |
| **Quay bollards and mooring cleats** | `bollard` and `mooring` both return zero at Poly Haven. A bollard is a capped cylinder with a collar — genuinely faster to write than to load. |
| **A rifle-carry run cycle for the enemy rig** | The only animation sources in the catalogue are Quaternius Universal Animation Library 1 and 2. Between them they hold **no rifle clips of any kind** — the weapon animations are pistol and sword. Their only runs (`Jog_Fwd_Loop`, `Sprint_Loop`) are free-arm. And they are built on the **Unreal mannequin skeleton** (`pelvis`, `spine_01`, `clavicle_l`, `upperarm_l`), while `enemy-terrorist.glb` is **Mixamo** (`mixamorigHips_01`, `mixamorigSpine_02`) — zero name overlap, and the two conventions differ in rest orientation as well as naming, so this is hand-authored retargeting, not a remap table. **Resolved as an accepted limitation, not a bug:** `CHASE_SPEED` stays at 3.6 m/s, so `RifleWalk` plays at 2.75×. That is inside the animation clamp and `strideErrorRatio` reads 1.000, so there is no foot slip — it reads as a very fast march rather than a run. Lowering the speed would shift how long a soldier takes to cross the map, and `enemy-reaches-walkway`, `walkway-reachable` and `enemy-foot-contact` are timed in ticks against exactly that travel time; retuning combat speed to fix a playback-rate cosmetic is not worth risking passing behavioural gates. A synthetic run built by amplifying the walk clip is also ruled out: it would push the feet outside the per-bone skin envelope calibrated in the bind pose and reopen the grounding bug that was just fixed. |
| **Overhead cable runs** | `modular_electricity_poles` exists but is American-style timber poles with transformers and crossarms; the reference shows thin cables on small wall brackets between buildings. Force-fitting it would look wrong. Catenary curves in code. |
| **Canvas awnings, water tanks, painted site markers** | Bespoke or trivially primitive. `src/render/town.ts` already builds them. |

## Housekeeping

**`.gitignore` tracks `public/assets/bayview-*.{jpg,png,glb}` and nothing else under
`public/assets/`.** Verified with `git ls-files --others --exclude-standard`: all 27
`bayview-*` files and all six files in `public/audio/` are committable.

**Name every asset you add `bayview-*`** or git will silently ignore it. That is the whole
rule. (Checking this with `git check-ignore -v` is misleading — it prints negation matches
too, and a `!` pattern in its output means the file is *not* ignored. Use
`git ls-files --others --exclude-standard` instead.)

**One live problem: `assets/sky.jpg` is ignored, and `Play.ts:74` loads it.** A fresh clone
would build a game whose sky texture is missing. The fix is to switch that load to
`assets/bayview-sky.jpg`, which is tracked, higher resolution (3072×1536 vs 2048×1024) and
CC0-credited. Also currently ignored but harmless because nothing references them:
`range-target-face.png`, `range-target-face-hit.png`, `ue-test-surface.jpg`.

### Ship-weight audit

Every file under `public/` cross-checked against what `src/` actually requests. `public/` is
38.70 MB; **7.32 MB of it (19%) is dead weight.**

| Group | Size | Verdict |
| --- | --- | --- |
| `bayview-floor.png`, `bayview-plaster.jpg`, `sky.jpg` | 4.23 MB | **Superseded — delete.** Replaced by the flagstone, whitewash and `bayview-sky` sets, none of them referenced anywhere. |
| `range-target-face.png`, `-hit.png`, `ue-test-surface.jpg` | 0.80 MB | **Dead — delete.** Leftovers from the deleted range scene; no references anywhere in the repo. |
| `bayview-peeling` ×3, `bayview-paving` ×3, `bayview-steel-metal.jpg` | 2.28 MB | **Sourced but never wired — decide.** See below; two of these are worth wiring rather than deleting. |
| `pickup.ogg`, `native-proof.glb`, `native-proof.png` | 4.7 KB | Starter scaffold, used only by the separate `inspect/` project. Negligible either way. |

Not dead, but not yet loaded: the four `bayview-*.glb` props and the six `audio/*.ogg` files
(2.36 MB) are shipped deliberately and await placement in `town.ts` and audio wiring.

Unreferenced from `src/` and safe to delete once nothing wants them:
`assets/ue-test-surface.jpg`, `assets/range-target-face.png`,
`assets/range-target-face-hit.png`, `pickup.ogg`, `native-proof.glb`, `native-proof.png` —
together about 1.0 MB. `assets/sky.jpg` joins them the moment `Play.ts` switches to
`bayview-sky.jpg`.

`assets/bayview-floor.png` is the big one: 3.5 MB, unknown provenance, still referenced at
`Play.ts:78` and `townMaterials.ts:168`. It is **owned by the `textures` agent** — it should
be deleted by whoever switches the ground over to the paving set, not before.
