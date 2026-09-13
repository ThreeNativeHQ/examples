# PRD-midway-sortie-realism — Make every sortie worth flying

**Status:** IN PROGRESS
**Complexity:** 7 (HIGH)
**Owner:** Midway game implementer.
**Depends on:** None. Coordinate shared files with [realistic audio](PRD-midway-realistic-audio-sfx.md); completion of that PRD is not required.
**Scope:** Four game-owned slices. All four are implemented; acceptance evidence is being recorded.
**Research date:** 2026-09-13
**Progress:** Implementation 4/4 phases. Evidence recorded on each AC below.
**Platforms:** Web acceptance. Desktop/mobile qualification is outside this slice; no native claim.
**Estimated implementation:** 32–48 engineering hours, including focused checks and browser playthroughs. Estimate, not measured throughput.

Complexity: approximately 11 implementation files (+3), small sortie/recovery modules (+2), interacting mission/combat/recovery state (+2); no independent release boundary. Risk override: none.

Implementation note: this game folder is worked by more than one lane at once. `src/sim/armament.ts`, `src/sim/sortie.ts` and `README.md` reached `main` inside another lane's commit (`85fa7a1`) rather than this one, and `src/scenes/Midway.ts` was briefly broken on `main` by `fb788cb` (a class field emitted inside `load()`); the working tree carries the fix. Browser gates for this PRD were run against isolated copies under `.worktrees/` because concurrent edits in the shared checkout hot-reload the page mid-run.

## Outcome and priority

**Give the player a clear assignment, an attack they can trust, and a return worth surviving.** A successful short sortie should have an attainable end without requiring all four Japanese carriers to be neutralized. Preserve the existing Open Pacific operation as a selectable longer battle.

Design assumption: approachable flight combat with believable consequences. Keep stability assist, course hold, the existing aiming aids and assisted final available. Neither historical fidelity nor difficulty means hiding essential instructions or adding cockpit chores.

| Value rank | Addition | Why it earns the next investment | Delivery |
|---|---|---|---|
| 1 | Finishable reconnaissance and carrier-strike sorties | Existing launch/search/strike/recovery systems already supply the game. Smaller goals give players a reason to return and retry. | Phase 2; 8–12 hours |
| 2 | Trustworthy weapon weight, hit attribution and carrier status | Measured defects currently weaken aircraft feel and award the player allied hits. Fix these before building mission rewards on them. | Phase 1; 4–6 hours |
| 3 | Useful home course, approach guidance and sortie debrief | H currently aims toward a carrier; L only becomes available after the player finds a narrow approach envelope. Bridge that gap and preserve the story of a damaged return. | Phase 3; 10–14 hours |
| 4 | Persistent damage at actual impact locations | Existing effects can make attacks readable without buying more models or replacing the renderer. | Phase 4; 10–16 hours |

Implementation order starts with rank 2 because the other outcomes need trustworthy combat state. The four phases are independently reviewable commits, but this PRD closes only when all required acceptance criteria pass.

## Context: inspected current state

Read `src/sim/flight.ts` first, then traced scene input → battle/AI/weapons → HUD/rendering → recovery/debrief. Inspected the current [handoff](../MIDWAY-HANDOFF.md) and [repair PRD](../PRD-midway-reference-repair.md); source and current observations take precedence over stale prose.

