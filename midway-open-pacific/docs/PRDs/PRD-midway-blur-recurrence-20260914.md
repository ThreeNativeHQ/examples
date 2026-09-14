# PRD-midway-blur-recurrence-20260914 — Recurring mid-game 3D blur under `resolutionScale: "auto"`

**Status:** PARTIAL
**Blocker:** fix implemented locally with full focused evidence; required global gates stay red on unrelated baseline failures (see Gates).
**Complexity:** 3 (LOW); risk override: none.
**Owner:** Engine maintainer owns the scaler change under `packages/core/`; game agent owns only the capture + repackage.
**Depends on:** `docs/blur-investigation.md` (prior fix, DONE) and engine `docs/PRDs/PRD-384-adaptive-resolution-gpu-headroom.md`.
**Scope:** One engine-side scaler fallback change + repackage. Do not touch the dirty files owned by other lanes (`AGENTS.md`, `src/render/deck-crew.ts`, `src/render/devastator.ts`, `src/render/imported-aircraft.ts`, `src/render/world.ts`, `tools/capture-fleet.mjs`, `tools/capture-player-aircraft.mjs`, `tools/capture-resolution-soak.mjs`).

## Objective

Stop the recurring in-session softening/pixelation of the 3D scene (aircraft, ocean) while the React HUD stays sharp. Screenshot `/tmp/codex-clipboard-WM8yhS.png` matches the previously reproduced signature: full-CSS-size canvas, reduced drawing buffer, bilinear upscale.

## What the initial hypothesis got right and wrong

The PRD's runtime diagnosis (stale/missing-GPU presentation fallback walks the ladder down) was a HYPOTHESIS. Measured truth:

1. **90 s live baseline did NOT reproduce blur.** Isolated worktree `blur-repro` @ `d773085`, `vite --host 127.0.0.1 --port 5391`, `capture-resolution.mjs --observe`: `resolutionScale` 1.0 all 19 samples, `scaleSource: "auto"`, drawing buffer 1920×1080 throughout, all 3 cameras, 0 browser errors. GPU timing was FRESH the whole run (`gpuMs` 6–15 ms, `gpuAgeFrames` 4–7, budget ~17 ms) with fps ~9–10 (capture-environment slow), so the installed gpu-headroom fix correctly held full resolution. Stale/missing samples were never observed live — the fallback remained an inferred, not runtime-confirmed, cause.
2. **Root cause established deterministically at unit level.** On the installed build, one host-overload window (fps 20, presentation over budget) with missing or stale (`age` 9) GPU timing stepped 1.0 → **0.52 in a single observe()** — exactly the prior 998×562 signature (four rungs: 1.0→0.85→0.72→0.61→0.52) — and five such windows reached the floor (0.23). Monotonically noisy CPU-only timings (20, 20.01, 20.02, …) also ratcheted down under the intermediate one-rung-cap revision. A capped descent was therefore rejected in review: it reaches the same floor over a long flight.
3. **Parent review constraint (binding):** removing the fallback globally would break valid untimed/WebGL/native behavior, where presentation is the only signal. Unknown GPU timing must never be treated as proof of a GPU bottleneck, but backends without timestamp queries keep a signal: probes that earn their keep.

## Fix (engine-owned, implemented locally)

`packages/core/src/resolution-scaler.ts`: the unknown-GPU fallback now **probes instead of jumping** (`#probeUnknown`, `#noteGpuObservation` extracted so `observe()` complexity stays at its HEAD baseline of 20):

- Fresh `gpuMs > budgetMs` → sized jump from GPU cost, unchanged. Fresh `gpuMs <= budgetMs` → hold, unchanged.
- Unknown GPU + over-budget presentation → **one rung down**, recording pre-step fps. The next decided window must price **fewer rungs on the same rung table** (`#rungsToDrop` comparison — no new epsilon, timing noise that never crosses a rung boundary cannot accumulate), or the rung is **refunded** and further unknown-GPU probes stop (`#probeBlind`) until fresh timing or recovered fps reopens the question.
- A pending probe is evaluated **before** the floor guard, so a probe parked at 0.23 refunds to 0.27 instead of reporting `atFloor` forever; refunds skip the oscillation guard (measurement correction, not workload pumping).
- A gap immediately after fresh-healthy timing holds (transient, not a bottleneck).

`resolutionScale: "auto"` stays in the game; no game code change; no `node_modules` patch. Repackaged as `threenative-core-0.3.2-blur-probe-60a26a7446d8.tgz`, adopted in both `package.json` direct + `pnpm.overrides` entries of the main game and the isolated snapshot, `pnpm install` in both.

## Acceptance

