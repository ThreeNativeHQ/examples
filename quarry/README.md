# Quarry

A walkable stone quarry: three rocks and three cliff pieces from Landscape Pro frame a pale slab path.
WASD walks, Q/E or left/right arrows turn, Space jumps, R returns to the trailhead.

Derived from `crate-vault`'s application, React/native UI, Vite, and physics scaffold.
The six GLBs are existing Landscape Pro imports from wildwood, unchanged; their two material families
share three distinct image payloads. Asset provenance: Fab item `1ac647da-b1bc-4e72-a56d-60aaeb6918e1`.
The source GLBs remain local, licensed editor inputs and are excluded from this public repository.
Owners of the pack can copy the six named GLBs from their existing Wildwood import into
`assets/models/`; the filenames are listed in `src/render/quarry.ts`.
The build's asset manifest resolves the files actually rendered.

This is PRD-349's cook proof. `threenative.config.ts` deliberately has no `assets` block.
`pnpm build --target web|desktop|android|ios` exercises the target's default cook.
`playtests/quarry.playtest.json` walks past all six loaded, texture-bound props.
Run it through the installed engine harness on a private headed display:

```sh
bash tools/capture-lock.sh node node_modules/@threenative/playtest/dist/runner/cli.js \
  playtests/quarry.playtest.json --url http://127.0.0.1:5173 \
  --server-command "pnpm dev --host 127.0.0.1 --port 5173 --strictPort" \
  --browser-recipe webgpu --headed
```
