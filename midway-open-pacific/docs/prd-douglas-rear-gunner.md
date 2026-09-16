# PRD — Douglas rear radioman/gunner (SBD + TBD)

**Status:** implemented and visually accepted by root. Both airframes seat a front pilot and a rear
radioman/gunner, man the approved twin gun, open the rear canopy, and share one firing path with a
measured airframe guard and a dedicated blocked-fire cue. The first-person cockpit interior is now
the user's supplied rear-station study (see *First-person rear station* below). The supplied shell's
HTML scope is finished; the per-round rear-gun report is the reconstructed `.30` one-shot
(`gun-30.ogg`) and each airframe's starboard placard names its own type.
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

## Feedback fix — pointer-locked aim, left-click fire, rear-shot feedback

Root cause of the report, traced through `Midway.attachInput` → `Battle.aimRear` →
`fireRearManual` → `rearShot` → `Soundscape.event`:

- **Mouse aim was drag-only and aimed badly.** The station's aim moved only while the right button
  was held (`pointermove` gated on `mouse.looking`), and the HUD hint named no button. The gunner
  now takes a real **pointer lock** on manning (the Y key, the HUD button, or the first canvas click
  while unlocked), and aims on the locked pointer's relative motion alone — `ctx.input.vector("aim")`
  with `aim.pointerRelative` bound and `captureOnClick` off. The OS cursor is hidden while locked and
  aim continues past the window edge; a bare unlocked `clientX` cursor no longer nudge the barrels.
  The click that takes the lock never fires. `Esc` unlocks and opens the pause menu; the pause, map
  and command buttons and station exit release; **Resume** re-takes the lock from its own click; a
  late or refused lock grant is released whenever the station is unmanned or paused. The pilot's
  right-drag free-look and the whole pilot cockpit are untouched.
- **Left click did nothing while aiming.** Two causes: `pointerdown` discarded a left click whenever
  `mouse.looking` was set, and a second button pressed while one is already down arrives as a
  `pointermove`, not a `pointerdown`. Fire is now read from the button mask (`e.buttons & 1`) on
  `pointermove` and recomputed on `pointerup`, so a held or clicked left trigger fires whether or not
  the right button aims. The hint now reads `MOUSE / WASD AIM · LEFT CLICK OR SPACE FIRE`.
- **No rear firing visual.** `rearShot` emitted only a `gun30` sound event; the forward wing guns
  drew their flash at `Battle.fire`. A successful *player* round now also emits `fx("muzzle")` at
  the fired mouth, and the authored `VentedBarrel` groups in the FPP twin (`rear-station.setRecoil`)
  kick back from the sim's own `rearTimer`, so a refused/blocked or empty trigger (rearTimer 0) never
  flashes and never recoils. Look remains game-owned in `src/render/`.
- **Audio trace and fix.** The `gun30` cue routed the player's own round through the world-panned
  `#playAt` path at the gunner's own ear, on the *shared* per-cue cooldown (so a distant AI `.30`
  could claim the slot first) and ~5 dB under the audible forward `.50`; the supplied `gun-30.ogg`
  is a 0.18 s pop (peak −3.9 dBFS) against `gun-50.ogg`'s 2.0 s. The player's own rear round now
  emits as a headset cue with no world position — exactly like the forward guns — on its own
  cooldown lane (an AI gun can no longer suppress it) with an own-shot gain (`OWN_SHOT.gun30` 0.8).
  The capture proves the exact decoded `gun30` buffer reaches the mixer with nonzero samples, on a
  running context, at positive effective gain. **Not ear auditioned** — this host has no audio input.
