# ThreeNative examples

Sample games built on [ThreeNative](https://github.com/ThreeNativeHQ/threenative), one per folder.

Each folder is a complete project as a user would have it: the framework is installed as a
dependency, not linked from a monorepo, so what is here is what someone gets after
`npx create-threenative`. Nothing is written at the root of this repository — the root carries the
sealed brief for the current build and the package staging, and every game lives one folder deep.

| Folder | What it is |
| --- | --- |
| `crate-vault/` | Physics puzzle — shove crates onto the pad to light the goal, with a determinism replay on `V`. Framework arm, on the published `@threenative/*` 0.2.x |
| `fox-game/` | Platformer — run, jump, collect the coin line, reach the goal. Plain Three.js arm, no framework packages |
| `mined-features/` | Exploration — click three beacons to light them. Exists to prove the 2026-08-28 mined features work through the public API: atmosphere, pointer events, the portable zoom axis, billboards, camera shake, sprite atlases, the shared compute lifetime and the GPU scene BVH. One playtest asserts all eight |

## Running one

```sh
cd <folder>
pnpm install
pnpm dev
```

`crate-vault` installs from npm and is the one to clone. `fox-game` still points its playtest
bridge at a local tarball path from the machine it was built on, so it runs where it was built and
not yet anywhere else.

The reference screenshots each build was matched against are third-party images and are not
committed; `brief.md` in each folder describes the target in words.
