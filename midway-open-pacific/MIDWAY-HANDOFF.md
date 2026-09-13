# Midway — game completion handoff for Opus

**Status: paused at João's request, 13 September 2026.** Continue the game implementation from this checkout. João will return to Codex for final integration/review afterward. Do not treat the current visuals or the latest browser checks as finished.

## 1. Start here

| Item | Location / state |
|---|---|
| Game | `/home/joao/projects/threenative/sandbox/midway-open-pacific` |
| Owning Git repository | `/home/joao/projects/threenative/sandbox`, branch `main` |
| Engine | `/home/joao/projects/threenative/threenative-engine`, branch `prd-382-flight-model` |
| Existing plan and measured results | [PRD-midway-reference-repair.md](./PRD-midway-reference-repair.md) |
| Game instructions | [AGENTS.md](./AGENTS.md); `CLAUDE.md` is its generated mirror |
| Running game server | `http://127.0.0.1:5199` — check before starting another server |
| Working tree | Many modified and untracked game files, including all imported assets and new checks. **Preserve them.** The game changes have not been committed. |

Read `src/scenes/Midway.ts`, `src/render/world.ts`, `src/render/imported-aircraft.ts`, `src/render/imported-ships.ts`, and `src/sim/battle.ts` before changing their contracts. `src/sim/flight.ts` supplies airframe data to the engine's `FlightModel`; do not add a second flight model.

Use actual **Claude Opus 5 high** for demanding work: `--model claude-opus-5 --effort high` was tested successfully. Use Blender MCP for model inspection/modeling and Asset MCP for missing assets. Search engine capabilities and read matched details before writing substantial helpers or changing render stages. Appearance remains game-owned.

Implementation agents were stopped for this handoff. The ordinary dev server and private Blender session may remain available. Do not kill unrelated processes or overwrite another sandbox project. No task worktree was created.

## 2. What João wants — retain these decisions

1. A convincing, realistic Pacific flight-combat game at **06:30 dawn**, with detailed ocean, lighting, materials and scale. The references are quality targets; the task is not complete just because a model loads.
2. Highest visual quality for the **player Douglas, main Enterprise, cockpit and other objects near the player**. Distant enemies can use cheaper meshes/LOD. Do not visibly destroy railings, silhouettes, texture mapping or aircraft shapes through decimation.
3. Easy controls: **Down raises the nose; releasing steering settles the aircraft**. João uses keyboard and mouse together. Latest decision: remove the persistent mouse joystick; arrows/A/D steer, W/S throttle, left-click/Space fire, right-drag looks. Mouse movement must never inject a flight command.
4. Automatic gear retraction after safe takeoff, with **G manual override**. João originally wrote “after landing”; we explicitly interpreted this as after takeoff. Keep gear deployed on landing.
5. Reuse supplied models and audio first. Source additional missing models through Asset MCP. Use ElevenLabs only for real audio gaps, inspecting results. **Keep smoke, fire and muzzle effects procedural**; do not use the supplied fire/smoke textures.