| Surface | Established behavior | Consequence for this plan |
|---|---|---|
| Flight and cockpit | `AircraftFlight` wraps engine `FlightModel`; lift, stall, payload modifiers, gear, flaps, trim and stability assist already exist. `WorldView.updateCamera` already adds stall/high-G buffet. The captured cockpit has working sightlines and detailed instruments. | Reuse these. A flight-model rewrite or another camera-shake feature is not the next need. |
| Battle and instructions | `Battle.step` marks the strike complete only after all enemy flight decks meet its threshold; operation victory arrives after recovery/service. `Hud.update` has useful phase text, but its deck tip says **↑** while input and tower instructions correctly say **Down** raises the nose. | Add bounded sortie goals; correct conflicting instructions at the existing HUD entry point. |
| Weapons and credit | `applyLoadout` writes payload mass/drag only when selecting/rearming. Releases decrement stores without updating those modifiers. `damageShip` accepts team but loses weapon-owner identity and credits any U.S. hit on a Japanese ship to personal stats. | Fix both shared paths, including AI, near misses, torpedoes and damage-over-time attribution. |
| Intelligence and squadron | `recordContact`, `contactEstimate`, `teamIntel`, four squadron orders, escort/strike/egress/RTB tactics and autonomous reconnaissance already exist. Reporting any fresh vessel can advance the present generic HUD phase. | Use actual carrier reports for the recon objective, preserve stale reports, and show what wing aircraft are doing after an order. |
| Recovery and presentation | H picks an operational friendly carrier and holds course toward it. L requires the player already be astern, aligned, low and slow. Touchdown automatically arrests; service restores everything in 12 simulation seconds. Debrief shows four cumulative counters. Carrier fires emit from generic positions rather than stored impact locations. | Add a readable approach and before-repair results. Retain current arrestment physics and improve damage placement. |

### Inspection evidence, not implementation acceptance

Snapshot: source inspection began at `f5602180e48b5e51046bc663c08ed7568015c12a` with existing local package/audio work. During inspection another lane changed `src/audio.ts`, `scripts/check-audio.mjs` and audio wiring in `src/scenes/Midway.ts`; those edits were not made by this task. Line references below identify inspected symbols and may shift during that work.

1. Read-only CPU probe bundled the real `Battle` through installed esbuild. `start(true) → releaseOrdnance()` left payload at **544 kg / 0.003 drag** after the first bomb and after all three bombs. Store counts correctly reached zero. This is an observed stale-payload defect, not a proposed realism embellishment.
2. A bomb with `owner: allied-ai`, `team: us` advanced through `Battle.updateWeapons(1/60)`, hitting an enemy carrier. Personal score changed **0 → 250**, ship hits **0 → 1**. The fixture was injected to isolate existing attribution; this was not a natural combat playthrough.
3. Built a temporary static preview with `pnpm exec vite build --outDir /tmp/midway-prd-inspection-20260913-01` and served it on port 5207. Build exited 0 with dependency namespace/chunk-size warnings. Browser launch used `bash tools/capture-lock.sh`; adapter **NVIDIA / Turing**, fallback false, viewport **1400×800**. Briefing → deck → restart → airborne → cockpit → map → squadron controls completed with captured console/page errors `[]`.
4. Visually inspected `screenshots/prd-inspection/flight.png` and `cockpit-stable.png`; map capture is `map-stable.png`. These are ignored local captures, not durable acceptance records. The first live-server capture reloaded mid-session and timed out at the map; its invalid cockpit image was discarded. The deck capture was transitional and is not evidence of a camera defect. Its DOM tip independently confirmed the wrong ↑ instruction.
5. No full combat/recovery playthrough, new performance benchmark, subjective audio audition or native target run occurred during planning. The runtime-native package is now installed, despite older handoff wording; the `native-playtests/` directory named by package scripts is still absent. Do not quote old native or performance evidence as current qualification.

## Solution

### 1. Honest attacks are the foundation

Extract the existing store-modifier calculation into one ordinary function in `src/sim/armament.ts`. Call it from loadout application and every successful player release; do not call `applyLoadout` to refresh weight because it replenishes stores. Bomb payload becomes **544 → 90 → 45 → 0 kg**; torpedo payload **1000 → 0 kg**. Drag follows remaining stores. Rejected releases change nothing. Preserve current loadout mass values; these are existing game constants, not newly certified historical measurements.

Carry the existing projectile `owner`, `team` and weapon kind through all `damageShip` callers. A direct hit, near miss, ongoing fire and sinking are distinct outcomes. Personal counters require player attribution; squadron contributions require an actual wing aircraft; other allied actions affect the battle without awarding the player a hit. Friendly damage never earns positive credit. Preserve the last effective hostile damage source for a later fire-caused sinking, award sinking credit once, and do not fabricate a new torpedo hit when a burning ship reaches zero HP.

