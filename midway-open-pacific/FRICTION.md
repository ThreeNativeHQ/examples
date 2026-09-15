# Engine friction

## 2026-09-14 — Preparation before presentation must preserve batching

The installed `Scene.render` callback runs after the ordinary draw, so it cannot prepare the current frame. Capability discovery found no matching before-presentation lifecycle hook.

The attempted particle mesh `onBeforeRender` optimization was rolled back: at the supported 68-aircraft roster it changes the engine's automatic scene projection from 144 batches to a `renderHook` decline. Putting packing on the source scene root is also unsafe because the projection mirror does not forward that hook. The engine owns this scheduling seam; the game must not bypass automatic projection to prepare buffers once per presented frame.

Midway's separate standard Three.js scene hook removes repeated world-transform walks when the authored scene is drawn. On projected frames the engine itself updates source transforms before projection. The hook restores the original flag and hook ownership on scene exit. A generic renderer-wide suppression was rejected because arbitrary transform-mutating callbacks in other games may depend on per-pass updates.

Evidence and acceptance: `docs/PRDs/PRD-midway-flak-hunt-20260914.md`; raw local probes: `/tmp/midway-flak-hunt/`.
