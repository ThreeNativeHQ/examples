# CREDITS

Third-party assets bundled with this project.

Every licence below was read off an asset-MCP tool result (`ambientcg_get_asset`,
`polyhaven_get_asset`, `ambientcg_list_files`, `polyhaven_list_files`,
`audio_search_assets`) or off a `License.txt` / `Readme.txt` shipped inside the
downloaded archive. Nothing here is stated from memory.

**Poly Haven requires a visible Poly Haven credit when its API is used.** This project
used the Poly Haven API, so a "Textures and models from Poly Haven (polyhaven.com)"
line must appear somewhere a player can reach it — a credits screen or the README.

## Materials and textures

| File(s) | Source | Licence | Origin URL |
| --- | --- | --- | --- |
| `public/assets/bayview-whitewash.jpg`, `-normal.jpg`, `-rough.jpg` | ambientCG — "Plaster 007" (`Plaster007`), 1K JPG, photogrammetry | CC0 (`"license":"CC0"` from `ambientcg_get_asset` and `ambientcg_list_files`) | <https://ambientcg.com/a/Plaster007> |
| `public/assets/bayview-peeling.jpg`, `-normal.jpg`, `-rough.jpg` | ambientCG — "Painted Plaster 016" (`PaintedPlaster016`), 1K JPG | CC0 (`"license":"CC0"` from `ambientcg_list_files`) | <https://ambientcg.com/a/PaintedPlaster016> |
| `public/assets/bayview-concrete.jpg`, `-normal.jpg`, `-rough.jpg` | ambientCG — "Concrete 046" (`Concrete046`), 1K JPG | CC0 (`"license":"CC0"` from `ambientcg_list_files`) | <https://ambientcg.com/a/Concrete046> |
| `public/assets/bayview-paving.jpg`, `-normal.jpg`, `-rough.jpg` | ambientCG — "Paving Stones 150" (`PavingStones150`), 1K JPG, photogrammetry | CC0 (`"license":"CC0"` from `ambientcg_get_asset`) | <https://ambientcg.com/a/PavingStones150> |
| `public/assets/bayview-steel.jpg`, `-normal.jpg`, `-rough.jpg`, `-metal.jpg` | ambientCG — "Corrugated Steel 007 A" (`CorrugatedSteel007A`), 1K JPG | CC0 (`"license":"CC0"` from `ambientcg_get_asset`) | <https://ambientcg.com/a/CorrugatedSteel007A> |
| `public/assets/bayview-flagstone.jpg`, `-normal.jpg`, `-rough.jpg`, `-ao.jpg` | ambientCG — "Tiles 098" (`Tiles098`), 1K JPG, photogrammetry. Worn medieval stone paving flags; the map's physical tile is 185 x 185 cm, which is where `TILE_METRES.floor` comes from. | CC0 (`"license":"CC0"` from `ambientcg_get_asset` and `ambientcg_list_files`) | <https://ambientcg.com/a/Tiles098> |
| `public/assets/bayview-quaystone.jpg`, `-normal.jpg`, `-rough.jpg` | ambientCG — "Bricks 075 A" (`Bricks075A`), 1K JPG, photogrammetry. Despite the name it is coursed rubble stone masonry, not brick; used here for the quay and seawall. | CC0 (`"license":"CC0"` from `ambientcg_get_asset` and `ambientcg_list_files`) | <https://ambientcg.com/a/Bricks075A> |
| `public/assets/bayview-wood.jpg`, `-normal.jpg` | Poly Haven — "Brown Planks 03" (`brown_planks_03`), 1K JPG, by Rob Tuytel | CC0 (`"license":"CC0"` from `polyhaven_get_asset`) | <https://polyhaven.com/a/brown_planks_03> |
| `public/assets/bayview-sky.jpg` | Poly Haven — "Kloofendal 48d Partly Cloudy (Pure Sky)" (`kloofendal_48d_partly_cloudy_puresky`), by Greg Zaal (original) and Jarod Guest (sky edits). Tonemapped from the 2K HDR to a 3072×1536 equirect JPG for this project. | CC0 (`"license":"CC0"` from `polyhaven_get_asset`) | <https://polyhaven.com/a/kloofendal_48d_partly_cloudy_puresky> |

ambientCG attribution is **not required** (`asset_search_sources`: `"attribution":"Not required"`).
Poly Haven asset attribution is **not required**, but the API credit above **is**
(`asset_search_sources`: `"Asset attribution not required; visible Poly Haven credit is
required when using its API"`).

## Models

