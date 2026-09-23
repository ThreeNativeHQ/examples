# AC-23: where the frame actually goes

Every figure here is one 60-second `tools/capture-performance.mjs` sample at 1920×1080 on the same
named `nvidia/turing` adapter, seed 19420604, `MIDWAY_CROWD=1` (the labelled `crowd68-fixture`, 68/68
active aircraft). `docs/perf/ac23-baseline-c13e184-crowd68.json` is the matched branch-point baseline,
captured from a worktree at `c13e184` served on its own port, with this repository's current
`tools/capture-performance.mjs` and `src/sim/perf.ts` copied in so both runs are measured by the same
instrument. Nothing else in that tree was changed.

## The regression is real and it is not where it looked

| | branch point `c13e184` | candidate |
|---|---|---|
| GPU p95 | **10.81 ms** | **17.76 ms** |
| GPU p50 | 10.53 ms | 7.97 ms |
| fixed-step CPU p95 | 1.50 ms | 1.10 ms |
| draw calls | 1,506 | 1,246 |

CPU is well inside AC-23's 4 ms. GPU p95 is over the 16.7 ms ceiling, so **AC-23 fails on `gpuP95`**
and that is an explicit performance gap, not something the relative clause can excuse.

## The distribution says what the mean cannot

The GPU series is bimodal and has no middle. A representative histogram, in whole milliseconds:

```
7:101   8:144   18:62
```

Two clusters — a median near 7.7 ms and a hard step near 17.8 ms on about a fifth of frames — with
nothing in between. p99 17.83 and worst 17.86 against that p95 of 17.80: the tail is not a spike, it
is a second mode. Reading only p95 hides this completely, and reading only p50 says the frame is fine.

## What it is not

Each of these was removed or narrowed on its own, everything else held:

| change | draw calls | GPU p50 | GPU p95 |
|---|---|---|---|
| baseline candidate | 2,905 | — | 17.82 ms |
| far-LOD carriers merged (`7fe74f2`) | 1,965 | 7.77 ms | 17.80 ms |
| reflection target 0.5 → 0.25 | 1,959 | 7.66 ms | 17.58 ms |
| shadow maps off | — | 6.67 ms | 14.38 ms |
| aircraft out of the reflection (`ba7a8fd`) | 1,246 | 7.97 ms | 17.76 ms |
| ocean wake loop off (20 hulls → 0) | — | 5.86 ms | 17.81 ms |
| ocean foam noise off (4 × noise + worley) | — | 6.56 ms | 17.89 ms |
| both ocean terms off | — | 5.60 ms | 17.72 ms |
| **ocean mesh hidden** | 1,044 | **4.43 ms** | **4.66 ms** |

Every row moves the median. Only the last row moves p95, and it collapses the two modes into one
tight cluster. So the second mode is the ocean surface, and it is not the wake loop, not the foam
noise, not the shadow pass, not the reflection's pixels and not its draw calls.

## What it is

The ocean is fill-bound, and the two modes are how much screen the sea covers as the camera pitches.
The same shape appears at 1280×720 scaled by the pixel count (p50 4.46 ms, p95 8.99 ms), which is what
a fill cost does and what a periodic CPU stall does not. With both expensive fragment terms removed
the median falls to 5.60 ms and p95 does not move at all, so the remaining per-pixel work — the
viewport reads for reflection, refraction and thickness, the two prefiltered sky samples, the two
normal-map fetches and the analytic swell normal — is already enough to double a sea-filled frame.

## One correction

`7fe74f2` reported "GPU p50 13.75 ms → 7.77 ms". Those are different workloads: 13.75 ms was the
natural battle at 22 aircraft, 7.77 ms the crowd68 fixture. Same-fixture, that commit's evidence is
draw calls 2,905 → 1,965 and p95 17.82 → 17.80 ms. The mesh merge stands on its own; that p50
comparison does not.

## What closed the absolute target

The viewport reads were the right suspects. Four range gates in the ocean fragment, each bought with
the arithmetic that makes it invisible rather than with a tolerance:

- the two normal-map octaves reach the normal only through `detail`, so below `detail` 0.02 they
  shift it by at most ~0.01 — two texture fetches for something no pixel can show;
- past 8 km the sea reflects the same sky it dissolves into, so one prefiltered sky lookup serves
  both the mirror and the haze term and the half-res mirror read stops being taken;
