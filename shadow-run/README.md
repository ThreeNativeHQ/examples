# Shadow Run

Cross the yard to the lit door without being caught in the open. Standing in sunlight fills the
**HEAT** meter; standing in shadow drains it. Reach the door before it hits 100. Arrow keys move,
the wheel (or a two-finger pinch) pulls the camera back so you can plan a route.

```sh
pnpm dev
```

## Features this validates

| Mined feature | PRD | What the game asks of it | State the proof reads |
| --- | --- | --- | --- |
| `GPUSceneBVH` | 244 | The dark on the ground **is** the trace. Every ground fragment fires a ray at the sun through the packed snapshot; a hit is shadow. Not a shadow map, not a blob — the same occlusion question the CPU asks for the runner | `inShadow`, `bvhRebuilds` |
| `GPUSceneBVH.rebuild()` | 244 | The shutter slides, so the snapshot has to be told. It repacks at each end of the travel and the safe ground moves with it | `bvhRebuilds` |
| `IComputeDriven` | 242 | `GPUSceneBVH` implements it and joins the shared compute lifetime through `ctx.add` — no second registry, no private loop | attach is a precondition of the above |
| Portable zoom axis | 239 | One `input.axis("zoom")` reads the wheel on a desktop and a pinch on a phone. The rig has no platform branch | `cameraDistance` |

The rule and the picture come from the same geometry, which is the point. `src/render/contact.ts`
fires the GPU ray per fragment; `Play.ts` fires one CPU ray from the runner along the same `SUN`
vector at the same blocks. If they disagreed you would see it immediately — you would be burning
while standing in something that looks like shade.

Everything visible is in `src/render/`: the yard layout is placed by hand because the route through
it is the level design, and the two ground colours, the sun vector, the palette and the camera
range are all chosen there.

## What the proof caught

The first pass was unwinnable and the yard was blown out white. Two real fixes came out of it: the
sun was too high for cover to throw usable shadow (`0.55` elevation → `0.3`), and the burn rate
gave under three seconds of exposure across an eighteen-metre yard. Neither was visible from the
assertions alone — both came from looking at the capture.

```sh
pnpm exec threenative-playtest --scenario playtests/crossing.playtest.json \
  --browser-recipe webgpu --headed \
  --server-command "pnpm dev --host 127.0.0.1 --port \$PORT --strictPort"
```
