# PRD — Douglas rear radioman/gunner (visual)

**Status:** visual contracts implemented in the lane (both cockpit stations on SBD and TBD, gunner-eye
and rear-gun pivot published, open SBD rear canopy), pending parent frame inspection
**Lane:** branch `midway/douglas-rear-gunner`, base `89d2462e6e8ddfdbce9852a20efddc54cc4f73b2`, checkout
`.worktrees/douglas-rear-gunner/midway-open-pacific`.
**Ownership:** this lane owns the seat/gunner render and the seated clip on the pilot rig. Parent root
Codex owns asset-MCP donor discovery, Blender execution and any `@threenative/core` change. The main
checkout `sandbox/midway-open-pacific` has unrelated uncommitted edits and is read-only.

## Goal / scope

Seat a visible radioman/gunner in the rear cockpit of the Douglas SBD-3, animated through an
existing engine mechanism.

In scope: a seated figure parented to the Douglas airframe; a minimal rear seat and twin-gun mount
so he reads as seated rather than floating; the seated animation clip added to the existing
`public/assets/carrier-aircraft-pilot.glb` rig; update, LOD and disposal; one capture that asserts
what a screenshot cannot.

Out of scope: any change to flight or combat/gunnery logic; a new animator or animation system; a
new airframe or asset; the deck-crew pilot behaviour; the TBD and every other airframe.

## Non-negotiable constraints

- Use `SkeletalMesh3D` + `AnimationPlayer`; add no second animation system. The engine's
  `SkeletalMesh3D` clones with `SkeletonUtils.clone` (`@threenative/core` dist `index.js:1015`),
  so skeleton-safe cloning is already engine-owned.
- Rig height is the named pipeline constant, never `SkeletalMesh3D` `size` (crown-bone measurement
  is wrong for this rig). `RIG_HEIGHT.pilot = 1.78` (`src/render/deck-crew.ts:101`); the gunner
  scales from that same constant.
- If a new animation/force/control behaviour is needed, it goes into `@threenative/core` first; this
  lane reuses it. No engine edit is expected.

## Evidence measured this phase

Aircraft frame from `createDouglas` (root): nose −Z, +X starboard, keel/wheels near y = 0.

- Pilot panel origin `COCKPIT_POSITION (0, 0.342, −2.482)`; `EYE [0, 1.42, 1.6]` at
  `COCKPIT_SCALE 0.52` (`src/render/cockpit-detail.ts:37`) ⇒ pilot eye root **(0, 1.080, −1.650)**.
- Canopy glass node_7: z −2.87…0.20, y 0.59…1.21; roof height 1.184 at z −0.80. Frame node_8:
  z −2.70…0.13. Cockpit shell node_12: z −2.72…0.81, y −0.62…0.75. Fuselage node_18: z −3.42…5.00.
- **No rear seat and no gun geometry exist** in `aircraft.douglas-sbd3.glb` (23 meshes; no
  seat/gun node or material). `cockpit-detail.ts` builds only the front instrument panel. The SBD
  gun mount/seat is new procedural geometry (patterns: `src/render/devastator.ts:555` seats,
  `src/render/dauntless.ts` rods/boxes/cylinders).
- `src/render/world.ts:931` already hides `playerMesh.userData.crew[0]` in cockpit view, and
  nothing in the tree sets `userData.crew` — the intended hook for exactly this crew member.

Donor: the asset-MCP cache already holds `ual1-Sitting_Idle_Loop-in_place-<hash>.glb` (1.67 s, 195
channels, 65 bones), plus `Sitting_Talking_Loop`, `Sitting_Enter`, `Sitting_Exit`. Its bone names
are the same UAL skeleton as `carrier-aircraft-pilot.glb` (68 nodes / 65 joints), so the clip binds
with no retarget and no motion guessing.

## Design

