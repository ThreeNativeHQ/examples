# AC-24 — non-browser gate run

AC-24 (verbatim, `docs/PRDs/PRD-midway-asset-battle-integration.md`):

> Required type/build and affected existing simulation/browser checks pass on the integrated
> candidate; repeated restart/LOD churn has no runtime diagnostics or destroyed shared resources.
> Web qualification is explicit; any new engine portability mechanism has its required native proof
> before adoption.

Run date: 2026-09-14, working directory `/home/joao/projects/threenative/sandbox/midway-open-pacific`.
Each row below is a command that was actually executed; every number is its measured wall time.

## Candidate and provenance — read before the table

The run happened on the **shared, concurrently-edited checkout**, not on a frozen revision.
Another lane was writing to the tree throughout and after this run, so this is evidence of what
executed, not a qualification of a fixed revision.

- `HEAD` = `9b06379ece97fb5b1c39435d4c4399c8ba8c7193`
  (`feat(midway): the cruiser scouts become visible, on floats, because the simulation has been flying them all along`).
- Working tree was dirty the whole time. Modified/untracked at the time of writing:
  `src/sim/battle.ts`, `src/sim/flight.ts`, `src/sim/tactics.ts`, `src/render/imported-aircraft.ts`,
  `docs/remaining-asset-battle-failures.md`, plus untracked `docs/FLUID-LAB-HANDOFF.md`,
  `scripts/_probe-airframe.mjs`, `scripts/check-airframe-flight.mjs`, `scripts/check-role-reachability.mjs`.
- Edits landed **during and after** the run (mtimes, America/Los_Angeles):
  `src/sim/flight.ts` 03:04:03, `src/sim/battle.ts` 03:08:54, `src/sim/tactics.ts` 03:09:25,
  `src/render/imported-aircraft.ts` 03:10:46, `scripts/check-airframe-flight.mjs` 03:10:53.
- Main pass ran 02:51:37–03:05:30; `check-flight` (03:04:03 window) and `check-naval-battle` in
  particular were running while `src/sim/flight.ts` was being rewritten underneath them.
- `scripts/check-airframe-flight.mjs` and `scripts/check-role-reachability.mjs` **did not exist when
  the main pass enumerated `scripts/check-*.mjs`**; they appeared mid-run (03:04/03:08), were run
  separately afterwards, and `check-airframe-flight.mjs` was then edited again at 03:10:53 — after
  the run recorded below. Their results are therefore the stalest in this document.

## Results

