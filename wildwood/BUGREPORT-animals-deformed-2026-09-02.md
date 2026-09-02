# Wildwood animals render deformed — handoff

**Status: NOT fixed. Root cause NOT isolated.** Three neighbouring bugs *were* fixed (below); the
deformation itself survives all of them. Read the "Dead ends" section before forming a theory — two
plausible ones are already disproven, one of them by me, publicly and wrongly, so don't rebuild on
my earlier notes.

## Symptom

Animals render with their skeletons folded: spine bent double, head pointing backwards or buried in
the ground, hindquarters displaced from the forelegs. Reported by the user on the stag first, then
the doe. Sizes and positions are correct; the *pose* is wrong.

The failure is silent: zero console errors, zero page errors.

Reproduce:
```sh
cd /home/joao/projects/threenative/sandbox/wildwood
# dev server on 5173 is usually already up; if not:  npx vite --host 127.0.0.1
# then open, HEADED (headless Chromium cannot capture WebGPU on this machine):
#   http://127.0.0.1:5173/dev-animals.html?state=walk&threat=0
#   http://127.0.0.1:5173/            (the game itself)
```

## What is established, with evidence

**The clips are healthy.**
- Animation accessors are byte-identical between the source GLB (`assets/fab/…`) and the baked
  output (`public/fab/…`): same component types, same frame counts, same frame-0 values.
- All 803 rotation-track quaternions on `ANIM_DeerStag_Walk` are unit length (`|q| − 1 < 0.01`).

**The bindings are correct.** After the clip-name fix below, `Animal.audit()` reports **30/30 tracks
bound, 0 MISSING** across all six animals. No track is silently binding nothing.

**The rig is healthy.** An animal with *no* clip bound stands correctly shaped — that is exactly why
the doe looked fine for a while (it was bound to 0 of 10 clips and frozen in bind pose).

**Therefore:** healthy clip + healthy rig + correct binding → deformed pose. The defect is in how
the pose is **applied**, not in the data.

**Structure of the assets** (`public/fab/2dd7964c-a601-4264-a53d-465dcae1644c/ue/Models/SK_*.glb`):
- One node `SK_Root` carrying a skin and a mesh of **2 primitives** (body + fur, identical vertex
  and triangle counts, different material).
- 31 joints for the deer, 34 fox, up to 70-odd bones counted through three.
- Bone hierarchy: `root` → `<PREFIX>_` (e.g. `STAG_`, `DeerDoe_`, `Fox_`) → `…-Pelvis` → `…-Spine` → …
- Positions are `KHR_mesh_quantization` normalized int16; geometry is `EXT_meshopt_compression`.

## Dead ends — do NOT re-investigate these

**D1. "The root bone is mirrored in Z between bind pose and clips." WRONG. This was my theory.**
The measurement is real:
```
T STAG_  bind  = [0.000,  0.999, -0.504]         clip0 = [0.000,  0.999, +0.504]
R STAG_  bind  = [-0.497, 0.503,  0.497, -0.503] clip0 = [0.502, -0.498, 0.502, -0.498]
```
but the interpretation is not. `(x,y,z,w) → (−x,−y,z,w)` is conjugation by a 180° yaw about Z — a
plain rotation, not a reflection — and clip frame 0 is under no obligation to equal the bind pose.
I implemented the exact correction (negate Z on the root's position tracks, negate x and y on its
quaternion tracks) across all 218 root tracks on all six rigs. **The render was unchanged.** Reverted.

**D2. `stripJunkTriangles` (`Animal.ts`, near the bottom) corrupts the mesh. WRONG.**
Disabled it entirely; deformation unchanged.

**D3. The asset bake corrupts the animals. WRONG.**
Animation data and geometry are byte-identical source-vs-bake. (Separately, the pipeline's own
`assertNoDrift` in `packages/assets/src/passes/model.ts` already self-verifies triangles, vertices,
joints, clips and world-space bounds — it is honest and it passes.)

**D4. The quantized-POSITION clamp that broke the trees. UNRELATED to animals.**
That was a real engine bug and is fixed (`packages/core/src/assets.ts::widenQuantizedPositions`,
commit `0495d86b`), but widening positions to float preserves the same numbers, so it cannot and
does not change any pose.

## Fixed along the way (all committed, all verified)

1. **Sizing** — `Animal.ts` hand-rolled `percentileSpan()` = `matrixWorld × POSITION`. Right for a
   rigid mesh, wrong for a skinned rig, where a vertex renders at
   `Σ w·(bone.matrixWorld · boneInverse)·position`. Every animal measured ~1.96 (the quantisation
   cube) against a fox skeleton spanning 0.33 → fox rendered at a third size, an ant; crow measured
   1.06 and rendered 0.07. Replaced with `normaliseToMetres()` from `@threenative/core`, which
   measures through `Box3.setFromObject` and *is* skin-aware. Fox 0.535 → 0.981, crow 0.531 → 0.483.
   Commit `cf15e9e`.
