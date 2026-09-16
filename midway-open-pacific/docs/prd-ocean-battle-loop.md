# PRD — Ocean battle loop: realistic ocean, survive a shoot-down, an honest war map (FINAL)
**Status:** Implemented on `develop`: ocean `4404e62`, battle continuation `d3ee729`, integrated at
`ee7156c`. `develop` includes `main` through `21a6194`. The final integrated browser check passed;
both task worktrees were removed after preserving their screenshots.
**Scope:** Web acceptance only. No native claim. No engine changes; every mechanic is game-owned
(`src/render`, `src/sim`, `src/hud.ts`, `src/scenes/Midway.ts`, `index.html`).
## Outcome
1. **Ocean** has less repeated cross-hatching using the same four waves and existing rendering work.
   Final GPU timing remains unverified.
2. **Losing one aircraft does not end the battle**: the world keeps running, the lost sortie freezes,
   and the pilot takes another aircraft from any operational friendly deck. Genuine fleet/operation
   defeat stays terminal.
3. **The tactical map says who is winning** from the fleet's own beliefs only — never an unobserved
   hull — and a sinking the crew watched counts.
## Reused capabilities (no engine change)
- Deck economy: `carrier-ops.ts` conserved `CarrierAir`, `canLaunch`/`applyLaunch`/`refreshDeck`,
  `resetPlayerForLaunch`, `home`/`recoveryCarrier` operational-deck selection.
- Sortie stamps: `sortie.id` increments and `releaseStamp` binds a weapon at release, so a replacement
  sortie can neither revoke nor grant an earlier weapon's credit.
- Intel: contacts as dated beliefs (`src/sim/intel.ts`, `recordContact`, `mergeContact`, `isStale`,
  `estimatePosition`); the new `Battle.battleStatus()` reads those reports.
## Slice A — ocean (`src/render/ocean.ts` only) — SHIPPED `4404e62`
Root cause: the four analytic bands each carried ~a fifth of the slope variance (`k·A`) in two
near-parallel pairs 122° apart, so their summed normal was a regular crossed lattice the specular sun
path rendered as fixed cells. The **first texture candidate** (dropping the k=8 octave, warping and
turning the two samples) was **rejected** — at chase range the ripple texture is sub-pixel and too
subtle — and reverted. The fix is **parameter-only, four bands retained**:
1. Fan the four bands out of one wind swell: dominant 22° carrying 59% of slope variance, a weaker 120°
   cross swell, two small ripples at 60°/165° — no near-parallel pair, closest gap 38° (was 2°).
2. Give every band its own phase so crests cannot align at a common origin.
3. Same four bands, comparable wavelengths, unchanged speeds, `WaveField`, ring geometry, two texture fetches, draw counts
   and per-frame allocations; `phase` is an existing uniform, so no shader or CPU work was added.
Observed: slope shares 28/26/24/22% → 59/16/14/11%; slope rms 0.0177 → 0.0136 m/m. `pnpm typecheck`
PASS; `node tools/probe-ocean.mjs` PASS, Hs 1.15 m (baseline 1.14 m). True player chase at ~1000 m and
60 m shows one coherent swell train replacing the diagonal cross-hatch. **GPU performance on the final
candidate is UNVERIFIED:** attribution runs failed at browser startup on the shared host. Prior
`water-impact` ranges stand (rippleUpdateCpu p95 ≈ 4.6–5.4 ms both variants; GPU p95 bimodal ≈ 9.5 vs
≈ 16.3 ms).
## Slice B — survive an aircraft loss (`src/sim/battle.ts`, `src/scenes/Midway.ts`, `index.html`)
- A shoot-down keeps the existing fall/impact/settle: `crashing` → `wreck` (splash, camera backs off)
  → **`downed`** once any friendly carrier is afloat; `status` stays `"playing"`.
- **Every** aircraft-loss path routes through one transition: `crashPlayer` non-flight, carrier
  destroyed during recovery, arrestment deck failure, bow overrun, deck cannot launch, hard deck
  impact, carrier-side impact, ditching. In-flight destruction keeps the animated fall; immediate
  surface/deck losses go straight to `downed` without inventing effects.
- `losePlayerAircraft`/`goDownedOrLose` freeze the lost sortie under its own id, disable the lost
  airframe and its engine, and count the player's loss once; repeated calls while `wreck`/`downed`
  are a no-op. Only `friendlyCarrierAfloat` false
  reaches `lose`, so the global `!usCarriersAfloat` defeat in `step` is the single guard.
