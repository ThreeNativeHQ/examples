# Engine friction

## 2026-09-14 — Preparation before presentation must preserve batching

The installed `Scene.render` callback runs after the ordinary draw, so it cannot prepare the current frame. Capability discovery found no matching before-presentation lifecycle hook.

The attempted particle mesh `onBeforeRender` optimization was rolled back: at the supported 68-aircraft roster it changes the engine's automatic scene projection from 144 batches to a `renderHook` decline. Putting packing on the source scene root is also unsafe because the projection mirror does not forward that hook. The engine owns this scheduling seam; the game must not bypass automatic projection to prepare buffers once per presented frame.

Midway's separate standard Three.js scene hook removes repeated world-transform walks when the authored scene is drawn. On projected frames the engine itself updates source transforms before projection. The hook restores the original flag and hook ownership on scene exit. A generic renderer-wide suppression was rejected because arbitrary transform-mutating callbacks in other games may depend on per-pass updates.

Evidence and acceptance: `docs/PRDs/PRD-midway-flak-hunt-20260914.md`; raw local probes: `/tmp/midway-flak-hunt/`.

## 2026-09-14 — Confirmed projection topology defect, and the seam that replaces the rollback

The reported long connected tracer lines were an engine defect, not the scheduling change:
`packages/core/src/projection-apply.ts` built every `isLine` proxy as a plain `Line`, so projected
`LineSegments`/`LineLoop` lost their primitive class and drew a continuous strip. The fix preserves
the specialized class before the generic branch; the projected tracer is now asserted `LineSegments`
in real browser frames. Upstream issue: https://github.com/ThreeNativeHQ/threenative/issues/248.

The correct once-per-draw boundary the game needed is now an engine seam, not a game workaround:
`ctx.beforeRender(callback)` registers scene-owned work that runs once per actual world render,
after the frame's last fixed update and before projection packs, and is cleared at scene change and
stop. Midway uses it to call `particles.prepare(camera)` instead of per-mesh `onBeforeRender` hooks,
so automatic projection stays engaged. Packing is now once per outer draw (prepare:writeBatch 1:2)
versus once per fixed update in the legacy path. No architecture rewrite: one registration site, the
existing step/emission code unchanged.