| File(s) | Source | Licence | Origin URL |
| --- | --- | --- | --- |
| `public/assets/bayview-barrel.glb` | Poly Haven — "Barrel 03" (`barrel_03`), 1K glTF, by Serhii Khromov. Repacked into a single self-contained `.glb` for this project; geometry and textures are unmodified. | CC0 (`"license":"CC0"` from `polyhaven_search_assets` / `polyhaven_list_files`) | <https://polyhaven.com/a/barrel_03> |
| `public/assets/bayview-gutter.glb` | Poly Haven — "Modular Metal Gutter" (`modular_metal_gutter`), 1K glTF, by Maxim Domnin. Repacked into a single self-contained `.glb`; textures downsized to 512². | CC0 (`"license":"CC0"` from `polyhaven_search_assets` / `polyhaven_list_files`) | <https://polyhaven.com/a/modular_metal_gutter> |
| `public/assets/bayview-walllamp.glb` | Poly Haven — "Industrial Wall Lamp" (`industrial_wall_lamp`), 1K glTF, by Kuutti Siitonen. Repacked into a single self-contained `.glb`; textures downsized to 512². | CC0 (`"license":"CC0"` from `polyhaven_search_assets` / `polyhaven_list_files`) | <https://polyhaven.com/a/industrial_wall_lamp> |
| `public/assets/bayview-buoy.glb` | Poly Haven — "Ocean Buoy" (`ocean_buoy`), 1K glTF, by Mateusz Sadek. Repacked into a single self-contained `.glb`; textures downsized to 512². | CC0 (`"license":"CC0"` from `polyhaven_search_assets` / `polyhaven_list_files`) | <https://polyhaven.com/a/ocean_buoy> |

## Audio

| File(s) | Source | Licence | Origin URL |
| --- | --- | --- | --- |
| `public/audio/ui-click.ogg`, `round-complete.ogg`, `round-failed.ogg`, `clock-tick.ogg` | Kenney — "Interface Sounds" pack (originals `click_001`, `confirmation_001`, `error_006`, `tick_002`) | CC0 — read off `License.txt` inside the pack: *"License: (Creative Commons Zero, CC0) … free to use in personal, educational and commercial projects. Support us by crediting Kenney or www.kenney.nl (this is not mandatory)"* | <https://kenney.nl/assets/interface-sounds> |
| `public/audio/hit-impact.ogg` | Sonniss GDC 2026 Game Audio Bundle (Part 9) — 344 Audio, "Cinematic Fight Vol. 1", `FGHTImpt_4 x Punch, Body 02`. Trimmed to one impact, mono, loudness-normalised, encoded to Vorbis for this project. | Sonniss GDC Game Audio Bundle licence — read off `Readme.txt` inside the bundle: *"LICENSE: ROYALTY-FREE … Use them personally or commercially without attribution."* Raw redistribution as an asset library is **not** permitted (`asset_search_sources`: `"Raw redistribution as an asset library is not allowed."`); shipping individual cues inside a game is. | <https://gdc.sonniss.com/> |
| `public/audio/bullet-whizz.ogg` | Sonniss GDC 2026 Game Audio Bundle (Part 9) — 344 Audio, "Elemental Palette Designed Vol. 1", `WINDDsgn_Wind, Rush, Whoosh, Long x5 01`. Mono, loudness-normalised, encoded to Vorbis for this project. | As above. | <https://gdc.sonniss.com/> |

Credit to Kenney is optional but appreciated by the author; the project should include it.

### Generated cues (ElevenLabs)

All of the following were generated with the **ElevenLabs `POST /v1/sound-generation`
API** on **2026-08-22**, using the project's own API key (kept out of the repository in a
gitignored `.env`; generation is an offline step — the shipped game only loads the
`.ogg` files). MP3 responses were converted to mono/stereo Ogg Vorbis with ffmpeg.
Prompts are summarised; each was a one-line sound description.

| File | Duration | Prompt summary |
| --- | --- | --- |
| `public/audio/shot-player.ogg` | ~1.4 s | Single assault rifle gunshot outdoors, sharp close crack with brief echo tail |
| `public/audio/shot-enemy.ogg` | ~1.6 s | Single AK rifle shot from across a street, harder distant crack, slap-back off stone buildings |
| `public/audio/step-stone-1.ogg` … `-4.ogg` | ~0.6 s each | Four variants: one military boot footstep on stone paving / flagstones / cobbles (dry scuff, firm heel, soft toe roll, brisk step) |
| `public/audio/impact-plaster.ogg` | ~0.7 s | Bullet striking old plastered stone wall, dusty crumble thud |
| `public/audio/impact-wood.ogg` | ~0.7 s | Bullet into thick wooden crate, knock and splinter |
| `public/audio/impact-steel.ogg` | ~0.9 s | Bullet onto hollow corrugated steel door, metallic clang |
| `public/audio/impact-stone.ogg` | ~0.7 s | Bullet chipping granite paving stone, hard stone crack |
| `public/audio/ambience-harbour.ogg` | 16 s (looped) | Coastal harbour ambience: water lapping a stone quay, distant gulls, faint town murmur, light breeze |
| `public/audio/reload-magout.ogg` | ~0.8 s | Magazine release and empty mag pulled from receiver, close foley |
| `public/audio/reload-magin.ogg` | ~0.9 s | Fresh magazine inserted and slapped home, bolt catch released |