Snapshot sortie ID, designated target ID and ordered-wing eligibility **at weapon release**. A subsequent recall, retask or attacker loss cannot revoke or grant that weapon's objective credit. A physical hit is confirmed for the player's objective when the target has a visual contact no older than 3 seconds at impact, or a subsequent fresh observed/recon report dated at or after that impact; otherwise retain the hit as unconfirmed. Never reveal unobserved enemy condition merely because the simulation knows it.

Use the carrier launch rule consistently when reporting **launch capability**: currently `launch` rejects `deck < 0.35`, while `operationalEnemyCarriers` uses `deck > 0.22`. Name the shared gameplay threshold and cover its boundary. Recovery eligibility remains a separate policy; its 0.25 threshold must not accidentally become a launch rule. Being unable to launch does not mean sinking. Observations of enemy condition still follow contact freshness, not omniscient world state.

Record compact impact metadata where damage is resolved: source ID/team, target ID, weapon, simulation time, direct/near-miss classification, damage and ship-local impact position. Use the existing event drain for transient notifications and a bounded per-ship impact list for persistent visuals. No second event bus or generic damage framework.

### 2. Three briefing choices, one existing battle

Add a native select or similarly small keyboard-accessible control to the existing briefing:

| Choice | Assignment and completion | Existing behavior reused |
|---|---|---|
| **Carrier strike — default** | Designate a known live enemy carrier; obtain one confirmed damaging bomb/armed-torpedo direct hit by the player or an explicitly ordered wing attacker; recover alive. Allied assistance is labeled. Strafing and splash damage do not satisfy this assignment. | Existing SBD/TBD loadouts, contacts, target selection, strike order, ballistics and recovery. |
| **Scout and report** | Obtain and transmit one fresh carrier contact, then recover alive. An escort-only report does not satisfy the assignment. Recon radio sightings retain their source; R still requires the existing freshness condition. | Existing search sector, player observation, PBY reports and report action. |
| **Open Pacific** | Existing multi-sortie operation: neutralize all four enemy launch capabilities and recover; normal repair/rearm loop remains. | Current battle, both fleets, service and operation win/loss logic. |

Both start buttons remain. Airborne start continues to skip the launch, with its existing 30-second battle warm-up excluded from displayed sortie duration. Aim for **8–12 elapsed minutes** for a successful short airborne sortie with assisted transit; this is a pacing target, not a historical timetable. No arbitrary timer kills the player or forces a battle result.

Keep new state in `src/sim/sortie.ts` as a small game-owned record and functions: selected assignment, start time, designated target, objective state, personal/wing contributions, and final result. `Battle` owns mutation. HUD, map orders and debrief read that same state. Briefing selection persists through restart; a new sortie resets its progress. Do not introduce mission-definition schemas, unlock trees, persistence or an engine mission package.

The flow is `briefing → launch/search → report or attack → return → debrief`. Dying is terminal at any stage. A safe return without achieving the assignment is **Returned — objective incomplete**, not operation victory or a crash. An objective achieved before death is shown alongside **Aircraft lost**. Freeze a short sortie's result after arrestment completes and `recover` begins, before the 12-second repair reset; the longer operation keeps its existing service behavior. Use a distinct debrief state if necessary rather than mislabeling every safe return as `won`.

If the designated carrier is sunk by unrelated allies before the hit, request a new known operational target. Do not award success or expose an unknown target. If no eligible objective remains, offer return with an explicit incomplete/unavailable outcome. Never strand the player in an impossible strike state.

Show one current action and its key in the existing mission panel. Correct Down/Up everywhere touched; remove the stale README mouse-steering claim as part of this instruction correction. Read existing flight state for warnings and torpedo release advice; do not add an automatic bomb drop, aim magnet or compulsory difficulty setting.

After `1/2/3/4`, show a compact wing summary based on actual `wing`, `tactic`, `mode`, `target`, alive and recovered state: forming, attacking designated target, engaged, returning, unavailable. An accepted command is not proof of an attack. Say when there is no live wing or no valid strike target. Keep radio captions; the audio PRD may voice existing messages separately.

### 3. Get the aircraft home without guessing the final approach

