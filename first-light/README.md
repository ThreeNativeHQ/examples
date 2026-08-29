# First Light

Stand on the spur and fire the signal mirror while the sunlight is in the golden band. Three shots.
Arrow keys walk the ridge, **Space** fires.

```sh
pnpm dev
```

## Features this validates

| Mined feature | PRD | What the game asks of it | State the proof reads |
| --- | --- | --- | --- |
| `Atmosphere` — `sunTransmittance()` | 248 | **The win condition.** `TONE` is the colour sunlight arrives in after the air has taken the blue out of it, straight from the model. The golden band is a range on that number, not a clock | `warmth`, `bestShot`, `outcome` |
| `Atmosphere` — `radiance()` | 248 | The sky dome's colour, and the sun disc the game draws for itself | `skyRadianceRed` |
| `Atmosphere` — `aerialPerspective()` | 248 | Four mountain ranks at kilometre scale so distance has something to do. The far ranks wash out; the near ones stay dark | visible in the capture |
| `solarPosition()` | 248 | Where the sun is at 49.28°N on day 172, hour by hour | `sunElevation` |

The atmosphere **creates no mesh, no material and no light**, which is the point of its contract —
so the sun disc, its size, its glow and the sky dome are all in `src/render/`, and every frame the
disc's colour is set from the model's own transmittance. Delete the atmosphere and the disc has
nothing to wear and there is no number to fire on.

## What the proof caught

The sun spent four iterations invisible. The assertions were green the whole time — `warmth` moved,
`skyRadianceRed` moved, the scenario passed — and the capture showed a plain blue sky. Guessing at
exposure and sky brightness fixed nothing.

Instrumenting the disc's actual position ended it in one run:

```
sunDiscY  before 6343.11   after -6471.98      (at a 7 km radius)
```

The sun was swinging overhead and then underground. The game had rebuilt the sun vector from
`solarPosition().elevation` by hand and got the convention wrong; the sky looked plausible
throughout because the atmosphere was being handed a direction it had no reason to doubt. **Read
the model's `getSunDirection()`; do not re-derive it.** Only the compass bearing is the game's
choice, and it is applied by rotating the model's vector, not by rebuilding it.

```sh
pnpm exec threenative-playtest --scenario playtests/first-light.playtest.json \
  --browser-recipe webgpu --headed \
  --server-command "pnpm dev --host 127.0.0.1 --port \$PORT --strictPort"
```

Red control: forcing `webgpu = false` so no atmosphere is built drops `warmth`, `skyRadianceRed`
and `bestShot` to 0 and the outcome never leaves `playing`. Exit 1.
