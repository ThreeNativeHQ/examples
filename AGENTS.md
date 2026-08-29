# AGENTS.md — threenative/sandbox

Sample ThreeNative games, one per folder, installed as a user would have them: tarballs from
`.packages/`, no workspace link. The engine sits at `/home/joao/projects/threenative/threenative-engine`
and its `docs/architecture/CHARTER.md` binds and wins over this file. Each game's own `AGENTS.md` owns
its subtree. `CLAUDE.md` is a generated mirror; edit this file, then regenerate it.

## The standing instruction

**When an abstraction belongs to the engine, it goes in the engine and this game is refactored onto
it** — heavy lifting is always the engine's, so the next game's agent never has to think about it.

1. Search the capability manifest before writing any system — `engine_search_capabilities`, then `engine_capability_detail`; a game here once hand-wrote 446 lines that were already installed.
2. Nothing matches? Write it in the game in plain Three.js, and log the gap in that game's `FRICTION.md` as it happens, with the evidence path.
3. Once one game writes it more than twice, or it needed a browser global, gate it against the charter (below).
4. Passes? Lift it into the engine's `packages/`, with unit test, playtest, capability-manifest entry and template `AGENTS.md` entry in the same commit.
5. Fails? It stays in the game, and the reason goes in that game's `docs/abstraction-ideas-*.md`.

## The gate — state the rule, never a section number

1. **Could the game write this portably itself?** If no — browser global, platform seam, backend the game must not know it got — the engine owns it, at any size.
2. **Does it decide how anything looks?** If yes it ships as generated source in a template's `src/render/`, at any size. This vetoes rule 1: mechanism may ship, but geometry, material, colour, texture, curve and timing arrive as call arguments — the test is whether a game can change the look completely without editing package code, and it has no partial credit.
3. **Kill switch:** costs more code than plain Three.js ⇒ deleted, however much work it took, counted **across every repetition in one game, never one site** — per-site scoring is how the kill switch becomes a rule against having a framework at all.
4. **The closed list outranks all of the above:** no IR, scene format, editor, preset/genre/recipe system, code-first ECS, or bespoke CLI vocabulary, however cleanly a proposal passes.
5. **Vocabulary is borrowed** — Godot nodes, Three.js rendering, Rapier physics, Tailwind UI, camelCase; exhaust borrowing before inventing.
6. **Web-only is unfinished:** anything admitted *because* the game cannot write it portably lands with native proof — a conformance case or a `--target` playtest — in the same commit.
7. **A convention ships a default that is right with no option passed, a named override on the same object, honest reporting when overridden, and a template `AGENTS.md` entry** — a capability the template docs omit does not exist.
8. **Gameplay never goes in a package**; entities are plain classes, and an ECS is not the default.

## Lifting and adopting

1. Write the engine code with the game's call sites in front of you — if the game must reshape itself around the helper, the helper is wrong.
2. Red-green including bugfixes — paste the failing output, then the passing one — then `pnpm typecheck && pnpm lint && pnpm test` in the engine, plus `pnpm tsx scripts/count-loc.ts` when the kill switch is in question.
3. Pack into staging: `pnpm --filter ./packages/<pkg> build && pnpm --filter ./packages/<pkg> exec pnpm pack --pack-destination /home/joao/projects/threenative/sandbox/.packages`.
4. **Rename the tarball to carry a content hash** (`threenative-core-0.2.0-<label>-<sha256[:12]>.tgz`) — `pnpm pack` names by version alone and the package manager will serve its cached copy, silently installing the old engine.
5. Repoint the game's `file:` dependency, `pnpm install`, migrate the call sites, and **delete the hand-written copy** — a lift that leaves it in place moved code instead of removing it.
6. Report net lines in the commit message, and re-run the game's playtests against a baseline captured before the change.
7. Fix an engine bug in `packages/` and reinstall — never patch `node_modules/`, never route around it in game code.
8. Write down a rejected adoption and why; that sentence is the engine's next design constraint.

## A new game is committed and pushed, always

This folder is a git repository with a remote (`ThreeNativeHQ/examples`, public), and it is the
framework's only end-to-end evidence that it builds something a player would look at. **Whenever a
new game is added here, commit it and push it back to the remote** — not at the end of the session,
but as soon as it runs, and again on every visible improvement.

```sh
git -C /home/joao/projects/threenative/sandbox add <name>
git -C /home/joao/projects/threenative/sandbox commit -m "feat(sandbox): <Name> — <the rule the game proves>"
git -C /home/joao/projects/threenative/sandbox push
```

A game that only exists on this disk is one `rm -rf` from gone, and an unpushed game cannot be read
by the next agent, on the next machine, or by anyone judging whether the framework works. Commit the
screenshots too — they are the record of the visual loop. Do not commit `node_modules/`, `dist/`,
`.packages/` or `.pnpm-store/`; `.gitignore` already excludes them. Only your own game folder goes in
the commit: a sibling folder with uncommitted work belongs to another lane.

## Working here

Every command runs inside a game folder — there is no root build.

1. **Wrap every browser launch in that game's `tools/capture-lock.sh <command>`** — it serialises captures, reaps stranded profiles, forces X11 on this Wayland host, and uses a throwaway Xvfb so no window appears; visible-desktop captures are banned by user directive.
2. **Never call `xvfb-run`** — its failing cleanup kill replaces the real exit status, so every gate wrapped in it reports failure whether it passed or not.
3. **Headless Chromium cannot render WebGPU:** pass `--browser-recipe webgpu --headed` and check the adapter, or suspect the capture before you rewrite the scene.
4. **Playtest steps use `holdTicks`/`waitTicks`** — `holdFrames`/`waitFrames` validate but never advance the fixed-step clock, so keypresses silently never land.
5. **Deliver playtest aim through the setup rotation quaternion and fire with Space** — CDP mouse deltas read zero without OS focus.
6. **Clone rigged GLBs with `SkeletonUtils.clone`** and never measure a clone before frame 1 (it reports as a single point); `gltf-transform optimize` needs `--vertex-layout separate` or WebGPU fails `createRenderPipeline` on every mesh.
7. **Free a dev server by port** (`lsof -ti tcp:<port> | xargs -r kill`) — `pkill -f vite` matches your own shell — and never search `.worktrees/`, which holds other agents' dead lanes.
8. **Never claim a gate you did not run**; "unverified" is an acceptable answer.
9. **Every automated gate here is blind to how a game looks** — all of them pass on grey boxes, so look at the frame before calling a visual change done.

## The folders

`fps-framework/` FPS framework arm, active build and source of most lifts · `fps-vanilla/` same brief
in plain Three.js, the control · `crate-vault/` physics puzzle on published 0.2.x, the one to clone ·
`fox-native/` native-target platformer · `fox-game/` vanilla platformer · `fps-kit/` shared FPS asset
staging · `.packages/` staged engine tarballs.
