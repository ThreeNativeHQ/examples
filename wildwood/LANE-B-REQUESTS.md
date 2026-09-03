# Lane B (foliage) — changes requested in files lane B does not own

Lane B owns `src/render/foliage.ts`, the FAB imports, `threenative.config.ts` (asset config) and
`CREDITS.md`. Everything below needs an edit in a file another lane owns, so it is written here
rather than made.

## 1. `src/scenes/Valley.ts` (lane A) — the flora species list lives in the scene

`FLORA` (Valley.ts:72) is the only place the game names which pack GLBs to load, and `loadFlora`
(Valley.ts:801) is the only thing that loads them. `foliage.ts` receives the loaded `IFoliageSets`
and can slice it any way it likes, but it cannot ask for a mesh the scene did not fetch.

**Nothing is blocked by this today** — every mesh lane B wanted is already in `FLORA`, because
lane B's new layers re-use the imported pack at three sizes rather than adding species. It is
recorded because the moment a second vegetation pack imports (see `FRICTION.md` entry 8, which is
why one has not), adding it means editing Valley.ts, and a lane that owns the forest cannot do it.

**Requested, whenever convenient and not urgent:** move `FLORA` and `FAB` into `foliage.ts` as
exported constants and have `loadFlora` read them from there. The loader, the lease and the error
wrapping all stay in Valley.ts; only the list moves. Concretely:

```ts
// src/render/foliage.ts  (lane B would own this)
export const FLORA_ROOT = "fab/1ac647da-b1bc-4e72-a56d-60aaeb6918e1/Models";
export const FLORA: Record<keyof IFoliageSets, readonly string[]> = { /* as today */ };

// src/scenes/Valley.ts
import { FLORA, FLORA_ROOT } from "../render/foliage.js";
```

No behaviour change, no signature change to `loadFlora`, and `createFoliage`'s contract is
untouched.

## 2. Nothing else

Lane B made no other change outside its own paths. Density, species selection, scatter rules,
counts and the four reported totals are all inside `foliage.ts`; `createFoliage(extent, clearing,
sets)` and the `{ meshes, treeCount, fernCount, grassCount, boulderCount, trunks }` it returns are
exactly as they were.

One behavioural note for lane A, in case a capture looks slow: `hideFoliageNearLandmarks`
(Valley.ts:1138) walks every instance of every foliage mesh. Lane B took the instance count from
~12,600 to ~38,000, so that walk is now ~38,000 iterations x 5 landmarks once at detail time. It
measured as noise against the GLB loads and needs no change; it is only worth knowing that it
scales with density.
