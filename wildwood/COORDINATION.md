# Coordination note — 2026-09-01, from the engine-side session

Another session (the engine coordinator) worked in this sandbox between ~16:50 and ~17:45 while
this lane was idle, and stopped as soon as the lane resumed at 17:25. What it left, all
committed by this lane as `ea7bf01`:

- `threenative.config.ts`, `package.json`: engine tarballs from `main` (core `28b6d7a5ea64`,
  assets `3ae23b50fee7`, playtest `da4bfbcf34e4`, CLI `716908753e7a`) — the lane's own assets
  commits are on `main` too (`e75d0037`…`45ff01f3`).
- `src/scenes/Valley.ts`, `src/render/foliage.ts`, `src/entities/animals/spawnWildwoodAnimals.ts`:
  loading view created in `load()`, critical/detail tiers, parallel animal loads, sky HDR resolved
  through the manifest. Typechecks; measured: valley built 1.7–2.1 s.
- `playtests/startup.playtest.json`: uses the engine's new `assert.startup`; `enteredMs` passes
  (1914 ≤ 2500), `readyMs` fails (16663 > 8000) on the engine warmup's 11–12 s whole-scene
  compile. Run it with the engine runner
  (`node <engine>/packages/playtest/dist/runner/cli.js`) until the playtest tarball is repacked.
- Records: `<engine>/docs/verification/PRD-315-phase0.md` and `PRD-315-handoff-2026-09-01.md`.

Next on the engine side: the warmup cost. Next here: animals (navigation around water, measured
forward axis, the `stripJunkTriangles` question), the field-map HUD, and lighting through
`VirtualShadowNode` from `@threenative/core` (`sun.shadow.shadowNode = new VirtualShadowNode(sun, …)`).