Add a pure `src/sim/recovery.ts` calculation consumed by the existing H action, `navigationPoint`, autopilot and HUD. H selects a live friendly recovery deck and first guides toward an astern setup point in the moving carrier's frame. At the setup, show heading/lineup and descend toward the existing L envelope. Existing `FlightModel` and course-hold control remain the only force/control implementation.

Re-evaluate deck availability during transit and final. If it becomes unusable, cancel final assist, announce a wave-off and offer/route to another available carrier through the same recovery selection. If no deck remains, show that fact once, cancel invalid assist and retain manual flight; the existing all-friendly-carriers-sunk defeat rule remains authoritative.

Display numerical speed/descent plus text corrections such as **too fast**, **left/right of centerline**, **high/low**, **gear not down** and **ready for L**. Build the latter from the same gate used by `assistRecovery`, not a second set of magic numbers. Existing L limits are gear down, astern within 700 m, altitude 24–180 m, speed under 72 m/s, lateral error under 100 m and heading error under 0.4 rad. Report speed units honestly: current speed is not carrier-relative touchdown speed. Keep current touchdown limits separate. In manual flight, guidance is advisory; steering still cancels assist.

Provide a conservative **return reserve estimate**, using observed normalized player fuel burn including leaks and the remaining approach route at achievable ground speed. Require a positive finite burn/speed sample; otherwise show **estimate unavailable**, not infinity or a promise of safety. Include an initial 120-second maneuver reserve and label it as a game estimate. It must respond to a fuel leak and longer diversion without increasing fuel or changing engine physics. Do not raise nominal fuel consumption merely to manufacture danger.

Debrief a short sortie with assignment result, personally credited hits, ordered-wing contributions, crew/aircraft return, elapsed time, and damage/fuel on arrival. Capture arrival before repair resets state. Keep this on the existing debrief surface; consolidate fields rather than add a campaign screen. Restart launches the chosen assignment with clean mission state, score and UI; repeated opens cannot duplicate credit or stack handlers.

### 4. Let the player see what the attack did

Extend `src/render/model-damage.ts` and existing `CombatParticles`; keep supplied hero geometry. Store at most **8 impact records per ship** and use at most **3 active fire origins**, selecting/replacing existing entries when capped. Project localized scorch marks onto suitable deck surfaces, and originate persistent fires from actual damaged locations transformed with the moving ship. Near misses remain sea effects; they must not place a direct-hit scar at the ship center.

Render changes should distinguish a direct deck explosion, a water splash and a burning disabled deck at cockpit/chase combat distance. Existing ship fire/engine/deck/HP state drives continued effects and functional consequences. No invented instant full-hull explosion, mesh-fracture system, compartment flooding, or different cosmetic-only damage simulation. The game owns all colour, shape, size and timing.

Retain existing particle caps, quality reductions and camera buffet. No new camera shake is required. Captions and numerical guidance must remain usable with sound muted; do not obscure the cockpit sight, target or horizon with persistent UI or effects. At low quality, reduce visual density without removing the indication that a carrier is burning or disabled.

### Engine ownership and audio coordination

The capability MCP search/detail tools were not exposed. Fallback inspection searched both installed `node_modules/@threenative/core/capabilities.json` and engine-source `packages/core/capabilities.json`, then read the matching records.

| Existing mechanism | Decision |
|---|---|
| `FlightModel` | Reuse force balance, damage modifiers, store mass/drag and existing deck run. No force, hook or moving-deck physics added here. |
| `WaveField` | Existing ocean already uses it. Keep current waves and wind; weather simulation is deferred. |
| `CameraShake` | Available, but current buffet already covers the in-scope camera need. Do not add a second shake layer. |
| `GPUParticles3D` | Available, but the current bounded TSL batches already render these effects. Reuse them; migrating particle plumbing is not needed for impact placement. |
| `AudioBus` | Portable sound mechanisms and generated assets belong to the existing audio PRD. Preserve its event fields and single event drain; this PRD does not edit audio implementation. |

