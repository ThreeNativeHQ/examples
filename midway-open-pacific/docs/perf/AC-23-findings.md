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
