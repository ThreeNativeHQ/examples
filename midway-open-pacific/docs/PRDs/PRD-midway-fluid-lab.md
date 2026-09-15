# PRD-midway-fluid-lab — Pacific water and coupled impacts

**Status:** DONE — squashed onto `midway/asset-battle-integration` as `ec29694`
**Complexity:** 5 → MEDIUM; risk override: none
**Owner:** Codex
**Depends on:** Installed RippleField, WaveField, WaterSurface3D

## Context
User requests the whole appearance and mechanics of `/home/joao/Downloads/Midway-Fluid-Lab-V2.html`, plus ships visibly reacting when hit. Existing attempt adds a 900 m/128² ripple texture but omits its gradient from ocean normals, uses independent smoke-like water sprites and fixed-height foam, and has no returning-droplet coupling. Reference uses a finer local wave field, calmer swell, reflected geometry, advected porous foam, ballistic torn water sheets, spray, mist, rising bubbles and a damped gas cavity. Reference GLSL is WebGL-only; game remains WebGPU/TSL. Preserve existing gameplay and other agent edits.

## Solution
Reuse installed engine wave solve and planar reflection plumbing. Port reference appearance and whitewater dynamics into game-owned render source; no second wave solver or renderer loop. One combined CPU/GPU water-height owner drives normals, droplet crossings, floating foam and hull motion. Real Battle effects trigger depth-sensitive blasts; actual ship impact records trigger bounded recoil/rocking superimposed on navigation. Deep pressure-front motion remains distinct from slow surface waves. Keep MIT attribution with ported source.

Capability discovery: WaveField (CPU/TSL swell), RippleField (wave/foam/flow; no static hull mask), WaterSurface3D (reflection/refraction; transparent material, half-resolution extra scene draw). No matching authored water-curtain/whitewater/ship-hit presentation capability; these decide the look and remain portable game source. Bound particles/events/patch cost. Native platforms remain unverified unless run.

## Acceptance Criteria
- [x] AC-1 [local; actor: Codex]: Calm surface and aerial WebGPU captures show lab-inspired ocean color, coherent moving reflections, varied small ripples and porous surface foam; impact displacement also changes normals. Evidence: `screenshots/fluid-lab/{calm,aerial-foam}.png`, re-captured 2026-09-13 on NVIDIA Turing WebGPU; `src/render/ocean.ts` feeds the ripple-field gradient (`rippleNormal`) into the surface normal, and `underwater.png` now shows a coherent depth-tinted medium instead of the dawn sky.
- [x] AC-2 [local; actor: Codex]: Actual bomb/torpedo/depth-charge effects drive depth-dependent waves, torn sheets and spray; descending drops hit the same surface, return momentum, and leave drifting foam; bubbles surface into foam. Evidence: `node scripts/check-fluid.mjs` PASS; `tools/capture-fluid-lab.mjs` PASS with 2 611 spray parcels at 1.1 s, then 2 312 water hits / 646.5 return impulse / 2 405 foam parcels at 6.7 s, a real bomb reaching the coupled renderer (2 638 spray), and a deep blast that is delayed and attenuated; zero console/page errors.
- [x] AC-3 [local; actor: Codex]: Port/starboard ship hits visibly produce opposite roll/recoil, smaller ships respond more, motion decays, and normal navigation/deck attachment remain intact. Evidence: `check-fluid` asserts opposite-side roll reversal, smaller-hull amplification and decay; the live frame shows the hull roll 0.176 rad at the hit, decaying to 0.134 rad by 6.7 s. Navigation is unchanged: `shipMotion` is a render-time offset, and the crew/deck-parked aircraft remain children of the hull transform.
- [x] AC-4 [local; actor: Codex]: Pause/restart/disposal and bounded overlapping effects work; targeted simulation checks, typecheck/build and launch capture pass with no WebGPU errors. Evidence: the capture asserts pause freezes the water and ship response and reset clears active parcels; on the integrated branch `pnpm typecheck`, `pnpm exec vite build`, `node tools/check-fluid.mjs` and `node tools/probe-ocean.mjs` (Hs 1.14 m) all pass.

## Integration Ledger
| Capability | Reachable trigger | Replaces | Evidence |
|---|---|---|---|
| Ocean and coupled effects | Midway.update → WorldView.update → water | Ripple-only update and CombatParticles.column | AC-1/2 |
| Hull response | Battle.damageShip → ship.impacts → WorldView ship transform | Fixed sine bob alone | AC-3 |

## Execution Phases
1. Capture reference and existing game; implement shared water surface and TSL shading.
2. Couple real effects, whitewater, curtains and ship reaction; delete superseded water sprites.
3. Run behavior checks, inspect fresh captures, review and integrate exact task files.

## Verification log
- `node scripts/check-fluid.mjs`, `node tools/probe-ocean.mjs`, `pnpm typecheck` and `pnpm exec vite build` all pass on the integrated `midway/asset-battle-integration` tree.
- `tools/capture-fluid-lab.mjs` passed on NVIDIA Turing WebGPU with `"errors": []`, driving the real `Battle.updateWeapons` path for torpedo, bomb, deep and pause/reset cases.
- `playtests/launch.playtest.json` passed against an isolated server on the integrated tree: startup ready, briefing → deck → launch, 0 console errors, 0 network errors, 0 runtime diagnostics.
- The requested DeepSeek 4.1 Flash refactor was applied to the four owned render files (`whitewater.ts`, `water-effects.ts`, `ripples.ts`, `ship-motion.ts`): allocation-free emits and stats, dead fields/imports removed, nearest-impact min-scan instead of a sort. Appearance and fixed-step behaviour were preserved and all gates re-passed.
- MIT attribution for the ported reference is kept in `docs/fluid-lab-LICENSE.txt`.
- Remaining unverified: desktop/Android/iOS native targets and a sustained-impact frame budget (no AC-23-style measurement was taken with a live plume). Deep blasts remain evidence-record driven; no depth charge auto-deployment is claimed.

## Workspace
Owner/session: Codex fluid-lab (integrated by OpenCode). Primary `/home/joao/projects/threenative/sandbox`; branch `midway/asset-battle-integration`, squash commit `ec29694`. The original `codex/fluid-lab` checkout at `/home/joao/projects/threenative/sandbox/.worktrees/fluid-lab` still holds the pre-integration snapshot and other agents' uncommitted work; it is retained pending owner/cleanup authorization.
