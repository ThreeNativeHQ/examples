# Friction ledger — fps-framework

Kept while building, newest rows appended at the bottom of each block. "Evidence" points at
the file, command output, or screenshot that shows the problem. Pruned 2026-08-22 against
the installed tarballs — see the note below the table.

| API or surface | What blocked the build | Workaround | Evidence |
| --- | --- | --- | --- |
| Physics compound shapes (`@threenative/physics`) | `IRigidBody3DOptions.shape` takes exactly one `CollisionShape3D`; there is no compound shape and no add-this-mesh-as-static-collision helper, so a level made of many meshes cannot become one body and every solid surface is hand-fed as its own box collider. Trimesh, convexHull and heightfield all exist now (`CollisionShape3D.heightfield(...)`, explicit kinds via `fromMesh`), but each still yields a single-shape body. | Kept the parallel `TownCollider[]` list in `src/render/town.ts` and built one fixed body per box. | `node_modules/@threenative/physics/dist/Area3D-B6CHuR1v.d.ts` — singular `shape`; body builder at `src/scenes/Play.ts:297` |
| `prewarm()` (`@threenative/core`) | Destroys any subtree that is not a hide-then-reveal effect pool, silently and permanently. It **replaces** `mesh.material` with a clone and sets `transparent = true; opacity = 0` on it, and **no code path ever sets opacity back**. The `compileAsync` wrapper looks like the restore path and is not: it only picks up roots where `hasHiddenAncestor(object)` is true, and even for those it just calls `compileAsync` and drops the root from `prewarmedRoots` — opacity stays 0. So `prewarm(ctx.scene)`, the most obvious argument to pass a function named "prewarm", renders the entire game invisible for the rest of the session, and swaps out the game's own material references while doing it. Nothing throws, nothing warns, and **every gate in this project still passes** — decals still "place", pathfinding still solves, and frame timings *improve* because the renderer stopped drawing the level. Cost a false 231 ms → 41 ms "optimisation" that was really an undrawn scene. | Do not call it on live scene content; it is only for a pooled effect root whose opacity the game writes on every spawn. This game already prewarms its own pools by keeping them resident at `scale 0.0001`, which costs nothing and cannot do this. | `node_modules/@threenative/core/dist/index.js` — `prewarm` at `:2146`, material clone via `warmSurface` at `:2130`, `mesh.material` reassigned at `:2162`, `transparent = true; opacity = 0` at `:2165-2167`, root recorded in the module-level `prewarmedRoots` WeakSet at `:2150`. Sole restore path is the renderer wrapper's `compileAsync` at `:2200`, gated at `:2205` on `prewarmedRoots.has(object) && hasHiddenAncestor(object)` (`hasHiddenAncestor` at `:2138`), and even that path only calls `compileAsync` and `prewarmedRoots.delete` — **no code anywhere sets `opacity` back to 1**. A `Scene` has no parent, so `hasHiddenAncestor` returns false on the first check and `prewarm(ctx.scene)` can never be restored by any API. (The `visible = true` walk at `:2155-2160` breaks at `root` per `:2158`, so it does *not* clobber the ancestor visibility the gate tests — the intended hidden-pool case still restores; only a root with no hidden ancestor is unrecoverable.) Because `warmSurface` clones, the mesh no longer references the game's original material at all. Footnote on the working pattern: `prewarm` also sets `root.visible = true` (`:2155-2158` walks child-to-root inclusive), so the hidden flag has to sit on the root's **parent**. A caller who hides the pool root itself gets that flag cleared by `prewarm` and then fails `hasHiddenAncestor` for the ordinary reason — which is why the pattern that works is a hidden *wrapper* around a visible root, not a hidden root. Screenshot of the sky-only scene, 2026-08-22 session. |

## Pruned 2026-08-22

Every original row was checked against what this game actually runs (`@threenative/core`
voicepool tarball, `physics 0.2.1`, `playtest 0.2.0`) and the engine tree. Nineteen rows were
deleted because their gaps are closed upstream — most by
`threenative-engine/docs/PRDs/done/fps-friction-26-08-17/`:

- PRD-138 pointer look → `input.raw.pointer.relative` + `captureMouse()`/`releaseMouse()`
- PRD-139 raycast → `origin`/`direction`/`far`, documented screen units, `raycastAll()`, `exclude`
- PRD-140 scene collapse → meshes with non-empty `userData` decline the bake, warn severity, `collapse: false` opt-out
- PRD-141 animation → `play(name, { mode: "once" })` holds the last frame; `.finished` getter
- PRD-145 rigidbody → `position` option; object-less fixed bodies
- PRD-146 ticks vs frames → the runner counts `holdFrames`/`waitFrames` as fixed-step ticks
- PRD-147 assertions → `lte`
- PRD-148 scaffolded gate → globbed scenarios, webgpu/headed flags, `$PORT` via `--server-command`
- PRD-149 docs drift → `state` canonical / `GameState` alias documented; bridge-throttle guidance written
- PRD-150 assets → inspect command reports bounds/clips/bones; the console artifact keeps every entry

Also closed without a PRD number: `moveAndSlide`'s deferred transform write is documented in
its own JSDoc; the 100 ms state-bridge flush and the decay workaround are spelled out in
gameplay-recipes.md; `tools/capture.mjs` is no longer shipped by the scaffold — the playtest
runner owns input-driven captures; the `probe.mjs` async-sample bug was in this game's own
script, not an engine gap.
