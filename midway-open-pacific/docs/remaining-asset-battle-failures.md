# Asset battle integration: two deferred failures

Paused at the user's request on 2026-09-13. Resume directly in
`midway/asset-battle-integration`, in this primary checkout. The active DeepSeek
investigator was stopped; existing changes were preserved. Latest observed HEAD:
`4575f0c`. No further fixes or gates were run for this handoff.

Parent requirements: [asset battle integration PRD](PRDs/PRD-midway-asset-battle-integration.md).
These are the two deferred investigations, not a claim that every other PRD
acceptance criterion is complete.

## 1. TBD cockpit intersects the supplied opaque airframe

**Status: unresolved, AC-3/4 remain partial.** The imported TBD works in the
reviewed deck/chase views, but its detailed cockpit and camera do not fit a usable
opening in the supplied body. The earlier browser inspection found opaque body
geometry approximately 0.50 m along a downward-forward cockpit ray. The deck
camera obstruction was fixed separately in `aed86e0`.

**Relevant files:** `src/render/imported-aircraft.ts` (`TBD_COCKPIT_POSITION`,
`createAirframe`), `src/render/world.ts` (camera),
`public/assets/aircraft.tbd-devastator.glb`, `tools/import-aircraft.sh`, and
`tools/blender/articulate-aircraft.py`.

The asset worker found one opaque material on the shipped body and no reliable
material or topology boundary separating glazing from canopy frame. Its geometric
cut prototypes tore edges, removed frame, and exposed filler geometry. Its
transparent-material prototype leaked onto adjacent body panels and missed panes.
These prototypes were rejected and were not installed. The worker also measured
the current eye approximately 0.20–0.30 m above the canopy roof; reconcile this
offline measurement with the actual game camera before changing coordinates.

**Next investigation:** measure the live pilot eye and canopy opening together.
Repair the glazing/frame and cockpit fit in the asset pipeline if necessary;
re-authoring the canopy is the worker's proposal, not a verified solution. Preserve
the exterior, markings, 15.24 m span, wheel datum, pivots and all nine clips. Moving
the eye outside the aircraft or hiding the entire exterior is not acceptance.

**Acceptance:** run `node scripts/check-aircraft.mjs`, then, against an HMR-disabled
server serving this same checkout:

```sh
MIDWAY_URL=http://127.0.0.1:5332 bash tools/capture-lock.sh node tools/capture-player-aircraft.mjs
```

Inspect the real deck, chase and cockpit frames. Existing eye-position assertions
alone cannot prove that the windshield is clear or the cockpit fits. The server
must already be running at the selected URL; port 5332 is an example.

**Local evidence:** `/tmp/midway-deepseek-coordination/cockpit-prototype.result.md`
and `cockpit-prototype/` beneath the same directory contain measurements, six GLBs
and before/after PNGs. These are temporary, unshipped experiments; their browser
route check was not run. The findings above are retained here because `/tmp`
artifacts may disappear.

## 2. Ordered-wing strike / late assisted return needs integrated verification

**Status: previously failing; latest worker-only snapshot passed, not yet accepted.**
The failing assertion is `scripts/check-flight.mjs:457` (`late assisted return`).
Earlier integrated runs produced `result: null` and `acceptedFinal: false`: no
qualifying wing hit completed the objective before the 720-second limit. This
does not, by itself, identify recovery steering as the cause.

Immediately before the pause, the worker's source-snapshot run reported:

```json
{"outcome":"recovered","objective":true,"elapsed":706.416666666326,"personalHits":0,"wingHits":1,"hp":82,"carrier":"USS Enterprise"}
```

The full check exited 0 in `/tmp/checkflight_frozenA.out`. The worker recorded base
HEAD `ce2d318` plus then-uncommitted changes; the result is **not proof for clean
HEAD `ce2d318` or current HEAD `4575f0c`**. The coordinator stopped the investigation
before reviewing its final changes or rerunning on the primary branch. No browser
sortie acceptance is claimed from this pure-simulation result.

**Relevant files:** `src/sim/battle.ts`, `src/sim/tactics.ts`,
`src/sim/flight.ts` (`steerToward`), `src/sim/recovery.ts`,
`scripts/check-flight.mjs`, and `tools/capture-sortie-runs.mjs`.

**Next action:** run `node scripts/check-flight.mjs` on the current primary branch.
If it passes, run the existing keys-only browser sortie gate through
`tools/capture-lock.sh` against an HMR-disabled server from this same checkout and
inspect the recovered debrief. If it fails, trace delivered contact → explicit
strike order → release stamp → impact → observed confirmation → recovery gate.
Do not assume the old flight-steering diagnosis still explains the current tree.

Historical isolation at `68948eb` implicated the low-speed climb taper interacting
with the floor-recovery cap: restoring the untapered commanded floor cap recovered
in 374.75 simulated seconds. Later integrated builds still failed even with the
parent flight implementation. That historical fix therefore does not establish a
current root cause. A later worker diagnostic observed a stamped ordered-wing bomb
damaging the designated carrier at t=414.5, so the earlier blanket assumption that
the wing cannot land a credited hit also needs rechecking.

**Acceptance:** keep the existing ≤720 simulated seconds, recovered outcome,
confirmed wing hit and zero player hits. Do not widen the limit, force impacts,
bypass observed-intelligence rules, or grant unstamped weapons credit. The latest
706.42-second result leaves only 13.58 seconds of margin.

**Local evidence:** `/tmp/checkflight_frozenA.out`, `/tmp/wingtrace_frozenA.out`,
and `/tmp/midway-deepseek-coordination/wing_strike_fix.events.jsonl`; historical
comparisons are summarized in `recovery_fix.result.md` in that coordination
directory. Temporary snapshot output is diagnostic evidence, not an alternate
checkout to resume working in.
