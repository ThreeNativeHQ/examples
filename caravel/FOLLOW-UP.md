# Follow-up — open issues in `caravel`

Exported from the `sailing` template on 2026-09-06. Everything below is either reproduced here or
measured here; nothing is guessed.

Run the evidence:

```sh
tools/capture-lock.sh pnpm exec threenative-playtest \
  --scenario "playtests/*.playtest.json" --browser-recipe webgpu --headed \
  --server-command "pnpm dev --host 127.0.0.1 --port \$PORT --strictPort"
```

All seven scenarios pass, including `production-performance`.

---

## Closed

### 1. The ocean's height field never changed — **fixed**

`SpectralOcean.advance(seconds)` is documented as *"Seconds of wave time. The game advances it, so
a paused game has a paused sea"*, and this game never called it. The compute passes dispatched
every frame and inverse-transformed the spectrum **at t = 0** forever, which is exactly what the
evidence said and nothing else explained: `oceanSteps` 166 → 406, `readbackStaleFrames` decreasing
(so copies were landing), and `seaHeight` identical to sixteen significant figures.

One line in `Sailing`'s frame function. `seaHeight` now runs −0.98 → +2.22 across a run and
`playtests/float.playtest.json` passes.

The ruled-out list in the original note was all correct — it was not the environment, not
`GPUReadback`, not the readback settings, not the camera, and not the pitch sign. It was simply
that nothing ever told the sea what time it was.

### 2. The sails were not `SoftBody3D` — **fixed**

They are now, and `playtests/sails.playtest.json` reads the cloth's own vertices back to prove it.
Four things that were wrong on the way, all recorded in the code where they bit:

- Cloth cannot be a child of the hull — `SoftBody3D` disposes itself on `removed`, and `ctx.add`
  is what attaches it to the renderer, so it lives at the scene root and `Ship` carries it to its
  yard through the **model's** matrix each tick.
- Stiffness is measured against *local* gravity: local units are 0.57 m, so gravity is 17, and the
  starter's 52 let the top row balance eight rows of canvas at three quarters of a unit of stretch.
- Pin the head only. Held at three edges a sheet of distance springs gathers instead of filling.
- Flat shading, because the class replaces a material's position node and nothing else — authored
  normals go on pointing where the sail was cut while the sail swings away from them.

The pennant at the main truck is **still a static quad**. It is the obvious next one.

### 3. The hull rode water the renderer had stopped drawing — **fixed here, and it is a contract**

`sampleHeight` reports `staleFrames` precisely because a spectral ocean has no closed-form height,
and the note in the API is exact: *"A caller that ignores it floats a hull on water that is not the
water being drawn, and nothing in the frame says so."* This game ignored it. The tell was a
waterline reading that swung between a third and two thirds of the hull between two captures a
second apart.

`surfaceHeight()` in `src/render/ocean.ts` is the fix and every reader goes through it — the hull,
the buoyancy solver's field adapter, the course marks and the camera's water floor. Deep-water
waves travel, so the field at `t + d` is very nearly the field at `t` shifted downwind by
`speed · d`: sampling that far **upwind** of a point reads what the water there is about to be
doing. The phase speed comes out of `SEA` itself (Pierson-Moskowitz peak, `g/ω`), so retuning the
wind retunes the correction.

Capped at a quarter of a second. In a real session the lag is a few frames; inside a playtest the
fixed step runs far faster than wall-clock and a copy in flight covers a hundred ticks, and
extrapolating *that* far would sample twenty metres upwind where the field has decorrelated.

---

## Still open

### 4. `Buoyancy3D` has no angular damping, so the body still tumbles

Unchanged from the original note, and still an engine gap rather than a tuning problem.
`Buoyancy3D` applies its displaced-volume force per hull point — so wave slope torques the body,
which is right — while its drag term is computed from the body's *linear* velocity and is therefore
identical at every point. Nothing damps rotation, and `IRigidBody3DOptions` exposes no
`angularDamping`.

