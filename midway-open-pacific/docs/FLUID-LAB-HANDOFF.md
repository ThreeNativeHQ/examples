# Fluid Lab follow-up — start here

**Status: implemented prototype in an isolated worktree; NOT integrated into the main game or fully finished.**
**Next action:** open the worktree below and run `node scripts/check-fluid.mjs`.

## Locations

- Main game: `/home/joao/projects/threenative/sandbox/midway-open-pacific`
- Working implementation: `/home/joao/projects/threenative/sandbox/.worktrees/fluid-lab/midway-open-pacific`
- Branch: `codex/fluid-lab`; initial base: `aed86e0c313b64a5538389f17a6fcb53b53c85ef`
- User reference: `/home/joao/Downloads/Midway-Fluid-Lab-V2.html`
- Screenshots: `/home/joao/projects/threenative/sandbox/midway-open-pacific/screenshots/fluid-lab/`

The worktree is approximately 1.8 GB. It contains an initial snapshot of other agents' uncommitted changes: **do not merge/copy/commit its whole tree**. The main checkout has continued changing. Integrate only this task's changes, preserving newer work. `/tmp/midway-fluid-original.json` contains original contents of the principal edited files, but is a temporary aid, not a guaranteed exact base for every copied file.

## User requirements and decisions

1. Absorb the whole reference: ocean appearance, reflections, fluid motion, particles, foam, bubbles and blast coupling—not just explosion sprites.
2. Add visible ship response to impacts: recoil, rocking and settling.
3. Work in the game first. Reuse the installed engine capabilities; defer new engine work until the game result is confirmed.
4. After verification, ask **DeepSeek 4.1 Flash through OpenCode** to refactor. The user explicitly requested this model.
5. The other AI editing the ocean was confirmed stopped. Other unrelated game work must still be preserved.

## What is implemented

| Files in working implementation | Change |
|---|---|
| `src/render/ocean.ts` | Reference swell spectrum; CPU and TSL height from one WaveField; procedural multiscale normal map; actual ship/sky reflections through WaterSurface3D; shallow refraction; impact gradients in lighting; transported foam with cellular pores. |
| `src/render/ripples.ts` | Installed RippleField, 192² over 640 m; half-float height/foam/flow texture with matching cell centres; shared surface for rendering/collisions; battle effect routing; local patch persistence. |
| `src/render/whitewater.ts`, `src/render/water-effects.ts` | Ported spray/mist/bubble/foam dynamics, surface crossings returning momentum, bubble-to-foam transitions, 12,000 bounded slots, eight blast events, TSL instanced particles, torn water curtains, damped gas cavities and visual acoustic shells. |
| `src/render/ship-motion.ts`, `src/render/world.ts` | Wave sampling and impact-record-driven hull recoil/roll/pitch, integrated into rendered ship transforms. Existing navigation is retained. Crew/deck-parented aircraft inherit the hull transform. |
| `src/sim/battle.ts`, `src/render/particles.ts`, `src/scenes/Midway.ts` | Real torpedo damage emits a typed submerged water blast outside the hull; near misses stop creating duplicate fire explosions; obsolete independent water-column sprites deleted; new resources disposed on scene exit. |

Also added/changed: `scripts/check-fluid.mjs`, `tools/capture-fluid-lab.mjs`, `tools/probe-ocean.mjs`, `docs/fluid-lab-LICENSE.txt`. Preserve MIT attribution.

Existing PRD: `docs/PRDs/PRD-midway-fluid-lab.md` in the MAIN game. Update it with final evidence; do not create additional verification reports.

## Verified evidence

1. `node scripts/check-fluid.mjs` passed: one swept droplet crossing injects wave energy exactly once; foam rides the same surface; bubbles pop into foam; full pools reject without replacing live particles; real torpedo damage produces a water event; opposite-side hits reverse hull roll; smaller hulls react more; rocking decays.
2. `pnpm typecheck` passed after the last ocean shader argument correction. Log: `/tmp/midway-fluid-types.log`.
3. `pnpm exec vite build` passed before the final cellular-foam/underwater shader edits. **Run the build again on final code.** Log: `/tmp/midway-fluid-build.log`.
4. `tools/capture-fluid-lab.mjs` passed on **NVIDIA Turing WebGPU**, with no console/page errors. At 1.1 s: 2,611 spray parcels. At 6.7 s: 2,278 water hits, 630.605 return impulse, 2,242 foam parcels. Actual bomb `updateWeapons` routing, deep-effect delay/attenuation, pause and reset also passed. Log: `/tmp/midway-fluid-capture.log`.
5. `node tools/probe-ocean.mjs` passed: actual source measured −0.646..0.645 m, significant wave height **1.14 m**. This probe now imports the actual ocean owner instead of duplicating obsolete constants.

Inspected screenshots: `reference-plume.png`, `reference-foam.png`, `before-calm.png`, `calm.png`, `torpedo-plume.png`, `torpedo-foam.png`, `aerial-foam.png`, `underwater.png`. Further captures include `bomb-plume.png` and `deep-heave.png`.

The early `after-calm.png` was initially captured from the wrong server, then replaced. Prefer the named `calm`/`torpedo` sequence from the dedicated gate. Port **5371 belongs to the main checkout**, not this worktree. Do not mistake it for the candidate.

