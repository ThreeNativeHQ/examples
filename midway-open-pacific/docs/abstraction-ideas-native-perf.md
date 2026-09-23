# Abstraction ideas — native performance (2026-09-23)

Where each mechanism written for `PRD-midway-render-cpu-20260922` and
`PRD-midway-native-smooth-20260923` belongs, judged by the charter gate in the sandbox
`AGENTS.md` (engine `docs/architecture/CHARTER.md` wins).

- **Lifted** means it goes into `@threenative/core`, tracked in engine PRD-442.
- **Stays** means it stays in this game; the reason is recorded here, as the charter requires.

## Lifted — engine PRD-442

### Visibility-aware world-matrix pass

**Game copy:** `WorldView.updateVisibleMatrixWorld` (`src/render/world.ts`), called from a
`beforeRender` hook in `src/scenes/Midway.ts`.

**Why it belongs in core:** it is pure mechanism and decides nothing about the look. Core owns the
loop and `renderer.render`. three's default walk recomputes every object's world matrix every
frame, hidden or not, so every game with LOD levels, merged stand-ins or hidden models pays for
it. Measured here:

- 29% of native flight JavaScript time;
- 9,903 → 779 nodes per frame, and 3.1 → 0.3 ms.

**Charter rule 7:** it needs a correct default, a named override (`"all"`), reporting of the
visited nodes, and a template `AGENTS.md` entry.

**Lesson that is now a requirement:** a class that overrides `updateMatrixWorld` must run its own
walk. `SkinnedMesh` refreshes `bindMatrixInverse` there, and `Camera` refreshes
`matrixWorldInverse`. A pure re-implementation made the skinned deck crew vanish. Bones under a
hidden node must still be walked.

### A startup warm-up that covers every pass

**Game copy:** `WorldView.warmHiddenPasses` (`src/render/world.ts`), run under
`ctx.startup.hold`.

**Why it belongs in core:** core already owns the startup warm-up (`TN_STARTUP_WARMUP`), but
`compileAsync` only reaches main-pass pipelines. Shadow and reflection variants then compile
synchronously mid-flight: 44–107 pipelines, and freezes of up to 615 ms. The native async
pipeline pool is a platform seam (rule 1).

**What the game still owns:** where the cameras look and which ships to stage. Those arrive as
call arguments, not Midway-specific rules.

## Stays in the game

### Shadow-caster proxy per carrier

**Code:** `addShadowProxy`, `SHADOW_PROXY_LAYER` in `src/render/world.ts`.

It is mechanism, but only one game has needed it. Rule 3 applies: "once one game writes it more
than twice". The gap is logged in `FRICTION.md`. Lift it when a second game merges static casters.
The lift would take the merged geometry and the layer as arguments and set the shadow camera's
mask itself.

### Aircraft detail clone pool

**Code:** `aircraftPool` and `resetAircraft` in `src/render/world.ts`.

The pooling is trivial. The work is the reset: propeller angle, rear-gun rotation, damage stains,
torpedo load, and the animation mixer's time. All of that is game-specific state. A generic pool
would need every game to hand it a reset function, which is more code than the game's own pool.
Kill switch (rule 3).

### O(n) fighter target selection

**Code:** `src/sim/tactics.ts`.

This is gameplay (rule 8). Its equivalence check, `scripts/check-tactics-equivalence.mjs`, stays
with it.

### The per-frame HUD publish

**Code:** `src/ui/bridge.ts`.

There is nothing to lift. Core's store already publishes once per frame by default
(`packages/core/src/state.ts`). The game had overridden that with its own 10 Hz gate, and removing
the gate was the fix.

### The native F4 frame-time panel

**Code:** `src/ui/frame-meter.ts`, fed from `BridgeHud.draw`.

The panel decides how things look (a game-drawn overlay), so rule 2 keeps it in the game. The
engine already reports frame timing (`TN_FRAME_BUDGET`). What a template could borrow is the rule
that a native UI overlay must never time the game with its own `requestAnimationFrame`. That belongs
in the template `AGENTS.md` next to PRD-442's matrix-pass entry.
