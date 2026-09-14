# PRD-midway-asset-battle-integration — acceptance status

Read-only audit. Every AC-1..AC-24 in `docs/PRDs/PRD-midway-asset-battle-integration.md` is judged
against the code in this working tree and against checks that were **actually executed**. Nothing in
the game was edited to produce this document.

## How to read this, given the tree is changing under it

A second lane is actively implementing Phases 3–5 in this checkout. During the audit `HEAD` moved
through `c13e184 → 53deda0 → b192171 → d562f5e → 0b805c8 → 6d7ae4 → 1bde9a1`; new files
(`scouting.ts`, `rescue.ts`, `asw.ts`, `formation.ts`, `check-scouting/rescue/asw/formation/gunnery/agenda.mjs`)
appeared, the check suite grew from 24 to 30 files, and the PRD itself was rewritten (its AC-2 entry
went from "NOT MET, 29 disagreements" to "0 disagreements"). **Any single result here is a snapshot, not
a guarantee.** Two revisions were therefore used:

- **Node checks — current.** Re-run against the live tree across the window `HEAD 6d7ae4 → 1bde9a1`.
  The tree advanced mid-run; treat the results as "at `1bde9a1`".
- **Browser gates — frozen snapshot.** Run against `/tmp/opencode/prdcheck`, an rsync of the working
  tree based on `53deda0` plus its uncommitted edits at `2026-09-14T00:46Z`, served on
  `127.0.0.1:5391`. The browser gate results are labelled as such below.

Verdict rule: **MET** only when code exists *and* an executed check proves the criterion; **PARTIAL**
when code exists but the proof is partial, is a browser gate not run against the current tree, or does
not exist; **NOT MET** when the implementing code is absent, or exists only as a pure module that no
`src/` file calls.

**Two checks are red or un-runnable in the current node suite, and one browser gate fails in the
snapshot.** `scripts/check-flight.mjs` is **exit 1** (observed red at `0b805c8` and again at
`1bde9a1`). `scripts/check-carrier-cycle.mjs` was **exit 1** at `0b805c8` (`:299`) and **exit 0** at
`1bde9a1` — the lane fixed it while the audit ran; only its final green run is counted, with that
history noted. `tools/capture-sortie-runs.mjs` is **FAIL (exit 1)** on the snapshot: the keys-only
strike run lost the aircraft. `tools/check-humanoid.mjs` exits 1 only because it requires a GLB
argument; it is a helper, not a gate.

## Acceptance criteria

