# Bayview town layout — build direction

Derived from `references/` (map overview, in-game screenshots, stucco/brick photos).
Coordinates: **+x = east** (B site, sea), **+z = south** (T spawn), player forward is **−z**.
One metre is one metre; heights are world-space deck Y.

## Ground plan

Playable deck **84 m × 84 m**: x ∈ [−42, 42], z ∈ [−42, 42]. Sea east of x = +42.
Dock pier runs from B site out into the water at the north-east waterfront.

| Area | Extent | Notes |
| --- | --- | --- |
| CT SPAWN | x ∈ [−2, 16], z ∈ [−40, −30] | north courtyard, player-safe start for defenders |
| CT RAMP STAIRS | x = 3 ± 1.6, z ∈ [−30, −22] | stepped stairs, deck y=0 up to back-plat level y=2.4 |
| BACK PLAT | x ∈ [0, 12], z ∈ [−22, −10] | raised deck y=2.4 over mid's north face; guard rails on open edges (visual only) |
| HEAVEN | x ∈ [20, 30], z ∈ [−30, −20] | high platform y=4.8 over B site's back; rails visual-only; stairs from back plat at z=−25 |
| CATWALK | x ∈ [23.7, 26.3], z ∈ [−16.3, −1.7] | bridge y=2.4 from back plat SE corner toward B site, side rails, stairs down to B deck at its south end |
| MID | x ∈ [−8, 10], z ∈ [−8, 8] | central courtyard, pale-tinted plaza slab |
| CONNECTOR | x ∈ [10, 16], z ∈ [0, 10] | lane linking mid to B site between ME1 and TE2 street walls (open both ends) |
| A SITE | x ∈ [−36, −20], z ∈ [−8, 10] | west plaza, warm sand tint, painted marker **A** |
| SHORT A / T MAIN | diagonal lane (−16, 10) → (−7, 18) → (0, 26) | junction square at x ∈ [−12, 2], z ∈ [4, 17] furnishes it |
| T SPAWN | x ∈ [−9, 9], z ∈ [26, 38] | south courtyard, warm tint, player spawns here facing north |
| SOUTH CORRIDOR | x ∈ [9, 37], z ∈ [26, 32] | east artery from T spawn to outside long (6 m wide) |
| OUTSIDE LONG | x ∈ [30, 37], z ∈ [4, 28] | long eastern lane along the water to B site |
| PROMENADE / DOCK | x ∈ [30, 42], z ∈ [−16, 4] | quay walk + dock plaza (pale tint); pier crosses the quay gap at z ∈ [−8.2, −3.8] |

Everything not listed as a lane or plaza is a building block: **30 contiguous
whitewashed boxes** (plaster texture) forming continuous street walls along every lane,
heights 5–9.2 m stepping between neighbours, some with exposed-brick finishes (peeling
plaster-over-brick texture), slim towers at the A-site corner (9.2 m) and mid-east gate
(7.5 m), setback upper storeys on ~8 buildings. Every roofline carries a four-wall parapet
plus deterministic rooftop clutter (water tanks on legs, AC units, antenna masts with
crossbars, vent pipes, skylights). Lane-facing faces (`j:` list per building) receive blue
doors with stone doorsteps, shutter pairs over sills, upper-floor balconies (slab +
railing bars) and striped or plain canvas awnings — all placed by a fixed coordinate hash
so replays render identically. The perimeter (west/north/south) is fully walled; the east
edge is open water with quay wall, bollards, pier rails and shallow-water strip.

## Props

- Wooden crate stacks clustered against walls and on sites: A ×3 clusters, B ×4, mid ×2,
  T spawn ×1, junction ×2, outside long ×2, dock ×1; singles on back plat and heaven.
- Barrels beside most crate clusters.
- Palms (tapered trunk + two drooping frond whorls) line the promenade and soften plazas.
- Painted site markers: flat red ring + extruded flat letter (**A**, **B**) from box geometry —
  no CanvasTexture under WebGPU.
