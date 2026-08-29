# Revenant Hall

A one-screen mini game. Revenants walk in from the far wall; **click one to banish it**. Send six
before one reaches you. Arrow keys move the warden.

```sh
pnpm dev
```

It exists to prove that PRD-247's three shipped helpers work in a real game loop, from a project
that installed ThreeNative from tarballs rather than from the monorepo:

| Helper | What the game asks of it | State the proof reads |
| --- | --- | --- |
| `Billboard3D` | Keep a flat quad square-on to a camera that pans and shakes, with `lockAxis: "y"` so a revenant never tips | `billboardFacingWorst` |
| `SpriteAnimator3D` | Run a four-frame walk on loop, then swap to a two-frame one-shot on the hit | `spriteAdvances` |
| `CameraShake` | Kick the rig on every banishing and settle fast, without the class ever touching the camera | `shakePeak` |

`ctx.pointer.on(revenant.mesh, "tapped", …)` (PRD-237) is what makes it playable at all — the
listener is on the revenant's own quad, and nothing in the frame loop asks whether the pointer is
over one.

Everything you can see is in `src/render/`: the atlas is drawn as bytes in `revenant.ts`, the walk
and banish frame durations are chosen there, and the shake's amplitude, frequency, decay and
waveform are in `camera.ts`. The packages contribute a transform, an atlas index and an offset.

## What the proof caught

Revenants first spawned from two alternating corners, which stacked them on top of each other from
this camera. The pointer then picked whichever quad was nearest — correct behaviour, and an
unplayable game: half of every six clicks banished something other than the thing under them. They
now spread along the back wall. The scenario assertions moved with it: the round asserts that six
were banished and the outcome reads `won`, not that click *n* hit revenant *n*.

```sh
pnpm exec threenative-playtest --scenario playtests/banish.playtest.json \
  --browser-recipe webgpu --headed \
  --server-command "pnpm dev --host 127.0.0.1 --port \$PORT --strictPort"
```
