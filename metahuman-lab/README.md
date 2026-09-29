# MetaHuman Expression Lab

Drive a real MetaHuman head from sliders, in a browser, with no Unreal process and no streamed
viewport. The face is the specimen's own DNA rig, evaluated by OpenRigLogic through
[`@threenative/metahuman`](../../threenative-engine/packages/metahuman).

## Run it

```sh
pnpm install
pnpm specimen     # prepare the licensed specimen into content/  (run this first)
pnpm dev          # http://127.0.0.1:5173
```

`pnpm specimen` needs the two licensed source files, by default:

```
~/.cache/threenative/metahuman/ada-face/Models/Ada_FaceMesh.glb
~/.cache/threenative/metahuman/ada-face/dna/Ada_FaceMesh.dna
```

Pass them as arguments to use another pair: `node tools/prepare.mjs <glb> <dna>`. Without a
prepared `content/` the game still boots and says exactly which command to run.

Every other source path — the texture set, the hair, brows and shirt, and the groom `.strands.bin`
— is derived from the same base directory, `<home>/.cache/threenative/metahuman`, resolved from
`os.homedir()` rather than baked in. `METAHUMAN_SOURCE_DIR` overrides that base for a machine whose
sample lives somewhere else:

```sh
METAHUMAN_SOURCE_DIR=/mnt/fab/metahuman pnpm specimen
```

## The specimen is licensed and local

`content/` is gitignored. It holds Epic's Fab Standard License MetaHuman (`Ada_FaceMesh` LOD0) and
is never committed, never copied into a tracked path, and never redistributed. The prepared files
are:

| file | what it is |
| --- | --- |
| `specimen.glb` | the imported skinned head: 34,615 vertices, 9 primitives, 875 skin joints, 821 LOD0 morph targets |
| `head.dna` | the head DNA the same Unreal package carried, 4.8 MB, DNA 2.1 |
| `bindings.json` | the sidecar `loadMetaHuman` validates: joints, morphs, LODs, controls, coordinates, hashes, provenance |

The sidecar is derived **by construction** and never hand-edited — see the header of
`tools/prepare.mjs`. It prints what it measured and exits non-zero on any validation failure.

## What the game does

- 33 aliases resolved from the PRD's 20 semantic faceboard channels against the rig's real
  `RigEvaluator.names("gui")` — jaw, mouth close, lip pucker and funnel, smile, frown, inner and
  outer brow raise, brow lower, blink, squint, cheek raise, gaze, each left/right where the
  faceboard has a pair.
- Grouped sliders with numeric entry, per-group left/right linking, three pose recipes and a
  reset. The keyboard owns every row: arrows step, `Home` and `End` jump to the domain ends.
- Slider traffic is coalesced into one `human.setControls` per rendered frame.
- A diagnostics panel reporting the live backend, the pinned OpenRigLogic revision, the LOD and
  why it is pinned, the rig counts, and the cost of the last evaluation.

**Unreal shading and strand grooming are not reproduced.** Skin, eyes and lash cards are this
sample's own approximation; the motion is the specimen rig's.

## Proof

```sh
pnpm test      # tools/capture-lock.sh + threenative-playtest, headed WebGPU
```

`playtests/face-controls.playtest.json` waits for `ready`, drives the real jaw and left-blink
sliders through clicks and key presses, asserts the sampled joint and morph values moved and that
the right eyelid did not, and captures neutral, jaw-open, left-blink and smile+brow into
`artifacts/playtest/`. Its assertions are floors rather than exact values, because a key press can
land before the UI has re-published the previous value.

`threenative build` does **not** carry the gitignored `content/` directory. Use `pnpm dev`, or
`vite build && vite preview`, to run a built bundle.

## Layout

| path | what owns it |
| --- | --- |
| `src/scenes/Lab.ts` | the rig: one `ctx.beforeRender` that coalesces intents, drives the handle and publishes the probes |
| `src/render/stage.ts` | the head-and-shoulders camera framing and the three-point light rig |
| `src/render/materials.ts` | this sample's surfaces, replacing the import's guesses |
| `src/render/webgpuDevice.ts` | the one renderer setting: the morph-target array-layer limit |
| `src/ui/groups.ts` | how the declared aliases are grouped for the panel |
| `src/ui/ExpressionPanel.tsx` | the sliders, the number fields, the recipes |
| `tools/prepare.mjs` | specimen preparation and validation |
| `playtests/face-controls.playtest.json` | the whole proof |