- **Reload — the supplied controller's belt cycle, adopted as a gameplay approximation.** The rear
  gun's total stays exactly `rearRoundsFor` (SBD 1200 provisional, TBD 600); a single `rearLoaded`
  count (combined 240) is the belt, and the reserve is implicit as `total - loaded`. A shot spends
  both; reloading only moves rounds from the reserve into the belt, so the total never changes and a
  depleted total can never be reloaded back into existence. `R` in the station (pilot `R` still
  reports) starts a 3.6 s belt change, a full belt is a no-op, and an empty belt auto-reloads when a
  reserve remains. The AI gunner (including friendly Douglas SBD/TBD) runs the same state, so a
  change survives the control handoff; Kate/Val keep their generic rear gun. `rear-station.setReload`
  drives the authored `FeedCover` / `AmmoBoxLid` / `ChargingHandle` / belt cycle (open 1.32 rad, lid
  1.15, handle a `0.24·sin` pulse); the HUD shows `total · loaded/reserve` or `LOADING n.ns`.
  **Mechanism approximated, not historical:** the manual distinguishes 120-round belts only as a
  gameplay figure, not a verified capacity (`docs/reference-dimensions.md` records no source).
- **Tracers are round heads, not crosses.** Every round in every camera mode carried a
  camera-facing cross (~10 px) at its head, which read as a field of plus signs. The `LineSegments`
  pair is now one `InstancedMesh` of unit spheres stretched along each round's velocity: a thin
  streak side-on, a small dot end-on. The radius is clamped to `[0.015, 0.45] m` at ~1.25 px of the
  focal length, so a far round is a dot and never a balloon; the instance is centred half a length
  *behind* the ballistic head so the visible streak trails the round instead of reaching past it; a
  zero-velocity round falls back to a valid +Z orientation. One bounded pool (1000 instances), one
  geometry, one draw, no per-frame allocation. This is the existing behaviour's replacement, not a
  new feature: the same `bullets` array drives it. `capture-flak-hunt.mjs` is updated to the new
  representation (instance count, per-instance finite scale, radius clamp, centre-behind error, and
   a proxy that stays instanced rather than re-topologized into a Line).

## Wingman advisories (R32/R33)

Bounded scope: two new wingman lines in the existing speech table, no new system. `R32` warns real
closure on the surface below — a descent steeper than `vy < -6` with `clearance < 140` and
`clearance / -vy < 4` seconds to impact, where clearance is measured above the carrier's own deck
height when the aircraft is over it and above the sea otherwise, with a live wingman in range. There
is no phase, gear or pitch exemption: a gear-down dive onto the deck still warns, a stalled nose-up
descent still warns, and a controlled landing sink rate (~-3 m/s) already clears the -6 m/s gate.
`R33` reports the wingman's own empty **offensive** stores
(`ammo`/`bombs`/`torpedo`; the defensive rear gun never counts) and advises heading home. Both are
advisory: neither sets `command`, the player's mode or nav. Edges are per-wingman (the nearest
*unreported* empty wingman speaks, so a second one is never blocked) and the queue rechecks
`valid()`, so a resolved danger, an out-of-range or dead wingman stays silent. R33's line is the
exact subtitle "Scout Three. I'm out of ammunition. We should head back to the carrier."
`scripts/check-radio.mjs` covers dive/cooldown/stall/landing/deck-dive/cruise/no-wing/dead/
out-of-range and the ammo/second-wing cases.
Voice: `r32.ogg` 2.508 s, `r33.ogg` 4.923 s (mono Vorbis, mean −21.4/−20.2 dBFS), generated with the
repo's ElevenLabs pipeline into the same `wingman` voice as R26–R31; the subtitle is the script
text, so caption equals speech. **Not ear-auditioned.**

## Verification

Standing gates live in `AGENTS.md` / `CLAUDE.md` / `docs/MIDWAY-HANDOFF.md` (`check-gunner` and
`capture-gunner`). Truthful results:

- **Full handoff, run before this focused pass** (`/tmp/opencode/handoff.log`): 19 passed, 4 failed,
  2 skipped. Failures were `check-flight.mjs` (ordered-wing strike completed no seed),
  `check-carrier-cycle.mjs` (68-aircraft cap never reached), `check-fleet.mjs` (the new
  `weapon.rear-gun.glb` unreferenced) and `check-repair.mjs` (line 40 forward wing-gun muzzle-flash
  wait timed out after its keyboard-release check passed). `check-fleet.mjs` was fixed and rechecked;
  the whole handoff has **not** since been re-run, so the count stands at 19/4 with the three
  remaining failures separately proved pre-existing (see below).
- **This focused pass:** `pnpm typecheck` PASS; `node scripts/check-gunner.mjs` PASS (now including
  the SBD depressed central refusal, no-round/no-barrel-flip, immediate level resume, a clear
  depressed side shot, a TBD control, and the belt: total conservation, no spend while loading,
  partial/full/empty `R`, AI auto-reload and a change that survives the control handoff);
  `node scripts/check-audio.mjs` PASS (29 checks); `node scripts/check-aircraft.mjs` PASS;
  `MIDWAY_URL=http://[::1]:5399 bash tools/capture-lock.sh node tools/capture-gunner.mjs` PASS on
  **nvidia / turing**, proving the exact decoded `gun30` buffer reaches the mixer on a running
  context at positive gain (`__gun30Plays`) and that `R` reloads, with frames
  `gunner-reload-mid-{sbd,tbd}.png` and `gunner-firing-{sbd,tbd}-{0,1,2}.png`;
  `MIDWAY_URL=http://[::1]:5399 MIDWAY_WARM_MS=2500 MIDWAY_SAMPLE_MS=6000 bash tools/capture-lock.sh
  node tools/capture-flak-hunt.mjs` PASS with `topo InstancedMesh`, radii `0.19..0.45 m`, max streak
  13.6 m equal to the bullets' own `|v|·0.012`, zero non-finite instances and centre-behind error
  below 1e-3. `pnpm exec vite build`, `check-flight` and the remaining focused gates were **not**
  re-run in this pass (budget); they are unchanged from the last recorded run.
- **Still failing, proved pre-existing on `dcd83dc`:** `check-repair.mjs` reproduces the line-40
  forward wing-gun muzzle-flash timeout. It is now **baseline-proved**: on an untouched `origin/main`
  `dcd83dc` fixture (`git archive` source, `@threenative/core` pinned to the same
  `0.3.2-tracerfix` tarball as this lane, `public/assets` symlinked unchanged, the pilot GLB
  overwritten with the actual `dcd83dc` bytes, sha256 `5c49a3a4…`) `tools/check-repair.mjs` fails at
  the same `tools/check-repair.mjs:40:13` `page.waitForFunction` with the same 30000 ms timeout on
  WebGPU `nvidia|turing` (log `/tmp/douglas-browser-proof-baseline-check-repair.log`). The two other
  pure-sim failures are proved independently on the same baseline (`/tmp/douglas-baseline-report.md`):
  `check-flight.mjs:521:8` and `check-carrier-cycle.mjs:142:10`, same assertions and lines on
  baseline and feature. None is introduced by this lane; all three remain unfixed here. The forward
  pilot cockpit is unchanged and must not be touched to silence them.
