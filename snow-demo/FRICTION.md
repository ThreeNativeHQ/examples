# FRICTION — Snow Putt (snow kit sandbox demo, PRD-469)

Built cold from `--template snow` with locally packed tarballs (`.packages/snow/*-snow-<sha>.tgz`,
engine `feat/prd-469-snow`). Each entry names the layer and where it went.

1. **Powder takes no energy from a rolling ball** (engine, open). `attachSnowPhysics` deforms the
   snow under a ball but never slows it: at rest on the glade's 7% slope the ball rolls about 4 m
   off its tee, and a pushed ball is still moving at 0.7 m/s four seconds later. Three
   rolling-resistance models were added to the binding and measured on real Rapier; none held on
   both backends (native desktop over-spun, roll ratio 5.9), so they were reverted
   (engine `c53c8a577`, measurements in its message and in PRD-469's Decisions). Game workaround
   here: every round presses the ball a lie at the tee (`pressLie` in `src/scenes/Snow.ts`), and
   putts are weighted to the distance left so a full push does not roll straight over the cup.
2. **`applyForceAtPoint` left its torque behind** (engine, fixed). Web and native cleared forces
   after each step but not torques, so an off-centre force kept spinning a body up forever.
   Found while trying (1); fixed on both backends with red-green tests in engine `f2812dd60`.
3. **Native runs of the same build differ** (engine, observation). `native-playtests/putt-win`
   holed in 3–5 pushes across runs of one desktop build, where the web build holed in the same
   number every run. The scenario's par-6 margin absorbs it; not root-caused.
4. **The kit's own ball rolls off its tee at load** (template, same cause as 1). In an unmodified
   `--template snow` (packed `snow-proof`, `playtests/survives`), the ball goes from its tee at
   (2.2, -2) to (1.53, -2.90) in the first seconds with no input. Not changed in the kit, since the
   fix belongs to (1).
