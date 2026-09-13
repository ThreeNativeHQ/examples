# AGENTS.md — midway-open-pacific

A ThreeNative port of the standalone `Midway — Open Pacific` WebGL game. Framework rules live in
`/AGENTS.md`; this file covers only what is different here.

## Ownership

`@threenative/core` owns the loop, renderer, input, playtest bridge, the fixed-step scene
lifecycle, and the flight dynamics (`FlightModel`). This repository owns the game: airframes,
missions, AI, damage, models, HUD and look. `src/sim/` is pure and has no Three.js or DOM;
`src/render/` is ordinary Three.js; `src/scenes/Midway.ts` wires them to the framework.

## Start every change

The flight model is the engine capability this game exists to exercise. Read
`src/sim/flight.ts` first: it is the only place airframe constants enter the engine. If a change
needs a new force, control or deck behaviour, add it to `@threenative/core`'s `FlightModel` and
reuse it here — do not grow a second flight model in this repo.

## Sorties and recovery

`src/sim/sortie.ts` holds one record: which of the three briefing assignments is being flown, its
designated target, its objective state and the frozen result. It is pure data plus pure functions —
`Battle` owns every mutation, and the HUD, the map orders and the debrief all read that same record.
Two rules that are not obvious from the code:

- A weapon is **stamped at release** with the sortie id, the designated target and whether the
  attacker was an explicitly ordered wing aircraft. A later recall or retask can neither revoke nor
  grant that weapon's credit, and an unstamped allied weapon damages the ship without scoring the
  sortie.
- A hit the crew did not see does not complete anything. It waits in `sortie.pending` until a
  visual or reconnaissance report dated at or after the impact arrives. The simulation knowing a
  deck is burning is not the same as having observed it.

`src/sim/recovery.ts` owns the way home: the astern setup point in the carrier's moving frame, the
transit/setup/groove/final phases, the glide path, and `finalReady` — the **single** gate that both
`assistRecovery` and the HUD's "READY FOR L" cue call, so the cue can never promise an approach the
game will refuse. Change the envelope there and both move together.

## Platform

The game runs on core's default **WebGPU** backend. Its analytic WaveField ocean and combat
particles use TSL node materials. Dawn HDR supplies the background and filtered water reflections.
Shadow maps are enabled: the installed Three patch keys shadow variants by source material,
preventing multi-material meshes from disposing GPU bindings during submission. Keep appearance in
`src/render/`. The hero Douglas and nearby carriers retain their supplied geometry; distant ships
use LOD. `public/assets/enterprise.glb` is the unused modern CVN-80 source; the visible WWII
Enterprise uses the detailed sister-ship geometry in `hornet.glb`.
Do not claim desktop, Android or iOS until a `--target` playtest has run.

## Deck crew

`src/render/deck-crew.ts` exports `loadDeckCrew(ctx)` and the `DeckCrew` class (`.group`,
`.sailors`, `.update(dt)`, `.dispose()`). It instances one rigged sailor per flight-deck station —
twelve, each with a real job (plane director, two chockmen at the main wheels, plane captain at the
engine, ordnanceman at the bomb rack, fuel detail, arresting-gear crew, deck talker, safety
observer, three handlers) — each with its own clip, start phase, playback rate and a cloth helmet
coloured for its trade. Two rules:

- The rig's height is a pipeline constant (`SOURCE_HEIGHT = 1.83`), not `SkeletalMesh3D`'s `size`:
  that option measures to the crown **bone**, which stops in the middle of the skull, and asking it
  for 1.74m produced a 2.03m sailor.
- Playback rate is applied to each sailor's own `dt` in `update()`, never to the action's
  `timeScale`, because `AnimationPlayer`'s stride pass rewrites an in-place clip's `timeScale` back
  to 1 on every frame even when `strideSync: false`.

## Imported fleet

`src/render/imported-fleet.ts` exports `loadImportedFleet(ctx)`, `createZero()`,
`createSamidare()` and `createMidwayAtoll()`. It wires up the supplied-but-previously-unused assets:
the Mitsubishi A6M3, an IJN destroyer, and Midway Atoll with a garrison camp and radar station on
Eastern Island. Every orientation and scale constant there was **measured** (with
`tools/probe-glb.mjs` and `tools/blender/preview.py`), and the file records what was measured.

## Asset pipeline

`tools/blender/rig-deck-crew.py` calls the reusable `rig_humanoid.py` with the measured
`navy-sailor.json` anatomy. It starts from the supplied original `navy sailor 3d model.glb`,
a textured, unrigged T-pose. It welds coincident vertices, reduces the mesh to 80k triangles,
and fits the CC0 Quaternius UAL skeleton's joint origins to the sailor's shorter arms and wider
stance while preserving bone axes and the authored clips. Continuous anatomical weights keep
scan islands and UV seams together. A narrow bridge between the original middle/ring fingers
is separated before binding. Do not restore automatic bone-heat binding: it assigned
whole hands to thumb bones and left both hand bones with zero influence. Each finger has fitted
knuckles and phalanges, with its flexion axis aligned to its length. Continuous segment weights
keep neighboring digits independent. The UAL finger motions are softened into relaxed curls;
binding the entire hand rigidly loses those motions and makes the sailor look robotic.
`crew.wait` uses `Idle_No_Loop`: the folded-arm clip was rejected because its hand/forearm contact
positions intersect this shorter-armed mesh. Retaining clip names does not require retaining an
incompatible source motion.