Charter decisions: **gameplay never goes in a package**; **anything deciding the look stays in game render source**. Sortie rules, approach guidance and damage appearance can be written portably and therefore stay here. Any discovered need for a new platform seam, force or deck-contact mechanism must be fixed in the engine, logged in `FRICTION.md`, and delivered with unit/native proof, capability/template documentation and a content-hashed tarball reinstall. Such a discovery is a scope/dependency change, not permission to patch `node_modules` or silently claim web-only engine completion.

This work shares `Battle.events`, `Battle.say` and scene dispatch with the audio lane. Start from its current checkout state and preserve its payload contract. Add gameplay metadata compatibly; do not consume audio events twice, generate new audio assets or reset another lane's dependency edits.

### Historical direction and deliberate limits

Scouting, coordinated attacks and survival on return are grounded in Midway's documented carrier-aircraft operations. This PRD's short missions, fuel reserve, coordinates and timings are game design, not reconstructed historical sortie logs. [NHHC Midway overview](https://www.history.navy.mil/browse-by-topic/wars-conflicts-and-operations/world-war-ii/1942/midway.html)

The SBD's perforated dive flaps are already part of the aircraft's visual/handling identity. Spend effort making their existing use understandable rather than adding fictional equipment. [National Naval Aviation Museum, SBD-2](https://navalaviationmuseum.org/sbd-2-dauntless/)

| Defer | Why it loses to this slice |
|---|---|
| Volumetric clouds, rain and weather-based concealment | A static HDR sky is a real limitation, but meaningful cover also needs visibility/AI rules and GPU headroom. Cosmetic clouds alone do not solve the sortie loop. |
| Full tailhook/wire physics, ship heave and deck collisions | Automatic arrestment remains an acknowledged approximation. New deck mechanics belong to engine flight work with native proof. Guidance is useful immediately. |
| More playable aircraft, fleet remodels and historical paint corrections | The hero SBD is already detailed; procedural nonhero types and carrier likeness limitations are recorded in the handoff. Asset replacement is a separate outcome. |
| Campaign progression, full fighter-energy AI and advanced flooding | These enlarge several systems at once. First prove that one current-aircraft sortie is worth repeating. |

## Acceptance Criteria

All implementation evidence is pending. These are future executable criteria; planning observations above do not tick them.

- [ ] AC-1 [local; actor: agent]: B releases stores through the scene and actual flight step sees bomb payload 544→90→45→0 kg or torpedo 1000→0 kg with matching drag; an empty/rejected release changes nothing and service restores the selected loadout. — Evidence: pending E1/E2.
- [ ] AC-2 [local; actor: agent]: Actual projectile hits and subsequent fire/sinking award player, ordered wing and unrelated ally contributions correctly, exactly once; near misses are labeled accurately and friendly damage earns no positive credit. — Evidence: pending E1/E2.
- [ ] AC-3 [local; actor: agent]: At and around the launch-disable boundary, actual launch eligibility, current observed target status and operation objective agree; disabled afloat ships are not reported sunk. Recovery uses its separately named eligibility. — Evidence: pending E1.
- [ ] AC-4 [local; actor: agent]: Briefing selects strike, recon or Open Pacific; both start buttons honor it. Recon completes its objective only for a fresh transmitted carrier report, while a stale/escort-only report does not. — Evidence: pending E1/E2.
- [ ] AC-5 [local; actor: agent]: A designated carrier's confirmed player/ordered-wing bomb or armed-torpedo direct hit advances the strike objective; unrelated allied fire does not. Recall/retask after release preserves recorded eligibility, and an unobserved hit waits for confirmation. A prematurely destroyed/unavailable target produces a valid retask or explicit return outcome. — Evidence: pending E1/E2.
- [ ] AC-6 [local; actor: agent]: Mission panel and map orders agree with actual phase and assignment; deck tip/manual identify Down as nose-up; rejected actions explain their requirement without hiding existing aiming/stability assistance. — Evidence: pending E2.
- [ ] AC-7 [local; actor: agent]: Actual 1/2/3/4 commands update wing intent and the UI reports resulting aircraft behavior or unavailability; command acknowledgment alone never reports an attack as executed. — Evidence: pending E1/E2.
- [ ] AC-8 [local; actor: agent]: H guides to a moving carrier's astern setup before final; a newly unavailable deck triggers diversion/wave-off, while no available deck leaves a truthful message and no invalid autopilot target. — Evidence: pending E1/E2.
- [ ] AC-9 [local; actor: agent]: Approach cues and L eligibility agree for aligned/misaligned, high/low, fast/slow and gear states; assisted final flies continuously and manual steering cancels it. — Evidence: pending E1/E2.
- [ ] AC-10 [local; actor: agent]: Return reserve uses finite observed burn/route data; a leak or longer diversion reduces margin, and unavailable estimates never display infinite range or guaranteed recovery. — Evidence: pending E1/E2.
- [ ] AC-11 [local; actor: agent]: Safe recovery, incomplete safe return and aircraft loss create distinct short-sortie results, preserving pre-repair fuel/damage and ownership-specific counters; replay resets them. Open Pacific still rearms and requires the full operation objective. — Evidence: pending E1/E2.
- [ ] AC-12 [local; actor: agent]: A real hit creates a localized persistent scar/fire following the moving ship; a near miss creates sea effects without a false deck scar. Repeated impacts stay within 8 records/3 fire origins and clear on restart. — Evidence: pending E1/E2/E3.
- [ ] AC-13 [local; actor: agent]: Captured cockpit/chase views at 1400×800 show distinguishable direct hits, splashes and burning damage; flight sightlines remain readable on balanced and low quality, and mission/approach guidance works with sound muted and keyboard navigation. — Evidence: pending E2/E3; visual inspection required.
- [ ] AC-14 [local; actor: agent]: Comparable before/after warm combat captures identify adapter, quality, resolution and workload; GPU p95 remains within 10% of baseline and ≤16.7 ms on this NVIDIA/Turing reference, with no unbounded effect/mesh growth after three restarts. If baseline already exceeds the absolute budget, resolve the limitation explicitly before claiming this AC. — Evidence: pending E3.
- [ ] AC-15 [local; actor: agent]: Existing launch, aircraft, affected combat/recovery lifecycle and type/build checks pass against the final installed packages; added assertions verify gameplay state, not only absence of console errors. — Evidence: pending E1/E2/E3.
- [ ] AC-16 [local; actor: agent]: Two normal-entry airborne runs—one short recon and one short carrier strike—reach their correct recovered debrief in ≤12 elapsed minutes each using permitted assistance, with no world-state/HP/weapon/landing injection after start. Record input sequence, elapsed time and outcome; this proves attainable pacing, not universal player enjoyment. — Evidence: pending E2.

## Integration Ledger

| Capability | Reachable consumer/trigger | Replaces / disposition | Evidence |
|---|---|---|---|
| Payload and honest combat credit | `Midway.action` → `Battle.releaseOrdnance` (`src/sim/battle.ts:164`) → `dropBomb`/`dropTorpedo` → `updateWeapons` (`:1067`) → `damageShip` (`:570`) | Extract the existing store calculation; replace team-only personal credit and generic direct-hit labels. Update all callers, including fire death. | AC-1–3, E1/E2 |
| Finishable assignments and wing feedback | Existing `#start-deck`/`#start-air` → `Midway.begin` → `Battle.start` (`src/sim/battle.ts:228`); R/1–4 → `report`/`setCommand` → `Hud.update` (`src/hud.ts:100`) | Mission/map/debrief derive from one sortie state; Open Pacific delegates to its existing operation rules. No second battle simulation. | AC-4–7, E1/E2 |
| Recovery and outcomes | H → `Midway.goHome`; `Battle.navigationPoint` (`src/sim/battle.ts:290`) → existing autopilot; L → `assistRecovery` (`:993`) → `touchdown`/`recover` (`:960`, `:978`) → `Hud.debrief` (`src/hud.ts:544`) | Replace direct-to-center home routing, duplicate approach limits and cumulative-only short-sortie debrief. Keep flight/arrest/service mechanisms. | AC-8–11/16, E1/E2 |
| Localized visible consequences | `Battle.updateWeapons` → impact records → `WorldView.update`/`CombatParticles.update`/game-owned damage visuals | Replace generic carrier fire origins for new impacts; retain bounded particle batches and existing aircraft damage visuals. | AC-12–14, E3 |

## Execution Phases

#### Phase 1: A released weapon changes the aircraft and credits its actual attacker
**Status:** COMPLETE
**ACs:** AC-1–3; foundations for AC-5/12.
**Files:** `src/sim/armament.ts` (shared store update), `src/sim/battle.ts` (all hit callers, attribution, launch predicate, bounded impact metadata), `scripts/check-flight.mjs` (extend current checks).
**Implementation:** Start with the two observed defects. Preserve owner IDs through direct hits, near misses and fire death. Add only the state required by later game consumers. Capture current red results with targeted assertions before fixing logic.
**Verification:** E1 — payload sequence/rejected release/rearm; AI versus player projectile impacts and fire death; threshold boundary. E2 — B reaches the real store path in both loadouts.
**Delivered:** `updateStores` extracted in `src/sim/armament.ts` and called from `applyLoadout`, `dropBomb` and `dropTorpedo`. `damageShip` takes the projectile's own `owner` and a `nearMiss` flag; `sinkShip` credits the preserved `lastHostileHit` once and a fire death no longer fabricates a torpedo hit. `LAUNCH_DECK`, `RECOVERY_DECK` and `DECK_FAILED` name the three thresholds that were previously three bare numbers. `recordImpact` keeps 8 ship-frame impacts per hull.
**Checkpoint:** Focused self-review done. No independent reviewer has read the attribution change.

#### Phase 2: Choose an assignment and understand what the squadron is doing
**Status:** COMPLETE
**ACs:** AC-4–7; short-sortie completion routing for AC-11.
**Files:** New `src/sim/sortie.ts`; `src/sim/battle.ts`; `src/scenes/Midway.ts`; `src/hud.ts`; `index.html`; `src/style.css` only if existing styles are insufficient; `README.md` control correction.
**Implementation:** Add three briefing choices, objective state, confirmed contributions, explicit unavailable-target handling and actual wing status. Wire short-sortie termination through existing recovery; use that outcome immediately rather than leave orphan mission state until Phase 3. Preserve audio-lane dispatch changes.
**Verification:** E1 — mission transitions/invalid reports/target loss/credit. E2 — actual selection, report and order controls; correct instructions, map text, recovery outcome and replay.
**Delivered:** New `src/sim/sortie.ts` holds the assignment record and its pure functions; `Battle` owns every mutation. A weapon is stamped at release with the sortie id, designated target and ordered-wing eligibility, and an unobserved hit waits in `pending` until a report dated at or after it arrives. `Battle.wingStatus()` reports live wing behaviour rather than the accepted order. The briefing carries `#assignment-select`; the scene keeps the choice across restarts.
**Checkpoint:** Focused self-review done; contracts reviewed together with Phase 3. No independent reviewer.

#### Phase 3: Fly the approach and see what returned home
**Status:** COMPLETE
**ACs:** AC-8–11/16.
**Files:** New `src/sim/recovery.ts`; `src/sim/battle.ts`; `src/scenes/Midway.ts`; `src/hud.ts`; existing `index.html`/styles as needed.
**Implementation:** Route through a moving astern setup, share final-eligibility calculations, report changing deck/fuel conditions and preserve arrival snapshot before service. Existing autopilot controls produce movement; no teleporting or invented lift. Complete the recon/strike normal-entry runs and tune pacing without changing damage or fuel to force success.
**Verification:** E1 — eligibility boundaries, damaged/sunk carrier diversion, missing estimates and stable outcome snapshots. E2 — continuous approach, L/manual cancellation, recovery and replay; two ≤12-minute complete short sorties without post-start state injection.
**Delivered:** New `src/sim/recovery.ts` owns the astern setup point, the transit/setup/groove/final phases, the single `finalReady` gate that `assistRecovery` and the "READY FOR L" cue both call, and `reserveEstimate`. `Battle.goHome`, `navigationPoint`, the autopilot and the HUD all read it. `updateRecovery` diverts or wave-offs when a deck is lost and says so once when none remain. A short sortie freezes its result in `recover()` before the 12-second service reset and enters a distinct `debrief` status.
**Checkpoint:** Focused self-review done. No independent review of mission/recovery behaviour.

#### Phase 4: See damage where it happened, within the current frame budget
**Status:** COMPLETE
**ACs:** AC-12–15.
**Files:** `src/render/model-damage.ts`; `src/render/particles.ts`; `src/render/world.ts`; targeted extensions to existing browser/lifecycle tools.
**Implementation:** Use Phase 1 impact positions for limited scorch/fire origins. Capture matching direct-hit/near-miss views and check moving attachment. Keep material/asset ownership correct on restart and effect replacement.
**Verification:** E3 — viewed cockpit/chase captures, capped repeated impacts and matching before/after combat workload; E2 — three restart cycles and existing regression flows; final type/build checks once.
**Delivered:** `updateShipScars` in `src/render/model-damage.ts` keeps up to 8 scorch planes per hull in the ship's own frame, skipping near misses and impacts below the deck surface; it rebuilds from `ship.impacts` every frame, so a restart with no impacts hides every mark without a separate teardown. `src/render/particles.ts` takes its three fire origins from the three most recent non-near-miss impacts, falling back to the old fixed positions for a ship burning without a recorded hit.
**Checkpoint:** Focused self-review and a viewed frame. No independent review.

## Verification commands and evidence ownership

Run every command from `midway-open-pacific/`. Reuse the current assert/esbuild and Playwright tools; no new test framework. Add a dedicated scenario only when extending an incumbent would make it unclear. Record concise results on the owning AC above, not in new reports.

| Evidence | Commands / consumer path | Distinct property |
|---|---|---|
| E1 | `node scripts/check-flight.mjs` — extend its real-Battle fixtures; test-first for changed behavior. | Deterministic payload, credit, objective and approach boundaries. Test actual projectile resolution, not just a mocked `damageShip`. |
| E2 | `bash tools/capture-lock.sh node tools/capture-lifecycle.mjs` with `MIDWAY_URL` pointing to the candidate. Extend existing controls/state assertions; retain explicit labels on injected exceptional-state fixtures. | Actual input/HUD/scene wiring, recovery, lifecycle, normal-entry pacing and regressions. Forced rare states do not establish AC-16. |
| E3 | `MIDWAY_URL=http://127.0.0.1:5199 MIDWAY_WIDTH=1400 MIDWAY_HEIGHT=800 bash tools/capture-lock.sh node tools/capture-performance.mjs` before/after; use existing capture tools for viewed effects. `node scripts/check-aircraft.mjs` for model regression. | Comparable GPU cost, effect attachment, sightlines and restart/resource behavior. Include a repeatable burning-carrier workload; do not benchmark a clean empty sky as damage proof. |
| Final | `pnpm typecheck` and `pnpm exec vite build`; existing launch/flight scenarios through the installed playtest runner under `tools/capture-lock.sh`, `--browser-recipe webgpu --headed`. | Integration/build and preserved flight. Existing diagnostic-only scenarios need state assertions for any newly claimed behavior. |

Use `holdTicks`/`waitTicks` in playtests, seed and setup quaternion for controlled fixtures, and Space for guns. Never use `xvfb-run` or a visible desktop browser. Pin the before and after source snapshots separately, keeping packages, GPU, viewport, graphics setting and workload identical; old handoff timing is not a baseline. Record frame-time distribution as well as GPU time, and distinguish virtual-display presentation cost from GPU rendering. No type/build reruns are required merely to edit this planning document.

Before execution, resolve the primary owning checkout and follow the installed git-worktree skill if creating isolation: only `<repo-root>/.worktrees/<task-slug>/`, ignored and ownership-verified. Reuse the task checkout; preserve the active audio lane. On implementation completion, follow required checkout cleanup and report any retained path/reason. The current planning task creates no worktree.

Planning review: independent read-only review identified release-time wing eligibility and before/after snapshot wording; both were clarified. Document checks verify unique AC/phase IDs, relative links and proposed/not-started statuses. No implementation criteria are marked complete.