1. **Asset.** Add `["Sitting_Idle_Loop", "sit"]` to `clips` in `tools/blender/pilot.json`; rerun the
   existing `bash tools/import-people.sh carrier-aircraft-pilot`. Inputs exist: the source model
   `$MIDWAY_SOURCE_MODELS/carrier-aircraft-pilot.glb` hashes to the pinned `sourceSha256`, and
   `rig_humanoid.py:305` bakes any named UAL clip. `$UAL1`/`$UAL2` must be supplied by parent
   (uploadIds 17958403 / 17958478). Extend the pilot expectation in `tools/check-asset-polish.mjs`
   to `idle walk gesture sit`. No new Blender code: the pipeline already receives a named UAL clip.
2. **Render.** In `createDouglas` attach a `SkeletalMesh3D` gunner (source
   `/assets/carrier-aircraft-pilot.glb`, `requiredClips:["sit"]`, `strideSync:false`), scaled from
   `RIG_HEIGHT.pilot`, seated facing aft at a rear station fixed by an in-game raycast against the
   canopy roof (working estimate z ≈ −0.7, seat pan y ≈ 0.2, roof 1.184). Add a minimal seat pan /
   backrest and a twin-.30 mount with `box`/`rod`/`cylinder` from `src/render/assets.js`.
3. **Wiring.** (superseded — see “Crew integration contract”) `root.userData.crew[0]` is the forward
   pilot, the only actor the cockpit view hides; the gunner is published separately.
   Name the gunner root with a `MOVING_NODE` token (add `crew` to the regex at `world.ts:238`) or
   `freezeStatic` (`world.ts:540` player, `:1107` AI) bakes its matrices and the mixer stops showing.
4. **Update.** Advance the sit clip from `animateDouglas` so parked, AI and player Douglases all
   animate it, and `dt = 0` stays frozen (the parked spinner already calls it).
5. **Disposal.** `player.dispose()` in `disposeDouglas`; never dispose the shared GLTF geometry the
   `SkeletonUtils` clone references.
6. **LOD/perf.** `airframeLod` merges every mesh, including the skinned gunner bind pose. Either tag
   it (a `userData.lodSkip` check in `buildLod`) or verify the merged stand-in's triangle/census
   delta is negligible. The AI Douglas is the common instance, so if the census cost is material,
   ship the gunner on the player aircraft first.

## Front pilot (added scope — bounded visual fix)

The empty forward cockpit was user-flagged; the same seated rig now fills it.

- The station builder moved to `src/render/aircrew.ts` (`createSeatedStation(name, seat, yaw,
  options)`), shared by `imported-aircraft.ts` (SBD) and `devastator.ts` (TBD) without an import
  cycle; `loadImportedAircraft` hands the loaded pilot GLTF to it via `configureAircrewPilot`.
  Forward pilot `PILOT_SEAT [0, -0.20, -1.81] yaw PI` (faces the nose −Z); aft gunner unchanged at
  `GUNNER_SEAT [0, -0.26, -0.55] yaw 0`.
- Placement from the real cockpit eye: the posed Head joint lands at (−0.003, 0.998, −1.597), so the
  eye (head + 0.08 up, 0.055 forward) is ≈ (0, 1.078, −1.652) vs the documented (0, 1.080, −1.650).
  Crown 1.178 m under the 1.207 m canopy glass at this z; feet inside the nose. No scaling.
- `seatedFurniture()` now derives the pan/backrest/legs from the measured seated pelvis
  `[0.003, 0.625, -0.286]`, which also fixes the displaced rear seat (old pan sat 0.85 m forward of
  the hips). Placeholder gun untouched.
- `scripts/check-aircraft.mjs` asserts both stations, both on `sit`, one skinned rig each, pilot
  ahead of and above the gunner, heads under the canopy.
- Known gap: the shared `sit` clip rests the hands on the thighs, ~0.8 m short of the panel origin;
  stick contact needs a pose override or clip, outside this fix.

## Crew integration contract (controls lane hand-off)

Exact keys the controls arm reads (`src/render/world.ts` on `midway/douglas-gunner-controls`):