- `Battle.takeAnotherAircraft()` picks the nearest deck passing `canLaunch`, charges `applyLaunch`
  exactly once (one airframe, store, fuel load and gun load — never the downed aircraft's rounds),
  stashes `lastResult`, opens a new `sortie.id`, and returns the pilot to `deck` mode.
- `Midway.ts`: the real button (`#take-aircraft`) and **Enter** both call it; the death cam leaves the
  cockpit; the wreck/downed aircraft takes no orders.
## Slice C — honest map, observed sinkings included (`src/sim/battle.ts`, `src/hud.ts`, `index.html`)
- `IReport.deckOut` records deck condition **only as an observation saw it** (cleared by a later
  observation of a repaired deck); `IReport.sunk` records a **witnessed** sinking as terminal truth.
- `recordContact` stamps both from the hull the observer is looking at. `updateIntel` records a sinking
  only while a real observer can see the hull, including a first sighting during the sinking. A fully
  submerged wreck cannot be sighted by visiting its old position. A confirmed sinking counts even
  after its track ages.
- `battleStatus()` compares **confirmed enemy attrition (sunk, plus non-sunk observed deck-out)**
  against **friendly decks out of action**, never reported-contact counts. Basis: "CONFIRMED ENEMY
  CARRIERS DISABLED OR SUNK (VISUALLY OBSERVED)". No hidden-hull reads, no raw positions.
## Verification completed
- `pnpm typecheck` PASS · `pnpm exec vite build` PASS.
- `node scripts/check-battle-continuation.mjs` PASS — downed lifecycle, exactly-once replacement
  economy, alternate deck, refusal, last-carrier defeat; new cases: ditching, carrier lost under an
  aircraft on deck, carrier lost during service → `downed` with one counted loss and a surviving
  alternate deck; no friendly carrier → `lost`; unseen sinking no credit; witnessed sinking credits
  with an intact deck; confirmed sinking survives a 400 s stale track; disabled afloat deck adds a loss
  and clears on observed repair; lost aircraft are inactive, first sightings of visible sinkings count,
  and submerged wrecks cannot leak hidden state.
- `node scripts/check-carrier-ops.mjs` PASS · `node scripts/check-intel.mjs` (15) PASS ·
  `node scripts/check-naval.mjs` (10) PASS.
## Known baseline failures (pre-existing, reported, not caused by this change)
- `node scripts/check-flight.mjs`: ordered-wing-strike assertion (`completers.length >= 1`) fails on all
  five seeds; verified identical on the base commit.
- `node scripts/check-aircraft.mjs`: fails at the propeller-blur handoff (`:280`).
## Browser state / evidence
- Battle-continuation proof complete on isolated port 5392: `tools/capture-crash.mjs` PASS (9 frames;
  real downed button → replacement deck → relaunch → map) and `playtests/launch.playtest.json` PASS
  (`pass: true`, headed WebGPU, holdTicks), both via `tools/capture-lock.sh`. Frames inspected by eye;
  the downed panel and map basis are legible.
- Repeated typecheck, build, continuation checks and the complete browser crash/replacement/relaunch
  flow after integrating both changes at `ee7156c`: all passed, with an NVIDIA Turing WebGPU adapter.
  Integrated frames are preserved in `screenshots/battle-continuation/`, including `06-downed.png`,
  `07-replacement-deck.png`, `08-relaunch.png` and `09-battle-status.png`.
- Ocean evidence (primary checkout `/home/joao/projects/threenative/sandbox/midway-open-pacific/`):
  `screenshots/ocean-battle-loop/ocean-baseline/07-chase-air.png`,
  `screenshots/ocean-battle-loop/ocean-after/07-chase-air.png`, and the matching `08-chase-low.png`.
- Cleanup: both task checkouts were removed and their registrations verified absent. The battle
  checkout's 38 evidence files were copied and hash-verified before removal; its private server was
  stopped. Other worktrees and the primary dev server were left running.
## Out of scope
Engine `FlightModel`/`WaveField`; `SpectralOcean`; whole-battle reset; native targets; new repo reports.

## Regression follow-up: rear-gunner + own tracers restored (midway/gunner-restore)

Two develop regressions, both from one feature lane that was never merged
(`midway/douglas-rear-gunner`, tip 71b3a21; merge-base dcd83dc) — not a redesign:

- **Rear-gunner station.** Develop had no `#btn-gunner`, no `src/render/rear-station.ts`, no rear
  belt state, and only a `V` hold-rear cam. Recovered the feature files (`rear-station.ts`,
  `aircrew.ts`, `sim/gun-mount.ts`, `tactics.ts`, `armament.ts`, `imported-aircraft.ts`,
  `devastator.ts`, `airframe-lod.ts`, plus the `weapon.rear-gun.glb` / `gun-30.ogg` assets) and
  three-way merged the shared files (`world.ts`, `Midway.ts`, `hud.ts`, `battle.ts`, `style.css`,
  `index.html`) onto develop. `battle.ts`/`audio-catalog.mjs`/`midway-audio.json` were taken at
  362eb05 so the unrelated wingman-warnings feature (fdf3e39) and its R32/R33 audio stay out.
- **Own tracers.** Develop's own rounds were `T.LineSegments` with a camera-facing cross (e9e304e +
  8fb656b), which read as crosses in the gunsight. Restored the lane's `T.InstancedMesh` of a
  velocity-stretched sphere (one pooled draw, one round = one ellipsoid head) introduced by 362eb05.

Preserved on develop: ocean 4404e62, cockpit warmup 40734df (`warmUpViews`), carrier replacement /
battle status d3ee729 (`takeAnotherAircraft`, `downed` mode, `#downed`/`#take-aircraft`, map
`battleStatus`), and radio cue wiring 42413df. Gunner is refused unless `mode === "flight"`; a
crash calls `leaveGunnerStation` and a replacement resets `gunner/gunnerYaw/gunnerPitch`.

Evidence (isolated port 5393): `pnpm typecheck` PASS · `pnpm exec vite build` PASS ·
`node scripts/check-gunner.mjs` PASS · `check-battle-continuation` PASS (assertion updated to the
gun-table SBD rear capacity, 1200, not the old 240 constant) · `check-audio` (29) ·
`check-radio` (8) · `check-intel` (15) PASS · `tools/capture-gunner.mjs` PASS on SBD and TBD ·
`tools/capture-tracers.mjs` PASS (instanced ellipsoid, live rounds). `check-flight`/`check-aircraft`
not run: known pre-existing baseline failures named above.
