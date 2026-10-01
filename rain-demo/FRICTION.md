# FRICTION — rain-demo (Storm Chaser on the Tempest kit)

Built 2026-10-01 as a cold game: `--template rain` from locally packed tarballs
(`sandbox/.packages/rain/*-rain-<sha>.tgz`), no workspace link. The round (`src/chase.ts`), its HUD
(`src/ui/ChaseHud.tsx`) and its markers (`src/render/beacons.ts`) are game code; everything else is the
kit as scaffolded.

| # | Friction | Layer | Resolution |
| --- | --- | --- | --- |
| 1 | `engine_search_capabilities("countdown timer that ends the round")` returned `TracerPool3D`, not the engine's `Scheduler` (`ctx.after`). | engine manifest | Fixed in the engine (feat/rain): `Scheduler` gains the situation, and capability recall gains row `rain.round-time-limit` (red: missed, green: `Scheduler` first). |
| 2 | Nothing told me where gameplay attaches to the study: which function every strike passes, and where per-step rules belong. | template docs | Fixed in the engine (feat/rain): the rain kit's `AGENTS.md` names `strike()` in `Boot.ts`, the frame function and a `GameState` field. This copy predates it. |
| 3 | `pnpm build:desktop` fails at its last step: `Prebuilt release manifest fetch failed for 'linux-x64' … runtime-native-v0.3.4/prebuilt-lock.json: HTTP 404`. The JS bundle and the UI are written first, so the native playtest ran against the engine checkout's locally built `mystral` host. | engine release | Not fixable in a lane: the prebuilt release for 0.3.4 is not published. Recorded, not worked around in game code. |
| 4 | The round's clock ran during the loading curtain (75 s became 74 s before the player could move). | game | Fixed in `Boot.ts`: the clock steps only once `state.loading.ready`. |
| 5 | A trigger zone without physics: `Area3D` needs `@threenative/physics`, which the rain kit does not install. | game (by design) | Waypoints and shelters are ground-distance checks in `src/chase.ts`; one comparison each, no physics world for a free-fly camera. |

What worked first time: `Billboard3D` with `lockAxis: "y"` for the light pillars, the kit's published
`GameState` + intent door for the HUD and its restart button, and the kit's playtest observations
(`chase.*` resources at labelled steps) on both the browser and the native desktop host.