| # | Gate | Result | Wall time (s) |
|---|------|--------|---------------|
| 1 | `pnpm typecheck` | PASS | 3.4 |
| 2 | `pnpm exec vite build` | PASS | 1.8 |
| 3 | `node scripts/check-agenda.mjs` | PASS | 0.1 |
| 4 | `node scripts/check-ai-flight-cost.mjs` | PASS | 4.3 |
| 5 | `node scripts/check-aircraft.mjs` | PASS | 1.7 |
| 6 | `node scripts/check-airgroup.mjs` | PASS | 0.2 |
| 7 | `node scripts/check-armament.mjs` | PASS | 0.1 |
| 8 | `node scripts/check-asw.mjs` | PASS | 0.1 |
| 9 | `node scripts/check-audio.mjs` | PASS | 0.1 |
| 10 | `node scripts/check-battle-consumers.mjs` | PASS | 23.5 |
| 11 | `node scripts/check-briefing.mjs` | PASS | 0.4 |
| 12 | `node scripts/check-carrier-cycle.mjs` | PASS | 208.4 |
| 13 | `node scripts/check-carrier-ops.mjs` | PASS | 20.5 |
| 14 | `node scripts/check-catalog.mjs` | PASS | 0.1 |
| 15 | `node scripts/check-damage.mjs` | PASS | 0.1 |
| 16 | `node scripts/check-deck-agreement.mjs` | PASS | 45.7 |
| 17 | `node scripts/check-facilities.mjs` | PASS | 0.1 |
| 18 | `node scripts/check-flight.mjs` | PASS | 125.2 |
| 19 | `node scripts/check-fluid.mjs` | PASS | 0.5 |
| 20 | `node scripts/check-fog.mjs` | PASS | 9.9 |
| 21 | `node scripts/check-formation.mjs` | PASS | 0.1 |
| 22 | `node scripts/check-geometry.mjs` | PASS | 12.4 |
| 23 | `node scripts/check-gunnery.mjs` | PASS | 0.1 |
| 24 | `node scripts/check-intel.mjs` | PASS | 0.1 |
| 25 | `node scripts/check-loops.mjs` | PASS | 4.8 |
| 26 | `node scripts/check-mission-decisions.mjs` | PASS | 28.5 |
| 27 | `node scripts/check-naval-battle.mjs` | **FAIL** | 320.9 |
| 28 | `node scripts/check-naval.mjs` | PASS | 0.1 |
| 29 | `node scripts/check-operation.mjs` | PASS | 5.6 |
| 30 | `node scripts/check-perf.mjs` | PASS | 0.1 |
| 31 | `node scripts/check-radio.mjs` | PASS | 0.3 |
| 32 | `node scripts/check-rescue.mjs` | PASS | 0.1 |
| 33 | `node scripts/check-scouting.mjs` | PASS | 0.1 |
| 34 | `node scripts/check-seeded-battle.mjs` | PASS | 0.1 |
| 35 | `node scripts/check-sortie-kinds.mjs` | PASS | 1.5 |
| 36 | `node scripts/check-submarine.mjs` | PASS | 0.1 |
| 37 | `node scripts/check-torpedo-run.mjs` | PASS | 0.1 |
| 38 | `node scripts/check-weapons.mjs` | PASS | 0.3 |
| 39 | `node tools/check-fleet.mjs` | PASS | 4.0 |
| 40 | `node tools/check-catalog.mjs` | PASS | 1.3 |
| 41 | `node tools/probe-ocean.mjs` | PASS | 0.2 |
| 42 | `node tools/check-asset-polish.mjs` | PASS | 2.0 |
| 43 | `node tools/check-carrier-assets.mjs` | PASS | 1.0 |
| 44 | `node scripts/check-airframe-flight.mjs` (late-added, untracked) | **FAIL** | 6.7 |
| 45 | `node scripts/check-role-reachability.mjs` (late-added, untracked) | **FAIL** | 55.8 |
| 46 | `node node_modules/create-threenative/dist/threenative.js doctor` (supplementary) | PASS | 8.6 |

`node tools/check-humanoid.mjs` is not listed: it is a library with no standalone entry point
(it exports `checkHumanoid`/`loadGlb` and is exercised by `check-asset-polish.mjs`, row 42).

Type/build notes: `check-aircraft` in row 5 is the project script `scripts/check-aircraft.mjs`;
`pnpm exec vite build` row 2 succeeded in 1.16 s with two non-fatal warnings
(`[NAMESPACE_CONFLICT]` re-export in `three-mesh-bvh`, and a >500 kB chunk-size notice). `doctor`
row 46 reported `"pass": true` (Blender 5.2.0 conversion available, capability servers resolving).

## Failing gates — first assertion, verbatim

**Row 27 — `node scripts/check-naval-battle.mjs`** (exit 1):

```
FAIL  AC-14 escort holds station through a turn
      USS Phelps's frame offset moved 785 m through a 0.50 rad turn (before 1199,1516 after 755,869)
```

The script's own summary: `check-naval-battle: 1 claim(s) FAILED` / `- AC-14 escort holds station
through a turn`. The other 16 claims in that script passed, including `AC-14 no surface ship
teleports`, `AC-14 ships avoid the atoll`, and `determinism: same seed and trace, same state`.

**Row 44 — `node scripts/check-airframe-flight.mjs`** (exit 1; untracked, added mid-run, edited after this run):

```
FAIL  AC-5 a loaded Kate flies a stable engine-driven ingress and closes the range
      kate left the deck by "overrun", not a liftoff: it reached only 30.0 m/s indicated