Measured here: `bodyY` swinging between −0.19 and +2.42 within a few seconds, `submergedFraction`
flipping 0.00 / 0.48 / 1.00.

So the body keeps the heave and the **attitude is read off the swell instead** — three height
samples around the hull give the pitch and the roll. That is stable and closer to what a boat does
than a free-spinning rigid body, but it is a workaround: until a game can reach Rapier's angular
damping, `submergedFraction` is not a number this game can show a player, which is why the HUD's
waterline reads `Ship.immersion` instead.

### 5. Not started

- **`defense`** template: the board reads as confusing and needs a pass.
- **`platformer`** template: agreed plan is to port `fox-native`'s look into it (its render layer —
  character, terrain, palette, camera), keeping the template's mechanics and its 21 playtests.

---

## Fixed on the way, at various times — do not re-introduce

- **The helm was never hard over.** `input.vector()` ends in `clampLength(0, 1)`, which is right
  for a thumbstick and wrong for a ship: holding forward *and* starboard handed the ship 0.707 of
  each, so the one input a player holds for the whole passage was also the one that could never
  reach full sail or full rudder. `helm` and `sheets` are separate axes; `move` stays for the touch
  stick, where the clamp is correct.
- **Steering was a decoration.** Velocity came straight from the input axes while the drawn hull
  turned on a separate slow angle nothing else read, so the ship pointed one way and travelled
  another and the course could be collected by strafing past the marks broadside.
- **Pitch sign.** The bow is at **−Z**, so a positive `rotation.x` lifts it; pitch must be driven by
  `aheadHeight − asternHeight`. Written the other way round the bow rose over troughs and drove into
  the face of every wave.
- **Probe along the ship's axes, not the world's.** A fixed north-south pair made the hull pitch to
  swell it was running along the length of and roll to seas it was meeting head on.
- **Euler order `YXZ`.** In the default `XYZ` the pitch is applied in world space and the heel goes
  wherever the heading points it.
- **`normalNode` is view space.** It overrides `normalView`. Fed a world-space normal, the sun's
  reflection stops being a place on the sea and becomes a column of glare that follows the camera.
- **Sample the displacement bilinearly.** Nearest-texel sampling makes the displacement a step
  function, so its derivative is piecewise-constant and the specular breaks into hard axis-aligned
  white rectangles.
- **Difference the normal finer than the mesh.** At the quad size every wave shorter than four
  metres is gone before it can shade anything and the sun lands as one blown lobe. Buying the same
  detail as *geometry* costs 282k triangles against a 138k budget; as a normal it is free.
- **The sea has to travel.** A 300 m patch nailed to the origin puts a visible rectangular hem
  inside the fog once the course reaches −46. The patch moves and the field it reads does not.
- **Fresnel.** Without it a sea is one flat teal from the bow to the horizon whatever the waves are
  doing. With it at an exponent of four and a weight of 0.8 it is a wash — a chase camera is low, so
  most of the frame is at a grazing angle. Water's own Schlick exponent is five.
- **Foam thresholds are in metres and move with `SEA.amplitude`.** Left where a bigger sea state put
  them, the middle distance comes back as an unbroken white sheet that reads as snow.
- **Freeboard.** The lofted hull is built about y = 0 with its keel at −0.73 and its rail at +0.80,
  so floating the *origin* on the sea puts the water halfway up the topsides.
- **The shadow frustum has to go where the ship goes.** A ±30 m box on the origin is fine for a
  course eight metres long; the passage reaches x = −34, where every shadow switches off at once.

---

## Where the rest of the work lives

The eight repaired templates are committed in `threenative-engine` as `944fab2f`. **The
`SpectralOcean` work in `packages/create-threenative/templates/sailing` is uncommitted** in that
tree — this folder is its only committed copy, and it is now a good deal further along than the
template is. Landing it back is worth doing.