Official control reference: [World of Warplanes' mouse-control explanation](https://worldofwarplanes.com/news/mouse-controls-explained/) describes assisted/centering control schemes. It does not establish keyboard-only flight as a universal industry standard. Removing our conflicting virtual stick is the chosen repair; a proper mouse-aim instructor would be a separate feature, not something to quietly reintroduce now.

## 3. References and source assets

| Reference | Exact path |
|---|---|
| Original standalone game | `/home/joao/projects/threenative/threenative-engine/Midway-Open-Pacific-v3.html` |
| Original lighting/menu screenshot | `/tmp/codex-clipboard-gaCBQf.png` |
| Initial port screenshot | `/tmp/codex-clipboard-V8NjAA.png` |
| Desired exterior/ocean quality | `/home/joao/projects/threejs-to-bevy/examples/battle-of-pacific/REFERENCE.png` |
| **New cockpit quality target** | `/home/joao/Downloads/cockpit-reference.png` |
| Supplied asset project | `/home/joao/projects/threejs-to-bevy/examples/battle-of-pacific/` |
| Modern CVN-80 original | `/home/joao/Downloads/uss_enterprise_cvn-80_aircraft_carrier.glb` |
| Hornet / detailed WWII carrier original | `/home/joao/Downloads/u.s._navy_aircraft_carrier_uss_hornetcv-8.glb` |
| Akagi original | `/home/joao/Downloads/ijn_aircraft_carrier_akagi_1942.glb` |
| User's scale complaint | `/tmp/codex-clipboard-LXlrML.png` |
| User's coarse CVN-80/HUD complaint | `/tmp/codex-clipboard-YNvbzJ.png` |

**Do not modify any original supplied file.** Work on game-owned copies. Preserve embedded texture and animation data, provenance and licenses.

The supplied midday panorama is `assets/imported/polyhaven/kloofendal-48d-puresky/` inside the asset project. Its sky is not automatically suitable for dawn. The game currently uses `public/assets/dawn-sky.hdr`, Poly Haven's CC0 `citrus_orchard_road_puresky` 2K HDR, plus the supplied normal map copied to `public/assets/ocean-normal.png`.

## 4. Model inventory — every current replacement gap

### Aircraft

| Model / role | Current implementation | Remaining work / available source |
|---|---|---|
| **Player Douglas SBD-3** | Imported `public/assets/aircraft.douglas-sbd3.glb`, 10,416 triangles, 61 embedded images, 12 clips; 12.66m span | Retain geometry/animations. Finish high-quality cockpit, inspect exterior texture/material quality at close distance, hardpoints, prop blur and damage attachments. Original source is `assets/generated/aircraft.douglas-sbd3.glb` in the supplied project. |
| **Player TBD Devastator / torpedo loadout** | Still procedural `makeDauntless(true)`, not a detailed imported TBD | **Missing proper replacement.** Source an appropriate TBD with useful propeller, gear and control-surface parts/animations and its three-person crew; verify 15.24m configured span, cockpit, torpedo mounting and both flight/ground behavior. |
| Friendly AI SBD dive bombers | Generic `makeAircraft(team, kind, false)`, despite imported Douglas being available | Reuse the Douglas for nearby AI, retain cheaper distant representation; wire animations and correct disposal of shared assets. |
| Friendly AI F4F Wildcat fighters | Generic procedural aircraft | **Missing replacement.** Source F4F; retain low-cost distant LOD. |
| Friendly AI TBD torpedo aircraft | Generic procedural aircraft | Reuse the eventual imported TBD, with visible/released torpedo and correct gear. |
| Japanese Zero fighters | Generic procedural aircraft | **Supplied but unused:** `assets/generated/aircraft.mitsubishi-a6m3.glb` and `assets/imported/aircraft.mitsubishi-a6m3.source.glb`. Generated version: 14,540 triangles, `flight.cruise` clip. Inspect animation/scale/materials and make an explicit period/variant choice. |
| Japanese dive bombers | Generic procedural bomber; `Battle.launch()` currently assigns generic bombers `airframe: "sbd"` regardless of team | **Missing Japanese dive-bomber replacement and identity audit.** Source appropriate D3A/Val geometry and correct the airframe/identity mapping; changing only the mesh leaves the US identification/performance assumption in place. |
| Japanese B5N Kate torpedo aircraft | Generic procedural aircraft, configured `kate` airframe | **Missing replacement.** Source B5N; retain cheap distant LOD. |
| Catalina reconnaissance aircraft | Procedural `kind: "recon"` variation, radio identifies Catalina | **Missing proper PBY replacement.** Preserve recon behavior and use restrained distant cost. |
| B-25 Mitchell extracted from Hornet | `public/assets/b25-mitchell.glb`, all 25,910 triangles and 19 textures retained | Extraction is done: nine identical originals removed from ship; one reusable standalone GLB exported. Currently used as parked aircraft on non-main US carriers. Decide where it belongs in a Midway fleet; do not silently treat its Doolittle-style deck complement as the correct aircraft for every carrier. |

**Important:** every flying AI aircraft still passes through `makeAircraft(...)` and an arbitrary `1.15` scale in `WorldView.update()`. Imported player/parked aircraft do not mean the combat squadrons have been replaced. Remove that arbitrary scaling when using metre-normalized imports. Inspect each animation binding rather than assuming all GLBs share Douglas node names.

### Carriers

| Ship | Current implementation | Remaining work |
|---|---|---|
| **USS Enterprise — main carrier** | Detailed WWII sister-ship geometry from `hornet.glb`, 347,281 triangles / 73 images; full detail nearby, procedural LOD at 1,200m | **Still not visually accepted by João.** Resolve the aircraft/deck width impression in actual launch views, deck setup, markings, close textures and lighting. Asset source mesh names identify Enterprise-1944, but Hornet markings remain. |
| USS Hornet | Same detailed `hornet.glb`, with reusable parked B-25s | Inspect placement/contact and choose the right aircraft complement; preserve texture and rigging quality. |
| USS Yorktown | Currently the same Hornet factory/model as every non-Enterprise US carrier | **No distinct Yorktown representation.** Sister-ship reuse may be acceptable with correct markings/details; avoid accidental Hornet names/aircraft complement. |
| Akagi | Imported `public/assets/akagi.glb`, 246,563 triangles / 33 images; near/far LOD | Needs actual attack-distance inspection, collision/hit alignment and LOD review. Original stern deck slopes down about 1.4m; flat contact plane is approximate. |
| Kaga | Procedural `makeShip()` | **Missing replacement.** Source appropriate carrier; cheaper enemy LOD is authorized. |
| Soryu | Procedural `makeShip()` | **Missing replacement.** Preserve recognizable silhouette with sensible enemy LOD. |
| Hiryu | Procedural `makeShip()` | **Missing replacement.** Preserve recognizable silhouette with sensible enemy LOD. |

Do not revert Enterprise to the supplied modern CVN-80 just to obtain a wider deck: its single 1024² color atlas over a 337m ship caused the original texture-quality complaint. `public/assets/enterprise.glb` preserves that 32,209-triangle export but is **not downloaded or displayed at runtime** now. If another main-carrier asset is needed, source a genuinely better one instead of upscaling its texture.

### Escorts and submarines

| Named ships | Current implementation | Replacement status |
|---|---|---|
| USS Northampton | Generic procedural cruiser | Missing suitable cruiser asset. |
| USS Phelps, USS Hammann, USS Balch | Generic procedural destroyers | Missing suitable US destroyer assets; reuse by appropriate class/role with markings if justified. |
| Tone, Chikuma | Generic procedural cruisers | Missing suitable Japanese cruiser asset(s). |
| Arashi, Nowaki | Generic procedural destroyers | **Supplied alternative available but unused:** `assets/generated/enemy.samidare.optimized.glb` and `assets/imported/enemy.samidare.source.glb`. Generated version: 26,032 triangles, `ship.idle` clip. Inspect quality and explicitly decide whether class/identity substitution is acceptable; it is not literally Arashi or Nowaki. |
| I-168 | Generic procedural submarine | Missing Japanese submarine representation. Preserve surface/submerged behavior. |
| USS Nautilus | Generic procedural submarine | Missing US submarine representation. Preserve surface/submerged behavior. |

### Crew, scenery, cockpit, weapons and effects

| Object | Current implementation | Remaining work |
|---|---|---|
| **Deck crew** | Twelve blocky box/cylinder people in `makeCrew()`, identical raised-arm poses | **Missing high-quality human replacement.** These are conspicuous foreground placeholders. Source/model realistic crew, clothing/helmets and useful signaling/idle poses; measure adult height against the plane and deck. |
| Pilot and rear gunner | Detailed procedural airframe has simple crew; imported Douglas has no comparable convincing cockpit occupants | Inspect both exterior and cockpit needs. Source/model occupants only where visible; hide the pilot head/body where necessary for the camera. |
| **Douglas cockpit interior** | Transparent original coarse canopy; separate old flat live instrument panel, prop blur | **Major unfinished priority.** See section 6. |
| Midway terrain/coast/lagoon | Ellipsoid island in `makeIsland()` | **Supplied but unused:** `assets/imported/geography/midway-atol.glb`. 9,768 triangles. Inspect geographic scale, sea-level datum, coastline and lagoon before replacement; source metadata does not establish its georeferencing/metre scale. |
| Kure atoll | Supplied, not currently instantiated as a separate destination | `assets/imported/geography/kure-atol.glb` available, 221,277 triangles. It is a distinct atoll, not an interchangeable Midway replacement. Use if it fits existing world geography; not a requirement to invent a new mission. |
| Airfield runways/markings | Flat boxes | Integrate with imported terrain; avoid floating/sunken strips and preserve intended island location. |
| Hangars, airfield buildings, fuel tanks | Repeated boxes and cylinders | Replace visible placeholders. Supplied `assets/generated/structures.garrison-camp.glb` and `structures.radar-station.glb` may cover part of the scenery (1,182 and 514 triangles respectively); inspect first. |
| Deck props / naval guns / island equipment | Detailed carrier imports contain substantial equipment; far/procedural ships use primitive pieces | Audit close visibility and LOD transitions. Do not redundantly rebuild equipment already present in the imported carrier. |
| Aerial bombs, racks and release visuals | Simple ellipsoid projectile; imported aircraft hardpoint integration incomplete | Model believable bombs/fins/racks for visible close objects; align release locations, remove stores when dropped, retain collision behavior. |
| Mark 13 aerial torpedo and mounts | Procedural body, fins, propellers in `model-damage.ts` | Inspect scale/detail on player TBD and after release; replacement/custom modeling if visibly inadequate. Imported aircraft need explicit mounting/release bindings. |
| Aircraft damage/debris attachments | Generic procedural damage visuals using old model positions | Align engine/wing/tail damage to each imported model. Current wing removal relies on `userData.wings`, which the imported Douglas does not expose equivalently; bind actual components instead of leaving destruction disconnected. Preserve shared-asset ownership when removing wrecks. |
| Fire, smoke, flak, muzzle flashes, tracers, splashes, wakes | Procedural TSL/geometry effects | Keep procedural by request. Improve scale, timing and attachment as needed; **do not replace with supplied fire/smoke textures or blindly import the generated FX GLBs.** |

Supplied FX GLBs are `assets/generated/fx.flak-burst.glb`, `fx.muzzle-flash.glb`, and `fx.tracer-bolt.glb`; they are available but not required replacements. Explicitly excluded source textures are `assets/textures/wing-fire.png` and `gun-smoke-wisp.png`.

Other supplied materials: `assets/imported/polyhaven/{concrete,dark_wooden_planks,hessian_230}/`. These can help appropriate surfaces but must not become visibly tiled, oversized substitute textures on the hero models.

## 5. Carrier scale, deck setup and collisions — unresolved visual acceptance

The source scale was measured in Blender, not estimated from screenshots:

| Measurement | Value |
|---|---|
| Douglas span | 12.66m |
| WWII carrier visual length | 251.58m |
| Widest measured deck | 34.4m |
| Old launch position, local Z=+105 | 23.3m deck width, only 1.84 Douglas spans |
| Briefing position, local Z=+15 | 32.4m deck width, 2.56 spans |
| Launch corridor used by simulation | 220m long × 20m wide; **not the full visible deck/hull dimensions** |
| Current launch/service start | `deckOffset = -55`, changed from `-105`; both aircraft pass CPU launch tests |
| Current briefing pose | Visual-only local Z=+15; player moves to launch setup on start |

Remaining actions:

1. Capture the current main carrier at briefing, sitting on the actual launch point, during the deck run and just after liftoff. João repeatedly said it looks too narrow. **Do not close this solely with a dimensions table.** Check player framing, parked planes, wheel contacts, wingspan clearance and the deck edge in the actual view.
2. Keep the runway clear. Main parked Douglas aircraft are currently around X=-13m, Z=-30/0. Measured deck port edges vary; parking farther aft can put a wheel overboard or a wing across the launch path. Crew must also leave safe clearance.
3. Separate conservative launch/deck dimensions from visual hull/damage dimensions where needed. `world.ts` overwrites ship `length`/`width` with the launch corridor; generic combat code also uses these fields. Audit bombs/torpedoes striking outer deck/bow areas so visible ship geometry is not unhittable.
4. Verify deck contact after every model/pose change. Current regression gives main tyre bottoms −2.80cm and fixed tailwheel −4.11cm relative to the flat datum at pitch 0.22. A previous tailwheel mounting change caused **30cm hover** and was reverted; only its strut was extended to the fuselage. The SBD tailwheel remains fixed.
5. Review near/far LOD scale and transition. Far ships still use the old procedural shapes and parked aircraft, with a generic parked-plane scale of .72. Avoid visible size jumps and mismatched markings. Keep the hero detailed; do not fix the narrow-deck impression by undocumented nonuniform stretching.

## 6. Cockpit upgrade — Opus 5 inspected it, but has NOT implemented it

The new reference is `/home/joao/Downloads/cockpit-reference.png`. It shows rounded riveted canopy arches, worn olive/black metal, thin clear glass, physical gauge bezels/screws, a curved instrument panel and compact reflector gunsight under warm dawn light. The present `screenshots/repair-cockpit.png` is much simpler: angular frames and an obvious flat instrument box.

1. Build a convincing **3D** cockpit using Blender MCP and/or measured game-owned geometry. Add rounded arches, rivets, framing, worn materials, a shaped panel, physical bezels and a compact reflector sight. Do not paste the reference image over the view.
2. Preserve visibility: clear central sightline, restrained glass tint/scratches/reflections, no opaque canopy, no rotating solid propeller blade strobing across the aim point. Preserve the exterior model; cockpit-specific detail/visibility is acceptable.
3. Retain live instruments and useful free-look. The existing panel texture is now a `DataTexture`, updated from the existing painted instruments. Do not replace working gauges with static painted numbers.
4. Preserve all twelve source animation clips, independent prop/control surfaces, gear behavior, measured ground contact and per-instance ownership. Re-run the aircraft regression after any structural change.
5. Compare a fresh GPU screenshot directly with the reference, including dawn lighting. The final cockpit pass has **not** been captured or accepted.

Measured starting points:

| Item | Existing value / artifact |
|---|---|
| Player cockpit eye, aircraft local coordinates | `(0, 1.08, -1.65)` |
| Imported model transform | Scale ≈6.33 to 12.66m span, yaw π, body Y offset +0.35m |
| Current instrument parent | Position `(0, .144, -1.15)`, scale `.7`; face center approximately `(0, .76, -2.205)` |
| Existing frame bounds, normalized aircraft coordinates | X ±.414, Y .552–1.219, Z −2.697…+.129 |
| Existing glass bounds | X ±.4, Y .589–1.207, Z −2.871…+.199 |
| Front upper arch | Z −2.303…−2.562, top Y1.219 |
| Nose center maximum height | Y≈.823 |
| Saved Blender inspection scene | `/tmp/midway-cockpit-work.blend` |
| Interrupted Opus 5 session | `7d50faae-63b8-4b2d-9106-39450d9884f3` |
| Task / stream log | `/tmp/midway-opus-cockpit-task.txt`, `/tmp/midway-opus-cockpit-run.jsonl` |
| MCP configuration | `/tmp/midway-opus-cockpit-mcp.json` |

No new `cockpit-detail.ts` or cockpit GLB was created before pause. The session completed reference reading and three Blender inspections only. Resume from the game directory if useful:

```sh
claude --resume 7d50faae-63b8-4b2d-9106-39450d9884f3 \
  --model claude-opus-5 --effort high \
  --mcp-config /tmp/midway-opus-cockpit-mcp.json --strict-mcp-config
```

## 7. Controls and flight — implemented repairs still need real playtesting

| Repair already present | Evidence / limitation |
|---|---|
| Engine neutral trim | Missing `/4.8` lift-slope division fixed; core flight tests pass. |
| Game stall guard | Stops forcing `-0.04` pitch when stick is neutral. |
| Launch assistance | Survives momentary player input and covers bow overrun departure. |
| Low-speed response | Pitch-authority floor raised from .4 to .75; do not retune blindly. |
| Automatic gear | Requires ≥5m wheel clearance, positive climb >.5m/s for 1s and stall<.1; G disables automatic handling for that sortie. |
| Mouse joystick | **Removed by Opus 5.** Mouse state now contains firing/free-look only. Hints/manual updated; latest browser assertions are written but unrun. |

Remaining actions:

1. Run a real keyboard+mouse session: takeoff, release, short alternating turns, firing while moving the mouse, free-look, cockpit switching, stalls/recovery and landing. João said controls were still unsatisfactory after earlier fixes; CPU tests alone do not close that feedback.
2. Verify visible left/right rocking across the deck-to-flight transition. Neutral CPU bank was <0.14° over 60s; an old stale mouse command was a concrete culprit. Also inspect carrier bob, parent detachment, camera up/lag and actual animation transforms. Do not add another physics damping patch without reproducing a fault.
3. Verify **actual camera rotation**, not just `lookYaw`/`lookPitch` fields. Right-drag modifies those fields, but `world.ts` currently consumes them in the cockpit branch; the chase branch may not honor the advertised free-look. The browser test's current field assertions are insufficient to prove that visual behavior.
4. Check auto/manual gear over two sorties, landing/arrestment/service, low-speed overrun and interrupted climb. The shorter launch start shows a small bow dip in CPU runs before recovering; verify real wheel/water clearance and make the launch forgiving.
5. Audit focus/overlay/restart input cleanup. `visibilitychange` currently uses a direct `document.addEventListener` without joining the scene cleanup list. Ensure held fire/keys cannot survive blur, pause, restart or scene exit.

The completed mouse-removal session is `f30c422d-ac72-43ee-94bd-dd5c7c9d86d2`; result `/tmp/midway-opus5-mouse-removal.json`. It ran typecheck, script syntax and the flight regression successfully. It did not run the browser. Its current changes also need an independent diff review.

## 8. Ocean, lighting, materials, HUD and VFX

1. **Judge water at matched altitude.** The supplied exterior reference is about 295ft/90m; current airborne start is around 5,000ft. Capture both low flight and cruise. Current high-altitude captures still show a broad smooth/gray region and regular near ripples; determine whether wave filtering, reflected sky or artistic balance needs adjustment rather than claiming reference parity.
2. `src/render/ocean.ts` now uses existing `WaveField` analytic waves, dense logarithmic rings, filtered normals, small ripples, GGX sun glitter, foam and ship wakes. `environment.ts` supplies HDR/normal detail and **PMREM-filtered reflections**; raw HDR sampling previously made distant water an unrealistically sharp mirror. Refine scale, irregularity, glitter and wake placement without shimmer or adding an unnecessary second simulation.
3. Match sun, HDR and materials as one dawn environment. Current sun is roughly 7.5° high, warm `#ffc78a`; sky/environment intensity .65, exposure .95. Confirm panorama sun/reflection alignment, cool fill, warm highlights and grounded shadows. Check the carrier deck and Douglas do not read as glossy plastic or washed-out gray.
4. HUD contrast was improved with dark backing/gradients, but inspect mission/radio/instruments against sun glare, cockpit and both viewport sizes. Fix overlaps, clipped primary actions and stale control instructions. Existing screenshot tests mostly check element visibility, not readability or whether an element is inside the viewport.
5. Muzzle pulses were reduced from oversized flares to roughly **.385m / .045s**. Recheck on the imported aircraft: actual gun positions, tracer alignment, firing rhythm, propeller clearance, hits, flak scale, explosions, debris, damage flames, splashes and torpedo wakes. Old procedural hardpoints can be wrong for the new meshes.

## 9. Audio — generated and wired, listening review remains

`src/audio.ts` now uses eight recordings (about392KB): engine, wind, gun, flak, explosion, splash, bomb release and stall horn. Five were reused; wind/bomb-release/explosion were generated with ElevenLabs after inspection. Exact prompts, durations, trimming and measurements are already in the PRD; do not generate duplicate replacements without finding a specific defect.

1. **Audition the actual in-game mix.** Nobody subjectively listened during this session; previous claims are ffmpeg/ffprobe measurements and tests. Check engine character, throttle response, loop repetition, gun attack, flak distance, wind, clipping, fatigue and warning intelligibility.
2. Confirm real samples replace the fallback oscillator after loading; no missing network/decode errors. Check mute, pause/resume, restart, engine damage/cut and `dispose()` while one-shots are active. Scene exit now calls `audio.dispose()`.
3. Verify spatial/range behavior in the game. Explosion and splash events were just given distance metadata; ranged sounds now cut off rather than retaining a minimum volume at any distance. Check with visible near and far events.
4. Engine start/stop clips and music were inspected but omitted; they are still in the supplied project. Add only if they improve the requested experience. Do not invent a large audio state machine or music system just to consume every file.
5. ElevenLabs credentials already resolve locally as `ELEVENLABS_API_KEY` in the sandbox environment. **Never print or embed the key.** Existing generated clips returned HTTP200; do not confuse that with auditory quality approval.

## 10. Runtime, optimization and final gameplay coverage

1. Keep full hero geometry and use shared geometry/materials plus appropriate distant LOD. The rejected 78k Hornet decimation damaged railings and deck UVs and did not reduce its94 draw calls; original347k was restored. Compare original/optimized close views before accepting any future simplification.
2. Measure real steady-state performance after loading/compilation, with a named hardware adapter, fixed resolution and a representative moving/firing workload. No trustworthy final FPS figure exists. Another active browser/GPU workload was present; do not kill unrelated work to manufacture a benchmark. Texture/draw-call cost matters alongside triangle count.
3. Test complete existing loops: both loadouts, takeoff, navigation/reports, target selection, bombs/torpedoes and hits, AI launches/combat, damage/death, carrier destruction, return/landing/arrestment/service, win/loss, restart and quality changes. These have not all been requalified after importing models.
4. Audit model ownership/lifetime when replacing AI: current generic `disposeModel()` disposes geometry; imported clones may share it. Removing one aircraft must not break another. Review sky/material/particle/texture disposal and scene exit without changing appearance ownership into engine code.
5. Keep loading coverage correct. `Midway.enter()` now waits for `ctx.startup.whenReady()` before hiding the loader. Verify a cold load shows a complete world, not the earlier blank briefing background, and does not accept controls during shader preparation.

## 11. What is verified, what is NOT, and commands

**Verified on the pre-cockpit-upgrade/current implementation where stated:** engine six-flight-test regression; eleven shadow-cache patch tests; aircraft scale/animations/glass/prop/panel/ground-contact checks; four carrier asset checks; four60s flight runs across the two loadouts; twelve audio checks. Typecheck passed after the latest mouse removal. An earlier browser repair pass succeeded before the subsequent asset/control changes.

**Not verified for the final current state:** end-to-end browser check, final Playtest scenarios, new cockpit reference match, user acceptance of deck scale/controls, low-altitude water comparison, subjective audio, complete combat/landing lifecycle, steady-state FPS, native platforms. Do not report these as passed.

Run from the game directory after implementation is frozen:

```sh
pnpm typecheck
pnpm exec vite build
node scripts/check-flight.mjs
node scripts/check-aircraft.mjs
node tools/check-carrier-assets.mjs
node scripts/check-audio.mjs
```

Use a persistent terminal for the dev server if needed:

```sh
pnpm dev --host 127.0.0.1 --port 5199 --strictPort
```

Run browser tasks **sequentially** on the private display:

```sh
bash tools/capture-lock.sh node node_modules/@threenative/playtest/dist/runner/cli.js \
  doctor --url http://127.0.0.1:5199 --text

bash tools/capture-lock.sh node tools/check-repair.mjs

bash tools/capture-lock.sh node node_modules/@threenative/playtest/dist/runner/cli.js \
  --scenario playtests/launch.playtest.json \
  --scenario playtests/flight.playtest.json \
  --url http://127.0.0.1:5199 --browser-recipe webgpu --headed
```

Browser-driver lessons (do not repeat the earlier harness mistakes):

1. Wait for `#loading.hidden` with `{state: "attached"}`. Waiting for a hidden element to be **visible** times out; waiting for `#loading` merely to be hidden can succeed before it exists.
2. Import the **exact already-loaded game module URL**, including Vite's `?t=...`, from resource timing. Importing fresh `/src/game.ts` can instantiate another unstarted game and produce `undefined.battle`. The script has been corrected; its final rerun is outstanding.
3. Freeze source edits while testing. HMR changed/reloaded scenes during previous runs. A Vite server started with `watch:null` still received project-plugin HMR updates here, so do not assume that option creates a frozen build.
4. Always use `tools/capture-lock.sh`; it serializes capture and launches a private Xvfb with the real NVIDIA/Turing adapter. Running doctor outside it while another capture started caused its browser to be closed. Do not open extra visible desktop browsers.
5. Inspect output images. `repair-*` captures represent different intermediate revisions and are **not all final evidence**. `/tmp/midway-browser-final.log` currently contains a failed earlier driver run, not a passing final result. The updated mouse assertions have never run in the browser.

Prepared cockpit-only capture script: `/tmp/capture-midway-opus-cockpit.mjs`, not yet run. It would write `screenshots/cockpit-opus5-pass1.png`; that image does not yet exist as accepted output.

## 12. Hand back to Codex when the game work is ready

1. Leave a concise account here or in the existing PRD of what actually changed, any unresolved visual/gameplay concerns and every gate actually executed. Keep pending boxes open; no separate evidence ledger is needed.
2. Include fresh briefing/deck/low-flight/cockpit/firing captures, model/texture/LOD counts and the audio listening outcome. Do not claim “AAA” or “all bugs fixed” from a loader screenshot.
3. Preserve imported source assets and the dirty working tree. Stage/commit only this game when Codex performs finalization; unrelated sibling folders `prd221-16kb-starter` and `prd360-bayview-live` must remain untouched.
4. Engine fixes already committed: `ad18927e9` (lift slope) and `6d529638f` (shadow material bindings). The game installs the corrected core tarball and Three patch. An engine PRD note remains uncommitted; do not revert it. Root full gates had unrelated temporary-directory/generated-declaration failures, recorded in that PRD; browser/native equivalence has not been proved.
5. Codex will review the aggregate diff, run final appropriate checks, update PRD status, choose final evidence and handle finalization. João explicitly requested this implementation handoff before that step.

---

## 13. What the Claude session of 13 September 2026 actually changed

Cockpit work (section 6) was explicitly taken off this lane by João mid-session and done in
parallel by another agent; nothing below touches `cockpit*.ts`. Everything below was verified in
the browser against the real tree, not an isolated copy, after that lane landed.

### Model gaps closed

| Was | Now |
|---|---|
| Twelve blocky box people in identical raised-arm poses | `src/render/deck-crew.ts`: twelve rigged sailors, one per flight-deck station, each with a real job, its own clip, start phase, playback rate, height and trade-coloured cloth helmet. Built by `tools/blender/rig-deck-crew.py` from the supplied WWII sailor mesh bound to the CC0 Quaternius skeleton. |
| Japanese fighters were generic procedural aircraft | The supplied A6M3 is wired in and swapped onto AI Zeros inside 1.1km, released past 1.5km, capped at ten detailed instances. |
| Friendly SBDs were generic procedural aircraft | The imported Douglas is used for nearby US dive bombers under the same detail loan. |
| Arashi and Nowaki were generic procedural destroyers | The supplied Samidare hull, scaled to 111m, bow corrected to -Z, with a procedural far LOD. |
| Kaga, Soryu and Hiryu were the same procedural box | Akagi's hull scaled to 247.65m, 227.5m and 227.4m. **Class substitution, not those ships** — Kaga and Soryu carried starboard islands, and that survives only in the far LOD. |
| Midway was an ellipsoid | The supplied atoll, with Sand Island's X-runways and Eastern Island's 1942 triangle in its own texture, plus the garrison camp and radar station. |

### Bugs found and fixed

1. **Japanese dive bombers were flying as Douglas SBDs.** `launch()` stamped `airframe: "sbd"` on every bomber regardless of team. A D3A Val airframe was added and the mapping corrected.
2. **The Catalina had no airframe at all.** `launchRecon()` never set one, so `airframeFor(undefined)` silently gave the reconnaissance flying boat a 12.66m dive bomber's span, mass and power. It now has its own PBY-5 entry.
3. **The parked Douglas hung 4.8m of wing over the sea.** Measured port deck edge -14.6 against aircraft centred at x=-13. There is no fix by nudging: a 32m deck cannot hold a 12.66m parked span abeam a 12.66m launch lane, so the pack is now spotted aft of the launch start where a real carrier put it.
4. **Enemy carriers were unhittable where they were visible.** Every detailed carrier had its length and width overwritten with the 220m x 20m launch corridor against a 260m x 31m hull. Only the player's own deck needs the corridor; every other carrier is now sized as the target it is.
5. **`disposeModel()` disposed geometry shared by every other instance.** Imported clones share their geometry with `ctx.assets`; killing one aircraft took the geometry out from under the rest. Disposal now gives back only per-instance parts.
6. **Free-look did nothing outside the cockpit.** Right-drag moved `lookYaw`/`lookPitch`, which only the cockpit branch consumed. The chase views now orbit the viewpoint.
7. **The `visibilitychange` listener outlived the scene.** It was the one input hook never added to the cleanup list.
8. **The arbitrary 1.15 scale** is gone for imported, metre-true models and kept only for the procedural airframe it was compensating for.

### Section 5, the deck-scale question, answered

Measured by raycasting the carrier's own geometry at the aircraft's stations
(`tools/capture-deck.mjs`), in Douglas spans:

| Ship-local z | +15 | -20 | -55 | -90 (bow) | +55 | +78 | +100 | +118 |
|---|---|---|---|---|---|---|---|---|
| Width (m) | 32.4 | 32.2 | 29.4 | 22.8 | 25.6 | 25.4 | 23.2 | 29.0 |
| Spans | 2.56 | 2.54 | 2.32 | 1.80 | 2.02 | 2.01 | 1.83 | 2.29 |

**The deck is not narrow.** 32.4m at the aircraft's station is a correct Yorktown-class flight
deck. What was wrong was the deck park hanging over the sea, and water that was not conveying
scale. Both are fixed; João should judge the result in `screenshots/deck-*.png`.

### Section 8, the water

`tools/probe-ocean.mjs` measures the wave field on the CPU: significant height 4.55m, 6.64m peak
to trough. The field was never the problem. The log-ring grid spaced vertices 21m apart out at
300m, so a 45m wave got two of them and the sea flattened into ripples exactly where the ships
are. Ring density is doubled; A/B tested at 0.1ms, which is to say free.

### Section 10.2, the frame figure

Wall-clock timing on the private Xvfb reports 83.3ms median and is **wrong**: it does not move
when the sea, ships or sky are hidden, nor when the render target is cut to a third of its width.
It measures window presentation, not the game. GPU timestamp queries measure the game — NVIDIA
Turing, 1672x941, pixel ratio 1, balanced, flying and firing with 18 aircraft and 17 ships,
919 draw calls, 286,519 triangles:

> **GPU median 3.57ms, p95 9.99ms, worst 10.79ms.**

### What could NOT be sourced, and why

The TBD Devastator, F4F Wildcat, D3A Val, B5N Kate and PBY Catalina have **no source asset
available through any agent-reachable provider**, and neither do US or Japanese cruisers,
destroyers or submarines. Checked: Sketchfab needs a `SKETCHFAB_API_TOKEN` that is not set on this
machine; Smithsonian NASM 3D carries only a Bell X-1 and the Wright Flyer; Fab's free tier has no
WWII naval types; Poly Haven and ambientCG have no aircraft. Those types therefore stay procedural
at every range rather than wearing another aircraft's silhouette — `importedAircraftFor()` in
`world.ts` says so in a comment. This is the largest remaining gap and it needs either a Sketchfab
token or purchased assets.

### Still open

- Subjective audio listening (section 9) — not done, nobody listened.
- Native `--target` playtest — not run.
- Full combat/landing/win/loss lifecycle requalification (section 10.3).
- The Enterprise still wears Hornet's "8" on her flight deck; the marking is baked into `hornet.glb`.
- The IJN carriers' island sides are Akagi's for all four at close range.
- Ships have no bow wave or hull foam; they sit in the water but do not disturb it.

### Engine friction worth reporting

`AnimationPlayer`'s stride pass rewrites an in-place clip's `timeScale` back to 1 on every frame
even when the game passed `strideSync: false`, so a per-instance playback rate set on the action
is silently discarded. The documented contract for that option is that the authored rate is kept
and the override reported. The deck crew varies each sailor's own `dt` instead rather than patch
`node_modules/`. Separately, `SkeletalMesh3D`'s `size` option measures a skinned rig to its crown
**bone**, which stops mid-skull: asking for 1.74m produced a 2.03m sailor.