| AC | Summary | Verdict | Implementing code (path:line) | Proving check + real result | What is missing |
|---|---|---|---|---|---|
| AC-1 | Inventory disposition/provenance; Tone≠Mogami; Kagerō resolved | PARTIAL | `docs/asset-provenance.md:14-122`; `tools/blender/fleet.json`; `tools/blender/derive-mogami.py:4-61`; `src/sim/catalog.ts:111-124` | `tools/check-catalog.mjs` **PASS** (10 hulls + 1 weapon, worst length 0.050%); `tools/check-fleet.mjs` **PASS**; `tools/check-asset-polish.mjs` **PASS** (all current HEAD). | Mogami is never instantiated: `Battle.setupFleet` (`src/sim/battle.ts:600-616`) creates Tone/Chikuma but no Mogami/Mikuma, so "Tone and Mogami display genuinely different layouts" is unproven in-game. Rights remain UNVERIFIED (permitted by the PRD). |
| AC-2 | Endpoints validated; length/span/beam ≤2%; 0.1 m stations; visual check | PARTIAL | `src/sim/catalog.ts:41-94`; `src/sim/math.ts:57-81` (two-box `overHull`); `tools/measure-decks.mjs`; `src/render/world.ts` draught sink | `tools/capture-deck.mjs` **PASS — 0 disagreements** (4 imported carriers, no console errors; frozen snapshot). `tools/check-catalog.mjs` **PASS** but asserts **length** against the reference; `tools/check-fleet.mjs` **PASS**. | **Beam is not within 2%.** The GLBs are 30–66% wider than the class reference and the "repair" is declared sim data, not applied to the model bytes: Kaga `measuredBeam 53.93` vs `hullBeam 32.50` (`catalog.ts:41,45`); Hammann 20.14 vs 11.00. `tools/check-catalog.mjs` compares `measuredBeam` to the GLB's own X only. The 0.1 m bound holds only at the datum (the centre of the deck's elevation range) with sheer allowed to 2 m — Hiryu's worst station is 0.834 m. The visual-silhouette half is unproven. |
| AC-3 | Player TBD in deck/chase/cockpit; AI/parked correct airframes; no Dauntless fallback | PARTIAL | `src/render/world.ts:296-305` (player), `:25-34`/`:266-278` (`importedAircraftFor`, parked); `src/scenes/Midway.ts:423`; `src/render/imported-aircraft.ts:347-422` | No executed check proves in-game identity. `tools/check-asset-polish.mjs` **PASS** proves the GLB bytes only; `scripts/check-aircraft.mjs` **PASS** covers only the procedural Douglas. | Player TBD is the **procedural** `makeDauntless(true)` variant, not `aircraft.tbd-devastator.glb`; Midway labels it "PROCEDURAL TBD-INSPIRED MODEL". AI TBD/Kate are also procedural. No check of briefing→view identity or AI/parked LOD identity. |
| AC-4 | Prop/gear/hook/surface motion; independent instances; one store per release | PARTIAL | `src/render/imported-aircraft.ts:439-455`; `src/render/dauntless.ts:563-592`; `src/render/world.ts:415-426`; `src/sim/battle.ts:937-998` | `tools/check-asset-polish.mjs` **PASS** (the GLBs carry 9 moving clips). `scripts/check-flight.mjs` is **RED (exit 1)** at `:457` (`lost` vs `recovered`), so its payload/recovery assertions do not pass on the current tree. | `createAirframe` builds no mixer for imports, so `gear.retract`, `flaps.deploy`, `flight.*` are dead bytes in play — only the propeller spins. No hook/gear/surface check for the shipped TBD/Kate in the running game. |
| AC-5 | Through `Battle.step`: AI engine flight, legal release/recovery, Kate level bombing, damage | PARTIAL | `src/sim/tactics.ts:223-233,308` (`flightOf`/`deckDeparture`); `src/sim/flight.ts:146-216` (`AircraftFlight`); old `steerAircraft` integrator is gone | `scripts/check-flight.mjs` **RED (exit 1)** at `:457`. No check exercises AI engine flight, AI release, AI recovery or a power-loss glide. | A green end-to-end flight check; Kate level bombing is absent; B5N2 constants are still span 14.9 / wingArea 34.6 (`flight.ts:125-127`) against the PRD's 15.5 / 37.7. |
| AC-6 | Pure init geometry; recovery/diversion agrees with `finalReady`/HUD and geometry | MET | `src/sim/battle.ts:126-231,549-618`; `src/sim/recovery.ts:95-108`; `src/sim/math.ts:57-81` | `scripts/check-geometry.mjs` **PASS** — 17 hulls sized before any render, 5 distinct deck datums, a guided diversion recovers on Yorktown under its own datum, cue == gate, `WorldView` writes nothing, 12 render modules assign no geometry field. | Only Yorktown is exercised as the diversion deck; drawn-vs-sim per-hull agreement is AC-2's burden. |
| AC-7 | Cycles conserve airframes, spend once, respect occupancy, no spend on blocked launch | PARTIAL | `src/sim/carrier-ops.ts:111-236`; `src/sim/battle.ts:937-998,1042-1084,1806-1874` | `scripts/check-carrier-ops.mjs` **PASS** (50 cycles conserved, one store per launch, recovery restores none, blocked launch rejected). `scripts/check-carrier-cycle.mjs` **PASS at `1bde9a1`** (12 min, 97 lost, 285 cap refusals, all airframes accounted; was **RED** at `0b805c8` `:299`). | "The visual deck park matches the inventory" is unproven, and only US hulls park anything (`src/render/world.ts:277-282`); damaged-inventory/diversion persistence is not asserted. |
| AC-8 | Inputs change the next mission; CAP vs escort; no modulo/name rule | MET | `src/sim/tactics.ts:95-124`; `src/sim/battle.ts:1100-1134` | `scripts/check-carrier-cycle.mjs` **PASS at `1bde9a1`**: Kaga 6→0 Kates with no torpedoes, a delivered contact raises JP strikes, the modulo sequence is excluded, renaming Hiryu→Unryu is a no-op. | — |
| AC-9 | Suspension reasons; limited reopen without restoring hull/stores | MET | `src/sim/carrier-ops.ts:238-257`; `src/sim/battle.ts:912-929` | `scripts/check-carrier-ops.mjs` **PASS** (four reasons); `scripts/check-carrier-cycle.mjs` **PASS at `1bde9a1`** (fire in the corridor 358 s, then limited ops at 113/340 hull, not restored). | — |
| AC-10 | Unobserved never precise; dated/stale reports; dead scout's sent report arrives | MET | `src/sim/intel.ts:12-177`; `src/sim/battle.ts:1168,1237,1705-1719,2386`; `src/sim/tactics.ts:70` | `scripts/check-intel.mjs` **PASS** (15 checks); `scripts/check-carrier-cycle.mjs` **PASS at `1bde9a1`** (no target before observation, dead scout still delivers, stale estimate 196 s / ±1103 m). | "Stale information changes search behaviour" is only implicit (no-contact → recon), not asserted. |
| AC-11 | Tone/Chikuma launch/recover a finite scout that reports and can be intercepted | NOT MET | `src/sim/scouting.ts:12-208` (pure); **no `src/` importer** | `scripts/check-scouting.mjs` **PASS** (7 checks) — pure module only. | `scouting.ts` is imported by nothing in `src/`; `Battle.launchRecon` still spawns a hardcoded Catalina; no cruiser floatplane geometry, catapult, water pickup or Battle/capture test. |
| AC-12 | Functional island facilities; Japanese follow-up from observed capability | NOT MET | `src/sim/facilities.ts:8-189` (pure); `src/sim/sortie.ts:6` imports `baseAviationLost` only | `scripts/check-facilities.mjs` **PASS** (14 checks) — pure module only. | No facility entities or facility hit path in `Battle`; `battle.island` is inert geometry; no follow-up mission driven by observed surviving capability. |
| AC-13 | One target contract across map/cycle/orders; submerged uncertainty | PARTIAL | `src/sim/sortie.ts:167-247`; `src/sim/battle.ts:1313-1332`; `src/scenes/Midway.ts:478-489`; `src/hud.ts:691` | `scripts/check-sortie-kinds.mjs` **PASS** (pure contract: stamp, pending, retask, participation, one validator). | Map selection and cycling filter `kind === "carrier"` only (`Midway.ts:479`, `hud.ts:691`); submerged contacts are never offered; the UI consumers were not migrated to `targetEligible`/`eligibleTargets`. |
| AC-14 | Formation, hazard avoidance, detach/rejoin, protective coverage | NOT MET | `src/sim/naval.ts:66-275`, `src/sim/formation.ts` (both pure); **no `src/` importer** | `scripts/check-naval.mjs` **PASS** (10 checks); `scripts/check-formation.mjs` **PASS** (7 checks) — pure modules only. | `Battle.updateShips` still moves each hull straight from its own heading (`battle.ts:1742-1787`); no station offsets, hazards, detach/rejoin or coverage in the live game. |
| AC-15 | Mogami/Mikuma support group with approach/hold/withdraw and player access | NOT MET | `src/sim/catalog.ts:111` (class only); `src/render/imported-fleet.ts:294` | No check. | `Battle.setupFleet` (`battle.ts:600-616`) creates no Mogami/Mikuma; no route, damage/escape behaviour or designation. |
| AC-16 | Sub patrol/intercept, endurance/tubes/evasion; seeded detection can prevent I-168 | NOT MET | `src/sim/submarine.ts`, `src/sim/asw.ts` (pure); `Battle` still sine-surfaces | `scripts/check-submarine.mjs` **PASS**; `scripts/check-asw.mjs` **PASS** (`{"pass":true}`). | `battle.ts:1767` still sine-surfaces boats and `:1778` fires a fixed three-torpedo spread; no depth/battery/tubes/evasion live; no seeded prevention scenario. |
| AC-17 | Distinct torpedo variants; swept hits; depth-fuzed charges | PARTIAL | `src/sim/armament.ts:191-216,73-92`; `src/sim/submarine.ts`, `src/sim/asw.ts` (pure charges) | `scripts/check-armament.mjs` **PASS** (4 variants, envelopes, guns by airframe); `scripts/check-submarine.mjs` **PASS**; `scripts/check-asw.mjs` **PASS**. | `spawnTorpedo` hardcodes speed, `armedDistance`, a constant `y:-1.6` and ttl, ignoring `TORPEDO_VARIANTS`; one `makeTorpedoModel` is reused for every weapon; no ASW depth-charge attack in `Battle`. |
| AC-18 | Hammann rescue + alongside assist, cancelled by threat | PARTIAL | `src/sim/rescue.ts` (pure; appeared mid-audit); `src/sim/naval.ts` rescue window | `scripts/check-rescue.mjs` **PASS** (`{"pass":true}`; refusal "torpedo threat detected"). | `rescue.ts` is imported by no `src/` file; `Battle` spawns no survivors and has no alongside behaviour or measurable assistance benefit. |
| AC-19 | Carrier/recon finishable; surface/support reachable; participation; frozen debrief | PARTIAL | `src/sim/sortie.ts:50,279,312`; `src/sim/battle.ts:501-505`; `index.html:12` | `scripts/check-sortie-kinds.mjs` **PASS** (pure); `tools/capture-sortie.mjs` **PASS** (snapshot, but setup/recovery injected); `tools/capture-sortie-runs.mjs` **FAIL (exit 1)** — keys-only strike lost on the aiming circle at 67.5 s (`aimError 1619.7`). `scripts/check-flight.mjs` is **RED**. | The briefing offers only strike/recon/operation (`index.html:12`); `feasibleSupportDuties`/`participationEarned` are called by no `src/` file; surface-strike and support are unreachable; the keys-only strike run is not completable. |
| AC-20 | Open Pacific continues through withdrawal/salvage; declared end conditions | PARTIAL | `src/sim/sortie.ts:379-463` (`operationOutcome`, `pendingOpportunities`) | `scripts/check-sortie-kinds.mjs` **PASS** (pure: four success conditions, fourth-deck continuation, observed withdrawal, honest conclusion, base-aviation loss). | `operationOutcome`/`pendingOpportunities` are imported by no `src/` file; `Battle` still ends on the legacy `strikeComplete` flag (`battle.ts:1734-1740`) and never passes `facilities`. |
| AC-21 | Natural battles seeds 19420604–08; bounded role scenarios; repeatable traces | PARTIAL | `src/sim/battle.ts:440-442` (seeded RNG) | `scripts/check-carrier-cycle.mjs` **PASS at `1bde9a1`** (48→21 launches reproduced exactly, seed 19420608 differs). | No natural-battle role report for all five seeds; no bounded reachable-role scenarios; `tools/capture-battle-roles.mjs` does not exist; only a contact intervention, not paired scout/escort/protection. |
| AC-22 | Real WebGPU captures of every new role at engagement/close range | PARTIAL | `tools/capture-deck/fleet/sortie/performance/vfx/lifecycle.mjs`, `capture-asset-polish.mjs` | Snapshot: `capture-deck` **PASS**; `capture-fleet` **PASS**; `capture-sortie` **PASS** (injected); `capture-performance` **PASS**; `capture-vfx` **PASS**; `capture-lifecycle` **PASS** (partly forced); `check-repair` **PASS** served. | No capture of a Kate release, a cruiser floatplane cycle, ASW or salvage (those systems do not exist live); no assertion that weapon mounts / AV cues agree with the simulation; `capture-sortie` uses injected setup. |
| AC-23 | 1920×1080 GPU p95 ≤16.7 ms, Battle fixed-step CPU p95 ≤4 ms, no >10% regression | PARTIAL | `tools/capture-performance.mjs` | Snapshot run at 1920×1080/60 s **PASS**: NVIDIA Turing, GPU median 4.5 ms, p95 7.2 ms, worst 13.23 ms over 295 frames. The script asserts only `gpu.p50 < 16.7` (`capture-performance.mjs:225`). | No fixed-step CPU instrumentation or `p95 ≤ 4 ms` assertion; no matched baseline / >10% regression check; the default resolution/sample are not 1920×1080/60. |
| AC-24 | Type/build + affected simulation/browser checks pass; restart/LOD churn; web/native proof | PARTIAL | `package.json:15-16` | At snapshot: `pnpm typecheck` **exit 0**, `pnpm exec vite build` **exit 0** (chunk-size warnings only); browser captures above pass except `capture-sortie-runs`. At current HEAD, **`scripts/check-flight.mjs` is RED**; all other node checks pass. `tools/check-humanoid.mjs` exits 1 only for a missing GLB argument. | `native-playtests/` does not exist although `package.json` `test:native` names it; no native `--target` proof; a green `check-flight`; explicit web/native qualification. |

