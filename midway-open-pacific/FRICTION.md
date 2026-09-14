# Engine friction

## 2026-09-14 — Render preparation and repeated scene transforms

The installed `Scene.render` callback runs after the ordinary draw, so it cannot prepare the current frame. Capability discovery found no matching before-presentation hook. Midway uses ordinary Three.js mesh `onBeforeRender` callbacks for particle packing; particle physics remains in fixed updates.

A profile and controlled prototype found three root world-transform walks per outer render (main, reflection and another pass). A generic renderer-wide suppression was rejected because arbitrary transform-mutating render callbacks in other games may depend on per-pass updates. The verified Midway-only scene hook relies on its existing single main camera and buffer-only render callbacks, preserves the prior hook/flag, and restores them on exit. It is a small use of existing Three.js APIs, not a second engine loop. A future reusable mechanism must preserve callback and multi-camera semantics and ship native proof.

Evidence and acceptance live in `docs/PRDs/PRD-midway-flak-hunt-20260914.md`; local measurements are under `/tmp/midway-flak-hunt/`.
