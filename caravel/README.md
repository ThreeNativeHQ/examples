# Sailing starter

This starter is a bluewater passage: sail a caravel around a headland, rounding four marks in
order, before the wind dies. `SpectralOcean` runs cascaded wave spectra on the GPU and the drawn
sea reads the same cascade buffers the hull is floated on, so the water the ship rides is the water
you can see. `SoftBody3D` puts the wind in the sails. `src/entities/Ship.ts` is deliberately
ordinary game code, so handling, hull points, density, and course rules are easy to replace.

Controls: `W` sets the sails and `S` spills them, `A`/`D` put the helm over — arrow keys do the
same, and on a touch device the left stick does both. `C` is a capsize/fail test; `R` restarts.
Steer by the bearing arrow at the top right: the marks are thirty metres apart around a headland,
and the ship only ever makes way along its own bow.

## Rendering credit

The water render organization and shader ideas are adapted from
[VictorZakharov/beautiful-water](https://github.com/VictorZakharov/beautiful-water), released
under the MIT License. The adapted files are `src/render/ocean.ts` and `src/render/sky.ts`; the
gameplay, materials, palette, geometry, and ThreeNative integration are original to this starter.

## Commands

```sh
pnpm dev
pnpm build
pnpm typecheck
pnpm test
```