## What is not met

**NOT MET** — no implementing code, or code only as a pure module nothing calls.

- **AC-11 (cruiser scouts):** import `src/sim/scouting.ts` into `Battle` for Tone/Chikuma, add a
  floatplane, and prove the launch→report→recovery cycle.
- **AC-12 (island facilities):** create facility records in `Battle`, route bomb hits into them, and
  drive the Japanese follow-up mission from observed surviving capability.
- **AC-14 (surface groups):** call `src/sim/naval.ts`/`formation.ts` from `Battle.updateShips` for
  station-keeping, hazard avoidance, detach/rejoin and coverage.
- **AC-15 (Mogami group):** add the Mogami/Mikuma entities to `setupFleet`, give them a route, and make
  them designatable and attackable.
- **AC-16 (submarines):** replace the sine surfacing and fixed spreads in `Battle` with
  `submarine.ts`/`asw.ts` depth/tube/evasion behaviour, and add the seeded prevention scenario.

**PARTIAL** — code exists but the proof is partial or absent.

- **AC-1:** instantiate Mogami/Mikuma in `Battle` so the derived class is actually displayed.
- **AC-2:** either apply the declared beam repair to the shipped bytes (or re-cut the models), or delete
  the "beam within 2%" clause; and settle whether the 0.1 m bound applies at every station or only at
  the datum, then make criterion and check agree.