```

Summary: `check-airframe-flight: 3 claim(s) FAILED` — the other two are
`AC-5 every AI torpedo release passes the variant envelope at the moment of release` (same
`overrun` message) and `AC-5 a launched TBD is accepted back and counted again on recovery`
(`the deck must accept the returning TBD`, `false !== true`).

**Row 45 — `node scripts/check-role-reachability.mjs`** (exit 1; untracked, added mid-run):

```
FAIL  depth-charge — an escort hunts a sighted boat and drops a salvo
      no ASW salvo left the racks within 150 s. Battle never calls asw.stepHunt: no escort owns an AswState, so an escort cannot progress searching/investigating/attacking and no "hunt" event with salvoes>0 is ever emitted. The field that would have to be written is an escort hunt state (`s.hunt`, an AswState) — it does not exist; the run reached none of the facility/hunt/support roles instead
```

Summary: `check-role-reachability: 5 of 6 claim(s) FAILED` — additionally `sub-report`,
`scout-cover`, `air-defence`, `rescue-cover`, all reporting that `Battle` never appends an
`ISupportEvent` (the other passing claim was `facility-hit`).

## Browser gates NOT run here

Per the task, nothing wrapped in `tools/capture-lock.sh` was executed (another lane holds the
display). These are the browser gates this repository specifies and that were **not** run, so no
result is claimed for any of them:

- `bash tools/capture-lock.sh node tools/check-repair.mjs`
- `bash tools/capture-lock.sh node tools/capture-deck.mjs`
- `bash tools/capture-lock.sh node tools/capture-fleet.mjs`
- `bash tools/capture-lock.sh node tools/capture-sortie.mjs`
- `bash tools/capture-lock.sh node tools/capture-sortie-runs.mjs`
- `bash tools/capture-lock.sh node node_modules/@threenative/playtest/dist/runner/cli.js --scenario playtests/launch.playtest.json --url http://127.0.0.1:5199 --browser-recipe webgpu --headed --timeout 45000`
- the remaining capture tools, all browser work:
  `capture-asset-polish`, `capture-audio`, `capture-battle-roles`, `capture-fluid-lab`,
  `capture-hulls`, `capture-lifecycle`, `capture-performance`, `capture-player-aircraft`,
  `capture-ripples`, `capture-vfx` (each `tools/capture-*.mjs`).
- `pnpm test` (runs `playtests/*.playtest.json` through the WebGPU browser recipe).

`node tools/check-carrier-assets.mjs` was run (row 43) and is **not** a browser gate — it reads
and asserts shipped GLB bytes with no Playwright import.

## AC-24 restart/LOD churn clause — explicit gap

The clause "repeated restart/LOD churn has no runtime diagnostics or destroyed shared resources"
is browser work and was **not attempted** here. The command that would prove it is:

```
bash tools/capture-lock.sh node tools/capture-fleet.mjs
```

(`tools/capture-fleet.mjs` asserts that a deck-park restart keeps shared geometry.) No browser
result is claimed for this clause.

## AC-24 web-qualification / native-proof clause

Web qualification is explicit by omission above: no browser gate ran, so the browser half of
AC-24 is unqualified. The conditional "any new engine portability mechanism has its required
native proof before adoption" cannot be settled by this run: `pnpm test:native` (a desktop build
plus the `native-playtests/*.playtest.json` scenarios) was not run, and no mechanism audit was in
scope. If the in-flight changes added an engine portability seam, its native proof remains an
open gap.

## Verdict

- **43 passed, 3 failed** (main enumerated set: 42 pass / 1 fail; late-added untracked scripts: 0 pass / 2 fail; supplementary `doctor`: 1 pass).
- Failing names: `scripts/check-naval-battle.mjs`, `scripts/check-airframe-flight.mjs`,
  `scripts/check-role-reachability.mjs`.
- Only `scripts/check-naval-battle.mjs` was part of the enumerated candidate; the other two were
  written by a concurrent lane during the run and one was edited again after it. Because the tree
  was not frozen (see provenance), none of these three results should be treated as a stable
  revision's verdict.
