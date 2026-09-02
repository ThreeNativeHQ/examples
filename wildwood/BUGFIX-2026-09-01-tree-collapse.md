# Root cause: quantized positions clamped by `applyMatrix4` — fixed in the engine

## The smoking gun

`packages/assets` ships models with `KHR_mesh_quantization`: `POSITION` is **normalized int16**,
so every component encodes a value in `[-1, 1]`, and the real metre-scale lives in the glTF
**node transform**.

`foliage.ts::extractTreeSpecies` did the ordinary three.js thing:

```ts
const geometry = object.geometry.clone().applyMatrix4(object.matrixWorld);
```

`BufferGeometry.applyMatrix4` → `BufferAttribute.applyMatrix4`:
- reads each vertex through `fromBufferAttribute` (**de**normalizes to metres),
- transforms it by the node matrix,
- writes it back through `setXYZ`, which **re**normalizes — and `normalize()` **clamps to ±1**.

So every vertex further than 1 unit from the origin after the node transform lands on the face of
the unit cube. Measured on the actual served `SM_pine01.b08b19be.glb`:

```
prim verts=3949 nodeScale=5.017 nodeT=[0.26,4.91,0.08] verticesOutside[-1,1]=3534 (89.5%) maxAbsWorld=8.925
prim verts=6491 nodeScale=5.017 nodeT=[0.26,4.91,0.08] verticesOutside[-1,1]=6474 (99.7%) maxAbsWorld=9.926
```

99.7% of the canopy collapses onto a 2 m cube. That is the blocky slab in the screenshots.
No error, no warning: the draw is perfectly valid, the geometry is just destroyed.

## What the previous report got wrong

- **Y1 (bake poison) is dead by experiment, not inference.** The tree GLBs in `public/` had already
  been overwritten with pristine source bytes, and the corruption still reproduced (`/tmp/ww-now.png`).
- Geometry is byte-identical between every source GLB and its baked output — verified numerically
  across all 57 species (vertex counts, position min/max, UV min/max, index counts): zero diffs.
- The shared-image / KTX2 bake is also innocent: `images` → `textures` → `materials` wiring is
  correct in every baked GLB, and the current failure reproduces with embedded-PNG sources.
- `TEXCOORD_0 out of [0,1] range` in the bake logs is a red herring — that pass is *skipped*, and
  UVs are still float32 in the output.

## Fixes applied

### 1. Engine (the real fix) — `packages/core/src/assets.ts`

`widenQuantizedPositions()` runs on every model the loader returns, before the game sees it: any
`POSITION` that is normalized or non-float32 is widened to `Float32Array` with exactly the values
`getX/getY/getZ` already returned. Rendering is bit-identical; the wire payload keeps the
pipeline's quantization win; every three.js geometry helper is now lossless.

It handles `InterleavedBufferAttribute` — meshopt models decode to interleaved attributes, so an
`instanceof BufferAttribute` guard silently skips most models. (The first attempt at the game-side
fix did exactly that and stayed broken. Do not reintroduce that guard.)

Red/green: `packages/core/__tests__/assets.spec.ts` — three new cases (plain quantized,
meshopt-interleaved, and a float-model control that must be left untouched). Proven red with the
fix stubbed out, green with it in. Full core suite: 949 passed.

### 2. Game (temporary, now redundant) — `sandbox/wildwood/src/render/foliage.ts`

`dequantizePositions()` does the same thing at the call site. **Delete it once a core build
carrying the engine fix is installed into the sandbox** — until then it is what keeps the trees
standing, and after that it is a harmless early-return.

Proof: `/tmp/ww-now.png` (red, collapsed slabs) -> `/tmp/ww-fixed2.png` (green, real trees), same
capture recipe, same server, same assets.

## Correction to an earlier claim in this file

An earlier draft said the pipeline "checks that a file was written, never that it still means what
the source meant". **That is wrong.** `packages/assets/src/passes/model.ts::assertNoDrift` already
self-verifies triangles, vertices, joints, clips and world-space bounding box against the source
and throws `TN_ASSETS_MODEL_DRIFT`. It is honest and it passed here because the bake genuinely did
preserve the geometry — confirmed independently by a numeric source-vs-bake diff across all 57
species (zero differences).

So the pipeline is **not** the culprit and does not need a correctness rescue. The defect was at
the loader/API boundary: the pipeline chose a representation that is correct glTF and hostile to
every ordinary three.js call, and nothing owned that seam. It does now.

## Still open: the animals are a SECOND bug, same origin

`/dev-animals.html` renders the roster floating above the ground at wildly wrong sizes. Nothing in
`Animal.ts` or `spawnWildwoodAnimals.ts` writes back to geometry, so the clamp above is not the
mechanism. The log names it:

```
TN_ANIMALS_SCALE:fox  span=1.96 scale=0.5351
TN_ANIMALS_SCALE:stag span=1.94 scale=1.0841
TN_ANIMALS_SCALE:doe  span=1.95 scale=0.9240
TN_ANIMALS_SCALE:wolf span=1.96 scale=0.7924
```

