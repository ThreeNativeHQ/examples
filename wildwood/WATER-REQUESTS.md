# Water requests — changes needed in files the water lane does not own

The water lane owns `src/render/water.ts`, `src/render/pond.ts` and anything new under
`src/render/water/`. Everything below is in someone else's file and has been left alone.

## 1. `src/scenes/Valley.ts` (or `postprocessing.ts`) — nothing tints the frame when the eye is under water

**Owner: whoever owns the scene and the render chain.**

The lake is 8.6 m deep and the walker walks in on the bottom. Two of the six spawn points the water
lane captures from put the camera *below* `WATER_LEVEL`:

| spawn | ground (`heightAt`) | eye = ground + 1.66 |
| --- | --- | --- |
| `-46,20,-1.2` | -6.79 m | **-5.13 m**, five metres under |
| `-30,60,-2.6` | -2.09 m | **-0.43 m**, just under |

This is not an edge case a player has to hunt for: the lake sits across the south-west of the map
and wading into it is the obvious thing to try.

`water.ts` now draws the *surface* correctly from below — Snell's window and a dim mirrored ceiling
instead of the black-and-white static that was there before. What it cannot do is the other half of
being under water, because that half is not on the water mesh: **everything else in the frame is
still drawn as if it were in air.** At five metres down the lake bed reads as bright dry sand,
razor sharp all the way to its own horizon, and `scene.fog` is the grey `AERIAL_COLOUR` haze that
belongs to the sky. A surface material cannot reach any of that.

What it wants, in rough order of how much it buys:

1. A green-blue `FogExp2` swapped in while the camera is below `WATER_LEVEL`, an order of magnitude
   denser than the aerial one — visibility of a few metres, not a few hundred. `scene.fog` is
   already read by every material in the valley, so this is one assignment and it does most of the
   work.
2. Something that kills the sky: with the camera under the surface, `scene.background` should not
   be the HDRI.
3. Optionally a fullscreen tint/blur in the render chain, which is the part `postprocessing.ts`
   owns.

The state it needs is already computed: `Wanderer.feetY` and `Wanderer.wading`. The water surface
exposes `IWater.level` and `IWater.covers(x, z)` if a second opinion is wanted.

The water lane has not touched any of this and will not; the surface reads `cameraPosition.y`
itself and needs nothing from the scene.

## 2. Faint dotted horizontal rules across the water — not the water material

**Owner: whoever owns `postprocessing.ts` / `quality.ts`, if it survives.** Recorded here as
evidence, not as a request, unless it is still visible after the water lane's `depthWrite` change.

Thin dark dotted horizontal lines cross the mid-water in every capture, with a faint diagonal
dither weave between them. They were assumed to be the refraction sample at grazing angles. They
are not. A three-strip probe painted the left third with the refraction sample at this shader's
offset, the middle third with the refraction sample at zero offset, and the right third with a
**flat constant colour containing no frame read at all**, opacity forced to 1 — and the dotted lines
and the weave are in all three strips, including the constant one
(`/tmp/water-shots/probe1/view-0.png`).

Nothing in the material can vary across a constant colour. What can is a pass that runs after it,
and with the water writing no depth, the depth and normal buffers under every water pixel held the
**lake bed at a grazing angle**, where its triangle rows are a few pixels apart and its depth
derivative is enormous. `TN_RENDER_CHAIN` reports `ambientOcclusion`, `ssgi` and `ssr` all applied,
and all three read those buffers. The water lane's fix from its own side is to make the surface
write depth, so the buffers hold the smooth water plane instead. If the lines outlive that, they
belong to whichever of those three stages is reading a grazing-angle depth derivative without a
guard, and the water is only where it shows.

## 3. The WebGL2 fallback loses one post pass to a GLSL type error — not the water

**Owner: whoever owns `postprocessing.ts` / `quality.ts`, or upstream.** Found while checking the
water lane's own requirement that the surface must not white-screen on
`WebGPURenderer({ forceWebGL: true })`. It does not: the game renders, the lake is there, and the
reflection works (headless WebGL2 capture, `?spawn=-46,4.3,-3.1416`). But one fragment program in
the chain fails to compile:

```
THREE.WebGLProgram: Shader Error 0 - VALIDATE_STATUS false
ERROR: 0:225: 'max' : no matching overloaded function found
ERROR: 0:225: 'assign' : cannot convert from 'const mediump float' to 'highp int'

> 225: nodeVar25 = max( int( trunc( ( max( abs(nodeVar23), abs(nodeVar24) )
                    * clamp( nodeUniform10, 0.0, 1.0 ) ) ) ), 1.0 );
```

`max(int, 1.0)` has no GLSL ES 3.0 overload; WGSL is happy with it, so the WebGPU path never sees
it. The surrounding lines project a world point through a matrix, divide by `w`, map to `0..1`,
flip y and scale by a resolution uniform to get a pixel delta and a **ray-march step count** — that
is a screen-space reflection pass, not a surface material. `TN_WORLD_ENVIRONMENT` on the WebGL2
path reports `ssr` applied.

To reproduce without the capture lock (it is headless, and WebGL2 under SwiftShader is enough to
compile a shader): launch Chromium with `headless: true` and **no** `--enable-unsafe-webgpu`, wait
on `__TN_WORLD_REVEALED__`, and log console lines matching `/Shader Error|ERROR: 0:/`. three prints
the offending source with line numbers, which is what identified the pass.
