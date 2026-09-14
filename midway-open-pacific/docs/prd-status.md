# PRD-midway-asset-battle-integration — acceptance status

Read-only audit. Every AC-1..AC-24 in `docs/PRDs/PRD-midway-asset-battle-integration.md` is judged
against the code in this working tree and against checks that were **actually executed**. Nothing in
the game was edited to produce this document.

## Revision audited, and why it is not the dirty primary

The audit ran at **clean HEAD `da700c5`** ("test(midway): capture the battle roles AC-21 and AC-22 ask
to see"), checked out in an isolated worktree (`sandbox/.worktrees/prd-audit`), which was removed
after the run. The branch has since advanced to `ca9bd1a`, whose only two commits touch
`docs/PRDs/PRD-midway-fluid-lab.md`; **`src/`, `scripts/` and `tools/` are byte-identical between
`da700c5` and `ca9bd1a`**, so the results below still describe the current code.

The primary checkout on `midway/asset-battle-integration` additionally carries **uncommitted edits**
by a concurrent lane that were changing while this audit ran (`src/sim/battle.ts`,
`src/sim/tactics.ts`, `src/render/world.ts`, `src/render/imported-aircraft.ts`,
`scripts/check-carrier-ops.mjs`, `docs/remaining-asset-battle-failures.md`). Those edits were not
treated as landed and are not the basis of any verdict here; a check that fails against the dirty
tree is the WIP's problem, not this document's. Every result below is the committed state at
`da700c5`.

Verdict rule: **MET** only when code exists *and* an executed check proves the criterion; **PARTIAL**
when code exists but the proof is pure-module only, is a browser gate not run here, or is a partial
clause; **NOT MET** when the implementing code is absent or is a pure module no `src/` file calls.

## Acceptance criteria

| AC | Summary | Verdict | Implementing code (path:line) | Proving check + real result | What is missing |
|---|---|---|---|---|---|
| AC-1 | Inventory disposition/provenance; Tone≠Mogami; Kagerō resolved | PARTIAL | `docs/asset-provenance.md`; `tools/blender/fleet.json`; `tools/blender/derive-mogami.py`; `src/sim/catalog.ts:101-124`; `src/sim/battle.ts:288-289,811-814` | `tools/check-catalog.mjs` **PASS** (10 hulls + 1 weapon, worst length 0.050%); `tools/check-fleet.mjs` **PASS** | Mogami/Mikuma are now instantiated (`battle.ts:811-814`, hull `mogami`), closing the old gap, but no check compares the Tone and Mogami rendered layouts, and rights remain UNVERIFIED (permitted by the PRD). |
| AC-2 | Validated endpoints; length/span/beam ≤2%; 0.1 m stations; visual check | PARTIAL | `src/sim/catalog.ts:41-45,146-150`; `src/sim/math.ts:67` (`overHull` two-box); `src/render/world.ts` draught sink; `tools/measure-decks.mjs` | `tools/check-catalog.mjs` **PASS** (asserts **length** ≤2%, worst 0.050%, and `measuredBeam` vs the GLB's own X only, `:105`); `tools/check-fleet.mjs` **PASS**; `check-geometry` **PASS** | **Beam is not within 2% of the class reference**: the shipped bytes are 30–83% wider (Kaga `measuredBeam 53.93` vs `hullBeam 32.50`, `catalog.ts:41,45`; Hammann 20.14 vs 11.00, `:146,150`). The declared repair is sim data, not applied to the GLB. The silhouette clause is unmet for Yorktown/Kaga islands; no browser gate was run here. |
| AC-3 | Player TBD in deck/chase/cockpit; AI/parked correct airframes across LOD; no Dauntless fallback | PARTIAL | `src/render/world.ts:141-145` (AI import table), `:361-372` (player `createAirframe("tbd1","hero",true)`); `src/render/imported-aircraft.ts:376`; `src/scenes/Midway.ts` label | `scripts/check-aircraft.mjs` **PASS** (imported player TBD consumes its 9 shipped clips, independent instances) | No check proves AI/parked TBD/Kate identity or the LOD path (`check-aircraft.mjs` builds a parked TBD but asserts nothing about it); at HEAD the cockpit shows the fused closed canopy (`imported-aircraft.ts:33,480`), the whole-exterior workaround having been withdrawn. |
| AC-4 | Prop/gear/hook/surface motion; independent instances; one store per release | PARTIAL | `src/render/imported-aircraft.ts:537` (`animateImportedAirframe`); `src/render/dauntless.ts:252` | `scripts/check-aircraft.mjs` **PASS** (each separated TBD part moves and returns to neutral, the store hides once, two instances stay independent) | The TBD GLB ships no hook node, so no hook motion is claimed; the weapon a real release creates is owned by `Battle` and not exercised at render level; the AI animation path is untested. |
| AC-5 | Through `Battle.step`: AI engine flight, legal release/recovery, Kate level bombing, damage | PARTIAL | `src/sim/tactics.ts:95` (`chooseCarrierMission`), `:581` (`updateTacticalAircraft`), `:792-793` (Kate `level-bomb`); `src/sim/flight.ts:118-130` | `scripts/check-flight.mjs` **PASS (exit 0, 200 s)**: `naturalWingStrike` recovered at **706.42 s**, `wingHits 1`, `personalHits 0`, within the 720 s bound; `check-ai-flight-cost` numbers below | No check isolates AI engine flight, AI release, Kate level bombing or a power-loss glide; B5N2 constants remain span 14.9 / `wingArea 34.6` (`flight.ts:126-127`) against the PRD's 15.5 / 37.7. |
| AC-6 | Pure init geometry; recovery/diversion agrees with `finalReady`/HUD and geometry | MET | `src/sim/battle.ts:725`; `src/sim/recovery.ts:95` (`finalReady`); `src/sim/math.ts:47,67` | `scripts/check-geometry.mjs` **PASS**: 19 hulls sized before any render, 5 distinct deck datums, a guided diversion recovers on USS Yorktown (wheels 14.47 m over a 12.54 m deck), cue == gate, `WorldView` writes no geometry | Only Yorktown is exercised as the diversion deck; drawn-vs-sim agreement is AC-2's burden. |
| AC-7 | Cycles conserve airframes, spend once, respect occupancy, no spend on blocked launch | PARTIAL | `src/sim/carrier-ops.ts:115-250`; `src/sim/battle.ts:1255` (`recoverAircraft`), launch path | `scripts/check-carrier-ops.mjs` **PASS (28 s)**; `scripts/check-carrier-cycle.mjs` **PASS (258 s)** — 12 min: 102 aircraft lost, 28 cap refusals, all airframes accounted for | "The visual deck park matches the inventory" is unproven, and damaged-inventory/diversion persistence is not asserted. |
| AC-8 | Inputs change the next mission; CAP vs escort; no modulo/name rule | MET | `src/sim/tactics.ts:95`; `src/sim/battle.ts` mission choice | `scripts/check-carrier-cycle.mjs` **PASS (258 s)**: Kaga kates 7→0 with no torpedoes, strike launches 0→20 with a delivered contact, the modulo sequence is excluded, renaming is a no-op, the seed reproduces 36 launches | — |
| AC-9 | Suspension reasons; limited reopen without restoring hull/stores | MET | `src/sim/carrier-ops.ts:250` (`suspendReason`); `src/sim/battle.ts` `deckSuspension` | `scripts/check-carrier-ops.mjs` **PASS**; `scripts/check-carrier-cycle.mjs` **PASS**: "fire in the landing corridor" for 358 s, then limited operations at 113/340 hull, no stores or airframes restored | — |
| AC-10 | Unobserved never precise; dated/stale reports; dead scout's sent report arrives | MET | `src/sim/intel.ts:61-132`; `src/sim/battle.ts` `observeFleet`/`deliverReports` | `scripts/check-intel.mjs` **PASS** (15 checks); `scripts/check-carrier-cycle.mjs` **PASS** (no target before observation, a dead scout still delivers, stale report 201 s / 2042 m off / ±1128 m) | "Stale information changes search behaviour" is only implicit (no contact → recon), not asserted. |
| AC-11 | Tone/Chikuma launch/recover a finite scout that reports and can be intercepted | NOT MET | `src/sim/scouting.ts:1-208` (pure); **imported by no `src/` file**; `src/sim/battle.ts:1214` (`launchRecon`) spawns a hardcoded island `catalina` | `scripts/check-scouting.mjs` **PASS** (7 checks) — pure module only | `scouting.ts` is imported by nothing in `src/`; no cruiser floatplane geometry, catapult, water pickup or Battle/capture proof; `Battle.launchRecon` still flies the Midway PBY. |
| AC-12 | Functional island facilities; Japanese follow-up from observed capability | PARTIAL | `src/sim/facilities.ts:1-200`; `src/sim/battle.ts:200` (layout), `:1935` (`hitFacility`), `:1948` (`updateFacilities`), `:3078` (bomb→facility) | `scripts/check-facilities.mjs` **PASS** (14 checks) — pure model only | Facilities are now wired into `Battle` (hits, repair, `radarWarning`, `radioDelivery`, `baseAviationLost`), but `japaneseFollowUp`/`observedCapability` (`facilities.ts:111,189`) have **no caller**, so no follow-up mission responds to observed surviving capability; no check drives the Battle facility path. |
| AC-13 | One target contract across map/cycle/orders; submerged uncertainty | PARTIAL | `src/sim/sortie.ts:167,186`; `src/sim/battle.ts:667` (`targetContacts`), `:675` (`designateTarget`); `src/scenes/Midway.ts:471,482`; `src/hud.ts:702-703` | `scripts/check-briefing.mjs` **PASS** (validator, map, cycling and the one contract agree; surface exclusions; explicit retask/unavailable); `scripts/check-sortie-kinds.mjs` **PASS** (live designation, retask, submerged refusal, wing order, released-weapon credit, frozen recovered debrief) | No executed check covers the actual map/list DOM consumer path; "submerged contacts show uncertainty" is not proven — a submerged boat is simply unselectable and there is no submerged-contact uncertainty presentation. |
| AC-14 | Formation, hazard avoidance, detach/rejoin, protective coverage | PARTIAL | `src/sim/naval.ts:66-128`; `src/sim/formation.ts:192-279`; `src/sim/battle.ts:2041` (`updateShips`), `:2292` (`steerSurface`), `:2465` (`setupSurfaceGroups`), `:2127` (`coverageLost`) | `scripts/check-naval.mjs` **PASS** (10, pure); `scripts/check-formation.mjs` **PASS** (7, pure) | Formation is now wired into `Battle.updateShips`, but no check drives the live group steering, reform or coverage; proof is pure-helper only. |
| AC-15 | Mogami/Mikuma support group with approach/hold/withdraw and player access | PARTIAL | `src/sim/battle.ts:811-814` (`setupFleet`), `:2532` (`setupSupportGroup`), `:2442` (`supportCourse`) | No check drives the support group; `check-briefing`/`check-sortie-kinds` cover surface designation generally | The group route, damaged withdrawal and designation of the actual Mogami/Mikuma are untested live; "no forced collision/sinking" is untested. |
| AC-16 | Sub patrol/intercept, endurance/tubes/evasion; seeded detection can prevent I-168 | PARTIAL | `src/sim/submarine.ts:57-141`; `src/sim/battle.ts:150` (import), submarine branch in `updateShips` (`:2075-2110`) | `scripts/check-submarine.mjs` **PASS** (pure); `scripts/check-asw.mjs` **PASS** (pure) | No Battle-level check of depth/tubes/intercept; `asw.ts` is imported nowhere, so "evade ASW" is not implemented; no seeded prevention scenario. |
| AC-17 | Distinct torpedo variants; swept hits; depth-fuzed charges | PARTIAL | `src/sim/armament.ts:73,216,372`; `src/sim/torpedo-run.ts:92-257`; `src/sim/battle.ts:2962` (`spawnTorpedo`) | `scripts/check-armament.mjs` **PASS**; `scripts/check-torpedo-run.mjs` **PASS** (pure: release, arming, depth, swept hit, screening, stamp); `scripts/check-asw.mjs` **PASS** (pure) | `Battle.spawnTorpedo` still hardcodes speed (21/17.25/24), depth `-1.6` and ttl rather than sourcing `TORPEDO_VARIANTS`; `stepRun`/`sweptHit` are used by no `src/` file; `asw.ts` `stepHunt`/`canAttack` have no caller, so no depth-charge attack exists live. |
| AC-18 | Hammann rescue + alongside assist, cancelled by threat | PARTIAL | `src/sim/rescue.ts:68-183`; `src/sim/battle.ts:26` (import), `:2137` (`updateRescue`) | `scripts/check-rescue.mjs` **PASS** (pure: early vs late recovery, flooding/fire delta, refusal "torpedo threat detected") | No check drives `Battle.updateRescue` or survivor spawning; the measurable live assistance benefit is unproven. |
| AC-19 | Carrier/recon finishable; surface/support reachable; participation; frozen debrief | PARTIAL | `src/sim/briefing.ts:121-246` (**no `src/` importer**); `src/scenes/Midway.ts:471`; `index.html:12` (four options only) | `scripts/check-briefing.mjs` **PASS**; `scripts/check-sortie-kinds.mjs` **PASS**; `scripts/check-flight.mjs` **PASS** (strike/recon recovered, surface debrief frozen) | **Fleet Support is not offered** in `index.html` (strike/recon/surface/operation only), and `briefing.ts` is imported by no `src/` file, so support and `participationEarned` are unreachable in-game; the keys-only browser sortie (`capture-sortie-runs.mjs`) was not run here. |
| AC-20 | Open Pacific continues through withdrawal/salvage; declared end conditions | PARTIAL | `src/sim/sortie.ts:403,443`; `src/sim/briefing.ts:181,214`; `src/sim/battle.ts:2033,2642` (`strikeComplete`) | `scripts/check-sortie-kinds.mjs` **PASS** (pure: four success conditions, fourth-deck continuation, observed withdrawal, one frozen conclusion) | `operationOutcome`/`pendingOpportunities` are called only from `briefing.ts`, which nothing imports; `Battle` still ends on the legacy `strikeComplete` flag and never passes `facilities`. |
| AC-21 | Natural battles seeds 19420604–08; bounded role scenarios; repeatable traces | PARTIAL | `src/sim/seeded-battle.ts`; `tools/capture-battle-roles.mjs` | `scripts/check-seeded-battle.mjs` **PASS** (pure harness: folds events, reports missing, pairs, digests, the five seeds) | `capture-battle-roles.mjs` was **not run** (browser) and is "the first half only" (natural seeds); no bounded reachability scenario is built for the roles the seeds miss; no check runs the five seeds as battles. |
| AC-22 | Real WebGPU captures of every new role at engagement/close range | PARTIAL | `tools/capture-battle-roles.mjs`; existing `capture-deck/fleet/sortie/performance/vfx/lifecycle.mjs` | Not run here (browser). Six local `screenshots/battle-role-*.png` frames exist: alongside-assist, contact-delivered, escort-engaged, scout-report, strike-launched, submarine-attack | The tool exists but was not executed in this audit; a role the seeds never see has no frame; no Kate-release/floatplane/ASW/salvage capture (those behaviours are unwired); no assertion that weapon mounts/AV cues agree with the simulation. |
| AC-23 | 1920×1080 GPU p95 ≤16.7 ms, fixed-step CPU p95 ≤4 ms, no >10% regression | PARTIAL | `src/sim/perf.ts:25-84`; `tools/capture-performance.mjs` (defaults 1920×1080/60 s, asserts both absolute gates) | `scripts/check-perf.mjs` **PASS** (pure statistics; p95 of 1..100 = 95.05); `scripts/check-ai-flight-cost.mjs` **FAIL (exit 1, 6 s)** — fixed step p95 **0.794 ms @1**, **0.941 ms @10**, **6.863 ms @68 airborne**, over the 4 ms ceiling; marginal cost 15.4 µs/aircraft (1→10) then 51.8 µs/aircraft (10→68) | The absolute CPU target fails by measurement; no GPU run or matched baseline in this audit; wall p95 is recorded but is not presentation proof. |
| AC-24 | Type/build + affected simulation/browser checks pass; restart/LOD churn; web/native proof | PARTIAL | `package.json:13-16` | `pnpm typecheck` **PASS** (exit 0, 7 s); `pnpm exec vite build` **PASS** (exit 0, 3 s, chunk-size warnings only); every node check above passes except `check-ai-flight-cost` (intentional) | `native-playtests/` does not exist although `test:native` names `native-playtests/*.playtest.json`; no `--target` proof; the restart/LOD-churn gate (`capture-lifecycle.mjs`) was not run here; native qualification is unproven. |

## What is not met

**NOT MET** — no implementing code, or code only as a pure module nothing calls.

- **AC-11 (cruiser scouts):** import `src/sim/scouting.ts` into `Battle` for Tone/Chikuma, add the
  floatplane/catapult/water-pickup path, and prove the launch→report→recovery cycle live.

**PARTIAL** — code exists but the proof is pure-module only, partial, or browser-only and not run.

- **AC-1:** add a check that the instantiated Tone and derived Mogami differ, or accept the layout
  claim as unverified.
- **AC-2:** apply or re-cut the beam repair to the shipped bytes (or delete the "beam within 2%"
  clause), and close the Yorktown/Kaga island silhouette defects.
- **AC-3:** prove AI/parked TBD/Kate identity across LOD and either accept or fix the closed
  canopy in the cockpit view.
- **AC-4:** cut a hook pivot if hook motion is claimed, and exercise the real `Battle` release
  through the render path.
- **AC-5:** add a check for AI engine flight, AI release and a power-loss glide; prove Kate level
  bombing; correct the B5N2 constants.
- **AC-7:** make the visual deck park read the inventory for both teams and assert damaged-inventory
  and diversion persistence.
- **AC-12:** call `japaneseFollowUp`/`observedCapability` from the live operation, and drive the
  Battle facility path from a check.
- **AC-13:** cover the DOM map/list consumer, and either present submerged uncertainty or drop that
  clause.
- **AC-14:** drive `steerSurface`/`reformGroup`/`coverageLost` through a `Battle` check.
- **AC-15:** test the live support-group route, damaged withdrawal and designation of the actual
  Mogami/Mikuma.
- **AC-16:** add a Battle-level depth/tube/intercept check, wire `asw.ts`, and add the seeded
  prevention scenario.
- **AC-17:** source live torpedo speed/depth/arming/range from `TORPEDO_VARIANTS`, use `torpedo-run.ts`,
  and wire ASW depth charges.
- **AC-18:** spawn survivor records on sinking and run `Battle.updateRescue`/alongside through a check.
- **AC-19:** offer Fleet Support in the briefing UI, wire `briefing.ts`/participation, and run a
  keys-only recovered sortie.
- **AC-20:** call `operationOutcome`/`pendingOpportunities` from the live operation and feed them
  `facilities`.
- **AC-21:** build the bounded reachability scenarios for missing roles, and run the five seeds as
  battles.
- **AC-22:** run `capture-battle-roles.mjs`, add the missing-role captures once the systems exist, and
  assert mounts/AV cues against the simulation.
- **AC-23:** bring fixed-step CPU p95 under 4 ms at 68 airborne or record the gap as a performance
  finding, then run the named 1920×1080/60 s GPU workload with a matched baseline.
- **AC-24:** make `check-ai-flight-cost` green, add the `native-playtests/` the script names, and state
  web/native qualification explicitly.

## Checks and what they cover

All results below were run at clean HEAD `da700c5`; `exit` is the real process status.

| Check | What it asserts | Result |
|---|---|---|
| `scripts/check-agenda.mjs` | Pure agenda helpers: priority order, commitment window, strike preconditions, CAP arithmetic, name independence, purity. | PASS (exit 0) |
| `scripts/check-ai-flight-cost.mjs` | Times real `Battle.step` at 1, 10 and 68 airborne. | **FAIL (exit 1, 6 s)** — p95 0.794 / 0.941 / **6.863 ms**, over the 4 ms ceiling (intended measurement) |
| `scripts/check-aircraft.mjs` | Procedural Douglas GLB, and the imported player TBD's 9 shipped clips, neutral return, independent instances, one visible store. | PASS (exit 0, 2 s) |
| `scripts/check-airgroup.mjs` | Pure air-group composition floors, form-up deadline, escort separation, abort reasons, Kate loadout. | PASS (exit 0) |
| `scripts/check-armament.mjs` | Four distinct torpedo variants, release envelopes, speed bands, guns by airframe. | PASS (exit 0) — 6 checks |
| `scripts/check-asw.mjs` | Pure ASW/depth-charge model (`{"pass":true}`). | PASS (exit 0, 1 s) |
| `scripts/check-audio.mjs` | Cue direction/lifecycle against a fake audio target. | PASS (exit 0) — 28 checks |
| `scripts/check-briefing.mjs` | Five briefing categories, surface-target exclusions, one real support duty, validator/map/cycle/contract agreement, retask/unavailable, purity. | PASS (exit 0) |
| `scripts/check-carrier-cycle.mjs` | Real `Battle.step` for 12 min: conservation, queued launches, inventory-driven missions, contact-only targeting, report ageing, suspension/reopen, determinism. | PASS (exit 0, **258 s**) — 102 lost, 28 cap refusals |
| `scripts/check-carrier-ops.mjs` | Pure carrier/player stores, fuel, service clocks, four suspension reasons, a real `Battle` recovery/relaunch. | PASS (exit 0, 28 s) |
| `scripts/check-damage.mjs` | Five functional ship-damage zones with class capacity. | PASS (exit 0) |
| `scripts/check-facilities.mjs` | Pure Midway facility model: ignition, burn-out, repair retention, per-kind averaging, Open Pacific gate, observation snapshot. | PASS (exit 0) — 14 checks (module now wired, but this checks the module only) |
| `scripts/check-flight.mjs` | Real `Battle`: stall limiter, launch/rotation, neutral climb-out, payload release, credit, diversion, `finalReady`, wave-off, reserve, scout report, ordered-wing late return. | PASS (exit 0, **200 s**) — wing strike recovered 706.42 s |
| `scripts/check-formation.mjs` | Pure moving-frame station keeping, wind refusal, hazard routing, reform churn, lost coverage. | PASS (exit 0) — 7 checks (pure only) |
| `scripts/check-geometry.mjs` | Pure hull/deck sizing through real `Battle`, 5 distinct datums, per-deck `finalReady`, a Yorktown diversion recovery, no render write-back. | PASS (exit 0, 16 s) |
| `scripts/check-gunnery.mjs` | Mounts fire from their own position, bow arcs, AA-only aircraft tracking, coastal guns, elevation limits. | PASS (exit 0) — 6 checks |
| `scripts/check-intel.mjs` | Pure contact delivery, dead-reckoning, uncertainty growth, observation gate, classification decay, merge. | PASS (exit 0) — 15 checks |
| `scripts/check-loops.mjs` | Packaged audio loops wrap below the seam threshold. | PASS (exit 0, 2 s) |
| `scripts/check-naval.mjs` | Pure station frame, steering limits, CPA, avoidance, task priority, hazards, rejoin, authority, rescue window. | PASS (exit 0) — 10 checks (pure only) |
| `scripts/check-perf.mjs` | Pure `perf.ts` reductions, the fixed interpolation rule, absolute-vs-relative separation, purity. | PASS (exit 0, 1 s) |
| `scripts/check-radio.mjs` | Friendly-radio alert predicates against a real `Battle`. | PASS (exit 0, 1 s) — 7 checks |
| `scripts/check-rescue.mjs` | Pure rescue/alongside model, early vs late recovery, flooding/fire benefit, threat refusal. | PASS (exit 0) (pure only) |
| `scripts/check-scouting.mjs` | Pure cruiser-scout launch gate, sectors, fuel transitions, water pickup, loss isolation. | PASS (exit 0) — 7 checks (unwired) |
| `scripts/check-seeded-battle.mjs` | Pure role-tally harness: folds events, reports missing, pairs runs, digests traces, the five seeds. | PASS (exit 0) — does not run any battle |
| `scripts/check-sortie-kinds.mjs` | Pure surface/support contract and Open Pacific end conditions, plus a live `Battle` designation/retask/credit/frozen-debrief path. | PASS (exit 0, 2 s) |
| `scripts/check-submarine.mjs` | Pure submarine depth/battery/tubes/intercept/charges. | PASS (exit 0) (pure only) |
| `scripts/check-torpedo-run.mjs` | Pure torpedo run: release, arming, depth, swept hit, escort screening, stamp, purity. | PASS (exit 0) (pure only) |
| `scripts/check-weapons.mjs` | Real `Battle` weapon/outcome events for audio: player/AI gun identity, AA mount/caliber, material/outcome. | PASS (exit 0, 1 s) — 4 checks |
| `tools/check-catalog.mjs` | Re-reads every shipped hull/weapon GLB against `catalog.ts`: dimensions, keel, triangle budget, length ≤2%. | PASS (exit 0, 2 s) — 10 hulls + 1 weapon, worst 0.050% |
| `tools/check-fleet.mjs` | Crew rig/clips, A6M3 span/prop, destroyer axis/length, atoll scale, every `fleet.json` hull's keel/orientation. | PASS (exit 0, 6 s) |
| `pnpm typecheck` | TypeScript project check. | PASS (exit 0, 7 s) |
| `pnpm exec vite build` | Production build. | PASS (exit 0, 3 s; chunk-size warnings only) |

**Browser gates — deliberately not run in this audit** (the task forbids `capture-lock.sh`,
`capture-*.mjs` and `check-repair.mjs`): `capture-deck.mjs`, `capture-fleet.mjs`,
`capture-sortie.mjs`, `capture-sortie-runs.mjs`, `capture-performance.mjs`, `capture-vfx.mjs`,
`capture-lifecycle.mjs`, `capture-player-aircraft.mjs`, `capture-battle-roles.mjs`,
`capture-fluid-lab.mjs`, `capture-audio.mjs`, `capture-ripples.mjs`, `check-repair.mjs`, and
`playtests/launch.playtest.json`. Their existence is recorded above; no result is claimed for them here.

## Known defects, recorded not hidden

**`docs/remaining-asset-battle-failures.md`** pauses on two deferred failures and then records a
resolution:

- **The imported TBD cockpit intersected the fused airframe.** At HEAD the cockpit seats the eye via
  `TBD_COCKPIT_POSITION = [0, 2.712, -3.182]` (`src/render/imported-aircraft.ts:33,480`); the
  document records the eye sitting 0.20–0.30 m above the closed canopy roof (a down-forward ray
  meets the opaque `airframebody` at 0.955 m). The *uncommitted* fix lowers it to
  `[0, 2.2116, -3.182]`; the shipped model still has no modelled cockpit opening, and the
  instrument panel remains the shared SBD panel. AC-3's type-correct TBD cockpit/canopy remains a
  separate asset item.
- **The ordered-wing strike / late assisted return.** The failing assertion was
  `scripts/check-flight.mjs:457` with earlier `result: null`. The resolution records clean HEAD
  `4575f0c` recovering: objective true, elapsed **706.42 s** (≤720), `wingHits 1`,
  `personalHits 0`, carrier USS Enterprise — which this audit's own 200 s run reproduces
  (706.416666666326 s). It notes a keys-only browser run recovered the recon at 263.83 s and the
  ordered-wing strike at 594.98 s with nothing injected. The document explicitly warns the earlier
  snapshot was not proof for clean HEAD, and this audit confirms the current tree is green.

**`docs/startup-and-resolution.md`** investigates two user reports:

- **Startup takes many seconds.** The launch playtest reports readiness at 7.1–8.0 s, split roughly
  `loadStartedMs ≈ 700`, `enteredMs ≈ 4100`, `compileSettledMs ≈ 8000`, i.e. ≈3.4 s of asset
  load/world build and ≈3.9 s of first-use pipeline compilation. It measures 189,356,250 bytes
  (≈180.6 MiB) of eager assets, of which 16,090,448 bytes are loaded but never instantiated
  (`destroyer.samidare.glb`, `b25-mitchell.glb`, `weapon.torpedo.glb`; `cruiser.mogami.glb` *is*
  used). The offered fix is to stop loading the three unused assets and decimate the overweight TBD
  and Yorktown; streaming later assets is listed as a design decision, not a recommendation.
- **Resolution deteriorates over time — an engine defect.** The one-way ratchet is real but lives
  in `RenderChain.observeFrameBudget` (`nextLowerTier`, no upward counterpart), **not** in
  `ResolutionScaler` as the original triage named; `ResolutionScaler` does have an upward path and
  an `auto-pinned` oscillation guard. `RenderChain`'s ratchet is dormant in this game because no
  `tier: "auto"` chain is constructed; `ResolutionScaler` is the live controller
  (`resolutionScale: "auto"`). The fix belongs in `@threenative/core`, and the precise class to fix
  must be confirmed first. Most timings in the document were reported, not measured (the host was
  loaded), and it says so.