- Blue doors/shutters: thin proud boxes with plasterTrim doorstep/sill courses.
- Scoring plates: salmon face, struck face, dark frame; plate #3 stands free at (0, 1.6, 9.9)
  facing south (+z), straight ahead of the T-spawn view like the reference frame.

## Elevation

- Back plat y=2.4 (slab 0.4 thick): stairs down to mid (south face, x=5) and CT ramp up
  from the north-west (x=3); visual-only guard rails on every open edge (no colliders, so
  traversal and ballistics are unchanged for playtests).
- Heaven y=4.8: stairs from back plat south face (x 17.5→20 at z=−25).
- Catwalk y=2.4: bridge planks on posts; stairs down to B deck at its south end (x=25).
- Stairs use stepped colliders (positive-size guard skips the final descending step).

## Gameplay

- Player spawns T spawn centre (0, eyeHeight, 32), yaw facing −z (north into town).
- Timer **105 s** (the reference HUD reads 1:45).
- Same scoring contract as the range: plates and enemy kills score; **11 hits**
  completes the run; health 0 or timeout fails it.
- Targets across callouts: A ×2, mid ×2, B ×2, catwalk/heaven ×1 high,
  outside ×2, T main ×1.
- Five patrolling soldiers, one per route:
  - Mid defender: mid ↔ connector ↔ B site.
  - West rover: A site ↔ short A ↔ T main ↔ T spawn edge.
  - Waterfront rover: outside long ↔ B site ↔ dock head.
  - North rover: CT yard ↔ beneath the back plat ↔ mid north face.
  - South rover: T spawn ↔ mid south ↔ connector south.
- Enemy nav grid covers the whole playable deck (±42 m); all route straight segments
  keep ≥1 m clearance from new solids.

## Renderer requirement

**WebGPU is preferred, not required. A WebGL2 fallback exists for this map and it
works.** Verified 2026-08-22 rather than assumed, because the source used to imply
otherwise:

- `@threenative/core`'s `createRenderer` tries `WebGPURenderer` when
  `preferWebGPU` is set and the host exposes `navigator.gpu`, and **silently falls
  back to `WebGLRenderer` (webgl2) if construction or init throws**
  (`core/dist/index.js`, `createRenderer`/`wrapRenderer`). `threenative.config.ts`
  `renderer.preferWebGPU: true` therefore means "WebGPU when the host offers it",
  not "WebGPU or nothing".
- Forced onto the webgl2 path (shadowing `navigator.gpu` in a headed Chromium),
  the map **boots and renders correctly**: townMaterials.ts'
  `MeshStandardNodeMaterial` + TSL world-projection draws on three 0.185's
  WebGL2 backend — textures, triplanar walls, soldier, viewmodel, shadows and
  ACES tone mapping all present in the capture. Screenshot evidence taken during
  verification; the canvas reports `webgl2: true, webgpu: false` there.
- The one historical hard refusal is gone: `postprocessing.ts` no longer calls
  `renderer.setOutputNode` (which `@threenative/core` throws on for non-webgpu
  kinds). Nothing in `src/` calls it any more. If it ever comes back, it must be
  gated on the backend kind.

What *is* still required either way: a real GPU context. Headless Chromium on this
host renders a black canvas under both backends — that is a capture-environment
fact, not a backend-selection fact (see CLAUDE.md "How to actually look at it").

## HUD direction

Toward the reference screenshots: round timer top-centre in `m:ss`; minimap
circle top-left (static schematic + dots from state); health bottom-left;
ammo big-number right-middle; objective text below the timer; crosshair,
hitmarker, damage vignette and key legend unchanged.

New state fields (additive, JSON-shaped): `playerX`, `playerZ`, `playerYaw`,
`blips: { x, z, alive }[]`.

## Asset credits

Weathered plank set for crates/decks/pier: Poly Haven "Brown Planks 03" (CC0) — see
`CREDITS.md`.