- **AC-3:** render the player TBD from `aircraft.tbd-devastator.glb`, give AI TBD/Kate their imported
  airframes across LOD, and add an identity check for AI and parked aircraft.
- **AC-4:** animate the imported gear/flap/hook/surface pivots in play and add a moving-part check.
- **AC-5:** get `check-flight.mjs` green and add a check for AI engine flight, AI release and a
  power-loss glide; prove the Kate level-bombing path; correct the B5N2 constants.
- **AC-7:** make the visual deck park read the inventory for both teams, assert it, and assert damaged
  inventory/diversions persist.
- **AC-13:** migrate map selection, cycling and the HUD list to the `targetEligible` contract so surface
  and submerged contacts are reachable.
- **AC-17:** source live torpedo speed/depth/arming/range from `TORPEDO_VARIANTS` and wire ASW
  depth-charge attacks.
- **AC-18:** spawn survivor records on sinking and run the pure `rescue.ts` assist path through `Battle`.
- **AC-19:** offer `surface`/`support` in the briefing, wire participation, and complete a keys-only
  recovered sortie (`capture-sortie-runs` currently fails).
- **AC-20:** call `operationOutcome`/`pendingOpportunities` from the live operation and feed them
  `facilities`.
- **AC-21:** run the five named seeds, build the bounded role scenarios and paired interventions, and
  create `tools/capture-battle-roles.mjs`.