- past that range the seabed is further behind every fragment than the 14 m thickness clamp, so the
  depth read is dead weight and thickness is its maximum by construction;
- refraction is multiplied by a transmission that is zero in water deeper than 4 m, so over the open
  sea the read was taken and then multiplied away.

Three dead locals went with them — `reflection`, `facing` and `scatter` were declared and never
referenced, so TSL never compiled them into the shader at all.

Measured on the same fixture, adapter and seed:

| | before | after |
|---|---|---|
| GPU p95 | 17.76 ms | **13.79 / 14.30 ms** over two runs |
| GPU p50 | 7.97 ms | 12.33 / 12.49 ms |
| worst | 17.94 ms | 14.58 ms |
| distribution | bimodal, `7:101 8:144 18:62` | one cluster |
| fixed-step CPU p95 | 1.10 ms | 1.30 ms |

**The absolute target is met**: GPU p95 under 16.7 ms and CPU p95 under 4 ms, at 68/68 active
aircraft. The two modes are gone — what used to be a fifth of frames paying double is now one tight
cluster, and the p50 rose because the cheap frames were cheap only for being sea-light. Total work
per frame is more even; the worst case, which is what the criterion gates on, fell by 3.5 ms.

Near water is unchanged and was checked by eye: hull reflections, wake and ripple detail are the same
in the close captures. Far water is flatter, which is the change.

## What is still not met

The relative clause. Against the branch-point baseline the harness reports:

    gpuP95 regressed 27.5% against matched baseline: 13.773984ms vs 10.807264ms (limit 10%)

That is honest and expected: the baseline at `c13e184` did not draw the eleven imported hulls, the
cruiser scouts, or anything else this PRD adds. The workload fields match — same adapter, resolution,
seed, population envelope — but the *content* grew, and the criterion asks for both halves. So AC-23
is not met: the absolute target passes and the ≤10% comparison does not.

## The node-level CPU gate after the flight-step fixes (2026-09-19)

AC-23's fixed-step half is measured twice here: in the browser capture above (1.30 ms p95 at the
crowd68 fixture), and in `scripts/check-ai-flight-cost.mjs`, which grows a real battle to the
68-aircraft ceiling through `Battle.launch` and times `Battle.step` itself. The node gate was the
one failing, at **4.293 ms p95** against the 4 ms ceiling, with the marginal cost per aircraft
rising from 17.6 to 30.9 µs between ten and sixty-eight aircraft.

That cost was the engine's: `flightForces` built its 18-field result with an object spread, which
V8 cannot create from a boilerplate, and `FlightModel.stepDeck` spread the whole environment on
every call (`@threenative/core` `b04b9d3a1`, `302780021`). Written out and stepped from one record
per model, the same gate reads:

| population | mean before | mean after | p95 before | p95 after |
| --- | --- | --- | --- | --- |
| 1 | 0.217 ms | 0.154 ms | 0.313 ms | 0.224 ms |
| 10 | 0.375 ms | 0.183 ms | 0.582 ms | 0.274 ms |
| 68 (cap) | 2.154 ms | 0.694 ms | 4.293 ms | 1.156 ms |

Marginal cost at the top of the range falls 30.9 → 8.7 µs per aircraft per step, and the gate
PASSes with a 3.5x margin. The engine's `finalStateSha256` is bit-identical across both fixes, so
nothing about the flight model's behaviour changed. The engine half of the step is now 2.5–3 µs per
aircraft per step; the 8.7 µs at the top of the range is game-side AI, gunnery and weapon work —
see `FRICTION.md`, 2026-09-19.

## Re-measured on 2026-09-19: the absolute GPU target fails again, and it is the sea

One approved 60-second sample, `MIDWAY_CROWD=1` (68/68 active), 1920×1080, pixelRatio 1, the same
`nvidia/turing` adapter and the same instrument:

| | recorded after the range gates | re-measured 2026-09-19 |
| --- | --- | --- |
| GPU p50 | 12.33 / 12.49 ms | 7.98 ms |
| GPU p95 | 13.79 / 14.30 ms | **17.00 ms** |
| GPU p99 / worst | 14.58 ms | 18.19 / 18.68 ms |
| fixed-step CPU p95 | 1.30 ms | 1.40 ms |
| distribution | one cluster | two modes again: a 8 ms mode and a 17 ms mode |

