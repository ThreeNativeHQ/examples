# ThreeNative examples

Sample games built on [ThreeNative](https://github.com/ThreeNativeHQ/threenative), one per folder.

Each folder is a complete project as a user would have it: the framework is installed as a
dependency, not linked from a monorepo, so what is here is what someone gets after
`npx create-threenative`. Nothing is written at the root of this repository — the root carries the
sealed brief for the current build and the package staging, and every game lives one folder deep.

| Folder | What it is |
| --- | --- |
| `fox-game/` | Platformer built from the platformer brief, plain Three.js arm |

## Running one

```sh
cd <folder>
pnpm install
pnpm dev
```

The reference screenshots each build was matched against are third-party images and are not
committed; `brief.md` in each folder describes the target in words.
