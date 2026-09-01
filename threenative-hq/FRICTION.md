# FRICTION — threenative-hq

Engine-shaped friction hit while building this game, with the evidence path. Game-shaped problems
are not in here; they were fixed in the game.

## 1. `.mcp.json` in the engine repository points at a path that cannot resolve

`packages/core/mcp/servers.mjs` writes `./node_modules/@threenative/core/mcp/assets.mjs`, which is
right for a generated game and wrong for the engine checkout, where core is a workspace package the
repo never installs into itself:

```
Error: Cannot find module '/home/joao/projects/threenative/threenative-engine/node_modules/@threenative/core/mcp/assets.mjs'
```

An agent working in the engine repository therefore has no asset, sculpt or capability tools at
all, silently — the server simply never connects. Fixed locally by pointing the file at
`./packages/core/mcp/*.mjs`; the engine's own `.mcp.json` is gitignored, so the next checkout hits
it again.

## 2. The Fab importer is `StaticMesh`-only, so no rigged Fab character can reach a game

`threenative-asset-mcp` `src/unreal/importer.ts:927` classifies packages by `hasStaticMesh` and
`:944` filters everything else out. The Fab listing this game was originally specified against —
*Office Worker 2 - Animated* — is a skeletal mesh with animation sequences, and there is no path
for it. The game uses CC0 Quaternius clips instead, which is a better answer for this game and not
an answer at all for the next one.

## 3. `AnimationPlayer` throws on duplicate clip names, with no way to merge two libraries

Loading two animation libraries built on one rig is the normal way to assemble a character's
vocabulary, and both of these ship an `A_TPose`:

```
Duplicate animation clip 'A_TPose'.
```

The game now dedupes by name before constructing the player (`src/scenes/Office.ts`), which every
game combining two clip sources will have to write. Either the player should take the first
occurrence and report the drop, or there should be a named helper for merging clip sets.

## 4. No framework way to instance one skinned mesh many times

The office needs sixteen copies of one rigged mannequin. That is
`three/examples/jsm/utils/SkeletonUtils.js`'s `clone`, imported by hand in `src/office/Worker.ts`.
It is not a look decision and every crowd, enemy wave and NPC set needs it.

## 5. A playtest scenario has no wall-clock wait, and ticks run far faster than real time

A scenario that reads as fifteen seconds of waiting completes in about one and a half. Anything the
proof must synchronise with that is *not* driven by ticks — here, a scripted bridge on the other
end of a socket — either fires before the first sample or after the last. The game works around it
by having the office send a viewer heartbeat and the fixture advance on heartbeats
(`tools/office-bridge/fixture.ts`). A `waitMs` step, or a documented tick-to-wall-clock contract,
would remove the workaround.

## 6. `warmupFrames` consumes the boot transition, so boot invariants can only be waived

With any warmup at all, the runner's "before" sample already shows the connected, populated state,
so `bridgeOnline` and `workerCount` are reported as trivial. Waiving them all then trips
`TN_PLAYTEST_SCENARIO_ASSERTS_NOTHING` — correctly. `warmupFrames: 0` is the fix and it is not
obvious; the diagnostic could name it.

## Not the engine's fault, recorded because it cost an hour

A stray `/tmp/package.json` containing `{"type":"module"}` made every extensionless Node script
under `/tmp` load as ESM, which broke the CommonJS test stubs in `threenative-asset-mcp` and turned
21 of its tests red at a clean `HEAD`. Moving that one file green-lit the whole suite (169/169).
