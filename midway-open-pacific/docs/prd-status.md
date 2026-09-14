# PRD-midway-asset-battle-integration — acceptance status

Audited 2026-09-14 (session local time). This is a read-only report. It judges every AC-1..AC-24 in
`docs/PRDs/PRD-midway-asset-battle-integration.md` against the code and against checks that were
actually executed, not against the PRD's prose.

**Important — the tree was moving while this was audited.** A second lane is actively implementing
Phases 3–5 in this same checkout. During the audit `HEAD` advanced `c13e184 → 53deda0 → b192171`;
`src/sim/scouting.ts`, `src/sim/rescue.ts`, `scripts/check-scouting.mjs` and `scripts/check-rescue.mjs`
appeared, and the PRD itself was being rewritten (its AC-2 entry changed from "NOT MET" to
"0 disagreements" while this report was being written). To make the results reproducible the audit
was run against one **frozen snapshot**:

- Snapshot path: `/tmp/opencode/prdcheck` (rsync of the working tree, no `.git`, `node_modules` linked).
- Snapshot base: commit `53deda0` plus the uncommitted working edits present at `2026-09-14T00:46Z`.
- Key files at snapshot: `scripts/check-carrier-cycle.mjs` sha256 `2023ea57…`, `src/sim/battle.ts`
  `b43b1525…`. `src/sim/rescue.ts` and `scripts/check-rescue.mjs` did **not** exist in the snapshot.
- `HEAD` at time of writing is `b192171`; files named below with line numbers match the snapshot.

Verdict rule used here: **MET** only when code exists *and* an executed check proves the criterion;
**PARTIAL** when code exists but the only proof covers part of the criterion, or no check exists;
**NOT MET** when the implementing code is absent, or exists only as a pure module no `src/` file calls.

## Acceptance criteria

