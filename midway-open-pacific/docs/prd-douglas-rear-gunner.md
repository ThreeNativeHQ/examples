# PRD — Douglas rear radioman/gunner (SBD + TBD)

**Status:** implemented and visually accepted by root. Both airframes seat a front pilot and a rear
radioman/gunner, man the approved twin gun, open the rear canopy, and share one firing path with a
measured airframe guard and a dedicated blocked-fire cue. The first-person cockpit interior is now
the user's supplied rear-station study (see *First-person rear station* below).
**Lane:** branch `midway/douglas-rear-gunner`, base `89d2462e6e8ddfdbce9852a20efddc54cc4f73b2`.
**Ownership:** the lane owns the seats, crew render, gun mount/aim, rear-gun sim, HUD cue and the
captures. `@threenative/core` owns the flight model; no engine change was needed.

## Goal / scope

A visible, seated, animating rear gunner in the SBD and TBD who mans a real, aimable, firing twin
gun, with the front pilot and the gun kept in view and the open rear station showing sky.

In scope: pilot and gunner stations on both airframes; the approved twin gun asset; the rear-gun
sim (aim, guard, ammunition, credit); the HUD sight, hint and blocked cue; captures that assert
what a screenshot cannot.
Out of scope: flight-model forces (engine-owned), a second animation system, the deck-crew party,
the A6M3/B5N2 crews. The SBD/TBD cockpit shell stays procedural/provisional.

## Crew contract

- `src/render/aircrew.ts` builds one seated station per airframe. `AircrewPilot`/`AircrewGunner`
  publish the keys below; `imported-aircraft.ts` (SBD) and `devastator.ts` (TBD) each wire them.
- `REAR_GUN_HINGE [0, 1.12, 0.55]` (cradle hinge from the seated gunner station). Measured mounts:
  SBD pivot `[0, 0.86, 0]`, TBD pivot `[-0.003, 1.065, 1.236]`; mouth tips (gun rest frame)
  `[-0.091054, 0, 0.481435]` / `[0.091053, 0, 0.473657]` (`weapon.rear-gun.glb`, 4764 triangles).
- SBD seats: pilot `[0, -0.20, -1.81]` yaw π, gunner `[0, -0.26, -0.55]` yaw 0; gunner eye
  `(0.003, 1.018, -0.708)`, pivot `(0, 0.86, 0)`. TBD gunner sits on the rearmost of the ported
  tub's three seats, measured eye `(0, 1.223, 0.528)`, pivot `(-0.003, 1.065, 1.236)`.
- Published keys (`src/render/world.ts`): `userData.crew[0]` (front pilot station, the only actor
  the cockpit view hides), `pilotEye`, `gunner` (rear rig root), `gunnerRig`, `gunnerEye`,
  `rearGun` (gun pivot; base identity, `YXZ` written by controls). The gun pivot carries the whole
  supplied `weapon.rear-gun.glb`, including the pedestal under the pivot (the asset ships its own
  mount); the seat and fittings live in the station and the rig is never under the pivot. Station
  roots carry a `MOVING_NODE` token so the static freeze stops above them.
- The gunner rig is hidden only in his own first-person station (`p.gunner`), leaving the pilot and
  the gun drawn.

## Rear aperture

- **SBD:** the supplied canopy is one glass mesh with no rear section; `openCanopyAft` clones the
  geometry per instance and splits crossing triangles at `REAR_OPEN_Z = -1.21` (not a centroid
  drop), so the pilot keeps the forward greenhouse and the gunner stands in an open rear cockpit.
  The metal frame (`node_8`) is cut at the same plane. Accepted at the -1.21 m hoop cut.
- **TBD:** the greenhouse stops at `REAR_OPEN_STATION = 5`, removing the aft panes that overlapped
  the gunner's crown; the station-5 arch closes the opening. The rearmost backrest moved forward of
  the aft-facing gunner.

## Gun mount, guard and ammunition

- `src/sim/gun-mount.ts` is pure geometry: `rearGunMuzzle` applies the same `Ry(yaw)·Rx(-pitch)` as
  the render pivot, so drawn barrels and fired rounds leave the same mouth. `rearShot` alternates
  barrels only on rounds that actually leave.
- The thin fin guard (`REAR_GUN_TAIL`) is the **measured** tail slab per airframe; both airframes'
  ±0.091 m barrels straddle their thin fins, so a dead-astern level shot is genuinely clear.
- **SBD below-level central guard (added, measured by parent against the exported mesh):** the thin
  fin guard does not cover the fuselage and horizontal tail. Parent BVH grid, both mouths: pitch
  −0.13 hits the hull to `|yaw| ≤ 0.45` and −0.08 to `|yaw| ≤ 0.05`; the TBD stays clear. `rearShot`
  refuses `airframe === "sbd" && pitch < -0.01 && |yaw| <= 0.50`. The −0.01 floor keeps a level shot
  (whose measured pitch carries ~1e-15 noise) firing. It is deliberately conservative and blocks
  some genuinely clear downward rays; a fitted hull envelope is the only upgrade if play demands it.
  No runtime mesh physics.
- `rearRoundsFor(airframe)` reads the rear capacity from `GUN_BATTERIES`: **TBD 600** from the NHHC
  appendix (standard single mount) and **SBD 1200 provisional** — its primary evidence was **not
  found**. A deck loadout swap is never a free top-up: with an empty carrier store the carried
  rounds are capped to the new gun's capacity.

## Manned station

