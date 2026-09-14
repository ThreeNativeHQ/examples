# PRD-midway-asset-battle-integration — acceptance status

Read-only audit. Every AC-1..AC-24 in `docs/PRDs/PRD-midway-asset-battle-integration.md` is judged
against the code in this working tree and against checks that were **actually executed**. No browser
gate, `tools/capture-*.mjs`, `tools/capture-lock.sh` or `tools/check-repair.mjs` was run.

Tree audited: `HEAD` `d562f5e`, plus uncommitted working edits. The tree moved during the audit: at the
start it showed only `docs/PRDs/...`, `src/sim/tactics.ts` (deck-departure flaps `0.33→0.6`, late
rotation pitch) and this file; by the end a second lane had also flagged `index.html`,
`src/sim/flight.ts`, `src/style.css` and `tools/capture-sortie.mjs`. Line numbers below match the tree
as read during the audit. The uncommitted `src/sim/tactics.ts` change is a candidate cause of the two
red checks below.

Verdict rule: **MET** only when code exists *and* an executed check proves the criterion; **PARTIAL**
when the code exists but the only proof is partial, is a browser gate that was not run, or no check
exists; **NOT MET** when the implementing code is absent, or exists only as a pure module no `src/`
file calls.

Two of the twenty permitted checks are red on this tree:
`scripts/check-flight.mjs` (`exit 1`) and `scripts/check-carrier-cycle.mjs` (`exit 1`). Any AC whose
only proving check is one of those is therefore not MET, however much code exists.

## Acceptance criteria