- **AC-22:** add the missing role captures once the systems exist, and assert mounts/AV cues against the
  simulation.
- **AC-23:** instrument fixed-step CPU duration, assert the p95/baseline targets, and run the named
  1920×1080/60 s workload as the default.
- **AC-24:** make `check-flight` green, complete the restart/LOD-churn gate, add the `native-playtests/`
  the script names, and state web/native qualification explicitly.

## PRD claims the evidence does not support

- **AC-2 is the sharpest case.** The working-copy PRD now states "The 0.1 m station agreement is now met
  and measured" and calls this "the one place where the criterion, not the code, was wrong." The
  executed check proves something narrower: the datum is within 0.1 m of the **centre** of the deck's
  elevation range, with sheer allowed to 2 m (Hiryu worst station 0.834 m). The literal criterion
  ("agree within 0.1 m at inspected stations") is not met. Separately, "beam within 2%" is contradicted
  by the shipped bytes (`catalog.ts:41,45`: Kaga 53.93 m model vs 32.50 m reference), which
  `tools/check-catalog.mjs` never compares.
- **AC-3.** The PRD's integration ledger says "the Dauntless fallback is gone and airframe identity is
  explicit (AC-3)". Identity is explicit, but the player TBD and all AI TBD/Kate are procedural
  models; removing a fallback is not the criterion's "AI TBD/Kate and parked examples use their correct
  airframes across LOD."
