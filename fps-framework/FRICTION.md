# Friction ledger — fps-framework

Kept while building, newest rows appended at the bottom of each block. "Evidence" points at
the file, command output, or screenshot that shows the problem. Pruned 2026-08-22 against
the installed tarballs — see the note below the table.

| API or surface | What blocked the build | Workaround | Evidence |
| --- | --- | --- | --- |
| Physics compound shapes (`@threenative/physics`) | `IRigidBody3DOptions.shape` takes exactly one `CollisionShape3D`; there is no compound shape and no add-this-mesh-as-static-collision helper, so a level made of many meshes cannot become one body and every solid surface is hand-fed as its own box collider. Trimesh, convexHull and heightfield all exist now (`CollisionShape3D.heightfield(...)`, explicit kinds via `fromMesh`), but each still yields a single-shape body. | Kept the parallel `TownCollider[]` list in `src/render/town.ts` and built one fixed body per box. | `node_modules/@threenative/physics/dist/Area3D-B6CHuR1v.d.ts` — singular `shape`; body builder at `src/scenes/Play.ts:297` |

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