- `Y` / the HUD button hands the aircraft to its existing course-hold autopilot and takes the gun;
  the forward guns, throttle and navigation order are untouched. `WASD`/arrows/drag bound the aim
  to the AI's own tail cone and depression. The gunner camera is locked and its line is
  `battle.gunnerAim()`, so eye, pivot and round agree. Authored camera anchor ≈0.20 m toward the
  nose and 0.03 m up, FOV 82; world gun scale/pivot are untouched.
- HUD: a small brass/pale centre reticle is the player's actual sight (the asset's iron sights do
  not line up with the fixed eye at all yaw angles). A dedicated `role="status"` **AIRFRAME BLOCKS
  FIRE** cue is independent of the general warning chain, so LOW FUEL / LOW AIRSPEED never suppress
  the reason the gun will not fire; the general warning keeps its existing priority.

## First-person rear station (supplied assets)

Bounded scope: replace only the provisional rear FPP surround with the user's supplied reference.
The main pilot cockpit, its interior and its camera are untouched, as are the exterior and friendly
AI aircraft, which keep the approved `weapon.rear-gun.glb` and crew fit.

- **Sources (user-supplied, rights unverified):** `~/Downloads/cockpit(1).html` ("Rear cockpit"
  structure study) supplies the rear-station airframe skin, canopy frame, glazing, seat and radio
  equipment; `~/Downloads/douglas-gunner.html` supplies the twin-gun geometry and materials. Both
  originals are kept unchanged. Their old gun, demo renderers, camera/input loops, backgrounds,
  DOM/UI and inlined Three.js are not ported.
- **Module:** `src/render/rear-station.ts` exports `createRearStation(airframe)`, returning
  `{ group, shell, pivot, muzzles, dispose }`. Static geometry is batched per material; the gun's
  moving parts stay separate. Textures use the repo's existing canvas path and degrade to plain
  colours where no DOM canvas exists (the CPU checks).
- **Fitting:** the shell is yawed π to face aft and scaled uniformly so its declared eye
  `[0,1.60,1.48]` lands on the live camera anchor (`gunnerEye + [0,0.03,-0.20]`); the measured
  flexible-mount centre then falls ~0.14 m off the sim hinge, which is documented, not corrected by
  distorting an axis. The twin gun is oriented π about Y and normalised uniformly to the sim's
  measured mouths: the visible muzzles sit within 0.008 m of the fired mouths at angle, since the
  pivot is the sim hinge and the renderer applies the same `rearGunPivotEuler`.
- **Ownership:** `world.ts` builds the station for the **player mesh only**, in `setAirframe`, and
  disposes it through the player's `userData`. AI aircraft never allocate one. The FPP shell and gun
  are shown only while `p.gunner` and `mode === "flight"`; the external `rearGun` and the exterior
  `cockpitShell` are hidden only in the rear FPP and restored afterwards.
- **Acceptance:** `check-aircraft.mjs` asserts the FPP muzzles against `rearGunMuzzle` at neutral
  and angled aim on both airframes; `capture-gunner.mjs` asserts the FPP shell+gun are drawn only in
  the rear station and never leaked into the exterior or pilot view, and leaves a frame of each for
  the root's visual review. No permission, licence or provenance beyond "user-supplied" is claimed.

## Verification

Standing gates live in `AGENTS.md` / `CLAUDE.md` / `docs/MIDWAY-HANDOFF.md` (`check-gunner` and
`capture-gunner`). Truthful results:

- **Full handoff, run before this focused pass** (`/tmp/opencode/handoff.log`): 19 passed, 4 failed,
  2 skipped. Failures were `check-flight.mjs` (ordered-wing strike completed no seed),
  `check-carrier-cycle.mjs` (68-aircraft cap never reached), `check-fleet.mjs` (the new
  `weapon.rear-gun.glb` unreferenced) and `check-repair.mjs` (line 40 forward wing-gun muzzle-flash
  wait timed out after its keyboard-release check passed). The two pure-sim failures predate this
  lane and were not re-run.
- **This focused pass:** `pnpm typecheck` PASS; `node scripts/check-gunner.mjs` PASS (now including
  the SBD depressed central refusal, no-round/no-barrel-flip, immediate level resume, a clear
  depressed side shot, and a TBD control); `pnpm exec vite build` PASS; `node tools/check-fleet.mjs`
  PASS (the rear gun is checked by `check-aircraft`/`check-gunner`, so it is exempted from the
  fleet.json orphan scan); `bash tools/capture-lock.sh node tools/capture-gunner.mjs` PASS on
  **nvidia / turing** (measured by the capture, not assumed) with screenshots
  `screenshots/gunner-rear-station-{sbd,tbd}.png`, `gunner-rear-blocked-sbd.png` (LOW FUEL +
  AIRFRAME BLOCKS FIRE + reticle together), `gunner-rear-firing-*`, `gunner-exterior-gun-*`,
  `gunner-cockpit-closeup-*`, `gunner-front-pilot-*`.
- **Still failing, not ours:** `check-repair.mjs` reproduces the same line-40 forward wing-gun flash
  timeout; this lane does not touch the forward fire path, so it is recorded as a baseline failure,
  not passed.

- **First-person rear station pass:** `pnpm typecheck` PASS; `node scripts/check-aircraft.mjs` PASS
  (now also asserting both airframes' FPP muzzles against `rearGunMuzzle` at neutral and angled aim,
  the FPP station starting hidden, the measured 0.0078 m muzzle residual, and that the AI build
  carries no station); `node scripts/check-gunner.mjs` PASS; `pnpm exec vite build` PASS;
  `bash tools/capture-lock.sh node tools/capture-gunner.mjs` PASS on **nvidia / turing**
  (`MIDWAY_URL=http://127.0.0.1:5312`) with the FPP shell+twin drawn only in the rear station and
  the exterior gun, shell and pilot path restored on exit.
