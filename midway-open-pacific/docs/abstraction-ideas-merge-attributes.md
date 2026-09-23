# Abstraction ideas — merge attributes

Companion to engine PRD-392. The repeated static-mesh merge in `src/render/assets.ts`
(`consolidate`), `src/render/airframe-lod.ts` (`mergeLod`) and `src/render/devastator.ts` (`batch`)
is now the engine's `mergeParts(..., { preserve: ["uv", "normal"] })`; per-material grouping,
geometry/material/colour choice, missing-channel fills and the LOD `null` contract stay in the game.

Scope note, so this doc does not overclaim: only two of the three are live gameplay.
`mergeLod` runs for every imported hull and Devastator `batch` runs for each processed aircraft;
`assets.ts` `consolidate` is exported but **unreferenced by the shipped game** — its `makeIsland`
and `makeCrew` builders are used by tooling only, and no game module imports them. The extraction
still removed `consolidate`'s duplicated loop; it just is not in-world integration evidence.

## Rejected candidates

- **Flight steering gains and mission decisions** — gameplay; they stay in the game by the charter.
- **Aircraft state initialization values** — game data; they do not justify a new engine factory.
- **`AnimationPlayer` timeScale clobber** — a pre-existing engine defect with a single local
  workaround; it is its own bug, not this extraction.
- **Low-detail material/texture averaging and the ship/ocean/effects look** — appearance, and so
  game-owned; the engine merges geometry and never picks a surface.