Every animal measures ~2.0 — the width of the quantization cube, not the animal. `percentileSpan()`
computes `matrixWorld x POSITION`, which is the right formula for a rigid mesh and the **wrong one
for a skinned one**: glTF ignores a skinned mesh's node TRS, so the dequantization scale lives in
the inverse bind matrices instead. Confirmed in the asset: `fox.glb` has mesh node scale 100 with
positions in [-1, 1] and `ibm[0]` column scale 0.0294.

Note the engine fix above does **not** fix this — widening to float preserves the same numbers.
There is no formula a game can write that is correct for both rigid and skinned imports, which
makes this framework territory by the same rule. The capability that is missing:

> **`ctx.assets` should be able to report an imported model's real rendered extent** — resolving
> quantization and, for skinned meshes, the bind pose — so a game never measures it by hand.

That wants its own red test (a quantized skinned fixture whose measured extent must match its
rendered extent) and its own playtest, and it should land before `percentileSpan` and
`stripJunkTriangles` in `Animal.ts` are touched — both currently measure the same wrong space.

## Also worth doing

Grep the repo and the templates for `applyMatrix4` / `translate(` / `scale(` / `rotateX|Y|Z(` /
`center()` / `toNonIndexed()` called on loader-provided geometry. The engine fix covers every one
of them going forward, but any code that cached its own copy of an attribute still needs a look.

---

# Animals: three defects, two fixed, one is an engine bug

## 1. FIXED — sized in the wrong space

`Animal.ts` hand-rolled `percentileSpan()` = `matrixWorld × POSITION`. Correct for a rigid mesh,
wrong for a skinned rig: a skinned vertex renders at `Σ w·(bone.matrixWorld · boneInverse)·position`.
Every animal measured ~1.96 (the quantisation cube) against a fox skeleton spanning 0.33, so the
fox rendered at a third size — an ant; the crow measured 1.06 and rendered 0.07.

`normaliseToMetres()` from `@threenative/core` was installed the whole time and measures through
`Box3.setFromObject`, which is skin-aware. Fox 0.535 → 0.981, crow 0.531 → 0.483.

## 2. FIXED — the doe and the wolf were bound to another animal's clips

`DOE_CLIPS` spread `STAG_CLIPS`, `WOLF_CLIPS` spread `FOX_CLIPS`, keeping the other animal's
prefix. `SK_DeerDoe.glb` has no `ANIM_DeerStag_*`; `SK_Wolf.glb` has no `ANIM_Fox_*`. Doe bound
0/10 clips, wolf 1/10 — both frozen in bind pose, silently.

`Animal.audit()` reports this per clip and **nothing was calling it**. The dev harness now prints
`TN_ANIMALS_AUDIT` every run: 10 MISSING → 30/30 bound.

## 3. STILL OPEN — the deformation. My mirror hypothesis was WRONG.

I measured that the rig's root bone differs between bind pose and clip frame 0:

```
T STAG_  bind  = [0.000,  0.999, -0.504]        clip0 = [0.000,  0.999, +0.504]
R STAG_  bind  = [-0.497, 0.503,  0.497, -0.503] clip0 = [0.502, -0.498, 0.502, -0.498]
```

and concluded the Unreal importer had left a Z mirror between the two paths.

**That conclusion does not survive its own test.** I implemented the exact measured correction —
`(x,y,z) -> (x,y,-z)` on the root's position tracks, `(x,y,z,w) -> (-x,-y,z,w)` on its quaternion
tracks, applied to all 218 root tracks across the six rigs — and the render was unchanged. Reverted.

The reason it is wrong: `(x,y,z,w) -> (-x,-y,z,w)` is conjugation by a 180-degree rotation about Z.
It is a plain yaw, not a reflection, and a clip whose root faces the other way from the bind pose
is an ordinary authoring choice, not corruption. Frame 0 of a clip is under no obligation to equal
the bind pose. I read a normal difference as a defect.

**What is actually established:**
- The clips are healthy: animation accessors are byte-identical source-vs-bake, all 803
  quaternions unit length, and after the fix in section 2 all 30 clips bind 30/30.
- `stripJunkTriangles` is not the cause — disabling it changes nothing.
- The geometry is not the cause — the loader-side quantisation fix is unrelated and the bind pose
  renders correctly (an animal with no clip bound stands correctly shaped).
- So: healthy clip + healthy rig + correct binding -> deformed pose. The defect is in how the pose
  is *applied*, and I have not isolated it.

**Do not trust any of my visual "looks correct" verdicts on this.** I called an idle capture green
that the user could see was deformed. The harness makes that easy to get wrong: its camera sits at
the origin while `PRODUCTION_PLACEMENTS` spawns animals 28-54 m away, and they roam another 30-55 m
on top of that, so every animal is a few dozen pixels at the frame edge.

**Next instruments, in order:**

1. **Make the harness able to judge one animal.** It needs `?only=<id>` and a camera that frames
   that animal, plus `roam=0`. Without that, no screenshot of this is evidence. The harness already
   has a `corruptAnimalForward` parameter — a deliberate negative control — so wire the new view up
   against that first and confirm it can *see* a known-broken pose before trusting a green.
2. **Use the number, not the picture.** `clipPoseError`, `clipBoneCoverage` and `boneContact` are
   already exported from `@threenative/core` for exactly this (PRD-314, "a broken retarget is a
   number, not a screenshot"). Score every clip on every rig and rank by error; that names the bone
   and the frame instead of asking someone to squint.
3. Only then decide the layer.
