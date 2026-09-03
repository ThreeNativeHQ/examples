# Lane D requests — changes needed in files lane D does not own

Lane D owns the light: `src/render/lighting.ts`, `sky.ts`, `sky-hdri.ts`, `postprocessing.ts`,
`worldEnvironment.ts`, `palette.ts`, `materials.ts`, `quality.ts`, `public/hdri/**`, and the new
`src/render/light/`. Everything below is in someone else's file and has been left alone.

## 1. `src/scenes/Valley.ts` — `sceneNoSky()` sets a fog that is now both dead and wrong

**Owner: lane A.** Around `sceneNoSky()`:

```ts
function sceneNoSky(scene: ThreeScene): void {
  scene.environment = null;
  scene.background = null;
  scene.fog = new Fog(0xd8d4cc, 110, 400);   // <- this line
}
```

`setupForestLighting` is called on the very next line of `enter()`, and it now installs the sky
and the aerial perspective together — a `FogExp2` at `palette.fog`, which is the measured horizon
colour of the HDRI that lights the scene. So that `Fog` is overwritten microseconds later and
never reaches a frame.

Requested change: **delete the `scene.fog` line**, keeping the two nulls.

```ts
function sceneNoSky(scene: ThreeScene): void {
  scene.environment = null;
  scene.background = null;
}
```

Not urgent — it is currently harmless. It matters because it is a second, disagreeing opinion
about the haze sitting one line away from the real one: `0xd8d4cc` is a warm grey and the sky it
would sit under is cool blue, so anyone who reorders these two calls gets a valley whose distance
is the wrong colour and no compiler complains.

**The ordering constraint is the real request:** `sceneNoSky()` must stay *before*
`setupForestLighting()`. It nulls `scene.background`, and the whole point of this pass is that
`setupForestLighting` puts a sky there synchronously so the first frame is not black.

## 2. Nothing else

`setupForestLighting()` and `setupPost()` keep their signatures and their call sites exactly as
they were. `setupSkyHdri()` keeps its three positional arguments; only its *defaults* changed
(environment intensity, rotation, and fog now match the sky that is already on screen), so
`stageHdri()` needs no edit.

## 3. A missing-texture marker is visible in the wood (lane B)

**Owner: lane B (`foliage.ts` / `public/fab/**`).** Not a lighting issue, but it is in a frame so
it should be written down rather than left for someone to find later.

`/tmp/lane-d-shots/sunward/view-1.png`, spawn `0,0,-2.168` looking SE at the sun: a magenta and
cyan chevron — the standard "texture failed to load" checker — occupies the top-left of the frame,
about 300x150 px, in the canopy. The camera in that shot is also standing inside a trunk, which is
a spawn-point artifact of that hand-picked position and not a defect; the checker is not.

Lane D did not investigate further: every material in that part of the frame is foliage, and the
lighting rig has no path to produce a two-colour checker.
