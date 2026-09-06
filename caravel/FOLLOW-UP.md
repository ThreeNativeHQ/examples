# Follow-up — open issues in `caravel`

Exported from the `sailing` template on 2026-09-06, mid-investigation. Everything below is either
reproduced here or measured here; nothing is guessed.

Run the evidence:

```sh
tools/capture-lock.sh pnpm exec threenative-playtest \
  --scenario "playtests/float.playtest.json" --browser-recipe webgpu --headed \
  --server-command "pnpm dev --host 127.0.0.1 --port \$PORT --strictPort"
```

---

## 1. BLOCKER — the ocean's height field never changes

`playtests/float.playtest.json` fails on `component.player.seaHeight` with
`changed: true`, and that failure is the real bug, not the assertion.

Observed across one run, 330 ticks apart:

| reading | before | after | reads as |
| --- | --- | --- | --- |
| `oceanSteps` | 166 | 406 | `SpectralOcean.process()` **is** dispatching |
| `readbackStaleFrames` | 91 | 88 | it **decreased**, so a GPU copy **did** land |
| `seaHeight` | `0.7879938087965312` | `0.7879938087965312` | identical to 16 significant figures |
| `floatGap` | −0.00015 | −2.9e−10 | the hull sits on the height it is given |

So: the compute passes run, the readback lands, and the bytes that come back are the same bytes.
The height field's **contents** are not being recomputed — this is not a stale-copy problem and not
a throttle problem.

The visible symptom is the one that started this: the sea is a still photograph, so the ship is
pinned to a constant height while nothing moves, and the hull reads as sitting on top of the water
rather than floating in it.

### Ruled out, with evidence

- **Not the environment, and not `GPUReadback`.** `sandbox/spectral-sea` uses the same class on
  this machine and its own scenario passes: `heightSamples` 39 → 58 (copies landing repeatedly),
  `staleFrames` 14 → 68 (bounded), `oceanSteps` 276 → 1380.
- **Not `readbackResolution` / `readbackEveryFrames`.** Reproduced at both `64`/`2` and at
  spectral-sea's exact `32`/`3`.
- **Not the camera or the pinning.** `floatGap` ≈ 0 throughout: the drawn hull is exactly on the
  surface height it is handed. Fixed on the way here: the camera followed `ship.mesh` (the physics
  body) while the hull is drawn from `ship.visual`, so the horizon slid behind a steady ship.
- **Not the pitch sign** (fixed on the way here — see §4).

### Where to look next

Diff this game's `src/render/ocean.ts` `SEA` against `spectral-sea/src/render/ocean.ts`. The
remaining differences are `amplitude`, `choppiness`, `directionality`, `smallWaveCutoff`,
`windSpeed`, `seed`, and the cascade `patchSize` pair — none of which *should* freeze a field, so
if one of them does, that is an engine finding worth filing rather than a tuning mistake here.

The other structural difference is that this game adds the ocean **after** `setupPost` and the
loading screen, where spectral-sea adds it first.

---

## 2. The sails should be `SoftBody3D`, and are not

`engine_search_capabilities` on *"make a ship's sails and flags behave as cloth in wind, and make a
hull float on simulated water"* returns `SoftBody3D` as the **top** hit, with the matched situation
spelled out as *"make cloth sails billow in wind on a ship"*.

This game's sails are static bellied meshes built in `src/render/props.ts` (`belliedSail`), and the
pennant is a static quad. The `starter` template already drives its finish flag with `SoftBody3D`,
so there is a worked call site in-tree.

`SoftBody3D` wants: one node material, complete triangles, and `pinned`, `stiffness`, `damping`,
`gravity`, `wind` as required game-owned inputs. `softBodyCollision` from `@threenative/physics`
exists if the sails should stop against a mast.

---

## 3. Buoyancy is decoupled, and only half by choice

`Buoyancy3D` still runs, but nothing visible is drawn from it. `Ship.visual` takes its height and
attitude from the swell directly, because the body **tumbles**: `Buoyancy3D` applies force per hull
point (so wave slope torques it), while its drag term is computed from the body's *linear* velocity
and is therefore identical at every point. Nothing damps rotation, and `IRigidBody3DOptions`
exposes no `angularDamping`.

Measured here: `bodyY` swinging between −0.19 and +2.42 within a few seconds, with
`submergedFraction` flipping 0.00 / 0.48 / 1.00.

That is an engine gap, not a tuning problem — a game cannot reach Rapier's angular damping through
the current options. Until it can, `submergedFraction` is not a number this game can show a player,
which is why the HUD's waterline reads `Ship.immersion` (computed from the swell) instead.

---

## 4. Fixed on the way here — do not re-introduce

- **Pitch sign.** The bow is at **−Z**, so a positive `rotation.x` lifts it; pitch must therefore
  be driven by `aheadHeight − asternHeight`. Written the other way round the bow rose over troughs
  and drove into the face of every wave — "the front looks like it's drowning".
- **`normalNode` is view space.** It overrides `normalView`. Fed a world-space normal, the sun's
  reflection stops being a place on the sea and becomes a column of glare that follows the camera.
- **Sample the displacement bilinearly.** Nearest-texel sampling makes the displacement a step
  function, so its derivative is piecewise-constant and the specular breaks into hard axis-aligned
  white rectangles.
- **Freeboard.** The rails sat 0.46 above the waterline against a 0.66 draught; after normalising
  to the 4.6 m convention that is 29 cm of hull showing against 41 cm submerged, and the ship
  photographed as though it were sinking. The rails now stand about twice the draught.

---

## 5. Not started

- **`defense`** template: the board reads as confusing and needs a pass.
- **`platformer`** template: agreed plan is to port `fox-native`'s look into it (its render layer —
  character, terrain, palette, camera), keeping the template's mechanics and its 21 playtests.

---

## Where the rest of the work lives

The eight repaired templates are committed in `threenative-engine` as `944fab2f`. **The
`SpectralOcean` work in `packages/create-threenative/templates/sailing` is uncommitted** in that
tree — this folder is its only committed copy. Decide whether to land it there once §1 is closed;
committing a template whose ocean does not move would be worse than leaving it out.
