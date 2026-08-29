# Mined-features proof — what this game is for

A small exploration scene that exists to answer one question: **do the features mined from the
Three.js ecosystem in the 2026-08-28 batch actually work in a project that installed ThreeNative
the way a user would?**

Nothing here is linked to the monorepo. The packages arrive as tarballs, `node_modules/@threenative/*`
ships `dist` only, and there is no `AGENTS.md` chain above this folder — so if a capability is not
reachable through the public API and the capability manifest, it is not reachable at all.

## Play it

```sh
pnpm dev
```

Walk with the arrow keys. **Click a beacon** to light it — the camera kicks, a flame starts, and the
beacon joins the traced scene so its shadow appears on the ground. **Scroll the wheel** (or pinch on
a touchscreen) to dolly the camera. Three lit beacons is the whole game.

## What each feature has to do to count

| Mined feature | PRD | Where the game uses it | State it moves |
| --- | --- | --- | --- |
| `Atmosphere` — LUT-baked sky radiance | 248 | `src/render/sky.ts`, `src/render/postprocessing.ts` | `sunTransmittanceRed` |
| `ctx.pointer.on(...)` — pointer events on an `Object3D` | 237 | `src/scenes/Play.ts` | `beaconsLit`, `beaconHoverEvents` |
| Portable zoom axis — one number from wheel and pinch | 239 | `src/render/camera.ts` | `cameraDistance` |
| `Billboard3D` | 247 | `src/render/beacons.ts` | `billboardFacingWorst` |
| `CameraShake` | 247 | `src/render/camera.ts` | `shakePeak` |
| `SpriteAnimator3D` | 247 | `src/render/beacons.ts` | `flameAdvances` |
| `IComputeDriven` — shared GPU compute lifetime | 242 | `src/render/motes.ts` | `computeSteps` |
| `GPUSceneBVH` — the scene traced from TSL | 244 | `src/render/contact.ts` | `bvhTriangles` |

`playtests/mined-features.playtest.json` asserts every row. It is one scenario rather than eight so
that the features have to coexist: a compute field, a BVH snapshot and an atmosphere all holding
storage buffers in the same frame is the case that a single-feature proof never reaches.

## The framework owns no look here

Every appearance decision is in `src/render/`, and deleting the framework would not tell you what
the game looks like. The beacon shape, the palette, the flame atlas and each frame's duration, the
shake waveform, the zoom range, the sun's time of day and the two ground colours are all authored
in this project. The packages see an `Object3D` that implements `IComputeDriven`, a `userData`
flag naming what is traceable, and a camera-shake offset they never apply to a camera.

## Two things worth knowing before you copy this

1. **A three-plane scene cannot be traced.** With six triangles the BVH packs a single node, and a
   one-element storage buffer generates `ptr<storage, BVHNode>` where the upstream query wants
   `ptr<storage, array<BVHNode>>`. The shader then fails to compile with a WGSL type mismatch. The
   beacon posts are boxes for that reason, not for the look.
2. **Flush world matrices before the snapshot.** `GPUSceneBVH` packs world-space triangles, and at
   scene-build time nothing has rendered yet, so `ctx.scene.updateMatrixWorld(true)` runs first.

## The stock `play` budget was raised, deliberately

`playtests/play.playtest.json` shipped with the minimal template's budget — 20 draw calls and 1,223
triangles for a floor, a wall and a cube. This game observed **27 draw calls and 5,127 triangles**,
which is what three beacons, a 2,048-instance compute field and a BVH-traced ground cost. The
budget is now 32 and 6,200: still a ceiling that a regression trips, just one measured against the
scene that exists rather than the one the template shipped.