| key | type | meaning |
| --- | --- | --- |
| `userData.crew[0]` | `Object3D` | the whole forward-pilot station; the pilot view hides it |
| `userData.pilotEye` | `Vector3` | measured front-pilot eye, aircraft-root coords |
| `userData.gunner` | `Object3D` | the gunner **rig root** (not the station); hiding it leaves seat/fittings/gun |
| `userData.gunnerRig` | `SkeletalMesh3D` | the gunner's own mixer |
| `userData.gunnerEye` | `Vector3` | measured seated eye + 0.08 up / 0.055 forward, aircraft-root coords |
| `userData.rearGun` | `Object3D` (Group) | the gun pivot; base rotation identity, `YXZ` written by controls |

- The gun pivot carries only cradle, barrels and magazine; the pedestal and the seat live in the
  fittings (`userData.owned`), and the rig is never under the pivot. It is parented in the station's
  seat frame, so it follows the man to any cockpit.
- `userData.gunner` is named `Douglas rear gunner` / `TBD rear gunner` (matches `MOVING_NODE`), so
  the static freeze stops above it and per-frame `rotation` writes render.

## Friendly TBD crew (added scope)

- `devastator.ts` seats the same rig in its **own procedural cockpit** (the shipped-but-unused TBD
  GLB is never drawn): front pilot on the forward seat with his eye locked to the published
  `userData.cockpit` (0, 1.230, −2.420); **rear radioman/gunner on the rearmost of the ported tub's
  three seats**, measured eye (0, 1.223, 0.528), gun pivot (−0.003, 1.165, 1.536). `furniture:false`
  — the ported airframe already models its seats.
- Seat choice is measured, not assumed: the tub's cushions are at model x = −2.46, −0.98, +0.55
  (nose −Z). The pilot uses the forward cushion (−2.61); the rearmost radioman/gunner uses the +0.40
  cushion centre. The middle seat is the bombardier/torpedo officer, not the gunner.
- Independent `SkeletalMesh3D` per occupant; `animateDevastator`/`disposeDevastator` update and give
  back both mixers; the station roots carry a `MOVING_NODE` token and the 4.4 k-triangle skinned
  crew is excluded from `airframeLod`. Every TBD build (hero and deck-park AI) gets the crew; the
  A6M3 and B5N2 stay crewless.
- Rear-station headroom at the rearmost seat is tight: the glass centreline top is ≈1.278 m at the
  gunner's z, and the rig crown lands ≈1.32 m, so the aft pane overlaps the crown by ≈0.04 m. The
  gun pivot and barrels sit aft of the greenhouse's aft end (z 1.42), in the open. **Pending parent
  frame review** (cut/accept the aft glazing) via `capture-gunner.mjs` and the assembled-GLB Blender
  preview (see `/tmp/douglas-integrated-preview-ready.md`).

## SBD rear aperture

- The supplied SBD canopy is one glass mesh (`defaultMaterial_node_7`, z −2.871…0.199) with no rear
  section to slide or hide, so `openCanopyAft` clones its geometry per instance and cuts it at the
  plane `REAR_OPEN_Z = −1.25`: crossing triangles are split and interpolated, not dropped by centroid
  (a centroid test left a broad diagonal pane across the gunner and the firing ray). The separate
  metal frame (`defaultMaterial_node_8`) is cut at the same plane, so the closed rear frame and its
  full-width hoop do not outlive the glass. The pilot keeps the whole forward greenhouse; the gunner
  at z = −0.763 stands in an open rear cockpit. Both clones are disposed in `disposeDouglas`; the
  source GLB is untouched.
- TBD: the greenhouse now stops at `REAR_OPEN_STATION = 5` (x = 0.27), removing the aft panes and
  arches that overlapped the gunner's crown by ~4 cm; the station-5 arch closes the opening and the
  pilot keeps the forward greenhouse. The rearmost seat's backrest is moved forward of the aft-facing
  gunner's pelvis (it had his legs through it).