| AC | Summary | Verdict | Code (path:line) | Check + real result | What is missing |
|---|---|---|---|---|---|
| AC-1 | Asset disposition/provenance, Tone≠Mogami, Kagerō resolved | PARTIAL | `docs/asset-provenance.md:14-122`; `tools/blender/fleet.json`; `tools/blender/derive-mogami.py:4-61`; `src/sim/catalog.ts:111-124` | `tools/check-catalog.mjs` **PASS** (10 hulls + 1 weapon, worst length 0.050%); `tools/check-fleet.mjs` **PASS**; `tools/check-asset-polish.mjs` **PASS** | Mogami is never instantiated: `Battle.setupFleet` (`src/sim/battle.ts:549-617`) creates Tone/Chikuma but no Mogami/Mikuma, so "Tone and Mogami display genuinely different layouts" is unproven in-game. Rights remain UNVERIFIED (permitted by the PRD). |
| AC-2 | Validated endpoints; length/span/beam ≤2%; 0.1 m station agreement; visual check | PARTIAL | `src/sim/catalog.ts:41-94`; `src/sim/math.ts:67-81`; `src/sim/battle.ts:126-231`; `tools/measure-decks.mjs` | `tools/capture-deck.mjs` **PASS — 0 disagreements** (Kaga/Soryu/Hiryu/Yorktown, no console errors). `tools/check-catalog.mjs` **PASS**. | **Beam is not within 2%.** The shipped GLBs are 30–66% wider than the declared reference and the "repair" is declared sim data, not applied to the model bytes: Kaga `measuredBeam 53.93` vs `hullBeam 32.50` (`catalog.ts:41,45`); Hammann 20.14 vs 11.00. `tools/check-catalog.mjs` compares `measuredBeam` to the GLB, never to `hullBeam`. The 0.1 m bound now holds only at the datum (the centre of the deck's elevation range), with sheer allowed up to 2 m; Hiryu's worst station is 0.834 m (`capture-deck` output). The visual-silhouette half is unproven. |
| AC-3 | Player TBD in deck/chase/cockpit; AI/parked correct airframes; no Dauntless fallback | PARTIAL | `src/render/world.ts:296-305` (player), `:25-34` (`importedAircraftFor`); `src/scenes/Midway.ts:423`; `src/render/imported-aircraft.ts:347-422` | No check proves in-game identity. `tools/check-asset-polish.mjs` **PASS** proves the GLB bytes only. | Player TBD is the **procedural** `makeDauntless(true)` variant, not `aircraft.tbd-devastator.glb`; Midway labels it "PROCEDURAL TBD-INSPIRED MODEL". AI TBD/Kate are also procedural (`world.ts:25-34`). No check asserts AI or parked identity. |
| AC-4 | Prop/gear/hook/surface motion; independent instances; release removes one store | PARTIAL | `src/render/imported-aircraft.ts:439-455`; `src/render/dauntless.ts:563-592`; `src/render/world.ts:415-426`; `src/sim/battle.ts:2158-2187` | `tools/check-asset-polish.mjs` **PASS** (the GLBs carry 9 moving clips); `scripts/check-aircraft.mjs` **PASS** (Douglas only) | `createAirframe` builds no mixer for imports, so `gear.retract`, `flaps.deploy` and `flight.*` are dead bytes in play; only the propeller spins. No hook/gear/surface check for the shipped TBD/Kate in the running game. |
| AC-5 | Through `Battle.step`: AI engine flight, legal release/recovery, Kate level bombing, damage | PARTIAL | `src/sim/tactics.ts:223-233,308`; `src/sim/flight.ts:146-216` | No check exercises AI engine flight, AI release, AI recovery or power-loss glide. `scripts/check-carrier-cycle.mjs` **PASS** covers conservation/launches only. | Kate level bombing absent (Kate gets only a torpedo run); B5N2 constants still span 14.9 / wingArea 34.6 (`flight.ts:125-127`) against the PRD's 15.5 / 37.7; no universal-min-speed assertion; the migration is uncommitted relative to HEAD. |
| AC-6 | Pure init geometry; diversion agrees with `finalReady`/HUD and real geometry | MET | `src/sim/battle.ts:126-231,549-618`; `src/sim/recovery.ts:95-108` | `scripts/check-geometry.mjs` **PASS**: 17 hulls sized before any render, 5 distinct deck datums, a guided diversion recovers on Yorktown under its own datum, cue == gate, constructing `WorldView` writes nothing, 12 render modules assign no geometry field. | Only Yorktown is exercised as the diversion deck; per-carrier drawn-vs-sim geometry is AC-2's burden. |
| AC-7 | Conserve identities/fuel/ordnance, deck occupancy, no spend on blocked launch, visual park | PARTIAL | `src/sim/carrier-ops.ts:111-236`; `src/sim/battle.ts:938-999,1042-1084,1806-1874` | `scripts/check-carrier-ops.mjs` **PASS**; `scripts/check-carrier-cycle.mjs` **PASS** (12 min, 116 aircraft lost, 18 cap refusals, all airframes accounted, queued launch charges nothing). | "The visual deck park matches the inventory" is unproven, and only US hulls park anything (`src/render/world.ts:277-282`); damaged-inventory/diversion persistence is not asserted. |
| AC-8 | Inputs change next mission; CAP vs escort; no modulo/name rule | MET | `src/sim/tactics.ts:95-124`; `src/sim/battle.ts:1100-1134` | `scripts/check-carrier-cycle.mjs` **PASS**: Kaga flies 7→0 Kates with no torpedoes, a delivered contact raises JP strikes, the modulo sequence is explicitly excluded, renaming Hiryu→Unryu changes nothing. | — |
| AC-9 | Suspension reasons; limited reopen without restoring hull/stores | MET | `src/sim/carrier-ops.ts:238-257`; `src/sim/battle.ts:912-929` | `scripts/check-carrier-ops.mjs` **PASS** (four reasons); `scripts/check-carrier-cycle.mjs` **PASS** (fire in the corridor for 358 s, then limited ops at 113/340 hull, not restored). | — |
| AC-10 | Unobserved never precise; dated/stale reports; dead scout's already-sent report arrives | MET | `src/sim/intel.ts:12-177`; `src/sim/battle.ts:57-69,1137-1259,1705-1719,2386` | `scripts/check-intel.mjs` **PASS** (15 checks); `scripts/check-carrier-cycle.mjs` **PASS** (no target before observation, report undelivered until it arrives, dead scout still delivers, stale estimate 196 s / ±1103 m). | "Stale information changes search behaviour" is only implicit (no-contact → recon), not asserted. |
| AC-11 | Tone/Chikuma launch/recover a finite scout that reports and can be intercepted | NOT MET | `src/sim/scouting.ts:12-208`; **no `src/` importer** | `scripts/check-scouting.mjs` **PASS** — pure module only. | `scouting.ts` is called by nothing in `src/`; `Battle.launchRecon` still spawns a hardcoded Catalina from the island; no cruiser floatplane geometry, catapult, water pickup or Battle/capture test. |
| AC-12 | Functional island facilities; Japanese follow-up from observed capability | NOT MET | `src/sim/facilities.ts:8-189`; `src/sim/sortie.ts:6` (only `baseAviationLost`) | `scripts/check-facilities.mjs` **PASS** — pure module only. | No facility entities or facility hit path in `Battle`; `battle.island` is inert geometry; no follow-up mission is driven by observed surviving capability. |
| AC-13 | One target contract across map/cycle/orders; submerged uncertainty | PARTIAL | `src/sim/sortie.ts:167-247`; `src/sim/battle.ts:1313-1332`; `src/scenes/Midway.ts:478-489`; `src/hud.ts:691` | `scripts/check-sortie-kinds.mjs` **PASS** (pure contract); `scripts/check-flight.mjs` **PASS** (old carrier-strike/release-stamp/pending tests). | Map selection and cycling filter `kind === "carrier"` only (`Midway.ts:479`, `hud.ts:691`); submerged contacts are never offered; the UI consumers were not migrated to `targetEligible`/`eligibleTargets`. |
| AC-14 | Formation, hazard avoidance, detach/rejoin, protective coverage | NOT MET | `src/sim/naval.ts:66-275`; **no `src/` importer** | `scripts/check-naval.mjs` **PASS** — pure module only. | `Battle.updateShips` still moves each hull straight from its own heading (`battle.ts:1742-1787`); no station offsets, hazards, detach/rejoin or coverage computation anywhere live. |
| AC-15 | Mogami/Mikuma support group with approach/hold/withdraw and player access | NOT MET | `src/sim/catalog.ts:111`; `src/render/imported-fleet.ts:294` | No check. | No Mogami or Mikuma entity in `Battle.setupFleet` (`battle.ts:549-617`); no route, no damage/escape behaviour, not designatable. |
| AC-16 | Sub patrol/intercept, endurance/tubes/evasion; seeded detection can prevent I-168 | NOT MET | `src/sim/submarine.ts:15-288`; **no `src/` importer** | `scripts/check-submarine.mjs` **PASS** — pure module only. | `Battle` still sine-surfaces boats (`battle.ts:1767`) and fires unlimited three-torpedo spreads (`battle.ts:1778`); no depth, battery, tubes or evasion in the live game; no seeded prevention scenario. |
| AC-17 | Distinct torpedo variants (geometry/origin/envelope/depth/range); swept hits; depth charges | PARTIAL | `src/sim/armament.ts:191-216,73-92`; `src/sim/battle.ts:2158-2212` | `scripts/check-armament.mjs` **PASS** (4 variants, envelopes, guns by airframe); `scripts/check-submarine.mjs` **PASS** (pure charge damage). | `spawnTorpedo` hardcodes speed, `armedDistance`, a constant `y:-1.6` and ttl, ignoring `TORPEDO_VARIANTS`; one `makeTorpedoModel` is reused for every weapon; no ASW depth-charge attack exists in `Battle`. |
| AC-18 | Hammann rescue + alongside assist, cancelled by threat | NOT MET | no rescue module in the tested snapshot | No check in the snapshot. | `src/sim/rescue.ts`, `stepRescue`, `canAssist` did not exist at snapshot time (a pure `rescue.ts` and `scripts/check-rescue.mjs` have since appeared in the working tree, still unwired). `Battle` spawns no survivors and has no alongside behaviour. |
| AC-19 | Carrier/recon finishable; surface/support reachable; participation; frozen debrief | PARTIAL | `src/sim/sortie.ts:50,279,312`; `src/sim/battle.ts:501-505,1313`; `index.html:12` | `scripts/check-sortie-kinds.mjs` **PASS** (pure assignment rules); `tools/capture-sortie.mjs` **PASS** (setup injected). `tools/capture-sortie-runs.mjs` did not complete (capture lock held by the other lane). | The briefing offers only strike/recon/operation (`index.html:12`); `feasibleSupportDuties` and `participationEarned` are never called from `src/`; surface-strike and support are unreachable from briefing/map. |
| AC-20 | Open Pacific continues through withdrawal/salvage; declared end conditions | PARTIAL | `src/sim/sortie.ts:379-463` | `scripts/check-sortie-kinds.mjs` **PASS** (pure end conditions, observed withdrawal, base-aviation loss). | `operationOutcome`/`concludeOperation`/`pendingOpportunities` are imported by no `src/` file; `Battle` still ends on the legacy `strikeComplete` flag (`battle.ts:1734-1740`), so withdrawal/salvage continuation is not live. |
| AC-21 | Natural battles seeds 19420604–08; bounded role scenarios; repeatable traces | PARTIAL | `src/sim/battle.ts:440-442` (seeded RNG) | `scripts/check-carrier-cycle.mjs` **PASS**: seeds 19420604/19420607/19420608, 48 launches reproduced exactly, seed 19420608 differs. | No natural-battle role report for all five seeds; no bounded reachable-role scenarios; `tools/capture-battle-roles.mjs` does not exist; only a contact intervention, not paired scout/escort/protection. |
| AC-22 | Real WebGPU captures of every new role at engagement/close range | PARTIAL | `tools/capture-deck.mjs`, `capture-fleet.mjs`, `capture-sortie.mjs`, `capture-performance.mjs`, `capture-asset-polish.mjs` | `capture-deck` **PASS**; `capture-fleet` **PASS** (crew, Zero AI, IJN destroyer, Midway, no errors); `capture-sortie` **PASS** (injected); `capture-performance` **PASS**. | No capture of a Kate release, a cruiser floatplane cycle, ASW or salvage (those systems do not exist); no assertion that weapon mounts / AV cues agree with the simulation; `capture-sortie` uses injected setup, not keys-only. |
| AC-23 | 1920×1080 GPU p95 ≤16.7 ms and Battle fixed-step CPU p95 ≤4 ms, no >10% regression | PARTIAL | `tools/capture-performance.mjs` | Run at 1920×1080/60 s **PASS**: NVIDIA Turing, GPU median 4.5 ms, p95 7.2 ms, worst 13.23 ms over 295 frames. The script asserts only `gpu.p50 < 16.7` (`capture-performance.mjs:225`). | No fixed-step CPU instrumentation or `p95 ≤ 4 ms` assertion; no matched baseline / >10% regression check; the default resolution/sample are not 1920×1080/60. |
| AC-24 | Type/build + affected checks pass; restart/LOD churn clean; web qualified; native proof | PARTIAL | `package.json:15-16` | `pnpm typecheck` **PASS (exit 0)**; `pnpm exec vite build` **PASS (exit 0, chunk-size warnings only)**; every `scripts/check-*.mjs` and `tools/check-*.mjs` **PASS** except `tools/check-humanoid.mjs`, which exits 1 only because it requires a GLB argument. `tools/capture-lifecycle.mjs` did not complete (capture lock held). | `native-playtests/` does not exist although `package.json` `test:native` names it; no native `--target` proof; the restart/LOD-churn browser run has no completed result; web qualification is implicit only. |

## What is not met

**NOT MET** — the implementing code does not exist, or exists only as a pure module nothing calls.

- **AC-11 (cruiser scouts):** wire `src/sim/scouting.ts` into `Battle` for Tone/Chikuma, add a floatplane,
  and assert the cycle through `Battle.step` or a capture.
- **AC-12 (island facilities):** create facility records in `Battle`, route bomb hits into them, and make
  the Japanese follow-up mission read observed surviving capability.
- **AC-14 (surface groups):** call `src/sim/naval.ts` from `Battle.updateShips` for station-keeping,
  hazard avoidance, detach/rejoin and protective coverage.
- **AC-15 (Mogami group):** add the Mogami/Mikuma entities to `setupFleet`, give them a route, and make
  them designatable/attackable.
- **AC-16 (submarines):** replace the sine surfacing and unlimited spreads in `Battle` with
  `src/sim/submarine.ts` depth/tube/evasion behaviour, and add the seeded prevention scenario.
- **AC-18 (Hammann rescue/assist):** land a rescue module (appearing in the working tree as a pure
  `rescue.ts`), spawn survivor records on sinking, and run `canAssist`/`assistBenefit` through `Battle`.

**PARTIAL** — code exists but the check proves only part, or no check exists.

- **AC-1:** instantiate Mogami/Mikuma in `Battle` so the derived class is actually displayed; keep the
  UNVERIFIED rights note.
- **AC-2:** either apply the declared beam repair to the shipped bytes (or re-cut the models), or delete
  the "beam within 2%" clause; and decide whether the 0.1 m bound applies at every station or only at
  the datum, then make the check and the criterion say the same thing.
- **AC-3:** render the player TBD from `aircraft.tbd-devastator.glb`, give AI TBD/Kate their imported
  airframes across LOD, and add an identity check for AI and parked aircraft.
- **AC-4:** build an animation path that plays the imported gear/flap/hook/surface clips in the running
  game, and add a check for gear and hook motion.
- **AC-5:** add Kate level bombing, correct the B5N2 span/area constants, and add a check that proves AI
  engine flight, AI release and a power-loss glide through `Battle.step`.
- **AC-7:** make the visual deck park read the inventory for both teams and assert it; assert damaged
  inventory and diversions persist.
- **AC-13:** migrate map selection, target cycling and the HUD list to the `targetEligible` contract so
  surface and submerged contacts are reachable.
- **AC-17:** source live torpedo speed/depth/arming/range from `TORPEDO_VARIANTS` and add escort
  depth-charge attacks through `stepCharge`/`chargeDamage`.
- **AC-19:** offer `surface` and `support` in the briefing, wire `feasibleSupportDuties` and
  `participationEarned`, and complete `capture-sortie-runs.mjs` keys-only.
- **AC-20:** call `operationOutcome`/`concludeOperation`/`pendingOpportunities` from the live operation
  instead of the `strikeComplete` flag.
- **AC-21:** run the five named seeds through `Battle` and report roles, build the bounded role scenarios
  and paired interventions, and create `tools/capture-battle-roles.mjs`.
- **AC-22:** add the missing role captures once the systems exist, and assert AV cues/mounts against the
  simulation.
- **AC-23:** instrument fixed-step CPU duration, assert p95 thresholds and a matched baseline, and run
  the default 1920×1080/60 s workload.
- **AC-24:** add the `native-playtests/` files the script names (or remove the claim), complete the
  restart/LOD-churn run, and state web/native qualification explicitly.

## PRD claims that the evidence does not support

- **AC-2 is the sharpest case.** The working-copy PRD now states "The 0.1 m station agreement is now met
  and measured" and calls the resolution "the one place where the criterion, not the code, was wrong."
  The executed check proves something narrower: the datum is within 0.1 m of the **centre** of the deck's
  elevation range, with sheer allowed up to 2 m — Hiryu's worst station is 0.834 m. The literal criterion
  ("agree within 0.1 m at inspected stations") is not met. Separately, the criterion's "beam within 2%"
  is contradicted by the shipped bytes (`catalog.ts:41,45`: Kaga 53.93 m model vs 32.50 m reference), and
  `tools/check-catalog.mjs` never compares the two. The PRD text asserting AC-2's station agreement is
  therefore **not reproduced by the check as written**.
- **AC-3.** The PRD's integration ledger says "the Dauntless fallback is gone and airframe identity is
  explicit (AC-3)". Identity is explicit, but the player TBD and all AI TBD/Kate are still procedural
  models (`world.ts:296-305`, `:25-34`); removing a fallback is not the same as the criterion's "AI
  TBD/Kate and parked examples use their correct airframes across LOD."
- **AC-1 is checked `[x]`** yet its own sentence "Tone and Mogami display genuinely different June 1942
  layouts" cannot be true in-game because no Mogami entity exists.
- **AC-18** is the newest example of the moving tree: a pure `src/sim/rescue.ts` and `check-rescue.mjs`
  appeared after the snapshot. No `src/` file imported either at audit time.
- **`scripts/check-catalog.mjs` is misnamed/misdescribed:** its header says "(PRD AC-1)" but it is the
  **audio cue-manifest** check ("125 consumed cues verified"). The hull catalog check is
  `tools/check-catalog.mjs`. Any reader equating the two will overstate hull coverage.

## Checks that exist and what they cover

Every line below was executed in the frozen snapshot. `exit` is the real process status.

- `scripts/check-aircraft.mjs` (`exit 0`) — real Douglas GLB geometry/tracks; 12 clips, 12.66 m span,
  independent controls and clones, neutral release, throttle stop; wheel/deck gaps ≈ −0.03 m.
- `scripts/check-armament.mjs` (`exit 0`) — four distinct torpedo variants, release envelopes, m/s
  speed bands, and gun batteries chosen by airframe; 6 checks passed.
- `scripts/check-audio.mjs` (`exit 0`) — cue direction/lifecycle against a fake audio target; 25 checks.
- `scripts/check-carrier-cycle.mjs` (`exit 0`) — drives real `Battle.step` 12 simulated minutes:
  conservation (116 lost, 18 refusals), inventory-driven missions, contact-only targeting, report
  ageing, suspension/limited reopen, determinism (48 launches, seed 19420608 differs).
- `scripts/check-carrier-ops.mjs` (`exit 0`) — pure carrier/player stores, fuel, service clocks, the
  four suspension reasons, and a real `Battle` recovery→service→relaunch.
- `scripts/check-catalog.mjs` (`exit 0`) — **audio** cue manifest: 125 consumed cues hash-matched, 0
  packaged cues unused. Not a hull check despite the filename.
- `scripts/check-damage.mjs` (`exit 0`) — five functional damage zones with class capacity.
- `scripts/check-facilities.mjs` (`exit 0`) — pure facility model (ignition, repair, radar, seaplane,
  radio, base loss, spread, repair plan, follow-up); 14 checks. Module is unwired.
- `scripts/check-flight.mjs` (`exit 0`) — player launches/manoeuvres/payload/credit/recovery/diversion,
  short-sortie objectives and frozen results (all `pass:true`).
- `scripts/check-geometry.mjs` (`exit 0`) — pure-Battle hull/deck geometry, 5 deck datums, per-deck
  `finalReady`, a real diversion recovery on Yorktown, and no render writes to geometry.
- `scripts/check-intel.mjs` (`exit 0`) — pure contact estimates: delivery, dead-reckoning, uncertainty,
  observe gate, classification decay, merge; 15 checks. Module is wired.
- `scripts/check-loops.mjs` (`exit 0`) — 38 packaged looping cues wrap below the seam threshold.
- `scripts/check-naval.mjs` (`exit 0`) — pure surface-group helpers: station frame, steering, CPA,
  avoidance, task priority, hazard circles, rejoin, authority, rescue window; 10 checks. Module is
  unwired.
- `scripts/check-radio.mjs` (`exit 0`) — friendly-radio alert predicates against real `Battle`; 7 checks.
- `scripts/check-scouting.mjs` (`exit 0`) — pure cruiser-scout model: launch gate, sectors, fuel legs,
  pickup envelope, capacity, report preservation; 7 checks. Module is unwired.
- `scripts/check-sortie-kinds.mjs` (`exit 0`) — pure surface-strike/support contract, release stamp,
  pending confirmation, retask, participation, one validator, and Open Pacific end conditions.
- `scripts/check-submarine.mjs` (`exit 0`) — pure submarine depth/battery/tubes/intercept/charges/
  search/endurance; `pass:true`. Module is unwired.
- `scripts/check-weapons.mjs` (`exit 0`) — real `Battle` weapon/outcome events for audio; 4 checks.
- `tools/check-asset-polish.mjs` (`exit 0`) — crew clips/hands and the TBD/Kate GLBs: span, nose, nine
  moving clips, fixed fuselage, all PASS.
- `tools/check-carrier-assets.mjs` (`exit 0`) — enterprise/hornet/b25-mitchell/akagi triangle counts and
  embedded textures; pass.
- `tools/check-catalog.mjs` (`exit 0`) — re-reads every shipped hull/weapon GLB against
  `src/sim/catalog.ts`: dimensions, keel, triangle budget, reference length ≤2%; 10 hulls + 1 weapon,
  worst length error 0.050%.
- `tools/check-fleet.mjs` (`exit 0`) — crew rig/clips, A6M3 span/prop, destroyer axis/length, atoll
  scale, and every `fleet.json` hull's keel, one-mesh/one-material and orientation; PASS.
- `tools/check-humanoid.mjs` (`exit 1`) — **not a standalone gate**: usage is
  `node tools/check-humanoid.mjs path/to/rigged.glb`, so the bare run used by the sweep fails for a
  missing argument. It is invoked correctly inside `tools/check-asset-polish.mjs`, which passes.
- `tools/check-repair.mjs` (`exit 1`) — browser gate; the standalone run navigated to the default
  `127.0.0.1:5199` and found no server. It was queued behind the other lane's capture lock in the audit
  runner and did not complete; **not verified**.
- `tools/capture-deck.mjs` (**PASS**, `exit 0`) — deck width from the carriers' own geometry, launch/low
  pass, and the AC-2 hull survey: 4 imported carriers, 0 disagreements, no console errors.
- `tools/capture-fleet.mjs` (**PASS**, `exit 0`) — 12 deck-crew stations with clips/helms, imported Zero
  on AI, IJN destroyer LOD, Midway atoll; no console/GPU errors.
- `tools/capture-sortie.mjs` (**PASS**, `exit 0`) — three credited deck hits, visible scars, frozen
  recovered debrief; setup and recovery are injected by the tool.
- `tools/capture-performance.mjs` (**PASS**, `exit 0`) — 1920×1080, NVIDIA Turing; GPU median 4.5 ms,
  p95 7.2 ms; asserts only `gpu.p50 < 16.7` and adapter identity.
- `tools/capture-sortie-runs.mjs`, `tools/capture-vfx.mjs`, `tools/capture-lifecycle.mjs` — **not
  completed**: the other lane held `/tmp/threenative-capture.lock` for the whole audit window, so these
  are unverified, not passing.
- `pnpm typecheck` (**exit 0**) and `pnpm exec vite build` (**exit 0**, chunk-size/dependency warnings
  only).
