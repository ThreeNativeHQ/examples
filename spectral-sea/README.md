# Spectral Sea

Steer the raft to the beacon and wait for a swell to lift you through the ring. **Arrow keys** steer;
there is no jump, no throttle and no way to climb — only the sea can raise you.

```sh
pnpm dev
```

## Features this validates

| Mined feature | PRD | What the game asks of it | State the proof reads |
| --- | --- | --- | --- |
| `SpectralOcean` — the cascaded spectrum and its inverse transform | 246 | The sea itself. Two cascades, a Phillips spectrum and an FFT per frame; the drawn surface reads the same displacement buffers the height query is copied from | `oceanSteps` |
| `SpectralOcean.sampleHeight()` | 246 | **The win condition.** The gate sits at 0.55 m and the raft has no way to reach it except by being lifted. The height exists only as texels the GPU wrote | `gateCrest`, `gateRange`, `gatesCleared`, `outcome` |
| `GPUReadback` — throttled, staleness-reporting | 246 | The copy that gets those texels to the CPU without stalling the frame, every third step | `heightSamples`, `staleFrames` |
| `ctx.add()` keeping the node's type | — | `const ocean = ctx.add(new SpectralOcean(...))` then `ocean.sampleHeight(...)` on the next line | compiles, or does not |

The ocean **creates no mesh, no material and no colour** — that is its contract. So the water plane,
its tessellation, the deep/shallow/foam ramp, the wind speed, the wave height and both patch sizes
all live in `src/render/ocean.ts`, and every one of them can change without touching an installed
file. Delete the ocean and there is nothing to draw and no number to ride.

## What the proof caught

Four engine defects, none of which any unit test could see.

**The sea was 5 cm tall.** The obvious fix — raise `amplitude` — would have buried the real cause:
the unpack pass divided the transform by N². The wave synthesis is the unnormalised sum
`h(x) = Σ h̃(k,t)·e^{ik·x}`, so dividing by the transform's length made `resolution` a wave-height
knob. A game doubling its grid for finer detail would have got a sea four times flatter, and the
symptom reads as "the amplitude needs tuning" rather than as a bug.

**The sea froze while every assertion passed.** The scenario pumped 1,220 fixed-step ticks while the
browser rendered 127 frames, and the ocean was render-cadence — copied from the particle system,
where it is right. It dispatched four times in 1,101 ticks:

```
frames      268 -> 1369
oceanSteps  123 ->  127      layerOpaque 0   oceanReleased 0   adapter nvidia/turing
```

The field was frozen and the raft was being steered across it, so its sampled height kept changing
and `crestPeak` kept climbing. **A number that moves is not proof that the thing producing it is
running.** The cadence now defaults to the game's fixed step.

**`ctx.add()` erased the node's type**, so `ctx.add(new SpectralOcean(...)).sampleHeight(...)` did not
compile and every typed node in every scene needed a cast back to what it already was.

**The charter's own guard could not see `src/ocean/`.** It globbed `src/*.ts` flat, so five files —
both ocean files and all three atmosphere files — sat outside the rule that keeps appearance out of
core. A material declared in any of them would have shipped unchallenged.

Two measurement bugs were mine, and the harness was right about both. `heightSamples` counted
`staleFrames === 0`, which can never happen: the copy resolves between frames, so the frame counter
has already moved on. And the open-sea `crestPeak`/`heightRange` were fully developed at warmup, so
asserting on them proved the sea existed and nothing more — `gateCrest` and `gateRange` are measured
only inside the beacon ring and read exactly zero until the player has steered there.

## Running the proof

```sh
./tools/capture-lock.sh pnpm exec threenative-playtest \
  --scenario playtests/ride-the-crest.playtest.json \
  --browser-recipe webgpu --headed \
  --server-command "pnpm dev --host 127.0.0.1 --port \$PORT --strictPort"
```

Green, exit 0, on `nvidia / turing`:

```
oceanSteps      287 -> 1388        heightSamples   40 -> 58
gateCrest         0 -> 1.392       gateRange        0 -> 2.152
staleFrames       9 -> 78          gatesCleared     0 -> 2      outcome playing -> won
```

Red controls, each reverted:

| Mutation | Result | Exit |
| --- | --- | --- |
| never `ctx.add` the ocean | `oceanSteps` 0, `heightSamples` 0, `gateCrest` 0, outcome never leaves `playing` | 1 |
| `sampleHeight` returns a constant | the sea still simulates and still draws — `oceanSteps` passes — and the game is unwinnable: `gateCrest` 0, `gateRange` 0, outcome `playing` | 1 |

The second one is the point. The ocean is not decoration here: with its height replaced by a
constant, every frame still looks correct and the game cannot be won.

## Known limits

`staleFrames` reaches 78 under a tick-driven scenario, because the playtest pumps fixed steps faster
than an async readback can land. In a game running at its own clock the two match. The contract is
that the number is *reported*, not that it is small — a caller that ignores it floats a hull on water
that is not the water being drawn.