## Rear ammunition

- `rearRoundsFor(airframe)` in `src/sim/armament.ts` reads the rear mount's rounds from
  `GUN_BATTERIES`: the SBD's provisional 1200 total, the TBD's documented 600, zero on a
  single-seater. `battle.ts` seeds the player, every launched AI aircraft and the rearm from it; the
  forward pool is unchanged (no forward rebalance). The TBD's supplied twin-barrel visual is a
  VT-8-style approximation; the 600-round document is the standard single mount, not proof of
  retrofit twin capacity. `scripts/check-gunner.mjs` asserts the seed values and a drain.

## Integration phase results (controls merge + frame fix)

- Controls commit `f7afbdc` was applied to this visual tree as a patch (`f7afbdc^..f7afbdc`), not
  cherry-picked, so the dirty visual work (incl. the `MOVING_NODE` `crew|gunner` regex) is preserved.
- Contract bug fixed: the AI rear gun's tail-cone depression now uses the **aircraft up axis**
  (`poseAxes(a).u`, the same mapping as the muzzle) instead of world `dy`; the manned station already
  used `attitudeAxes`. `scripts/check-gunner.mjs` gains a nose-up case a world-`dy` test fails.
- Frame bug fixed: the rear-gun pivot is written every frame — aimed in the gunner station and reset
  to its rest barrel on hand-back — instead of freezing where the player left it. The temporary
  gunner-eye fallback is deleted; both airframes publish `userData.gunnerEye`.
- Gates run this phase: `pnpm typecheck` PASS; `node scripts/check-gunner.mjs` PASS
  `{forwardAmmo:1400,rearAmmo:240}`; `node scripts/check-aircraft.mjs` PASS;
  `node tools/check-asset-polish.mjs` PASS; `node scripts/check-weapons.mjs` PASS (4). No browser.
- Measured metadata: SBD gunner eye (0.003, 1.018, −0.708), pivot (0, 0.960, 0.300); TBD gunner eye
  (0, 1.223, 0.528), pivot (−0.003, 1.165, 1.536).
- **Pending**: the per-airframe rear-gun muzzle offset (TBD still shares the SBD tuple) cannot be
  finalised until the supplied gun's export root is aligned in `/tmp/douglas-gun-export.py`.

## Acceptance

- The gunner is visible, seated and animating in chase/wide views of the player Douglas and every
  TBD, and does not appear in the merged distant stand-in.
- He is hidden in cockpit view (`cameraMode === 1`); the forward pilot is the only actor
  `userData.crew[0]` hides, and a first-person station can hide `userData.gunner` without the gun.
- The pilot rig ships `idle walk gesture sit`; no other asset changes; the deck party is unchanged.
- `pnpm typecheck`, `node tools/check-asset-polish.mjs`, `node tools/check-aircraft.mjs`,
  `pnpm exec vite build` pass. `check-aircraft` covers SBD + TBD crew, both eyes, the gun pivot
  surviving a gunner hide, independent skeletons and the LOD/freeze guards.
- A capture asserts presence, parentage, the seated clip name, cockpit-view hiding and the true
  seated pose, and leaves one frame for a person to look at.

## Verification

- `bash tools/capture-lock.sh node tools/capture-player-aircraft.mjs` extended, or a
  `tools/capture-gunner.mjs` following the same live-object pattern.
- Baseline file hashes and pre-task snapshots: `/tmp/opencode/douglas-baseline.sha256` and
  `/tmp/opencode/douglas-baseline/` (outside git).

## Capability choices (full detail pending parent)

`SkeletalMesh3D` (entry present in `capabilities.json`) and `AnimationPlayer`
(`strideSync`, `clipGroundSpeed`) match the full request; clone-with-SkeletonUtils is confirmed in
the shipped dist. No new capability is required.

## Cleanup (pending)

After merge, remove this worktree per the global git-worktree skill. This lane never edits the main
checkout.
