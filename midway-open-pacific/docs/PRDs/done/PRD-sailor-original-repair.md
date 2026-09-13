# PRD-sailor-original-repair — Rebuild the deck sailor from the original mesh

**Status:** DONE
**Complexity:** 2 (LOW); risk override: none
**Owner:** Codex
**Depends on:** None

## Context
The current deck sailor tears around the hands and clothing in animation. The supplied original is `/home/joao/Downloads/navy sailor 3d model.glb`. `tools/blender/rig-deck-crew.py` currently binds a differently proportioned Quaternius skeleton with automatic weights. Inspect source anatomy and skin deformation through Blender MCP before choosing the correction. Preserve unrelated existing flight/recovery changes in the primary checkout; refit the cap band to the rebuilt source dimensions.

## Solution
Rebuild `public/assets/deck-crew.glb` from the original, correcting the asset-specific skeleton/binding and animations as evidence requires. Retain the six game-facing clips, twelve independent stations, original textured appearance and existing `SkeletalMesh3D` consumer. This is authored appearance, owned by the game; no new runtime system is needed.

## Acceptance Criteria
- [x] AC-1 [local; actor: agent]: Blender MCP imports the original and the rebuilt asset preserves intact hands, clothing and body through all six clips, with individually bending, relaxed fingers (user correction: rigid hands look robotic). — Evidence: source anatomy and open/relaxed/fist poses inspected in Blender MCP; all ten fingers bend, both fists retain closed seams. Thirteen samples per clip have zero coincident-seam separation; maximum hand edge growth in fists is 0.0228 m.
- [x] AC-2 [local; actor: agent]: Midway loads twelve independently animated sailors from the replacement GLB; close rendered views show intact hands and clothing. — Evidence: hardware WebGPU capture passes with 80,199 live skinned triangles, twelve independent stations and no console/GPU errors. Twelve close views in `screenshots/sailor-repair-stable/` cover all six clips; final wait/idle frames visually inspected.
- [x] AC-3 [local; actor: agent]: Reproducible build instructions and asset assertions match the new rig; fleet check, typecheck and web build pass. — Evidence: `node tools/check-fleet.mjs`, `pnpm typecheck`, `pnpm exec vite build`, Python AST/JSON parsing and touched-file whitespace checks pass. Instructions live in `tools/blender/HUMANOID-RIGGING.md`, `AGENTS.md` and its generated mirror.

- [x] AC-4 [local; actor: agent]: Reuse the same builder on a second unrigged T-pose humanoid using different measurements; shared hand/fist checks pass. Document the supported input and calibration process. — Evidence: separately exported unrigged UAL mannequin rebuilt with its own JSON and the shared builder. `node tools/check-humanoid.mjs /tmp/midway-sailor-repair/mannequin-rigged.glb` passes six clips on both material primitives and both fists. Incorrect source hashes and input/output path collisions are rejected before scene mutation.

## Integration Ledger
| Capability | Consumer | Replacement | Evidence |
|---|---|---|---|
| Reusable humanoid rigging | `tools/blender/rig_humanoid.py` + model measurement JSON → exported GLB → `tools/check-humanoid.mjs` | Extract the shared builder; retain `rig-deck-crew.py` as the actual game caller | AC-4 |
| Animated deck sailor | `src/render/deck-crew.ts:loadDeckCrew` → `DeckCrew` → live deck | Replace GLB and faulty binding pipeline; preserve runtime API | AC-1–3 |

## Execution Phases
#### Phase 1: Rebuild and inspect the original sailor
**Status:** DONE
**ACs:** AC-1
**Files:** `tools/blender/rig-deck-crew.py`, `public/assets/deck-crew.glb`
- [x] **Implementation:** Diagnose weights/rest alignment through Blender MCP, rebuild from original geometry, inspect every retained clip.
- [x] **Verification:** Asset deformation sampling and close rendered poses.
**Checkpoint:** Original binding failed with `hand_l controls only 0 vertices`; the first rigid-hand correction failed with `thumb_l controls only 0 vertices`. Explicit palm/phalange weights and anatomically aligned curl axes now pass. Small source middle/ring bridges were repaired from measured cuts. Rejected `Idle_FoldArms_Loop` because its contact pose buries the refitted forearms in the torso; `crew.wait` uses the visually inspected `Idle_No_Loop`.

#### Phase 2: Verify the live deck and document the pipeline
**Status:** DONE
**ACs:** AC-2, AC-3, AC-4
**Files:** shared builder/checker, `navy-sailor.json`, `HUMANOID-RIGGING.md`, `tools/check-fleet.mjs`, existing capture tooling, `AGENTS.md` and generated mirror.
- [x] **Implementation:** Adapt affected assertions, capture the actual game's sailor close up, update pipeline instructions.
- [x] **Verification:** `node tools/check-fleet.mjs`, `pnpm typecheck`, `pnpm exec vite build`, browser capture via `tools/capture-lock.sh`.
**Checkpoint:** Reuse proved on two humanoids. The mannequin required Blender's standard automatic body binding; the sailor retains an explicit anatomical override for its disconnected scan/clothing. Both use the same calibrated hand binding. Final capture command: `MIDWAY_URL=http://127.0.0.1:5398 MIDWAY_CREW_CLOSEUPS=1 MIDWAY_SHOTS=screenshots/sailor-repair-stable bash tools/capture-lock.sh node tools/capture-fleet.mjs`. Concurrent edits caused an HMR renderer-disposal error on the shared server; the final capture passed on a temporary server with HMR disabled, without suppressing browser errors.

## Delivered asset
Verified in the working checkout with concurrent unrelated edits preserved. `public/assets/deck-crew.glb`: 5,049,948 bytes; SHA256 `3c6a0862ba439d43e5557e74f965844f4f1471e5b0105bf7092bb5f47ee98602`. Reuse requires a measured T-pose humanoid; arbitrary pose conversion and contact IK remain outside this authoring tool. Native rendering was not tested in this task.
