# FRICTION — fluid-lab

What slowed or blocked a cold build of this game, in the order it happened. Evidence lives in the
engine PR for PRD-476 (ThreeNativeHQ/threenative) and in `playtests/experiments.playtest.json`.

1. **Scaffolder refuses a non-empty target and bakes the folder name in.** `create-threenative`
   will not write into a directory that already holds `.packages/`; scaffolding elsewhere and
   copying left `fluid-scaffold` in `package.json`, `index.html`, the config and both agent files.
   Scaffold to the final path, pack tarballs to a staging dir.
2. **`create-threenative@0.2.7` is not on npm** (latest 0.2.6), so the template's own devDependency
   does not resolve from a tarball install; the local CLI had to be packed too.
3. **The `minimal` template is a 2,000-line game.** Sky, post stack, world environment, touch
   controls and a mannequin were deleted before the first line of this game; a water lab has no use
   for them. A truly empty template would have been faster than deleting.
4. **TSL is typed per swizzle.** `three/tsl` nodes reject `.y` on a storage element or an atomic
   result, so the solver and the water look cast the TSL namespace to one loose record
   (`// quality-allow` waiver). Not an engine bug; a typing wall every compute author hits.
5. **`THREE.TSL: Invalid generated code, expected a "uint"` with no stack.** Two causes, neither
   named by the message: an `atomicLoad` used directly as a `Loop` bound (bind it with `.toVar()`
   first), and an `atomicAdd` result read twice (it runs twice unless bound). `Node.captureStackTrace`
   did not produce a stack for build-time nodes. Found by bisecting kernels with a `console.log`
   before each `renderer.compute`.
6. **Headless Chromium reports no WebGPU adapter** (`TN_PLAYTEST_CAPTURE_PROVENANCE_MISSING`);
   `--headed` on the private Xvfb works. The sandbox AGENTS says so, the playtest error does not.
7. **Presented FPS is unmeasurable on this machine's private Xvfb**: a trivial WebGPU page presents at
   17-20 fps there, headless falls to SwiftShader, and the real display is off limits. The numbers
   in the PRD are GPU-completion step cost and uncapped frame intervals, labelled as such.
8. **Playtest assertions are thinner than the scenario wants.** `atSteps` takes only `equals`, and
   `visual` cannot be pinned to a step, so "each of eight scenes is non-blank" became state fields
   (`alive`, `moved`) plus a pixel check over the per-step screenshots outside the runner.
9. **A trivially-true assertion is an error.** The first desktop run failed with
   `TN_PLAYTEST_ASSERTION_TRIVIAL` because native stats had already landed at the first sample; the
   state's initial values must start on the wrong side of every threshold.
10. **Rapier has no angular damping on `IRigidBody3DOptions`.** Four hull points on a floating box fed
    splash noise into torque and the box tumbled and was ejected at 27 m. One centre hull point
    (heave only) is stable; that is a modelling workaround for a missing option.
11. **`GPUReadback` staleness is large in a playtest.** Surface height arrived 7-26 fixed steps late
    because ticks outrun readbacks; heights are box-filtered over open columns and bodies carry heavy
    drag so the stale surface cannot drive them unstable.
12. **A fixed body that nothing references fell through** in an early run until the floor was kept in
    a closure; unconfirmed whether the physics layer frees an unreferenced `RigidBody3D`.