Run in a private Blender build session (the script clears that session's objects and actions):

```sh
blender -b -P tools/blender/rig-deck-crew.py -- <UAL1_Standard.glb> <UAL2_Standard.glb> \
  '/home/joao/Downloads/navy sailor 3d model.glb' /tmp/deck-crew.glb
pnpm exec gltf-transform webp /tmp/deck-crew.glb public/assets/deck-crew.glb \
  --quality 90 --vertex-layout separate
node tools/check-fleet.mjs
```

`check-fleet` verifies each hand/finger influence, samples thirteen poses per clip, and closes
both fists to catch opening seams, rigid digits and excessive triangle stretching. Set `MIDWAY_CREW_CLOSEUPS=1` on `capture-fleet.mjs` to capture
all six clips at two phases on the live deck; inspect those images before accepting a rebuild.
For another T-pose model, use [the fitting/reuse guide](tools/blender/HUMANOID-RIGGING.md) and a
new measurement file. The shared `tools/check-humanoid.mjs <file.glb>` runs independently of Midway.

`tools/import-fleet.sh [id]` turns the supplied hulls into shipped GLBs, and
`tools/import-aircraft.sh [id]` does the same for the supplied airframes. Both re-run from the
originals every time, never write to them, and take an optional id to redo one asset:

```sh
bash tools/import-fleet.sh                      # every hull in tools/blender/fleet.json
bash tools/import-fleet.sh carrier.yorktown
bash tools/import-aircraft.sh aircraft.tbd-devastator
node tools/check-fleet.mjs && node tools/check-catalog.mjs
```

Sources come from `$MIDWAY_SOURCE_MODELS` (default `/home/joao/Downloads/midway-missing-models`),
intermediates from `$MIDWAY_STAGE` (default `/tmp/midway-fleet-stage`), and only the WebP-packed
result reaches `public/assets/`. `tools/blender/fleet.json` is the measured table for the hulls — id,
source, length, waterline beam, keel-to-masthead height, draught, `flip`, triangle budget, source
triangle count, class, and the stated source of every declared repair — and `tools/check-fleet.mjs`
and `tools/check-catalog.mjs` read that same file, so a hull the table does not name has no budget
and fails. The aircraft table is the heredoc at the foot of `tools/import-aircraft.sh`, not
`fleet.json`.

The import contract, enforced on the shipped bytes and not on the Blender scene: metres, +Y up, bow
or nose along glTF **-Z**, keel or wheels at y = 0, beam or aircraft span on X, the hull centred on
X, one mesh and one material per hull, no animation clips, WebP textures, `--vertex-layout separate`.

Three rules, each paid for with a wrong-looking model:

- **Blender's +Y-up glTF exporter maps Blender +Y to glTF -Z**, so an importer must finish with the
  bow on Blender **+Y**. Put it on Blender -Y and the whole fleet ships backwards, and neither a
  Blender preview render nor a width-taper check will catch it, because both reason in the
  pre-export frame. Verify orientation by measuring the exported bytes.
- **Weld before decimating.** Tripo meshes split a vertex at every UV seam, and collapsing unwelded
  geometry tears the skin into visible shards — that is what a 94% cut of the Devastator looked
  like. `bpy.ops.mesh.remove_doubles` first, then triangulate, then decimate.
- **`bpy.ops.object.modifier_apply` silently does nothing unless the object is both selected and
  active**, which is what made a second decimation pass look like a no-op. Deselect, select, set
  active, apply — on every pass.

Bow direction cannot be inferred. Plan taper read the bow backwards on five of seven hulls, and
which end hangs deepest is no better, so `flip` in `fleet.json` is a recorded visual decision taken
from orthographic side renders, and `tools/check-fleet.mjs` asserts the result it produced: surface
hulls by plan taper (the bow band narrower than midships), submarines and the torpedo by end
fineness (the aft 5% mean half-breadth at least 15% fuller than the forward 5%, because bow diving
planes spread wider than the pressure hull). An aircraft needs no such entry: the fin is the tallest
thing on the airframe and it is at the tail, so `align-aircraft.py` finds the nose itself.

`docs/asset-provenance.md` records every supplied file's size, SHA-256 and glTF generator; no licence
was supplied with any of them, so distribution rights are **UNVERIFIED**.
`docs/reference-dimensions.md` holds the cited class and airframe figures every scale factor is
fitted to, with **not found** written wherever no source gives one.

## Geometry tools

- `node tools/check-fleet.mjs` — parses the shipped GLBs with no browser and asserts crew clips and
  skeleton, the A6M3's span and propeller pivot, the destroyer hull's length and axis, and the
  atoll's scale.
- `node tools/check-catalog.mjs` — re-reads every shipped hull and the torpedo body and asserts
  `src/sim/catalog.ts` against those bytes: measured dimensions, triangle count, the keel on the
  datum, the `fleet.json` triangle budget and the class length within 2%.
- `node tools/inspect-glb.mjs <file>` — dimensions, node names, clips, triangle and material counts.
- `node tools/probe-glb.mjs <file> [nameFilter]` — per-node world bounds, for finding a nose
  direction, propeller or gear.
- `node tools/probe-ocean.mjs` — measures the ocean's real significant wave height on the CPU.
- `blender -b -P tools/blender/preview.py -- <file> <out-prefix> [front,side,top]` — headless
  orthographic previews.
- `blender -b -P tools/blender/align-ship.py -- <src.glb> <out.glb> --length M --beam M --height M
  --draught M [--decimate N] [--flip] [--preview PREFIX]` — one hull: covariance alignment, bow to
  glTF -Z, uniform scale to the class length with the beam and height repair factors printed,
  decimation, and the keel re-dropped afterwards because decimation moves the lowest vertex.
- `blender -b -P tools/blender/align-aircraft.py -- <src.glb> <out.glb> --span M --length M
  --height M [--decimate N] [--gear] [--preview PREFIX]` — one airframe: span on X, nose to glTF -Z,
  wheels on y = 0, weld, decimate to budget, and the propeller cut into its own object pivoted on
  the shaft. `--gear` stays off: the geometric selection takes the wheel and lower strut but leaves
  the upper leg in the body, so it retracts wrong.
- `blender -b -P tools/blender/derive-mogami.py -- <aligned-tone.glb> <out.glb> [--preview P]` —
  the supplied Mogami GLB is byte-identical to the Tone, so this copies the after pair of forward
  turrets, mirrors it to face aft and sets it on the quarterdeck rather than drawing one hull twice.
- `tools/blender/_render_views.py` is not run directly; `--preview` on either aligner execs it for
  orthographic top and side renders of the aligned scene.
- `bash tools/capture-lock.sh node tools/capture-fleet.mjs` — browser capture of the deck party, the
  Zero, the destroyer and Midway, with assertions a screenshot cannot make.
- `bash tools/capture-lock.sh node tools/capture-deck.mjs` — raycasts the carrier's own geometry to
  measure deck width at each station and captures the launch.
- `bash tools/capture-lock.sh node tools/capture-sortie.mjs` — walks the briefing choice, a real
  attack on a designated carrier, the approach guidance and the short debrief, asserting impact
  placement and leaving a frame of each for a person to look at.
- `bash tools/capture-lock.sh node tools/capture-sortie-runs.mjs` — flies one recon and one carrier
  strike from the airborne start to a recovered debrief with keys only and nothing injected, and
  fails if either takes more than twelve simulated minutes.

## Verify

```sh
# Everything the handoff specifies, extracted from the document and run:
bash tools/run-handoff.sh

# Or piecemeal:
pnpm typecheck
pnpm exec vite build
node scripts/check-flight.mjs
node scripts/check-aircraft.mjs
node scripts/check-audio.mjs
node scripts/check-intel.mjs
node scripts/check-naval.mjs
node scripts/check-carrier-ops.mjs
node scripts/check-submarine.mjs
node scripts/check-facilities.mjs
# Project and platform health, including whether a native target can build at all:
node node_modules/create-threenative/dist/threenative.js doctor
node tools/check-fleet.mjs
node tools/check-catalog.mjs
node tools/probe-ocean.mjs
bash tools/capture-lock.sh node tools/check-repair.mjs
bash tools/capture-lock.sh node tools/capture-deck.mjs
bash tools/capture-lock.sh node tools/capture-fleet.mjs
bash tools/capture-lock.sh node tools/capture-sortie.mjs
bash tools/capture-lock.sh node tools/capture-sortie-runs.mjs
bash tools/capture-lock.sh node node_modules/@threenative/playtest/dist/runner/cli.js \
  --scenario playtests/launch.playtest.json --url http://127.0.0.1:5199 --browser-recipe webgpu --headed --timeout 45000
```

`playtests/launch.playtest.json` boots the briefing, clicks **Take the deck**, runs the throttle
and rotation, and fails on any console error or runtime diagnostic. A visible change also needs an
eye on the frame — the automated gates are blind to how it looks.

Browser gates are flaky against the shared checkout while another lane is editing it: its edits
hot-reload the page mid-run. Serve an isolated copy instead — `git worktree add .worktrees/<slug>`,
`pnpm install`, `rsync -a --delete src/` your tree in, `pnpm exec vite --port 53xx` — and point
`MIDWAY_URL` at that port. Two such copies differing only in the files under test also give an
honest before/after for `capture-performance.mjs`.
