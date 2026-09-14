# PRD-midway-fluid-lab — Pacific water and coupled impacts

**Status:** IN PROGRESS
**Complexity:** 5 → MEDIUM; risk override: none
**Owner:** Codex
**Depends on:** Installed RippleField, WaveField, WaterSurface3D

## Context
User requests the whole appearance and mechanics of `/home/joao/Downloads/Midway-Fluid-Lab-V2.html`, plus ships visibly reacting when hit. Existing attempt adds a 900 m/128² ripple texture but omits its gradient from ocean normals, uses independent smoke-like water sprites and fixed-height foam, and has no returning-droplet coupling. Reference uses a finer local wave field, calmer swell, reflected geometry, advected porous foam, ballistic torn water sheets, spray, mist, rising bubbles and a damped gas cavity. Reference GLSL is WebGL-only; game remains WebGPU/TSL. Preserve existing gameplay and other agent edits.

## Solution
Reuse installed engine wave solve and planar reflection plumbing. Port reference appearance and whitewater dynamics into game-owned render source; no second wave solver or renderer loop. One combined CPU/GPU water-height owner drives normals, droplet crossings, floating foam and hull motion. Real Battle effects trigger depth-sensitive blasts; actual ship impact records trigger bounded recoil/rocking superimposed on navigation. Deep pressure-front motion remains distinct from slow surface waves. Keep MIT attribution with ported source.

Capability discovery: WaveField (CPU/TSL swell), RippleField (wave/foam/flow; no static hull mask), WaterSurface3D (reflection/refraction; transparent material, half-resolution extra scene draw). No matching authored water-curtain/whitewater/ship-hit presentation capability; these decide the look and remain portable game source. Bound particles/events/patch cost. Native platforms remain unverified unless run.

## Acceptance Criteria
- [ ] AC-1 [local; actor: Codex]: Calm surface and aerial WebGPU captures show lab-inspired ocean color, coherent moving reflections, varied small ripples and porous surface foam; impact displacement also changes normals. Evidence: pending.
- [ ] AC-2 [local; actor: Codex]: Actual bomb/torpedo/depth-charge effects drive depth-dependent waves, torn sheets and spray; descending drops hit the same surface, return momentum, and leave drifting foam; bubbles surface into foam. Evidence: pending.
- [ ] AC-3 [local; actor: Codex]: Port/starboard ship hits visibly produce opposite roll/recoil, smaller ships respond more, motion decays, and normal navigation/deck attachment remain intact. Evidence: pending.
- [ ] AC-4 [local; actor: Codex]: Pause/restart/disposal and bounded overlapping effects work; targeted simulation checks, typecheck/build and launch capture pass with no WebGPU errors. Evidence: pending.

## Integration Ledger
| Capability | Reachable trigger | Replaces | Evidence |
|---|---|---|---|
| Ocean and coupled effects | Midway.update → WorldView.update → water | Ripple-only update and CombatParticles.column | AC-1/2 |
| Hull response | Battle.damageShip → ship.impacts → WorldView ship transform | Fixed sine bob alone | AC-3 |

## Execution Phases
1. Capture reference and existing game; implement shared water surface and TSL shading.
2. Couple real effects, whitewater, curtains and ship reaction; delete superseded water sprites.
3. Run behavior checks, inspect fresh captures, review and integrate exact task files.

## Workspace
Owner/session: Codex fluid-lab. Primary `/home/joao/projects/threenative/sandbox`; branch `codex/fluid-lab`; base `aed86e0c313b64a5538389f17a6fcb53b53c85ef`; checkout `/home/joao/projects/threenative/sandbox/.worktrees/fluid-lab`. Snapshot includes existing uncommitted work. Other ocean editor confirmed stopped. Integrate only this task's changes; cleanup pending.
