# grove

22 procedurally generated trees swaying in a TSL wind, on the published `create-threenative@0.2.6`
`minimal` template. The demo for ThreeNative PR #333 (procedural vegetation).

![grove](grove.png)

- `src/vegetation/` — EZ Tree generation (seeded, vertex-budgeted, safe indices), copied from the
  engine's `examples/integrations/vegetation/src/`. Donor: `ez-tree-source` pinned to upstream
  `dcf309bd`, aliased in `vite.config.ts`.
- `src/render/wind.ts` — the integration's editable TSL wind: world-space direction, analytic
  normal correction, shared by the shadow pass.
- `src/render/trees.ts` — this game's look: bark, procedural leaf-cluster cut-out in `maskNode`
  (so shadows are dappled), and one wind per variant.
- `playtests/grove.playtest.json` — 22 trees, vertices > 0, wind time advances, and the frame
  changes. Control: amplitude 0 gives `changedPixelRatio: 0` and the scenario goes red.

```sh
pnpm install && pnpm dev   # or: pnpm test
```
