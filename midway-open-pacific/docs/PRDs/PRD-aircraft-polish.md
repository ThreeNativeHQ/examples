# Supplied aircraft, fleet and pilot asset polish

**Status:** IN PROGRESS
**Complexity:** 1 → LOW; risk override: none
**Owner:** Codex
**Depends on:** existing aircraft import integration

## Context and solution

The user expanded this task to every model in `/home/joao/Downloads/midway-missing-models`, including `carrier-aircraft-pilot.glb`. Another AI owns `PRD-midway-asset-battle-integration.md` and its simulation/render wiring. This lane owns asset quality: source/shipped comparisons, uniform scale only, safe geometry reduction, materials, aircraft moving-part pivots/clips and pilot inspection. Preserve originals and pre-edit shipped bytes. Do not squeeze one dimension to satisfy a class dimension table. Keep source defects distinct from import damage. All delivery checks stay in this PRD.

Worktree: `/home/joao/projects/threenative/sandbox/.worktrees/aircraft-polish`, branch `codex/aircraft-polish`, owner Codex, base `672940c19a927b0d984580af063648544279bd76`; cleanup pending. The other AI was actively running both imports on the primary checkout; user notified to separate ownership before final asset delivery.

## Acceptance criteria

- [ ] AC-1 [local; actor: Codex]: inspect every unique supplied model against its shipped derivative; rebuild damaged imports preserving source proportions with rotation/translation/uniform scale only, and inspect the resulting frames.
- [ ] AC-2 [local; actor: Codex]: aircraft propeller and applicable gear/control parts have correct pivots and independently playable animation; source limitations and pilot condition are recorded honestly.
- [ ] AC-3 [local; actor: Codex]: repeatable imports and focused geometry/animation checks pass; inspect assets in a real WebGPU viewer. Battle integration remains the other lane's responsibility.

## Integration

Supplied GLBs → existing Blender import scripts → `public/assets` → the integration lane's aircraft/fleet constructors. Preserve asset names and document measured pivot/clip contracts. A standalone WebGPU asset viewer exercises the same GLBs while the other AI changes gameplay.

## Execution phases

1. Inspect and rebuild materials/rigid moving parts from the originals; preserve backups under ignored screenshots. Update the existing import pipeline. Status: IN PROGRESS.
2. Wire animation, run focused checks and inspect web captures. Record concise results here. Status: NOT STARTED.
