# CREDITS-ANIMALS.md — animal assets in wildwood

The animals in `assets/fab/2dd7964c-a601-4264-a53d-465dcae1644c/` were **intended** to come from
the Fab listing [ANIMAL VARIETY PACK](https://www.fab.com/listings/2dd7964c-a601-4264-a53d-465dcae1644c)
by PROTOFACTOR, INC. That route was closed on 2026-09-01:

- The listing is paid (Personal / Professional, neither free) and the signed-in Fab account does
  not own it (`fab_list_owned` empty; `fabcli` reports `auth_required`).
- PROTOFACTOR's own Sketchfab uploads of these animals (fox `c037ff9b…`, wolf `2cddc5b9…`,
  stag `1150d94d…`, doe `62bf8fde…`, pig `38dcae26…`, crow `939c070a…`) are all
  `downloadable: false`, so the API cannot serve their files.
- Third-party Sketchfab re-uploads labelled "protofactor" under CC-BY are game rips of the paid
  pack and were **not** used.

## What is actually in the folder

All five animals are by **Quaternius** ([quaternius.com](https://quaternius.com)), downloaded from
Poly Pizza ([poly.pizza](https://poly.pizza)), which hosts the Quaternius "Animated Animal Pack"
and "Farm Animal Pack" bundles.

> License, as stated by Poly Pizza for every model in both bundles: **"Licence: Public Domain
> (CC0)"** — i.e. CC0 1.0 Universal, "no copyright reserved". The Quaternius site states the same
> pack is "Free for personal and commercial use" under CC0.

| File | Model | Source page |
| --- | --- | --- |
| `fox.glb` | Fox | https://poly.pizza/m/Bc97C66HKi |
| `wolf.glb` | Wolf | https://poly.pizza/m/P1gU3Qkr9r |
| `stag.glb` | Stag | https://poly.pizza/m/tQdzbZ1Cmw |
| `doe.glb` | Deer | https://poly.pizza/m/T6Cs7tmMHJ |
| `pig.glb` | Pig | https://poly.pizza/m/TNvG3QUFlp |

The crow from the original pack could not be substituted: Poly Pizza's crow is "Poly by Google"
under **CC-BY** (not CC0) and is a static OBJ conversion with no rig or animation, so it was left
out rather than shipped unanimated.

## Processing

Each GLB was passed through
`npx @gltf-transform/cli optimize raw/<name>.glb <name>.glb --compress meshopt --flatten false
--join false --instance false --simplify false --vertex-layout separate` so the vertex layout is
non-interleaved, which `THREE.WebGPURenderer` requires to create render pipelines.