2. **Doe and wolf bound to another animal's clips** — `DOE_CLIPS` spread `STAG_CLIPS`, `WOLF_CLIPS`
   spread `FOX_CLIPS`, keeping the wrong prefix. `SK_DeerDoe.glb` has no `ANIM_DeerStag_*`. Doe
   bound **0/10**, wolf **1/10**; both frozen in bind pose. Fixed in `animalSpecs.ts`. Commit `056e2f3`.
3. **`Animal.audit()` existed and nothing called it** — it reports exactly bug 2, per clip. Now
   printed as `TN_ANIMALS_AUDIT` on every harness run. Commit `056e2f3`.
4. **Harness ground** — `dev-animals.html` drew a flat plane at `y = 0` but placed the roster with
   `ground: heightAt`, floating everything ~5 m up. Commit `cf15e9e`.

## Why my visual verdicts were unreliable — fix this FIRST

I twice called a capture green that the user could immediately see was deformed. The harness makes
that almost unavoidable:

- `src/dev/animals.ts:73` puts the camera at `(0, 2.4, 11)` looking at `(0, 0.8, 0)`.
- `PRODUCTION_PLACEMENTS` (`src/dev/animals.ts:40-47`) spawns animals at x = 28, 54, −6, 20, 14.
- They then roam another 30–55 m (the HUD prints `roam`).

So every animal is a few dozen pixels at the edge of frame. **No screenshot taken this way is
evidence.** Before debugging anything, add to the harness:

- `?only=<id>` — spawn exactly one animal
- `?roam=0` — pin it in place
- a camera framed on that animal (`normaliseToMetres` already gives you its metre size)

Then **validate the new view against the existing negative control**: `src/dev/animals.ts:125`
already supports `?corruptAnimalForward=fox`, which deliberately yaws the fox rig. Confirm your new
view can *see* that corruption before you trust any green from it.

## Recommended debug path

**Step 1 — stop using screenshots. Use the numbers the engine already has.**
`@threenative/core` exports `clipPoseError`, `clipBoneCoverage`, `clipTrackBindings` and
`boneContact` for exactly this (PRD-314, "a broken retarget is a number, not a screenshot"; see
`docs/PRDs/authoring/PRD-314-*.md` in the engine repo). Score every clip on every rig, rank by
error, and let it name the bone and the frame. That converges; squinting does not.

**Step 2 — bisect the pose pipeline.** In order, each is a one-line experiment in `Animal.ts`:
  a. Play the clip on the **original** `model.scene`, not the `SkeletonUtils.clone()`. If the
     original poses correctly and the clone does not, the bug is in the clone — most likely the
     two-primitive mesh (`SK_Root` has 2 SkinnedMesh children sharing one skeleton) not being
     re-bound correctly by `SkeletonUtils.clone`. **This is the strongest untested hypothesis.**
  b. Play with only ONE of the two primitives in the scene. If body-only is correct and fur-only is
     not (or vice versa), it is a per-primitive bind problem.
  c. Bypass `AnimationPlayer` and drive a raw `THREE.AnimationMixer` on the clone. If raw is
     correct, the bug is in `packages/core/src/animation.ts` — check `strideRoot`
     (`Animal.ts:127` passes `this.object`, the parent Group, while `root` is the clone;
     `animation.ts:209` calls `getWorldPosition` on it).
  d. Set the mixer to `clip.duration * 0` and step frame by frame. If frame 0 is already deformed,
     it is a bind/binding problem; if it degrades over time, it is accumulation in the stride logic.

**Step 3 — only then decide the layer.** Engine (`packages/core/src/animation.ts`), importer
(the external `threenative-asset-mcp` 0.7.0 snapshot at `sandbox/.mcp-tools`, installed from
`/tmp/skeletal-pack/threenative-asset-mcp-0.7.0.tgz` — note it is NOT in the engine repo, so an
importer fix also needs a re-import), or game (`Animal.ts`).

## Key files

| What | Where |
| --- | --- |
| Animal entity, clone/bind/scale/pose | `src/entities/animals/Animal.ts` (ctor ~line 78-130) |
| Clip names and per-species sizes | `src/entities/animals/animalSpecs.ts` |
| Spawner | `src/entities/animals/spawnWildwoodAnimals.ts` |
| Dev harness | `src/dev/animals.ts`, `dev-animals.html` |
| Engine animation player | `packages/core/src/animation.ts` (engine repo) |
| Pose/retarget measurement | `clipPoseError`, `boneContact` in `@threenative/core` |

## Ground rules for whoever picks this up

- Headed Chromium only; headless cannot capture WebGPU here.
- Never claim a gate you did not run; paste the output.
- Do not trust a "looks fine" on a wide shot. Frame one animal or use a number.
- Two of my confident diagnoses were wrong. Prefer an experiment that can come out either way over
  a theory that explains the screenshot.