- [x] **AC-1 (baseline):** 90 s `--observe` on the isolated 5391 server recorded scale 1.0, `auto`, 1920×1080 buffer, fresh `gpuMs` 6–15 ms age 4–7 throughout (`screenshots/blur-recur-baseline/samples.json`). Blur did not recur; headroom path confirmed working.
- [x] **AC-2 (post-fix):** same flight + C-key cycles without `--observe` **PASSES**: `resolutionScale` 1 throughout, `scaleSource: "auto"`, canvas math exact, 0 errors (`screenshots/blur-recur-patched/`, sim span 72.9 s, all 3 cameras). Both frames eye-inspected: aircraft/ocean sharp, no softening.
- [x] **AC-3 (unit/integration):** new `resolution-scaler-unknown-gpu.spec.ts` (8 tests: 120-window hold with `[0.85, 1]` as the only excursion, 30-window stale hold, transient-gap hold then probe, rung-priced walk-down with refund, floor-rung refund, noise-ratchet hold, climb recovery, fresh-GPU sized jump). Updated `resolution-scaler.spec.ts` (sized jumps moved to fresh-GPU windows), `resolution-scaler-gpu.spec.ts` (unknown timing probes one rung), `game-auto-scale.spec.ts` (hold contract at loop level; atFloor driven by a mock reporting fresh 40 ms GPU timestamps). Full core suite: **113 files / 1267 tests pass**; `pnpm typecheck` exit 0; `pnpm lint` exit 1 with 22 pre-existing errors all in `examples/`/`test-support` (was 23; the fix removed the only one in a touched file), none in changed files.
- [x] **AC-4 (native proof, this change):** existing scaler fixture **and** a new probe-policy bundle both pass on the real native runtime (`mystral run --no-sdl`, headless NVIDIA RTX 2080): `TN_SCALER_NATIVE_PASS` + `TN_SCALER_PROBE_NATIVE_PASS` (hold, no-ratchet, floor-refund, sized-jump).
- [x] **AC-5 (long soak, COMPLETE):** 640 s soak (`tools/capture-resolution-soak.mjs`, parent agent; `PROOF_PASS: 10+ min soak held full resolution with bounded reversible response`) on the patched 5391 server: wall t 1.1→635 s, sim 30.2→470.7 s (440.5 sim-seconds — ~7m20 s sampled simulation under CPU pressure across 10m40 s wall, not ten simulated minutes), 119 samples, phases baseline → pressure (CPU ×4, t 180–365 s) → recovery. Scale **min/max 1/1**, `scaleSource` always `auto`, buffer exactly 1280×720 (canvas math exact, 0 mismatches), cameras 0/1/2 all exercised, 6900 cumulative budget frames, budget fps 3.47 (pressure min) → recovery ~10–20, `pressureDrops/staleDrops/gpuDrops` all 0, **0 errors, 0 restarts, 0 HMR events**. Artifacts: `/tmp/midway-soak-proof/{samples,summary}.json`, `00-start.png`, `30-end.png`, `baseline-to-pressure.png`, `pressure-to-recovery.png`, log `/tmp/midway-soak-proof.log`.
- [x] **AC-6 (parent visual inspection, COMPLETE):** parent viewed soak `00-start.png` and `30-end.png`: no whole-canvas blur/pixelation (attestation `/tmp/midway-blur-parent-visual.txt`). Compare canvas sharpness, not aircraft framing — the wide-view final frame differs from the chase start.

## Gates (honest status — no waiver)

- Engine `pnpm typecheck`: exit 0. Full `packages/core` suite: 113 files / 1267 tests pass. Game `typecheck` + `vite build`: exit 0 in both checkouts. Native runtime: existing scaler fixture and new probe-policy bundle both PASS (`TN_SCALER_NATIVE_PASS`, `TN_SCALER_PROBE_NATIVE_PASS`).
- Engine-root `pnpm test` (run once post-soak, log `/tmp/midway-blur-engine-full-test.log`): **exit 1** — 7 failures, all unrelated baseline, none referencing this change: `scripts/` instruction-budget, quality-json, sync-agent-docs mirrors (3 files, 3 tests) and `create-threenative` scaffold byte-stability + template instruction contracts (2 files, 4 tests). Not repaired per scope; no invented waiver.
- Engine `pnpm lint`: **exit 1** — 22 errors, all pre-existing in `examples/`/`test-support`, none in changed files. Not marked satisfied.
- The original user-screenshot trigger remains **inferred**: no live baseline reproduced it (90 s observe held full resolution on fresh GPU timing). The deterministic unit regression (missing/stale GPU + host deficit → 1.0→0.52 single step, floor in five windows) proves the fallback bug the fix removes.
- Branch choices (user-directed): engine stays on `prd-382-flight-model` (no move to develop); sandbox stays on `midway/asset-battle-integration`; no new branches or worktrees — the `blur-repro` snapshot worktree was removed after audit (branch `midway/blur-scaler-fix` kept, zero unique commits).
- Stale-cache resolution: the main dev server (port 5173) was still serving a 14:34 prebundle of the old core after adoption — page reloads cannot refresh optimizeDeps output. It was restarted with the same flags plus `--force` (forced re-optimization confirmed in its log); HTTP-served `@threenative_core.js` now contains the probe/refund policy (`probeUnknown`, `probeBlind` present). No source, branch, or package-hash change involved: serving already-verified bytes.

## Verification (reproduce / validate)

```sh
cd /home/joao/projects/threenative/sandbox/midway-open-pacific
# patched isolated server (left running for the soak):
# http://127.0.0.1:5391 from .worktrees/blur-repro
MIDWAY_SHOTS=screenshots/blur-recur MIDWAY_URL=http://127.0.0.1:5391 \
  bash tools/capture-lock.sh node tools/capture-resolution.mjs
# engine focused regression:
cd /home/joao/projects/threenative/threenative-engine
pnpm exec vitest run packages/core/__tests__/resolution-scaler-unknown-gpu.spec.ts
```