| AC | Summary | Verdict | Implementing code (path:line) | Proving check + real result | What is missing |
|---|---|---|---|---|---|
| AC-1 | Inventory disposition/provenance; Tone≠Mogami; Kagerō resolved | MET | `src/sim/catalog.ts:111-125` (Mogami derived), `:126-140` (Kagerō); `tools/blender/fleet.json`; `docs/asset-provenance.md`; `tools/blender/derive-mogami.py` | `node tools/check-catalog.mjs` PASS — 10 hulls + 1 weapon, worst length error 0.050%; `node tools/check-fleet.mjs` PASS — Mogami 51,311 tris vs Tone 47,991, `destroyer.kagero` 118.5 m | Rights are recorded only as UNVERIFIED; no allowed check parses `docs/asset-provenance.md`. |
| AC-2 | Endpoints validated; length/span/beam ≤2%; 0.1 m stations; visual class check | PARTIAL | `src/sim/catalog.ts:36-94`; `src/sim/math.ts:57-81` (two-box `overHull`); `tools/measure-decks.mjs`; `src/render/world.ts` draught sink | `tools/check-catalog.mjs` PASS but asserts **length only**; `tools/check-fleet.mjs` PASS (keel 0, orientation). The 0.1 m station survey is asserted only by `tools/capture-deck.mjs`, a browser gate **not run**. | Beam-vs-reference is never checked: Kaga `measuredBeam 53.93` vs `hullBeam 32.5` (`catalog.ts:41,45`, 66% over); the check compares `measuredBeam` to the GLB's own X only. The visual-silhouette half is unproven and the PRD keeps AC-2 unticked, naming two model defects (Yorktown island straddles centreline; Kaga island inboard). |
| AC-3 | Briefing TBD in deck/chase/cockpit; AI/parked correct airframes; no Dauntless fallback | PARTIAL | `src/render/imported-aircraft.ts:347-358` (explicit id, throws on unknown); `src/render/world.ts:278,296,624`; `src/scenes/Midway.ts:460` | `scripts/check-aircraft.mjs` PASS, but it parses only the procedural SBD (`public/assets/aircraft.douglas-sbd3.glb`); no allowed check covers the imported TBD/Kate, the briefing→view path, or LOD identity. | A check proving selection→deck/chase/cockpit and AI/parked airframe identity across LOD. |
| AC-4 | Prop/gear/hook/surface motion; independent instances; one store per release | PARTIAL | `src/render/imported-aircraft.ts:439-455` (`spinPropeller`, per-instance angle); `src/sim/battle.ts:937-998` launch/`releaseOrdnance` | `scripts/check-aircraft.mjs` PASS (SBD only: independent controls/clones, neutral release, throttle stop). `scripts/check-flight.mjs` FAILED at `:114` (below) — its payload assertions at `:92-105` printed, but the file exits 1. | Only the propeller is a separate pivot; gear/hook/flaps stay fused (PRD Phase 1 gap #1). No check for imported TBD/Kate moving parts. |
| AC-5 | Through `Battle.step`: AI engine flight, legal release/recovery, Kate level bombing, damage | PARTIAL | `src/sim/tactics.ts:225-268` (`flightOf`/`flyAircraft`), `:276-341` (`deckDeparture`); `src/sim/flight.ts:146+` (`AircraftFlight`); old `steerAircraft` integrator is gone | `scripts/check-flight.mjs` **FAILED**: `TypeError: Cannot read properties of null (reading 'id')` at `scripts/check-flight.mjs:114` (`Battle.launch(home,"bomber")` returned null → `wingman.id`), exit 1. Four launch JSON lines printed before the crash. No check exercises AI engine flight/recovery or a power-loss glide. | A green end-to-end check; Kate level-bombing path is not separately proven. |
| AC-6 | Pure init geometry; recovery/diversion agrees with `finalReady`/HUD and geometry | MET | `src/sim/battle.ts` init; `src/sim/recovery.ts:95-108` (`finalReady`); `src/sim/math.ts:57-81` (`onDeck`/`overHull`); `src/render/world.ts` | `scripts/check-geometry.mjs` PASS — 17 hulls sized before any render, 5 distinct deck datums, a guided diversion recovers on Yorktown under its own datum, cue == gate, `WorldView` writes nothing back, 12 render modules assign no geometry field. | Only Yorktown is exercised as the diversion deck; drawn-vs-sim per-hull agreement is AC-2's burden. |
| AC-7 | Cycles conserve airframes, spend once, respect occupancy, no spend on blocked launch | PARTIAL | `src/sim/carrier-ops.ts`; `src/sim/battle.ts:937-998` (`launch`), `updateCarrier` | `scripts/check-carrier-ops.mjs` PASS (50 cycles conserved, one store per launch, recovery restores none, blocked launch rejected). `scripts/check-carrier-cycle.mjs` **FAILED** at `:142` — `AssertionError: the 68-aircraft cap was never reached in twelve minutes of operations`, exit 1, 79 s. | A green `check-carrier-cycle` run (conservation over 12 min and queued-launch-no-spend after `:142` unproven); visual deck park vs inventory; damaged-inventory/diversion persistence. |
| AC-8 | Inputs change the next mission; CAP vs escort; no modulo/name rule | PARTIAL | `src/sim/tactics.ts:70-124` (`strikeContact`, `chooseCarrierMission`); `src/sim/battle.ts:1100-1134` | `scripts/check-carrier-cycle.mjs` **FAILED** at `:142`, so its section 3 assertions (stores/ready/contacts/modulo/rename) never ran. | A green `check-carrier-cycle` run. |
| AC-9 | Suspension with readable reasons; limited reopen without restoring hull/stores | PARTIAL | `src/sim/carrier-ops.ts` (`suspendReason`, `canRecover`); `src/sim/battle.ts` (`deckSuspension`, `refreshDeck`) | `scripts/check-carrier-ops.mjs` PASS — four readable reasons (`evading`, `heavy list`, `fire in the landing corridor`, `deck damage`) and suspension refuses launch and recovery. The reopen-without-restore assertions are in `check-carrier-cycle.mjs:320-353`, which never ran (fails at `:142`). | A green reopen test through `Battle.step`. |
| AC-10 | Unobserved never a precise target; dated/stale reports; dead scout's sent report still arrives | PARTIAL | `src/sim/intel.ts`; `src/sim/battle.ts:1168` (`observeFleet`), `:1237` (`deliverReports`), `:1715-1716`; `src/sim/tactics.ts:70` (`strikeContact`) | `scripts/check-intel.mjs` PASS (15 pure checks: delivery, dead-reckoning, uncertainty, observe gate, classification, merge). The Battle-level targeting assertions are `check-carrier-cycle.mjs:242-318`, which never ran. | A green Battle-level proof of contact-only targeting, ageing and scout death. |
| AC-11 | Tone/Chikuma launch/recover a finite scout that reports and can be intercepted | PARTIAL | `src/sim/scouting.ts` (pure); `src/sim/battle.ts` does not import it | `scripts/check-scouting.mjs` PASS (7 checks) — pure module only. | `scouting.ts` is imported by nothing in `src/`; no live cruiser scout, floatplane geometry, catapult or water pickup. |
| AC-12 | Functional island facilities; Japanese follow-up from observed capability | PARTIAL | `src/sim/facilities.ts` (pure); `src/sim/sortie.ts:6` imports `baseAviationLost` only, and `operationOutcome` is called by no `src/` file | `scripts/check-facilities.mjs` PASS (14 checks) — pure module only. | No facility entities or facility hit path in `Battle`; no follow-up mission driven by observed capability. |
| AC-13 | One target contract across map/cycle/orders; submerged uncertainty | PARTIAL | `src/sim/sortie.ts:163-247` (`targetEligible`); `src/sim/battle.ts`; `src/scenes/Midway.ts` | `scripts/check-sortie-kinds.mjs` PASS (pure contract; release stamp, pending, retask, participation, one validator). `check-carrier-cycle.mjs:254` (unobserved fleet is not a target) never ran. | Map selection and target cycling are not migrated to `targetEligible`/`eligibleTargets`; submerged contacts not offered. |
| AC-14 | Formation, hazard avoidance, detach/rejoin, protective coverage | NOT MET | `src/sim/naval.ts` and `src/sim/formation.ts` (pure); no `src/` importer | `scripts/check-naval.mjs` PASS (10 pure helper checks) — pure modules only. | `Battle.updateShips` still moves each hull straight from its own heading; no station offsets, hazards, detach/rejoin or coverage in the live game. |
| AC-15 | Mogami/Mikuma support group with approach/hold/withdraw and player access | NOT MET | none in `Battle`; `src/sim/catalog.ts:111` only defines the class | No check. | `Battle.setupFleet` (`src/sim/battle.ts:600-616`) creates Tone/Chikuma but no Mogami/Mikuma; no route, damage/escape behaviour or designation. |
| AC-16 | Sub patrol/intercept, endurance/tubes/evasion; seeded detection can prevent I-168 | NOT MET | `src/sim/submarine.ts` (pure); `Battle` still sine-surfaces | `scripts/check-submarine.mjs` PASS (`pass:true`) — pure module only. | `src/sim/battle.ts:1766` still sine-surfaces boats and `:1777` fires a fixed three-torpedo spread; depth, battery, tubes, evasion and a seeded prevention scenario are absent live. |
| AC-17 | Distinct torpedo variants; swept hits; depth-fuzed charges | PARTIAL | `src/sim/armament.ts` (variants, envelopes, guns); `src/sim/submarine.ts` (charge math, pure) | `scripts/check-armament.mjs` PASS (4 variants, envelopes, guns by airframe); `scripts/check-submarine.mjs` PASS (pure charge damage). | No ASW depth-charge attack or swept-hull hit in `Battle`; `submarine.ts` has no Battle importer. |
| AC-18 | Hammann rescue + alongside assist, cancelled by threat | NOT MET | `src/sim/rescue.ts` (pure); no `src/` importer | `scripts/check-rescue.mjs` PASS (`pass:true`) — pure module only. | `Battle` spawns no survivors and has no alongside behaviour or assistance benefit. |
| AC-19 | Carrier/recon finishable; surface/support reachable; participation; frozen debrief | PARTIAL | `src/sim/sortie.ts:50-79` (5 assignments, 4 duties), `:312` (`feasibleSupportDuties`); `src/sim/battle.ts:500-504` (`selectAssignment`); `index.html:12` | `scripts/check-sortie-kinds.mjs` PASS (pure: 5 assignments, 7 hulls, 4 duties, stamp/pending/retask/participation/validator). `scripts/check-flight.mjs` FAILED at `:114`, so its completion/frozen-result tests did not pass. | The briefing select (`index.html:12`) offers only strike/recon/operation — no `surface`/`support`; `feasibleSupportDuties` and the support/operation end-conditions are called by no `src/` file. |
| AC-20 | Open Pacific continues through withdrawal/salvage; declared end conditions | PARTIAL | `src/sim/sortie.ts:403-463` (`operationOutcome`, `pendingOpportunities`) | `scripts/check-sortie-kinds.mjs` PASS (pure: four success conditions, fourth-disabled-deck continuation, observed withdrawal, honest frozen conclusion, base-aviation loss). | `operationOutcome`/`pendingOpportunities` are imported by no `src/` file (rg-confirmed), and `Battle` never passes `facilities`, so the declared conditions do not govern the live operation. |
| AC-21 | Natural battles for seeds 19420604–08; bounded role scenarios; repeatable traces | NOT MET | `src/sim/battle.ts` seeded RNG only | `check-carrier-cycle.mjs` determinism section (`:355-365`) never ran (fails at `:142`). `tools/capture-battle-roles.mjs` does not exist. | Natural-battle role report for the five seeds; bounded reachable-role scenarios; paired interventions. |
| AC-22 | Real WebGPU captures of every new role at engagement/close range | NOT MET | capture tools exist (`tools/capture-deck.mjs`, `capture-fleet.mjs`, `capture-sortie.mjs`, `capture-performance.mjs`) | No permitted node check; browser gates were not run under this audit's constraints, so nothing is verified. | Captures of player TBD, Kate release, all hull classes, floatplane, ASW and salvage, with mount/AV-cue assertions. |
| AC-23 | 1920×1080 GPU p95 ≤16.7 ms, Battle fixed-step CPU p95 ≤4 ms, no >10% regression | NOT MET | `tools/capture-performance.mjs` only | Browser gate not run; no node check covers GPU/CPU timing. | Fixed-step CPU instrumentation, p95 thresholds, a matched baseline and the named 1920×1080/60 s workload. |
| AC-24 | Type/build + affected simulation/browser checks pass; restart/LOD churn clean; web/native proof | NOT MET | — | Two affected simulation checks are red: `scripts/check-flight.mjs` exit 1 at `:114`; `scripts/check-carrier-cycle.mjs` exit 1 at `:142`. `pnpm typecheck`/`vite build` were not run (outside this audit's permitted command set). | Green affected checks; a completed restart/LOD-churn run; explicit web/native qualification. |

## What is not met

**NOT MET** — no implementing code, or code only as a pure module nothing calls.

- **AC-14 (surface groups):** call `src/sim/naval.ts`/`formation.ts` from `Battle.updateShips` for
  station-keeping, hazard avoidance, detach/rejoin and coverage.
- **AC-15 (Mogami group):** add the Mogami/Mikuma entities to `setupFleet`, give them a route, and make
  them designatable and attackable.
- **AC-16 (submarines):** replace the sine surfacing and fixed spreads in `Battle` with
  `submarine.ts` depth/tube/evasion behaviour, and add the seeded prevention scenario.
- **AC-18 (Hammann rescue/assist):** spawn survivor records on sinking and run the pure `rescue.ts`
  alongside/assist path through `Battle`.
- **AC-21 (combined battle proof):** create `tools/capture-battle-roles.mjs`, run the five named seeds
  and report roles, and add the bounded reachable-role scenarios.
- **AC-22 (role captures):** capture each new role once the systems exist, and assert mounts/AV cues
  against the simulation.
- **AC-23 (performance):** instrument fixed-step CPU duration and assert the p95/baseline targets at
  1920×1080 for 60 s.
- **AC-24 (integration gate):** make `check-flight` and `check-carrier-cycle` green, then run the
  restart/LOD-churn gate and state web/native qualification.

**PARTIAL** — code exists but the proof is partial or absent.

- **AC-2:** check beam against the class reference (or delete the ≤2% beam clause), and resolve the two
  named hull defects (Yorktown island over the centreline, Kaga island inboard); the 0.1 m survey
  currently lives only in an un-run browser gate.
- **AC-3:** add a check that proves briefing selection and AI/parked airframe identity across LOD for the
  imported TBD/Kate.
- **AC-4:** cut and animate the gear/hook/flap pivots on the imported aircraft and add a moving-part
  check.
- **AC-5:** get `check-flight.mjs` green and add a check for AI engine flight, AI release and a
  power-loss glide; prove the Kate level-bombing path.
- **AC-7:** get `check-carrier-cycle.mjs` green (the 68-aircraft cap is never reached) and assert the
  visual deck park matches inventory.
- **AC-8:** get `check-carrier-cycle.mjs` green so the mission-input, modulo and rename assertions run.
- **AC-9:** get `check-carrier-cycle.mjs` green so the suspend/reopen-without-restore assertions run.
- **AC-10:** get `check-carrier-cycle.mjs` green so contact-only targeting, ageing and scout death are
  proven through `Battle`.
- **AC-11:** wire `scouting.ts` into `Battle` for Tone/Chikuma and add a live floatplane.
- **AC-12:** create facility records in `Battle`, route hits into them, and drive the follow-up mission
  from observed capability.
- **AC-13:** migrate map selection, cycling and the HUD list to the `targetEligible` contract.
- **AC-17:** wire the torpedo variants and ASW depth-charge/swept-hit path into `Battle`.
- **AC-19:** offer `surface`/`support` in the briefing and wire `feasibleSupportDuties` plus
  participation; complete a keys-only recovered sortie check.
- **AC-20:** call `operationOutcome`/`pendingOpportunities` from the live operation and feed it
  `facilities`.

## Checks and what they cover

Every line was executed on this tree; `exit` is the real process status.

- `scripts/check-flight.mjs` (**exit 1**) — Battle flight, launch, release/credit, assignments, recovery,
  diversion and short-sortie outcomes. Failed with `TypeError: Cannot read properties of null (reading
  'id')` at `:114`; four loadout launch lines printed before the crash.
- `scripts/check-aircraft.mjs` (exit 0) — procedural Douglas SBD GLB geometry/tracks: 12 clips,
  un-interleaved attributes, 12.66 m span, clone/control independence, neutral release, throttle stop,
  separate vertex layout; final line "Aircraft check passed".
- `scripts/check-weapons.mjs` (exit 0) — real-Battle gun/AA/explosion event identity and outcomes;
  4 checks passed.
- `scripts/check-loops.mjs` (exit 0) — audio loop-seam wrap ratio; 38 loops measured, all below the
  seam threshold.
- `scripts/check-radio.mjs` (exit 0) — friendly-radio alert predicates against real Battle; 7 checks
  passed.
- `scripts/check-audio.mjs` (exit 0) — soundscape cue direction and lifecycle against a fake audio
  target; 25 checks passed.
- `scripts/check-geometry.mjs` (exit 0) — pure-Battle hull/deck sizing, 5 distinct datums,
  `onDeck`/`overHull`, per-deck `finalReady`, a Yorktown diversion recovery and no render write-back;
  all checks passed.
- `scripts/check-intel.mjs` (exit 0) — pure contact delivery, dead-reckoning, uncertainty growth,
  observation gate, classification decay and merge; 15 checks passed.
- `scripts/check-naval.mjs` (exit 0) — pure station frame, steering limits, closest approach, avoidance,
  task priority, hazard circles, rejoin and authority; 10 checks passed.
- `scripts/check-carrier-ops.mjs` (exit 0) — pure carrier/player stores, fuel, service clocks,
  suspension reasons and a real Battle recovery/relaunch; passed.
- `scripts/check-submarine.mjs` (exit 0) — pure submarine depth/hydrophone/tubes/depth-charge model;
  `{"pass":true}`.
- `scripts/check-facilities.mjs` (exit 0) — pure facility ignition, burn-out, repair, capability
  averaging, open-pacific gate, observation and follow-up; 14 checks passed.
- `scripts/check-armament.mjs` (exit 0) — four distinct torpedo variants, release envelopes, m/s speed
  bands and per-airframe gun batteries; 6 checks passed.
- `scripts/check-sortie-kinds.mjs` (exit 0) — pure assignment/stamp/pending/retask/participation
  contract, one target validator and the Open Pacific end conditions; passed (5 assignments, 7 hulls,
  4 duties).
- `scripts/check-damage.mjs` (exit 0) — five functional ship-damage zones with class capacity; passed.
- `scripts/check-scouting.mjs` (exit 0) — pure cruiser-scout launch gate, sectors, fuel legs, pickup
  envelope, capacity and report preservation; 7 checks passed (module unwired).
- `scripts/check-rescue.mjs` (exit 0) — pure rescue/alongside damage-control model; `{"pass":true}`
  (module unwired).
- `scripts/check-carrier-cycle.mjs` (**exit 1**, **79 s**) — Battle-level conservation, active-cap
  refusal, inventory-driven missions, contact-only targeting, report ageing, suspension/reopen and
  determinism. Failed at `:142` with `AssertionError: the 68-aircraft cap was never reached in twelve
  minutes of operations`; the 12-minute conservation run itself completed and its earlier assertions
  passed, but the file exits non-zero.
- `tools/check-catalog.mjs` (exit 0) — re-reads shipped hull/weapon GLBs against `src/sim/catalog.ts`:
  measured dimensions, keel datum, triangle budget and reference length ≤2%; 10 hulls + 1 weapon, worst
  length error 0.050%.
- `tools/check-fleet.mjs` (exit 0) — shipped crew clips/skeleton, A6M3 span/prop, destroyer axis/length,
  atoll scale and every named hull's keel/one-mesh/one-material/orientation; PASS.
