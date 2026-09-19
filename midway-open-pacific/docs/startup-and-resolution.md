# Startup cost and resolution degradation

Two user reports, investigated read-only. Nothing in this document changes code; the only
deliverable is this file.

- **A. Startup takes many seconds.** The launch playtest reports readiness at 7.1–8.0 s. The
  reported split is `loadStartedMs ≈ 700`, `enteredMs ≈ 4100`, `compileSettledMs ≈ 8000`.
- **B. Resolution deteriorates over time.** Already triaged as an engine defect. Recorded below,
  with a precision note where the installed bytes disagree with the original triage.

The machine was heavily loaded while this was written (load average ≈ 14, ~280 node processes), so
**no new timing was taken**. Every millisecond below is the playtest's own reported number, not a
figure I measured. Numbers I did measure (bytes, triangles, materials, grep counts, line numbers)
are identified as such.

---

## Resolution degradation

### As triaged

After `dwellWindows` (default 2) consecutive over-budget windows, the engine steps the render tier
one rung down — `high → medium → low → off` — and there is no path back up. A single transient slow
patch therefore degrades the render permanently for the session. This is an engine defect, not a
game defect, consistent with the user seeing it in other ThreeNative games. The fix belongs in
`@threenative/core`, **not** in this game, and game code must never patch `node_modules`.

### Verified against the installed bytes

The grep evidence in the triage reproduces exactly, but the symbol it names is not in the class the
triage names. Confirmed with the commands below against `node_modules/@threenative/core` version
**0.3.2** (`threenative-core-0.3.2-ripple-ab8fc2af66ab.tgz`):

| Check | Command | Result |
|---|---|---|
| Downward step count | `grep -c nextLowerTier node_modules/@threenative/core/dist/index.js` | **2** |
| Upward counterpart by name | `grep -c -i "nextHigherTier\|nextUpTier\|raiseTier\|higherTier" …` | **0** |
| `nextLowerTier` definition | — | line **7483** |
| `nextLowerTier` call site | — | line **7230**, inside `RenderChain.observeFrameBudget` |
| One-way ratchet condition | `#overBudgetWindows >= #dwellWindows` | line **7228** |
| Class named by the triage | `ResolutionScaler` | class begins near line **8052** |

What the bytes say:

- The **one-way ratchet is real**, but it lives in **`RenderChain`**, not `ResolutionScaler`. Its
  `observeFrameBudget` increments `#overBudgetWindows` on an over-budget window, resets it to zero
  otherwise, and after `#dwellWindows` (default 2) calls `nextLowerTier` with no inverse anywhere
  in the file (grep counts 2 and 0 above). The tier names `high → medium → low → off` in the
  triage are `RenderChain`'s tier vocabulary, not `ResolutionScaler`'s.
- `RenderChain.observeFrameBudget` returns immediately unless the chain was constructed with
  `request.tier === "auto"` (line 7039). The game does not request `tier: "auto"` in
  `threenative.config.ts`, and no `RenderChain` is created in `src/`, so this ratchet is **dormant**
  in this game.
- The class actually named — `ResolutionScaler` — **does have an upward path**: after
  `upWindows: 4` clean windows it calls `#step(-1)` (the clean-window check is at line 8139). It
  also has an oscillation guard that, after repeated direction changes across one boundary, sets
  `#scaleSource = "auto-pinned"` (line 8213) and then ignores every further window (line 8114) —
  a permanent pin.
- `threenative.config.ts` sets `renderer.resolutionScale: "auto"`, so `ResolutionScaler` **is** the
  live resolution controller here (`surface().scaleSource === "auto"`).

**Net:** the substance of the report — an engine-side controller that can degrade and not give it
back — is confirmed to exist in the *tier* path (`RenderChain`, `nextLowerTier`, no upward
counterpart). The class name and line number in the original triage point at `ResolutionScaler`
instead. The two are different classes with different vocabularies, and only one of them has an
upward path. Per the instruction not to re-investigate B, this is recorded as-is; the precise
class to fix should be confirmed before the core change, because the fix differs:

- **If the symptom is the tier ratchet (`RenderChain`):** add a recovery path that raises the tier
  after sustained under-budget windows (mirror of the `#dwellWindows` counter, e.g. an
  `#underBudgetWindows` counter and a `nextHigherTier`), with hysteresis so a tier cannot oscillate
  across a boundary — require the up-window count to exceed the down-window count and debounce the
  step, the same way `ResolutionScaler` already does with `upWindows: 4` and its oscillation guard.