- **AC-1 is checked `[x]`** yet "Tone and Mogami display genuinely different June 1942 layouts" cannot
  be true in-game because no Mogami entity exists.
- **`scripts/check-catalog.mjs` is misnamed/misdescribed:** its header says "(PRD AC-1)" but it is the
  **audio cue-manifest** check ("125 consumed cues verified"). The hull catalog check is
  `tools/check-catalog.mjs`; equating the two overstates hull coverage.

## Checks and what they cover

**Node checks — run at live `HEAD` across the window `6d7ae4 → 1bde9a1`.** `exit` is the real process
status.

- `scripts/check-agenda.mjs` (exit 0) — agenda/priority assertions; "all assertions passed".
- `scripts/check-aircraft.mjs` (exit 0) — procedural Douglas SBD GLB geometry/tracks: 12 clips,
  12.66 m span, clone/control independence, neutral release, throttle stop, separate vertex layout.
- `scripts/check-armament.mjs` (exit 0) — four distinct torpedo variants, release envelopes, m/s speed
  bands, gun batteries by airframe; 6 checks passed.
- `scripts/check-asw.mjs` (exit 0) — pure ASW/depth-charge model; `{"pass":true,"salvo":6,…}`.
- `scripts/check-audio.mjs` (exit 0) — cue direction/lifecycle against a fake audio target; 25 checks.
- `scripts/check-carrier-cycle.mjs` (exit 0 at `1bde9a1`; **exit 1 at `0b805c8` `:299`**) — drives real
  `Battle.step` 12 simulated minutes: conservation, cap refusal, inventory-driven missions,
  contact-only targeting, report ageing, suspension/reopen, determinism.
- `scripts/check-carrier-ops.mjs` (exit 0) — pure carrier/player stores, fuel, service clocks, the four
  suspension reasons, and a real `Battle` recovery/relaunch.
- `scripts/check-catalog.mjs` (exit 0) — **audio** cue manifest: 125 consumed cues hash-matched. Not a
  hull check despite the filename.
- `scripts/check-damage.mjs` (exit 0) — five functional ship-damage zones with class capacity.
- `scripts/check-facilities.mjs` (exit 0) — pure facility model; 14 checks (module unwired).
- `scripts/check-flight.mjs` (**exit 1**) — failed `lost` vs `recovered` at `:457`; the payload and
  recovery assertions do not pass on the current tree.
- `scripts/check-formation.mjs` (exit 0) — pure formation/station-keeping helpers; 7 checks (unwired).
- `scripts/check-gunnery.mjs` (exit 0) — gunnery/mount/arc assertions; 6 checks.
- `scripts/check-geometry.mjs` (exit 0) — pure hull/deck sizing, 5 datums, per-deck `finalReady`, a
  Yorktown diversion recovery, no render write-back.
- `scripts/check-intel.mjs` (exit 0) — pure contact delivery/dead-reckoning/uncertainty/gate/decay/merge;
  15 checks (module wired).
- `scripts/check-loops.mjs` (exit 0) — 38 looping cues wrap below the seam threshold.
- `scripts/check-naval.mjs` (exit 0) — pure station frame, steering, CPA, avoidance, task priority,
  hazards, rejoin, authority, rescue window; 10 checks (unwired).