**Commercial-use terms for these outputs** (checked 2026-08-22 against ElevenLabs'
published terms): commercial use of generated audio requires an active **paid**
subscription at generation time — free-plan output is non-commercial only and demands
attribution. The Sound Effects product carries supplemental Service Terms under which
ElevenLabs may **sublicense SFX Outputs to third parties** (including other ElevenLabs
users); that sharing can be switched off via the "Disable" control on the Sound Effects
product page, but an opt-out is not retroactive. Rights in outputs remain with the user
as against ElevenLabs, subject to their Terms of Service and Prohibited Use Policy, and
output produced while a feature is designated Beta is excluded from commercial use.
Sources: <https://elevenlabs.io/sound-effects-terms>,
<https://elevenlabs.io/terms-of-use>,
<https://help.elevenlabs.io/hc/en-us/articles/13313564601361-Can-I-publish-the-content-I-generate-on-the-platform>,
<https://elevenlabs.io/docs/api-reference/text-to-sound-effects/convert.mdx>.

## Reference images

`CLAUDE.md` requires each reference image to be credited with its creator, licence and source
URL. **That provenance could not be established for any of them**, and none is invented here.

`references/0400ed3d-…png`, `2e6abeab-…png`, `3d1b1f23-…png`, `4aa4e46f-…png`,
`f5ed99e9-…png`, `floor-texture.png`, `house-wall.png` and `game_ready_crate_pbr.zip` were
supplied with the project brief. Their filenames are opaque UUIDs, they carry no embedded
metadata naming an author, and no tool result in this workstream reports a licence for any of
them. They are visual targets held on disk, not shipped assets. The repository `.gitignore`
already keeps sealed benchmark reference images out of a public repository for exactly this
reason. **Anyone intending to redistribute this project must establish their provenance
first.**

`references/game_ready_crate_pbr.zip` is the one that states anything about itself: its
`README.txt` says *"The source artwork was AI-generated from the referenced crate look"* and
names no licence. It is therefore **not** shipped in `public/` and carries no attribution
entry.

### What was derived from which image

Provenance is unknown, but **use** is knowable and is recorded here, because the sculpt
workflow authors `src/render/` source directly against these frames. Anyone resolving the
licence question later needs to know what the project actually took from each one.

| Image | Derived work |
| --- | --- |
| `2e6abeab-…png` — nine-frame in-game callout sheet | Facade geometry in `src/render/town.ts`. The CONNECTOR frame is the sole source for the arched passages; CT SPAWN and T MAIN are the source for the painted dado and the roller doors. |
| `4aa4e46f-…png` — hero frame | Facade reveal depth, sill and lintel proportion, and the damp streaking under the coping. Also the HUD layout in `src/ui/Hud.tsx`. |
| `0400ed3d-…png` — design sheet | The 3D aerial is the source for how rooflines and setbacks read from above. The top-down layout and 5-swatch theme palette drive `docs/bayview-design.md` and `src/render/palette.ts`. |
| `3d1b1f23-…png`, `house-wall.png` | Source photographs behind `public/assets/bayview-brick.jpg` and `bayview-plaster.jpg`. |
| `floor-texture.png` | Source photograph behind `public/assets/bayview-floor.png`. |

The `bayview-*` textures listed in the tables above are **not** in this category — every one
of them is a CC0 download with a recorded provider, licence and URL.

## Not third-party downloads

`public/assets/bayview-brick.jpg`, `bayview-plaster.jpg` and `sky.jpg` are derived from the
reference photographs described above. They are not downloads of this workstream and their
upstream terms are not recorded here. (`bayview-sky.jpg` is **not** in this category — it is
a Poly Haven CC0 download and is credited in the textures table above.)

`public/assets/enemy-terrorist.glb`, `player-viewmodel.glb` and `weapon-ak47.glb` were
supplied with the brief. The repository `.gitignore` records that the viewmodel is
"user-provided; verify upstream pack terms before redistribution" and that the enemy is
CC-BY-4.0 carrying retargeted Mixamo clips. Those terms are unverified by this workstream.