So the two modes came back and the absolute target (`gpuP95 < 16.7 ms`) is **not met** on this tree.
The fixed-step half is comfortable — 1.40 ms against the 4 ms ceiling, *after* the flight-step fixes
in `FRICTION.md` (2026-09-19), which took it from 4.293 ms.

Layer ablation, 15-second attribution runs on the same fixture and adapter, one layer hidden each
(these are non-qualifying by construction — they are what `MIDWAY_HIDE` exists for):

| hidden | GPU p50 | GPU p95 |
| --- | --- | --- |
| nothing (the 60 s run above) | 7.98 ms | 17.00 ms |
| sea | 7.62 ms | **9.17 ms** |
| ships | 7.48 ms | 14.42 ms |
| sky | 8.05 ms | 15.79 ms |
| crew | 7.90 ms | 16.89 ms |

Hiding the sea collapses the p95 and barely moves the p50 — the same signature the earlier section
found and the same conclusion: the second mode is the ocean surface's fill cost, and the four range
gates that flattened it are no longer doing so on this tree. Ships and sky each carry a slice of the
tail; deck crew carries none. (Ablation runs sample 15 s, not the approved 60, so read the rows
against each other and not against the 60-second line.)

One thing this is **not**: the engine's adaptive resolution scaler is not asleep. It holds scale 1
here because this sample's cheap mode is ~8 ms, and its declared signal is the mean presented frame
rate rather than a GPU tail — a bimodal distribution with a healthy mean is invisible to it by
design (`packages/core/src/resolution-scaler.ts`, `RESOLUTION_SCALER.targetFpsFraction`). The gate
that fails is AC-23's p95, and the scaler has never claimed to gate on that.

Next step belongs to the ocean material, not the framework: attribute the 8 ms sea mode the way the
earlier section did (wake loop, foam noise, viewport reads, sky samples) and re-check the range
gates against the swell-softening change in `4404e62`.

## A contended re-measurement, recorded so it is not compared (2026-09-19)

The in-game numbers were re-taken after the launch-flow work to confirm nothing moved. They cannot be
compared with anything above, and the reason is in the same record: the machine was at load average
**32** from other work (two headless Chromium shells at 356 % and 273 % CPU, three node servers), and
the tell is the CPU series, which needs no GPU to be wrong:

| | quiet machine (recorded above) | this run (load 32) |
| --- | ---: | ---: |
| fixed-step CPU p95 | 1.40 ms | **7.28 ms** |
| `renderCpu` p50 | 1.70 ms | **6.95 ms** |
| `updateRenderCpu` p50 | 10.00 ms | **38.80 ms** |
| GPU p50 / p95 | 7.98 / 17.00 ms | 8.31 / 18.14 ms |

The fixed-step number is the honest one: it is pure JavaScript on a contended CPU, so a 5.2× rise
there says the rest of the row is contention and not a change. **No in-game conclusion is drawn from
this run**; the sea's p95 mode stands as recorded, and the next pass needs the machine to itself.

## The ceiling is marginal, and the machine decides (2026-09-19)

A later run on the same tree, with the machine at load average 16 rather than 32, reads:

| | quiet machine | load 32 | **load 16** |
| --- | ---: | ---: | ---: |
| GPU p50 | 7.98 ms | 8.31 ms | **7.80 ms** |
| GPU p95 | 17.00 ms | 18.14 ms | **16.42 ms — ok** |
| GPU p99 / worst | 18.19 / 18.68 ms | 18.20 / 18.20 ms | 19.48 / 19.76 ms |
| fixed-step CPU p95 | 1.40 ms | 7.28 ms | 1.80 ms |
| `renderCpu` p50 / worst | 1.70 / 9.40 ms | 6.95 / 27.40 ms | 3.40 / **197.90 ms** |

So the absolute gate is **marginal rather than clearly failed**: 16.42 ms passes, 17.00–18.14 ms fails,
and what moves between them is the machine, not the game — the fixed-step series (pure JavaScript)
tracks the load exactly, and the GPU series follows it because a contended main thread queues frames
into the GPU. The p99 (19.48) and the worst (19.76) are over the ceiling on every run including this
one, so the tail is real and the sea's fill owns it; the *median* has ~8.9 ms of headroom.

**What this changes:** the case for rewriting the ocean is weaker than a single 17.00 ms reading
suggested. Before any material change, this gate needs a run on a machine with nothing else on it —
recorded here so the next reader does not mistake a contended run for the game's number.