- `scripts/check-radio.mjs` (exit 0) — friendly-radio alert predicates against real `Battle`; 7 checks.
- `scripts/check-rescue.mjs` (exit 0) — pure rescue/alongside model; `{"pass":true}` (unwired).
- `scripts/check-scouting.mjs` (exit 0) — pure cruiser-scout model; 7 checks (unwired).
- `scripts/check-sortie-kinds.mjs` (exit 0) — pure surface-strike/support contract and Open Pacific end
  conditions.
- `scripts/check-submarine.mjs` (exit 0) — pure submarine depth/battery/tubes/intercept/charges; `pass`.
- `scripts/check-weapons.mjs` (exit 0) — real-Battle weapon/outcome events for audio; 4 checks.
- `tools/check-asset-polish.mjs` (exit 0) — crew clips/hands and TBD/Kate GLBs: span, nose, nine moving
  clips, fixed fuselage; PASS.
- `tools/check-carrier-assets.mjs` (exit 0) — enterprise/hornet/b25-mitchell/akagi triangle counts and
  embedded textures; pass.
- `tools/check-catalog.mjs` (exit 0) — re-reads every shipped hull/weapon GLB against
  `src/sim/catalog.ts`: dimensions, keel, triangle budget, reference length ≤2%; 10 hulls + 1 weapon,
  worst length error 0.050%.
- `tools/check-fleet.mjs` (exit 0) — crew rig/clips, A6M3 span/prop, destroyer axis/length, atoll scale,
  and every `fleet.json` hull's keel/one-mesh/one-material/orientation; PASS.
- `tools/check-humanoid.mjs` (**exit 1**) — **not a standalone gate**: usage is
  `node tools/check-humanoid.mjs path/to/rigged.glb`, so the bare run fails for a missing argument. It
  is invoked correctly inside `tools/check-asset-polish.mjs`, which passes.
- `tools/check-repair.mjs` (exit 0 when served; **exit 1** bare) — browser gate; with no server it fails
  to navigate. The snapshot run against `127.0.0.1:5391` was **PASS**: keyboard release, mouse never
  steers, click fires, drag-look, bounded flashes, pause, quality, restart, takeoff, no console/GPU
  errors.

**Browser gates — run against frozen snapshot `53deda0`+edits on port 5391.**

- `tools/capture-deck.mjs` (**PASS**, exit 0) — deck width from the carriers' own geometry, launch and
  low pass, and the AC-2 hull survey: 4 imported carriers, 0 disagreements, no console errors.
- `tools/capture-fleet.mjs` (**PASS**, exit 0) — 12 deck-crew stations with clips/helmets, imported Zero
  on AI, IJN destroyer LOD, Midway atoll; no console/GPU errors.
- `tools/capture-sortie.mjs` (**PASS**, exit 0) — three credited deck hits, visible scars, frozen
  recovered debrief; setup and recovery are injected by the tool, so it is not keys-only.
- `tools/capture-sortie-runs.mjs` (**FAIL, exit 1**) — the keys-only strike run lost the aircraft on the
  aiming circle at 67.5 s (`{"status":"lost","time":97.48,…,"aimError":1619.7}`).
- `tools/capture-performance.mjs` (**PASS**, exit 0) — 1920×1080, NVIDIA Turing; GPU median 4.5 ms,
  p95 7.2 ms, worst 13.23 ms; asserts only `gpu.p50 < 16.7` and adapter identity.
- `tools/capture-vfx.mjs` (**PASS**, exit 0) — splash-column/smoke VFX against a live target.
- `tools/capture-lifecycle.mjs` (**PASS**, exit 0) — torpedo release, restart to bomb loadout, both
  navies aloft, a reported contact, a damaging attack, a carrier sunk, a recovery approach, the loss
  state, three quality settings and a clean restart; the attack/recovery are forced states, not a
  keys-only playthrough.
- `pnpm typecheck` (exit 0) and `pnpm exec vite build` (exit 0, chunk-size warnings only) at snapshot.