- **If the symptom is `ResolutionScaler`:** the recovery exists; the permanent degradation would be
  the `auto-pinned` oscillation guard (line 8213). A fix would make that pin reconsiderable after a
  long run of over-budget-free windows rather than latching for the session.

Either way the change is in `@threenative/core`; this game must not route around it.

---

## Startup cost

### What is loaded eagerly

`src/scenes/Midway.ts` `load()` awaits seven loaders in one `Promise.all`
(`Midway.ts:46-57`). Every GLB these loaders request is fetched and parsed **before** `enter()`
runs, then `enter()` synchronously builds the world (`Midway.ts:63-81` → `new WorldView` in
`src/render/world.ts:231`). The eager surface, with the measured bytes and geometry:

| Loaded by | File | Bytes | Triangles | Materials | Images | Referenced? |
|---|---|---:|---:|---:|---:|---|
| `loadImportedAircraft` | aircraft.douglas-sbd3.glb | 13,489,304 | 10,416 | 21 | 61 | yes — player SBD + AI |
| — (ported `makeDevastator`) | aircraft.tbd-devastator.glb | 12,990,788 | 274,771 | 4 | 3 | asset only — checks read its span/clips/parts; the drawn player TBD is the ported airframe |
| — (ported `makeDevastator`) | aircraft.tbd-devastator.ai.glb | 9,709,080 | 186,403 | 4 | 3 | asset only — checks read it; the drawn AI/parked TBD is the ported cheap build |
| `loadImportedAircraft` | aircraft.b5n2-kate.glb | 1,375,712 | 12,653 | 1 | 3 | yes — AI/parked Kate |
| `loadImportedFleet` | aircraft.mitsubishi-a6m3.glb | 991,908 | 14,540 | 10 | 8 | yes — AI/parked Zero |
| `loadImportedShips` | hornet.glb | 26,767,784 | 347,281 | 75 | 73 | yes — Enterprise **and** Hornet |
| `loadImportedShips` | akagi.glb | 27,586,032 | 246,563 | 36 | 33 | yes — Akagi |
| `loadImportedShips` | **b25-mitchell.glb** | **2,961,056** | 25,910 | 9 | 19 | **NO — `createMitchell` never called** |
| `loadImportedFleet` | **destroyer.samidare.glb** | **11,446,096** | 26,032 | 11 | 23 | **NO — `createSamidare` never called** |
| `loadImportedFleet` | midway-atoll.glb | 10,776,812 | 9,768 | 1 | 2 | yes |
| `loadImportedFleet` | structures.garrison-camp.glb | 3,549,464 | 1,182 | 9 | 5 | yes |
| `loadImportedFleet` | structures.radar-station.glb | 2,795,384 | 514 | 5 | 4 | yes |
| `loadImportedHulls` | carrier.kaga.glb | 2,291,676 | 45,683 | 1 | 3 | yes |
| `loadImportedHulls` | carrier.soryu.glb | 1,842,532 | 23,605 | 1 | 3 | yes |
| `loadImportedHulls` | carrier.hiryu.glb | 2,021,532 | 23,421 | 1 | 3 | yes |
| `loadImportedHulls` | carrier.yorktown.glb | 13,223,756 | 199,999 | 1 | 3 | yes |
| `loadImportedHulls` | cruiser.tone.glb | 2,748,776 | 47,991 | 1 | 3 | yes — Tone + Chikuma |
| `loadImportedHulls` | cruiser.mogami.glb | 2,870,932 | 51,311 | 1 | 3 | yes — Mogami + Mikuma |
| `loadImportedHulls` | destroyer.kagero.glb | 2,076,424 | 22,650 | 1 | 3 | yes — Arashi + Nowaki |
| `loadImportedHulls` | destroyer.hammann.glb | 2,151,720 | 22,887 | 1 | 3 | yes |
| `loadImportedHulls` | submarine.i168.glb | 1,948,264 | 23,243 | 1 | 3 | yes |
| `loadImportedHulls` | submarine.nautilus.glb | 2,068,392 | 22,967 | 1 | 3 | yes |
| `loadImportedHulls` | **weapon.torpedo.glb** | **1,683,296** | 24,856 | 1 | 3 | **NO — `createTorpedoBody` never called** |
| `loadDeckCrew` | deck-crew.glb | 3,119,900 | 38,992 | 1 | 3 | yes |
| `loadEnvironment` | dawn-sky.hdr | 4,978,718 | — | — | — | yes |
| `loadEnvironment` | ocean-normal.png | 470,966 | — | — | — | yes |
| `ensureCockpitMaterials` (via `loadImportedAircraft`) | public/assets/cockpit/ (47 files) | 12,674,751 | — | — | 47 | yes — cockpit view only |
| `Soundscape.load` | public/assets/audio/*.ogg (top level) | 5,483,734 | — | — | — | yes |
| `Soundscape.load` | public/assets/audio/voice/*.ogg (56 files) | 3,261,461 | — | — | — | yes |

**Total measured eager bytes: 189,356,250 (≈ 180.6 MiB)**, of which the 24 eagerly loaded GLBs are
162,486,620 bytes (≈ 155.0 MiB). The game ships 29 GLBs totalling 178 MiB; the four not loaded are
`boat.pt59.glb`, `enterprise.glb`, `flight-deck-director.glb` and `carrier-aircraft-pilot.glb`
(confirmed absent from every `/assets/` reference in `src/`), so they cost nothing at startup.

### Loaded-but-unused assets (verified by grep, not assumed)

Two were named as suspects; there are **three**, and one named suspect is in fact used.

- **`destroyer.samidare.glb` — unused.** Requested at `src/render/imported-fleet.ts:75`, but
  `createSamidare` (`imported-fleet.ts:142`) is defined and never imported or called. Arashi and
  Nowaki use the Kagero hull (`world.ts:99-100`, `HULL_CLASS_BY_NAME`), so the Samidare is not
  reached. **11,446,096 bytes, 26,032 triangles.**
- **`b25-mitchell.glb` — unused.** Requested at `src/render/imported-ships.ts:27`, but
  `createMitchell` (`imported-ships.ts:131`) has no caller. The battle roster (`src/sim/battle.ts`
  ~line 805-820) contains no B-25. **2,961,056 bytes, 25,910 triangles.**
- **`weapon.torpedo.glb` — unused.** Requested in `HULL_URLS` (`imported-fleet.ts:246`), but its
  only consumer, `createTorpedoBody` (`imported-fleet.ts:316`), is never called. The torpedo the
  game actually draws is procedural: `makeTorpedoModel()` in `src/render/model-damage.ts:135`
  builds it from ellipsoids and boxes and never touches the GLB. **1,683,296 bytes, 24,856
  triangles.**
- **`cruiser.mogami.glb` — used.** The named suspect is reached:
  `SHIP_MODELS.mogami` → `createMogamiCruiser` (`imported-ships.ts:117,294`); `world.ts:97-98` maps
  Mogami and Mikuma to the `mogami` class; `battle.ts:290-291,819-821` adds both ships. Do not drop
  it.

Removing the three unused assets saves **16,090,448 bytes (≈ 15.3 MiB)** and **76,798 triangles**
of eager download, parse and GPU upload, with no visual change — they are never instantiated.

### The measured phase split

`loadStartedMs` is stamped immediately before `scene.load()`; `enteredMs` immediately after
`#enterScene()` returns; `compileSettledMs` when the first-use compile gate and stable-frame window
resolve (`node_modules/@threenative/core/dist/index.js:10161-10191`, `9830-9864`). So the phases are:

| Phase | Window (reported ms) | Duration | Dominated by |
|---|---|---:|---|
| Navigation → load start | 0 → 700 | 0.7 s | framework bootstrap, UI, module evaluation |
| **Asset load + world build** | 700 → 4100 | **≈ 3.4 s** | `scene.load()` fetch/parse/decode of ~180 MiB, then synchronous `Battle` + `WorldView` construction |
| **First-use compile** | 4100 → 8000 | **≈ 3.9 s** | `warmUpScene` pipeline compilation plus the stable-frame window |
| Readiness | 7100 → 8000 | — | `compileSettledMs` and `readyMs` coincide in the reported run |

They have completely different fixes, and the reported numbers do not separate fetch from parse
inside phase 1, nor pipeline count from compile wall-time inside phase 2. What can be said from the
bytes and call structure:

- **Phase 1 is asset volume plus synchronous construction.** `load()` awaits every loader before
  `enter()`, and `enter()` builds all seven carriers (with per-carrier LOD clones of the imported
  hulls), nine-plus non-carrier hull clones, the atoll clone with its per-triangle
  `trimBelowSea` pass, the deck park, twelve `SkeletalMesh3D` deck crew, the ocean, ripples and
  particles — all before `enteredMs`.
- **Phase 2 is pipeline count.** The eager GLBs alone carry **≈ 198 distinct materials** (≈ 178
  excluding the unused Samidare and Mitchell); `hornet.glb` contributes 75 and `akagi.glb` 36 on
  their own. The cockpit adds ~30 more materials and the TSL ocean/sky/particles add their node
  pipelines, and shadow maps are enabled, which multiplies material variants. Each distinct
  material is a WebGPU pipeline to build.

### Specific candidates

1. **Stop loading the three unused assets** (risk-free, ≈ 15.3 MiB): remove
   `destroyer.samidare.glb` and `structures.*`'s sibling from `loadImportedFleet`, remove
   `b25-mitchell.glb` from `loadImportedShips`, and remove `weapon.torpedo.glb` from `HULL_URLS` —
   or, better, delete the dead `createSamidare`/`createMitchell`/`createTorpedoBody` exports so a
   future reader cannot re-add the load by mistake. This is the only candidate with no tradeoff.
2. **Compress/decimate the overweight airframes.** The two TBD builds are extreme for a single
   airframe: **274,771** triangles (hero, 13.0 MiB) and **186,403** (ai, 9.7 MiB), against the Kate
   at **12,653**. `carrier.yorktown.glb` is 199,999 triangles for a hull that hands back to the
   procedural silhouette at 1200 m (`world.ts:323`). A lower simplify budget on the TBDs and
   Yorktown addresses phase-1 parse and phase-2 pipeline cost at once; it is a visual trade, so it
   needs a capture before acceptance.
3. **Defer assets the briefing never shows.** The briefing view is the player's SBD on the home
   carrier plus the atoll; the imported hull for any ship is only drawn inside its LOD range
   (`world.ts:288-323`: carriers 1200 m, cruisers 2200 m, destroyers 2600 m, subs 1300 m), so at
   the briefing the enemy capitals ~15–25 km away are procedural silhouettes and their GLBs are
   parsed but not drawn. Candidates that could stream after the first frame without changing the
   briefing: the **player TBD hero build** (13.0 MiB, only needed once the torpedo loadout is
   selected), the **cockpit texture set** (12.1 MiB, only needed when the pilot view is entered),
   the **Zero and Kate** (2.4 MiB, enemy-only, appear later), the **enemy hulls** (akagi 27.6,
   tone 2.7, mogami 2.9, kaga 2.3, soryu 1.8, hiryu 2.0, kagero 2.1, i168 1.9 ≈ 43 MiB), and the
   **atoll structures** (6.3 MiB, only notable near Midway). This is the largest single lever
   (≈ 75 MiB) but it is **not free**: it needs streaming plumbing and risks a visible pop or a
   parse hitch when the player first approaches, so it is a design decision, not a one-line
   change. It is listed as a candidate, not a recommendation.

---

## What was measured versus assumed

**Measured (commands run in this session):**

- Byte sizes: `ls -la public/assets/*.glb`, `du`, and a Node `statSync` sum of the eager set —
  total **189,356,250 bytes**; unused subset **16,090,448 bytes**.
- Per-file triangles, materials and images: `node tools/inspect-glb.mjs <file>` for all 24 eager
  GLBs.
- Referenced-versus-not: `grep` for `createSamidare`, `createMitchell`, `createTorpedoBody`,
  `makeTorpedoModel`, `createMogamiCruiser` and the `/assets/` loaders across `src/`; the battle
  roster read from `src/sim/battle.ts`.
- Resolution facts: `grep -c nextLowerTier` → **2**, upward-counterpart grep → **0**; line numbers
  from `grep -n`; the phase semantics read from `core/dist/index.js:10161-10191` and `9830-9864`;
  the class layout of `RenderChain` (~7225) and `ResolutionScaler` (~8052); the game's
  `threenative.config.ts` `resolutionScale: "auto"`.
- Eager load order: `src/scenes/Midway.ts:46-57`, and each loader's `ctx.assets.model` call sites.

**Not measured — inferred or reported, not to be quoted as this session's measurement:**

- The **phase timings** (`loadStartedMs ≈ 700`, `enteredMs ≈ 4100`, `compileSettledMs ≈ 8000`,
  `ready ≈ 7.1–8.0 s`) are the playtest/user's reported numbers. I did not re-run a browser gate;
  the host is loaded (~14 load average, ~280 node processes) and any timing taken now would be
  contaminated.
- The split of phase 1 into "network fetch" versus "parse/decode/world-build" is **not separated**;
  the ~3.4 s is one combined window. A conclusion that download dominates, rather than synchronous
  `WorldView` construction, would require instrumentation the bytes cannot provide.
- The claim that ≈ 198 materials drive the ~3.9 s compile is an **inference** from the measured
  material counts, not a profiled pipeline count. No `pipelineCensus` was read.
- The deferral candidates assume the briefing camera sees only the home carrier and the atoll, and
  that enemy imported hulls sit beyond their LOD range at their `battle.ts` start positions; this is
  read from `world.ts` LOD ranges and the roster coordinates, **not** confirmed against a live
  briefing frame.
- `cruiser.mogami.glb` is marked used on the strength of the code path
  (`imported-ships.ts:117` → `imported-fleet.ts:294` → `world.ts:97` → `battle.ts:819`); no runtime
  trace was taken.

---

## The launch flow, leg by leg (2026-09-19)

A CDP CPU profile from before navigation to the intro screen, with self time bucketed by the game's
own `TN_LOAD_STEP` marks, so each leg is attributed rather than pooled. One run, 1280×720, WebGPU
(`nvidia/turing`), machine load ≈ 21 from other work — the legs below are compared within a run,
which is why the two fixes are quoted as leg deltas and not as totals.

| leg | before | after | what is in it |
| --- | ---: | ---: | --- |
| page → scene loaded | 5072 ms | 4598 ms | three's GLTF parse (hottest lines `GLTFLoader:1743`, `:1613`), `createImageBitmap`, 146 Ogg decodes, HDR |
| scene loaded → `enter()` | 3141 ms | **1731 ms** | the rear station (924 ms of procedural texture + geometry, plus ~650 ms of attribute conversion it drives), ocean hash, scene assembly |
| `enter()` → `ready` | 2366 ms | **1575 ms** | texture uploads (`_copyImageToTexture` 219 ms), TSL node builds (102 ms), world matrices, bone binding |
| `ready` → intro screen | 2.8 s | **25 ms** | the warm-up, which used to run between the briefing being shown and its first paint |
| **to the intro screen** | **11.0 s** | **7.9 s** | |

Both fixes are in `d901f20`:

- The rear station is built on first need (`ensureRearStation`), not in `buildPlayerAirframe`. It is
  only visible while the gun owns the view, and its own code was the largest single main-thread cost
  the launch had after the assets.
- `warmUpViews` is deferred past a task boundary after the briefing is made visible, so the screen
  the player is waiting for paints before the compile takes the thread.

Two later runs on the same machine (still loaded by other work) read **7252 ms** and **7105 ms** to
the intro screen, with the legs at assets 3.8–4.0 s, `enter()` 1.5 s, warm-up 1.7 s, and
`ready` → intro **26–29 ms**.

Still in front of the player: the asset leg (3.8–4.0 s — parse and decode, not bytes fetched),
`enter()`'s remaining 1.5 s, and the warm-up's 1.7 s. None of those is waiting on I/O: the bundle is
local.

### Two leads measured and dropped

- **De-indexing before `mergeParts`** (`airframe-lod.ts`): the game de-indexes every part and the
  engine's `flatten` de-indexes again, which looks like duplicated work. Benchmarked on an
  airframe-sized merge (260,000 triangles across six parts, one geometry-shaped part each):
  **85.6 ms → 91.1 ms**, a wash. Both paths de-index exactly once — the game's copy expands, the
  engine's clone does not — so the redundancy is real and the cost is not. Reverted.
- **Which asset is slow**: the game logs group totals ("ships 3.4 s") and the engine's progress
  ledger is byte-weighted, so neither can name a file. The engine now has
  `globalThis.__TN_ASSET_TRACE__ = true` → `TN_ASSET:{"kind","path","ms","bytes"}` per settle
  (`74bf6791e`, engine). One launch of this game is 172 settles; the longest was a model at 7.7 s
  from its own request on a machine at load ≈ 20, which is queue time rather than parse time. The
  seam is what makes the next pass possible; it has not been read on a quiet machine yet.