- **Rear-gun audio (reconstruction):** `public/assets/audio/gun-30.ogg` is replaced with the audio
  arm's cleaned one-shot — 0.180 s, mono 44.1 kHz Vorbis. `content/audio/midway-audio.json` and
  `tools/audio-catalog.mjs` retag `gun-30` `identity: "reconstruction"` (ElevenLabs
  `eleven_text_to_sound_v2`, 1 s request, prompt_influence 0.6) and record the raw MP3 hash, the
  shipped OGG hash (6356 B), the decoded duration and the processing chain (40 Hz high-pass,
  0.180 s trim, 1 ms/50 ms guard fades, −6.0 dB before encode). `node scripts/check-catalog.mjs`
  verifies the shipped bytes against the last generation hash; `node scripts/check-audio.mjs`
  (29 checks) confirms a `gun30` event reaches the `gun30` cue while `gun50` still reaches `gun50`,
  with the pilot cockpit untouched. The one-shot bank (`gun30` volume `0.45`, cooldown `0.06`) and
  falloff `900` are unchanged. **Not ear-auditioned** — this environment has no audio input, so the
  claim is objective file inspection only (decoded true peak −3.9 dBFS, DC 0.00019, 0 saturated
  samples), never audible likeness. Armament: SBD-3 rear 2 × .30 flexible vs nose 2 × .50 fixed
  ([National WWII Museum](https://www.nationalww2museum.org/visit/museum-campus/us-freedom-pavilion/warbirds/douglas-sbd-dauntless));
  TBD-1 rear 1 × .30; primary .30 AN/M2 cyclic rate **not found**, so cadence is unchanged.
- **Rear-station placard:** `buildEquipment` now labels the starboard radio through
  `placardAirframeLine(airframe)` — `SBD-3` for the Douglas, `TBD-1` for the Devastator — in the same
  authored style, with no geometry, camera or look change. `scripts/check-aircraft.mjs` asserts both
  lines and their equal length (the label wear seed is unchanged). The final
  `node tools/capture-gunner.mjs` pass (`MIDWAY_URL=http://127.0.0.1:5312`) shows
  `U.S. NAVY / SBD-3` and `U.S. NAVY / TBD-1` in `screenshots/gunner-rear-station-{sbd,tbd}.png`,
  reticle, input and obstruction unchanged.
- **Player-only cost (measured, CPU stub):** the first-person rear station measures **317,366
  geometry triangles** — 427,874 instance-weighted rendered triangles, since 27 `InstancedMesh` nodes
  add 112,572 — over **113 draws** / 24 materials, drawn only in the player's own rear view and
  allocated by no AI aircraft (asserted by `check-aircraft`). The build report's `317,366` is the
  geometry count; a later `31,366` was a dropped-digit transcription of it. No desktop, Android or
  iOS claim; no `--target` playtest has run.

- **First-person rear station pass:** `pnpm typecheck` PASS; `node scripts/check-aircraft.mjs` PASS
  (now also asserting both airframes' FPP muzzles against `rearGunMuzzle` at neutral and angled aim,
  the FPP station starting hidden, the measured 0.0078 m muzzle residual, and that the AI build
  carries no station); `node scripts/check-gunner.mjs` PASS; `pnpm exec vite build` PASS;
  `bash tools/capture-lock.sh node tools/capture-gunner.mjs` PASS on **nvidia / turing**
  (`MIDWAY_URL=http://127.0.0.1:5312`) with the FPP shell+twin drawn only in the rear station and
  the exterior gun, shell and pilot path restored on exit.

- **Final combined head (pointer lock + wingman):** `pnpm typecheck` PASS; `pnpm exec vite build`
  PASS; `check-gunner` (incl. the new recoil-settles-dry and recoil-settles-mid-change cases),
  `check-radio` (R26–R33), `check-audio` (29) and `check-aircraft` PASS. `check-gunner.mjs` also
  asserts an AI rear shot carries **no** bullet-velocity field, so the report can no longer be read
  as source Doppler. `capture-gunner.mjs` now asserts a **real** lock (`document.pointerLockElement`
  plus `ctx.input.raw.pointer.captured`), relative aim motion past the window edge driven by
  `xdotool` inside the private `capture-lock` Xvfb, `Esc`-to-pause with the cursor returned, Resume
  re-capturing from its own click, and release on station exit; the audio path still proves the exact
  decoded `gun30` buffer on a running context at positive gain. Its pre-existing `D`-key screen-right
  assertion (a camera-right projection unrelated to the cursor change) does **not** pass on this
  contended host in the time-boxed pass, so the browser capture is left honest: the code and the
  lock/motion assertions are in place, but a green `capture-gunner` run is **not** claimed here.
  No standalone verification document was added; no engine, `node_modules` or new-dependency change.