## Remaining work — do in this order

1. **Review the known gaps below.** Keep the useful implementation; do not restart or rebuild the engine. Finish the visible/behavioral issues required by the user's whole-reference request.
2. **Run final checks and inspect fresh captures.** Add real launch/playability verification and measure performance with active impacts. Neither full gameplay regression coverage nor a performance budget has been proved. Desktop/Android/iOS are unverified.
3. **Run the requested DeepSeek refactor.** The prior command failed at argument parsing; no DeepSeek refactor occurred. Correct command below. Keep appearance in game source; evaluate engine extraction only against the charter.
4. **Integrate exact task changes into the main checkout.** Compare current files; preserve all unrelated changes. Re-run focused checks after integration. Do not claim the main game is updated until it actually is.
5. **Finish delivery and worktree lifecycle.** Update the existing PRD, show the user a representative capture, and retire the exact checkout only after integration, owner/process inactivity and data audit. Cleanup requires the applicable user authorization. Do not discard the uncommitted implementation.

## Known gaps / review targets

- **Underwater presentation is incomplete.** `underwater.png` shows the above-water sky behind the submerged hull and an overly flat tinted underside of the ocean. It needs coherent underwater fog/background; a passing no-error capture does not make this finished.
- **Ship motion is a rendered response.** Recoil offsets do not impart momentum to Battle navigation/collision coordinates. Current transform also applies the existing `s.list` immediately. Check damage-list transitions and deck/recovery behavior; do not call this a full rigid-body ship simulation.
- **Deep blasts are supported by effect records, not an existing complete ASW gameplay loop.** The deep capture injects `Battle.fx` with `waterKind:'deep'` and `waterDepth:35`. `stepCharge`/`chargeDamage` exist in `src/sim/submarine.ts`, but were not wired into Battle's live charge deployment. Do not claim automatically deployed depth charges were verified.
- **Reference parity is partial in a few mechanics.** No crest-generated spray yet (`crestSpawns` remains zero), no complete acoustic-pressure sampler/surface-front coupling, and no moving solid boundary in the wave solver. The installed RippleField deliberately has no hull mask. Particle hull collisions use a moving footprint approximation; do not duplicate the wave solver just to add the reference's static carrier mask.
- **Capture and performance limitations.** The harness manually advances `Battle.updateWeapons` and `WorldView.update` with a fixed camera. It currently assigns the invalid status string `'flying'`; change that fixture to `'playing'` and retain `scene.paused=true` for controlled stepping. It is not an input-driven full gameplay proof. One finite 640 m patch and an 1,800 m admission cutoff also need checking during fly-bys/overlapping distant impacts. The port is intentionally still dense and has per-frame allocation that DeepSeek can simplify.

## Commands

Run commands from the WORKING IMPLEMENTATION game directory:

```sh
cd /home/joao/projects/threenative/sandbox/.worktrees/fluid-lab/midway-open-pacific
node scripts/check-fluid.mjs
node tools/probe-ocean.mjs
pnpm typecheck
pnpm exec vite build
```

A dev server was still listening at `http://127.0.0.1:5386/` when this handoff was written. Verify its cwd before reuse. If absent:

```sh
pnpm exec vite --host 127.0.0.1 --port 5386 --strictPort
```

Capture (never launch a visible desktop browser or call `xvfb-run`):

```sh
MIDWAY_URL=http://127.0.0.1:5386 \
MIDWAY_SHOTS=/home/joao/projects/threenative/sandbox/midway-open-pacific/screenshots/fluid-lab \
bash tools/capture-lock.sh node tools/capture-fluid-lab.mjs
```

The worktree's `.packages` is a symlink to the primary repository's immutable staged tarballs. Initial `pnpm install --frozen-lockfile --offline` failed because that path was absent; it succeeded after creating the symlink. Dependencies are installed. Do not repeat that diagnosis or change package versions unnecessarily.

## DeepSeek handoff

OpenCode is installed at `/home/joao/.opencode/bin/opencode`. `opencode models` confirmed **`opencode-go/deepseek-v4.1-flash`** exists.

Prepared bounded refactor instructions: `/tmp/midway-fluid-refactor-prompt.txt`. They assign ownership of only `whitewater.ts`, `water-effects.ts`, `ripples.ts`, `ship-motion.ts`, preserve tuning and behavior, request readable TypeScript and removal of allocation/clutter, and prohibit engine changes/unrelated edits.

The earlier invocation failed because `--file` consumes following positional arguments as file paths. Put the message BEFORE `--file`:

```sh
env -u NO_COLOR opencode run \
  --model opencode-go/deepseek-v4.1-flash --format json --auto \
  'Perform the bounded refactor described in the attached file. Preserve verified behavior and file ownership.' \
  --file /tmp/midway-fluid-refactor-prompt.txt \
  > /tmp/midway-deepseek-refactor.jsonl 2> /tmp/midway-deepseek-refactor.err
```

If the temporary prompt no longer exists, reconstruct it from the ownership and constraints above. Supervise the model; review its diff and rerun checks. Do not allow an automated refactor to erase appearance or broaden into an engine rewrite.
